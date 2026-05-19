"use client";

import { useEffect, useState } from "react";
import { addDays, addMonths, format, isWeekend, startOfMonth } from "date-fns";
import { es } from "date-fns/locale";
import { createAnyClient } from "@/lib/supabase/client";
import { CARGOS, CARGO_COLORS, CARGO_COLOR_DEFAULT } from "@/lib/constants";
import { expandirRango } from "@/lib/queries/ausencias";

const JERARQUIA: Record<string, number> = {
  "Socio": 1, "Director de Proyectos": 2, "Director": 2,
  "Gerente de Proyectos": 3, "Gerente": 3, "Asociado": 4,
  "Consultor Senior": 5, "Consultor de Proyectos": 6, "Consultor Proyecto": 6,
  "Consultor": 6, "Consultor Analista": 7, "Analista Senior": 7,
  "Consultor Trainee": 8, "Analista": 8, "Practicante": 9,
};

interface PersonaFila {
  id: string;
  nombre: string;
  apellido: string;
  cargo: string;
  proyectos: { id: string; nombre: string; cliente: string; inicio: string; fin: string; pct: number }[];
  ausencias: { inicio: string; fin: string; tipo: string }[];
}

interface Columna {
  label: string;
  sublabel: string;
  inicioStr: string;
  finStr: string;
}

interface Props {
  semanaInicio: Date;
  periodoVista?: "dia" | "semana" | "mes";
}

function getColumnas(semanaInicio: Date, pv: string): Columna[] {
  if (pv === "semana") {
    return Array.from({ length: 5 }, (_, i) => {
      const ini = addDays(semanaInicio, i * 7);
      const fin = addDays(ini, 6);
      return {
        label: format(ini, "d MMM", { locale: es }),
        sublabel: format(fin, "d MMM", { locale: es }),
        inicioStr: format(ini, "yyyy-MM-dd"),
        finStr: format(fin, "yyyy-MM-dd"),
      };
    });
  }
  if (pv === "mes") {
    return Array.from({ length: 4 }, (_, i) => {
      const mesInicio = startOfMonth(addMonths(semanaInicio, i));
      const mesFin = addDays(startOfMonth(addMonths(semanaInicio, i + 1)), -1);
      return {
        label: format(mesInicio, "MMM", { locale: es }),
        sublabel: format(mesInicio, "yyyy"),
        inicioStr: format(mesInicio, "yyyy-MM-dd"),
        finStr: format(mesFin, "yyyy-MM-dd"),
      };
    });
  }
  // dia: 7 columnas individuales
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(semanaInicio, i);
    const key = format(d, "yyyy-MM-dd");
    return {
      label: format(d, "EEE", { locale: es }),
      sublabel: format(d, "d MMM", { locale: es }),
      inicioStr: key,
      finStr: key,
    };
  });
}

function overlapsColumna(inicio: string, fin: string, col: Columna): boolean {
  return inicio <= col.finStr && fin >= col.inicioStr;
}

function calcDiasEngagement(inicio: string, fin: string | null) {
  const hoy = new Date().toISOString().split("T")[0];
  if (inicio > hoy) {
    const d = expandirRango(hoy, inicio).length - 1;
    return { dias: d, esFuturo: true };
  }
  const finClamp = fin && fin < hoy ? fin : hoy;
  return { dias: expandirRango(inicio, finClamp).length, esFuturo: false };
}

export function PerfilIndividualTablero({ semanaInicio, periodoVista }: Props) {
  const [filas, setFilas] = useState<PersonaFila[]>([]);
  const [loading, setLoading] = useState(true);

  const pv = periodoVista ?? "dia";

  // Rango de fetch según período
  const totalDias = pv === "semana" ? 35 : pv === "mes" ? 120 : 7;
  const fechaInicio = format(semanaInicio, "yyyy-MM-dd");
  const fechaFin = format(addDays(semanaInicio, totalDias - 1), "yyyy-MM-dd");

  useEffect(() => {
    async function load() {
      setLoading(true);
      const sb = createAnyClient();

      const [persRes, asigRes, ausenRes] = await Promise.all([
        sb.from("persona").select("id, nombre, apellido, cargo_actual").eq("activo", true),
        sb.from("asignacion")
          .select("persona_id, pct_dedicacion, fecha_inicio, fecha_fin, engagement:engagement_id(id, codigo, nombre, cliente)" as any)
          .eq("estado", "activa")
          .lte("fecha_inicio", fechaFin)
          .gte("fecha_fin", fechaInicio),
        sb.from("ausencia")
          .select("persona_id, fecha_inicio, fecha_fin, tipo")
          .lte("fecha_inicio", fechaFin)
          .gte("fecha_fin", fechaInicio),
      ]);

      const personas: PersonaFila[] = ((persRes.data ?? []) as any[])
        .sort((a, b) => {
          const ia = JERARQUIA[a.cargo_actual ?? ""] ?? 99;
          const ib = JERARQUIA[b.cargo_actual ?? ""] ?? 99;
          return ia !== ib ? ia - ib : a.apellido.localeCompare(b.apellido);
        })
        .map((p) => {
          const asigs = ((asigRes.data ?? []) as any[])
            .filter((a) => a.persona_id === p.id)
            .map((a) => ({
              id: a.engagement?.id ?? "",
              nombre: a.engagement?.codigo ? `${a.engagement.codigo}: ${a.engagement.nombre ?? "—"}` : a.engagement?.nombre ?? "—",
              cliente: a.engagement?.cliente ?? "",
              inicio: a.fecha_inicio,
              fin: a.fecha_fin,
              pct: a.pct_dedicacion,
            }));
          const ausencias = ((ausenRes.data ?? []) as any[])
            .filter((a) => a.persona_id === p.id)
            .map((a) => ({ inicio: a.fecha_inicio, fin: a.fecha_fin, tipo: a.tipo }));
          return {
            id: p.id,
            nombre: p.nombre,
            apellido: p.apellido,
            cargo: p.cargo_actual ?? "Sin cargo",
            proyectos: asigs,
            ausencias,
          };
        })
        .filter((p) => p.proyectos.length > 0 || p.ausencias.length > 0);

      setFilas(personas);
      setLoading(false);
    }
    load();
  }, [fechaInicio, fechaFin]);

  if (loading) return <p className="text-sm text-gray-300 p-2">Cargando...</p>;
  if (filas.length === 0) return <p className="text-sm text-gray-300 italic p-2">Sin actividad en este período.</p>;

  const hoy = format(new Date(), "yyyy-MM-dd");
  const columnas = getColumnas(semanaInicio, pv);

  // En modo día: filtrar fines de semana
  const columnasMostradas = pv === "dia"
    ? columnas.filter((c) => {
        const d = new Date(c.inicioStr + "T00:00:00");
        return !isWeekend(d);
      })
    : columnas;

  return (
    <div className="overflow-auto h-full">
      <table className="w-full text-xs border-collapse" style={{ minWidth: 520 }}>
        <thead className="sticky top-0 bg-white z-20">
          <tr>
            <th className="text-left pr-3 pb-2 text-gray-400 font-semibold w-36 sticky left-0 bg-white z-30">
              Persona
            </th>
            {columnasMostradas.map((col, i) => {
              const esHoy = col.inicioStr <= hoy && hoy <= col.finStr;
              return (
                <th
                  key={i}
                  className="text-center pb-2 font-semibold"
                  style={{ color: esHoy ? "#4a90e2" : "#aaa", minWidth: pv === "dia" ? 48 : 72 }}
                >
                  <div className="capitalize">{col.label}</div>
                  <div className="font-normal text-[10px]">{col.sublabel}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {(() => {
            const cargoOrden = [...CARGOS];
            const sinCargo = filas.filter(
              (f) => !cargoOrden.includes(f.cargo as typeof CARGOS[number])
            );
            const grupos = [
              ...cargoOrden.map((c) => ({ cargo: c, lista: filas.filter((f) => f.cargo === c) })),
              ...(sinCargo.length > 0 ? [{ cargo: "Sin cargo", lista: sinCargo }] : []),
            ].filter((g) => g.lista.length > 0);

            return grupos.flatMap(({ cargo, lista }) => {
              const cargoColor = CARGO_COLORS[cargo] ?? CARGO_COLOR_DEFAULT;

              const filaSeccion = (
                <tr key={`sec-${cargo}`}>
                  <td colSpan={columnasMostradas.length + 1} className="pt-4 pb-1">
                    <div className="flex items-center gap-2">
                      <div className="w-1 h-4 rounded-full flex-shrink-0" style={{ background: cargoColor }} />
                      <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: cargoColor }}>{cargo}</span>
                      <span className="text-[10px] text-gray-300">{lista.length}</span>
                      <div className="flex-1 h-0.5 rounded-full" style={{ background: cargoColor, opacity: 0.35 }} />
                    </div>
                  </td>
                </tr>
              );

              const filasPersonas = lista.flatMap((persona, pi) => {
                const separador = pi > 0 ? (
                  <tr key={`sep-${persona.id}`}>
                    <td colSpan={columnasMostradas.length + 1} className="py-0.5">
                      <div className="border-t border-gray-100" />
                    </td>
                  </tr>
                ) : null;

                const filaHdr = (
                  <tr key={`hdr-${persona.id}`}>
                    <td className="pr-3 pt-2 pb-1 sticky left-0 bg-white z-10">
                      <p className="font-semibold text-[#1a1a2e] truncate max-w-[130px]">
                        {persona.nombre} {persona.apellido}
                      </p>
                    </td>
                    {columnasMostradas.map((_, i) => <td key={i} />)}
                  </tr>
                );

                const filasProyectos = persona.proyectos.map((proy, pi) => {
                  const { dias, esFuturo } = calcDiasEngagement(proy.inicio, proy.fin);
                  return (
                  <tr key={`proy-${persona.id}-${proy.id}-${pi}`}>
                    <td className="pr-3 py-0.5 sticky left-0 bg-white z-10">
                      <div className="flex items-center justify-between gap-1 pl-2 max-w-[130px]">
                        <p className="text-gray-500 truncate text-xs min-w-0">
                          {proy.nombre}
                          {proy.cliente && <span className="text-gray-300 ml-1">· {proy.cliente}</span>}
                        </p>
                        <span
                          className="flex-shrink-0 text-[9px] font-bold px-1 py-0.5 rounded leading-none"
                          style={esFuturo
                            ? { background: "#f0fdf4", color: "#15803d" }
                            : { background: "#dbeafe", color: "#1d4ed8" }}
                        >
                          {esFuturo ? `En ${dias}d` : `${dias}d`}
                        </span>
                      </div>
                    </td>
                    {columnasMostradas.map((col, i) => {
                      const activo = overlapsColumna(proy.inicio, proy.fin, col);
                      // semáforo: <50% verde, 50-90% naranja, >90% rojo
                      const semColor = proy.pct < 50
                        ? "#16a34a"
                        : proy.pct <= 90
                        ? "#f59e0b"
                        : "#dc2626";
                      return (
                        <td key={i} className="py-0.5 px-0.5">
                          {activo ? (
                            <div
                              className="h-5 rounded flex items-center justify-center text-[10px] font-semibold text-white"
                              style={{ background: semColor }}
                            >
                              {proy.pct}%
                            </div>
                          ) : (
                            <div className="h-5 rounded bg-gray-50" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  );
                });

                const filaAusencia = persona.ausencias.length > 0 ? (
                  <tr key={`aus-${persona.id}`}>
                    <td className="pr-3 py-0.5 sticky left-0 bg-white z-10">
                      <p className="text-orange-400 pl-2 truncate max-w-[130px]">Ausencia</p>
                    </td>
                    {columnasMostradas.map((col, i) => {
                      const activa = persona.ausencias.some((a) => overlapsColumna(a.inicio, a.fin, col));
                      return (
                        <td key={i} className="py-0.5 px-0.5">
                          {activa ? (
                            <div className="h-5 rounded" style={{ background: "#fed7aa" }} />
                          ) : (
                            <div className="h-5 rounded bg-gray-50" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ) : null;

                return [separador, filaHdr, ...filasProyectos, filaAusencia].filter(Boolean);
              });

              return [filaSeccion, ...filasPersonas];
            });
          })()}
        </tbody>
      </table>
    </div>
  );
}
