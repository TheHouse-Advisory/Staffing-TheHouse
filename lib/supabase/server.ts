/**
 * Cliente de Supabase para el SERVER (Server Components, Route Handlers,
 * Server Actions). Lee/escribe cookies mediante next/headers.
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
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

/** Cliente con Service Role para operaciones admin. NUNCA exponer al cliente. */
export async function createAdminClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
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
            // idem
          }
        },
      },
    }
  );
}
