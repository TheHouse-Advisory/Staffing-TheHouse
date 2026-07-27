/**
 * Server Action de login. Corre server-side con el cliente de service role
 * para que el bloqueo por intentos fallidos no dependa de lo que el
 * navegador "avise" (ver 20260727_restrict_login_lockout_rpc.sql): verificar
 * bloqueo, intentar la contraseña y registrar el resultado son un solo paso
 * atómico que el cliente no puede invocar por separado ni saltarse.
 */
"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceClient = any;

export type LoginResult =
  | { ok: true }
  | { ok: false; kind: "ya_bloqueada"; minutosRestantes: number }
  | { ok: false; kind: "recien_bloqueada"; minutosRestantes: number }
  | { ok: false; kind: "credenciales_invalidas" };

export async function iniciarSesion({
  email,
  password,
}: {
  email: string;
  password: string;
}): Promise<LoginResult> {
  const emailNorm = email.trim().toLowerCase();
  const service: ServiceClient = createServiceClient();

  const { data: bloqueoData } = await service.rpc("fn_verificar_bloqueo", { p_email: emailNorm });
  const bloqueo = bloqueoData?.[0];
  if (bloqueo?.bloqueado) {
    return { ok: false, kind: "ya_bloqueada", minutosRestantes: bloqueo.minutos_restantes };
  }

  const supabase = await createClient();
  const { error: authError } = await supabase.auth.signInWithPassword({
    email: emailNorm,
    password,
  });

  if (authError) {
    const { data: intentoData } = await service.rpc("fn_registrar_intento_fallido", { p_email: emailNorm });
    const intento = intentoData?.[0];
    if (intento?.bloqueado) {
      return { ok: false, kind: "recien_bloqueada", minutosRestantes: intento.minutos_restantes };
    }
    return { ok: false, kind: "credenciales_invalidas" };
  }

  await service.rpc("fn_login_exitoso", { p_email: emailNorm });
  return { ok: true };
}
