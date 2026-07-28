/**
 * Queries para Engagements y cobertura.
 * Consume la vista cobertura_engagement del schema de Supabase.
 */
import type { TypedSupabaseClient } from "@/lib/supabase/types";
import type { Engagement, CoberturaEngagement, TipoEngagement } from "@/lib/types/database";

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
 * Lista de engagements ACTIVOS (estado = 'activo') con indicador de cobertura.
 * Excluye proyectos cuya fecha de fin efectiva sea < hoy - 30 días y los archivados ('terminado').
 */
export async function fetchEngagementsConCobertura(
  supabase: TypedSupabaseClient
): Promise<{ data: EngagementConCobertura[]; error: string | null }> {
  const cutoff = cutoffFecha();

  const { data: engagements, error: engError } = await supabase
    .from("engagement")
    .select("*")
    .eq("estado", "activo")
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
 * Actualiza el estado de un engagement ('activo' | 'terminado').
 * 'terminado' = archivado: desaparece de tablero/inicio/vista principal (filtran por 'activo').
 */
export async function cambiarEstadoEngagement(
  supabase: TypedSupabaseClient,
  id: string,
  nuevoEstado: "activo" | "terminado"
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("engagement")
    .update({ estado: nuevoEstado } as never)
    .eq("id", id);
  return { error: error?.message ?? null };
}

/**
 * Actualiza el tipo de un engagement. Uso principal: confirmar 'posibles_proyectos' → 'proyecto'.
 */
export async function cambiarTipoEngagement(
  supabase: TypedSupabaseClient,
  id: string,
  nuevoTipo: TipoEngagement
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("engagement")
    .update({ tipo: nuevoTipo } as never)
    .eq("id", id);
  return { error: error?.message ?? null };
}

/**
 * Engagements archivados manualmente (estado = 'terminado'). Sin paginar: uso en tab "Archivo Histórico".
 */
export async function fetchEngagementsHistoricos(
  supabase: TypedSupabaseClient
): Promise<{ data: Engagement[]; error: string | null }> {
  const { data, error } = await supabase
    .from("engagement")
    .select("*")
    .eq("estado", "terminado")
    .eq("is_deleted", false)
    .order("updated_at", { ascending: false });

  if (error) return { data: [], error: error.message };
  return { data: (data ?? []) as Engagement[], error: null };
}

function diaAntes(fecha: string): string {
  const d = new Date(fecha + "T00:00:00");
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function diaDespues(fecha: string): string {
  const d = new Date(fecha + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Agrega una persona a un cargo/semana específica del Resumen de Proyectos
 * (edición inline). Inserta una asignación nueva acotada solo a esa semana.
 */
export async function agregarAsignacionSemana(
  // Cliente `any`: mismo patrón que AsignacionPersonaModal.tsx/PanelFitAsignacion.tsx
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  params: {
    engagementId: string;
    requerimientoId: string | null;
    personaId: string;
    cargo: string;
    pctDedicacion: number;
    estadoStaffing: "CONFIRMADO" | "PLAN";
    semanaInicio: string;
    semanaFin: string;
  }
): Promise<{ error: string | null }> {
  const { error } = await sb.from("asignacion").insert({
    engagement_id: params.engagementId,
    requerimiento_id: params.requerimientoId,
    persona_id: params.personaId,
    cargo_al_momento: params.cargo,
    pct_dedicacion: params.pctDedicacion,
    estado: "activa",
    estado_staffing: params.estadoStaffing,
    fecha_inicio: params.semanaInicio,
    fecha_fin: params.semanaFin,
  });
  return { error: error?.message ?? null };
}

/**
 * Quita a una persona de una semana específica del Resumen de Proyectos,
 * recortando (split) la asignación existente en vez de borrar todo su rango:
 * el resto de las semanas fuera de la editada se conservan intactas.
 */
export async function quitarAsignacionSemana(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  asignacion: {
    id: string;
    engagementId: string;
    requerimientoId: string | null;
    personaId: string;
    cargo: string;
    pctDedicacion: number;
    estadoStaffing: "CONFIRMADO" | "PLAN";
    fechaInicio: string;
    fechaFin: string | null;
  },
  semana: { inicio: string; fin: string }
): Promise<{ error: string | null }> {
  const partesRestantes: { inicio: string; fin: string | null }[] = [];

  if (asignacion.fechaInicio < semana.inicio) {
    partesRestantes.push({ inicio: asignacion.fechaInicio, fin: diaAntes(semana.inicio) });
  }
  if (asignacion.fechaFin === null || asignacion.fechaFin > semana.fin) {
    partesRestantes.push({ inicio: diaDespues(semana.fin), fin: asignacion.fechaFin });
  }

  const { error: delError } = await sb.from("asignacion").delete().eq("id", asignacion.id);
  if (delError) return { error: delError.message };

  if (partesRestantes.length > 0) {
    const inserts = partesRestantes.map((p) => ({
      engagement_id: asignacion.engagementId,
      requerimiento_id: asignacion.requerimientoId,
      persona_id: asignacion.personaId,
      cargo_al_momento: asignacion.cargo,
      pct_dedicacion: asignacion.pctDedicacion,
      estado: "activa",
      estado_staffing: asignacion.estadoStaffing,
      fecha_inicio: p.inicio,
      fecha_fin: p.fin,
    }));
    const { error: insError } = await sb.from("asignacion").insert(inserts);
    if (insError) return { error: insError.message };
  }

  return { error: null };
}

export interface AsignacionActual {
  id: string;
  personaId: string;
  estadoStaffing: "CONFIRMADO" | "PLAN";
  fechaInicio: string;
  fechaFin: string | null;
}

/**
 * Punto de entrada único de la celda editable del Resumen de Proyectos:
 * recibe quiénes están HOY (actuales) y quiénes deberían quedar (deseados)
 * para un cargo/semana, y aplica la diferencia (agregar/quitar) sobre esa
 * semana puntual, reutilizando agregarAsignacionSemana/quitarAsignacionSemana.
 */
export async function actualizarAsignacionSemana(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  params: {
    engagementId: string;
    requerimientoId: string | null;
    cargo: string;
    pctDedicacion: number;
    semana: { inicio: string; fin: string };
    actuales: AsignacionActual[];
    deseados: { personaId: string; estado: "CONFIRMADO" | "PLAN" }[];
    /** Nombre a mostrar del usuario que edita (para resumen_proyectos_log) */
    actorNombre?: string;
  }
): Promise<{ error: string | null }> {
  const { engagementId, requerimientoId, cargo, pctDedicacion, semana, actuales, deseados, actorNombre } = params;
  let huboCambios = false;

  for (const actual of actuales) {
    const sigueIgual = deseados.some(
      (d) => d.personaId === actual.personaId && d.estado === actual.estadoStaffing
    );
    if (sigueIgual) continue;

    const { error } = await quitarAsignacionSemana(
      sb,
      {
        id: actual.id,
        engagementId,
        requerimientoId,
        personaId: actual.personaId,
        cargo,
        pctDedicacion,
        estadoStaffing: actual.estadoStaffing,
        fechaInicio: actual.fechaInicio,
        fechaFin: actual.fechaFin,
      },
      semana
    );
    if (error) return { error };
    huboCambios = true;
  }

  for (const deseado of deseados) {
    const yaEstaba = actuales.some(
      (a) => a.personaId === deseado.personaId && a.estadoStaffing === deseado.estado
    );
    if (yaEstaba) continue;

    const { error } = await agregarAsignacionSemana(sb, {
      engagementId,
      requerimientoId,
      personaId: deseado.personaId,
      cargo,
      pctDedicacion,
      estadoStaffing: deseado.estado,
      semanaInicio: semana.inicio,
      semanaFin: semana.fin,
    });
    if (error) return { error };
    huboCambios = true;
  }

  if (huboCambios && actorNombre) {
    await sb.from("resumen_proyectos_log").insert({
      actor_nombre: actorNombre,
      engagement_id: engagementId,
      cargo: cargo || null,
    });
  }

  return { error: null };
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
