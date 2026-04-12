import type { TypedSupabaseClient } from "@/lib/supabase/types";

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

export function today(): string {
  return new Date().toISOString().split("T")[0];
}

/** Orden de seniority de más a menos senior */
const SENIORITY_ORDER = [
  "Socio",
  "Director de Proyecto",
  "Gerente de Proyecto",
  "Asociado",
  "Consultor Senior",
  "Consultor de Proyectos",
  "Consultor Analista",
  "Consultor Trainee",
];

function seniorityIndex(cargo: string | null | undefined): number {
  if (!cargo) return 999;
  const idx = SENIORITY_ORDER.indexOf(cargo);
  return idx === -1 ? 998 : idx;
}

// ─────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────

/** Una asignación confirmada vinculada a un requerimiento */
export interface AsignacionActiva {
  asignacion_id: string;
  persona_id: string;
  persona_nombre: string;
  persona_apellido: string;
  persona_cargo: string;
  pct_dedicacion: number;
  fecha_inicio: string;
  fecha_fin: string | null;
}

export interface ReqConEstado {
  id: string;
  engagement_id: string;
  engagement_nombre: string;
  engagement_cliente: string;
  engagement_estado: string;
  cargo_requerido: string | null;
  pct_dedicacion: number;
  fecha_inicio: string;
  fecha_fin: string;
  fase_nombre: string | null;
  /** Todas las asignaciones confirmadas (puede haber varias no solapadas) */
  asignaciones: AsignacionActiva[];
  /** Hay al menos una asignación cubriendo desde hoy hasta fecha_fin */
  cubierto_desde_hoy: boolean;
}

export interface EngagementConReqs {
  engagement_id: string;
  nombre: string;
  cliente: string;
  estado: string;
  fecha_inicio: string | null;
  fecha_fin_estimada: string | null;
  requerimientos: ReqConEstado[];
}

export type FitNivel = "excelente" | "bueno" | "advertencia" | "riesgo";

export interface FitAlerta {
  tipo: "sobreasignacion" | "baja_disponibilidad" | "ausencia_en_periodo" | "ya_cubierto";
  mensaje: string;
  nivel: "warning" | "error";
}

/** Asignación activa con datos suficientes para el mini-Gantt */
export interface AsignacionDetalle {
  asignacion_id: string;       // id real de asignacion — para identificar liberaciones
  requerimiento_id: string | null;
  engagement_nombre: string;
  pct_dedicacion: number;
  fecha_inicio: string;
  fecha_fin: string | null;
}

export interface PersonaFit {
  persona_id: string;
  nombre: string;
  apellido: string;
  cargo_actual: string;
  /** % ya comprometido en [hoy, req.fecha_fin] */
  pct_ocupado_en_rango: number;
  /** % total si se asignara */
  pct_si_asigna: number;
  alertas: FitAlerta[];
  score: number;   // 0–100 (mayor = mejor fit)
  nivel: FitNivel;
  /** Asignaciones activas que solapan con el período del req (para mini-Gantt) */
  asignaciones: AsignacionDetalle[];
}

// ─────────────────────────────────────────────────────────────
//  Fetch engagements activos con sus requerimientos VIGENTES
//  (fecha_fin del requerimiento >= hoy)
// ─────────────────────────────────────────────────────────────

export async function fetchEngagementsConReqs(supabase: any): Promise<{
  engagements: EngagementConReqs[];
  error: string | null;
}> {
  const hoy = today();

  // Solo requerimientos cuya fecha_fin >= hoy
  const { data: reqRaw, error: reqErr } = await supabase
    .from("requerimiento_engagement")
    .select(`
      id,
      engagement_id,
      cargo_requerido,
      pct_dedicacion,
      fecha_inicio,
      fecha_fin,
      fase_nombre,
      engagement:engagement_id (
        nombre,
        cliente,
        estado,
        fecha_inicio,
        fecha_fin_estimada
      )
    `)
    .gte("fecha_fin", hoy)
    .order("fase_nombre");

  if (reqErr) return { engagements: [], error: reqErr.message };

  // Todas las asignaciones activas (puede haber varias por req)
  const { data: asigRaw, error: asigErr } = await supabase
    .from("asignacion")
    .select(`
      id,
      requerimiento_id,
      persona_id,
      pct_dedicacion,
      fecha_inicio,
      fecha_fin,
      persona:persona_id (nombre, apellido, cargo_actual)
    `)
    .eq("estado", "activa");

  if (asigErr) return { engagements: [], error: asigErr.message };

  // ── Normalizar ──────────────────────────────────────────────
  interface ReqRow {
    id: string;
    engagement_id: string;
    cargo_requerido: string | null;
    pct_dedicacion: number;
    fecha_inicio: string;
    fecha_fin: string;
    fase_nombre: string | null;
    engagement: {
      nombre: string;
      cliente: string;
      estado: string;
      fecha_inicio: string | null;
      fecha_fin_estimada: string | null;
    } | null;
  }
  interface AsigRow {
    id: string;
    requerimiento_id: string | null;
    persona_id: string;
    pct_dedicacion: number;
    fecha_inicio: string;
    fecha_fin: string | null;
    persona: { nombre: string; apellido: string; cargo_actual: string } | null;
  }

  const reqs  = (reqRaw  ?? []) as unknown as ReqRow[];
  const asigs = (asigRaw ?? []) as unknown as AsigRow[];

  // Agrupar asignaciones por requerimiento_id
  const asigPorReq = new Map<string, AsigRow[]>();
  for (const a of asigs) {
    if (!a.requerimiento_id) continue;
    if (!asigPorReq.has(a.requerimiento_id)) asigPorReq.set(a.requerimiento_id, []);
    asigPorReq.get(a.requerimiento_id)!.push(a);
  }

  // Agrupar requerimientos por engagement
  const engMap = new Map<string, EngagementConReqs>();

  for (const r of reqs) {
    const eng = r.engagement;
    if (!eng) continue;
    if (!["propuesta", "activo", "pausado"].includes(eng.estado)) continue;

    if (!engMap.has(r.engagement_id)) {
      engMap.set(r.engagement_id, {
        engagement_id: r.engagement_id,
        nombre: eng.nombre,
        cliente: eng.cliente,
        estado: eng.estado,
        fecha_inicio: eng.fecha_inicio,
        fecha_fin_estimada: eng.fecha_fin_estimada,
        requerimientos: [],
      });
    }

    const reqAsigs = asigPorReq.get(r.id) ?? [];
    const asignaciones: AsignacionActiva[] = reqAsigs.map((a) => ({
      asignacion_id: a.id,
      persona_id: a.persona_id,
      persona_nombre: a.persona?.nombre ?? "—",
      persona_apellido: a.persona?.apellido ?? "",
      persona_cargo: a.persona?.cargo_actual ?? "—",
      pct_dedicacion: Number(a.pct_dedicacion),
      fecha_inicio: a.fecha_inicio,
      fecha_fin: a.fecha_fin ?? null,
    }));

    // ¿Está cubierto desde hoy? Al menos una asignación activa que empieza ≤ hoy
    // y termina ≥ fecha_fin del req (o no termina)
    const cubierto_desde_hoy = asignaciones.some((a) => {
      const inicio = a.fecha_inicio <= hoy;
      const termina = a.fecha_fin === null || a.fecha_fin >= r.fecha_fin;
      return inicio && termina;
    });

    engMap.get(r.engagement_id)!.requerimientos.push({
      id: r.id,
      engagement_id: r.engagement_id,
      engagement_nombre: eng.nombre,
      engagement_cliente: eng.cliente,
      engagement_estado: eng.estado,
      cargo_requerido: r.cargo_requerido,
      pct_dedicacion: Number(r.pct_dedicacion),
      fecha_inicio: r.fecha_inicio,
      fecha_fin: r.fecha_fin,
      fase_nombre: r.fase_nombre,
      asignaciones,
      cubierto_desde_hoy,
    });
  }

  // Ordenar requerimientos de cada engagement por nombre (asc) y seniority dentro del mismo nombre
  for (const eng of engMap.values()) {
    eng.requerimientos.sort((a, b) => {
      const faseComp = (a.fase_nombre ?? "").localeCompare(b.fase_nombre ?? "", "es");
      if (faseComp !== 0) return faseComp;
      return seniorityIndex(a.cargo_requerido) - seniorityIndex(b.cargo_requerido);
    });
  }

  const engagements = Array.from(engMap.values()).sort((a, b) =>
    a.nombre.localeCompare(b.nombre, "es")
  );

  return { engagements, error: null };
}

// ─────────────────────────────────────────────────────────────
//  Calcular fit de personas para un requerimiento
//
//  Reglas:
//  - HARD: cargo debe coincidir (solo se devuelven personas con cargo_match)
//  - SOFT (alertas, no bloquean): capacidad >100%, ausencias en el período
//  - Disponibilidad calculada desde HOY (no desde req.fecha_inicio)
// ─────────────────────────────────────────────────────────────

export async function fetchPersonasFit(
  supabase: any,
  req: ReqConEstado,
  tentativas: Array<{ persona_id: string; requerimiento_id: string; pct: number }>,
  /** IDs de asignaciones que se propone terminar — se excluyen del cálculo de capacidad */
  asignacionIdsATerminar: string[] = []
): Promise<{ personas: PersonaFit[]; error: string | null }> {
  const hoy = today();
  // Período efectivo: desde hoy (o fecha_inicio si es futura) hasta fecha_fin
  const desdeEfectivo = req.fecha_inicio > hoy ? req.fecha_inicio : hoy;
  const hastaEfectivo = req.fecha_fin;

  // 1. Solo personas activas con cargo coincidente (regla HARD)
  let query = supabase
    .from("persona")
    .select("id, nombre, apellido, cargo_actual")
    .eq("activo", true)
    .order("apellido");

  if (req.cargo_requerido) {
    query = query.eq("cargo_actual", req.cargo_requerido);
  }

  const { data: personasRaw, error: pErr } = await query;
  if (pErr) return { personas: [], error: pErr.message };

  // 2. Asignaciones que solapan con [desdeEfectivo, hastaEfectivo]
  //    Incluimos id, fechas y nombre del engagement para el mini-Gantt y para excluir terminaciones
  const { data: asigRaw, error: aErr } = await supabase
    .from("asignacion")
    .select(`
      id, persona_id, pct_dedicacion, requerimiento_id, fecha_inicio, fecha_fin,
      requerimiento_engagement!requerimiento_id (
        engagement!engagement_id (nombre)
      )
    `)
    .eq("estado", "activa")
    .lte("fecha_inicio", hastaEfectivo)
    .or(`fecha_fin.gte.${desdeEfectivo},fecha_fin.is.null`);

  if (aErr) return { personas: [], error: aErr.message };

  // 3. Ausencias en el período (soft alert)
  const { data: ausRaw } = await supabase
    .from("ausencia")
    .select("persona_id, tipo, fecha_inicio, fecha_fin")
    .lte("fecha_inicio", hastaEfectivo)
    .gte("fecha_fin", desdeEfectivo);

  interface PersonaRow { id: string; nombre: string; apellido: string; cargo_actual: string }
  interface AsigRow    {
    id: string;
    persona_id: string;
    pct_dedicacion: number;
    requerimiento_id: string | null;
    fecha_inicio: string;
    fecha_fin: string | null;
    requerimiento_engagement?: { engagement?: { nombre?: string } } | null;
  }
  interface AusRow     { persona_id: string; tipo: string; fecha_inicio: string; fecha_fin: string }

  const personas = (personasRaw ?? []) as unknown as PersonaRow[];
  const asigs    = (asigRaw    ?? []) as unknown as AsigRow[];
  const ausencias = (ausRaw   ?? []) as unknown as AusRow[];

  // Pct comprometido por persona en el período (sin contar el req actual)
  const pctPorPersona = new Map<string, number>();
  // Asignaciones detalle por persona (para mini-Gantt)
  const asigsPorPersona = new Map<string, AsignacionDetalle[]>();

  for (const a of asigs) {
    // Registrar para mini-Gantt (siempre, incluso si se va a terminar)
    if (!asigsPorPersona.has(a.persona_id)) asigsPorPersona.set(a.persona_id, []);
    const engNombre = a.requerimiento_engagement?.engagement?.nombre ?? "—";
    asigsPorPersona.get(a.persona_id)!.push({
      asignacion_id: a.id,
      requerimiento_id: a.requerimiento_id,
      engagement_nombre: engNombre,
      pct_dedicacion: Number(a.pct_dedicacion),
      fecha_inicio: a.fecha_inicio,
      fecha_fin: a.fecha_fin ?? null,
    });

    // Excluir de capacidad: la del req actual, o asignaciones en proceso de terminación tentativa
    if (a.requerimiento_id === req.id) continue;
    if (asignacionIdsATerminar.includes(a.id)) continue;
    pctPorPersona.set(a.persona_id, (pctPorPersona.get(a.persona_id) ?? 0) + Number(a.pct_dedicacion));
  }

  // Sumar tentativas locales (excluir el req actual)
  for (const t of tentativas) {
    if (t.requerimiento_id === req.id) continue;
    pctPorPersona.set(t.persona_id, (pctPorPersona.get(t.persona_id) ?? 0) + t.pct);
  }

  // Contar días hábiles de ausencia por persona dentro del período efectivo
  function diasHabilesInterseccion(inicioAus: string, finAus: string): number {
    const start = inicioAus > desdeEfectivo ? inicioAus : desdeEfectivo;
    const end   = finAus   < hastaEfectivo  ? finAus   : hastaEfectivo;
    if (start > end) return 0;
    let count = 0;
    const cur = new Date(start + "T00:00:00");
    const last = new Date(end   + "T00:00:00");
    while (cur <= last) {
      const dow = cur.getDay();
      if (dow !== 0 && dow !== 6) count++;
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  }

  const diasAusenciaPorPersona = new Map<string, number>();
  for (const a of ausencias) {
    const dias = diasHabilesInterseccion(a.fecha_inicio, a.fecha_fin);
    if (dias > 0) {
      diasAusenciaPorPersona.set(a.persona_id, (diasAusenciaPorPersona.get(a.persona_id) ?? 0) + dias);
    }
  }

  // Personas ya confirmadas en este req
  const yaConfirmados = new Set(req.asignaciones.map((a) => a.persona_id));

  // Calcular fit
  const resultado: PersonaFit[] = personas.map((p) => {
    const pctOcupado  = pctPorPersona.get(p.id) ?? 0;
    const pctSiAsigna = pctOcupado + req.pct_dedicacion;
    const alertas: FitAlerta[] = [];
    let score = 100;

    // Soft: capacidad
    if (pctSiAsigna > 100) {
      const exceso = pctSiAsigna - 100;
      score -= Math.min(35, exceso);
      alertas.push({
        tipo: "sobreasignacion",
        mensaje: `Quedaría al ${pctSiAsigna}% (excede en ${exceso}%)`,
        nivel: "error",
      });
    } else if (pctSiAsigna > 80) {
      score -= 10;
      alertas.push({
        tipo: "baja_disponibilidad",
        mensaje: `Quedaría al ${pctSiAsigna}% de capacidad`,
        nivel: "warning",
      });
    }

    // Soft: ausencias en el período
    const diasAusencia = diasAusenciaPorPersona.get(p.id) ?? 0;
    if (diasAusencia > 0) {
      score -= Math.min(20, diasAusencia * 2);
      alertas.push({
        tipo: "ausencia_en_periodo",
        mensaje: `Tiene ${diasAusencia} día${diasAusencia === 1 ? "" : "s"} hábil${diasAusencia === 1 ? "" : "es"} de ausencia registrado${diasAusencia === 1 ? "" : "s"} en el período`,
        nivel: "warning",
      });
    }

    // Soft: ya confirmado en este req (útil para ver pero no bloquear)
    if (yaConfirmados.has(p.id)) {
      alertas.push({
        tipo: "ya_cubierto",
        mensaje: "Ya tiene una asignación confirmada en este requerimiento",
        nivel: "warning",
      });
    }

    score = Math.max(0, Math.min(100, score));

    let nivel: FitNivel;
    if (score >= 85)      nivel = "excelente";
    else if (score >= 65) nivel = "bueno";
    else if (score >= 40) nivel = "advertencia";
    else                  nivel = "riesgo";

    return {
      persona_id: p.id,
      nombre: p.nombre,
      apellido: p.apellido,
      cargo_actual: p.cargo_actual,
      pct_ocupado_en_rango: pctOcupado,
      pct_si_asigna: pctSiAsigna,
      alertas,
      score,
      nivel,
      asignaciones: asigsPorPersona.get(p.id) ?? [],
    };
  });

  resultado.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.apellido.localeCompare(b.apellido, "es");
  });

  return { personas: resultado, error: null };
}

// ─────────────────────────────────────────────────────────────
//  Terminar una asignación (fecha_fin = hoy, estado = finalizada)
// ─────────────────────────────────────────────────────────────

export async function terminarAsignacion(
  supabase: any,
  asignacionId: string,
  fechaFin?: string  // por defecto = hoy
): Promise<{ error: string | null }> {
  const fin = fechaFin ?? today();
  const { error } = await supabase
    .from("asignacion")
    .update({ fecha_fin: fin, estado: "finalizada" })
    .eq("id", asignacionId);
  return { error: error?.message ?? null };
}
