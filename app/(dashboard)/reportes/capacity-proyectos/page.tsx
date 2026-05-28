"use client";

import React, { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft, Layers, Loader2,
  ChevronRight, ChevronDown, TrendingUp,
} from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";
import {
  fetchCapacityData,
  labelSemana,
  cargoAGrupo,
  CAPACITY_GRUPO_ORDER,
  type CapacityData,
  type AusenciaCapacity,
  type PersonaCapacity,
} from "@/lib/queries/capacity";

// ─────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────

const MESES_LABELS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

/** Grupos que participan en el cálculo del cuello de botella */
const GRUPOS_BOTTLENECK = ["Gerentes / Directores", "Seniors / Asociados", "Consultores"];

const GRUPO_LABEL_SHORT: Record<string, string> = {
  "Gerentes / Directores": "Gerencia",
  "Seniors / Asociados":   "Seniors",
  "Consultores":           "Consultores",
};

const CELL_W       = 52;   // px — columna semana expandida
const COLLAPSED_W  = 110;  // px — columna mes colapsada

const ANIO_ACTUAL = new Date().getFullYear();
const ANIOS       = [ANIO_ACTUAL - 1, ANIO_ACTUAL, ANIO_ACTUAL + 1];

// ─────────────────────────────────────────────────────────────
//  Helpers puros
// ─────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function getVal(
  valores: Record<string, Record<string, number>>,
  pid: string,
  sem: string,
): number {
  const raw = valores[pid]?.[sem];
  if (raw === undefined || raw === null) return 1;
  const n = parseFloat(String(raw));
  return isNaN(n) ? 1 : n;
}

function cellStyle(v: number): { background: string; color: string } {
  if (v === 0)  return { background: "#f3f4f6", color: "#9ca3af" };
  if (v <= 1)   return { background: "#eff6ff", color: "#1d4ed8" };
  if (v <= 2)   return { background: "#dbeafe", color: "#1d4ed8" };
  return        { background: "#bfdbfe", color: "#1d4ed8" };
}

function semanaTieneAusencia(semana: string, ausencias: AusenciaCapacity[]): boolean {
  const d = new Date(semana + "T00:00:00");
  d.setDate(d.getDate() + 6);
  const domingo = d.toISOString().split("T")[0];
  return ausencias.some(a => a.fecha_inicio <= domingo && a.fecha_fin >= semana);
}

function esDesarrollo(cargo: string | null): boolean {
  return (cargo ?? "").toLowerCase().includes("desarrollo");
}

// ─────────────────────────────────────────────────────────────
//  Page
// ─────────────────────────────────────────────────────────────

export default function CapacityProyectosPage() {
  const [year, setYear]     = useState(ANIO_ACTUAL);
  const [data, setData]     = useState<CapacityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [colapsados, setColapsados]           = useState<Set<string>>(new Set());
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());

  // ── Fetch ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const sb = createAnyClient();
      const d = await fetchCapacityData(sb, year);
      if (cancelled) return;
      setData(d);
      // Default: todos los meses colapsados (vista "prom. mes" como en la foto)
      const keys = new Set<string>();
      for (const sem of d.semanas) {
        const dt = new Date(sem + "T00:00:00");
        keys.add(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`);
      }
      setCollapsedMonths(keys);
      setColapsados(new Set());          // grupos expandidos por defecto
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [year]);

  // ── Grupos (misma lógica que CapacityGantt) ────────────────
  const grupos = useMemo(() => {
    if (!data) return new Map<string, PersonaCapacity[]>();
    const map = new Map<string, PersonaCapacity[]>();
    for (const p of data.personas) {
      if (esDesarrollo(p.cargo_actual)) continue;
      const g = cargoAGrupo(p.cargo_actual);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(p);
    }
    const ordered = new Map<string, PersonaCapacity[]>();
    for (const g of CAPACITY_GRUPO_ORDER) { if (map.has(g)) ordered.set(g, map.get(g)!); }
    for (const [g, ps] of map)            { if (!ordered.has(g)) ordered.set(g, ps);     }
    return ordered;
  }, [data]);

  // ── Mapa ausencias por persona ─────────────────────────────
  const ausenciasMap = useMemo((): Map<string, AusenciaCapacity[]> => {
    const map = new Map<string, AusenciaCapacity[]>();
    for (const a of data?.ausencias ?? []) {
      if (!map.has(a.persona_id)) map.set(a.persona_id, []);
      map.get(a.persona_id)!.push(a);
    }
    return map;
  }, [data]);

  /** Valor efectivo de una persona en una semana (0 si ausente) */
  const getValEfectivo = useCallback(
    (pid: string, sem: string): { value: number; ausente: boolean } => {
      if (!data) return { value: 0, ausente: false };
      const ausencias = ausenciasMap.get(pid) ?? [];
      if (semanaTieneAusencia(sem, ausencias)) return { value: 0, ausente: true };
      return { value: getVal(data.valores, pid, sem), ausente: false };
    },
    [ausenciasMap, data],
  );

  // ── Agrupación mes → semanas ───────────────────────────────
  const monthGroups = useMemo(() => {
    if (!data) return new Map<string, { label: string; semanas: string[] }>();
    const map = new Map<string, { label: string; semanas: string[] }>();
    for (const sem of data.semanas) {
      const dt = new Date(sem + "T00:00:00");
      const mk = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      if (!map.has(mk)) map.set(mk, { label: MESES_LABELS[dt.getMonth()], semanas: [] });
      map.get(mk)!.semanas.push(sem);
    }
    return map;
  }, [data]);

  // ── Cuello de botella por semana ───────────────────────────
  const bottleneckPorSemana = useMemo((): Record<string, string> => {
    if (!data) return {};
    const result: Record<string, string> = {};
    for (const sem of data.semanas) {
      let minVal = Infinity, minGrupo = "";
      for (const g of GRUPOS_BOTTLENECK) {
        const suma = (grupos.get(g) ?? []).reduce((acc, p) => acc + getValEfectivo(p.id, sem).value, 0);
        if (suma < minVal) { minVal = suma; minGrupo = g; }
      }
      result[sem] = minGrupo;
    }
    return result;
  }, [data, grupos, getValEfectivo]);

  // ── Capacidad real de venta por semana ─────────────────────
  const capacidadRealPorSemana = useMemo((): Record<string, number> => {
    if (!data) return {};
    const result: Record<string, number> = {};
    for (const sem of data.semanas) {
      const vals = GRUPOS_BOTTLENECK.map(
        g => (grupos.get(g) ?? []).reduce((acc, p) => acc + getValEfectivo(p.id, sem).value, 0),
      );
      result[sem] = vals.length ? Math.min(...vals) : 0;
    }
    return result;
  }, [data, grupos, getValEfectivo]);

  // ── Handlers colapso ──────────────────────────────────────
  function toggleGrupo(g: string) {
    setColapsados(prev => { const s = new Set(prev); s.has(g) ? s.delete(g) : s.add(g); return s; });
  }
  function toggleMonth(mk: string) {
    setCollapsedMonths(prev => { const s = new Set(prev); s.has(mk) ? s.delete(mk) : s.add(mk); return s; });
  }
  function toggleAllMonths() {
    setCollapsedMonths(prev => prev.size >= monthGroups.size ? new Set() : new Set(monthGroups.keys()));
  }

  const totalWidth = 220 + Array.from(monthGroups.entries()).reduce(
    (acc, [mk, { semanas: ms }]) => acc + (collapsedMonths.has(mk) ? COLLAPSED_W : ms.length * CELL_W),
    0,
  );

  // ─────────────────────────────────────────────────────────────
  //  Render
  // ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header ── */}
      <header className="h-14 bg-white border-b border-[#e8e8e8] flex items-center px-6 gap-3 flex-shrink-0">
        <Link
          href="/reportes"
          className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <Layers className="w-4 h-4 text-[#4a90e2]" />
        <h1 className="text-[16px] font-bold flex-1 text-[#1a1a2e]">Capacity de Proyectos</h1>

        {/* Selector de año */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#888] font-medium">Año</span>
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="text-[12px] font-semibold border border-[#e8e8e8] rounded-lg px-3 py-1.5 bg-white text-[#1a1a2e] focus:outline-none focus:border-[#4a90e2] cursor-pointer"
          >
            {ANIOS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </header>

      {/* ── Toolbar ── */}
      {!loading && data && (
        <div className="flex items-center justify-between px-6 py-2 border-b border-[#f0f0f0] bg-white flex-shrink-0">
          <span className="text-[11px] text-[#aaa]">
            {grupos.size} grupos · {data.personas.filter(p => !esDesarrollo(p.cargo_actual)).length} personas
            <span className="ml-2 px-1.5 py-0.5 bg-[#f0f6ff] text-[#4a90e2] rounded text-[10px] font-semibold">solo lectura</span>
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleAllMonths}
              className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e8e8e8] text-[#888] hover:text-[#555] hover:bg-[#f5f5f5] transition-colors"
            >
              {collapsedMonths.size >= monthGroups.size ? "Expandir meses" : "Colapsar meses"}
            </button>
            <button
              onClick={() => colapsados.size >= grupos.size
                ? setColapsados(new Set())
                : setColapsados(new Set(grupos.keys()))
              }
              className="text-[11px] px-2.5 py-1 rounded-lg border border-[#e8e8e8] text-[#888] hover:text-[#555] hover:bg-[#f5f5f5] transition-colors"
            >
              {colapsados.size >= grupos.size ? "Expandir grupos" : "Colapsar grupos"}
            </button>
          </div>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className="flex-1 flex items-center justify-center gap-2 text-[#888]">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Cargando capacity {year}…</span>
        </div>
      )}

      {/* ── Tabla ── */}
      {!loading && data && (
        <div className="flex-1 overflow-auto">
          <table
            className="border-collapse text-[12px]"
            style={{ minWidth: `${totalWidth}px` }}
          >
            <thead className="sticky top-0 z-20">

              {/* Fila 1: etiquetas de mes */}
              <tr>
                <th
                  className="sticky left-0 z-30 bg-[#fafafa] border-b border-r border-[#ebebeb]"
                  style={{ minWidth: 220, width: 220 }}
                />
                {Array.from(monthGroups.entries()).flatMap(([mk, { label, semanas: ms }]) => {
                  const isCollapsed = collapsedMonths.has(mk);
                  if (isCollapsed) {
                    return [
                      <th
                        key={`mes-${mk}`}
                        className="bg-[#fafafa] border-b border-l-2 border-l-[#d1d5db] border-[#ebebeb] px-1 py-1 text-center"
                        style={{ minWidth: COLLAPSED_W, width: COLLAPSED_W }}
                      >
                        <button onClick={() => toggleMonth(mk)} className="flex items-center justify-center gap-0.5 w-full">
                          <ChevronRight className="w-3 h-3 text-[#6b7280]" />
                          <span className="text-[9px] font-bold text-[#6b7280] uppercase tracking-wide">{label}</span>
                        </button>
                      </th>,
                    ];
                  }
                  return ms.map((sem, i) => (
                    <th
                      key={`mes-${sem}`}
                      className={`bg-[#fafafa] border-b border-[#ebebeb] px-1 py-1 text-center ${i === 0 ? "border-l-2 border-l-[#d1d5db]" : ""}`}
                      style={{ minWidth: CELL_W, width: CELL_W }}
                    >
                      {i === 0 && (
                        <button onClick={() => toggleMonth(mk)} className="flex items-center justify-center gap-0.5 w-full">
                          <ChevronDown className="w-3 h-3 text-[#6b7280]" />
                          <span className="text-[9px] font-bold text-[#6b7280] uppercase tracking-wide">{label}</span>
                        </button>
                      )}
                    </th>
                  ));
                })}
              </tr>

              {/* Fila 2: "Persona" + números de semana o "prom. mes" */}
              <tr>
                <th
                  className="sticky left-0 z-30 bg-[#fafafa] border-b border-r border-[#ebebeb] px-4 py-2 text-left text-[11px] font-semibold text-[#888] uppercase tracking-wide"
                  style={{ minWidth: 220, width: 220 }}
                >
                  Persona
                </th>
                {Array.from(monthGroups.entries()).flatMap(([mk, { semanas: ms }]) => {
                  const isCollapsed = collapsedMonths.has(mk);
                  if (isCollapsed) {
                    return [
                      <th
                        key={`sem-${mk}`}
                        className="bg-[#fafafa] border-b border-l-2 border-l-[#d1d5db] border-[#ebebeb] py-2 text-center"
                        style={{ minWidth: COLLAPSED_W, width: COLLAPSED_W }}
                      >
                        <span className="text-[10px] text-[#aaa] font-semibold italic">prom. mes</span>
                      </th>,
                    ];
                  }
                  return ms.map((sem, i) => {
                    const { semana } = labelSemana(sem);
                    return (
                      <th
                        key={sem}
                        className={`bg-[#fafafa] border-b border-[#ebebeb] py-2 text-center ${i === 0 ? "border-l-2 border-l-[#d1d5db]" : ""}`}
                        style={{ minWidth: CELL_W, width: CELL_W }}
                      >
                        <span className="text-[10px] text-[#888] font-semibold">{semana}</span>
                      </th>
                    );
                  });
                })}
              </tr>
            </thead>

            <tbody>
              {Array.from(grupos.entries()).map(([cargo, equipo]) => {
                const colapsado = colapsados.has(cargo);
                return (
                  <React.Fragment key={cargo}>

                    {/* ── Cabecera de grupo ── */}
                    <tr className="bg-[#f0f0f0] border-t-2 border-b border-[#ddd]">
                      <td
                        className="sticky left-0 z-10 bg-[#f0f0f0] border-r border-[#ddd] px-2 py-1.5"
                        style={{ minWidth: 220, width: 220 }}
                      >
                        <button
                          onClick={() => toggleGrupo(cargo)}
                          className="flex items-center gap-1.5 min-w-0 hover:opacity-70 transition-opacity w-full"
                        >
                          {colapsado
                            ? <ChevronRight className="w-3 h-3 text-[#777] flex-shrink-0" />
                            : <ChevronDown  className="w-3 h-3 text-[#777] flex-shrink-0" />}
                          <span className="text-[10px] font-bold text-[#444] uppercase tracking-wide truncate">{cargo}</span>
                          <span className="text-[9px] text-[#aaa] ml-1 flex-shrink-0">· {equipo.length}</span>
                        </button>
                      </td>
                      {Array.from(monthGroups.entries()).flatMap(([mk, { semanas: ms }]) => {
                        const isCollapsedMonth = collapsedMonths.has(mk);
                        if (isCollapsedMonth) {
                          if (colapsado) {
                            const avgSum = ms.reduce((acc, s) => acc + equipo.reduce((a, p) => a + getValEfectivo(p.id, s).value, 0), 0) / ms.length;
                            const esBottle = GRUPOS_BOTTLENECK.includes(cargo) && ms.some(s => bottleneckPorSemana[s] === cargo);
                            return [
                              <td key={`chead-${mk}`}
                                className="border-l-2 border-l-[#d1d5db] py-1 text-center"
                                style={{ minWidth: COLLAPSED_W, width: COLLAPSED_W }}
                              >
                                <span
                                  className="text-[11px] font-bold px-1 rounded"
                                  style={esBottle ? { color: "#dc2626", background: "#fee2e2" } : { color: "#1d4ed8" }}
                                >
                                  {round2(avgSum)}
                                </span>
                              </td>,
                            ];
                          }
                          return [
                            <td key={`chead-${mk}`}
                              className="border-l-2 border-l-[#d1d5db]"
                              style={{ minWidth: COLLAPSED_W, width: COLLAPSED_W }}
                            />,
                          ];
                        }
                        if (colapsado) {
                          return ms.map((sem, i) => {
                            const suma = equipo.reduce((acc, p) => acc + getValEfectivo(p.id, sem).value, 0);
                            const esBottle = GRUPOS_BOTTLENECK.includes(cargo) && bottleneckPorSemana[sem] === cargo;
                            return (
                              <td key={sem}
                                className={`py-1 text-center ${i === 0 ? "border-l-2 border-l-[#d1d5db]" : ""}`}
                                style={{ minWidth: CELL_W, width: CELL_W }}
                              >
                                <span
                                  className="text-[11px] font-bold px-1 rounded"
                                  style={esBottle ? { color: "#dc2626", background: "#fee2e2" } : { color: "#1d4ed8" }}
                                >
                                  {suma}
                                </span>
                              </td>
                            );
                          });
                        }
                        return ms.map((sem, i) => (
                          <td key={sem}
                            className={i === 0 ? "border-l-2 border-l-[#d1d5db]" : ""}
                            style={{ minWidth: CELL_W, width: CELL_W }}
                          />
                        ));
                      })}
                    </tr>

                    {/* ── Filas de personas ── */}
                    {!colapsado && equipo.map((p, idx) => (
                      <tr key={p.id} className={idx % 2 === 0 ? "bg-white" : "bg-[#fafafa]"}>
                        <td
                          className="sticky left-0 z-10 bg-inherit border-r border-[#ebebeb] px-3 py-1.5"
                          style={{ minWidth: 220, width: 220 }}
                        >
                          <span className="text-[12px] font-medium text-[#1a1a1a]">
                            {p.nombre} {p.apellido}
                          </span>
                        </td>
                        {Array.from(monthGroups.entries()).flatMap(([mk, { semanas: ms }]) => {
                          const isCollapsed = collapsedMonths.has(mk);
                          if (isCollapsed) {
                            const vals    = ms.map(s => getValEfectivo(p.id, s));
                            const avgV    = vals.reduce((acc, { value }) => acc + value, 0) / ms.length;
                            const anyAus  = vals.some(v => v.ausente);
                            return [
                              <td key={`cell-${p.id}-${mk}`}
                                className="py-1 px-1 text-center border-b border-[#f5f5f5] border-l-2 border-l-[#d1d5db]"
                                style={{ minWidth: COLLAPSED_W, width: COLLAPSED_W }}
                              >
                                <span
                                  className="text-[11px] font-bold"
                                  style={{ color: anyAus ? "#9ca3af" : "#1d4ed8" }}
                                >
                                  {round2(avgV)}
                                </span>
                              </td>,
                            ];
                          }
                          return ms.map((sem, i) => {
                            const { value: v, ausente } = getValEfectivo(p.id, sem);
                            const cs = cellStyle(v);
                            return (
                              <td key={sem}
                                className={`py-1 px-1 text-center border-b border-[#f5f5f5] ${i === 0 ? "border-l-2 border-l-[#d1d5db]" : ""}`}
                                style={{ minWidth: CELL_W, width: CELL_W, background: ausente ? "#f3f4f6" : undefined }}
                                title={ausente ? "Ausencia registrada" : undefined}
                              >
                                {ausente ? (
                                  <div className="flex flex-col items-center justify-center gap-px">
                                    <span className="text-[10px] font-bold text-[#9ca3af]">0</span>
                                    <span className="text-[8px] font-semibold text-[#d1d5db] uppercase tracking-wide leading-none">Aus.</span>
                                  </div>
                                ) : (
                                  <span
                                    className="inline-block w-9 text-center text-[11px] font-bold rounded py-0.5"
                                    style={cs}
                                  >
                                    {v}
                                  </span>
                                )}
                              </td>
                            );
                          });
                        })}
                      </tr>
                    ))}

                    {/* ── Fila Total del grupo (sólo expandido) ── */}
                    {!colapsado && (
                      <tr className="bg-[#f4f4f4] border-t border-b border-[#e0e0e0]">
                        <td
                          className="sticky left-0 z-10 bg-[#f4f4f4] border-r border-[#e0e0e0] px-4 py-1"
                          style={{ minWidth: 220, width: 220 }}
                        >
                          <span className="text-[10px] font-bold text-[#555] uppercase tracking-wide">
                            Total · {cargo}
                          </span>
                        </td>
                        {Array.from(monthGroups.entries()).flatMap(([mk, { semanas: ms }]) => {
                          const isCollapsed = collapsedMonths.has(mk);
                          if (isCollapsed) {
                            const avgSum = ms.reduce((acc, s) => acc + equipo.reduce((a, p) => a + getValEfectivo(p.id, s).value, 0), 0) / ms.length;
                            return [
                              <td key={`total-${cargo}-${mk}`}
                                className="py-1 text-center border-l-2 border-l-[#d1d5db]"
                                style={{ minWidth: COLLAPSED_W, width: COLLAPSED_W }}
                              >
                                <span className="text-[11px] font-bold px-1 rounded" style={{ color: "#1d4ed8" }}>
                                  {round2(avgSum)}
                                </span>
                              </td>,
                            ];
                          }
                          return ms.map((sem, i) => {
                            const suma     = equipo.reduce((acc, p) => acc + getValEfectivo(p.id, sem).value, 0);
                            const esBottle = GRUPOS_BOTTLENECK.includes(cargo) && bottleneckPorSemana[sem] === cargo;
                            return (
                              <td key={sem}
                                className={`py-1 text-center ${i === 0 ? "border-l-2 border-l-[#d1d5db]" : ""}`}
                                style={{ minWidth: CELL_W, width: CELL_W }}
                              >
                                <span
                                  className="text-[11px] font-bold px-1 rounded"
                                  style={esBottle ? { color: "#dc2626", background: "#fee2e2" } : { color: "#1d4ed8" }}
                                  title={esBottle ? "Cuello de botella" : undefined}
                                >
                                  {suma}
                                </span>
                              </td>
                            );
                          });
                        })}
                      </tr>
                    )}

                  </React.Fragment>
                );
              })}

              {/* ── Fila Capacidad Real de Venta ── */}
              <tr className="border-t-2 border-[#4a90e2]" style={{ background: "#1a1a2e" }}>
                <td
                  className="sticky left-0 z-10 border-r border-[#2d2d4e] px-3 py-2.5"
                  style={{ minWidth: 220, width: 220, background: "#1a1a2e" }}
                >
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-3.5 h-3.5 text-[#4a90e2] flex-shrink-0" />
                    <p className="text-[10px] font-bold text-white uppercase tracking-wide leading-tight">
                      Cap. Real de Venta
                    </p>
                  </div>
                </td>
                {Array.from(monthGroups.entries()).flatMap(([mk, { semanas: ms }]) => {
                  const isCollapsed = collapsedMonths.has(mk);
                  if (isCollapsed) {
                    const avg = ms.reduce((acc, s) => acc + (capacidadRealPorSemana[s] ?? 0), 0) / ms.length;
                    const btCount: Record<string, number> = {};
                    for (const s of ms) { const g = bottleneckPorSemana[s]; if (g) btCount[g] = (btCount[g] ?? 0) + 1; }
                    const bt = Object.entries(btCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
                    return [
                      <td key={`real-${mk}`}
                        className="py-2 text-center border-l-2 border-l-[#4a90e2]"
                        style={{ minWidth: COLLAPSED_W, width: COLLAPSED_W }}
                      >
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-[13px] font-black text-white leading-none">{round2(avg)}</span>
                          {bt && (
                            <span className="text-[8px] font-semibold text-[#f87171] leading-none">
                              ↓ {GRUPO_LABEL_SHORT[bt] ?? bt}
                            </span>
                          )}
                        </div>
                      </td>,
                    ];
                  }
                  return ms.map((sem, i) => {
                    const v  = capacidadRealPorSemana[sem] ?? 0;
                    const bt = bottleneckPorSemana[sem];
                    return (
                      <td key={sem}
                        className={`py-2 text-center ${i === 0 ? "border-l-2 border-l-[#4a90e2]" : ""}`}
                        style={{ minWidth: CELL_W, width: CELL_W }}
                        title={bt ? `Cuello: ${GRUPO_LABEL_SHORT[bt] ?? bt}` : undefined}
                      >
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-[12px] font-black text-white leading-none">{v}</span>
                          {bt && (
                            <span className="text-[8px] font-semibold text-[#f87171] leading-none">
                              {GRUPO_LABEL_SHORT[bt] ?? bt}
                            </span>
                          )}
                        </div>
                      </td>
                    );
                  });
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
