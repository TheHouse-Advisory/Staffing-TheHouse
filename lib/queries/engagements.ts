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

/** Fecha de corte: hoy - 30 días (YYYY-MM-DD). */
function cutoffFecha(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().split("T")[0];
}

/**
 * Filtro PostgREST para engagements ACTUALES/FUTUROS:
 * fecha efectiva >= cutoff  O  sin fecha de fin.
 * Fecha efectiva = fecha_fin_real ?? fecha_fin_estimada.
 */
function filtroActuales(cutoff: string): string {
  return [
    `fecha_fin_real.gte.${cutoff}`,
    `and(fecha_fin_real.is.null,fecha_fin_estimada.gte.${cutoff})`,
    `and(fecha_fin_real.is.null,fecha_fin_estimada.is.null)`,
  ].join(",");
}

/**
 * Lista de engagements activos/propuestas ACTUALES/FUTUROS con indicador de cobertura.
 * Excluye proyectos cuya fecha de fin efectiva sea < hoy - 30 días.
 */
export async function fetchEngagementsConCobertura(
  supabase: TypedSupabaseClient
): Promise<{ data: EngagementConCobertura[]; error: string | null }> {
  const cutoff = cutoffFecha();

  const { data: engagements, error: engError } = await supabase
    .from("engagement")
    .select("*")
    .in("estado", ["propuesta", "activo", "pausado"])
    .eq("is_deleted", false)
    .or(filtroActuales(cutoff))
    .order("created_at", { ascending: false });

  if (engError) return { data: [], error: engError.message };
  if (!engagements || engagements.length === 0) return { data: [], error: null };

  const engIds = (engagements as Engagement[]).map((e) => e.id);

  const { data: coberturaRaw, error: cobError } = await supabase
    .from("cobertura_engagement")
    .select("engagement_id, pct_descubierto")
    .in("engagement_id", engIds);

  if (cobError) return { data: [], error: cobError.message };

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

const PAGE_SIZE = 20;

export interface PaginaHistorico {
  data: Engagement[];
  total: number;
  pagina: number;
  totalPaginas: number;
  error: string | null;
}

/**
 * Engagements PASADOS (fecha efectiva < hoy - 30 días), paginados de 20 en 20.
 * Excluye is_deleted. Acepta búsqueda por nombre/cliente.
 */
export async function fetchEngagementsPasados(
  supabase: TypedSupabaseClient,
  pagina = 1,
  busqueda = ""
): Promise<PaginaHistorico> {
  const cutoff = cutoffFecha();
  const desde = (pagina - 1) * PAGE_SIZE;

  // Engagements donde la fecha efectiva < cutoff:
  // fecha_fin_real < cutoff  O  (fecha_fin_real IS NULL AND fecha_fin_estimada < cutoff)
  const filtroPasados = [
    `fecha_fin_real.lt.${cutoff}`,
    `and(fecha_fin_real.is.null,fecha_fin_estimada.lt.${cutoff})`,
  ].join(",");

  let query = supabase
    .from("engagement")
    .select("*", { count: "exact" })
    .eq("is_deleted", false)
    .or(filtroPasados)
    .order("fecha_fin_real", { ascending: false, nullsFirst: false });

  if (busqueda.trim()) {
    const t = busqueda.trim();
    query = query.or(
      `nombre.ilike.%${t}%,cliente.ilike.%${t}%,codigo.ilike.%${t}%,descripcion.ilike.%${t}%`
    );
  }

  const { data, count, error } = await query.range(desde, desde + PAGE_SIZE - 1);

  if (error) return { data: [], total: 0, pagina, totalPaginas: 0, error: error.message };

  const total = count ?? 0;
  return {
    data: (data ?? []) as Engagement[],
    total,
    pagina,
    totalPaginas: Math.ceil(total / PAGE_SIZE),
    error: null,
  };
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
