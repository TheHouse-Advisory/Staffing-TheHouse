/**
 * Server Actions para gestión de invitaciones de usuarios.
 *
 * Flujo de invitación:
 *  1. Admin crea/edita persona con un rol_sistema asignado.
 *  2. Server action valida que el caller es admin y llama a
 *     `supabase.auth.admin.inviteUserByEmail` con el service role key.
 *  3. Supabase envía un correo con un enlace único. El enlace pasa por
 *     /auth/callback y termina en /auth/set-password donde la persona
 *     define su contraseña.
 *  4. Logins posteriores se hacen con email + password en /login.
 *
 * Si el usuario de auth ya existe (p.ej. reenvío) se hace fallback a
 * `resetPasswordForEmail`, que envía un link de recuperación al mismo
 * destino — desde la UI ambos casos se ven igual ("revisa tu correo").
 */
"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import type { Persona } from "@/lib/types/database";

interface EnviarInvitacionInput {
  /** ID de la fila `persona` que recibirá la invitación. */
  personaId: string;
  /** Origen de la app (ej. "https://staffing.thehouse.cl") — viene del cliente. */
  origin: string;
}

interface EnviarInvitacionResult {
  ok: boolean;
  /** Mensaje listo para mostrar al admin. */
  message: string;
  /** "invitada" en el primer envío, "reset" si el usuario ya existía. */
  via?: "invitada" | "reset";
}

/**
 * Envía (o reenvía) una invitación a la persona indicada.
 *
 * - Si la persona no tiene auth user → envía invitación nativa de Supabase.
 * - Si ya existe en auth → envía link de recuperación de contraseña
 *   (mismo destino, mismo UX para la persona invitada).
 */
export async function enviarInvitacion({
  personaId,
  origin,
}: EnviarInvitacionInput): Promise<EnviarInvitacionResult> {
  await requireAdmin();

  const admin = await createAdminClient();

  const { data: personaRow, error: personaErr } = await admin
    .from("persona")
    .select("*")
    .eq("id", personaId)
    .single();

  if (personaErr || !personaRow) {
    return { ok: false, message: "Persona no encontrada." };
  }

  const persona = personaRow as Persona;

  if (!persona.rol_sistema) {
    return {
      ok: false,
      message:
        "La persona no tiene un rol asignado. Asigna un rol antes de invitarla.",
    };
  }

  if (!persona.activo) {
    return { ok: false, message: "La persona está desactivada." };
  }

  const redirectTo = `${origin.replace(/\/$/, "")}/auth/callback?next=${encodeURIComponent(
    "/auth/set-password"
  )}`;

  // Intento 1: invitación nativa (funciona si el auth user no existe aún).
  const { data: invited, error: inviteErr } =
    await admin.auth.admin.inviteUserByEmail(persona.email, { redirectTo });

  if (!inviteErr && invited?.user) {
    // Vincular auth_user_id si todavía no estaba asociado.
    // El cliente tipado infiere `never` en `.update()` (mismo issue que
    // el resto del proyecto resuelve con createAnyClient) → cast puntual.
    if (!persona.auth_user_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("persona") as any)
        .update({ auth_user_id: invited.user.id })
        .eq("id", persona.id);
    }
    return {
      ok: true,
      via: "invitada",
      message: `Invitación enviada a ${persona.email}.`,
    };
  }

  // Si el usuario ya existe en auth, caemos al flujo de recuperación.
  const alreadyExists =
    (inviteErr as { code?: string } | null)?.code === "email_exists" ||
    /already|registered|exists/i.test(inviteErr?.message ?? "");

  if (!alreadyExists) {
    return {
      ok: false,
      message: inviteErr?.message ?? "No se pudo enviar la invitación.",
    };
  }

  const { error: resetErr } = await admin.auth.resetPasswordForEmail(
    persona.email,
    { redirectTo }
  );

  if (resetErr) {
    return {
      ok: false,
      message: resetErr.message ?? "No se pudo enviar el enlace.",
    };
  }

  return {
    ok: true,
    via: "reset",
    message: `Enlace de acceso reenviado a ${persona.email}.`,
  };
}
