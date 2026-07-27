-- ──────────────────────────────────────────────────────────────────────────────
-- 20260727_rate_limit_login_por_ip.sql
--
-- Hallazgo: el bloqueo de fase5 es por CUENTA (email). Un atacante puede
-- probar una contraseña distinta contra cientos de cuentas sin disparar
-- nunca el bloqueo de ninguna, o repartir el ataque para no acumular
-- intentos en una sola cuenta (credential stuffing). No existía ningún
-- límite por IP.
--
-- Fix: un segundo contador, independiente del de fase5, por dirección IP.
-- 10 intentos fallidos en 15 min → bloqueo de 1 hora. El bloqueo se deja
-- corto a propósito: muchas conexiones móviles comparten una misma IP
-- pública entre varios clientes de la misma compañía telefónica (NAT de
-- operador), así que un bloqueo largo podría dejar afuera durante horas a
-- gente ajena al intento fallido. Una hora ya frena un ataque automatizado
-- sin ese costo.
--
-- Igual que fase5 corregida: SECURITY DEFINER, SET search_path fijo, y
-- EXECUTE solo para service_role — se llama exclusivamente desde
-- lib/auth/login-actions.ts (server-side), nunca directo desde el navegador.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS login_intento_ip (
  ip inet PRIMARY KEY,
  intentos integer NOT NULL DEFAULT 0,
  primer_intento timestamptz NOT NULL DEFAULT now(),
  bloqueado_hasta timestamptz
);

ALTER TABLE login_intento_ip ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "login_intento_ip: solo admin lee" ON login_intento_ip;
CREATE POLICY "login_intento_ip: solo admin lee" ON login_intento_ip
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM persona p WHERE p.auth_user_id = auth.uid() AND p.rol_sistema = 'admin'));

CREATE OR REPLACE FUNCTION fn_verificar_bloqueo_ip(p_ip inet)
RETURNS TABLE(bloqueado boolean, minutos_restantes integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(bloqueado_hasta > now(), false) AS bloqueado,
    GREATEST(0, CEIL(EXTRACT(EPOCH FROM (bloqueado_hasta - now())) / 60))::integer AS minutos_restantes
  FROM login_intento_ip
  WHERE ip = p_ip
  UNION ALL
  SELECT false, 0
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION fn_registrar_intento_fallido_ip(p_ip inet)
RETURNS TABLE(bloqueado boolean, minutos_restantes integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intentos integer;
  v_bloqueado_hasta timestamptz;
BEGIN
  INSERT INTO login_intento_ip (ip, intentos, primer_intento)
  VALUES (p_ip, 1, now())
  ON CONFLICT (ip) DO UPDATE
    SET intentos = CASE
          WHEN login_intento_ip.primer_intento < now() - interval '15 minutes'
            THEN 1  -- ventana anterior expiro: reinicia contador y ventana
          ELSE login_intento_ip.intentos + 1
        END,
        primer_intento = CASE
          WHEN login_intento_ip.primer_intento < now() - interval '15 minutes'
            THEN now()
          ELSE login_intento_ip.primer_intento
        END
  RETURNING intentos INTO v_intentos;

  IF v_intentos >= 10 THEN
    UPDATE login_intento_ip
    SET bloqueado_hasta = now() + interval '1 hour'
    WHERE ip = p_ip
    RETURNING bloqueado_hasta INTO v_bloqueado_hasta;

    RETURN QUERY SELECT true, CEIL(EXTRACT(EPOCH FROM (v_bloqueado_hasta - now())) / 60)::integer;
  ELSE
    RETURN QUERY SELECT false, 0;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION fn_login_exitoso_ip(p_ip inet)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM login_intento_ip WHERE ip = p_ip;
$$;

REVOKE EXECUTE ON FUNCTION fn_verificar_bloqueo_ip(inet) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fn_registrar_intento_fallido_ip(inet) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fn_login_exitoso_ip(inet) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION fn_verificar_bloqueo_ip(inet) TO service_role;
GRANT EXECUTE ON FUNCTION fn_registrar_intento_fallido_ip(inet) TO service_role;
GRANT EXECUTE ON FUNCTION fn_login_exitoso_ip(inet) TO service_role;
