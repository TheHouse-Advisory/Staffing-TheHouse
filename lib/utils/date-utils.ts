import { isHoliday } from "@/lib/constants/holidays";

/**
 * Días hábiles entre dos fechas ISO, excluyendo fines de semana y feriados Chile.
 * Reemplaza el conteo simple de expandirRango donde se necesite precisión.
 */
export function calculateBusinessDays(startDate: string, endDate: string): number {
  let count = 0;
  const cur = new Date(startDate + "T00:00:00");
  const end = new Date(endDate   + "T00:00:00");

  while (cur <= end) {
    const dow = cur.getDay();
    const iso = cur.toISOString().split("T")[0];
    if (dow !== 0 && dow !== 6 && !isHoliday(iso)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/**
 * Días hábiles efectivos en un cargo dado su rango.
 * Alias semántico de calculateBusinessDays para uso en historial_cargos.
 * fecha_fin puede ser la fecha de hoy si el cargo sigue activo.
 */
export function calcularDiasHabilesEnCargo(fechaInicio: string, fechaFin: string): number {
  return calculateBusinessDays(fechaInicio, fechaFin);
}

/** Igual que expandirRango pero excluye feriados además de fines de semana */
export function expandirRangoHabil(inicio: string, fin: string): string[] {
  const result: string[] = [];
  const cur = new Date(inicio + "T00:00:00");
  const end = new Date(fin    + "T00:00:00");

  while (cur <= end) {
    const dow = cur.getDay();
    const iso = cur.toISOString().split("T")[0];
    if (dow !== 0 && dow !== 6 && !isHoliday(iso)) result.push(iso);
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}
