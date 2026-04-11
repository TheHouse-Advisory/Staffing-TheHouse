// ─────────────────────────────────────────────────────────────
//  Constantes canónicas del dominio — fuente única de verdad
// ─────────────────────────────────────────────────────────────

/** Los 8 cargos válidos, en orden de seniority descendente */
export const CARGOS = [
  "Socio",
  "Director de Proyectos",
  "Gerente de Proyectos",
  "Asociado",
  "Consultor Senior",
  "Consultor de Proyectos",
  "Consultor Analista",
  "Consultor Trainee",
] as const;

export type CargoNombre = typeof CARGOS[number];

/** Para usar en selects de formularios */
export const CARGOS_OPTIONS = CARGOS.map((c) => ({ value: c, label: c }));

/** Estilos por estado de engagement */
export const ESTADO_ENGAGEMENT: Record<string, { bg: string; text: string; label: string }> = {
  activo:    { bg: "#dcf5e7", text: "#1e7e45", label: "Activo" },
  terminado: { bg: "#f0f0f0", text: "#666",    label: "Terminado" },
};
