/**
 * Route Handler para el callback de Supabase Auth.
 *
 * Supabase redirige aquí tras un magic link, una invitación o una
 * recuperación de contraseña. Soportamos los dos formatos de enlace que
 * Supabase puede generar:
 *
 *  1. PKCE → `?code=...`
 *     Lo usa el cliente de navegador (p.ej. "¿Olvidaste tu contraseña?"
 *     desde /login, que inicia el flujo con createBrowserClient).
 *
 *  2. OTP  → `?token_hash=...&type=...`
 *     Lo usan los enlaces generados en el servidor (la invitación que envía
 *     un admin) cuando la plantilla de correo apunta directo a /auth/callback.
 *     Es el formato recomendado por Supabase para apps con SSR.
 *
 * Si el enlace expiró o ya fue usado, Supabase nos manda `?error=...` y
 * redirigimos a /login con un mensaje entendible.
 */
import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

/** Solo permite rutas internas — evita open redirects vía `?next=`. */
function rutaInterna(next: string | null): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    return next;
  }
  return "/tablero";
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = rutaInterna(searchParams.get("next"));
  const errorParam = searchParams.get("error");
  const errorCode = searchParams.get("error_code");

  // Respeta el host real cuando hay un proxy delante (producción).
  const forwardedHost = request.headers.get("x-forwarded-host");
  const isLocalEnv = process.env.NODE_ENV === "development";
  const base = !isLocalEnv && forwardedHost ? `https://${forwardedHost}` : origin;
  const redirectTo = (path: string) => NextResponse.redirect(`${base}${path}`);

  // El enlace llegó con un error (expirado, ya consumido, etc.).
  if (errorParam || errorCode) {
    const expirado =
      errorCode === "otp_expired" || /expired/i.test(errorParam ?? "");
    return redirectTo(
      `/login?error=${expirado ? "enlace_expirado" : "auth_callback"}`
    );
  }

  const supabase = await createClient();

  // Formato 1: PKCE.
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return redirectTo(next);
    return redirectTo("/login?error=auth_callback");
  }

  // Formato 2: OTP por token_hash (invitación / recuperación).
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (!error) {
      // Invitación o recuperación → el usuario debe crear/resetear su contraseña
      const needsPassword = type === "invite" || type === "recovery";
      return redirectTo(needsPassword ? "/auth/set-password" : next);
    }
    const expirado = /expired|invalid/i.test(error.message ?? "");
    return redirectTo(
      `/login?error=${expirado ? "enlace_expirado" : "auth_callback"}`
    );
  }

  // Sin parámetros utilizables: enlace mal formado.
  return redirectTo("/login?error=auth_callback");
}
