"use client";

import { useEffect, useRef, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { createAnyClient } from "@/lib/supabase/client";

interface Props {
  engagementId: string;
  personaId: string;
  onClose: () => void;
}

interface EngagementDetalle {
  id: string;
  codigo: string | null;
  nombre: string;
  cliente: string | null;
  tipo: string | null;
  estado: string | null;
  fecha_inicio: string | null;
  fecha_fin_estimada: string | null;
  fecha_fin_real: string | null;
  descripcion: string | null;
  color: string | null;
  industria: string | null;
  capacidades: string[];
  tematicas: string[];
  asignaciones: { fecha_inicio: string; fecha_fin: string | null; cargo: string | null; pct: number }[];
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return format(new Date(d + "T00:00:00"), "d 'de' MMM yyyy", { locale: es });
}

export function EngagementDetalleModal({ engagementId, personaId, onClose }: Props) {
  const [data,    setData]    = useState<EngagementDetalle | null>(null);
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const sb = createAnyClient();
      const [engRes, capRes, temRes, asigRes] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sb as any).from("engagement")
          .select("id, codigo, nombre, cliente, tipo, estado, fecha_inicio, fecha_fin_estimada, fecha_fin_real, descripcion, color, industria:industria_id(nombre)")
          .eq("id", engagementId)
          .single(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sb as any).from("engagement_capacidad")
          .select("cat_capacidad:capacidad_id(nombre)")
          .eq("engagement_id", engagementId),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sb as any).from("engagement_tematica")
          .select("cat_tematica:tematica_id(nombre)")
          .eq("engagement_id", engagementId),
        sb.from("asignacion")
          .select("fecha_inicio, fecha_fin, cargo_al_momento, pct_dedicacion")
          .eq("engagement_id", engagementId)
          .eq("persona_id", personaId)
          .order("fecha_inicio"),
      ]);
      if (cancelled) return;

      const eng = engRes.data as any;
      setData({
        id:                eng?.id             ?? "",
        codigo:            eng?.codigo          ?? null,
        nombre:            eng?.nombre          ?? "—",
        cliente:           eng?.cliente         ?? null,
        tipo:              eng?.tipo            ?? null,
        estado:            eng?.estado          ?? null,
        fecha_inicio:      eng?.fecha_inicio    ?? null,
        fecha_fin_estimada:eng?.fecha_fin_estimada ?? null,
        fecha_fin_real:    eng?.fecha_fin_real  ?? null,
        descripcion:       eng?.descripcion     ?? null,
        color:             eng?.color           ?? null,
        industria:         eng?.industria?.nombre ?? null,
        capacidades: ((capRes.data ?? []) as any[]).map((r: any) => r.cat_capacidad?.nombre).filter(Boolean),
        tematicas:   ((temRes.data ?? []) as any[]).map((r: any) => r.cat_tematica?.nombre).filter(Boolean),
        asignaciones: ((asigRes.data ?? []) as any[]).map((r: any) => ({
          fecha_inicio: r.fecha_inicio,
          fecha_fin:    r.fecha_fin ?? null,
          cargo:        r.cargo_al_momento ?? null,
          pct:          Number(r.pct_dedicacion),
        })),
      });
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [engagementId, personaId]);

  // Click fuera → cerrar
  useEffect(() => {
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  const accentColor = data?.color ?? "#4a90e2";
  const finLabel = data?.fecha_fin_real ?? data?.fecha_fin_estimada;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50">
      <div
        ref={ref}
        className="bg-white rounded-xl shadow-2xl border border-gray-100 flex flex-col w-full overflow-hidden"
        style={{ maxWidth: 480, maxHeight: "88vh" }}
      >
        {/* Header con color del engagement */}
        <div
          className="px-5 py-4 flex items-start justify-between flex-shrink-0"
          style={{ background: accentColor + "18", borderBottom: `2px solid ${accentColor}33` }}
        >
          <div className="min-w-0">
            {data?.codigo && (
              <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: accentColor }}>
                {data.codigo}
              </p>
            )}
            <p className="font-bold text-[15px] text-[#1a1a2e] leading-tight truncate pr-6">
              {loading ? "Cargando…" : data?.nombre}
            </p>
            {data?.cliente && (
              <p className="text-[11px] text-slate-500 mt-0.5">{data.cliente}</p>
            )}
          </div>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-500 flex-shrink-0 ml-2">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body con scroll */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4 min-h-0">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-slate-300" />
            </div>
          ) : data && (
            <>
              {/* Fechas + estado */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Inicio</p>
                  <p className="text-[13px] font-medium text-slate-700">{fmtDate(data.fecha_inicio)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Término</p>
                  <p className="text-[13px] font-medium text-slate-700">
                    {finLabel ? fmtDate(finLabel) : <span className="text-[#16a34a] font-semibold">En curso</span>}
                  </p>
                </div>
                {data.industria && (
                  <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Industria</p>
                    <p className="text-[13px] font-medium text-slate-700">{data.industria}</p>
                  </div>
                )}
                {data.tipo && (
                  <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Tipo</p>
                    <p className="text-[13px] font-medium text-slate-700">{data.tipo}</p>
                  </div>
                )}
              </div>

              {/* Participación de la persona */}
              {data.asignaciones.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">
                    Participación en este proyecto
                  </p>
                  <div className="space-y-1.5">
                    {data.asignaciones.map((a, i) => {
                      const ini = new Date(a.fecha_inicio + "T00:00:00");
                      const fin = a.fecha_fin ? new Date(a.fecha_fin + "T00:00:00") : new Date();
                      const dias = Math.max(0, Math.floor((fin.getTime() - ini.getTime()) / 86_400_000));
                      return (
                        <div key={i} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                          <div>
                            {a.cargo && <p className="text-[11px] font-semibold text-slate-700">{a.cargo}</p>}
                            <p className="text-[10px] text-slate-400">
                              {fmtDate(a.fecha_inicio)} → {a.fecha_fin ? fmtDate(a.fecha_fin) : "actualidad"}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0 ml-3">
                            <p className="text-[11px] font-bold text-[#4a90e2]">{dias} días</p>
                            <p className="text-[10px] text-slate-400">{a.pct}% ded.</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Capacidades */}
              {data.capacidades.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Capacidades</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.capacidades.map((c) => (
                      <span key={c} className="text-[10px] px-2 py-0.5 rounded-full bg-[#f0f9f4] text-[#1e7e45] font-medium">{c}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Temáticas */}
              {data.tematicas.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Temáticas</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.tematicas.map((t) => (
                      <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-[#fdf4ff] text-[#6b21a8] font-medium">{t}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Descripción */}
              {data.descripcion && (
                <div>
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5">Descripción</p>
                  <p className="text-[12px] text-slate-600 leading-relaxed">{data.descripcion}</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
