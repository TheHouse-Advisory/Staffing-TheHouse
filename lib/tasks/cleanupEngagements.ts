import type { TypedSupabaseClient } from "@/lib/supabase/types";

/** Elimina permanentemente engagements en papelera con más de 30 días. */
export async function limpiarEngagementsCaducados(supabase: TypedSupabaseClient) {
  const hace30Dias = new Date();
  hace30Dias.setDate(hace30Dias.getDate() - 30);
  await supabase
    .from("engagement")
    .delete()
    .eq("is_deleted", true)
    .lte("deleted_at", hace30Dias.toISOString());
}

/** Elimina permanentemente personas en papelera con más de 30 días. */
export async function limpiarPersonasCaducadas(supabase: TypedSupabaseClient) {
  const hace30Dias = new Date();
  hace30Dias.setDate(hace30Dias.getDate() - 30);
  await supabase
    .from("persona")
    .delete()
    .eq("is_deleted", true)
    .lte("deleted_at", hace30Dias.toISOString());
}

/** Días restantes antes de eliminación definitiva. */
export function diasRestantesPapelera(deletedAt: string): number {
  const eliminadoEn = new Date(deletedAt).getTime();
  const ahora = Date.now();
  const transcurridos = Math.floor((ahora - eliminadoEn) / 86_400_000);
  return Math.max(0, 30 - transcurridos);
}
