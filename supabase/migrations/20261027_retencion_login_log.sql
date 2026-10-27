-- ──────────────────────────────────────────────────────────────────────────────
-- Retención de datos de inicio de sesión.
--
-- Antes: login_log guardaba para siempre cada email usado al intentar entrar
-- (incluidos emails mal escritos o contraseñas pegadas por error en el campo
-- email), y login_intento_ip acumulaba IPs indefinidamente.
--
-- Ahora, cada vez que se registra un intento de login se borran:
--   · login_log con más de 180 días
--   · login_intento_ip con más de 1 día y sin bloqueo vigente
-- No requiere pg_cron. acceso_log (cambios de rol/acceso) se conserva.
-- Ejecutar en Supabase → SQL Editor (idempotente).
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_limpiar_registros_login()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM login_log WHERE creado_en < now() - interval '180 days';
  DELETE FROM login_intento_ip
   WHERE primer_intento < now() - interval '1 day'
     AND (bloqueado_hasta IS NULL OR bloqueado_hasta < now());
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_limpiar_registros_login() FROM PUBLIC, anon, authenticated;

-- Una vez por sentencia (no por fila): barato aunque haya muchos intentos
DROP TRIGGER IF EXISTS trg_limpiar_registros_login ON login_log;
CREATE TRIGGER trg_limpiar_registros_login
  AFTER INSERT ON login_log
  FOR EACH STATEMENT EXECUTE FUNCTION fn_limpiar_registros_login();

CREATE INDEX IF NOT EXISTS login_log_creado_en_idx ON login_log (creado_en);

-- Limpieza inicial
DELETE FROM login_log WHERE creado_en < now() - interval '180 days';
DELETE FROM login_intento_ip
 WHERE primer_intento < now() - interval '1 day'
   AND (bloqueado_hasta IS NULL OR bloqueado_hasta < now());
