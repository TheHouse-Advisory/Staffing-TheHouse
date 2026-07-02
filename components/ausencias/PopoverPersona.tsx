"use client";

import React, { useState, useEffect } from "react";
import { X, Loader2, Clock, Calendar } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  COLOR_AUSENCIA,
  getDetailedPersonAbsences,
  type AusenciaDetalle,
  type DetalleAusenciasPersona,
} from "@/lib/queries/ausencias";

// Forma mínima de persona que necesita este popover — compatible con PersonaConSeniority
// (vista mensual/semanal) y con PersonaTrimestral (vista trimestre) sin acoplarse a ninguna.
export interface PersonaPopover {
  id: string;
  nombre: string;
  apellido: string;
  cargo_actual: string | null;
}

function formatRangoAus(inicio: string, fin: string): string {
  const MESES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  const fmt = (iso: string) => {
    const [, m, d] = iso.split("-");
    return `${parseInt(d)} ${MESES[parseInt(m) - 1]}`;
  };
  return inicio === fin ? fmt(inicio) : `${fmt(inicio)} – ${fmt(fin)}`;
}

function BloqueAusencias({ titulo, icono, items, emptyMsg }: {
  titulo: string;
  icono: React.ReactNode;
  items: AusenciaDetalle[];
  emptyMsg: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[#aaa]">{icono}</span>
        <p className="text-[10px] font-bold text-[#888] uppercase tracking-widest">{titulo}</p>
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-[#bbb] italic pl-1">{emptyMsg}</p>
      ) : (
        <div className="space-y-1 max-h-36 overflow-y-auto">
          {items.map((a) => (
            <div key={a.id} className="flex items-center justify-between bg-[#fafafa] rounded-lg border border-[#f0f0f0] px-2.5 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COLOR_AUSENCIA[a.tipo]?.bg ?? "#9ca3af" }} />
                <div className="min-w-0">
                  <p className="text-[11px] text-[#333] font-semibold truncate">{formatRangoAus(a.fechaInicio, a.fechaFin)}</p>
                  <p className="text-[10px] text-[#999] truncate">{a.tipoLabel}</p>
                </div>
              </div>
              <span className="text-[11px] font-bold text-[#555] flex-shrink-0 ml-3 bg-white border border-[#e8e8e8] rounded-md px-1.5 py-0.5">
                {a.numDias}d
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PopoverPersona({ persona, onClose }: { persona: PersonaPopover; onClose: () => void }) {
  const [data, setData]       = useState<DetalleAusenciasPersona | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    setLoading(true);
    getDetailedPersonAbsences(supabase, persona.id).then((d) => { setData(d); setLoading(false); });
  }, [persona.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = data?.totalDiasAnioActual ?? 0;
  const badgeStyle: React.CSSProperties =
    total >= 15 ? { background: "#fef2f2", color: "#dc2626" } :
    total >= 10 ? { background: "#fff7ed", color: "#ea580c" } :
    total >  0  ? { background: "#eff6ff", color: "#2563eb" } :
                  { background: "#f3f4f6", color: "#9ca3af" };

  return (
    <>
      {/* Overlay — cierra al clicar fuera */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Tarjeta flotante */}
      <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 bg-white rounded-2xl border border-[#e8e8e8] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-[#f0f0f0] bg-[#fafafa]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[#1a1a1a] flex items-center justify-center text-white text-[12px] font-bold flex-shrink-0">
              {persona.nombre[0]}{persona.apellido[0]}
            </div>
            <div>
              <p className="text-[13px] font-bold text-[#1a1a1a]">{persona.nombre} {persona.apellido}</p>
              {persona.cargo_actual && <p className="text-[10px] text-[#888] mt-0.5">{persona.cargo_actual}</p>}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#e8e8e8] text-[#bbb] hover:text-[#555] transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Cuerpo */}
        {loading ? (
          <div className="flex items-center justify-center py-10 gap-2 text-[#888]">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs">Cargando...</span>
          </div>
        ) : data ? (
          <div className="px-4 py-4 space-y-4">
            {/* Total destacado */}
            <div className="flex items-center justify-between bg-[#f8faff] rounded-xl border border-[#dbeafe] px-4 py-3">
              <span className="text-[12px] font-semibold text-[#3b82f6]">Total días consumidos</span>
              <span className="text-[20px] font-black" style={badgeStyle}>{total}</span>
            </div>
            {/* Próximas */}
            <BloqueAusencias
              titulo="Próximas ausencias"
              icono={<Clock className="w-3 h-3" />}
              items={data.ausenciasFuturas}
              emptyMsg="Sin ausencias planificadas"
            />
            {/* Historial */}
            <BloqueAusencias
              titulo="Historial año actual"
              icono={<Calendar className="w-3 h-3" />}
              items={data.ausenciasPasadasAnioActual}
              emptyMsg="Sin historial este año"
            />
          </div>
        ) : null}
      </div>
    </>
  );
}
