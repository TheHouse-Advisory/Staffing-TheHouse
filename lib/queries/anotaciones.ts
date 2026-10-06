import type { TypedSupabaseClient } from "@/lib/supabase/types";
import type { Anotacion, AnotacionFolder } from "@/lib/types/database";

export async function getAnotaciones(
  supabase: TypedSupabaseClient
): Promise<Anotacion[]> {
  const { data, error } = await supabase
    .from("anotacion")
    .select("*")
    .order("created_at", { ascending: false });

  if (error || !data) return [];
  return data as Anotacion[];
}

/** Resuelve el nombre a mostrar del usuario autenticado actual (persona.nombre + apellido, o email). */
export async function getNombreUsuarioActual(supabase: any): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: persona } = await supabase
      .from("persona")
      .select("nombre, apellido")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (persona?.nombre) {
      return persona.apellido ? `${persona.nombre} ${persona.apellido}` : persona.nombre;
    }
    return user.email?.split("@")[0] ?? null;
  } catch {
    return null;
  }
}

/** persona.id del usuario autenticado (para saber si es autor de una nota). */
export async function getPersonaIdActual(supabase: any): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase
      .from("persona")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    return data?.id ?? null;
  } catch {
    return null;
  }
}

export async function createAnotacion(
  supabase: any,
  anotacion: Omit<Anotacion, "id" | "created_at" | "creado_por" | "editado_por">
): Promise<{ data: Anotacion | null; error: string | null }> {
  const usuarioActual = await getNombreUsuarioActual(supabase);

  const { data, error } = await supabase
    .from("anotacion")
    .insert({
      titulo: anotacion.titulo,
      contenido: anotacion.contenido,
      categoria: anotacion.categoria ?? null,
      autor_id: anotacion.autor_id ?? null, // el trigger lo reemplaza por el usuario actual
      folder_id: anotacion.folder_id ?? null,
      es_privada: anotacion.es_privada ?? false,
      creado_por: usuarioActual,
      editado_por: usuarioActual,
    })
    .select()
    .single();

  return { data: (data as Anotacion) ?? null, error: error?.message ?? null };
}

export async function updateAnotacion(
  supabase: any,
  id: string,
  cambios: Partial<Pick<Anotacion, "titulo" | "contenido" | "categoria" | "folder_id" | "es_privada">>
): Promise<{ error: string | null }> {
  const usuarioActual = await getNombreUsuarioActual(supabase);

  const { error } = await supabase
    .from("anotacion")
    .update({
      ...cambios,
      editado_por: usuarioActual,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  return { error: error?.message ?? null };
}

/** Envía la anotación a la papelera (soft delete). */
export async function deleteAnotacion(
  supabase: any,
  id: string
): Promise<{ error: string | null; deleted_at: string }> {
  const deleted_at = new Date().toISOString();
  const { error } = await supabase.from("anotacion").update({ deleted_at }).eq("id", id);
  return { error: error?.message ?? null, deleted_at };
}

/** Restaura una anotación de la papelera (folder_id null si su carpeta ya no existe). */
export async function restoreAnotacion(
  supabase: any,
  id: string,
  folder_id: string | null
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("anotacion").update({ deleted_at: null, folder_id }).eq("id", id);
  return { error: error?.message ?? null };
}

/** Borrado definitivo de una anotación. */
export async function purgeAnotacion(
  supabase: any,
  id: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("anotacion").delete().eq("id", id);
  return { error: error?.message ?? null };
}

/** Borra definitivamente lo que lleva en la papelera desde antes de `corte` (RLS limita a lo propio). */
export async function purgeAnotacionesVencidas(supabase: any, corte: string): Promise<void> {
  await supabase.from("anotacion").delete().lt("deleted_at", corte);
  await supabase.from("anotacion_folders").delete().lt("deleted_at", corte);
}

// ─────────────────────────────────────────────────────────────
//  Carpetas (anotacion_folders)
// ─────────────────────────────────────────────────────────────

export async function getAnotacionFolders(
  supabase: TypedSupabaseClient
): Promise<AnotacionFolder[]> {
  const { data, error } = await supabase
    .from("anotacion_folders")
    .select("*")
    .order("nombre", { ascending: true });

  if (error || !data) return [];
  return data as AnotacionFolder[];
}

export async function createAnotacionFolder(
  supabase: any,
  folder: { nombre: string; parent_id?: string | null }
): Promise<{ data: AnotacionFolder | null; error: string | null }> {
  const usuarioActual = await getNombreUsuarioActual(supabase);

  const { data, error } = await supabase
    .from("anotacion_folders")
    .insert({
      nombre: folder.nombre,
      parent_id: folder.parent_id ?? null,
      creado_por: usuarioActual,
    })
    .select()
    .single();

  return { data: (data as AnotacionFolder) ?? null, error: error?.message ?? null };
}

/** Envía carpetas a la papelera (la carpeta y sus subcarpetas, con el mismo sello). */
export async function deleteAnotacionFolder(
  supabase: any,
  ids: string[]
): Promise<{ error: string | null; deleted_at: string }> {
  const deleted_at = new Date().toISOString();
  const { error } = await supabase.from("anotacion_folders").update({ deleted_at }).in("id", ids);
  return { error: error?.message ?? null, deleted_at };
}

/** Restaura carpetas de la papelera; `rootId` vuelve a raíz si su padre ya no existe. */
export async function restoreAnotacionFolders(
  supabase: any,
  ids: string[],
  rootId: string,
  rootParentId: string | null
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("anotacion_folders").update({ deleted_at: null }).in("id", ids);
  if (error) return { error: error.message };
  const { error: e2 } = await supabase.from("anotacion_folders").update({ parent_id: rootParentId }).eq("id", rootId);
  return { error: e2?.message ?? null };
}

/** Borrado definitivo de una carpeta (subcarpetas en cascada; sus anotaciones quedan sin carpeta). */
export async function purgeAnotacionFolder(
  supabase: any,
  id: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("anotacion_folders").delete().eq("id", id);
  return { error: error?.message ?? null };
}
