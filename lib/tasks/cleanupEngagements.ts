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

/**
 * Elimina asignaciones huérfanas: vinculadas a un engagement en papelera
 * (is_deleted = true) o a un engagement_id que ya no existe.
 * No toca asignaciones de engagements archivados (estado = 'terminado')
 * ya que esas son historial válido.
 */
export async function limpiarAsignacionesHuerfanas(supabase: TypedSupabaseClient) {
  const { data: papelera } = await supabase.from("engagement").select("id").eq("is_deleted", true);
  const idsPapelera = (papelera ?? []).map((e: { id: string }) => e.id);
  if (idsPapelera.length > 0) {
    await supabase.from("asignacion").delete().in("engagement_id", idsPapelera);
  }

  const { data: asigs } = await supabase.from("asignacion").select("id, engagement_id").not("engagement_id", "is", null);
  const { data: engs } = await supabase.from("engagement").select("id");
  const engIds = new Set((engs ?? []).map((e: { id: string }) => e.id));
  const huerfanas = ((asigs ?? []) as { id: string; engagement_id: string }[])
    .filter((a) => !engIds.has(a.engagement_id))
    .map((a) => a.id);
  if (huerfanas.length > 0) {
    await supabase.from("asignacion").delete().in("id", huerfanas);
  }
}

/** Días restantes antes de eliminación definitiva. */
export function diasRestantesPapelera(deletedAt: string): number {
  const eliminadoEn = new Date(deletedAt).getTime();
  const ahora = Date.now();
  const transcurridos = Math.floor((ahora - eliminadoEn) / 86_400_000);
  return Math.max(0, 30 - transcurridos);
}
