/**
 * Server Actions para la gestión de ACCESOS al sistema.
 *
 * Separación de responsabilidades:
 *  - Crear una "persona" (recurso de staffing) NO da acceso al sistema.
 *  - El acceso se gestiona aparte, desde la página /accesos, y siempre
 *    pasa por estas server actions.
 *
 * Toda mutación de rol/acceso:
 *  1. valida con requireAdmin() que quien llama es administrador, y
 *  2. usa el service_role (createServiceClient) para escribir en la BD.
 *
 * Defensa en profundidad: aunque alguien saltara el frontend, el trigger
 * `persona_guard_acceso` de la base de datos rechaza cambios de rol/acceso
 * que no provengan de un admin o del service_role.
 *
 * Flujo de invitación:
 *  1. Admin otorga acceso (asigna rol) → se envía un correo de invitación.
 *  2. El enlace pasa por /auth/callback y termina en /auth/set-password,
 *     donde la persona define su contraseña.
 *  3. Logins posteriores se hacen con email + contraseña en /login.
 *
 * Si el usuario de auth ya existe (p.ej. re-otorgar acceso) se hace
 * fallback a `resetPasswordForEmail`: mismo destino, misma UX.
 */
"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import type { Persona, RolSistema } from "@/lib/types/database";

const ROLES_VALIDOS: RolSistema[] = ["admin", "proposer"];

export interface ResultadoAccion {
  ok: boolean;
  /** Mensaje listo para mostrar al admin. */
  message: string;
  /** "invitada" en el primer envío, "reset" si el usuario ya existía. */
  via?: "invitada" | "reset";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceClient = any;

/**
 * Envía (o reenvía) el correo de invitación a una persona.
 * - Si el usuario de auth no existe → invitación nativa de Supabase.
 * - Si ya existe → enlace de recuperación de contraseña (mismo destino).
 */
async function enviarCorreoInvitacion(
  service: ServiceClient,
  persona: Persona,
  origin: string
): Promise<ResultadoAccion> {
  const redirectTo = `${origin.replace(/\/$/, "")}/auth/callback?next=${encodeURIComponent(
    "/auth/set-password"
  )}`;

  // Intento 1: invitación nativa (funciona si el auth user no existe aún).
  const { data: invited, error: inviteErr } =
    await service.auth.admin.inviteUserByEmail(persona.email, { redirectTo });

  if (!inviteErr && invited?.user) {
    if (!persona.auth_user_id) {
      await service
        .from("persona")
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

  const { error: resetErr } = await service.auth.resetPasswordForEmail(
    persona.email,
    { redirectTo }
  );

  if (resetErr) {
    return { ok: false, message: resetErr.message ?? "No se pudo enviar el enlace." };
  }

  return {
    ok: true,
    via: "reset",
    message: `Enlace de acceso enviado a ${persona.email}.`,
  };
}

/**
 * Otorga acceso al sistema a una persona existente: le asigna un rol,
 * marca la invitación como pendiente y envía el correo de invitación.
 */
export async function otorgarAcceso({
  personaId,
  rol,
  origin,
}: {
  personaId: string;
  rol: RolSistema;
  origin: string;
}): Promise<ResultadoAccion> {
  await requireAdmin();

  if (!ROLES_VALIDOS.includes(rol)) {
    return { ok: false, message: "Rol inválido." };
  }

  const service: ServiceClient = createServiceClient();

  const { data: personaRow, error } = await service
    .from("persona")
    .select("*")
    .eq("id", personaId)
    .single();

  if (error || !personaRow) {
    return { ok: false, message: "Persona no encontrada." };
  }

  const persona = personaRow as Persona;

  if (!persona.activo || persona.is_deleted) {
    return { ok: false, message: "La persona está inactiva." };
  }
  if (persona.rol_sistema) {
    return { ok: false, message: "La persona ya tiene un acceso asignado." };
  }

  const { error: updErr } = await service
    .from("persona")
    .update({ rol_sistema: rol, acceso_estado: "invitada" })
    .eq("id", persona.id);

  if (updErr) {
    return { ok: false, message: updErr.message };
  }

  return enviarCorreoInvitacion(service, persona, origin);
}

/** Reenvía el correo de invitación / enlace de acceso. */
export async function reenviarInvitacion({
  personaId,
  origin,
}: {
  personaId: string;
  origin: string;
}): Promise<ResultadoAccion> {
  await requireAdmin();

  const service: ServiceClient = createServiceClient();

  const { data: personaRow } = await service
    .from("persona")
    .select("*")
    .eq("id", personaId)
    .single();

  if (!personaRow) {
    return { ok: false, message: "Persona no encontrada." };
  }

  const persona = personaRow as Persona;

  if (!persona.rol_sistema) {
    return { ok: false, message: "La persona no tiene un acceso asignado." };
  }
  if (persona.acceso_estado === "suspendida") {
    return {
      ok: false,
      message: "El acceso está suspendido. Reactívalo antes de reenviar la invitación.",
    };
  }

  return enviarCorreoInvitacion(service, persona, origin);
}

/** Cambia el rol de una persona que ya tiene acceso al sistema. */
export async function cambiarRol({
  personaId,
  rol,
}: {
  personaId: string;
  rol: RolSistema;
}): Promise<ResultadoAccion> {
  const admin = await requireAdmin();

  if (!ROLES_VALIDOS.includes(rol)) {
    return { ok: false, message: "Rol inválido." };
  }
  if (personaId === admin.persona.id && rol !== "admin") {
    return {
      ok: false,
      message: "No puedes quitarte a ti mismo el rol de administrador.",
    };
  }

  const service: ServiceClient = createServiceClient();

  const { data: actual } = await service
    .from("persona")
    .select("rol_sistema")
    .eq("id", personaId)
    .single();

  if (!actual?.rol_sistema) {
    return { ok: false, message: "La persona no tiene un acceso asignado." };
  }

  const { error } = await service
    .from("persona")
    .update({ rol_sistema: rol })
    .eq("id", personaId);

  if (error) {
    return { ok: false, message: error.message };
  }

  return { ok: true, message: "Rol actualizado." };
}

/** Suspende el acceso de una persona (conserva el rol; no puede ingresar). */
export async function suspenderAcceso({
  personaId,
}: {
  personaId: string;
}): Promise<ResultadoAccion> {
  const admin = await requireAdmin();

  if (personaId === admin.persona.id) {
    return { ok: false, message: "No puedes suspender tu propio acceso." };
  }

  const service: ServiceClient = createServiceClient();

  const { data: actual } = await service
    .from("persona")
    .select("rol_sistema")
    .eq("id", personaId)
    .single();

  if (!actual?.rol_sistema) {
    return { ok: false, message: "La persona no tiene un acceso asignado." };
  }

  const { error } = await service
    .from("persona")
    .update({ acceso_estado: "suspendida" })
    .eq("id", personaId);

  if (error) {
    return { ok: false, message: error.message };
  }

  return { ok: true, message: "Acceso suspendido." };
}

/** Reactiva un acceso previamente suspendido. */
export async function reactivarAcceso({
  personaId,
}: {
  personaId: string;
}): Promise<ResultadoAccion> {
  await requireAdmin();

  const service: ServiceClient = createServiceClient();

  const { data: actual } = await service
    .from("persona")
    .select("rol_sistema")
    .eq("id", personaId)
    .single();

  if (!actual?.rol_sistema) {
    return { ok: false, message: "La persona no tiene un acceso asignado." };
  }

  const { error } = await service
    .from("persona")
    .update({ acceso_estado: "activa" })
    .eq("id", personaId);

  if (error) {
    return { ok: false, message: error.message };
  }

  return { ok: true, message: "Acceso reactivado." };
}

/**
 * Elimina por completo el acceso al sistema: quita el rol y el estado.
 * La persona sigue existiendo como recurso de staffing.
 */
export async function revocarAcceso({
  personaId,
}: {
  personaId: string;
}): Promise<ResultadoAccion> {
  const admin = await requireAdmin();

  if (personaId === admin.persona.id) {
    return { ok: false, message: "No puedes quitarte tu propio acceso." };
  }

  const service: ServiceClient = createServiceClient();

  const { error } = await service
    .from("persona")
    .update({ rol_sistema: null, acceso_estado: null })
    .eq("id", personaId);

  if (error) {
    return { ok: false, message: error.message };
  }

  return { ok: true, message: "Acceso eliminado." };
}

/**
 * Marca la cuenta como 'activa' tras definir la contraseña.
 * Se invoca desde /auth/set-password. Best-effort: si falla, el admin
 * puede ver a la persona como "pendiente" y reenviar la invitación.
 */
export async function confirmarCuenta(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) return;

  const service: ServiceClient = createServiceClient();

  // Solo afecta a personas en estado 'invitada' → no reactiva suspendidas.
  await service
    .from("persona")
    .update({ acceso_estado: "activa", auth_user_id: user.id })
    .eq("email", user.email.toLowerCase())
    .eq("acceso_estado", "invitada");
}
