"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";
import {
  fetchCapacitySnapshot,
  CAPACITY_GRUPO_ORDER,
  type CapacitySnapshotData,
} from "@/lib/queries/capacity";

function mesActualISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "2026-01" → "Enero 2026" */
function mesLabel(mesEvaluado: string): string {
  const [y, m] = mesEvaluado.split("-").map(Number);
  const label = new Date(y, m - 1, 1).toLocaleDateString("es-CL", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function CapacitySnapshotReport() {
  const [mesEvaluado, setMesEvaluado] = useState(mesActualISO());
  const [data, setData] = useState<CapacitySnapshotData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    setError(null);
    fetchCapacitySnapshot(createAnyClient(), mesEvaluado)
      .then((res) => { if (vivo) { setData(res); setLoading(false); } })
      .catch((e) => { if (vivo) { setError(`No se pudo calcular la dotación: ${e?.message ?? e}`); setData(null); setLoading(false); } });
    return () => { vivo = false; };
  }, [mesEvaluado]);

  // Personas cuyo cargo no pertenece a ningún grupo: antes sumaban al total pero no
  // aparecían en ninguna fila, así que las filas no cuadraban con el total
  const otros = data ? data.personas.filter((p) => !CAPACITY_GRUPO_ORDER.includes(p.grupo as never)) : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <label className="text-[11px] font-semibold text-[#555]">Mes evaluado</label>
        <input
          type="month"
          value={mesEvaluado}
          onChange={(e) => { if (e.target.value) setMesEvaluado(e.target.value); }} // borrar el mes mostraba "Invalid Date"
          className="text-sm border border-[#e0e0e0] rounded-md px-2 py-1"
        />
        <span className="text-[13px] font-bold text-[#1a1a2e]">{mesLabel(mesEvaluado)}</span>
        {!loading && data && (
          <span className="text-[11px] text-gray-400">{data.personas.length} personas en dotación</span>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-[#888] py-10 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Calculando snapshot...</span>
        </div>
      )}

      {!loading && error && <p className="text-sm text-red-500">{error}</p>}

      {!loading && data && (
        <div className="bg-white rounded-xl border border-[#e8e8e8] overflow-hidden">
          <table className="text-sm border-collapse w-full">
            <thead>
              <tr className="bg-[#f9f9f9] border-b border-[#e8e8e8]">
                <th className="border border-[#e8e8e8] px-3 py-2 text-left font-bold text-[11px] text-[#555]">Grupo</th>
                <th className="border border-[#e8e8e8] px-3 py-2 text-left font-bold text-[11px] text-[#555]">Personas</th>
                <th className="border border-[#e8e8e8] px-3 py-2 text-center font-bold text-[11px] text-[#555] w-20">Total</th>
              </tr>
            </thead>
            <tbody>
              {CAPACITY_GRUPO_ORDER.map((grupo) => {
                const personasGrupo = data.personas.filter((p) => p.grupo === grupo);
                if (personasGrupo.length === 0) return null;
                return (
                  <tr key={grupo} className="border-b border-[#f5f5f5]">
                    <td className="border border-[#e8e8e8] px-3 py-2 font-semibold text-[12px] text-[#1a1a1a] align-top">{grupo}</td>
                    <td className="border border-[#e8e8e8] px-3 py-2 text-[11px] text-[#666]">
                      {personasGrupo.map((p) => `${p.nombre} ${p.apellido}`).join(", ")}
                    </td>
                    <td className="border border-[#e8e8e8] px-3 py-2 text-center font-bold text-[#1a1a1a]">{personasGrupo.length}</td>
                  </tr>
                );
              })}
              {otros.length > 0 && (
                <tr className="border-b border-[#f5f5f5]">
                  <td className="border border-[#e8e8e8] px-3 py-2 font-semibold text-[12px] text-[#1a1a1a] align-top">Otros</td>
                  <td className="border border-[#e8e8e8] px-3 py-2 text-[11px] text-[#666]">
                    {otros.map((p) => `${p.nombre} ${p.apellido}${p.cargo ? ` (${p.cargo})` : " (sin cargo)"}`).join(", ")}
                  </td>
                  <td className="border border-[#e8e8e8] px-3 py-2 text-center font-bold text-[#1a1a1a]">{otros.length}</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="bg-[#f9f9f9] border-t-2 border-[#e0e0e0]">
                <td colSpan={2} className="border border-[#e8e8e8] px-3 py-2 text-right text-[11px] font-bold text-[#555] uppercase tracking-wide">
                  Total dotación {mesLabel(mesEvaluado)}
                </td>
                <td className="border border-[#e8e8e8] px-3 py-2 text-center font-bold text-[#1a1a2e]">{data.personas.length}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
