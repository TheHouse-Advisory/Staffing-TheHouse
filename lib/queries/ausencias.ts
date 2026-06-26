import type { TypedSupabaseClient } from "@/lib/supabase/types";
import type { TipoAusencia } from "@/lib/types/database";
import { expandirRangoHabil } from "@/lib/utils/date-utils";
import { isHoliday } from "@/lib/constants/holidays";

// ─────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────

// Orden de seniority para Y-axis (de mayor a menor)
export const SENIORITY_ORDER = [
  "Socio",
  "Director de Proyectos",
  "Gerente de Proyectos",
  "Asociado",
  "Consultor Senior",
  "Consultor de Proyectos",
  "Consultor Analista",
  "Consultor Trainee",
];

// Colores por tipo de ausencia
export const COLOR_AUSENCIA: Record<TipoAusencia, { bg: string; text: string; label: string }> = {
  vacaciones_confirmadas:   { bg: "#38bdf8", text: "#fff", label: "Vacaciones confirmadas" },
  vacaciones_por_confirmar: { bg: "#fbbf24", text: "#fff", label: "Vacaciones por confirmar" },
  permiso_sin_goce:         { bg: "#92400e", text: "#fff", label: "Permiso sin goce de sueldo" },
  dia_post_proyecto:        { bg: "#f97316", text: "#fff", label: "Día post proyecto" },
  dia_beneficio:            { bg: "#a855f7", text: "#fff", label: "Día beneficio" },
  dia_administrativo:       { bg: "#22c55e", text: "#fff", label: "Día administrativo" },
  otro:                     { bg: "#9ca3af", text: "#fff", label: "Otro" },
};

// ─────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────

export interface AusenciaRow {
  id: string;
  persona_id: string;
  tipo: TipoAusencia;
  fecha_inicio: string;   // ISO date "YYYY-MM-DD"
  fecha_fin: string;      // ISO date "YYYY-MM-DD"
  descripcion: string | null;
  // Sin columna "aprobada" — todas las ausencias registradas se consideran confirmadas
}

export interface PersonaConSeniority {
  id: string;
  nombre: string;
  apellido: string;
  cargo_actual: string | null;
  seniority_order: number;  // índice en SENIORITY_ORDER (menor = más senior)
  fecha_ingreso: string | null;
  is_leverager: boolean;
}

export interface CeldaAusencia {
  tipo: TipoAusencia;
  ausencia_id: string;
  descripcion: string | null;
}

export interface FilaPersona {
  persona: PersonaConSeniority;
  // Mapa fecha ISO → ausencia (null si no hay)
  dias: Record<string, CeldaAusencia | null>;
}

export interface AusenciasDelMes {
  filas: FilaPersona[];
  dias: string[];  // fechas ISO del mes (solo días hábiles Mon–Fri)
  error: string | null;
}

// ─────────────────────────────────────────────────────────────
//  Helpers de fecha
// ─────────────────────────────────────────────────────────────

/** Genera array de fechas ISO "YYYY-MM-DD" para todos los días del mes (lun–vie, INCLUYENDO feriados para que no haya huecos en el grid) */
export function diasDelMes(year: number, month: number): string[] {
  const dias: string[] = [];
  const totalDias = new Date(year, month, 0).getDate();
  for (let d = 1; d <= totalDias; d++) {
    const fecha = new Date(year, month - 1, d);
    const dow = fecha.getDay();
    if (dow !== 0 && dow !== 6) {
      dias.push(fecha.toISOString().split("T")[0]);
    }
  }
  return dias;
}

// Re-export para uso en componentes de UI
export { isHoliday };

/** Expande un rango a días hábiles (sin fines de semana ni feriados Chile) */
export function expandirRango(inicio: string, fin: string): string[] {
  return expandirRangoHabil(inicio, fin);
}

/** Calcula índice de seniority (menor = más senior) */
function seniorityIdx(cargo: string | null): number {
  if (!cargo) return SENIORITY_ORDER.length;
  const idx = SENIORITY_ORDER.findIndex(
    (s) => s.toLowerCase() === cargo.toLowerCase()
  );
  return idx === -1 ? SENIORITY_ORDER.length : idx;
}

// ─────────────────────────────────────────────────────────────
//  Fetch
// ─────────────────────────────────────────────────────────────

export async function fetchAusenciasMes(
  supabase: any,
  year: number,
  month: number  // 1-based
): Promise<AusenciasDelMes> {
  const primerDia = `${year}-${String(month).padStart(2, "0")}-01`;
  const ultimoDia = new Date(year, month, 0).toISOString().split("T")[0];

  // Personas activas
  const { data: personasRaw, error: pErr } = await supabase
    .from("persona")
    .select("id, nombre, apellido, cargo_actual, iniciales, fecha_ingreso, is_leverager")
    .eq("activo", true)
    .order("apellido");

  if (pErr) return { filas: [], dias: [], error: pErr.message };

  // Ausencias que solapan con el mes
  const { data: ausRaw, error: aErr } = await supabase
    .from("ausencia")
    .select("id, persona_id, tipo, fecha_inicio, fecha_fin, descripcion")
    .lte("fecha_inicio", ultimoDia)
    .gte("fecha_fin", primerDia);

  if (aErr) return { filas: [], dias: [], error: aErr.message };

  interface PRow { id: string; nombre: string; apellido: string; cargo_actual: string | null; iniciales?: string | null; fecha_ingreso: string | null; is_leverager: boolean }
  interface ARow { id: string; persona_id: string; tipo: string; fecha_inicio: string; fecha_fin: string; descripcion: string | null }

  const personas = (personasRaw ?? []) as unknown as PRow[];
  const ausencias = (ausRaw ?? []) as unknown as ARow[];

  const dias = diasDelMes(year, month);

  // Construir mapa persona_id → ausencias
  const ausByPersona = new Map<string, ARow[]>();
  for (const a of ausencias) {
    if (!ausByPersona.has(a.persona_id)) ausByPersona.set(a.persona_id, []);
    ausByPersona.get(a.persona_id)!.push(a);
  }

  // Construir filas
  const filas: FilaPersona[] = personas.map((p) => {
    const personaInfo: PersonaConSeniority = {
      id: p.id,
      nombre: p.nombre,
      apellido: p.apellido,
      cargo_actual: p.cargo_actual,
      seniority_order: seniorityIdx(p.cargo_actual),
      fecha_ingreso: p.fecha_ingreso,
      is_leverager: p.is_leverager ?? false,
    };

    // Mapa día → celda
    const diasMap: Record<string, CeldaAusencia | null> = {};
    for (const d of dias) diasMap[d] = null;

    const ausPs = ausByPersona.get(p.id) ?? [];
    for (const a of ausPs) {
      const fechas = expandirRango(a.fecha_inicio, a.fecha_fin);
      for (const f of fechas) {
        if (f in diasMap) {
          diasMap[f] = {
            tipo: a.tipo as TipoAusencia,
            ausencia_id: a.id,
            descripcion: a.descripcion,
          };
        }
      }
    }

    return { persona: personaInfo, dias: diasMap };
  });

  // Ordenar por seniority, luego apellido
  filas.sort((a, b) => {
    if (a.persona.seniority_order !== b.persona.seniority_order) {
      return a.persona.seniority_order - b.persona.seniority_order;
    }
    return a.persona.apellido.localeCompare(b.persona.apellido, "es");
  });

  return { filas, dias, error: null };
}

// ─────────────────────────────────────────────────────────────
//  CRUD
// ─────────────────────────────────────────────────────────────

export async function crearAusencia(
  supabase: any,
  data: {
    persona_id: string;
    tipo: TipoAusencia;
    fecha_inicio: string;
    fecha_fin: string;
    descripcion?: string;
  }
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("ausencia").insert({
    persona_id: data.persona_id,
    tipo: data.tipo,
    fecha_inicio: data.fecha_inicio,
    fecha_fin: data.fecha_fin,
    descripcion: data.descripcion ?? null,
    // fuente = 'manual' por defecto (definido en el schema)
  });
  return { error: error?.message ?? null };
}

export async function eliminarAusencia(
  supabase: any,
  ausenciaId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("ausencia")
    .delete()
    .eq("id", ausenciaId);
  return { error: error?.message ?? null };
}

// ─────────────────────────────────────────────────────────────
//  Detalle de ausencias por persona
// ─────────────────────────────────────────────────────────────

export interface AusenciaDetalle {
  id: string;
  fechaInicio: string;    // "YYYY-MM-DD"
  fechaFin: string;       // "YYYY-MM-DD"
  numDias: number;        // días hábiles lun–vie
  tipo: TipoAusencia;
  tipoLabel: string;      // texto legible del tipo
  descripcion: string | null;
}

export interface DetalleAusenciasPersona {
  /** Ausencias cuya fecha_fin >= hoy (en curso o futuras) */
  ausenciasFuturas: AusenciaDetalle[];
  /** Ausencias ya terminadas dentro del año calendario actual (fecha_fin < hoy) */
  ausenciasPasadasAnioActual: AusenciaDetalle[];
  /** Suma de días hábiles de todas las ausencias del año actual (pasadas + en curso hasta hoy) */
  totalDiasAnioActual: number;
}

/**
 * Devuelve el desglose detallado de ausencias de una persona:
 * futuras, pasadas del año actual y total de días del año.
 */
export async function getDetailedPersonAbsences(
  supabase: any,
  personaId: string
): Promise<DetalleAusenciasPersona> {
  const hoy = new Date().toISOString().split("T")[0];          // "YYYY-MM-DD"
  const inicioAnio = `${new Date().getFullYear()}-01-01`;
  const finAnio    = `${new Date().getFullYear()}-12-31`;

  // Una sola query: todas las ausencias de esta persona en el año actual + futuras
  // Condición: fecha_fin >= inicioAnio (cubre todo el año + futuras sin límite)
  const { data, error } = await supabase
    .from("ausencia")
    .select("id, tipo, fecha_inicio, fecha_fin, descripcion")
    .eq("persona_id", personaId)
    .gte("fecha_fin", inicioAnio)   // descarta ausencias de años anteriores
    .order("fecha_inicio", { ascending: true });

  if (error || !data) {
    return { ausenciasFuturas: [], ausenciasPasadasAnioActual: [], totalDiasAnioActual: 0 };
  }

  type RawRow = { id: string; tipo: string; fecha_inicio: string; fecha_fin: string; descripcion: string | null };

  const ausenciasFuturas: AusenciaDetalle[] = [];
  const ausenciasPasadasAnioActual: AusenciaDetalle[] = [];
  let totalDiasAnioActual = 0;

  for (const row of data as RawRow[]) {
    const tipo = row.tipo as TipoAusencia;
    const numDias = expandirRango(row.fecha_inicio, row.fecha_fin).length;
    const detalle: AusenciaDetalle = {
      id: row.id,
      fechaInicio: row.fecha_inicio,
      fechaFin: row.fecha_fin,
      numDias,
      tipo,
      tipoLabel: COLOR_AUSENCIA[tipo]?.label ?? row.tipo,
      descripcion: row.descripcion,
    };

    const esFutura = row.fecha_fin >= hoy;          // termina hoy o más adelante
    const esPasadaDesteAnio = row.fecha_fin < hoy && row.fecha_inicio >= inicioAnio;

    if (esFutura) {
      ausenciasFuturas.push(detalle);
    }

    if (esPasadaDesteAnio) {
      ausenciasPasadasAnioActual.push(detalle);
    }

    // Contribución al total del año: días hábiles que caen dentro del año actual y hasta hoy
    if (row.fecha_inicio <= hoy && row.fecha_fin >= inicioAnio) {
      const finClamped  = row.fecha_fin  < hoy     ? row.fecha_fin  : hoy;
      const iniClamped  = row.fecha_inicio > inicioAnio ? row.fecha_inicio : inicioAnio;
      totalDiasAnioActual += expandirRango(iniClamped, finClamped).length;
    }
  }

  return { ausenciasFuturas, ausenciasPasadasAnioActual, totalDiasAnioActual };
}
