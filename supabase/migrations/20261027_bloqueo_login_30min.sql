-- ──────────────────────────────────────────────────────────────────────────────
-- Bloqueo por cuenta: 10 intentos fallidos → 30 minutos (antes 48 horas).
--
-- Con 48h, cualquiera que supiera el email de alguien podía dejarlo sin acceso
-- por 2 días con 10 intentos. 30 min sigue frenando la adivinación de
-- contraseñas (junto con el límite por IP y el rate limit de Supabase Auth).
-- Misma función que fix_audit_log_fase6.sql; los permisos (solo service_role)
-- se conservan con CREATE OR REPLACE.
-- Ejecutar en Supabase → SQL Editor (idempotente).
-- ──────────────────────────────────────────────────────────────────────────────

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
    SET bloqueado_hasta = now() + interval '30 minutes',
        intentos_fallidos = 0
    WHERE lower(email) = lower(p_email)
    RETURNING bloqueado_hasta INTO v_bloqueado_hasta;

    RETURN QUERY SELECT true, CEIL(EXTRACT(EPOCH FROM (v_bloqueado_hasta - now())) / 60)::integer;
  ELSE
    RETURN QUERY SELECT false, 0;
  END IF;
END;
$$;
