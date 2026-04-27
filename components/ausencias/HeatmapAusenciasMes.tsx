"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { COLOR_AUSENCIA } from "@/lib/queries/ausencias";
import type { TipoAusencia } from "@/lib/types/database";

const MESES_CORTO = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

const JERARQUIA = [
  "Socio","Director de Proyectos","Director",
  "Gerente de Proyectos","Gerente","Asociado",
  "Consultor Senior","Consultor de Proyectos","Consultor Proyecto",
  "Consultor","Consultor Analista","Analista Senior",
  "Consultor Trainee","Analista","Practicante",
];

interface PersonaFila {
  id: string;
  nombre: string;
  apellido: string;
  cargo: string | null;
  meses: Record<number, { tipo: TipoAusencia; dias: number }[]>; // mes 0-11 → tipos con días
}

interface Props { year: number; }

function diasSolapan(
  inicio: string, fin: string,
  mesInicio: Date, mesFin: Date
): number {
  const a = new Date(inicio + "T00:00:00") < mesInicio ? mesInicio : new Date(inicio + "T00:00:00");
  const b = new Date(fin   + "T00:00:00") > mesFin    ? mesFin    : new Date(fin   + "T00:00:00");
  if (a > b) return 0;
  // Contar días calendario (incluye fines de semana igual que la vista mes)
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

export function HeatmapAusenciasMes({ year }: Props) {
  const [filas, setFilas] = useState<PersonaFila[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const sb = createClient();

    const inicioAño = `${year}-01-01`;
    const finAño    = `${year}-12-31`;

    const [persRes, ausRes] = await Promise.all([
      sb.from("persona").select("id, nombre, apellido, cargo_actual").eq("activo", true),
      sb.from("ausencia")
        .select("persona_id, tipo, fecha_inicio, fecha_fin")
        .lte("fecha_inicio", finAño)
        .gte("fecha_fin",    inicioAño),
    ]);

    const personas = (persRes.data ?? []) as {
      id: string; nombre: string; apellido: string; cargo_actual: string | null;
    }[];
    const ausencias = (ausRes.data ?? []) as {
      persona_id: string; tipo: TipoAusencia; fecha_inicio: string; fecha_fin: string;
    }[];

    // Construir mapa persona → mes → {tipo, dias}[]
    const mapaPersona: Record<string, Record<number, Record<TipoAusencia, number>>> = {};

    for (const aus of ausencias) {
      if (!mapaPersona[aus.persona_id]) mapaPersona[aus.persona_id] = {};

      for (let m = 0; m < 12; m++) {
        const mesInicio = new Date(year, m, 1);
        const mesFin    = new Date(year, m + 1, 0);
        const dias = diasSolapan(aus.fecha_inicio, aus.fecha_fin, mesInicio, mesFin);
        if (dias <= 0) continue;

        if (!mapaPersona[aus.persona_id][m]) mapaPersona[aus.persona_id][m] = {} as Record<TipoAusencia, number>;
        mapaPersona[aus.persona_id][m][aus.tipo] = (mapaPersona[aus.persona_id][m][aus.tipo] ?? 0) + dias;
      }
    }

    const result: PersonaFila[] = personas
      .map((p) => {
        const meses: PersonaFila["meses"] = {};
        const mesMap = mapaPersona[p.id] ?? {};
        for (const [m, tiposMap] of Object.entries(mesMap)) {
          meses[Number(m)] = Object.entries(tiposMap).map(([tipo, dias]) => ({
            tipo: tipo as TipoAusencia,
            dias: dias as number,
          }));
        }
        return {
          id: p.id,
          nombre: p.nombre,
          apellido: p.apellido,
          cargo: p.cargo_actual,
          meses,
        };
      })
      .filter((p) => Object.keys(p.meses).length > 0) // solo con ausencias en el año
      .sort((a, b) => {
        const ia = JERARQUIA.indexOf(a.cargo ?? "");
        const ib = JERARQUIA.indexOf(b.cargo ?? "");
        if (ia === -1 && ib === -1) return a.apellido.localeCompare(b.apellido);
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia !== ib ? ia - ib : a.apellido.localeCompare(b.apellido);
      });

    setFilas(result);
    setLoading(false);
  }, [year]);

  useEffect(() => { load(); }, [load]);

  const hoy = new Date();
  const mesActual = hoy.getFullYear() === year ? hoy.getMonth() : -1;

  if (loading) return <p className="text-sm text-gray-400 p-6">Cargando...</p>;
  if (filas.length === 0)
    return <p className="text-sm text-gray-400 italic p-6">Sin ausencias registradas para {year}.</p>;

  return (
    <div className="overflow-auto h-full">
      <table className="text-xs border-collapse" style={{ minWidth: 820 }}>
        <thead>
          <tr className="sticky top-0 bg-white z-10">
            {/* Columna persona */}
            <th
              className="sticky left-0 bg-white z-20 text-left px-4 py-3 text-[11px] font-bold text-gray-400 uppercase tracking-widest border-b border-r border-[#f0f0f0]"
              style={{ minWidth: 180 }}
            >
              Persona
            </th>
            {MESES_CORTO.map((mes, i) => (
              <th
                key={i}
                className="text-center px-2 py-3 font-bold border-b border-[#f0f0f0]"
                style={{
                  minWidth: 72,
                  color: i === mesActual ? "#4a90e2" : "#aaa",
                  background: i === mesActual ? "#f0f7ff" : "white",
                }}
              >
                {mes}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {filas.map((persona, pi) => (
            <tr
              key={persona.id}
              className={pi % 2 === 0 ? "bg-white" : "bg-[#fafafa]"}
            >
              {/* Nombre */}
              <td className="sticky left-0 z-10 px-4 py-2.5 border-r border-[#f0f0f0]"
                style={{ background: pi % 2 === 0 ? "white" : "#fafafa" }}
              >
                <p className="font-semibold text-[#1a1a2e] truncate max-w-[165px]">
                  {persona.nombre} {persona.apellido}
                </p>
                {persona.cargo && (
                  <p className="text-[10px] text-gray-400 truncate max-w-[165px]">{persona.cargo}</p>
                )}
              </td>

              {/* Meses */}
              {Array.from({ length: 12 }, (_, m) => {
                const tipos = persona.meses[m] ?? [];
                const esActual = m === mesActual;
                return (
                  <td
                    key={m}
                    className="px-1.5 py-2 text-center align-middle"
                    style={{ background: esActual ? "#f0f7ff" : undefined }}
                  >
                    {tipos.length === 0 ? (
                      <div className="h-8" />
                    ) : (
                      <div className="flex flex-col gap-0.5 items-stretch">
                        {tipos.map(({ tipo, dias }) => {
                          const cfg = COLOR_AUSENCIA[tipo];
                          return (
                            <div
                              key={tipo}
                              title={`${cfg.label}: ${dias} ${dias === 1 ? "día" : "días"}`}
                              className="flex items-center justify-between px-1.5 py-0.5 rounded text-white text-[9px] font-bold leading-none"
                              style={{ backgroundColor: cfg.bg }}
                            >
                              <span className="truncate">{cfg.label.split(" ")[0]}</span>
                              <span className="ml-1 flex-shrink-0">{dias}d</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
