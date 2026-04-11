import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Helper para combinar clases Tailwind sin conflictos */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Convierte pct_dedicacion en color de la escala de ocupación */
export function colorOcupacion(pct: number): {
  bg: string;
  text: string;
} {
  if (pct === 0) return { bg: "#f0f0f0", text: "#888" };
  if (pct <= 50) return { bg: "#dcf5e7", text: "#1e7e45" };
  if (pct <= 80) return { bg: "#fff4d4", text: "#8a6200" };
  if (pct <= 99) return { bg: "#ffe4c4", text: "#c45000" };
  if (pct === 100) return { bg: "#ffd4d4", text: "#c02020" };
  return { bg: "#ffc0c0", text: "#c02020" }; // >100 sobreasignado
}

/** Formatea un porcentaje para mostrar */
export function formatPct(pct: number): string {
  return `${Math.round(pct)}%`;
}

/** Nombre completo de una persona */
export function nombreCompleto(nombre: string, apellido: string): string {
  return `${nombre} ${apellido}`;
}

/**
 * Parsea una fecha ISO "YYYY-MM-DD" como fecha LOCAL (no UTC).
 * Sin esto, new Date("2024-01-15") se interpreta como UTC medianoche,
 * que en zonas UTC-3/4 se convierte al día anterior.
 */
export function fLocal(dateStr: string | null | undefined): Date {
  if (!dateStr) return new Date();
  return new Date(dateStr + "T00:00:00");
}
