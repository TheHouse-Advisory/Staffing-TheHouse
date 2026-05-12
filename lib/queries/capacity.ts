import { SENIORITY_ORDER } from "@/lib/queries/ausencias";

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

export function cargoAGrupo(cargo: string | null): string {
  if (!cargo) return "Sin cargo";
  return CAPACITY_GRUPO[cargo] ?? cargo;
}

// ─────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────

export interface PersonaCapacity {
  id: string;
  nombre: string;
  apellido: string;
  cargo_actual: string | null;
  seniority_order: number;
}

export interface CapacityData {
  personas: PersonaCapacity[];
  semanas: string[];           // fechas ISO de los lunes del año
  // persona_id → semana_inicio → capacidad
  valores: Record<string, Record<string, number>>;
}

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

function seniorityIdx(cargo: string | null): number {
  if (!cargo) return SENIORITY_ORDER.length;
  const idx = SENIORITY_ORDER.findIndex((s) => s.toLowerCase() === cargo.toLowerCase());
  return idx === -1 ? SENIORITY_ORDER.length : idx;
}

/** Genera todos los lunes del año dado como fechas ISO */
export function semanasDelAnio(year: number): string[] {
  const semanas: string[] = [];
  // Busca el primer lunes del año (o del año anterior si el año empieza en mitad de semana)
  const start = new Date(year, 0, 1);
  // Avanza hasta el primer lunes
  const dow = start.getDay(); // 0=dom, 1=lun...
  const diff = dow === 0 ? 1 : dow === 1 ? 0 : 8 - dow;
  start.setDate(start.getDate() + diff);

  const cur = new Date(start);
  while (cur.getFullYear() <= year) {
    const iso = cur.toISOString().split("T")[0];
    if (new Date(iso).getFullYear() === year || semanas.length === 0) {
      semanas.push(iso);
    }
    cur.setDate(cur.getDate() + 7);
    if (cur.getFullYear() > year) break;
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
//  Fetch
// ─────────────────────────────────────────────────────────────

export async function fetchCapacityData(supabase: any, year: number): Promise<CapacityData> {
  const semanas = semanasDelAnio(year);
  const primeraSemana = semanas[0];
  const ultimaSemana  = semanas[semanas.length - 1];

  const [persRes, capRes] = await Promise.all([
    supabase
      .from("persona")
      .select("id, nombre, apellido, cargo_actual")
      .eq("activo", true)
      .order("apellido"),
    supabase
      .from("capacity_planning")
      .select("persona_id, semana_inicio, capacidad")
      .gte("semana_inicio", primeraSemana)
      .lte("semana_inicio", ultimaSemana),
  ]);

  const personas: PersonaCapacity[] = ((persRes.data ?? []) as any[])
    .map((p) => ({
      id: p.id,
      nombre: p.nombre,
      apellido: p.apellido,
      cargo_actual: p.cargo_actual,
      seniority_order: seniorityIdx(p.cargo_actual),
    }))
    .sort((a, b) =>
      a.seniority_order !== b.seniority_order
        ? a.seniority_order - b.seniority_order
        : a.apellido.localeCompare(b.apellido, "es")
    );

  // Construir mapa persona → semana → valor (default 1)
  const valores: Record<string, Record<string, number>> = {};
  for (const p of personas) valores[p.id] = {};

  for (const row of (capRes.data ?? []) as { persona_id: string; semana_inicio: string; capacidad: number }[]) {
    if (valores[row.persona_id]) {
      valores[row.persona_id][row.semana_inicio] = row.capacidad;
    }
  }

  return { personas, semanas, valores };
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
): Promise<void> {
  const rows = personaIds.flatMap((pid) =>
    semanas.map((sem) => ({ persona_id: pid, semana_inicio: sem, capacidad }))
  );
  // Supabase admite hasta ~500 filas por upsert; particionamos si es necesario
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await supabase
      .from("capacity_planning")
      .upsert(rows.slice(i, i + CHUNK), { onConflict: "persona_id,semana_inicio" });
  }
}
