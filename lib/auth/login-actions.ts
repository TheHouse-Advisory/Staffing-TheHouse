/**
 * Server Action de login. Corre server-side con el cliente de service role
 * para que el bloqueo por intentos fallidos no dependa de lo que el
 * navegador "avise" (ver 20260727_restrict_login_lockout_rpc.sql): verificar
 * bloqueo, intentar la contraseña y registrar el resultado son un solo paso
 * atómico que el cliente no puede invocar por separado ni saltarse.
 *
 * Dos capas de bloqueo, independientes:
 *  - por cuenta (fn_*_fallido, fase5): 10 intentos -> 48h.
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

export type LoginResult =
  | { ok: true }
  | { ok: false; kind: "ya_bloqueada"; minutosRestantes: number }
  | { ok: false; kind: "recien_bloqueada"; minutosRestantes: number }
  | { ok: false; kind: "ip_bloqueada"; minutosRestantes: number }
  | { ok: false; kind: "credenciales_invalidas" };

/** IP real del cliente detrás del proxy de Vercel. */
async function obtenerIp(): Promise<string> {
  const hdrs = await headers();
  const forwarded = hdrs.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return hdrs.get("x-real-ip") ?? "0.0.0.0";
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

  const { data: bloqueoIpData } = await service.rpc("fn_verificar_bloqueo_ip", { p_ip: ip });
  if (bloqueoIpData?.[0]?.bloqueado) {
    return { ok: false, kind: "ip_bloqueada", minutosRestantes: bloqueoIpData[0].minutos_restantes };
  }

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
    const [{ data: intentoData }, { data: intentoIpData }] = await Promise.all([
      service.rpc("fn_registrar_intento_fallido", { p_email: emailNorm }),
      service.rpc("fn_registrar_intento_fallido_ip", { p_ip: ip }),
    ]);

    const intento = intentoData?.[0];
    if (intento?.bloqueado) {
      return { ok: false, kind: "recien_bloqueada", minutosRestantes: intento.minutos_restantes };
    }
    if (intentoIpData?.[0]?.bloqueado) {
      return { ok: false, kind: "ip_bloqueada", minutosRestantes: intentoIpData[0].minutos_restantes };
    }
    return { ok: false, kind: "credenciales_invalidas" };
  }

  await Promise.all([
    service.rpc("fn_login_exitoso", { p_email: emailNorm }),
    service.rpc("fn_login_exitoso_ip", { p_ip: ip }),
  ]);
  return { ok: true };
}
