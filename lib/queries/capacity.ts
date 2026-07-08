import { SENIORITY_ORDER, COLOR_AUSENCIA } from "@/lib/queries/ausencias";
import type { TipoAusencia } from "@/lib/types/database";

// ─────────────────────────────────────────────────────────────
//  Grupos combinados (cargos que se muestran juntos en Capacity)
// ─────────────────────────────────────────────────────────────

/** Mapea cada cargo a su grupo de visualización en Capacity */
export const CAPACITY_GRUPO: Record<string, string> = {
  "Socio":                    "Socios",
  "Director de Proyectos":    "Gerentes / Directores",
  "Gerente de Proyectos":     "Gerentes / Directores",
  "Asociado":                 "Seniors / Asociados",
  "Consultor Senior":         "Seniors / Asociados",
  "Consultor de Proyectos":   "Consultores",
  "Consultor Analista":       "Consultores",
  "Consultor Trainee":        "Consultores",
};

/** Orden de visualización de los grupos */
export const CAPACITY_GRUPO_ORDER = [
  "Socios",
  "Gerentes / Directores",
  "Seniors / Asociados",
  "Consultores",
];

/**
 * historial_cargos.cargo usa los nombres cortos de ESCALONES_FORM (editor de
 * periodos de carrera en PersonaForm), distintos de los nombres largos de
 * cargo_actual/CAPACITY_GRUPO. Se normaliza antes de agrupar para que las
 * filas partidas por ascenso caigan en el bloque correcto.
 */
const CARGO_ALIAS: Record<string, string> = {
  "Trainee": "Consultor Trainee",
  "Senior": "Consultor Senior",
  "Gerente": "Gerente de Proyectos",
  "Director": "Director de Proyectos",
};

export function cargoAGrupo(cargo: string | null): string {
  if (!cargo) return "Sin cargo";
  const normalizado = CARGO_ALIAS[cargo] ?? cargo;
  return CAPACITY_GRUPO[normalizado] ?? normalizado;
}

// ─────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────

export interface PersonaCapacity {
  /** Clave de fila: persona_id, o `persona_id#n` si el cargo fue partido por un ascenso durante el año */
  id: string;
  /** id real de la persona — para lookup en `valores`/ausencias (se repite si hay 2+ filas) */
  personaId: string;
  nombre: string;
  apellido: string;
  /** Cargo vigente PARA ESTA FILA (no necesariamente el cargo_actual global de la persona) */
  cargo_actual: string | null;
  iniciales: string | null;
  seniority_order: number;
  fecha_salida: string | null;
  fecha_ingreso: string | null;
  /** Solo en filas partidas por ascenso: rango de vigencia de este cargo (clipeado al año). null = sin restricción */
  vigenciaInicio: string | null;
  vigenciaFin: string | null;
  /** Fecha real (sin recortar al año) desde que ocupa ESTE cargo — historial_cargos.fecha_inicio, o fecha_ingreso si no hay historial */
  cargoDesde: string | null;
}

export interface AusenciaCapacity {
  persona_id: string;
  fecha_inicio: string;  // YYYY-MM-DD
  fecha_fin: string;     // YYYY-MM-DD
  tipo: string;          // id de tipo_ausencia dinámico, o key estática de COLOR_AUSENCIA
}

export interface CapacityData {
  personas: PersonaCapacity[];
  semanas: string[];           // fechas ISO de los lunes del año
  // persona_id → semana_inicio → capacidad
  valores: Record<string, Record<string, number>>;
  ausencias: AusenciaCapacity[];
}

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

function seniorityIdx(cargo: string | null): number {
  if (!cargo) return SENIORITY_ORDER.length;
  const normalizado = CARGO_ALIAS[cargo] ?? cargo;
  const idx = SENIORITY_ORDER.findIndex((s) => s.toLowerCase() === normalizado.toLowerCase());
  return idx === -1 ? SENIORITY_ORDER.length : idx;
}

/** Formatea una Date como "yyyy-MM-dd" usando la fecha LOCAL (no UTC) */
function toLocalISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Genera todos los lunes del año dado como fechas ISO (usando fecha local, no UTC) */
export function semanasDelAnio(year: number): string[] {
  const semanas: string[] = [];
  // Busca el primer lunes del año
  const start = new Date(year, 0, 1);
  const dow = start.getDay(); // 0=dom, 1=lun…
  const diff = dow === 0 ? 1 : dow === 1 ? 0 : 8 - dow;
  start.setDate(start.getDate() + diff);

  const cur = new Date(start);
  while (cur.getFullYear() <= year) {
    semanas.push(toLocalISO(cur));
    cur.setDate(cur.getDate() + 7);
  }
  return semanas;
}

/** Número de semana ISO del año para un lunes dado */
export function labelSemana(lunesISO: string): { semana: string; mes: string } {
  const d = new Date(lunesISO + "T00:00:00");
  const mes = d.toLocaleDateString("es-CL", { month: "short" });
  const dia = d.getDate();
  return { semana: String(dia), mes: mes.replace(".", "") };
}

/** Detecta si es el primer lunes del mes para mostrar cabecera de mes */
export function esPrimerLunesMes(lunesISO: string): boolean {
  const d = new Date(lunesISO + "T00:00:00");
  const prev = new Date(d);
  prev.setDate(d.getDate() - 7);
  return prev.getMonth() !== d.getMonth();
}

// ─────────────────────────────────────────────────────────────
//  Coloreado de ausencias por tipo (celdas "Aus.")
// ─────────────────────────────────────────────────────────────

export interface TipoColorLookup { id: string; color_bg: string }

/** Días hábiles (lunes a viernes) de esa semana cubiertos por ausencia, agrupados por tipo */
export function diasPorTipoEnSemana(
  semana: string,
  ausencias: { fecha_inicio: string; fecha_fin: string; tipo: string }[]
): Map<string, number> {
  const lunes = new Date(semana + "T00:00:00");
  const conteo = new Map<string, number>();
  for (let i = 0; i < 5; i++) {
    const d = new Date(lunes);
    d.setDate(d.getDate() + i);
    const iso = d.toISOString().split("T")[0];
    const match = ausencias.find((a) => a.fecha_inicio <= iso && a.fecha_fin >= iso);
    if (match) conteo.set(match.tipo, (conteo.get(match.tipo) ?? 0) + 1);
  }
  return conteo;
}

/** Color hex de un tipo de ausencia: dinámico (tipo_ausencia) primero, luego estático, luego gris */
export function colorDeTipoAusencia(tipo: string, dinamicos: TipoColorLookup[]): string {
  const dinamico = dinamicos.find((d) => d.id === tipo);
  if (dinamico) return dinamico.color_bg;
  return COLOR_AUSENCIA[tipo as TipoAusencia]?.bg ?? "#9ca3af";
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/**
 * Fondo tenue (15% opacidad) del/los tipo(s) de ausencia predominante(s) esa semana.
 * Empate entre 2 tipos → degradado 50/50. 3+ tipos empatados (raro) → gris neutro.
 */
export function estiloFondoAusencia(diasPorTipo: Map<string, number>, dinamicos: TipoColorLookup[]): string {
  if (diasPorTipo.size === 0) return "#f3f4f6";
  const maxDias = Math.max(...diasPorTipo.values());
  const ganadores = Array.from(diasPorTipo.entries()).filter(([, d]) => d === maxDias).map(([t]) => t);

  if (ganadores.length === 1) return hexToRgba(colorDeTipoAusencia(ganadores[0], dinamicos), 0.15);

  if (ganadores.length === 2) {
    const [a, b] = ganadores;
    const ca = hexToRgba(colorDeTipoAusencia(a, dinamicos), 0.15);
    const cb = hexToRgba(colorDeTipoAusencia(b, dinamicos), 0.15);
    return `linear-gradient(to right, ${ca} 50%, ${cb} 50%)`;
  }

  return "#f3f4f6";
}

// ─────────────────────────────────────────────────────────────
//  Fetch
// ─────────────────────────────────────────────────────────────

export async function fetchCapacityData(supabase: any, year: number): Promise<CapacityData> {
  const semanas = semanasDelAnio(year);
  const primeraSemana = semanas[0];
  const ultimaSemana  = semanas[semanas.length - 1];

  const inicioAnio = `${year}-01-01`;
  const finAnio    = `${year}-12-31`;

  // Personas y ausencias no tienen problema de límite de filas.
  // Presencia point-in-time: se incluye a quien no es ex-houser, o cuya
  // fecha_salida cae dentro (o después) del año evaluado — igual que fetchCapacitySnapshot.
  const [persRes, ausRes] = await Promise.all([
    supabase
      .from("persona")
      .select("id, nombre, apellido, cargo_actual, iniciales, fecha_salida, fecha_ingreso, created_at")
      .eq("is_deleted", false)
      .or(`is_ex_houser.eq.false,fecha_salida.gte.${inicioAnio},fecha_salida.is.null`)
      .order("apellido"),
    supabase
      .from("ausencia")
      .select("persona_id, fecha_inicio, fecha_fin, tipo")
      .lte("fecha_inicio", finAnio)
      .gte("fecha_fin", inicioAnio),
  ]);

  // Historial de cargos vigente durante el año: si una persona tiene 2+ periodos
  // que se solapan con el año evaluado (ascenso), se generará una fila por periodo.
  const personaIds = ((persRes.data ?? []) as any[]).map((p) => p.id);
  const { data: histData } = personaIds.length
    ? await supabase
        .from("historial_cargos")
        .select("persona_id, cargo, fecha_inicio, fecha_fin")
        .in("persona_id", personaIds)
        .lte("fecha_inicio", finAnio)
        .or(`fecha_fin.gte.${inicioAnio},fecha_fin.is.null`)
        .order("fecha_inicio", { ascending: true })
    : { data: [] as any[] };

  const historialPorPersona = new Map<string, { cargo: string; fecha_inicio: string; fecha_fin: string | null }[]>();
  for (const row of (histData ?? []) as any[]) {
    if (!historialPorPersona.has(row.persona_id)) historialPorPersona.set(row.persona_id, []);
    historialPorPersona.get(row.persona_id)!.push(row);
  }

  // Capacity: paginación explícita para superar el límite de 1000 filas de PostgREST.
  // Con ~25 personas × 52 semanas = 1300 filas, sin paginación se pierde el final.
  const PAGE_SIZE = 1000;
  let capRows: { persona_id: string; semana_inicio: string; capacidad: unknown }[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("capacity_planning")
      .select("persona_id, semana_inicio, capacidad")
      .gte("semana_inicio", primeraSemana)
      .lte("semana_inicio", ultimaSemana)
      .range(from, from + PAGE_SIZE - 1);
    if (error || !data || data.length === 0) break;
    capRows = capRows.concat(data);
    if (data.length < PAGE_SIZE) break;   // última página: terminamos
    from += PAGE_SIZE;
  }

  const personas: PersonaCapacity[] = [];
  for (const p of (persRes.data ?? []) as any[]) {
    const base = {
      personaId: p.id as string,
      nombre: p.nombre,
      apellido: p.apellido,
      iniciales: (p as any).iniciales ?? null,
      fecha_salida: (p as any).fecha_salida ?? null,
      fecha_ingreso: (p as any).fecha_ingreso ?? null,
    };
    // Último recurso para ordenar por antigüedad cuando no hay fecha_ingreso ni historial_cargos:
    // created_at siempre existe (lo pone Supabase al crear la fila).
    const creadoEn: string | null = (p as any).created_at ? String((p as any).created_at).split("T")[0] : null;
    const periodos = historialPorPersona.get(p.id) ?? [];

    if (periodos.length >= 2) {
      // Ascenso durante el año: una fila por periodo de cargo, vigencia clipeada al año.
      periodos.forEach((per, idx) => {
        const vigenciaInicio = per.fecha_inicio > inicioAnio ? per.fecha_inicio : inicioAnio;
        const vigenciaFin = per.fecha_fin ? (per.fecha_fin < finAnio ? per.fecha_fin : finAnio) : null;
        personas.push({
          id: `${p.id}#${idx}`,
          ...base,
          cargo_actual: per.cargo,
          seniority_order: seniorityIdx(per.cargo),
          vigenciaInicio,
          vigenciaFin,
          cargoDesde: per.fecha_inicio ?? base.fecha_ingreso ?? creadoEn, // fecha real (sin recortar) de inicio de ESTE periodo
        });
      });
    } else {
      // Sin ascenso este año: antigüedad en el cargo = inicio del único periodo en historial_cargos,
      // o fecha_ingreso si la persona no tiene historial registrado.
      personas.push({
        id: p.id,
        ...base,
        cargo_actual: p.cargo_actual,
        seniority_order: seniorityIdx(p.cargo_actual),
        vigenciaInicio: null,
        vigenciaFin: null,
        cargoDesde: periodos[0]?.fecha_inicio ?? base.fecha_ingreso ?? creadoEn,
      });
    }
  }
  personas.sort((a, b) =>
    a.seniority_order !== b.seniority_order
      ? a.seniority_order - b.seniority_order
      : a.apellido.localeCompare(b.apellido, "es")
  );

  // Construir mapa persona real → semana → valor (default 1). Se indexa por
  // personaId (no por `id` de fila) para que las filas partidas por ascenso
  // compartan la misma capacidad cruda cargada en capacity_planning.
  const valores: Record<string, Record<string, number>> = {};
  for (const pid of new Set(personas.map((p) => p.personaId))) valores[pid] = {};

  for (const row of capRows) {
    if (valores[row.persona_id]) {
      const parsed = parseFloat(String(row.capacidad));
      valores[row.persona_id][row.semana_inicio] = isNaN(parsed) ? 1 : parsed;
    }
  }

  // Anula capacidad en semanas posteriores a la salida: la persona sigue
  // apareciendo (fue activa antes en el año), pero no debe sumar tras irse.
  for (const p of personas) {
    if (!p.fecha_salida) continue;
    for (const sem of semanas) {
      if (sem > p.fecha_salida) valores[p.personaId][sem] = 0;
    }
  }

  const ausencias: AusenciaCapacity[] = (ausRes.data ?? []) as AusenciaCapacity[];

  return { personas, semanas, valores, ausencias };
}

// ─────────────────────────────────────────────────────────────
//  Snapshot point-in-time (cargo histórico a un mes evaluado)
// ─────────────────────────────────────────────────────────────

export interface PersonaCapacitySnapshot {
  id: string;
  nombre: string;
  apellido: string;
  cargo: string | null;
  iniciales: string | null;
  grupo: string;
}

export interface CapacitySnapshotData {
  mesEvaluado: string; // "YYYY-MM"
  personas: PersonaCapacitySnapshot[];
  porGrupo: Record<string, number>;
}

/** Último día del mes "YYYY-MM" como "YYYY-MM-DD" */
function ultimoDiaDelMes(mesEvaluado: string): string {
  const [y, m] = mesEvaluado.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${mesEvaluado}-${String(last).padStart(2, "0")}`;
}

/**
 * Snapshot de dotación para un mes evaluado: incluye a quienes ya habían
 * ingresado y aún no habían salido en ese mes, con el cargo que tenían
 * en ese momento (histórico), no el cargo actual.
 */
export async function fetchCapacitySnapshot(
  supabase: any,
  mesEvaluado: string
): Promise<CapacitySnapshotData> {
  const inicioMes = `${mesEvaluado}-01`;
  const finMes = ultimoDiaDelMes(mesEvaluado);

  const { data: persData } = await supabase
    .from("persona")
    .select("id, nombre, apellido, cargo_actual, iniciales, fecha_ingreso, is_ex_houser, fecha_salida")
    .eq("is_deleted", false)
    .lte("fecha_ingreso", finMes)
    .or(`is_ex_houser.eq.false,fecha_salida.gte.${inicioMes},fecha_salida.is.null`);

  const personas = (persData ?? []) as any[];
  if (personas.length === 0) return { mesEvaluado, personas: [], porGrupo: {} };

  const personaIds = personas.map((p) => p.id);

  const { data: histData } = await supabase
    .from("historial_cargos")
    .select("persona_id, cargo, fecha_inicio")
    .in("persona_id", personaIds)
    .lte("fecha_inicio", finMes)
    .order("persona_id", { ascending: true })
    .order("fecha_inicio", { ascending: false });

  // Reduce a 1 cargo por persona: la primera fila de cada persona_id ya es
  // la de fecha_inicio más reciente (orden desc) → evita RPC/lateral join.
  const cargoPorPersona = new Map<string, string>();
  for (const row of (histData ?? []) as any[]) {
    if (!cargoPorPersona.has(row.persona_id)) cargoPorPersona.set(row.persona_id, row.cargo);
  }

  const filas: PersonaCapacitySnapshot[] = personas
    .map((p) => {
      const cargo = cargoPorPersona.get(p.id) ?? p.cargo_actual ?? null;
      return {
        id: p.id,
        nombre: p.nombre,
        apellido: p.apellido,
        cargo,
        iniciales: p.iniciales ?? null,
        grupo: cargoAGrupo(cargo),
      };
    })
    .sort((a, b) => a.apellido.localeCompare(b.apellido, "es"));

  const porGrupo: Record<string, number> = {};
  for (const p of filas) porGrupo[p.grupo] = (porGrupo[p.grupo] ?? 0) + 1;

  return { mesEvaluado, personas: filas, porGrupo };
}

// ─────────────────────────────────────────────────────────────
//  Upsert individual
// ─────────────────────────────────────────────────────────────

export async function upsertCapacity(
  supabase: any,
  personaId: string,
  semanaInicio: string,
  capacidad: number
): Promise<void> {
  await supabase
    .from("capacity_planning")
    .upsert({ persona_id: personaId, semana_inicio: semanaInicio, capacidad },
             { onConflict: "persona_id,semana_inicio" });
}

// ─────────────────────────────────────────────────────────────
//  Upsert masivo por cargo (default de cargo)
// ─────────────────────────────────────────────────────────────

export async function upsertCapacityByCargo(
  supabase: any,
  personaIds: string[],
  semanaInicio: string,
  capacidad: number
): Promise<void> {
  const rows = personaIds.map((id) => ({
    persona_id: id,
    semana_inicio: semanaInicio,
    capacidad,
  }));
  await supabase
    .from("capacity_planning")
    .upsert(rows, { onConflict: "persona_id,semana_inicio" });
}

// ─────────────────────────────────────────────────────────────
//  Upsert masivo: todas las personas de un grupo × todas las semanas del año
// ─────────────────────────────────────────────────────────────

export async function upsertCapacityBulkAll(
  supabase: any,
  personaIds: string[],
  semanas: string[],
  capacidad: number
): Promise<string | null> {
  // Iteración secuencial estricta: una persona a la vez.
  // NO se corta ante el primer error — se procesan TODAS las personas
  // para evitar que un fallo puntual deje a las demás sin actualizar.
  const errores: string[] = [];

  for (const pid of personaIds) {
    const rows = semanas.map((sem) => ({
      persona_id: pid,
      semana_inicio: sem,
      capacidad,
    }));
    const { error } = await supabase
      .from("capacity_planning")
      .upsert(rows, { onConflict: "persona_id,semana_inicio" });
    if (error) {
      errores.push(`pid=${pid}: ${error.message}`);
    }
  }

  return errores.length > 0 ? errores.join(" | ") : null;
}
