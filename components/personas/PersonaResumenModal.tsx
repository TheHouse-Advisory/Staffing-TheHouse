"use client";

import { useEffect, useRef, useState } from "react";
import { format, intervalToDuration } from "date-fns";
import { es } from "date-fns/locale";

function calcDiasCard(fechaInicio: string, fechaFin: string) {
  const hoy = new Date().toISOString().split("T")[0];
  const esFuturo = fechaInicio > hoy;
  if (esFuturo) {
    const d = Math.max(0, Math.floor((new Date(fechaInicio + "T00:00:00").getTime() - new Date(hoy + "T00:00:00").getTime()) / 86_400_000));
    return { dias: d, esFuturo: true, diasRestantes: null };
  }
  const fin = fechaFin < hoy ? fechaFin : hoy;
  const dias = Math.max(0, Math.floor((new Date(fin + "T00:00:00").getTime() - new Date(fechaInicio + "T00:00:00").getTime()) / 86_400_000));
  const diasRestantes = Math.max(0, Math.floor((new Date(fechaFin + "T00:00:00").getTime() - new Date(hoy + "T00:00:00").getTime()) / 86_400_000));
  return { dias, esFuturo: false, diasRestantes };
}
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


function iniciales(n: string, a: string, custom?: string | null) {
  if (custom?.trim()) return custom.trim().toUpperCase().slice(0, 3);
  return `${n[0] ?? ""}${a[0] ?? ""}`.toUpperCase();
}

function diasEnEmpresa(f: string | null | undefined): string | null {
  if (!f) return null;
  const total = Math.floor((Date.now() - new Date(f + "T00:00:00").getTime()) / 86_400_000);
  if (total < 0) return null;
  const years = Math.floor(total / 365);
  const months = Math.floor((total % 365) / 30);
  const days = (total % 365) % 30;
  const partes: string[] = [];
  if (years > 0) partes.push(`${years} ${years === 1 ? "año" : "años"}`);
  if (months > 0) partes.push(`${months} ${months === 1 ? "mes" : "meses"}`);
  if (days > 0 || partes.length === 0) partes.push(`${days} ${days === 1 ? "día" : "días"}`);
  return partes.length === 1 ? partes[0] : partes.slice(0, -1).join(", ") + " y " + partes[partes.length - 1];
}

interface HistorialProyecto {
  engagement_id: string;
  codigo: string;
  nombre: string;
  industria: string;
  dias: number;
  fechaInicioLabel: string;
  fechaRef: string;
  activo: boolean;
}

interface ResumenData {
  ocupacion: number; totalProyectos: number; industrias: string[];
  capacidades: string[]; tematicas: string[];
  totalDiasAnioActual: number;
  ausenciasFuturas: Pick<AusenciaDetalle, "fechaInicio" | "fechaFin" | "numDias" | "tipoLabel">[];
  mentorNombre: string | null; mentoreados: string[];
  historialProyectos: HistorialProyecto[];
}

interface SimEngSnap {
  id: string; nombre: string; cliente: string | null; tipo: string;
  fecha_inicio: string; fecha_fin: string;
  personas: { id: string; pct: number; fecha_inicio: string; fecha_fin: string }[];
}

interface Props {
  personaId: string;
  onClose: () => void;
  /** Snapshot del escenario activo — cuando se pasa, sobreescribe ocupación y proyectos actuales */
  simulationSnapshot?: SimEngSnap[];
  /** Oculta la sección de Matriz de Talento para roles restringidos */
  ocultarMatriz?: boolean;
  /** Oculta porcentajes de carga para rol G&D */
  ocultarCarga?: boolean;
  /** Oculta badge Apalancador para roles restringidos */
  ocultarApalancador?: boolean;
  /** Oculta Nº proyectos, industrias, capacidades, temáticas y ausencias año para roles restringidos */
  ocultarInfoRestringida?: boolean;
  /** Badge Referente: solo visible si el usuario actual es admin */
  isAdmin?: boolean;
  /** Ignorado — mantenido para compatibilidad con llamadores existentes */
  anchorX?: number;
  anchorY?: number;
}

export function PersonaResumenModal({ personaId, onClose, simulationSnapshot, ocultarMatriz = false, ocultarCarga = false, ocultarApalancador = false, ocultarInfoRestringida = false, isAdmin = false }: Props) {
  const [persona, setPersona] = useState<Persona | null>(null);
  const [resumen, setResumen] = useState<ResumenData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAusencias, setShowAusencias] = useState(false);
  const [showMatriz, setShowMatriz] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const sb = createAnyClient();
      const [{ data: per }, asigRes, histRes, indRes, capRes, temRes, mentoreRes, ausDetalle] = await Promise.all([
        sb.from("persona").select("*").eq("id", personaId).single(),
        // Ocupación: excluye asignaciones "fantasma" (engagement borrado, en papelera, no activo o ya vencida)
        sb.from("asignacion")
          .select("pct_dedicacion, engagement:engagement_id!inner(estado, is_deleted)" as any)
          .eq("persona_id", personaId)
          .eq("estado", "activa")
          .eq("engagement.estado", "activo")
          .eq("engagement.is_deleted", false)
          .or(`fecha_fin.is.null,fecha_fin.gte.${new Date().toISOString().slice(0, 10)}`),
        // Historial: solo asignaciones YA FINALIZADAS (fecha_fin < hoy), con engagement existente y no borrado
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sb.from("asignacion").select("fecha_inicio, fecha_fin, engagement:engagement_id!inner(id, codigo, nombre, cliente, industria:industria_id(nombre), is_deleted)" as any).eq("persona_id", personaId).not("fecha_fin", "is", null).lt("fecha_fin", new Date().toISOString().slice(0, 10)).eq("engagement.is_deleted", false).order("fecha_inicio", { ascending: false }),
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

      // Agrupa historial por engagement y suma días
      const hoy = new Date();
      const histMap = new Map<string, HistorialProyecto>();
      ((histRes.data ?? []) as any[]).forEach((r: any) => {
        const engId = r.engagement?.id ?? "";
        const ini   = new Date((r.fecha_inicio as string) + "T00:00:00");
        const fin   = r.fecha_fin ? new Date((r.fecha_fin as string) + "T00:00:00") : hoy;
        const dias  = Math.max(0, Math.floor((fin.getTime() - ini.getTime()) / 86_400_000));
        const prev  = histMap.get(engId);
        if (prev) {
          prev.dias += dias;
          if ((r.fecha_inicio as string) > prev.fechaRef) prev.fechaRef = r.fecha_inicio as string;
          if (!r.fecha_fin) prev.activo = true;
        } else {
          histMap.set(engId, {
            engagement_id:   engId,
            codigo:          r.engagement?.codigo  ?? "",
            nombre:          r.engagement?.nombre  ?? "—",
            industria:       r.engagement?.industria?.nombre ?? r.engagement?.cliente ?? "",
            dias,
            fechaInicioLabel: format(ini, "d MMM yyyy", { locale: es }),
            fechaRef:        r.fecha_inicio as string,
            activo:          !r.fecha_fin,
          });
        }
      });
      const historialProyectos = [...histMap.values()].sort((a, b) => b.fechaRef.localeCompare(a.fechaRef));

      setPersona(p);
      setResumen({
        ocupacion,
        totalProyectos: histMap.size,
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
        historialProyectos,
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

  // Cargos junior: mantienen visible el detalle de días en el proyecto aunque el rol del viewer sea restringido
  const CARGOS_DETALLE_DIAS_VISIBLE = ["Consultor de Proyectos", "Consultor Analista", "Consultor Trainee"];
  const ocultarDiasProyecto = ocultarCarga && !CARGOS_DETALLE_DIAS_VISIBLE.includes(persona?.cargo_actual ?? "");

  // Override simulado: cuando hay snapshot, sobreescribir ocupación y proyectos actuales
  const simData = simulationSnapshot ? (() => {
    const hoy = format(new Date(), "yyyy-MM-dd");
    const proyectos = simulationSnapshot.filter((eng) => {
      const inicio = (eng.fecha_inicio ?? "").slice(0, 10);
      const fin    = (eng.fecha_fin    ?? "").slice(0, 10);
      return inicio <= hoy && hoy <= fin && eng.personas.some((p) => p.id === personaId);
    });
    const ocupacion = proyectos.reduce((sum, eng) => {
      const p = eng.personas.find((p) => p.id === personaId);
      return sum + (p?.pct ?? 0);
    }, 0);
    return { ocupacion, proyectos };
  })() : null;

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
                {iniciales(persona.nombre, persona.apellido, persona.iniciales)}
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
              {(persona.is_leverager || (persona.referente && isAdmin) || diasEnEmpresa(persona.fecha_ingreso)) && (
                <div className="flex items-center gap-2 pb-1.5 border-b border-gray-100 flex-wrap">
                  {persona.is_leverager && !ocultarApalancador && (
                    <div className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#3b5bdb] flex-shrink-0" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[#3b5bdb]">Apalancador</span>
                    </div>
                  )}
                  {persona.referente && isAdmin && (
                    <div className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#b45309] flex-shrink-0" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[#b45309]">Referente</span>
                    </div>
                  )}
                  {diasEnEmpresa(persona.fecha_ingreso) && (
                    <span className="text-[10px] text-gray-400">
                      ⌛ {diasEnEmpresa(persona.fecha_ingreso)} en la empresa
                    </span>
                  )}
                </div>
              )}
              {!ocultarCarga && (
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-xs">Disponibilidad</span>
                {(() => {
                  const oc = simData ? simData.ocupacion : resumen.ocupacion;
                  return (
                    <span className="font-semibold px-2 py-0.5 rounded-full text-xs"
                      style={
                        oc >= 100 ? { background: "#fef2f2", color: "#dc2626" }
                        : oc >= 80 ? { background: "#fefce8", color: "#ca8a04" }
                        : { background: "#f0fdf4", color: "#16a34a" }
                      }>
                      {Math.max(0, 100 - oc)}% libre
                    </span>
                  );
                })()}
              </div>
              )}
              {!ocultarInfoRestringida && (simData ? simData.proyectos.length : resumen.totalProyectos) > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-xs">Nº proyectos</span>
                  <span className="font-medium text-[#1a1a2e] text-xs">
                    {simData ? simData.proyectos.length : resumen.totalProyectos}
                  </span>
                </div>
              )}
              <div>
                <p className="text-gray-400 text-xs mb-1.5">Proyectos actuales</p>
                {simData ? (
                  simData.proyectos.length === 0 ? (
                    <p className="text-[11px] text-gray-300 italic">Sin proyectos activos en este escenario</p>
                  ) : (
                    <div className="space-y-1.5">
                      {simData.proyectos.map((eng) => {
                        const { dias, esFuturo, diasRestantes } = calcDiasCard(eng.fecha_inicio, eng.fecha_fin);
                        return (
                          <div key={eng.id} className="px-2 py-1 rounded-lg bg-amber-50 border border-amber-100">
                            <div className="flex items-baseline justify-between gap-2">
                              <div className="min-w-0 flex items-baseline gap-1.5">
                                <span className="text-[11px] font-semibold text-slate-800 truncate">{eng.nombre}</span>
                                {eng.cliente && <span className="text-[9px] text-gray-400 truncate">{eng.cliente}</span>}
                              </div>
                              <span className="text-[9px] text-slate-400 flex-shrink-0">
                                {esFuturo ? "Inicia:" : "Inicio:"} {format(new Date(eng.fecha_inicio + "T00:00:00"), "d MMM yyyy", { locale: es })}
                              </span>
                            </div>
                            {!ocultarDiasProyecto && <div className="flex justify-end gap-2 mt-0.5">
                              {esFuturo ? (
                                <span className="text-[9px] font-semibold" style={{ color: "#15803d" }}>Inicia en {dias}d</span>
                              ) : (
                                <>
                                  <span className="text-[9px] font-semibold" style={{ color: "#1d4ed8" }}>{dias}d en el proyecto</span>
                                  {diasRestantes !== null && (
                                    <><span className="text-[9px] text-gray-300">·</span><span className="text-[9px] font-semibold" style={{ color: "#92400e" }}>{diasRestantes}d restantes</span></>
                                  )}
                                </>
                              )}
                            </div>}
                          </div>
                        );
                      })}
                    </div>
                  )
                ) : (
                  <ProyectosPersonaDetalle personaId={persona.id} compact ocultarCarga={ocultarDiasProyecto} />
                )}
              </div>
              {/* ── Historial de proyectos ── */}
              {resumen.historialProyectos.length > 0 && (
                <div className="border-t border-gray-100 pt-2.5">
                  <p className="text-gray-400 text-xs mb-1.5">Historial de proyectos</p>
                  <div className="space-y-1.5">
                    {resumen.historialProyectos.slice(0, 3).map((h) => (
                      <div key={h.engagement_id} className="px-2 py-1 rounded-lg bg-amber-50 border border-amber-100">
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="min-w-0 flex items-baseline gap-1.5">
                            <span className="text-[11px] font-semibold text-slate-800 truncate">{h.codigo ? `${h.codigo} · ` : ""}{h.nombre}</span>
                            {h.industria && <span className="text-[9px] text-gray-400 truncate">{h.industria}</span>}
                          </div>
                          <span className="text-[9px] text-slate-400 flex-shrink-0">Inicio: {h.fechaInicioLabel}</span>
                        </div>
                        {!ocultarDiasProyecto && <div className="flex justify-end gap-2 mt-0.5">
                          <span className="text-[9px] font-semibold" style={{ color: "#1d4ed8" }}>{h.dias}d en el proyecto</span>
                          {h.activo && <><span className="text-[9px] text-gray-300">·</span><span className="text-[9px] font-semibold" style={{ color: "#15803d" }}>Activo</span></>}
                        </div>}
                      </div>
                    ))}
                    {resumen.historialProyectos.length > 3 && (
                      <p className="text-[10px] text-slate-400 italic pt-0.5">
                        +{resumen.historialProyectos.length - 3} proyectos más · ver perfil completo
                      </p>
                    )}
                  </div>
                </div>
              )}

              {!ocultarInfoRestringida && resumen.industrias.length > 0 && (
                <div>
                  <p className="text-gray-400 mb-1 text-xs">Industrias</p>
                  <div className="flex flex-wrap gap-1">
                    {resumen.industrias.map((i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#eaf4ff] text-[#1a5276]">{i}</span>
                    ))}
                  </div>
                </div>
              )}
              {!ocultarInfoRestringida && resumen.capacidades.length > 0 && (
                <div>
                  <p className="text-gray-400 mb-1 text-xs">Capacidades</p>
                  <div className="flex flex-wrap gap-1">
                    {resumen.capacidades.map((c) => (
                      <span key={c} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#f0f9f4] text-[#1e7e45]">{c}</span>
                    ))}
                  </div>
                </div>
              )}
              {!ocultarInfoRestringida && resumen.tematicas.length > 0 && (
                <div>
                  <p className="text-gray-400 mb-1 text-xs">Temáticas</p>
                  <div className="flex flex-wrap gap-1">
                    {resumen.tematicas.map((t) => (
                      <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#fdf4ff] text-[#6b21a8]">{t}</span>
                    ))}
                  </div>
                </div>
              )}
              {!ocultarInfoRestringida && (
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
              )}
              {!ocultarMatriz && (persona.talento_potencial != null || persona.talento_desempeno != null) && (
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => setShowMatriz((s) => !s)}
                    className="w-full flex justify-between items-center hover:bg-gray-50 rounded px-0.5 py-0.5 transition-colors"
                  >
                    <span className="text-gray-400 text-xs">
                      Talento{getTalentBoxName(persona.talento_potencial, persona.talento_desempeno) && (
                        <span className="text-[#1a1a2e] font-semibold ml-1">
                          : {getTalentBoxName(persona.talento_potencial, persona.talento_desempeno)}
                        </span>
                      )}
                    </span>
                    <ChevronDown
                      className="w-3 h-3 text-gray-300"
                      style={{ transform: showMatriz ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}
                    />
                  </button>
                  {showMatriz && (
                    <TalentMatrix
                      potencial={persona.talento_potencial}
                      desempeno={persona.talento_desempeno}
                      isEditable={false}
                      size="full"
                    />
                  )}
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
