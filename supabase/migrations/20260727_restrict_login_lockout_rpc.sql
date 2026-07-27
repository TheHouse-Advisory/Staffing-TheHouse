-- ──────────────────────────────────────────────────────────────────────────────
-- 20260727_restrict_login_lockout_rpc.sql
--
-- fn_verificar_bloqueo / fn_registrar_intento_fallido / fn_login_exitoso
-- (fase 5, login lockout) estaban otorgadas a anon/authenticated para poder
-- llamarse antes de autenticar. Como toda RPC de Supabase es un endpoint REST
-- público (protegido solo por la anon key, que es pública por diseño),
-- cualquiera podía invocarlas directo con curl, sin pasar por el formulario:
--
--   - Llamar fn_registrar_intento_fallido 10 veces con el email de otra
--     persona la bloqueaba 48h sin intentar ninguna contraseña (DoS de cuenta).
--   - Llamar fn_login_exitoso con el email de la víctima reseteaba el
--     contador a mitad de un ataque de fuerza bruta real, anulando el
--     bloqueo por completo.
--
-- Fix: se revoca el acceso público/anon/authenticated (incluye PUBLIC, que
-- Postgres otorga por defecto a toda función nueva) y se restringe a
-- service_role. El login ahora corre server-side (ver lib/auth/login-actions.ts)
-- con el cliente de service role, así que el navegador ya no llama estas
-- funciones directamente.
-- ──────────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION fn_verificar_bloqueo(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fn_registrar_intento_fallido(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fn_login_exitoso(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION fn_verificar_bloqueo(text) TO service_role;
GRANT EXECUTE ON FUNCTION fn_registrar_intento_fallido(text) TO service_role;
GRANT EXECUTE ON FUNCTION fn_login_exitoso(text) TO service_role;
