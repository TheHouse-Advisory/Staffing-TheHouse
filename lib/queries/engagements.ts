/**
 * Queries para Engagements y cobertura.
 * Consume la vista cobertura_engagement del schema de Supabase.
 */
import type { TypedSupabaseClient } from "@/lib/supabase/types";
import type { Engagement, CoberturaEngagement } from "@/lib/types/database";

export interface EngagementConCobertura extends Engagement {
  tiene_alerta: boolean;
  requerimientos_total: number;
  requerimientos_cubiertos: number;
}

/**
 * Lista de engagements activos/propuestas con indicador de cobertura.
 */
export async function fetchEngagementsConCobertura(
  supabase: TypedSupabaseClient
): Promise<{ data: EngagementConCobertura[]; error: string | null }> {
  const { data: engagements, error: engError } = await supabase
    .from("engagement")
    .select("*")
    .in("estado", ["propuesta", "activo", "pausado"])
    .order("created_at", { ascending: false });

  if (engError) return { data: [], error: engError.message };
  if (!engagements || engagements.length === 0) return { data: [], error: null };

  const engIds = (engagements as Engagement[]).map((e) => e.id);

  const { data: coberturaRaw, error: cobError } = await supabase
    .from("cobertura_engagement")
    .select("engagement_id, pct_descubierto")
    .in("engagement_id", engIds);

  if (cobError) return { data: [], error: cobError.message };

  // Indexar cobertura por engagement_id
  const coberturaMap = new Map<
    string,
    { tiene_alerta: boolean; total: number; cubiertos: number }
  >();

  for (const row of (coberturaRaw ?? []) as Pick<
    CoberturaEngagement,
    "engagement_id" | "pct_descubierto"
  >[]) {
    const current = coberturaMap.get(row.engagement_id) ?? {
      tiene_alerta: false,
      total: 0,
      cubiertos: 0,
    };
    current.total += 1;
    if (Number(row.pct_descubierto) <= 0) current.cubiertos += 1;
    else current.tiene_alerta = true;
    coberturaMap.set(row.engagement_id, current);
  }

  const result: EngagementConCobertura[] = (engagements as Engagement[]).map(
    (e) => {
      const cob = coberturaMap.get(e.id);
      return {
        ...e,
        tiene_alerta: cob?.tiene_alerta ?? false,
        requerimientos_total: cob?.total ?? 0,
        requerimientos_cubiertos: cob?.cubiertos ?? 0,
      };
    }
  );

  return { data: result, error: null };
}

/**
 * Cobertura detallada de un engagement específico.
 */
export async function fetchCoberturaEngagement(
  supabase: TypedSupabaseClient,
  engagementId: string
): Promise<{ data: CoberturaEngagement[]; error: string | null }> {
  const { data, error } = await supabase
    .from("cobertura_engagement")
    .select("*")
    .eq("engagement_id", engagementId)
    .order("fase_nombre");

  if (error) return { data: [], error: error.message };
  return { data: (data as CoberturaEngagement[]) ?? [], error: null };
}
