"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { createAnyClient } from "@/lib/supabase/client";
import { expandirRango } from "@/lib/queries/ausencias";

// ── Cálculo de días hábiles ────────────────────────────────────

function diasHabiles(desde: string, hasta: string): number {
  if (desde > hasta) return 0;
  return expandirRango(desde, hasta).length;
}

function calcDias(fechaInicio: string, fechaFin: string | null) {
  const hoy = new Date().toISOString().split("T")[0];
  if (fechaInicio > hoy) {
    // Proyecto futuro: días hasta que empiece
    return { dias: diasHabiles(hoy, fechaInicio) - 1, esFuturo: true };
  }
  // Proyecto activo: días hábiles desde inicio hasta hoy
  const fin = fechaFin && fechaFin < hoy ? fechaFin : hoy;
  return { dias: diasHabiles(fechaInicio, fin), esFuturo: false };
}

// ── Tipos ─────────────────────────────────────────────────────

interface AsignacionRow {
  id: string;
  engagementNombre: string;
  engagementCliente: string;
  fechaInicio: string;
  fechaFin: string | null;
  pct: number;
  dias: number;
  esFuturo: boolean;
}

interface Props {
  personaId: string;
  /** true → lista compacta para popups pequeños; false → tarjetas completas */
  compact?: boolean;
}

// ── Componente ────────────────────────────────────────────────

export function ProyectosPersonaDetalle({ personaId, compact = false }: Props) {
  const [asignaciones, setAsignaciones] = useState<AsignacionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const sb = createAnyClient();
      const hoy = new Date().toISOString().split("T")[0];

      const { data } = await (sb as any)
        .from("asignacion")
        .select("id, fecha_inicio, fecha_fin, pct_dedicacion, engagement:engagement_id(id, nombre, cliente)")
        .eq("persona_id", personaId)
        .eq("estado", "activa")
        .gte("fecha_fin", hoy)
        .order("fecha_inicio");

      setAsignaciones(
        ((data ?? []) as any[]).map((a) => {
          const { dias, esFuturo } = calcDias(a.fecha_inicio, a.fecha_fin);
          return {
            id: a.id,
            engagementNombre: a.engagement?.nombre ?? "—",
            engagementCliente: a.engagement?.cliente ?? "",
            fechaInicio: a.fecha_inicio,
            fechaFin: a.fecha_fin,
            pct: Number(a.pct_dedicacion),
            dias,
            esFuturo,
          };
        })
      );
      setLoading(false);
    }
    load();
  }, [personaId]);

  if (loading) return <p className="text-xs text-gray-300">Cargando proyectos...</p>;
  if (asignaciones.length === 0)
    return <p className="text-xs text-gray-300 italic">Sin proyectos activos o futuros.</p>;

  // ── Modo compacto (popup pequeño) ──
  if (compact) {
    return (
      <div className="space-y-2">
        {asignaciones.map((a) => (
          <div key={a.id} className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-[#1a1a2e] truncate leading-tight">{a.engagementNombre}</p>
              {a.engagementCliente && (
                <p className="text-[10px] text-gray-400 truncate">{a.engagementCliente}</p>
              )}
            </div>
            <div className="flex-shrink-0 flex flex-col items-end gap-0.5">
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none"
                style={
                  a.esFuturo
                    ? { background: "#f0fdf4", color: "#15803d" }
                    : { background: "#dbeafe", color: "#1d4ed8" }
                }
              >
                {a.esFuturo ? `En ${a.dias}d` : `${a.dias}d`}
              </span>
              <span className="text-[9px] text-gray-400">{a.pct}%</span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── Modo completo (perfil detallado) ──
  return (
    <div className="space-y-2">
      {asignaciones.map((a) => (
        <div
          key={a.id}
          className="flex items-start justify-between gap-3 p-3 rounded-lg border"
          style={
            a.esFuturo
              ? { background: "#f0fdf4", borderColor: "#bbf7d0" }
              : { background: "#f9f9f9", borderColor: "#f0f0f0" }
          }
        >
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm text-[#1a1a2e] truncate">{a.engagementNombre}</p>
            {a.engagementCliente && (
              <p className="text-xs text-gray-400 mt-0.5">{a.engagementCliente}</p>
            )}
            <p className="text-xs text-gray-400 mt-0.5">
              {format(new Date(a.fechaInicio + "T00:00:00"), "d MMM yyyy", { locale: es })}
              {" → "}
              {a.fechaFin
                ? format(new Date(a.fechaFin + "T00:00:00"), "d MMM yyyy", { locale: es })
                : "sin fecha"}
            </p>
          </div>
          <div className="flex-shrink-0 flex flex-col items-end gap-1">
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded-full"
              style={
                a.pct >= 100
                  ? { background: "#ffd4d4", color: "#c02020" }
                  : a.pct >= 50
                  ? { background: "#fff4d4", color: "#8a6200" }
                  : { background: "#dbeafe", color: "#1d4ed8" }
              }
            >
              {a.pct}%
            </span>
            <span
              className="text-[11px] font-bold"
              style={{ color: a.esFuturo ? "#15803d" : "#1a5276" }}
            >
              {a.esFuturo ? `Inicia en ${a.dias} días` : `Lleva ${a.dias} días`}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
