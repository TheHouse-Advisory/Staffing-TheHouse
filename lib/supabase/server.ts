/**
 * Cliente de Supabase para el SERVER (Server Components, Route Handlers,
 * Server Actions). Lee/escribe cookies mediante next/headers.
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "@/lib/types/database";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: Array<{
            name: string;
            value: string;
            options?: CookieOptions;
          }>
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll desde Server Components: el middleware lo maneja
          }
        },
      },
    }
  );
}

/** Cliente sin tipos estrictos — para queries donde el typed client infiere `never`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createAnyClient(): Promise<any> {
  return createClient();
}

/**
 * Cliente con Service Role REAL — autenticado únicamente con la service
 * role key, sin sesión de usuario. Salta RLS y los triggers de seguridad
 * (auth.uid() = NULL). Úsalo solo en Server Actions, después de validar
 * permisos con requireAdmin(). NUNCA exponer al browser.
 */
export function createServiceClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
