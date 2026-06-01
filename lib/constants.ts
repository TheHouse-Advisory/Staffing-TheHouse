// ─────────────────────────────────────────────────────────────
//  Constantes canónicas del dominio — fuente única de verdad
// ─────────────────────────────────────────────────────────────

/** Los cargos válidos, en orden de seniority descendente */
export const CARGOS = [
  "Socio",
  "Director de Proyectos",
  "Gerente de Proyectos",
  "Asociado",
  "Consultor Senior",
  "Consultor de Proyectos",
  "Consultor Analista",
  "Consultor Trainee",
  "Desarrollo",
] as const;

export type CargoNombre = typeof CARGOS[number];

/** Para usar en selects de formularios — Asociado y Consultor Senior son la misma categoría */
export const CARGOS_OPTIONS = [
  { value: "Socio",                       label: "Socio" },
  { value: "Director / Gerente de Proyectos", label: "Director / Gerente de Proyectos" },
  { value: "Asociado / Consultor Senior", label: "Asociado / Consultor Senior" },
  { value: "Consultor de Proyectos",      label: "Consultor de Proyectos" },
  { value: "Consultor Analista",          label: "Consultor Analista" },
  { value: "Consultor Trainee",           label: "Consultor Trainee" },
  { value: "Desarrollo",                  label: "Desarrollo" },
];

/** Color por cargo — fuente única para toda la app */
export const CARGO_COLORS: Record<string, string> = {
  "Socio":                   "#1a1a2e",
  "Director / Gerente de Proyectos": "#4a90e2",
  "Asociado":                       "#e2884a",
  "Consultor Senior":               "#4ab89a",
  "Asociado / Consultor Senior":    "#e2884a",
  "Consultor de Proyectos":  "#e24a6a",
  "Consultor Analista":      "#a0b84a",
  "Consultor Trainee":       "#c07c4a",
  "Desarrollo":              "#94a3b8",
};
export const CARGO_COLOR_DEFAULT = "#94a3b8";

/** Cargos que el rol GyD NO puede ver en ninguna pantalla */
export const CARGOS_OCULTOS_GYD: string[] = [
  "Socio",
  "Director de Proyectos",
  "Director",
  "Gerente de Proyectos",
  "Gerente",
  "Desarrollo",
];

/** Estilos por estado de engagement */
export const ESTADO_ENGAGEMENT: Record<string, { bg: string; text: string; label: string }> = {
  activo:    { bg: "#dcf5e7", text: "#1e7e45", label: "Activo" },
  terminado: { bg: "#f0f0f0", text: "#666",    label: "Terminado" },
};
