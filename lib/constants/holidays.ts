// Feriados Chile 2026 y 2027 — fuente: Ley N°2.977 y feriados variables
export const CHILE_HOLIDAYS = new Set<string>([
  // 2026
  "2026-01-01", // Año Nuevo
  "2026-04-03", // Viernes Santo
  "2026-04-04", // Sábado Santo
  "2026-05-01", // Día del Trabajador
  "2026-05-21", // Glorias Navales
  "2026-06-07", // Corpus Christi (domingo, se traslada al lunes)
  "2026-06-29", // San Pedro y San Pablo
  "2026-07-16", // Virgen del Carmen
  "2026-08-15", // Asunción de la Virgen
  "2026-09-18", // Independencia Nacional
  "2026-09-19", // Glorias del Ejército
  "2026-10-12", // Encuentro de Dos Mundos
  "2026-10-31", // Día de las Iglesias Evangélicas
  "2026-11-01", // Día de Todos los Santos
  "2026-12-08", // Inmaculada Concepción
  "2026-12-25", // Navidad

  // 2027
  "2027-01-01", // Año Nuevo
  "2027-03-26", // Viernes Santo
  "2027-03-27", // Sábado Santo
  "2027-05-01", // Día del Trabajador
  "2027-05-21", // Glorias Navales
  "2027-06-21", // Corpus Christi (tentativo)
  "2027-06-28", // San Pedro y San Pablo (traslado al lunes)
  "2027-07-16", // Virgen del Carmen
  "2027-08-15", // Asunción de la Virgen
  "2027-09-18", // Independencia Nacional
  "2027-09-19", // Glorias del Ejército
  "2027-10-11", // Encuentro de Dos Mundos (traslado al lunes)
  "2027-10-31", // Día de las Iglesias Evangélicas
  "2027-11-01", // Día de Todos los Santos
  "2027-12-08", // Inmaculada Concepción
  "2027-12-25", // Navidad
]);

export function isHoliday(fechaISO: string): boolean {
  return CHILE_HOLIDAYS.has(fechaISO);
}
