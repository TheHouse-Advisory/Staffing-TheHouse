/**
 * Helpers de autenticación para Server Components / Server Actions.
 */
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { Persona, RolSistema } from "@/lib/types/database";

export interface AuthUser {
  authId: string;
  email: string;
  persona: Persona;
  rol: RolSistema | null;
}

/**
 * Obtiene el usuario autenticado con su persona y rol.
 * Redirige a /login si no hay sesión activa.
 */
export async function requireAuth(): Promise<AuthUser> {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/login");
  }

  const { data: personaData, error: personaError } = await supabase
    .from("persona")
    .select("*")
    .eq("auth_user_id", user.id)
    .single();

  if (personaError || !personaData) {
    await supabase.auth.signOut();
    redirect("/login?error=no_persona");
  }

  const persona = personaData as Persona;

  return {
    authId: user.id,
    email: user.email ?? "",
    persona,
    rol: persona.rol_sistema,
  };
}

/**
 * Requiere que el usuario tenga rol 'admin'.
 */
export async function requireAdmin(): Promise<AuthUser> {
  const authUser = await requireAuth();
  if (authUser.rol !== "admin") {
    redirect("/tablero?error=sin_permisos");
  }
  return authUser;
}

/**
 * Versión no-redirect — para layouts con contenido condicional por rol.
 */
export async function getAuthUser(): Promise<AuthUser | null> {
  try {
    return await requireAuth();
  } catch {
    return null;
  }
}
