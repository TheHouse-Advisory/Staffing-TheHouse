/**
 * Utilidad para refrescar la sesión en el middleware de Next.js.
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/types/database";

// Expiración forzada de sesión: 7h de uso o de inactividad.
// (El plan gratuito de Supabase no permite configurar el JWT expiry desde el dashboard.)
const SESSION_MAX_AGE_MS = 7 * 60 * 60 * 1000;
const COOKIE_STARTED = "sh_session_started";
const COOKIE_ACTIVITY = "sh_last_activity";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: Array<{
            name: string;
            value: string;
            options?: CookieOptions;
          }>
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  // /auth/set-password es pública: la propia página valida la sesión del
  // enlace y muestra "Enlace inválido" si no la hay. Sin esto, el middleware
  // redirige a /login antes de que la persona vea ese mensaje.
  const publicRoutes = ["/login", "/auth/callback", "/auth/set-password"];
  const isPublicRoute = publicRoutes.some((r) => pathname.startsWith(r));

  // ── Expiración forzada por uso prolongado / inactividad (7h) ─────────────
  let sessionExpired = false;
  if (user) {
    const now = Date.now();
    const started = Number(request.cookies.get(COOKIE_STARTED)?.value);
    const lastActivity = Number(request.cookies.get(COOKIE_ACTIVITY)?.value);

    if (
      (started && now - started > SESSION_MAX_AGE_MS) ||
      (lastActivity && now - lastActivity > SESSION_MAX_AGE_MS)
    ) {
      sessionExpired = true;
      await supabase.auth.signOut();
      supabaseResponse.cookies.delete(COOKIE_STARTED);
      supabaseResponse.cookies.delete(COOKIE_ACTIVITY);
    } else {
      const cookieOpts = {
        path: "/",
        maxAge: SESSION_MAX_AGE_MS / 1000,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax" as const,
      };
      if (!started) supabaseResponse.cookies.set(COOKIE_STARTED, String(now), cookieOpts);
      supabaseResponse.cookies.set(COOKIE_ACTIVITY, String(now), cookieOpts);
    }
  }

  if ((!user || sessionExpired) && !isPublicRoute) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("redirectTo", pathname);
    if (sessionExpired) loginUrl.searchParams.set("error", "sesion_expirada");
    return NextResponse.redirect(loginUrl);
  }

  if (user && !sessionExpired && pathname === "/login") {
    const tableroUrl = request.nextUrl.clone();
    tableroUrl.pathname = "/tablero";
    tableroUrl.searchParams.delete("redirectTo");
    return NextResponse.redirect(tableroUrl);
  }

  return supabaseResponse;
}
