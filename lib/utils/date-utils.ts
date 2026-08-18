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

/**
 * Dado un día de inicio, calcula el viernes hábil que garantiza cubrir al menos 5 días
 * hábiles desde ese inicio — regla de staffing para engagements tipo "Propuesta Comercial".
 * Si el inicio cae lunes (o domingo), el viernes de esa misma semana ya cubre los 5 días
 * hábiles exactos. Cualquier otro día (martes a viernes, o sábado) no alcanza a cubrir la
 * semana completa, así que se usa el viernes de la semana siguiente. Si ese viernes cae en
 * feriado, se sigue avanzando de a una semana hasta encontrar un viernes hábil.
 */
export function obtenerViernesSemanaHabil(fechaInicio: Date): Date {
  const dow = fechaInicio.getDay(); // 0=dom … 6=sáb
  const viernes = new Date(fechaInicio);
  viernes.setDate(fechaInicio.getDate() + (5 - dow)); // viernes de la semana calendario de inicio

  const inicioISO = fechaInicio.toISOString().split("T")[0];
  const viernesISO = viernes.toISOString().split("T")[0];
  const cubreSemana = viernesISO >= inicioISO && calculateBusinessDays(inicioISO, viernesISO) >= 5;
  if (!cubreSemana) viernes.setDate(viernes.getDate() + 7);

  while (isHoliday(viernes.toISOString().split("T")[0])) {
    viernes.setDate(viernes.getDate() + 7);
  }
  return viernes;
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
