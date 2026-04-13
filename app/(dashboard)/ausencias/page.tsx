"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { HeatmapAusencias } from "@/components/ausencias/HeatmapAusencias";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const LEYENDA = [
  { tipo: "vacaciones",          label: "Vacaciones",           color: "#3b82f6" },
  { tipo: "dia_libre",           label: "Día libre",            color: "#22c55e" },
  { tipo: "dia_administrativo",  label: "Día administrativo",   color: "#f59e0b" },
  { tipo: "permiso",             label: "Permiso",              color: "#a855f7" },
  { tipo: "licencia_medica",     label: "Licencia médica",      color: "#ef4444" },
  { tipo: "capacitacion",        label: "Capacitación",         color: "#06b6d4" },
  { tipo: "otro",                label: "Otro",                 color: "#9ca3af" },
];

export default function AusenciasPage() {
  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [modalOpen, setModalOpen] = useState(false);

  function prevMes() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  }
  function nextMes() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="h-14 bg-white border-b border-[#e8e8e8] flex items-center px-6 gap-4 flex-shrink-0">
        <h1 className="text-[16px] font-bold text-[#1a1a1a]">Ausencias</h1>
        <h1 className="text-[16px] font-bold text-[#1a1a1a]">Ausencias</h1>

        {/* Navegación mes */}
        <div className="flex items-center gap-2">
          <button
            onClick={prevMes}
            className="w-7 h-7 rounded-md border border-[#e0e0e0] bg-white flex items-center justify-center hover:bg-[#f5f5f5] transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5 text-[#555]" />
          </button>
          <span className="text-xs font-semibold text-[#1a1a1a] min-w-[140px] text-center">
            {MESES[month - 1]} {year}
          </span>
          <button
            onClick={nextMes}
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

        {/* Leyenda */}
        <div className="flex items-center gap-3 ml-2 flex-1 flex-wrap">
          {LEYENDA.map((l) => (
            <div key={l.tipo} className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                style={{ background: l.color }}
              />
              <span className="text-[11px] text-[#666]">{l.label}</span>
            </div>
          ))}
        </div>

        {/* Botón nueva ausencia */}
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1a1a1a] hover:bg-[#333] rounded-lg text-[12px] font-semibold text-white transition-colors flex-shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          Nueva ausencia
        </button>
      </header>

      {/* ── Contenido ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <HeatmapAusencias
          year={year}
          month={month}
          externalModalOpen={modalOpen}
          onExternalModalClose={() => setModalOpen(false)}
        />
      </div>
    </div>
  );
}
