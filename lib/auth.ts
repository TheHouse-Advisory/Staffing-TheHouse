/**
 * Helpers de autenticación para Server Components / Server Actions.
 */
import { createClient, createAnyClient } from "@/lib/supabase/server";
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
 *
 * Flujo de vinculación automática (primer login):
 *   1. Buscar persona por auth_user_id  → encontrada: ok
 *   2. Si no, buscar por email           → encontrada: guardar auth_user_id y continuar
 *   3. Si no, el email no está registrado → signOut + redirect /login?error=no_persona
 */
export async function requireAuth(): Promise<AuthUser> {
  const supabase = await createClient();
  const db = await createAnyClient(); // para queries DB sin errores de tipo

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/login");
  }

  // ── Intento 1: buscar por auth_user_id (sesiones previas ya vinculadas) ──
  let { data: personaData } = await db
    .from("persona")
    .select("*")
    .eq("auth_user_id", user.id)
    .single();

  // ── Intento 2: primer login → vincular por email ──────────────────────────
  if (!personaData && user.email) {
    const { data: byEmail } = await db
      .from("persona")
      .select("*")
      .eq("email", user.email.toLowerCase())
      .is("auth_user_id", null)   // solo personas aún no vinculadas
      .single();

    if (byEmail) {
      // Guardar el auth_user_id para futuros logins
      await db
        .from("persona")
        .update({ auth_user_id: user.id })
        .eq("id", byEmail.id);

      personaData = { ...byEmail, auth_user_id: user.id };
    }
  }

  // ── Sin persona registrada → rechazar ─────────────────────────────────────
  if (!personaData) {
    await supabase.auth.signOut();
    redirect("/login?error=no_persona");
  }

  const persona = personaData as Persona;

  // ── Sin rol de sistema → persona existe pero no tiene acceso a la plataforma
  if (!persona.rol_sistema) {
    await supabase.auth.signOut();
    redirect("/login?error=sin_acceso");
  }

  // ── Acceso suspendido por un administrador ────────────────────────────────
  if (persona.acceso_estado === "suspendida") {
    await supabase.auth.signOut();
    redirect("/login?error=acceso_suspendido");
  }

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
