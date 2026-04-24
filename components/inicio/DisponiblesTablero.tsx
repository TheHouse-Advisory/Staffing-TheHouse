"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { createAnyClient } from "@/lib/supabase/client";
import type { Persona } from "@/lib/types/database";

const JERARQUIA: Record<string, number> = {
  "Socio": 1, "Director de Proyectos": 2, "Director": 2,
  "Gerente de Proyectos": 3, "Gerente": 3, "Asociado": 4,
  "Consultor Senior": 5, "Consultor de Proyectos": 6, "Consultor Proyecto": 6,
  "Consultor": 6, "Consultor Analista": 7, "Analista Senior": 7,
  "Consultor Trainee": 8, "Analista": 8, "Practicante": 9,
};

const COLORES: Record<string, string> = {
  "Socio": "#1a1a2e", "Director de Proyectos": "#4a90e2", "Director": "#4a90e2",
  "Gerente de Proyectos": "#7c5cbf", "Gerente": "#7c5cbf", "Asociado": "#e2884a",
  "Consultor Senior": "#4ab89a", "Consultor de Proyectos": "#e24a6a",
  "Consultor Analista": "#a0b84a", "Consultor Trainee": "#c07c4a",
};
const COLOR_DEFAULT = "#94a3b8";

function iniciales(nombre: string, apellido: string) {
  return `${nombre[0] ?? ""}${apellido[0] ?? ""}`.toUpperCase();
}

interface PersonaDisp {
  persona: Persona;
  disponibilidad: number;
}

interface Props {
  onVerPersona: (p: Persona) => void;
}

export function DisponiblesTablero({ onVerPersona }: Props) {
  const [disponibles, setDisponibles] = useState<PersonaDisp[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const sb = createAnyClient();
      const hoy = format(new Date(), "yyyy-MM-dd");

      const [persRes, asigRes] = await Promise.all([
        sb.from("persona").select("*").eq("activo", true),
        sb.from("asignacion")
          .select("persona_id, pct_dedicacion")
          .eq("estado", "activa")
          .lte("fecha_inicio", hoy)
          .gte("fecha_fin", hoy),
      ]);

      const personas = (persRes.data ?? []) as Persona[];
      const asignaciones = (asigRes.data ?? []) as { persona_id: string; pct_dedicacion: number }[];

      // Sumar ocupación por persona
      const ocupacion: Record<string, number> = {};
      for (const a of asignaciones) {
        ocupacion[a.persona_id] = (ocupacion[a.persona_id] ?? 0) + Number(a.pct_dedicacion);
      }

      const result: PersonaDisp[] = personas
        .map((p) => ({ persona: p, disponibilidad: Math.max(0, 100 - (ocupacion[p.id] ?? 0)) }))
        .filter((pd) => pd.disponibilidad > 0)
        .sort((a, b) => {
          const ia = JERARQUIA[a.persona.cargo_actual ?? ""] ?? 99;
          const ib = JERARQUIA[b.persona.cargo_actual ?? ""] ?? 99;
          if (ia !== ib) return ia - ib;
          return a.persona.apellido.localeCompare(b.persona.apellido);
        });

      setDisponibles(result);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <p className="text-sm text-gray-300 p-2">Cargando...</p>;
  if (disponibles.length === 0)
    return <p className="text-sm text-gray-300 italic p-2">Todo el equipo está al 100% hoy.</p>;

  // Agrupar por cargo
  const grupos: Record<string, PersonaDisp[]> = {};
  for (const pd of disponibles) {
    const cargo = pd.persona.cargo_actual ?? "Sin cargo";
    if (!grupos[cargo]) grupos[cargo] = [];
    grupos[cargo].push(pd);
  }

  const cargosOrdenados = Object.keys(grupos).sort((a, b) => {
    const ia = JERARQUIA[a] ?? 99;
    const ib = JERARQUIA[b] ?? 99;
    return ia !== ib ? ia - ib : a.localeCompare(b);
  });

  return (
    <div className="flex-1 overflow-y-auto space-y-4 pr-1">
      {cargosOrdenados.map((cargo) => (
        <div key={cargo}>
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
            {cargo}
          </p>
          <div className="flex flex-wrap gap-3">
            {grupos[cargo].map(({ persona, disponibilidad }) => {
              const color = COLORES[persona.cargo_actual ?? ""] ?? COLOR_DEFAULT;
              const pctColor =
                disponibilidad === 100
                  ? { bg: "#f0fdf4", text: "#16a34a" }
                  : disponibilidad >= 50
                  ? { bg: "#fefce8", text: "#ca8a04" }
                  : { bg: "#fff7ed", text: "#ea580c" };

              return (
                <button
                  key={persona.id}
                  onClick={() => onVerPersona(persona)}
                  title={`${persona.nombre} ${persona.apellido} — ${disponibilidad}% libre`}
                  className="flex flex-col items-center gap-1 hover:scale-105 transition-transform"
                >
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[13px] font-bold flex-shrink-0 shadow-sm"
                    style={{ backgroundColor: color }}
                  >
                    {iniciales(persona.nombre, persona.apellido)}
                  </div>
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none"
                    style={{ background: pctColor.bg, color: pctColor.text }}
                  >
                    {disponibilidad}%
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
