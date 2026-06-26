import type { TypedSupabaseClient } from "@/lib/supabase/types";
import { calcularDiasHabilesEnCargo } from "@/lib/utils/date-utils";

export interface HistorialCargoRow {
  id: string;
  persona_id: string;
  cargo: string;
  fecha_inicio: string;       // ISO date
  fecha_fin: string | null;   // ISO date | null = cargo actual
  created_at: string;
  dias_habiles?: number;      // calculado en cliente
}

/**
 * Obtiene el historial de cargos de una persona ordenado cronológicamente
 * y calcula los días hábiles efectivos en cada cargo.
 */
export async function getHistorialCargos(
  supabase: TypedSupabaseClient,
  personaId: string
): Promise<HistorialCargoRow[]> {
  const { data, error } = await supabase
    .from("historial_cargos")
    .select("id, persona_id, cargo, fecha_inicio, fecha_fin, created_at")
    .eq("persona_id", personaId)
    .order("fecha_inicio", { ascending: true });

  if (error || !data) return [];

  const hoy = new Date().toISOString().split("T")[0];

  return (data as HistorialCargoRow[]).map((row) => ({
    ...row,
    dias_habiles: calcularDiasHabilesEnCargo(
      row.fecha_inicio,
      row.fecha_fin ?? hoy
    ),
  }));
}
