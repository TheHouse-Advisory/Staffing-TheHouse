"use client";

import { useEffect, useState } from "react";
import {
  startOfISOWeek, addDays, addWeeks, addMonths,
  subWeeks, subMonths, format, startOfMonth, endOfMonth,
} from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";

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

type Vista = "dia" | "semana" | "mes";
interface Columna { label: string; sublabel: string; inicio: Date; fin: Date; }

function columnasDia(base: Date): Columna[] {
  const lunes = startOfISOWeek(base);
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(lunes, i);
    return { label: format(d, "EEE", { locale: es }), sublabel: format(d, "d MMM", { locale: es }), inicio: d, fin: d };
  });
}

function columnasSemana(base: Date): Columna[] {
  const inicio = startOfISOWeek(base);
  return Array.from({ length: 5 }, (_, i) => {
    const s = addWeeks(inicio, i);
    const fin = addDays(s, 6);
    return { label: format(s, "d MMM", { locale: es }), sublabel: format(fin, "d MMM", { locale: es }), inicio: s, fin };
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

function rangoSolapan(aIni: string, aFin: string | null, cIni: Date, cFin: Date) {
  if (!aFin) return new Date(aIni) <= cFin;
  return new Date(aIni) <= cFin && new Date(aFin) >= cIni;
}

function iniciales(nombre: string, apellido: string) {
  return `${nombre[0] ?? ""}${apellido[0] ?? ""}`.toUpperCase();
}

interface PersonaAsig {
  id: string;
  nombre: string;
  apellido: string;
  cargo: string | null;
  pct: number;
  fecha_inicio: string;
  fecha_fin: string;
}

interface EngRow {
  id: string;
  nombre: string;
  cliente: string | null;
  tipo: string;
  fecha_inicio: string;
  fecha_fin: string | null;
  personas: PersonaAsig[];
}

export function DesgloceEngagements() {
  const [vista, setVista] = useState<Vista>("semana");
  const [base, setBase] = useState<Date>(new Date());
  const [engs, setEngs] = useState<EngRow[]>([]);
  const [ausencias, setAusencias] = useState<{ persona_id: string; fecha_inicio: string; fecha_fin: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const columnas: Columna[] =
    vista === "dia" ? columnasDia(base) :
    vista === "semana" ? columnasSemana(base) :
    columnasMes(base);

  const inicioStr = format(columnas[0].inicio, "yyyy-MM-dd");
  const finStr = format(columnas[columnas.length - 1].fin, "yyyy-MM-dd");

  useEffect(() => {
    async function load() {
      setLoading(true);
      const sb = createAnyClient();

      const [engRes, asigRes, ausRes] = await Promise.all([
        sb.from("engagement")
          .select("id, nombre, cliente, tipo, fecha_inicio, fecha_fin_estimada, fecha_fin_real")
          .eq("estado", "activo")
          .lte("fecha_inicio", finStr)
          .or(`fecha_fin_real.gte.${inicioStr},fecha_fin_estimada.gte.${inicioStr},fecha_fin_real.is.null`),

        sb.from("asignacion")
          .select("engagement_id, persona_id, pct_dedicacion, fecha_inicio, fecha_fin, persona:persona_id(nombre, apellido, cargo_actual)" as any)
          .eq("estado", "activa")
          .lte("fecha_inicio", finStr)
          .gte("fecha_fin", inicioStr),

        sb.from("ausencia")
          .select("persona_id, fecha_inicio, fecha_fin")
          .lte("fecha_inicio", finStr)
          .gte("fecha_fin", inicioStr),
      ]);

      const engMap = new Map<string, EngRow>();
      for (const e of (engRes.data ?? []) as any[]) {
        engMap.set(e.id, {
          id: e.id,
          nombre: e.nombre,
          cliente: e.cliente,
          tipo: e.tipo ?? "proyecto",
          fecha_inicio: e.fecha_inicio,
          fecha_fin: e.fecha_fin_real ?? e.fecha_fin_estimada ?? null,
          personas: [],
        });
      }

      for (const a of (asigRes.data ?? []) as any[]) {
        const eng = engMap.get(a.engagement_id);
        if (!eng) continue;
        eng.personas.push({
          id: a.persona_id,
          nombre: a.persona?.nombre ?? "?",
          apellido: a.persona?.apellido ?? "",
          cargo: a.persona?.cargo_actual ?? null,
          pct: Number(a.pct_dedicacion),
          fecha_inicio: a.fecha_inicio,
          fecha_fin: a.fecha_fin,
        });
      }

      for (const eng of engMap.values()) {
        eng.personas.sort((a, b) => {
          const ia = JERARQUIA[a.cargo ?? ""] ?? 99;
          const ib = JERARQUIA[b.cargo ?? ""] ?? 99;
          return ia !== ib ? ia - ib : a.apellido.localeCompare(b.apellido);
        });
      }

      setEngs([...engMap.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")));
      setAusencias((ausRes.data ?? []) as { persona_id: string; fecha_inicio: string; fecha_fin: string }[]);
      setLoading(false);
    }
    load();
  }, [inicioStr, finStr]);

  function navAnterior() {
    if (vista === "dia")    setBase((b) => addDays(startOfISOWeek(b), -7));
    if (vista === "semana") setBase((b) => subWeeks(b, 5));
    if (vista === "mes")    setBase((b) => subMonths(b, 4));
  }
  function navSiguiente() {
    if (vista === "dia")    setBase((b) => addDays(startOfISOWeek(b), 7));
    if (vista === "semana") setBase((b) => addWeeks(b, 5));
    if (vista === "mes")    setBase((b) => addMonths(b, 4));
  }

  const hoy = new Date();

  return (
    <div className="flex flex-col h-full">
      {/* Controles */}
      <div className="flex items-center gap-1 mb-3 flex-shrink-0 self-end">
        <div className="flex rounded-md overflow-hidden border border-gray-100 text-[11px] font-semibold">
          {(["dia", "semana", "mes"] as Vista[]).map((v) => (
            <button
              key={v}
              onClick={() => setVista(v)}
              className="px-2.5 py-1 transition-colors"
              style={vista === v ? { background: "#4a90e2", color: "#fff" } : { background: "#f9f9f9", color: "#888" }}
            >
              {v === "dia" ? "Día" : v === "semana" ? "Semana" : "Mes"}
            </button>
          ))}
        </div>
        <button onClick={navAnterior} className="p-1 rounded hover:bg-gray-100 text-gray-400">
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <button onClick={navSiguiente} className="p-1 rounded hover:bg-gray-100 text-gray-400">
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-300">Cargando...</p>
      ) : engs.length === 0 ? (
        <p className="text-sm text-gray-300 italic">Sin engagements activos en este período.</p>
      ) : (
        <div className="flex-1 overflow-auto">
          <table
            className="w-full text-xs border-collapse"
            style={{ minWidth: `${180 + columnas.length * 80}px` }}
          >
            <thead className="sticky top-0 bg-white z-20">
              <tr>
                <th
                  className="text-left pr-3 pb-2 text-gray-400 font-semibold sticky left-0 bg-white z-30"
                  style={{ minWidth: 160 }}
                >
                  Engagement
                </th>
                {columnas.map((col, i) => {
                  const esHoy = col.inicio <= hoy && hoy <= col.fin;
                  return (
                    <th
                      key={i}
                      className="text-center pb-2 font-semibold"
                      style={{ minWidth: 76, color: esHoy ? "#4a90e2" : "#aaa" }}
                    >
                      <div className="capitalize">{col.label}</div>
                      <div className="font-normal text-[10px]">{col.sublabel}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {[
                { tipo: "proyecto",      label: "Proyectos",              color: "#4a90e2" },
                { tipo: "propuesta",     label: "Propuestas comerciales", color: "#9b59b6" },
                { tipo: "ayuda_interna", label: "Ayuda interna",          color: "#27ae60" },
              ].flatMap(({ tipo, label, color: secColor }) => {
                const lista = engs.filter((e) => e.tipo === tipo);
                if (lista.length === 0) return [];

                const filaSeccion = (
                  <tr key={`sec-${tipo}`}>
                    <td colSpan={columnas.length + 1} className="pt-4 pb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-1 h-4 rounded-full flex-shrink-0" style={{ background: secColor }} />
                        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: secColor }}>
                          {label}
                        </span>
                        <span className="text-[10px] text-gray-300">{lista.length}</span>
                        <div className="flex-1 h-0.5 rounded-full" style={{ background: secColor, opacity: 0.35 }} />
                      </div>
                    </td>
                  </tr>
                );

                const filasEngs = lista.flatMap((eng, ei) => {
                  const cargosUnicos = Array.from(
                    new Set(eng.personas.map((p) => p.cargo ?? "Sin cargo"))
                  ).sort((a, b) => (JERARQUIA[a] ?? 99) - (JERARQUIA[b] ?? 99));

                  const personaIdsEng = new Set(eng.personas.map((p) => p.id));

                  const separador = ei > 0 ? (
                    <tr key={`sep-${eng.id}`}>
                      <td colSpan={columnas.length + 1} className="py-0.5">
                        <div className="border-t-2 border-gray-100" />
                      </td>
                    </tr>
                  ) : null;

                  const filaHdr = (
                    <tr key={`hdr-${eng.id}`}>
                      <td className="pr-3 pt-2 pb-1 sticky left-0 bg-white z-10">
                        <p className="font-bold text-[#1a1a2e] truncate max-w-[150px] text-[12px]">{eng.nombre}</p>
                        {eng.cliente && (
                          <p className="text-[10px] text-gray-400 truncate max-w-[150px]">{eng.cliente}</p>
                        )}
                      </td>
                      {columnas.map((col, i) => {
                        const esHoy = col.inicio <= hoy && hoy <= col.fin;
                        const activo = rangoSolapan(eng.fecha_inicio, eng.fecha_fin, col.inicio, col.fin);
                        return (
                          <td key={i} className="py-1 px-1">
                            {activo && (
                              <div className="h-1.5 rounded-full"
                                style={{ background: esHoy ? "#bfdbfe" : "#e0e7ff" }} />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );

                  const filasCargo = cargosUnicos.map((cargo) => {
                    const personas = eng.personas.filter((p) => (p.cargo ?? "Sin cargo") === cargo);
                    const cargoColor = COLORES[cargo] ?? COLOR_DEFAULT;
                    return (
                      <tr key={`cargo-${eng.id}-${cargo}`}>
                        <td className="pr-3 py-0.5 sticky left-0 bg-white z-10">
                          <p className="text-gray-400 truncate max-w-[150px] pl-3 text-[11px]">{cargo}</p>
                        </td>
                        {columnas.map((col, i) => {
                          const esHoy = col.inicio <= hoy && hoy <= col.fin;
                          const activos = personas.filter((p) =>
                            rangoSolapan(p.fecha_inicio, p.fecha_fin, col.inicio, col.fin)
                          );
                          return (
                            <td key={i} className="py-0.5 px-1">
                              <div className="flex flex-wrap gap-1 justify-center min-h-[36px] items-center">
                                {activos.map((p) => (
                                  <div key={p.id} title={`${p.nombre} ${p.apellido} · ${p.pct}%`}
                                    className="flex flex-col items-center gap-0.5">
                                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shadow-sm"
                                      style={{
                                        backgroundColor: cargoColor,
                                        opacity: esHoy ? 1 : 0.75,
                                        outline: esHoy ? `2px solid ${cargoColor}` : "none",
                                        outlineOffset: "2px",
                                      }}>
                                      {iniciales(p.nombre, p.apellido)}
                                    </div>
                                    <span className="text-[9px] font-bold px-1 rounded-full leading-tight"
                                      style={{
                                        background: esHoy ? "#dbeafe" : "#f1f5f9",
                                        color: esHoy ? "#1d4ed8" : "#64748b",
                                      }}>
                                      {p.pct}%
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  });

                  const filaAusentes = (
                    <tr key={`aus-${eng.id}`}>
                      <td className="pr-3 py-0.5 sticky left-0 bg-white z-10">
                        <p className="text-orange-400 pl-3 text-[11px]">Ausentes</p>
                      </td>
                      {columnas.map((col, i) => {
                        const ausentesEnCol = ausencias.filter((a) =>
                          personaIdsEng.has(a.persona_id) &&
                          rangoSolapan(a.fecha_inicio, a.fecha_fin, col.inicio, col.fin)
                        );
                        const vistos = new Set<string>();
                        const ausUnicos = ausentesEnCol.reduce<PersonaAsig[]>((acc, a) => {
                          if (vistos.has(a.persona_id)) return acc;
                          vistos.add(a.persona_id);
                          const p = eng.personas.find((pe) => pe.id === a.persona_id);
                          if (p) acc.push(p);
                          return acc;
                        }, []);
                        return (
                          <td key={i} className="py-0.5 px-1">
                            <div className="flex flex-wrap gap-1 justify-center min-h-[28px] items-center">
                              {ausUnicos.map((p) => (
                                <div key={p.id} title={`${p.nombre} ${p.apellido} — ausente`}
                                  className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold"
                                  style={{ background: "#fed7aa", color: "#c2410c" }}>
                                  {iniciales(p.nombre, p.apellido)}
                                </div>
                              ))}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );

                  return [separador, filaHdr, ...filasCargo, filaAusentes].filter(Boolean);
                });

                return [filaSeccion, ...filasEngs];
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
