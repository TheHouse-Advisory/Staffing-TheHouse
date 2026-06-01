"use client";

import { useMemo, useState } from "react";
import { differenceInCalendarDays, parseISO, addDays, format } from "date-fns";
import { ChevronUp, ChevronDown } from "lucide-react";
import type { Persona } from "@/lib/types/database";

export interface AsigDetalle {
  persona_id: string;
  fecha_fin: string;
  tipo: string;
}

interface AusenciaItem { persona_id: string; fecha_inicio: string; fecha_fin: string; }

interface Props {
  personas: Persona[];
  asignaciones: AsigDetalle[];
  ausencias?: AusenciaItem[];
}

type Estado = "libre" | "pronto" | "comercial";

interface DisponibleItem {
  persona: Persona;
  estado: Estado;
  dias?: number;
}

function excluir(cargo: string | null): boolean {
  if (!cargo) return false;
  const c = cargo.toLowerCase();
  return c.includes("socio") || c.includes("desarrollo");
}

const BADGE: Record<Estado, { bg: string; text: string; label: (d?: number) => string }> = {
  libre:     { bg: "#f0fdf4", text: "#16a34a", label: () => "Libre" },
  comercial: { bg: "#faf5ff", text: "#7c3aed", label: () => "Frente Comercial" },
  pronto:    { bg: "#fff7ed", text: "#c2410c", label: (d) => d === 0 ? "Hoy" : `En ${d}d` },
};

export function DisponiblesTablero({ personas, asignaciones, ausencias = [] }: Props) {
  const [colapsado, setColapsado] = useState(false);

  const disponibles = useMemo((): DisponibleItem[] => {
    const hoy = new Date();
    const hoyStr = format(hoy, "yyyy-MM-dd");
    const en7diasStr = format(addDays(hoy, 7), "yyyy-MM-dd");
    // Set de IDs con ausencia activa hoy o que inicia en los próximos 7 días
    const conAusencia = new Set(
      ausencias
        .filter((a) => a.fecha_inicio <= en7diasStr && a.fecha_fin >= hoyStr)
        .map((a) => a.persona_id)
    );
    const result: DisponibleItem[] = [];

    for (const p of personas) {
      if (excluir(p.cargo_actual)) continue;
      if (conAusencia.has(p.id)) continue; // excluir personas con ausencia en el rango

      const asigs = asignaciones.filter((a) => a.persona_id === p.id);

      if (asigs.length === 0) {
        result.push({ persona: p, estado: "libre" });
        continue;
      }

      // Liberación pronta: alguna asignación termina en ≤7 días
      const terminaProx = asigs
        .filter((a) => a.fecha_fin >= hoyStr && a.fecha_fin <= en7diasStr)
        .sort((a, b) => a.fecha_fin.localeCompare(b.fecha_fin))[0];

      if (terminaProx) {
        const dias = Math.max(0, differenceInCalendarDays(parseISO(terminaProx.fecha_fin), hoy));
        result.push({ persona: p, estado: "pronto", dias });
        continue;
      }

      // Frente comercial: TODAS las asignaciones son propuestas
      if (asigs.every((a) => a.tipo === "propuesta")) {
        result.push({ persona: p, estado: "comercial" });
      }
    }

    // Orden: pronto (más urgente primero) → comercial → libre
    return result.sort((a, b) => {
      const ord: Record<Estado, number> = { pronto: 0, comercial: 1, libre: 2 };
      if (a.estado !== b.estado) return ord[a.estado] - ord[b.estado];
      if (a.estado === "pronto") return (a.dias ?? 99) - (b.dias ?? 99);
      return `${a.persona.apellido}${a.persona.nombre}`.localeCompare(`${b.persona.apellido}${b.persona.nombre}`);
    });
  }, [personas, asignaciones, ausencias]);

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col flex-shrink-0">
      {/* Header con toggle */}
      <div className="flex items-center justify-between flex-shrink-0" style={{ marginBottom: colapsado ? 0 : 8 }}>
        <div className="flex items-center gap-2">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
            Disponibles próximamente
          </p>
          {disponibles.length > 0 && (
            <span className="text-[10px] font-semibold text-gray-300">{disponibles.length}</span>
          )}
        </div>
        <button
          onClick={() => setColapsado((v) => !v)}
          className="p-1 rounded hover:bg-gray-100 text-gray-400 transition-colors"
          title={colapsado ? "Expandir" : "Colapsar"}
        >
          {colapsado ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>
      </div>

      {!colapsado && (
        disponibles.length === 0 ? (
          <p className="text-xs text-gray-300 italic">Sin disponibilidades próximas.</p>
        ) : (
          <div
            className="space-y-2 overflow-y-auto [&::-webkit-scrollbar]:hidden"
            style={{ scrollbarWidth: "none", maxHeight: 180 }}
          >
            {disponibles.map(({ persona, estado, dias }) => {
              const b = BADGE[estado];
              return (
                <div key={persona.id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold text-[#1a1a2e] truncate leading-tight">
                      {persona.nombre} {persona.apellido}
                    </p>
                    <p className="text-[10px] text-gray-400 truncate">{persona.cargo_actual ?? "Sin cargo"}</p>
                  </div>
                  <span
                    className="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full leading-none whitespace-nowrap"
                    style={{ background: b.bg, color: b.text }}
                  >
                    {b.label(dias)}
                  </span>
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
