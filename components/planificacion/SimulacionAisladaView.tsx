"use client";

/**
 * SimulacionAisladaView
 * ─────────────────────
 * Vista de simulación 100% local: CERO llamadas a Supabase.
 * Toda la data proviene del snapshot del plan (localStorage).
 * Todas las mutaciones (drag&drop, fechas, eliminación) actualizan
 * únicamente el prop `snapshot` vía `onChange`.
 */

import { useState, useMemo } from "react";
import { format, addWeeks, addDays, startOfISOWeek } from "date-fns";
import { es } from "date-fns/locale";
import {
  ChevronLeft, ChevronRight, ChevronDown, ChevronRight as ChevRight,
  Trash2,
} from "lucide-react";

// ─── Tipos (re-exportados desde GanttPlanificacion) ───────────

export interface PersonaAsig {
  id: string;
  nombre: string;
  apellido: string;
  iniciales: string | null;
  cargo: string;
  pct: number;
  fecha_inicio: string;
  fecha_fin: string;
}

export interface EngSnap {
  id: string;
  codigo: string | null;
  nombre: string;
  cliente: string | null;
  tipo: string;
  fecha_inicio: string;
  fecha_fin: string;
  personas: PersonaAsig[];
}

// ─── Helpers ──────────────────────────────────────────────────

const COLORES: Record<string, string> = {
  "Socio": "#1a1a2e", "Director de Proyectos": "#4a90e2", "Director": "#4a90e2",
  "Gerente de Proyectos": "#7c5cbf", "Gerente": "#7c5cbf", "Asociado": "#e2884a",
  "Consultor Senior": "#4ab89a", "Consultor de Proyectos": "#e24a6a",
  "Consultor Analista": "#a0b84a", "Consultor Trainee": "#c07c4a",
};
const COLOR_DEFAULT = "#94a3b8";

const JERARQUIA = [
  "Socio", "Director de Proyectos", "Director", "Gerente de Proyectos", "Gerente",
  "Asociado", "Consultor Senior", "Consultor de Proyectos", "Consultor Analista",
  "Consultor Trainee", "Analista", "Practicante",
];

function iniciales(p: PersonaAsig) {
  if (p.iniciales) return p.iniciales.slice(0, 3).toUpperCase();
  return `${p.nombre[0] ?? ""}${p.apellido[0] ?? ""}`.toUpperCase();
}

function pctStyle(pct: number) {
  if (pct >= 100) return { bg: "#ef4444", text: "#fff" };
  if (pct >= 80)  return { bg: "#f97316", text: "#fff" };
  if (pct >= 50)  return { bg: "#f59e0b", text: "#fff" };
  return { bg: "#22c55e", text: "#fff" };
}

function ocupColor(pct: number) {
  if (pct >= 90) return { bg: "#fef2f2", text: "#dc2626" };
  if (pct >= 60) return { bg: "#fefce8", text: "#ca8a04" };
  return { bg: "#f0fdf4", text: "#16a34a" };
}

function solapan(ini1: string, fin1: string, ini2: string, fin2: string) {
  return ini1 <= fin2 && fin1 >= ini2;
}

// ─── Props ────────────────────────────────────────────────────

interface Props {
  snapshot: EngSnap[];
  onChange: (next: EngSnap[]) => void;
}

// ─── Componente principal ─────────────────────────────────────

export function SimulacionAisladaView({ snapshot, onChange }: Props) {
  const [semana, setSemana]     = useState(() => startOfISOWeek(new Date()));
  const [colapsados, setColapsados] = useState<Set<string>>(new Set());
  const [equipoEstado, setEquipoEstado] = useState<"normal" | "colapsado">("normal");
  const COLS = 8;
  const hoyStr = format(new Date(), "yyyy-MM-dd");

  const columnas = useMemo(
    () => Array.from({ length: COLS }, (_, i) => {
      const ini = addWeeks(semana, i);
      const fin = addDays(ini, 6);
      return { inicio: ini, fin, iniStr: format(ini, "yyyy-MM-dd"), finStr: format(fin, "yyyy-MM-dd") };
    }),
    [semana]
  );

  // ── Panel EQUIPO: personas únicas del snapshot ordenadas ─────
  const personasEquipo = useMemo(() => {
    const map = new Map<string, PersonaAsig & { totalPct: number }>();
    for (const eng of snapshot) {
      for (const p of eng.personas) {
        if (!map.has(p.id)) map.set(p.id, { ...p, totalPct: 0 });
        map.get(p.id)!.totalPct += p.pct;
      }
    }
    return [...map.values()].sort((a, b) => {
      const ia = JERARQUIA.indexOf(a.cargo), ib = JERARQUIA.indexOf(b.cargo);
      if (ia !== ib) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a.apellido.localeCompare(b.apellido);
    });
  }, [snapshot]);

  // ── Helpers de mutación (todo en memoria) ────────────────────

  function toggleColapso(id: string) {
    setColapsados((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }

  function handleDrop(e: React.DragEvent, eng: EngSnap) {
    e.preventDefault();
    let data: { personaId: string; nombre: string; apellido: string; cargo_actual: string } | null = null;
    try { data = JSON.parse(e.dataTransfer.getData("persona")); } catch { return; }
    if (!data?.personaId) return;
    // Evitar duplicados
    if (eng.personas.some((p) => p.id === data!.personaId)) return;
    const nueva: PersonaAsig = {
      id: data.personaId,
      nombre: data.nombre,
      apellido: data.apellido,
      iniciales: null,
      cargo: data.cargo_actual ?? "",
      pct: 100,
      fecha_inicio: eng.fecha_inicio,
      fecha_fin: eng.fecha_fin,
    };
    onChange(snapshot.map((eg) =>
      eg.id !== eng.id ? eg : { ...eg, personas: [...eg.personas, nueva] }
    ));
  }

  function handleEliminarPersona(engId: string, personaId: string) {
    onChange(snapshot.map((eg) =>
      eg.id !== engId ? eg : { ...eg, personas: eg.personas.filter((p) => p.id !== personaId) }
    ));
  }

  function handleCambioPct(engId: string, personaId: string, nuevoPct: number) {
    onChange(snapshot.map((eg) =>
      eg.id !== engId ? eg : {
        ...eg,
        personas: eg.personas.map((p) => p.id !== personaId ? p : { ...p, pct: nuevoPct }),
      }
    ));
  }

  // ── Grupos por cargo para panel EQUIPO ───────────────────────
  const gruposCargo = useMemo(() => {
    const map: Record<string, (typeof personasEquipo[0])[]> = {};
    for (const p of personasEquipo) {
      if (!map[p.cargo]) map[p.cargo] = [];
      map[p.cargo].push(p);
    }
    return Object.entries(map).sort(([a], [b]) => {
      const ia = JERARQUIA.indexOf(a), ib = JERARQUIA.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }, [personasEquipo]);

  return (
    <div className="flex gap-3 h-full overflow-hidden p-3">

      {/* ── Panel EQUIPO ──────────────────────────────────────── */}
      {equipoEstado === "colapsado" ? (
        <div className="w-10 flex-shrink-0 h-full rounded-xl border border-gray-100 bg-white flex flex-col items-center py-3 gap-3">
          <button onClick={() => setEquipoEstado("normal")} className="p-1 rounded hover:bg-gray-100 text-gray-400">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex-1 flex items-center"
            style={{ writingMode: "vertical-rl" }}>Equipo</span>
        </div>
      ) : (
        <div className="w-48 flex-shrink-0 h-full bg-white rounded-xl border border-gray-100 shadow-sm p-3 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between mb-2 flex-shrink-0">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Equipo</p>
            <button onClick={() => setEquipoEstado("colapsado")} className="p-0.5 rounded hover:bg-gray-100 text-gray-300">
              <ChevronLeft className="w-3 h-3" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
            {gruposCargo.map(([cargo, lista]) => (
              <div key={cargo}>
                <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{cargo}</p>
                <div className="flex flex-wrap gap-1.5">
                  {lista.map((p) => {
                    const oc = ocupColor(p.totalPct);
                    return (
                      <button
                        key={p.id}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData("persona", JSON.stringify({
                          personaId: p.id, nombre: p.nombre, apellido: p.apellido, cargo_actual: p.cargo,
                        }))}
                        className="flex flex-col items-center gap-0.5 hover:scale-110 transition-transform cursor-grab active:cursor-grabbing"
                        title={`${p.nombre} ${p.apellido} · ${p.totalPct}%`}>
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                          style={{ background: COLORES[p.cargo] ?? COLOR_DEFAULT }}>
                          {iniciales(p)}
                        </div>
                        <span className="text-[8px] font-bold px-1 py-0.5 rounded-full"
                          style={{ background: oc.bg, color: oc.text }}>{p.totalPct}%</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Panel TABLERO (grilla Gantt) ──────────────────────── */}
      <div className="flex-1 min-w-0 h-full bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col overflow-hidden">

        {/* Header navegación */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 flex-shrink-0">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Tablero</p>
          <div className="flex-1" />
          <button onClick={() => setSemana((s) => addWeeks(s, -COLS))}
            className="p-1 rounded hover:bg-gray-100 text-gray-400"><ChevronLeft className="w-3.5 h-3.5" /></button>
          <span className="text-[11px] font-semibold text-[#1a1a2e] min-w-[160px] text-center">
            {format(semana, "d MMM", { locale: es })} – {format(addDays(addWeeks(semana, COLS - 1), 6), "d MMM yyyy", { locale: es })}
          </span>
          <button onClick={() => setSemana((s) => addWeeks(s, COLS))}
            className="p-1 rounded hover:bg-gray-100 text-gray-400"><ChevronRight className="w-3.5 h-3.5" /></button>
          <button onClick={() => setSemana(startOfISOWeek(new Date()))}
            className="text-[10px] text-[#4a90e2] hover:underline">Hoy</button>
        </div>

        {/* Tabla */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs border-collapse" style={{ minWidth: 600 }}>
            <thead className="sticky top-0 z-10 bg-white">
              <tr>
                <th className="text-left px-3 py-2 text-[10px] text-gray-400 font-semibold w-36 sticky left-0 bg-white z-20 border-b border-gray-100">
                  Proyecto
                </th>
                {columnas.map((col, i) => {
                  const esHoy = col.iniStr <= hoyStr && hoyStr <= col.finStr;
                  return (
                    <th key={i} className="text-center py-2 border-b border-gray-100 font-semibold"
                      style={{ minWidth: 88, color: esHoy ? "#4a90e2" : "#aaa" }}>
                      <div className="text-[10px]">{format(col.inicio, "d MMM", { locale: es })}</div>
                      <div className="text-[9px] font-normal">{format(col.fin, "d MMM", { locale: es })}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {snapshot.map((eng) => {
                const estaColapsado = colapsados.has(eng.id);
                const label = eng.codigo ? `${eng.codigo}: ${eng.nombre}` : eng.nombre;
                const personasUnicas = Array.from(new Map(eng.personas.map((p) => [p.id, p])).values());

                return [
                  // ── Fila cabecera del engagement ─────────────────
                  <tr key={`hdr-${eng.id}`} className="border-t border-gray-50 bg-[#fafafa]"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleDrop(e, eng)}>
                    <td className="sticky left-0 bg-[#fafafa] z-10 px-3 py-1.5">
                      <div className="flex items-center gap-1">
                        <button onClick={() => toggleColapso(eng.id)}
                          className="text-gray-300 hover:text-gray-500 transition-colors flex-shrink-0">
                          {estaColapsado ? <ChevRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>
                        <div>
                          <p className="font-bold text-[11px] text-[#1a1a2e] truncate max-w-[96px]" title={label}>{label}</p>
                          {eng.cliente && <p className="text-[9px] text-gray-400 truncate">{eng.cliente}</p>}
                        </div>
                      </div>
                    </td>
                    {columnas.map((col, i) => {
                      const activo = solapan(eng.fecha_inicio, eng.fecha_fin, col.iniStr, col.finStr);
                      return (
                        <td key={i} className="py-1.5 px-1"
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => handleDrop(e, eng)}>
                          {activo && (
                            <div className="h-5 rounded-full bg-[#e2e8f0]"
                              style={{ opacity: col.iniStr <= hoyStr && hoyStr <= col.finStr ? 1 : 0.5 }} />
                          )}
                        </td>
                      );
                    })}
                  </tr>,

                  // ── Filas de personas ─────────────────────────────
                  ...(!estaColapsado ? personasUnicas.map((p) => {
                    const cargoColor = COLORES[p.cargo] ?? COLOR_DEFAULT;
                    return (
                      <tr key={`p-${eng.id}-${p.id}`} className="border-t border-gray-50">
                        <td className="sticky left-0 bg-white z-10 px-3 py-0.5">
                          <div className="flex items-center justify-between gap-1 pl-4 group">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <div className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[7px] font-bold flex-shrink-0"
                                style={{ background: cargoColor }}>
                                {iniciales(p)}
                              </div>
                              <span className="text-[9px] text-gray-500 truncate max-w-[60px]">
                                {p.nombre} {p.apellido}
                              </span>
                            </div>
                            <button
                              onClick={() => handleEliminarPersona(eng.id, p.id)}
                              title="Quitar del escenario"
                              className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all flex-shrink-0">
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        </td>
                        {columnas.map((col, i) => {
                          const isActive = solapan(p.fecha_inicio, p.fecha_fin, col.iniStr, col.finStr);
                          const style = pctStyle(p.pct);
                          const esHoy = col.iniStr <= hoyStr && hoyStr <= col.finStr;
                          return (
                            <td key={i} className="py-0.5 px-1">
                              {isActive && (
                                <div
                                  className="h-4 rounded flex items-center justify-center text-[9px] font-bold cursor-pointer select-none"
                                  style={{ background: style.bg, color: style.text, opacity: esHoy ? 1 : 0.7 }}
                                  title={`${p.nombre} · ${p.pct}% — clic para cambiar`}
                                  onClick={() => {
                                    // Ciclo simple de intensidades: 25 → 50 → 75 → 100 → 25
                                    const opciones = [25, 50, 75, 100];
                                    const idx = opciones.indexOf(p.pct);
                                    const nuevo = opciones[(idx + 1) % opciones.length];
                                    handleCambioPct(eng.id, p.id, nuevo);
                                  }}>
                                  {p.pct}%
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  }) : []),
                ];
              })}
            </tbody>
          </table>

          {snapshot.length === 0 && (
            <div className="flex items-center justify-center h-32 text-[#ccc] text-[12px]">
              Sin proyectos en el snapshot
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
