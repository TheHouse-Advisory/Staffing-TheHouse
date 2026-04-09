/**
 * Queries para el Tablero de Capacidad.
 * Consume la vista ocupacion_semana y la función ocupacion_semana_con_plan.
 */
import { format, addWeeks, startOfISOWeek } from "date-fns";
import type { TypedSupabaseClient } from "@/lib/supabase/types";
import type { OcupacionSemana } from "@/lib/types/database";

export const SEMANAS_VISIBLES = 6;

// Jerarquía de cargos para ordenar el tablero
export const ORDEN_CARGO: Record<string, number> = {
  Socio: 1,
  Director: 2,
  Gerente: 3,
  Asociado: 4,
  "Consultor Senior": 5,
  "Consultor Proyecto": 6,
  "Consultor Analista": 7,
};

export interface FilaPersona {
  persona_id: string;
  persona_nombre: string;
  cargo_actual: string;
  semanas: Record<string, { actual: number; proyectado: number }>;
}

/**
 * Obtiene los datos de ocupación para el rango de semanas visible.
 * @param supabase  Cliente tipado de Supabase
 * @param desde     Fecha de inicio del rango (lunes de la primera semana)
 * @param cantidad  Número de semanas a mostrar (default: SEMANAS_VISIBLES)
 */
export async function fetchOcupacionSemanas(
  supabase: TypedSupabaseClient,
  desde: Date,
  cantidad = SEMANAS_VISIBLES
): Promise<{ filas: FilaPersona[]; semanas: Date[]; error: string | null }> {
  const inicio = startOfISOWeek(desde);
  const fin = addWeeks(inicio, cantidad);

  const { data, error } = await supabase
    .from("ocupacion_semana")
    .select("*")
    .gte("semana_inicio", format(inicio, "yyyy-MM-dd"))
    .lt("semana_inicio", format(fin, "yyyy-MM-dd"))
    .order("persona_nombre");

  if (error) return { filas: [], semanas: [], error: error.message };
  if (!data || data.length === 0)
    return { filas: [], semanas: [], error: null };

  // Calcular las semanas del rango para los headers de columna
  const semanas: Date[] = Array.from({ length: cantidad }, (_, i) =>
    addWeeks(inicio, i)
  );

  // Pivotear: agrupar por persona_id y poner semanas como keys
  const porPersona = new Map<string, FilaPersona>();

  for (const row of data as OcupacionSemana[]) {
    if (!porPersona.has(row.persona_id)) {
      porPersona.set(row.persona_id, {
        persona_id: row.persona_id,
        persona_nombre: row.persona_nombre,
        cargo_actual: row.cargo_actual,
        semanas: {},
      });
    }
    const fila = porPersona.get(row.persona_id)!;
    fila.semanas[row.semana_inicio] = {
      actual: Number(row.ocupacion_actual_pct),
      proyectado: Number(row.ocupacion_proyectada_pct),
    };
  }

  // Ordenar por jerarquía de cargo, luego nombre
  const filas = Array.from(porPersona.values()).sort((a, b) => {
    const ordenA = ORDEN_CARGO[a.cargo_actual] ?? 99;
    const ordenB = ORDEN_CARGO[b.cargo_actual] ?? 99;
    if (ordenA !== ordenB) return ordenA - ordenB;
    return a.persona_nombre.localeCompare(b.persona_nombre, "es");
  });

  return { filas, semanas, error: null };
}

/**
 * Obtiene los datos de ocupación proyectada para un plan específico.
 * Llama a la función PG ocupacion_semana_con_plan(planId).
 */
export async function fetchOcupacionSemanasPlan(
  supabase: TypedSupabaseClient,
  desde: Date,
  planId: string,
  cantidad = SEMANAS_VISIBLES
): Promise<{ filas: FilaPersona[]; semanas: Date[]; error: string | null }> {
  const inicio = startOfISOWeek(desde);
  const fin = addWeeks(inicio, cantidad);

  // La función PG devuelve filas para todas las semanas disponibles;
  // filtramos en cliente al rango visible.
  const { data, error } = await supabase
    .rpc("ocupacion_semana_con_plan", { p_plan_id: planId });

  if (error) return { filas: [], semanas: [], error: error.message };
  if (!data || data.length === 0)
    return { filas: [], semanas: [], error: null };

  const inicioStr = format(inicio, "yyyy-MM-dd");
  const finStr    = format(fin, "yyyy-MM-dd");

  const filasFiltradas = (data as OcupacionSemana[]).filter(
    (r) => r.semana_inicio >= inicioStr && r.semana_inicio < finStr
  );

  const semanas: Date[] = Array.from({ length: cantidad }, (_, i) =>
    addWeeks(inicio, i)
  );

  const porPersona = new Map<string, FilaPersona>();

  for (const row of filasFiltradas) {
    if (!porPersona.has(row.persona_id)) {
      porPersona.set(row.persona_id, {
        persona_id: row.persona_id,
        persona_nombre: row.persona_nombre,
        cargo_actual: row.cargo_actual,
        semanas: {},
      });
    }
    const fila = porPersona.get(row.persona_id)!;
    fila.semanas[row.semana_inicio] = {
      actual: Number(row.ocupacion_actual_pct),
      proyectado: Number(row.ocupacion_proyectada_pct),
    };
  }

  const filas = Array.from(porPersona.values()).sort((a, b) => {
    const ordenA = ORDEN_CARGO[a.cargo_actual] ?? 99;
    const ordenB = ORDEN_CARGO[b.cargo_actual] ?? 99;
    if (ordenA !== ordenB) return ordenA - ordenB;
    return a.persona_nombre.localeCompare(b.persona_nombre, "es");
  });

  return { filas, semanas, error: null };
}
