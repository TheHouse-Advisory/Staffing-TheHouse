-- ──────────────────────────────────────────────────────────────────────────────
-- fix_audit_log_fase6.sql
--
-- Registro de auditoria, alcance acotado (segun lo definido): quien entra
-- (login_log) y cambios de rol/acceso en /accesos (acceso_log). No cubre
-- otras tablas de negocio -- se puede ampliar despues si hace falta.
--
-- Ambas tablas son de solo lectura para admin (RLS). Se escriben unicamente
-- desde funciones SECURITY DEFINER / triggers, nunca directo desde el cliente.
-- ──────────────────────────────────────────────────────────────────────────────

-- ── login_log: quien entra ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS login_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL,
  persona_id uuid REFERENCES persona(id),
  resultado text NOT NULL CHECK (resultado IN ('exitoso', 'fallido', 'bloqueado')),
  creado_en timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE login_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "login_log: solo admin lee" ON login_log;
CREATE POLICY "login_log: solo admin lee" ON login_log
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM persona p WHERE p.auth_user_id = auth.uid() AND p.rol_sistema = 'admin'));

-- ── acceso_log: que cambia (roles / estado de acceso) ────────────────────────
CREATE TABLE IF NOT EXISTS acceso_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  persona_afectada_id uuid NOT NULL,
  actor_auth_id uuid, -- NULL = cambio hecho via service_role/SQL editor
  rol_anterior text,
  rol_nuevo text,
  estado_anterior text,
  estado_nuevo text,
  creado_en timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE acceso_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "acceso_log: solo admin lee" ON acceso_log;
CREATE POLICY "acceso_log: solo admin lee" ON acceso_log
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM persona p WHERE p.auth_user_id = auth.uid() AND p.rol_sistema = 'admin'));

-- ── Trigger: registra cada cambio efectivo de rol_sistema / acceso_estado ────
-- Corre DESPUES del guard existente (persona_guard_acceso), asi que solo
-- registra cambios que realmente se aplicaron (los bloqueados nunca llegan aqui).
CREATE OR REPLACE FUNCTION fn_log_cambio_acceso()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.rol_sistema IS NOT NULL OR NEW.acceso_estado IS NOT NULL THEN
      INSERT INTO acceso_log (persona_afectada_id, actor_auth_id, rol_anterior, rol_nuevo, estado_anterior, estado_nuevo)
      VALUES (NEW.id, auth.uid(), NULL, NEW.rol_sistema, NULL, NEW.acceso_estado);
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.rol_sistema IS DISTINCT FROM OLD.rol_sistema
     OR NEW.acceso_estado IS DISTINCT FROM OLD.acceso_estado THEN
    INSERT INTO acceso_log (persona_afectada_id, actor_auth_id, rol_anterior, rol_nuevo, estado_anterior, estado_nuevo)
    VALUES (NEW.id, auth.uid(), OLD.rol_sistema, NEW.rol_sistema, OLD.acceso_estado, NEW.acceso_estado);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_cambio_acceso ON persona;
CREATE TRIGGER trg_log_cambio_acceso
  AFTER INSERT OR UPDATE ON persona
  FOR EACH ROW EXECUTE FUNCTION fn_log_cambio_acceso();

-- ── Conectar login_log a las funciones de login/bloqueo de la Fase 5 ─────────
CREATE OR REPLACE FUNCTION fn_verificar_bloqueo(p_email text)
RETURNS TABLE(bloqueado boolean, minutos_restantes integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bloqueado boolean;
  v_minutos integer;
  v_persona_id uuid;
BEGIN
  SELECT
    COALESCE(bloqueado_hasta > now(), false),
    GREATEST(0, CEIL(EXTRACT(EPOCH FROM (bloqueado_hasta - now())) / 60))::integer,
    id
  INTO v_bloqueado, v_minutos, v_persona_id
  FROM persona
  WHERE lower(email) = lower(p_email);

  IF v_bloqueado THEN
    INSERT INTO login_log (email, persona_id, resultado) VALUES (lower(p_email), v_persona_id, 'bloqueado');
  END IF;

  RETURN QUERY SELECT COALESCE(v_bloqueado, false), COALESCE(v_minutos, 0);
END;
$$;

CREATE OR REPLACE FUNCTION fn_registrar_intento_fallido(p_email text)
RETURNS TABLE(bloqueado boolean, minutos_restantes integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intentos integer;
  v_bloqueado_hasta timestamptz;
  v_persona_id uuid;
BEGIN
  UPDATE persona
  SET intentos_fallidos = intentos_fallidos + 1
  WHERE lower(email) = lower(p_email)
  RETURNING intentos_fallidos, id INTO v_intentos, v_persona_id;

  IF v_intentos IS NULL THEN
    INSERT INTO login_log (email, persona_id, resultado) VALUES (lower(p_email), NULL, 'fallido');
    RETURN QUERY SELECT false, 0; -- email no registrado: no revelar nada
    RETURN;
  END IF;

  INSERT INTO login_log (email, persona_id, resultado) VALUES (lower(p_email), v_persona_id, 'fallido');

  IF v_intentos >= 10 THEN
    UPDATE persona
    SET bloqueado_hasta = now() + interval '48 hours',
        intentos_fallidos = 0
    WHERE lower(email) = lower(p_email)
    RETURNING bloqueado_hasta INTO v_bloqueado_hasta;

    RETURN QUERY SELECT true, CEIL(EXTRACT(EPOCH FROM (v_bloqueado_hasta - now())) / 60)::integer;
  ELSE
    RETURN QUERY SELECT false, 0;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION fn_login_exitoso(p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_persona_id uuid;
BEGIN
  UPDATE persona
  SET intentos_fallidos = 0, bloqueado_hasta = NULL
  WHERE lower(email) = lower(p_email)
  RETURNING id INTO v_persona_id;

  INSERT INTO login_log (email, persona_id, resultado) VALUES (lower(p_email), v_persona_id, 'exitoso');
END;
$$;

GRANT EXECUTE ON FUNCTION fn_verificar_bloqueo(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_registrar_intento_fallido(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_login_exitoso(text) TO anon, authenticated;
