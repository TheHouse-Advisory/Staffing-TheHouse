"use client";

import { useEffect, useState } from "react";
import {
  startOfISOWeek, addDays, addWeeks, addMonths,
  subWeeks, subMonths, format, startOfMonth, endOfMonth,
  eachWeekOfInterval, startOfWeek, endOfWeek, isSameMonth,
} from "date-fns";
import { es } from "date-fns/locale";
import { createAnyClient } from "@/lib/supabase/client";
import type { Persona } from "@/lib/types/database";

// ── Jerarquía de cargos ──────────────────────────────────────
const JERARQUIA = [
  "Socio", "Director de Proyectos", "Director",
  "Gerente de Proyectos", "Gerente", "Asociado",
  "Consultor Senior", "Consultor de Proyectos", "Consultor Proyecto",
  "Consultor", "Consultor Analista", "Analista Senior",
  "Consultor Trainee", "Analista", "Practicante",
];

const COLORES: Record<string, string> = {
  "Socio": "#1a1a2e", "Director de Proyectos": "#4a90e2", "Director": "#4a90e2",
  "Gerente de Proyectos": "#7c5cbf", "Gerente": "#7c5cbf", "Asociado": "#e2884a",
  "Consultor Senior": "#4ab89a", "Consultor de Proyectos": "#e24a6a",
  "Consultor Analista": "#a0b84a", "Consultor Trainee": "#c07c4a",
};
const COLOR_DEFAULT = "#94a3b8";

type Vista = "dia" | "semana" | "mes";

interface AusenciaRaw { persona_id: string; fecha_inicio: string; fecha_fin: string; }

function iniciales(nombre: string, apellido: string) {
  return `${nombre[0] ?? ""}${apellido[0] ?? ""}`.toUpperCase();
}

function rangoSolapan(aIni: string, aFin: string, cIni: Date, cFin: Date) {
  return new Date(aIni) <= cFin && new Date(aFin) >= cIni;
}

function ordenarPorCargo(personas: Persona[]) {
  return [...personas].sort((a, b) => {
    const ia = JERARQUIA.indexOf(a.cargo_actual ?? "");
    const ib = JERARQUIA.indexOf(b.cargo_actual ?? "");
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

interface Columna { label: string; sublabel: string; inicio: Date; fin: Date; }

function columnasDia(base: Date): Columna[] {
  const lunes = startOfISOWeek(base);
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(lunes, i);
    return {
      label: format(d, "EEE", { locale: es }),
      sublabel: format(d, "d MMM", { locale: es }),
      inicio: d,
      fin: d,
    };
  });
}

function columnasSemana(base: Date): Columna[] {
  const inicio = startOfISOWeek(base);
  return Array.from({ length: 5 }, (_, i) => {
    const s = addWeeks(inicio, i);
    const fin = addDays(s, 6);
    return {
      label: format(s, "d MMM", { locale: es }),
      sublabel: format(fin, "d MMM", { locale: es }),
      inicio: s,
      fin,
    };
  });
}

function columnasMes(base: Date): Columna[] {
  return Array.from({ length: 4 }, (_, i) => {
    const m = addMonths(base, i);
    return {
      label: format(m, "MMM", { locale: es }),
      sublabel: format(m, "yyyy"),
      inicio: startOfMonth(m),
      fin: endOfMonth(m),
    };
  });
}

interface GanttAusenciasProps {
  onVerPersona: (p: Persona) => void;
  vistaExterna?: Vista;
  baseExterna?: Date;
}

export function GanttAusencias({ onVerPersona, vistaExterna, baseExterna }: GanttAusenciasProps) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [ausencias, setAusencias] = useState<AusenciaRaw[]>([]);
  const [loading, setLoading] = useState(true);

  const vista: Vista = vistaExterna ?? "semana";
  const base: Date = baseExterna ?? new Date();

  useEffect(() => {
    async function load() {
      const sb = createAnyClient();
      const [pRes, aRes] = await Promise.all([
        sb.from("persona").select("*").eq("activo", true),
        sb.from("ausencia").select("persona_id, fecha_inicio, fecha_fin"),
      ]);
      setPersonas(pRes.data ?? []);
      setAusencias(aRes.data ?? []);
      setLoading(false);
    }
    load();
  }, []);

  const columnas: Columna[] =
    vista === "dia" ? columnasDia(base) :
    vista === "semana" ? columnasSemana(base) :
    columnasMes(base);

  function ausentesEnColumna(col: Columna): Persona[] {
    const ids = new Set(
      ausencias
        .filter((a) => rangoSolapan(a.fecha_inicio, a.fecha_fin, col.inicio, col.fin))
        .map((a) => a.persona_id)
    );
    return ordenarPorCargo(personas.filter((p) => ids.has(p.id)));
  }

  return (
    <div className="flex flex-col h-full">

      {/* ── Gantt ──────────────────────────────── */}
      {loading ? (
        <p className="text-sm text-gray-300">Cargando...</p>
      ) : (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex gap-2 h-full" style={{ minWidth: `${columnas.length * 80}px` }}>
            {columnas.map((col, i) => {
              const ausentes = ausentesEnColumna(col);
              const hoy = new Date();
              const esHoy = col.inicio <= hoy && hoy <= col.fin;
              return (
                <div
                  key={i}
                  className="flex flex-col flex-1 min-w-[72px]"
                >
                  {/* Cabecera columna */}
                  <div
                    className="text-center pb-2 flex-shrink-0"
                  >
                    <p
                      className="text-[11px] font-bold capitalize"
                      style={{ color: esHoy ? "#4a90e2" : "#888" }}
                    >
                      {col.label}
                    </p>
                    <p className="text-[10px] text-gray-300">{col.sublabel}</p>
                  </div>

                  {/* Celda con círculos */}
                  <div
                    className="flex-1 rounded-lg p-1.5 flex flex-col gap-1 overflow-y-auto"
                    style={{
                      background: esHoy ? "#eaf4ff" : "#f9f9f9",
                      border: esHoy ? "1.5px solid #bfdbfe" : "1.5px solid #f0f0f0",
                    }}
                  >
                    {ausentes.length === 0 ? (
                      <div className="flex-1 flex items-center justify-center">
                        <span className="text-[10px] text-gray-200">—</span>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1 content-start">
                        {ausentes.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => onVerPersona(p)}
                            title={`${p.nombre} ${p.apellido}`}
                            className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 hover:scale-110 transition-transform"
                            style={{ backgroundColor: COLORES[p.cargo_actual ?? ""] ?? COLOR_DEFAULT }}
                          >
                            {iniciales(p.nombre, p.apellido)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
