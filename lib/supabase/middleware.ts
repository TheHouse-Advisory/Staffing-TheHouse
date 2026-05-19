/**
 * Utilidad para refrescar la sesión en el middleware de Next.js.
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/types/database";

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

  if (!user && !isPublicRoute) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user && pathname === "/login") {
    const tableroUrl = request.nextUrl.clone();
    tableroUrl.pathname = "/tablero";
    tableroUrl.searchParams.delete("redirectTo");
    return NextResponse.redirect(tableroUrl);
  }

  return supabaseResponse;
}
