"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { COLOR_AUSENCIA } from "@/lib/queries/ausencias";
import { calculateBusinessDays } from "@/lib/utils/date-utils";
import type { TipoAusencia } from "@/lib/types/database";

const MESES_CORTO = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const MESES_FULL  = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

const JERARQUIA = [
  "Socio","Director de Proyectos","Director",
  "Gerente de Proyectos","Gerente","Asociado",
  "Consultor Senior","Consultor de Proyectos","Consultor Proyecto",
  "Consultor","Consultor Analista","Analista Senior",
  "Consultor Trainee","Analista","Practicante",
];

const Q_MESES: Record<1|2|3|4, [number, number, number]> = {
  1: [0, 1, 2],
  2: [3, 4, 5],
  3: [6, 7, 8],
  4: [9, 10, 11],
};

interface PersonaFila {
  id: string;
  nombre: string;
  apellido: string;
  cargo: string | null;
  meses: Record<number, { tipo: TipoAusencia; dias: number }[]>;
}

function diasSolapan(inicio: string, fin: string, mesInicio: Date, mesFin: Date): number {
  const a = new Date(inicio + "T00:00:00") < mesInicio ? mesInicio : new Date(inicio + "T00:00:00");
  const b = new Date(fin   + "T00:00:00") > mesFin    ? mesFin    : new Date(fin   + "T00:00:00");
  if (a > b) return 0;
  return calculateBusinessDays(a.toISOString().split("T")[0], b.toISOString().split("T")[0]);
}


interface Props {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  rolActual?: string | null;
}

export function HeatmapAusenciasQ({ year, quarter, rolActual }: Props) {
  const ocultarVacacionesPorConfirmar = rolActual === "GyD" || rolActual === "AySr" || rolActual === "planificador";
  const [filas, setFilas] = useState<PersonaFila[]>([]);
  const [loading, setLoading] = useState(true);
  const meses = Q_MESES[quarter];

  const load = useCallback(async () => {
    setLoading(true);
    const sb = createClient();

    const primerMes = meses[0];
    const ultimoMes = meses[2];
    const inicioQ   = `${year}-${String(primerMes + 1).padStart(2, "0")}-01`;
    const finQ      = new Date(year, ultimoMes + 1, 0).toISOString().split("T")[0];

    const [persRes, ausRes] = await Promise.all([
      sb.from("persona").select("id, nombre, apellido, cargo_actual").eq("activo", true),
      sb.from("ausencia")
        .select("persona_id, tipo, fecha_inicio, fecha_fin")
        .lte("fecha_inicio", finQ)
        .gte("fecha_fin",    inicioQ),
    ]);

    const personas = (persRes.data ?? []) as {
      id: string; nombre: string; apellido: string; cargo_actual: string | null;
    }[];
    const ausencias = (ausRes.data ?? []) as {
      persona_id: string; tipo: TipoAusencia; fecha_inicio: string; fecha_fin: string;
    }[];

    const mapaPersona: Record<string, Record<number, Record<TipoAusencia, number>>> = {};

    for (const aus of ausencias) {
      if (!mapaPersona[aus.persona_id]) mapaPersona[aus.persona_id] = {};
      for (const m of meses) {
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
        const mesData: PersonaFila["meses"] = {};
        const mesMap = mapaPersona[p.id] ?? {};
        for (const [m, tiposMap] of Object.entries(mesMap)) {
          mesData[Number(m)] = Object.entries(tiposMap).map(([tipo, dias]) => ({
            tipo: tipo as TipoAusencia,
            dias: dias as number,
          }));
        }
        return { id: p.id, nombre: p.nombre, apellido: p.apellido, cargo: p.cargo_actual, meses: mesData };
      })
      .filter((p) => Object.keys(p.meses).length > 0)
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
  }, [year, quarter, rolActual]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const hoy = new Date();
  const mesActual = hoy.getFullYear() === year ? hoy.getMonth() : -1;

  if (loading) return <p className="text-sm text-gray-400 p-6">Cargando...</p>;
  if (filas.length === 0)
    return (
      <p className="text-sm text-gray-400 italic p-6">
        Sin ausencias registradas para Q{quarter} {year}.
      </p>
    );

  return (
    <div className="overflow-auto h-full">
      <table className="text-xs border-collapse w-full" style={{ minWidth: 480 }}>
        <thead>
          <tr className="sticky top-0 bg-white z-10">
            <th
              className="sticky left-0 bg-white z-20 text-left px-3 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest border-b border-r border-[#f0f0f0]"
              style={{ minWidth: 150 }}
            >
              Persona
            </th>
            {meses.map((m) => (
              <th
                key={m}
                className="text-center px-2 py-1.5 font-bold border-b border-[#f0f0f0]"
                style={{
                  minWidth: 140,
                  color: m === mesActual ? "#4a90e2" : "#aaa",
                  background: m === mesActual ? "#f0f7ff" : "white",
                }}
              >
                {MESES_FULL[m]}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {filas.map((persona, pi) => (
            <tr key={persona.id} className={pi % 2 === 0 ? "bg-white" : "bg-[#fafafa]"}>
              <td
                className="sticky left-0 z-10 px-3 py-1.5 border-r border-[#f0f0f0]"
                style={{ background: pi % 2 === 0 ? "white" : "#fafafa" }}
              >
                <p className="font-semibold text-[#1a1a2e] truncate max-w-[140px] text-[11px]">
                  {persona.nombre} {persona.apellido}
                </p>
                {persona.cargo && (
                  <p className="text-[9px] text-gray-400 truncate max-w-[140px]">{persona.cargo}</p>
                )}
              </td>

              {meses.map((m) => {
                const tiposMes = persona.meses[m] ?? [];
                const tipos = ocultarVacacionesPorConfirmar
                  ? tiposMes.filter((t) => t.tipo !== "vacaciones_por_confirmar")
                  : tiposMes;
                const esActual = m === mesActual;
                return (
                  <td
                    key={m}
                    className="px-2 py-1 align-middle"
                    style={{ background: esActual ? "#f0f7ff" : undefined }}
                  >
                    {tipos.length === 0 ? (
                      <div className="h-5" />
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        {tipos.map(({ tipo, dias }) => {
                          // Defensive guard: fallback si el tipo no está en el diccionario
                          const cfg = COLOR_AUSENCIA[tipo] ?? { label: tipo, bg: "#9ca3af" };
                          return (
                            <div
                              key={tipo}
                              title={`${cfg.label}: ${dias} ${dias === 1 ? "día" : "días"}`}
                              className="flex items-center justify-between px-2 py-0.5 rounded text-white text-[9px] font-bold leading-none"
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
