"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { X, ChevronDown } from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";
import { getDetailedPersonAbsences, type AusenciaDetalle } from "@/lib/queries/ausencias";
import { ProyectosPersonaDetalle } from "@/components/personas/ProyectosPersonaDetalle";
import { TalentMatrix, getTalentBoxName } from "@/components/personas/TalentMatrix";
import type { Persona } from "@/lib/types/database";

const COLORES: Record<string, string> = {
  "Socio": "#1a1a2e", "Director de Proyectos": "#4a90e2", "Director": "#4a90e2",
  "Gerente de Proyectos": "#7c5cbf", "Gerente": "#7c5cbf", "Asociado": "#e2884a",
  "Consultor Senior": "#4ab89a", "Consultor de Proyectos": "#e24a6a",
  "Consultor Analista": "#a0b84a", "Consultor Trainee": "#c07c4a",
};
const COLOR_DEFAULT = "#94a3b8";


function iniciales(n: string, a: string) { return `${n[0] ?? ""}${a[0] ?? ""}`.toUpperCase(); }

function diasEnEmpresa(f: string | null | undefined): string | null {
  if (!f) return null;
  const d = Math.floor((Date.now() - new Date(f + "T00:00:00").getTime()) / 86_400_000);
  if (d < 0) return null;
  if (d < 365) return `${d} días`;
  const y = Math.floor(d / 365);
  return `${y} ${y === 1 ? "año" : "años"} y ${d % 365} días`;
}

interface ResumenData {
  ocupacion: number; totalProyectos: number; industrias: string[];
  capacidades: string[]; tematicas: string[];
  totalDiasAnioActual: number;
  ausenciasFuturas: Pick<AusenciaDetalle, "fechaInicio" | "fechaFin" | "numDias" | "tipoLabel">[];
  mentorNombre: string | null; mentoreados: string[];
}

interface Props {
  personaId: string;
  onClose: () => void;
  /** Ignorado — mantenido para compatibilidad con llamadores existentes */
  anchorX?: number;
  anchorY?: number;
}

export function PersonaResumenModal({ personaId, onClose }: Props) {
  const [persona, setPersona] = useState<Persona | null>(null);
  const [resumen, setResumen] = useState<ResumenData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAusencias, setShowAusencias] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const sb = createAnyClient();
      const [{ data: per }, asigRes, histRes, indRes, capRes, temRes, mentoreRes, ausDetalle] = await Promise.all([
        sb.from("persona").select("*").eq("id", personaId).single(),
        sb.from("asignacion").select("pct_dedicacion").eq("persona_id", personaId).eq("estado", "activa"),
        sb.from("asignacion").select("engagement_id").eq("persona_id", personaId),
        sb.from("persona_industria").select("cat_industria(nombre)").eq("persona_id", personaId),
        sb.from("persona_capacidad").select("cat_capacidad(nombre)").eq("persona_id", personaId),
        sb.from("persona_tematica").select("cat_tematica(nombre)").eq("persona_id", personaId),
        sb.from("persona").select("nombre, apellido").eq("mentor_id", personaId).eq("activo", true),
        getDetailedPersonAbsences(sb, personaId),
      ]);
      if (cancelled || !per) return;

      const p = per as Persona;
      const mentorRes = p.mentor_id
        ? await sb.from("persona").select("nombre, apellido").eq("id", p.mentor_id).single()
        : { data: null };
      if (cancelled) return;

      const ocupacion = ((asigRes.data ?? []) as any[]).reduce((s: number, a: any) => s + Number(a.pct_dedicacion), 0);
      const engUnicos = new Set(((histRes.data ?? []) as any[]).map((a: any) => a.engagement_id));

      setPersona(p);
      setResumen({
        ocupacion,
        totalProyectos: engUnicos.size,
        industrias:  ((indRes.data ?? []) as any[]).map((r: any) => r.cat_industria?.nombre).filter(Boolean),
        capacidades: ((capRes.data ?? []) as any[]).map((r: any) => r.cat_capacidad?.nombre).filter(Boolean),
        tematicas:   ((temRes.data ?? []) as any[]).map((r: any) => r.cat_tematica?.nombre).filter(Boolean),
        totalDiasAnioActual: ausDetalle.totalDiasAnioActual,
        ausenciasFuturas: ausDetalle.ausenciasFuturas,
        mentorNombre: mentorRes.data
          ? `${(mentorRes.data as any).nombre} ${(mentorRes.data as any).apellido}`
          : null,
        mentoreados: ((mentoreRes.data ?? []) as { nombre: string; apellido: string }[])
          .map((m) => `${m.nombre} ${m.apellido}`),
      });
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [personaId]);

  // Click fuera de la tarjeta → cerrar
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const color = persona ? (COLORES[persona.cargo_actual ?? ""] ?? COLOR_DEFAULT) : COLOR_DEFAULT;

  return (
    /* Backdrop fixed cubre toda la pantalla */
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50">
      {/* Tarjeta centrada: ancho fijo, altura máxima con scroll interno */}
      <div
        ref={cardRef}
        className="bg-white rounded-xl shadow-2xl border border-gray-100 flex flex-col w-full"
        style={{ maxWidth: 480, maxHeight: "90vh" }}
      >
        {/* ── Header fijo ── */}
        <div className="p-4 pb-2 flex-shrink-0 relative">
          <button onClick={onClose} className="absolute top-3 right-3 text-gray-300 hover:text-gray-500">
            <X className="w-4 h-4" />
          </button>
          {loading || !persona ? (
            <p className="text-sm text-gray-300 text-center py-4">Cargando...</p>
          ) : (
            <div className="flex items-center gap-2">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white text-base font-bold flex-shrink-0"
                style={{ backgroundColor: color }}
              >
                {iniciales(persona.nombre, persona.apellido)}
              </div>
              <div>
                <p className="font-bold text-[#1a1a2e] text-sm">{persona.nombre} {persona.apellido}</p>
                <p className="text-[11px] text-gray-400">{persona.cargo_actual ?? "Sin cargo"}</p>
              </div>
            </div>
          )}
        </div>

        {/* ── Body con scroll interno ── */}
        <div className="overflow-y-auto px-4 pb-8 flex-1 min-h-0">
          {!loading && persona && resumen && (
            <div className="space-y-2.5 text-sm">
              {(persona.is_leverager || diasEnEmpresa(persona.fecha_ingreso)) && (
                <div className="flex items-center gap-2 pb-1.5 border-b border-gray-100 flex-wrap">
                  {persona.is_leverager && (
                    <div className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#3b5bdb] flex-shrink-0" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[#3b5bdb]">Apalancador</span>
                    </div>
                  )}
                  {diasEnEmpresa(persona.fecha_ingreso) && (
                    <span className="text-[10px] text-gray-400">
                      ⌛ {diasEnEmpresa(persona.fecha_ingreso)} en la empresa
                    </span>
                  )}
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-xs">Disponibilidad</span>
                <span
                  className="font-semibold px-2 py-0.5 rounded-full text-xs"
                  style={
                    resumen.ocupacion >= 100
                      ? { background: "#fef2f2", color: "#dc2626" }
                      : resumen.ocupacion >= 80
                      ? { background: "#fefce8", color: "#ca8a04" }
                      : { background: "#f0fdf4", color: "#16a34a" }
                  }
                >
                  {Math.max(0, 100 - resumen.ocupacion)}% libre
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-xs">Nº proyectos</span>
                <span className="font-medium text-[#1a1a2e] text-xs">{resumen.totalProyectos}</span>
              </div>
              <div>
                <p className="text-gray-400 text-xs mb-1.5">Proyectos actuales</p>
                <ProyectosPersonaDetalle personaId={persona.id} compact />
              </div>
              {resumen.industrias.length > 0 && (
                <div>
                  <p className="text-gray-400 mb-1 text-xs">Industrias</p>
                  <div className="flex flex-wrap gap-1">
                    {resumen.industrias.map((i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#eaf4ff] text-[#1a5276]">{i}</span>
                    ))}
                  </div>
                </div>
              )}
              {resumen.capacidades.length > 0 && (
                <div>
                  <p className="text-gray-400 mb-1 text-xs">Capacidades</p>
                  <div className="flex flex-wrap gap-1">
                    {resumen.capacidades.map((c) => (
                      <span key={c} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#f0f9f4] text-[#1e7e45]">{c}</span>
                    ))}
                  </div>
                </div>
              )}
              {resumen.tematicas.length > 0 && (
                <div>
                  <p className="text-gray-400 mb-1 text-xs">Temáticas</p>
                  <div className="flex flex-wrap gap-1">
                    {resumen.tematicas.map((t) => (
                      <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#fdf4ff] text-[#6b21a8]">{t}</span>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <button
                  onClick={() => setShowAusencias((s) => !s)}
                  className="w-full flex justify-between items-center hover:bg-gray-50 rounded px-0.5 py-0.5 -mx-0.5 transition-colors"
                >
                  <span className="text-gray-400 text-xs">Ausencias año</span>
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-[#1a1a2e] text-xs">{resumen.totalDiasAnioActual}d</span>
                    <ChevronDown
                      className="w-3 h-3 text-gray-300"
                      style={{ transform: showAusencias ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}
                    />
                  </div>
                </button>
                {showAusencias && (
                  <div className="mt-1.5 pl-1 space-y-1">
                    {resumen.ausenciasFuturas.length === 0 ? (
                      <p className="text-[10px] text-gray-300 italic">Sin ausencias futuras</p>
                    ) : (
                      <>
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Próximas</p>
                        {resumen.ausenciasFuturas.map((a, i) => (
                          <div key={i} className="flex justify-between items-start gap-1">
                            <span className="text-[10px] text-gray-500 leading-tight truncate max-w-[160px]">{a.tipoLabel}</span>
                            <div className="text-right flex-shrink-0">
                              <p className="text-[10px] text-gray-400">{format(new Date(a.fechaInicio + "T00:00:00"), "d MMM", { locale: es })}</p>
                              <p className="text-[10px] font-semibold text-[#1a1a2e]">{a.numDias}d</p>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
              {(persona.talento_potencial != null || persona.talento_desempeno != null) && (
                <div className="flex flex-col gap-2">
                  <span className="text-gray-400 text-xs">
                    Talento{getTalentBoxName(persona.talento_potencial, persona.talento_desempeno) && (
                      <span className="text-[#1a1a2e] font-semibold ml-1">
                        : {getTalentBoxName(persona.talento_potencial, persona.talento_desempeno)}
                      </span>
                    )}
                  </span>
                  <TalentMatrix
                    potencial={persona.talento_potencial}
                    desempeno={persona.talento_desempeno}
                    isEditable={false}
                    size="full"
                  />
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-xs">Mentor</span>
                <span className="font-medium text-[#1a1a2e] text-xs">
                  {resumen.mentorNombre ?? <span className="text-gray-300">Sin mentor</span>}
                </span>
              </div>
              {resumen.mentoreados.length > 0 && (
                <div>
                  <p className="text-gray-400 mb-1 text-xs">Es mentor de</p>
                  <div className="flex flex-wrap gap-1">
                    {resumen.mentoreados.map((m) => (
                      <span key={m} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#f0f9f4] text-[#1e7e45] font-medium">{m}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
