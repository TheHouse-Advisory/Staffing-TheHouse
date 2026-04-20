"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { X, Loader2, Briefcase, Tag, CalendarOff, Star, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  fetchPersonaFitDetalle,
  type PersonaFitDetalle,
} from "@/lib/queries/planificacion";

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

function avatarColor(id: string) {
  const palette = ["#4a90e2","#e2844a","#4ac27a","#9b4ae2","#e24a7a","#4ae2d5","#e2c24a","#7a4ae2"];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

function iniciales(nombre: string, apellido: string) {
  return `${nombre[0] ?? ""}${apellido[0] ?? ""}`.toUpperCase();
}

function formatFecha(f: string) {
  try { return format(new Date(f + "T00:00:00"), "d MMM yy", { locale: es }); }
  catch { return f; }
}

function TalentoChip({ estado }: { estado: PersonaFitDetalle["estado_talento"] }) {
  if (!estado) return <span className="text-[#bbb] text-[11px]">Sin evaluar</span>;
  const map = {
    talento:     { bg: "#dcf5e7", text: "#1a7a45", label: "Talento" },
    en_proceso:  { bg: "#fff4d4", text: "#8a6200", label: "En proceso" },
    no_talento:  { bg: "#ffd4d4", text: "#c02020", label: "No talento" },
  };
  const { bg, text, label } = map[estado];
  return (
    <span
      className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
      style={{ background: bg, color: text }}
    >
      {label}
    </span>
  );
}

function CalifBadge({ valor }: { valor: number }) {
  const color =
    valor >= 5.5 ? "#1a7a45" :
    valor >= 4   ? "#8a6200" :
                   "#c02020";
  return (
    <span
      className="text-sm font-bold tabular-nums"
      style={{ color }}
    >
      {valor.toFixed(1)}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
//  Componente principal
// ─────────────────────────────────────────────────────────────

interface Props {
  personaId: string;
  nombre: string;
  apellido: string;
  cargo: string;
  industriaId: string | null;
  categoriaId: string | null;
  industriaNombre: string | null;
  categoriaNombre: string | null;
  fechaInicio: string;
  fechaFin: string;
  onClose: () => void;
}

export function PersonaFitTooltip({
  personaId,
  nombre,
  apellido,
  cargo,
  industriaId,
  categoriaId,
  industriaNombre,
  categoriaNombre,
  fechaInicio,
  fechaFin,
  onClose,
}: Props) {
  const [detalle, setDetalle] = useState<PersonaFitDetalle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    fetchPersonaFitDetalle(
      supabase, personaId, industriaId, categoriaId, fechaInicio, fechaFin
    ).then(({ detalle: d, error: e }) => {
      setDetalle(d);
      setError(e);
      setLoading(false);
    });
  }, [personaId, industriaId, categoriaId, fechaInicio, fechaFin]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
      />

      {/* Card */}
      <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 bg-white rounded-2xl shadow-2xl border border-[#e8e8e8] overflow-hidden">
        {/* Header con foto/avatar */}
        <div className="relative px-5 pt-5 pb-4 bg-[#f9f9f9] border-b border-[#f0f0f0]">
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center text-[#aaa] hover:text-[#555] hover:bg-[#eee] transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center gap-3">
            {/* Foto o avatar */}
            <div
              className="w-14 h-14 rounded-full overflow-hidden flex items-center justify-center font-bold text-white text-base flex-shrink-0"
              style={detalle?.foto_url ? {} : { background: avatarColor(personaId) }}
            >
              {detalle?.foto_url ? (
                <img src={detalle.foto_url} alt={nombre} className="w-full h-full object-cover" />
              ) : (
                iniciales(nombre, apellido)
              )}
            </div>

            <div className="min-w-0">
              <p className="text-sm font-bold text-[#1a1a1a] truncate">
                {nombre} {apellido}
              </p>
              <p className="text-[11px] text-[#888]">{cargo}</p>
              <div className="mt-1.5">
                {loading
                  ? <div className="w-16 h-4 bg-[#f0f0f0] rounded-full animate-pulse" />
                  : <TalentoChip estado={detalle?.estado_talento ?? null} />
                }
              </div>
            </div>
          </div>
        </div>

        {/* Cuerpo */}
        <div className="px-5 py-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-6 gap-2 text-[#888]">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-xs">Cargando datos...</span>
            </div>
          ) : error ? (
            <p className="text-xs text-red-500 text-center py-4">{error}</p>
          ) : detalle ? (
            <>
              {/* Experiencia en industria y categoría */}
              <div className="space-y-2">
                <p className="text-[10px] font-semibold text-[#888] uppercase tracking-widest">Experiencia</p>
                <div className="flex items-center gap-2">
                  <Briefcase className="w-3.5 h-3.5 text-[#aaa] flex-shrink-0" />
                  <span className="text-xs text-[#555]">
                    {industriaNombre ? (
                      <>
                        <span className="font-semibold text-[#1a1a1a]">{detalle.proyectos_misma_industria}</span>
                        {" "}proyecto{detalle.proyectos_misma_industria !== 1 ? "s" : ""} en{" "}
                        <span className="font-medium">{industriaNombre}</span>
                      </>
                    ) : (
                      <span className="text-[#bbb]">Industria no especificada</span>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Tag className="w-3.5 h-3.5 text-[#aaa] flex-shrink-0" />
                  <span className="text-xs text-[#555]">
                    {categoriaNombre ? (
                      <>
                        <span className="font-semibold text-[#1a1a1a]">{detalle.proyectos_misma_categoria}</span>
                        {" "}proyecto{detalle.proyectos_misma_categoria !== 1 ? "s" : ""} en{" "}
                        <span className="font-medium">{categoriaNombre}</span>
                      </>
                    ) : (
                      <span className="text-[#bbb]">Categoría no especificada</span>
                    )}
                  </span>
                </div>
              </div>

              {/* Vacaciones en el período */}
              {detalle.vacaciones_en_rango.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-[#888] uppercase tracking-widest">
                    Vacaciones en el período
                  </p>
                  <div className="space-y-1">
                    {detalle.vacaciones_en_rango.map((v, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <CalendarOff className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                        <span className="text-xs text-[#555]">
                          {formatFecha(v.fecha_inicio)} → {formatFecha(v.fecha_fin)}
                          {v.dias > 0 && (
                            <span className="ml-1 text-[#888]">({v.dias} día{v.dias !== 1 ? "s" : ""})</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Mentor */}
              <div className="flex items-center gap-2">
                <User className="w-3.5 h-3.5 text-[#aaa] flex-shrink-0" />
                <span className="text-xs text-[#555]">
                  <span className="text-[#888]">Mentor: </span>
                  {detalle.mentor_nombre
                    ? <span className="font-medium text-[#1a1a1a]">{detalle.mentor_nombre}</span>
                    : <span className="text-[#bbb]">Sin asignar</span>
                  }
                </span>
              </div>

              {/* Evaluaciones */}
              <div className="space-y-2 pt-1 border-t border-[#f5f5f5]">
                <p className="text-[10px] font-semibold text-[#888] uppercase tracking-widest">Evaluaciones</p>

                <div className="grid grid-cols-2 gap-3">
                  {/* EPP */}
                  <div className="bg-[#f9f9f9] rounded-xl p-3">
                    <div className="flex items-center gap-1 mb-1">
                      <Star className="w-3 h-3 text-[#aaa]" />
                      <span className="text-[10px] font-semibold text-[#888]">EPP</span>
                    </div>
                    {detalle.ultima_epp ? (
                      <>
                        <CalifBadge valor={detalle.ultima_epp.calificacion} />
                        <p className="text-[10px] text-[#aaa] mt-0.5 truncate">
                          {detalle.ultima_epp.engagement_nombre ?? formatFecha(detalle.ultima_epp.fecha)}
                        </p>
                      </>
                    ) : (
                      <span className="text-[11px] text-[#bbb]">Sin datos</span>
                    )}
                  </div>

                  {/* EDD */}
                  <div className="bg-[#f9f9f9] rounded-xl p-3">
                    <div className="flex items-center gap-1 mb-1">
                      <Star className="w-3 h-3 text-[#aaa]" />
                      <span className="text-[10px] font-semibold text-[#888]">EDD</span>
                    </div>
                    {detalle.ultima_edd ? (
                      <>
                        <CalifBadge valor={detalle.ultima_edd.calificacion} />
                        <p className="text-[10px] text-[#aaa] mt-0.5">
                          {detalle.ultima_edd.periodo}
                        </p>
                      </>
                    ) : (
                      <span className="text-[11px] text-[#bbb]">Sin datos</span>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
