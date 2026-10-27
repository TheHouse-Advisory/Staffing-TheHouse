/**
 * Server Action de login. Corre server-side con el cliente de service role
 * para que el bloqueo por intentos fallidos no dependa de lo que el
 * navegador "avise" (ver 20260727_restrict_login_lockout_rpc.sql): verificar
 * bloqueo, intentar la contraseña y registrar el resultado son un solo paso
 * atómico que el cliente no puede invocar por separado ni saltarse.
 *
 * Dos capas de bloqueo, independientes:
 *  - por cuenta (fn_*_fallido, ver 20261027_bloqueo_login_30min.sql): 10 intentos -> 30 min.
 *  - por IP (fn_*_fallido_ip, ver 20260727_rate_limit_login_por_ip.sql):
 *    30 intentos en 15 min -> 15 min. Cubre el caso de credential stuffing
 *    (una contraseña distinta contra muchas cuentas) que nunca dispara el
 *    bloqueo por cuenta porque ninguna cuenta individual acumula intentos.
 */
"use server";

import { headers } from "next/headers";
import { createClient, createServiceClient } from "@/lib/supabase/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceClient = any;

// El bloqueo por cuenta se informa igual que credenciales inválidas: así no se
// revela qué correos están registrados (solo las cuentas reales se bloquean).
export type LoginResult =
  | { ok: true }
  | { ok: false; kind: "ip_bloqueada"; minutosRestantes: number }
  | { ok: false; kind: "credenciales_invalidas" }
  | { ok: false; kind: "no_disponible" };

/** IP real del cliente detrás del proxy de Vercel. */
async function obtenerIp(): Promise<string> {
  const hdrs = await headers();
  // x-real-ip lo fija Vercel; x-forwarded-for puede traer valores del cliente
  const real = hdrs.get("x-real-ip");
  if (real) return real.trim();
  const forwarded = hdrs.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "0.0.0.0";
}

export async function iniciarSesion({
  email,
  password,
}: {
  email: string;
  password: string;
}): Promise<LoginResult> {
  const emailNorm = email.trim().toLowerCase();
  const ip = await obtenerIp();
  const service: ServiceClient = createServiceClient();

  const [ipRes, cuentaRes] = await Promise.all([
    service.rpc("fn_verificar_bloqueo_ip", { p_ip: ip }),
    service.rpc("fn_verificar_bloqueo", { p_email: emailNorm }),
  ]);
  // Si no se puede verificar el bloqueo, se rechaza (no se deja pasar a ciegas)
  if (ipRes.error || cuentaRes.error) {
    return { ok: false, kind: "no_disponible" };
  }
  if (ipRes.data?.[0]?.bloqueado) {
    return { ok: false, kind: "ip_bloqueada", minutosRestantes: ipRes.data[0].minutos_restantes };
  }
  if (cuentaRes.data?.[0]?.bloqueado) {
    return { ok: false, kind: "credenciales_invalidas" };
  }

  const supabase = await createClient();
  const { error: authError } = await supabase.auth.signInWithPassword({
    email: emailNorm,
    password,
  });

  if (authError) {
    const [, { data: intentoIpData }] = await Promise.all([
      service.rpc("fn_registrar_intento_fallido", { p_email: emailNorm }),
      service.rpc("fn_registrar_intento_fallido_ip", { p_ip: ip }),
    ]);

    if (intentoIpData?.[0]?.bloqueado) {
      return { ok: false, kind: "ip_bloqueada", minutosRestantes: intentoIpData[0].minutos_restantes };
    }
    return { ok: false, kind: "credenciales_invalidas" };
  }

  // El contador por IP NO se reinicia con un login exitoso: si no, alguien con
  // cuenta propia podría intercalar logins válidos y probar contraseñas ajenas
  // sin límite. La ventana de 15 min expira sola.
  await service.rpc("fn_login_exitoso", { p_email: emailNorm });
  return { ok: true };
}
