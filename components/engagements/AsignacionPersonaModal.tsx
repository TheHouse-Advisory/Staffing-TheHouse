"use client";

import { useEffect, useState } from "react";
import { X, Plus, Trash2, Loader2, AlertCircle } from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";

interface Rango {
  tempId: string;            // key de React
  asignacionId: string | null; // null = nuevo a insertar
  inicio: string;
  fin: string;
}

interface Props {
  personaId: string;
  personaNombre: string;
  engagementId: string;
  engagementNombre: string;
  engInicio: string;
  engFin: string;
  requerimientoId: string | null;
  cargo: string | null;
  pct: number;
  estadoStaffing: "CONFIRMADO" | "PLAN";
  onClose: () => void;
  onGuardado: () => void;
}

export function AsignacionPersonaModal({
  personaId, personaNombre, engagementId, engagementNombre,
  engInicio, engFin, requerimientoId, cargo, pct, estadoStaffing,
  onClose, onGuardado,
}: Props) {
  const [rangos, setRangos] = useState<Rango[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  // Carga asignaciones existentes para esta persona + este req
  useEffect(() => {
    const sb = createAnyClient();
    const q = sb
      .from("asignacion")
      .select("id, fecha_inicio, fecha_fin")
      .eq("persona_id", personaId)
      .eq("engagement_id", engagementId)
      .order("fecha_inicio");

    // Si hay requerimiento_id, filtrar por él; si no, traer todos del engagement
    (requerimientoId
      ? (q as any).eq("requerimiento_id", requerimientoId)
      : q
    ).then(({ data }: { data: any[] | null }) => {
      if (data && data.length > 0) {
        setRangos(data.map((a) => ({
          tempId: a.id,
          asignacionId: a.id,
          inicio: a.fecha_inicio,
          fin: a.fecha_fin,
        })));
      } else {
        // Sin asignaciones previas: una fila vacía con el rango completo del engagement
        setRangos([{ tempId: "new-0", asignacionId: null, inicio: engInicio, fin: engFin }]);
      }
      setLoading(false);
    });
  }, [personaId, engagementId, requerimientoId, engInicio, engFin]);

  function addRango() {
    setRangos(prev => [...prev, {
      tempId: `new-${Date.now()}`,
      asignacionId: null,
      inicio: engInicio,
      fin: engFin,
    }]);
  }

  function removeRango(tempId: string) {
    if (rangos.length === 1) return; // mínimo 1
    setRangos(prev => prev.filter(r => r.tempId !== tempId));
  }

  function updateRango(tempId: string, field: "inicio" | "fin", value: string) {
    setRangos(prev => prev.map(r => r.tempId === tempId ? { ...r, [field]: value } : r));
  }

  function validate(): string | null {
    for (const r of rangos) {
      if (!r.inicio || !r.fin) return "Completa todas las fechas antes de guardar.";
      if (r.inicio > r.fin)    return `Inicio (${r.inicio}) posterior al fin (${r.fin}).`;
      if (r.inicio < engInicio) return `Fecha ${r.inicio} anterior al inicio del proyecto (${engInicio}).`;
      if (r.fin   > engFin)    return `Fecha ${r.fin} posterior al fin del proyecto (${engFin}).`;
    }
    // Detectar solapamientos
    const sorted = [...rangos].sort((a, b) => a.inicio.localeCompare(b.inicio));
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].inicio <= sorted[i - 1].fin) {
        return `Los períodos se solapan: ${sorted[i-1].inicio}–${sorted[i-1].fin} con ${sorted[i].inicio}–${sorted[i].fin}.`;
      }
    }
    return null;
  }

  async function handleGuardar() {
    const err = validate();
    if (err) { setError(err); return; }
    setError(null);
    setSaving(true);

    const sb = createAnyClient();

    // Eliminar asignaciones actuales del mismo (persona, engagement, req) para reemplazarlas
    const delQ = (sb as any)
      .from("asignacion")
      .delete()
      .eq("persona_id", personaId)
      .eq("engagement_id", engagementId);

    await (requerimientoId
      ? delQ.eq("requerimiento_id", requerimientoId)
      : delQ);

    // Insertar los rangos actuales
    const inserts = rangos.map(r => ({
      engagement_id:   engagementId,
      requerimiento_id: requerimientoId,
      persona_id:      personaId,
      cargo_al_momento: cargo,
      pct_dedicacion:  pct,
      estado:          "activa",
      estado_staffing: estadoStaffing,
      fecha_inicio:    r.inicio,
      fecha_fin:       r.fin,
    }));

    await (sb as any).from("asignacion").insert(inserts);

    setSaving(false);
    onGuardado();
  }

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />

      {/* Modal */}
      <div
        className="fixed z-50 bg-white rounded-xl shadow-2xl border border-gray-100 w-[400px]"
        style={{ top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <p className="font-bold text-[14px] text-[#1a1a2e] leading-tight">{personaNombre}</p>
            <p className="text-[11px] text-gray-400 mt-0.5 truncate max-w-[300px]">{engagementNombre}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors ml-2 flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-2">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
            Períodos de asignación
          </p>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-gray-300" />
            </div>
          ) : (
            <>
              {/* Filas de rangos */}
              {rangos.map((rng, idx) => (
                <div key={rng.tempId} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2.5">
                  {/* Número */}
                  <span className="text-[10px] text-gray-300 font-bold w-4 flex-shrink-0 text-center">
                    {idx + 1}
                  </span>

                  {/* Inputs fecha */}
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <input
                      type="date"
                      value={rng.inicio}
                      min={engInicio}
                      max={engFin}
                      onChange={(e) => updateRango(rng.tempId, "inicio", e.target.value)}
                      className="flex-1 min-w-0 px-2 py-1.5 text-[12px] border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#4a90e2]/40 focus:border-[#4a90e2] transition-colors bg-white"
                    />
                    <span className="text-gray-300 text-[11px] flex-shrink-0">→</span>
                    <input
                      type="date"
                      value={rng.fin}
                      min={rng.inicio || engInicio}
                      max={engFin}
                      onChange={(e) => updateRango(rng.tempId, "fin", e.target.value)}
                      className="flex-1 min-w-0 px-2 py-1.5 text-[12px] border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#4a90e2]/40 focus:border-[#4a90e2] transition-colors bg-white"
                    />
                  </div>

                  {/* Eliminar tramo */}
                  <button
                    onClick={() => removeRango(rng.tempId)}
                    disabled={rangos.length === 1}
                    title="Eliminar este período"
                    className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-400 disabled:opacity-20 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}

              {/* Botón agregar período */}
              <button
                onClick={addRango}
                className="flex items-center gap-1.5 text-[12px] text-[#4a90e2] hover:text-[#357abd] px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors w-full font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
                Agregar período
              </button>

              {/* Error de validación */}
              {error && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-1">
                  <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-red-600 leading-snug">{error}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-100">
          <p className="text-[10px] text-gray-300">
            Límite del proyecto: {engInicio} → {engFin}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 text-[12px] text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleGuardar}
              disabled={saving || loading}
              className="flex items-center gap-1.5 px-4 py-1.5 text-[12px] bg-[#4a90e2] text-white rounded-lg hover:bg-[#357abd] disabled:opacity-50 transition-colors font-semibold"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Guardar
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
