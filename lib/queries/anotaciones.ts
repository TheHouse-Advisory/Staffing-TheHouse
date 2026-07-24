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
      autor_id: anotacion.autor_id ?? null,
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
  cambios: Partial<Pick<Anotacion, "titulo" | "contenido" | "categoria" | "folder_id">>
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

export async function deleteAnotacion(
  supabase: any,
  id: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("anotacion").delete().eq("id", id);
  return { error: error?.message ?? null };
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

export async function deleteAnotacionFolder(
  supabase: any,
  id: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("anotacion_folders").delete().eq("id", id);
  return { error: error?.message ?? null };
}
