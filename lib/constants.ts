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
  // Socio
  "Socio": "#1a1a2e",
  // Director / Gerente
  "Director / Gerente de Proyectos": "#4a90e2",
  "Director de Proyectos": "#4a90e2",
  "Director": "#4a90e2",
  "Gerente de Proyectos": "#4a90e2",
  "Gerente": "#4a90e2",
  // Asociado / Consultor Senior
  "Asociado / Consultor Senior": "#e2884a",
  "Asociado": "#e2884a",
  "Consultor Senior": "#4ab89a",
  // Consultor de Proyectos
  "Consultor de Proyectos": "#e24a6a",
  "Consultor Proyecto": "#e24a6a",
  "Consultor": "#e24a6a",
  // Consultor Analista / Analista Senior
  "Consultor Analista": "#a0b84a",
  "Analista Senior": "#a0b84a",
  // Consultor Trainee / Analista / Practicante
  "Consultor Trainee": "#c07c4a",
  "Analista": "#c07c4a",
  "Practicante": "#c07c4a",
  // Desarrollo / otros
  "Desarrollo": "#94a3b8",
};
export const CARGO_COLOR_DEFAULT = "#94a3b8";

/** Devuelve el color del cargo, buscando coincidencia parcial si no hay exacta. */
export function getCargoColor(cargo: string | null | undefined): string {
  if (!cargo) return CARGO_COLOR_DEFAULT;
  if (CARGO_COLORS[cargo]) return CARGO_COLORS[cargo];
  // Partial match: busca la key que está contenida en el cargo o viceversa
  const c = cargo.toLowerCase();
  for (const [key, color] of Object.entries(CARGO_COLORS)) {
    if (c.includes(key.toLowerCase()) || key.toLowerCase().includes(c)) return color;
  }
  return CARGO_COLOR_DEFAULT;
}

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
