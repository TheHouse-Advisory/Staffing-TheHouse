import type { TypedSupabaseClient } from "@/lib/supabase/types";
import type { TipoAusencia } from "@/lib/types/database";

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
  vacaciones:        { bg: "#3b82f6", text: "#fff",   label: "Vacaciones" },
  dia_libre:         { bg: "#22c55e", text: "#fff",   label: "Día libre" },
  dia_administrativo:{ bg: "#f59e0b", text: "#fff",   label: "Día administrativo" },
  permiso:           { bg: "#a855f7", text: "#fff",   label: "Permiso" },
  licencia_medica:   { bg: "#ef4444", text: "#fff",   label: "Licencia médica" },
  capacitacion:      { bg: "#06b6d4", text: "#fff",   label: "Capacitación" },
  otro:              { bg: "#6b7280", text: "#fff",   label: "Otro" },
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

/** Genera array de fechas ISO "YYYY-MM-DD" para todos los días del mes */
export function diasDelMes(year: number, month: number): string[] {
  const dias: string[] = [];
  const totalDias = new Date(year, month, 0).getDate();  // month es 1-based
  for (let d = 1; d <= totalDias; d++) {
    const fecha = new Date(year, month - 1, d);
    // Excluir fines de semana
    const dow = fecha.getDay();
    if (dow !== 0 && dow !== 6) {
      dias.push(fecha.toISOString().split("T")[0]);
    }
  }
  return dias;
}

/** Expande un rango fecha_inicio..fecha_fin a array de fechas ISO */
function expandirRango(inicio: string, fin: string): string[] {
  const result: string[] = [];
  const start = new Date(inicio + "T00:00:00");
  const end = new Date(fin + "T00:00:00");
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) {
      result.push(cur.toISOString().split("T")[0]);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return result;
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
    .select("id, nombre, apellido, cargo_actual")
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

  interface PRow { id: string; nombre: string; apellido: string; cargo_actual: string | null }
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
