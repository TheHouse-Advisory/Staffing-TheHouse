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
  iniciales: string | null;
  seniority_order: number;
}

export interface AusenciaCapacity {
  persona_id: string;
  fecha_inicio: string;  // YYYY-MM-DD
  fecha_fin: string;     // YYYY-MM-DD
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
  const idx = SENIORITY_ORDER.findIndex((s) => s.toLowerCase() === cargo.toLowerCase());
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
//  Fetch
// ─────────────────────────────────────────────────────────────

export async function fetchCapacityData(supabase: any, year: number): Promise<CapacityData> {
  const semanas = semanasDelAnio(year);
  const primeraSemana = semanas[0];
  const ultimaSemana  = semanas[semanas.length - 1];

  const inicioAnio = `${year}-01-01`;
  const finAnio    = `${year}-12-31`;

  // Personas y ausencias no tienen problema de límite de filas
  const [persRes, ausRes] = await Promise.all([
    supabase
      .from("persona")
      .select("id, nombre, apellido, cargo_actual, iniciales")
      .eq("activo", true)
      .order("apellido"),
    supabase
      .from("ausencia")
      .select("persona_id, fecha_inicio, fecha_fin")
      .lte("fecha_inicio", finAnio)
      .gte("fecha_fin", inicioAnio),
  ]);

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

  const personas: PersonaCapacity[] = ((persRes.data ?? []) as any[])
    .map((p) => ({
      id: p.id,
      nombre: p.nombre,
      apellido: p.apellido,
      cargo_actual: p.cargo_actual,
      iniciales: (p as any).iniciales ?? null,
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

  for (const row of capRows) {
    if (valores[row.persona_id]) {
      const parsed = parseFloat(String(row.capacidad));
      valores[row.persona_id][row.semana_inicio] = isNaN(parsed) ? 1 : parsed;
    }
  }

  const ausencias: AusenciaCapacity[] = (ausRes.data ?? []) as AusenciaCapacity[];

  return { personas, semanas, valores, ausencias };
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
