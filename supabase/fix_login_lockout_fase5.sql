-- ──────────────────────────────────────────────────────────────────────────────
-- fix_login_lockout_fase5.sql
--
-- Bloqueo de cuenta tras intentos fallidos de login: 10 intentos -> bloqueo de
-- 48 horas. No existia ningun mecanismo de este tipo (solo el rate-limit
-- generico por IP de Supabase, no por cuenta).
--
-- Las funciones son SECURITY DEFINER para poder actualizar el contador desde
-- el login (usuario aun no autenticado, rol anon) sin exponer mas datos que
-- un boolean + minutos restantes. Nunca revelan si el email existe (mismo
-- patron que resetPasswordForEmail ya usa en login/page.tsx).
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE persona ADD COLUMN IF NOT EXISTS intentos_fallidos integer NOT NULL DEFAULT 0;
ALTER TABLE persona ADD COLUMN IF NOT EXISTS bloqueado_hasta timestamptz;

CREATE OR REPLACE FUNCTION fn_verificar_bloqueo(p_email text)
RETURNS TABLE(bloqueado boolean, minutos_restantes integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(bloqueado_hasta > now(), false) AS bloqueado,
    GREATEST(0, CEIL(EXTRACT(EPOCH FROM (bloqueado_hasta - now())) / 60))::integer AS minutos_restantes
  FROM persona
  WHERE lower(email) = lower(p_email)
  UNION ALL
  SELECT false, 0
  LIMIT 1;
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
BEGIN
  UPDATE persona
  SET intentos_fallidos = intentos_fallidos + 1
  WHERE lower(email) = lower(p_email)
  RETURNING intentos_fallidos INTO v_intentos;

  IF v_intentos IS NULL THEN
    RETURN QUERY SELECT false, 0; -- email no registrado: no revelar nada
    RETURN;
  END IF;

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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE persona
  SET intentos_fallidos = 0, bloqueado_hasta = NULL
  WHERE lower(email) = lower(p_email);
$$;

GRANT EXECUTE ON FUNCTION fn_verificar_bloqueo(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_registrar_intento_fallido(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_login_exitoso(text) TO anon, authenticated;
