"use client";
import { useEffect, useState, useCallback } from "react";
import { createAnyClient } from "@/lib/supabase/client";

// Paleta amplia de colores distintos para tipos dinámicos (sin repetir los 7 base)
export const PALETA_DINAMICA = [
  "#f43f5e", // rose-500
  "#6366f1", // indigo-500
  "#14b8a6", // teal-500
  "#06b6d4", // cyan-500
  "#10b981", // emerald-500
  "#8b5cf6", // violet-500
  "#ec4899", // pink-500
  "#0ea5e9", // sky-500
  "#84cc16", // lime-500
  "#f59e0b", // amber-500
  "#ef4444", // red-500
  "#3b82f6", // blue-500
  "#d946ef", // fuchsia-500
  "#78716c", // stone-500
  "#0d9488", // teal-600
];

/** Dado el array actual de tipos, devuelve el siguiente color disponible de la paleta */
export function siguienteColor(tipos: { color_bg: string }[]): string {
  const usados = new Set(tipos.map((t) => t.color_bg));
  return PALETA_DINAMICA.find((c) => !usados.has(c)) ?? "#64748b"; // slate-500 como último fallback
}

export interface TipoAusenciaRow {
  id: string;
  label: string;
  color_bg: string;
  color_text: string;
}

// Tipos base del sistema: no se pueden eliminar (el Resumen de vacaciones y los colores dependen de ellos)
export const TIPOS_AUSENCIA_BASE = [
  "vacaciones_confirmadas", "vacaciones_por_confirmar", "permiso_sin_goce",
  "dia_post_proyecto", "dia_beneficio", "dia_administrativo", "otro",
];

// Evento para que todas las vistas (leyenda, colores, selects) recarguen al crear/borrar un tipo
const EVENTO_TIPOS = "tiposAusenciaChanged";

export function useTiposAusencia() {
  const [tipos, setTipos] = useState<TipoAusenciaRow[]>([]);
  const [loading, setLoading] = useState(true);

  const cargar = useCallback(async () => {
    const sb = createAnyClient();
    const { data } = await sb.from("tipo_ausencia").select("id, label, color_bg, color_text").order("created_at");
    setTipos((data as TipoAusenciaRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    cargar();
    window.addEventListener(EVENTO_TIPOS, cargar);
    return () => window.removeEventListener(EVENTO_TIPOS, cargar);
  }, [cargar]);

  /** Crea un nuevo tipo. Si no se pasa color, asigna el siguiente disponible de la paleta. */
  async function crearTipo(label: string, color?: string): Promise<{ tipo: TipoAusenciaRow | null; error: string | null }> {
    // Quita los acentos sin perder la letra ("Día" → "dia", antes quedaba "da")
    const id = label.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    if (!id) return { tipo: null, error: "El nombre debe tener letras o números." };
    const color_bg = color ?? siguienteColor(tipos);
    const sb = createAnyClient();
    const { data, error } = await sb
      .from("tipo_ausencia")
      .insert({ id, label: label.trim(), color_bg, color_text: "#fff" })
      .select()
      .single();
    // Se devuelve el error real: antes cualquier fallo se mostraba como "ya existe"
    if (error) return { tipo: null, error: error.code === "23505" ? "Ya existe un tipo con ese nombre." : error.message };
    await cargar();
    window.dispatchEvent(new Event(EVENTO_TIPOS));
    return { tipo: data as TipoAusenciaRow, error: null };
  }

  /**
   * Intenta eliminar un tipo.
   * Devuelve { ok: true } o { ok: false, count: number } si está en uso.
   */
  async function eliminarTipo(id: string): Promise<{ ok: boolean; count: number; error?: string }> {
    if (TIPOS_AUSENCIA_BASE.includes(id)) return { ok: false, count: 0, error: "Este es un tipo base del sistema y no se puede eliminar." };
    const sb = createAnyClient();
    const { count, error: countErr } = await sb.from("ausencia").select("id", { count: "exact", head: true }).eq("tipo", id);
    if (countErr) return { ok: false, count: 0, error: countErr.message };
    if ((count ?? 0) > 0) return { ok: false, count: count ?? 0 };
    // Antes no se revisaba: siempre decía "eliminado"
    const { error } = await sb.from("tipo_ausencia").delete().eq("id", id);
    if (error) return { ok: false, count: 0, error: error.message };
    await cargar();
    window.dispatchEvent(new Event(EVENTO_TIPOS));
    return { ok: true, count: 0 };
  }

  return { tipos, loading, crearTipo, eliminarTipo, recargar: cargar };
}
