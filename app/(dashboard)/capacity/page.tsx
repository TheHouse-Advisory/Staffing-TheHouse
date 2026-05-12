"use client";

import { useState, useCallback, useMemo } from "react";
import { ChevronLeft, ChevronRight, AlertTriangle, TrendingUp } from "lucide-react";
import { CapacityGantt, type CapacityStats } from "@/components/capacity/CapacityGantt";
import { labelSemana } from "@/lib/queries/capacity";

// Grupos que participan en el min()
const GRUPOS_BOTTLENECK = ["Gerentes / Directores", "Seniors / Asociados", "Consultores"];

// Nombre corto para mostrar en el indicador
const GRUPO_LABEL: Record<string, string> = {
  "Gerentes / Directores": "Gerencia",
  "Seniors / Asociados":   "Seniors",
  "Consultores":           "Consultores",
};

export default function CapacityPage() {
  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [stats, setStats] = useState<CapacityStats | null>(null);

  const handleStats = useCallback((s: CapacityStats) => setStats(s), []);

  // ── Semana actual (lunes) ──────────────────────────────────
  const semanaActual = useMemo(() => {
    const d = new Date();
    const dow = d.getDay();
    d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
    return d.toISOString().split("T")[0];
  }, []);

  // ── Capacidad real por semana = min(A, B, C) ──────────────
  const capacidadRealPorSemana = useMemo((): Record<string, number> => {
    if (!stats) return {};
    const result: Record<string, number> = {};
    for (const sem of stats.semanas) {
      const valores = GRUPOS_BOTTLENECK.map(g => stats.grupoTotales[g]?.[sem] ?? 0);
      result[sem] = Math.min(...valores);
    }
    return result;
  }, [stats]);

  // ── Bottleneck por semana ──────────────────────────────────
  const bottleneckPorSemana = useMemo((): Record<string, string> => {
    if (!stats) return {};
    const result: Record<string, string> = {};
    for (const sem of stats.semanas) {
      let minVal = Infinity; let minGrupo = "";
      for (const g of GRUPOS_BOTTLENECK) {
        const v = stats.grupoTotales[g]?.[sem] ?? 0;
        if (v < minVal) { minVal = v; minGrupo = g; }
      }
      result[sem] = minGrupo;
    }
    return result;
  }, [stats]);

  // ── Capacidad real mensual (promedio de semanas del mes) ───
  const capacidadMensual = useMemo(() => {
    if (!stats) return [];
    // Agrupar semanas por mes
    const meses = new Map<string, { semanas: string[]; mes: string }>();
    for (const sem of stats.semanas) {
      const d   = new Date(sem + "T00:00:00");
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const mes = d.toLocaleDateString("es-CL", { month: "short" }).replace(".", "");
      if (!meses.has(key)) meses.set(key, { semanas: [], mes });
      meses.get(key)!.semanas.push(sem);
    }

    return Array.from(meses.entries()).map(([key, { semanas: sems, mes }]) => {
      const vals       = sems.map(s => capacidadRealPorSemana[s] ?? 0);
      const promedio   = Math.floor(vals.reduce((a, b) => a + b, 0) / vals.length);
      // bottleneck más frecuente del mes
      const btCount: Record<string, number> = {};
      for (const s of sems) { const g = bottleneckPorSemana[s]; if (g) btCount[g] = (btCount[g] ?? 0) + 1; }
      const bottleneck = Object.entries(btCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
      return { key, mes, promedio, bottleneck };
    });
  }, [capacidadRealPorSemana, bottleneckPorSemana, stats]);

  // ── Mes actual para el indicador principal ────────────────
  const mesActualKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const mesActual    = capacidadMensual.find(m => m.key === mesActualKey);
  const capReal      = mesActual?.promedio ?? 0;
  const bottleneck   = mesActual?.bottleneck ?? "";

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header ── */}
      <header className="bg-white border-b border-[#e8e8e8] flex-shrink-0">
        <div className="h-14 flex items-center px-6 gap-4">
          <h1 className="text-[16px] font-bold text-[#1a1a1a] flex-shrink-0">Capacity de Proyectos</h1>

          {/* Navegación año */}
          <div className="flex items-center gap-2">
            <button onClick={() => setYear(y => y - 1)} className="w-7 h-7 rounded-md border border-[#e0e0e0] bg-white flex items-center justify-center hover:bg-[#f5f5f5] transition-colors">
              <ChevronLeft className="w-3.5 h-3.5 text-[#555]" />
            </button>
            <span className="text-xs font-semibold text-[#1a1a1a] min-w-[40px] text-center">{year}</span>
            <button onClick={() => setYear(y => y + 1)} className="w-7 h-7 rounded-md border border-[#e0e0e0] bg-white flex items-center justify-center hover:bg-[#f5f5f5] transition-colors">
              <ChevronRight className="w-3.5 h-3.5 text-[#555]" />
            </button>
            <button onClick={() => setYear(now.getFullYear())} className="ml-1 text-xs px-2.5 py-1 rounded-md border border-[#e0e0e0] hover:bg-[#f5f5f5] transition-colors text-[#555]">
              Hoy
            </button>
          </div>

          <div className="flex-1" />

          {/* ── Indicador principal: Capacidad Real de Venta Mensual ── */}
          {stats && (
            <div className="flex items-center gap-3 bg-[#fafafa] border border-[#e8e8e8] rounded-xl px-4 py-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#2563eb]" />
                <div>
                  <p className="text-[10px] text-[#6b7280] leading-none">Capacidad real de venta mensual</p>
                  <p className="text-[18px] font-black text-[#1d4ed8] leading-tight">{capReal} proyectos</p>
                </div>
              </div>
              {bottleneck && (
                <div className="flex items-center gap-1.5 bg-[#fef2f2] border border-[#fecaca] rounded-lg px-2.5 py-1.5">
                  <AlertTriangle className="w-3 h-3 text-[#dc2626] flex-shrink-0" />
                  <span className="text-[10px] font-semibold text-[#dc2626]">
                    Restringido por {GRUPO_LABEL[bottleneck] ?? bottleneck}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Dashboard mensual ── */}
        <div className="px-6 pb-3 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-[#aaa] font-semibold uppercase tracking-wide mr-1">Capacidad mensual:</span>
          {capacidadMensual.map(({ key, mes, promedio, bottleneck: bt }) => {
            const esActual = key === mesActualKey;
            return (
              <div
                key={key}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold"
                title={bt ? `Restringido por ${GRUPO_LABEL[bt] ?? bt}` : undefined}
                style={
                  esActual
                    ? { background: "#eff6ff", borderColor: "#93c5fd", color: "#1d4ed8" }
                    : { background: "#f9fafb", borderColor: "#e5e7eb", color: "#374151" }
                }
              >
                <span className="capitalize">{mes}</span>
                <span className="font-black">{promedio}</span>
                {bt && <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" title={`Cuello: ${GRUPO_LABEL[bt] ?? bt}`} />}
              </div>
            );
          })}
        </div>
      </header>

      {/* ── Gantt ── */}
      <div className="flex-1 overflow-hidden p-5">
        <div className="h-full bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
          <CapacityGantt year={year} onStatsChange={handleStats} />
        </div>
      </div>
    </div>
  );
}
