"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus, BarChart2 } from "lucide-react";
import { HeatmapAusencias } from "@/components/ausencias/HeatmapAusencias";
import { HeatmapAusenciasMes } from "@/components/ausencias/HeatmapAusenciasMes";
import { ResumenVacaciones } from "@/components/ausencias/ResumenVacaciones";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const LEYENDA = [
  { tipo: "vacaciones_confirmadas",   label: "Vacaciones confirmadas",     color: "#38bdf8" },
  { tipo: "vacaciones_por_confirmar", label: "Vacaciones por confirmar",   color: "#fbbf24" },
  { tipo: "permiso_sin_goce",         label: "Permiso sin goce de sueldo", color: "#92400e" },
  { tipo: "dia_post_proyecto",        label: "Día post proyecto",          color: "#f97316" },
  { tipo: "dia_beneficio",            label: "Día beneficio",              color: "#a855f7" },
  { tipo: "dia_administrativo",       label: "Día administrativo",         color: "#22c55e" },
  { tipo: "otro",                     label: "Otro",                       color: "#9ca3af" },
];

type Vista = "dia" | "mes";

export default function AusenciasPage() {
  const now = new Date();
  const [vista, setVista]   = useState<Vista>("dia");
  const [year, setYear]     = useState(now.getFullYear());
  const [month, setMonth]   = useState(now.getMonth() + 1);
  const [modalOpen, setModalOpen]   = useState(false);
  const [resumenOpen, setResumenOpen] = useState(false);

  function prevDia() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  }
  function nextDia() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="bg-white border-b border-[#e8e8e8] flex-shrink-0">

        {/* Fila 1: título + toggle vista + navegación + botones */}
        <div className="h-14 flex items-center px-6 gap-4">
          <h1 className="text-[16px] font-bold text-[#1a1a1a] flex-shrink-0">Ausencias</h1>

          {/* Toggle vista */}
          <div className="flex rounded-md overflow-hidden border border-[#e0e0e0] text-[12px] font-semibold flex-shrink-0">
            <button
              onClick={() => setVista("dia")}
              className="px-3 py-1.5 transition-colors"
              style={vista === "dia"
                ? { background: "#1a1a1a", color: "#fff" }
                : { background: "#fff", color: "#888" }}
            >
              Por día
            </button>
            <button
              onClick={() => setVista("mes")}
              className="px-3 py-1.5 transition-colors"
              style={vista === "mes"
                ? { background: "#1a1a1a", color: "#fff" }
                : { background: "#fff", color: "#888" }}
            >
              Por mes
            </button>
          </div>

          {/* Navegación */}
          {vista === "dia" ? (
            <div className="flex items-center gap-2">
              <button
                onClick={prevDia}
                className="w-7 h-7 rounded-md border border-[#e0e0e0] bg-white flex items-center justify-center hover:bg-[#f5f5f5] transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5 text-[#555]" />
              </button>
              <span className="text-xs font-semibold text-[#1a1a1a] min-w-[140px] text-center">
                {MESES[month - 1]} {year}
              </span>
              <button
                onClick={nextDia}
                className="w-7 h-7 rounded-md border border-[#e0e0e0] bg-white flex items-center justify-center hover:bg-[#f5f5f5] transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5 text-[#555]" />
              </button>
              <button
                onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth() + 1); }}
                className="ml-1 text-xs px-2.5 py-1 rounded-md border border-[#e0e0e0] hover:bg-[#f5f5f5] transition-colors text-[#555]"
              >
                Hoy
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setYear(y => y - 1)}
                className="w-7 h-7 rounded-md border border-[#e0e0e0] bg-white flex items-center justify-center hover:bg-[#f5f5f5] transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5 text-[#555]" />
              </button>
              <span className="text-xs font-semibold text-[#1a1a1a] min-w-[60px] text-center">
                {year}
              </span>
              <button
                onClick={() => setYear(y => y + 1)}
                className="w-7 h-7 rounded-md border border-[#e0e0e0] bg-white flex items-center justify-center hover:bg-[#f5f5f5] transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5 text-[#555]" />
              </button>
              <button
                onClick={() => setYear(now.getFullYear())}
                className="ml-1 text-xs px-2.5 py-1 rounded-md border border-[#e0e0e0] hover:bg-[#f5f5f5] transition-colors text-[#555]"
              >
                Hoy
              </button>
            </div>
          )}

          <div className="flex-1" />

          {/* Botones acción */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setResumenOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#e0e0e0] hover:bg-[#f5f5f5] rounded-lg text-[12px] font-semibold text-[#555] transition-colors"
            >
              <BarChart2 className="w-3.5 h-3.5" />
              Resumen vacaciones
            </button>
            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1a1a1a] hover:bg-[#333] rounded-lg text-[12px] font-semibold text-white transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Nueva ausencia
            </button>
          </div>
        </div>

        {/* Fila 2: leyenda */}
        <div className="flex items-center gap-5 px-6 pb-3 flex-wrap">
          {LEYENDA.map((l) => (
            <div key={l.tipo} className="flex items-center gap-2 flex-shrink-0">
              <span className="w-3 h-3 rounded flex-shrink-0" style={{ background: l.color }} />
              <span className="text-[12px] text-[#555]">{l.label}</span>
            </div>
          ))}
        </div>
      </header>

      {/* ── Contenido ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        {vista === "dia" ? (
          <HeatmapAusencias
            year={year}
            month={month}
            externalModalOpen={modalOpen}
            onExternalModalClose={() => setModalOpen(false)}
          />
        ) : (
          <HeatmapAusenciasMes year={year} />
        )}
      </div>

      {/* ── Panel resumen vacaciones ────────────────────────────── */}
      <ResumenVacaciones
        open={resumenOpen}
        onClose={() => setResumenOpen(false)}
      />
    </div>
  );
}
