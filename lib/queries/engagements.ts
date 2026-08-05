/**
 * Queries para Engagements y cobertura.
 * Consume la vista cobertura_engagement del schema de Supabase.
 */
import { startOfISOWeek, format } from "date-fns";
import type { TypedSupabaseClient } from "@/lib/supabase/types";
import type { Engagement, CoberturaEngagement, TipoEngagement } from "@/lib/types/database";
import { calculateBusinessDays } from "@/lib/utils/date-utils";
import { getExperienciaDinamica, type ExperienciaDinamica } from "@/lib/queries/personas";

/**
 * Última fecha real en que se modificó un dato del Tablero (engagement, asignación, ausencia, etc.).
 * Usa la función ultima_actualizacion_real() en Supabase, que excluye cambios sin sesión
 * (ej. scripts/SQL directo) y los de un perfil específico (ver migración para el default).
 */
export async function fetchUltimaActualizacionReal(
  supabase: TypedSupabaseClient
): Promise<Date | null> {
  const { data, error } = await (supabase as any).rpc("ultima_actualizacion_real");
  if (error || !data) return null;
  return new Date(data);
}

export interface EngagementConCobertura extends Engagement {
  tiene_alerta: boolean;
  requerimientos_total: number;
  requerimientos_cubiertos: number;
}

/** Inicio de la semana ISO actual (lunes), YYYY-MM-DD. Corte entre "vigente" y "vencido". */
function inicioSemana(): string {
  return format(startOfISOWeek(new Date()), "yyyy-MM-dd");
}

/**
 * Filtro PostgREST para engagements VIGENTES (no vencidos):
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
 * Filtro PostgREST para engagements VENCIDOS: fecha efectiva < cutoff.
 * Fecha efectiva = fecha_fin_real ?? fecha_fin_estimada. Sin fecha de fin → nunca vencido.
 */
function filtroVencidos(cutoff: string): string {
  return [
    `fecha_fin_real.lt.${cutoff}`,
    `and(fecha_fin_real.is.null,fecha_fin_estimada.lt.${cutoff})`,
  ].join(",");
}

/**
 * Lista de engagements ACTIVOS (estado = 'activo') con indicador de cobertura.
 * Excluye proyectos vencidos (fecha de fin efectiva < inicio de esta semana) y los archivados ('terminado').
 */
export async function fetchEngagementsConCobertura(
  supabase: TypedSupabaseClient
): Promise<{ data: EngagementConCobertura[]; error: string | null }> {
  const cutoff = inicioSemana();

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
 * Engagements PASADOS (fecha efectiva < inicio de esta semana), paginados de 20 en 20.
 * Excluye is_deleted. Acepta búsqueda por nombre/cliente.
 */
export async function fetchEngagementsPasados(
  supabase: TypedSupabaseClient,
  pagina = 1,
  busqueda = ""
): Promise<PaginaHistorico> {
  const cutoff = inicioSemana();
  const desde = (pagina - 1) * PAGE_SIZE;

  let query = supabase
    .from("engagement")
    .select("*", { count: "exact" })
    .eq("is_deleted", false)
    .or(filtroVencidos(cutoff))
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
 * Engagements del "Archivo Histórico": archivados manualmente (estado = 'terminado')
 * O cuya fecha de fin efectiva ya pasó (< inicio de esta semana), sin importar el estado.
 * Sin paginar: uso en tab "Archivo Histórico".
 */
export async function fetchEngagementsHistoricos(
  supabase: TypedSupabaseClient
): Promise<{ data: Engagement[]; error: string | null }> {
  const cutoff = inicioSemana();
  const { data, error } = await supabase
    .from("engagement")
    .select("*")
    .eq("is_deleted", false)
    .or([`estado.eq.terminado`, filtroVencidos(cutoff)].join(","))
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

export interface AsignacionEngagementRow {
  id: string;
  persona_id: string;
  requerimiento_id: string | null;
  cargo_al_momento: string | null;
  pct_dedicacion: number;
  fecha_inicio: string;
  fecha_fin: string | null;
  persona: { nombre: string; apellido: string; cargo_actual?: string } | null;
}

/**
 * TODAS las asignaciones activas de un engagement, tengan o no un requerimiento_engagement
 * vinculado. Usada por el formulario de edición (EngagementForm) para que ninguna persona
 * asignada directamente (sin requerimiento previo) quede fuera de "Equipo del proyecto".
 */
export async function fetchAsignacionesEngagement(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  engagementId: string
): Promise<{ data: AsignacionEngagementRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("asignacion")
    .select("id, persona_id, requerimiento_id, cargo_al_momento, pct_dedicacion, fecha_inicio, fecha_fin, persona:persona_id(nombre, apellido, cargo_actual)")
    .eq("engagement_id", engagementId)
    .eq("estado", "activa");

  if (error) return { data: [], error: error.message };
  return { data: (data ?? []) as AsignacionEngagementRow[], error: null };
}

/**
 * Crea un alargue (engagement_extension) y las asignaciones del equipo para ese
 * período, enlazadas vía extension_id. Reemplaza la lógica antes inline en
 * ExtenderProyecto.tsx (guardar()) para centralizarla aquí.
 */
export async function crearExtensionEngagement(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  params: {
    engagementId: string;
    fechaInicio: string;
    fechaFin: string;
    personas: { personaId: string; cargo: string; pct: number; requerimientoId: string | null }[];
  }
): Promise<{ error: string | null }> {
  const { data: ext, error: extErr } = await sb
    .from("engagement_extension")
    .insert({ engagement_id: params.engagementId, fecha_inicio: params.fechaInicio, fecha_fin: params.fechaFin })
    .select("id")
    .single();
  if (extErr) return { error: extErr.message };

  if (params.personas.length > 0) {
    const { error: asigErr } = await sb.from("asignacion").insert(
      params.personas.map((p) => ({
        engagement_id: params.engagementId,
        persona_id: p.personaId,
        requerimiento_id: p.requerimientoId,
        extension_id: ext.id,
        cargo_al_momento: p.cargo,
        pct_dedicacion: p.pct,
        fecha_inicio: params.fechaInicio,
        fecha_fin: params.fechaFin,
        estado: "activa",
        estado_staffing: "CONFIRMADO",
      }))
    );
    if (asigErr) return { error: asigErr.message };
  }

  return { error: null };
}

// ─────────────────────────────────────────────────────────────────
//  Equipo consolidado del detalle de engagement: agrupación por cargo
//  + timeline por persona (tramos activos intercalados con ausencias)
// ─────────────────────────────────────────────────────────────────

/** Orden jerárquico de los grupos de cargo mostrados en el detalle de engagement. */
export const ORDEN_GRUPOS_CARGO = [
  "Socio",
  "Director de Proyectos",
  "Gerente de Proyectos",
  "Asociado / Consultor Senior",
  "Consultor de Proyecto",
  "Consultor Analista",
  "Trainee",
  "Desarrollo",
] as const;

const CARGO_A_GRUPO: Record<string, string> = {
  "Socio": "Socio",
  "Director de Proyectos": "Director de Proyectos",
  "Director": "Director de Proyectos",
  "Gerente de Proyectos": "Gerente de Proyectos",
  "Gerente": "Gerente de Proyectos",
  "Asociado": "Asociado / Consultor Senior",
  "Consultor Senior": "Asociado / Consultor Senior",
  "Consultor de Proyectos": "Consultor de Proyecto",
  "Consultor Proyecto": "Consultor de Proyecto",
  "Consultor": "Consultor de Proyecto",
  "Consultor Analista": "Consultor Analista",
  "Analista Senior": "Consultor Analista",
  "Analista": "Consultor Analista",
  "Consultor Trainee": "Trainee",
  "Practicante": "Trainee",
  "Desarrollo": "Desarrollo",
};

/** Mapea un cargo real (cargo_actual/cargo_al_momento) al grupo jerárquico que le corresponde. */
export function grupoDeCargo(cargo: string | null): string {
  if (!cargo) return "Sin cargo";
  return CARGO_A_GRUPO[cargo.trim()] ?? cargo.trim();
}

/** Compara dos nombres de grupo según ORDEN_GRUPOS_CARGO (desconocidos al final, orden alfabético entre ellos). */
export function compararGrupoCargo(a: string, b: string): number {
  const ia = (ORDEN_GRUPOS_CARGO as readonly string[]).indexOf(a);
  const ib = (ORDEN_GRUPOS_CARGO as readonly string[]).indexOf(b);
  if (ia === -1 && ib === -1) return a.localeCompare(b, "es");
  if (ia === -1) return 1;
  if (ib === -1) return -1;
  return ia - ib;
}

export interface TramoTimeline {
  tipo: "activo" | "ausencia";
  inicio: string;              // YYYY-MM-DD
  fin: string | null;          // null = sin fecha de término (sigue activo)
  ausenciaTipo?: string;       // solo si tipo === "ausencia"
}

/**
 * Fusiona los tramos de asignación de una persona (pueden venir de varias
 * filas `asignacion` distintas, ej. extensiones) en bloques continuos, e
 * intercala cronológicamente los períodos de ausencia que caen dentro de
 * cada bloque, partiéndolo en activo → ausencia → activo según corresponda.
 */
export function construirTimelinePersona(
  segmentos: { inicio: string; fin: string | null }[],
  ausencias: { inicio: string; fin: string; tipo: string }[]
): TramoTimeline[] {
  if (segmentos.length === 0) return [];

  const ordenados = [...segmentos].sort((a, b) => a.inicio.localeCompare(b.inicio));
  const bloques: { inicio: string; fin: string | null }[] = [];
  for (const s of ordenados) {
    const ultimo = bloques[bloques.length - 1];
    if (!ultimo) { bloques.push({ ...s }); continue; }
    if (ultimo.fin === null) continue; // bloque anterior ya abierto: absorbe todo lo posterior
    if (s.inicio <= diaDespues(ultimo.fin)) {
      // se solapan o son contiguos → fusiona en el mismo bloque
      if (s.fin === null) ultimo.fin = null;
      else if (s.fin > ultimo.fin) ultimo.fin = s.fin;
    } else {
      bloques.push({ ...s });
    }
  }

  const resultado: TramoTimeline[] = [];
  for (const bloque of bloques) {
    let cursor = bloque.inicio;
    const relevantes = ausencias
      .filter((a) => a.inicio <= (bloque.fin ?? "9999-12-31") && a.fin >= bloque.inicio)
      .sort((a, b) => a.inicio.localeCompare(b.inicio));

    for (const a of relevantes) {
      const ausIni = a.inicio > bloque.inicio ? a.inicio : bloque.inicio;
      const ausFin = bloque.fin && a.fin > bloque.fin ? bloque.fin : a.fin;
      if (ausIni < cursor) continue; // ausencias que ya quedaron cubiertas por una anterior
      if (ausIni > cursor) {
        resultado.push({ tipo: "activo", inicio: cursor, fin: diaAntes(ausIni) });
      }
      resultado.push({ tipo: "ausencia", inicio: ausIni, fin: ausFin, ausenciaTipo: a.tipo });
      cursor = diaDespues(ausFin);
    }
    if (bloque.fin === null || cursor <= bloque.fin) {
      resultado.push({ tipo: "activo", inicio: cursor, fin: bloque.fin });
    }
  }
  return resultado;
}

// ─────────────────────────────────────────────────────────────────
//  Formulario de edición de engagement: "Equipo del proyecto" editable,
//  consolidado por persona con ausencias intercaladas cronológicamente.
// ─────────────────────────────────────────────────────────────────

export interface AusenciaPersonaRow {
  persona_id: string;
  fecha_inicio: string;
  fecha_fin: string;
  tipo: string;
}

/** Ausencias de un conjunto de personas (todas, sin acotar por fecha — el filtrado cronológico ocurre en el render). */
export async function fetchAusenciasPersonas(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  personaIds: string[]
): Promise<{ data: AusenciaPersonaRow[]; error: string | null }> {
  if (personaIds.length === 0) return { data: [], error: null };
  const { data, error } = await supabase
    .from("ausencia")
    .select("persona_id, fecha_inicio, fecha_fin, tipo")
    .in("persona_id", personaIds);

  if (error) return { data: [], error: error.message };
  return { data: (data ?? []) as AusenciaPersonaRow[], error: null };
}

export type EventoTimelineForm =
  | { tipo: "tramo"; inicio: string; tramoIdx: number }
  | { tipo: "ausencia"; inicio: string; fin: string; diasHabiles: number; ausenciaTipo: string };

/**
 * Combina cronológicamente los tramos EDITABLES de una persona (identificados por su índice
 * en el arreglo `reqs` del formulario) con sus ausencias registradas. No fusiona ni modifica
 * los tramos — cada uno sigue siendo el mismo registro editable/eliminable de antes; solo
 * calcula el orden de despliegue e intercala las ausencias entre medio.
 */
export function construirEventosTimelineForm(
  tramos: { idx: number; inicio: string }[],
  ausencias: { inicio: string; fin: string; tipo: string }[]
): EventoTimelineForm[] {
  if (tramos.length === 0) return [];
  const desde = tramos.reduce((min, t) => (t.inicio < min ? t.inicio : min), tramos[0].inicio);

  const eventos: EventoTimelineForm[] = [
    ...tramos.map((t) => ({ tipo: "tramo" as const, inicio: t.inicio, tramoIdx: t.idx })),
    ...ausencias
      .filter((a) => a.fin >= desde) // ignora ausencias completamente anteriores al primer tramo de la persona en este engagement
      .map((a) => ({
        tipo: "ausencia" as const,
        inicio: a.inicio,
        fin: a.fin,
        diasHabiles: calculateBusinessDays(a.inicio, a.fin),
        ausenciaTipo: a.tipo,
      })),
  ];
  return eventos.sort((a, b) => a.inicio.localeCompare(b.inicio));
}

// ─────────────────────────────────────────────────────────────────
//  Sincronización retroactiva de experiencia: recalcula, para TODOS los
//  engagements pasados de una persona, los días hábiles efectivamente
//  trabajados (sin fines de semana ni ausencias) y asocia de forma
//  persistente al perfil las industrias/capacidades/temáticas de los
//  engagements que superan el umbral de 10 días hábiles.
// ─────────────────────────────────────────────────────────────────

/**
 * Recalcula la experiencia dinámica de una persona (ver getExperienciaDinamica) y persiste
 * las asociaciones nuevas en persona_industria/persona_capacidad/persona_tematica, sin
 * duplicar las que ya existían. Idempotente: se puede volver a correr sin efectos duplicados.
 * Devuelve la experiencia recalculada, lista para renderizar en el perfil.
 */
export async function sincronizarExperienciaPersona(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  personaId: string
): Promise<ExperienciaDinamica> {
  const experiencia = await getExperienciaDinamica(supabase, personaId);

  const [{ data: indActuales }, { data: capActuales }, { data: temActuales }] = await Promise.all([
    supabase.from("persona_industria").select("industria_id").eq("persona_id", personaId),
    supabase.from("persona_capacidad").select("capacidad_id").eq("persona_id", personaId),
    supabase.from("persona_tematica").select("tematica_id").eq("persona_id", personaId),
  ]);

  const indSet = new Set(((indActuales ?? []) as { industria_id: string }[]).map((r) => r.industria_id));
  const capSet = new Set(((capActuales ?? []) as { capacidad_id: string }[]).map((r) => r.capacidad_id));
  const temSet = new Set(((temActuales ?? []) as { tematica_id: string }[]).map((r) => r.tematica_id));

  const nuevasIndustrias  = experiencia.industrias.filter((t) => !indSet.has(t.id));
  const nuevasCapacidades = experiencia.capacidades.filter((t) => !capSet.has(t.id));
  const nuevasTematicas   = experiencia.tematicas.filter((t) => !temSet.has(t.id));

  await Promise.all([
    nuevasIndustrias.length > 0
      ? supabase.from("persona_industria").insert(nuevasIndustrias.map((t) => ({ persona_id: personaId, industria_id: t.id })))
      : Promise.resolve(),
    nuevasCapacidades.length > 0
      ? supabase.from("persona_capacidad").insert(nuevasCapacidades.map((t) => ({ persona_id: personaId, capacidad_id: t.id })))
      : Promise.resolve(),
    nuevasTematicas.length > 0
      ? supabase.from("persona_tematica").insert(nuevasTematicas.map((t) => ({ persona_id: personaId, tematica_id: t.id })))
      : Promise.resolve(),
  ]);

  return experiencia;
}
