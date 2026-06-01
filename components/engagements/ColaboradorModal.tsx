"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { X, Plus, Trash2, Loader2, AlertCircle, ChevronDown } from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";
import { getDetailedPersonAbsences } from "@/lib/queries/ausencias";
import { ProyectosPersonaDetalle } from "@/components/personas/ProyectosPersonaDetalle";
import { TalentMatrix, getTalentBoxName } from "@/components/personas/TalentMatrix";
import type { Persona } from "@/lib/types/database";

// ── Helpers ───────────────────────────────────────────────────────
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
  const d = Math.floor((Date.now() - new Date(f + "T00:00:00").getTime()) / 86_400_000);
  if (d < 0) return null;
  return d < 365 ? `${d} días` : `${Math.floor(d / 365)} ${Math.floor(d / 365) === 1 ? "año" : "años"} y ${d % 365} días`;
}

// ── Tipos internos ────────────────────────────────────────────────
interface Rango {
  tempId: string;
  asignacionId: string | null;
  inicio: string;
  fin: string;
}
interface ResumenData {
  ocupacion: number; totalProyectos: number; industrias: string[];
  capacidades: string[]; tematicas: string[];
  totalDiasAnioActual: number; ausenciasFuturas: any[];
  mentorNombre: string | null; mentoreados: string[];
}

// ── Props ─────────────────────────────────────────────────────────
interface Props {
  personaId: string;
  personaNombre: string;       // "Nombre Apellido"
  engagementId: string;
  engagementNombre: string;
  engInicio: string;
  engFin: string;
  requerimientoId: string | null;
  cargo: string | null;
  pct: number;
  estadoStaffing: "CONFIRMADO" | "PLAN";
  defaultTab?: "asignacion" | "perfil";
  onClose: () => void;
  onGuardado: () => void;
}

export function ColaboradorModal({
  personaId, personaNombre, engagementId, engagementNombre,
  engInicio, engFin, requerimientoId, cargo, pct, estadoStaffing,
  defaultTab = "asignacion",
  onClose, onGuardado,
}: Props) {
  const [tab, setTab] = useState<"asignacion" | "perfil">(defaultTab);

  // ── Estado Tab 1 — Asignación ─────────────────────────────────
  const [rangos,     setRangos]     = useState<Rango[]>([]);
  const [asigLoad,   setAsigLoad]   = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  // ── Estado Tab 2 — Perfil ─────────────────────────────────────
  const [persona,       setPersona]       = useState<Persona | null>(null);
  const [resumen,       setResumen]       = useState<ResumenData | null>(null);
  const [perfilLoad,    setPerfilLoad]    = useState(false);
  const [perfilCargado, setPerfilCargado] = useState(false);
  const [showAusencias, setShowAusencias] = useState(false);

  // ── Carga Tab 1 al montar ─────────────────────────────────────
  useEffect(() => {
    const sb = createAnyClient();
    const q = sb
      .from("asignacion")
      .select("id, fecha_inicio, fecha_fin")
      .eq("persona_id", personaId)
      .eq("engagement_id", engagementId)
      .order("fecha_inicio");
    (requerimientoId ? (q as any).eq("requerimiento_id", requerimientoId) : q)
      .then(({ data }: { data: any[] | null }) => {
        setRangos(
          data?.length
            ? data.map((a) => ({ tempId: a.id, asignacionId: a.id, inicio: a.fecha_inicio, fin: a.fecha_fin }))
            : [{ tempId: "new-0", asignacionId: null, inicio: engInicio, fin: engFin }]
        );
        setAsigLoad(false);
      });
  }, [personaId, engagementId, requerimientoId, engInicio, engFin]);

  // ── Carga Tab 2 — lazy al primer switch ───────────────────────
  useEffect(() => {
    if (tab !== "perfil" || perfilCargado) return;
    setPerfilLoad(true);
    let cancelled = false;
    async function load() {
      const sb = createAnyClient();
      const [{ data: per }, asigRes, histRes, indRes, capRes, temRes, mentoreRes, ausDetalle] =
        await Promise.all([
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
        ausenciasFuturas:    ausDetalle.ausenciasFuturas,
        mentorNombre: mentorRes.data
          ? `${(mentorRes.data as any).nombre} ${(mentorRes.data as any).apellido}` : null,
        mentoreados: ((mentoreRes.data ?? []) as any[]).map((m: any) => `${m.nombre} ${m.apellido}`),
      });
      setPerfilLoad(false);
      setPerfilCargado(true);
    }
    load();
    return () => { cancelled = true; };
  }, [tab, personaId, perfilCargado]);

  // ── Helpers Tab 1 ─────────────────────────────────────────────
  function addRango() {
    setRangos(prev => [...prev, { tempId: `new-${Date.now()}`, asignacionId: null, inicio: engInicio, fin: engFin }]);
  }
  function removeRango(tempId: string) {
    if (rangos.length === 1) return;
    setRangos(prev => prev.filter(r => r.tempId !== tempId));
  }
  function updateRango(tempId: string, field: "inicio" | "fin", value: string) {
    setRangos(prev => prev.map(r => r.tempId === tempId ? { ...r, [field]: value } : r));
  }
  function validate(): string | null {
    for (const r of rangos) {
      if (!r.inicio || !r.fin) return "Completa todas las fechas antes de guardar.";
      if (r.inicio > r.fin)     return `Inicio (${r.inicio}) posterior al fin (${r.fin}).`;
      if (r.inicio < engInicio) return `Fecha ${r.inicio} anterior al inicio del proyecto (${engInicio}).`;
      if (r.fin   > engFin)     return `Fecha ${r.fin} posterior al fin del proyecto (${engFin}).`;
    }
    const sorted = [...rangos].sort((a, b) => a.inicio.localeCompare(b.inicio));
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].inicio <= sorted[i - 1].fin)
        return `Períodos solapados: ${sorted[i-1].inicio}–${sorted[i-1].fin} con ${sorted[i].inicio}–${sorted[i].fin}.`;
    }
    return null;
  }
  async function handleGuardar() {
    const err = validate();
    if (err) { setError(err); return; }

    // Validación estricta: fetch fresco de ausencias — sin depender de estado
    const sbCheck = createAnyClient();
    const { data: ausRaw } = await (sbCheck as any)
      .from("ausencia")
      .select("fecha_inicio, fecha_fin")
      .eq("persona_id", personaId);
    const engIni = new Date(engInicio);
    const engFin_ = new Date(engFin);
    const cubreTodo = (ausRaw ?? []).some((a: any) => {
      const ausIni = new Date(a.fecha_inicio);
      const ausFin = new Date(a.fecha_fin);
      return ausIni <= engIni && ausFin >= engFin_;
    });
    if (cubreTodo) {
      setError("La persona seleccionada tiene ausencias durante toda la duración del engagement. No puede ser staffeada.");
      return; // bloqueo total — ninguna escritura en Supabase ocurre
    }

    setError(null); setSaving(true);
    const sb = createAnyClient();
    const delQ = (sb as any).from("asignacion").delete()
      .eq("persona_id", personaId).eq("engagement_id", engagementId);
    await (requerimientoId ? delQ.eq("requerimiento_id", requerimientoId) : delQ);
    await (sb as any).from("asignacion").insert(
      rangos.map(r => ({
        engagement_id:    engagementId,
        requerimiento_id: requerimientoId,
        persona_id:       personaId,
        cargo_al_momento: cargo,
        pct_dedicacion:   pct,
        estado:           "activa",
        estado_staffing:  estadoStaffing,
        fecha_inicio:     r.inicio,
        fecha_fin:        r.fin,
      }))
    );
    setSaving(false);
    onGuardado();
  }

  // Colores de header basados en cargo
  const cargoColor = COLORES[cargo ?? ""] ?? COLOR_DEFAULT;
  const [pNombre, ...rest] = personaNombre.split(" ");
  const pApellido = rest.join(" ");

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />

      {/* Modal */}
      <div
        className="fixed z-50 bg-white rounded-xl shadow-2xl border border-gray-100 flex flex-col"
        style={{ top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: 440, maxHeight: "88vh" }}
      >
        {/* ── Header + Tabs ─────────────────────────────────── */}
        <div className="px-5 pt-4 pb-0 flex-shrink-0 border-b border-gray-100">
          {/* Fila: avatar + nombre + cerrar */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                style={{ backgroundColor: cargoColor }}
              >
                {iniciales(pNombre, pApellido || pNombre)}
              </div>
              <div>
                <p className="font-bold text-[13px] text-[#1a1a2e] leading-tight">{personaNombre}</p>
                <p className="text-[10px] text-gray-400 truncate max-w-[280px]">{engagementNombre}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0 ml-2"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Pestañas */}
          <div className="flex">
            {(["asignacion", "perfil"] as const).map((key) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-4 py-2 text-[12px] font-semibold border-b-2 transition-colors whitespace-nowrap ${
                  tab === key
                    ? "border-[#4a90e2] text-[#4a90e2]"
                    : "border-transparent text-gray-400 hover:text-gray-600"
                }`}
              >
                {key === "asignacion" ? "Asignación actual" : "Perfil y disponibilidad"}
              </button>
            ))}
          </div>
        </div>

        {/* ── Body con scroll ───────────────────────────────── */}
        <div className="flex-1 min-h-0 overflow-y-auto">

          {/* TAB 1 — Asignación */}
          {tab === "asignacion" && (
            <div className="px-5 py-4 space-y-2">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
                Períodos de asignación
              </p>
              {asigLoad ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-gray-300" />
                </div>
              ) : (
                <>
                  {rangos.map((rng, idx) => (
                    <div key={rng.tempId} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2.5">
                      <span className="text-[10px] text-gray-300 font-bold w-4 flex-shrink-0 text-center">
                        {idx + 1}
                      </span>
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <input
                          type="date" value={rng.inicio} min={engInicio} max={engFin}
                          onChange={(e) => updateRango(rng.tempId, "inicio", e.target.value)}
                          className="flex-1 min-w-0 px-2 py-1.5 text-[12px] border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#4a90e2]/40 focus:border-[#4a90e2] bg-white transition-colors"
                        />
                        <span className="text-gray-300 text-[11px] flex-shrink-0">→</span>
                        <input
                          type="date" value={rng.fin} min={rng.inicio || engInicio} max={engFin}
                          onChange={(e) => updateRango(rng.tempId, "fin", e.target.value)}
                          className="flex-1 min-w-0 px-2 py-1.5 text-[12px] border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#4a90e2]/40 focus:border-[#4a90e2] bg-white transition-colors"
                        />
                      </div>
                      <button
                        onClick={() => removeRango(rng.tempId)} disabled={rangos.length === 1}
                        className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-400 disabled:opacity-20 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={addRango}
                    className="flex items-center gap-1.5 text-[12px] text-[#4a90e2] hover:text-[#357abd] px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors w-full font-medium"
                  >
                    <Plus className="w-3.5 h-3.5" /> Agregar período
                  </button>
                  {error && (
                    <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-1">
                      <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                      <p className="text-[11px] text-red-600 leading-snug">{error}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* TAB 2 — Perfil */}
          {tab === "perfil" && (
            <div className="px-5 py-4">
              {perfilLoad ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-gray-300" />
                </div>
              ) : persona && resumen ? (
                <div className="space-y-2.5 text-sm">
                  {/* Avatar grande + datos básicos */}
                  <div className="flex items-center gap-3 pb-3 border-b border-gray-100">
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center text-white text-lg font-bold flex-shrink-0"
                      style={{ backgroundColor: COLORES[persona.cargo_actual ?? ""] ?? COLOR_DEFAULT }}
                    >
                      {iniciales(persona.nombre, persona.apellido, persona.iniciales)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-[#1a1a2e] text-sm">{persona.nombre} {persona.apellido}</p>
                      <p className="text-[11px] text-gray-400">{persona.cargo_actual ?? "Sin cargo"}</p>
                      {diasEnEmpresa(persona.fecha_ingreso) && (
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          ⌛ {diasEnEmpresa(persona.fecha_ingreso)} en la empresa
                        </p>
                      )}
                    </div>
                    {persona.is_leverager && (
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[#3b5bdb] flex-shrink-0">
                        Apalancador
                      </span>
                    )}
                  </div>

                  {/* Disponibilidad */}
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400 text-xs">Disponibilidad</span>
                    <span
                      className="font-semibold px-2 py-0.5 rounded-full text-xs"
                      style={
                        resumen.ocupacion >= 100 ? { background: "#fef2f2", color: "#dc2626" }
                          : resumen.ocupacion >= 80 ? { background: "#fefce8", color: "#ca8a04" }
                          : { background: "#f0fdf4", color: "#16a34a" }
                      }
                    >
                      {Math.max(0, 100 - resumen.ocupacion)}% libre
                    </span>
                  </div>

                  {/* Nº proyectos */}
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400 text-xs">Nº proyectos</span>
                    <span className="font-medium text-[#1a1a2e] text-xs">{resumen.totalProyectos}</span>
                  </div>

                  {/* Proyectos actuales */}
                  <div>
                    <p className="text-gray-400 text-xs mb-1.5">Proyectos actuales</p>
                    <ProyectosPersonaDetalle personaId={persona.id} compact />
                  </div>

                  {/* Tags industrias / capacidades / temáticas */}
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

                  {/* Ausencias */}
                  <div>
                    <button
                      onClick={() => setShowAusencias((s) => !s)}
                      className="w-full flex justify-between items-center hover:bg-gray-50 rounded px-0.5 py-0.5 transition-colors"
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
                            {resumen.ausenciasFuturas.map((a: any, i: number) => (
                              <div key={i} className="flex justify-between items-start gap-1">
                                <span className="text-[10px] text-gray-500 leading-tight truncate max-w-[160px]">{a.tipoLabel}</span>
                                <div className="text-right flex-shrink-0">
                                  <p className="text-[10px] text-gray-400">
                                    {format(new Date(a.fechaInicio + "T00:00:00"), "d MMM", { locale: es })}
                                  </p>
                                  <p className="text-[10px] font-semibold text-[#1a1a2e]">{a.numDias}d</p>
                                </div>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Talent Matrix */}
                  {(persona.talento_potencial != null || persona.talento_desempeno != null) && (
                    <div className="flex flex-col gap-2">
                      <span className="text-gray-400 text-xs">
                        Talento
                        {getTalentBoxName(persona.talento_potencial, persona.talento_desempeno) && (
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

                  {/* Mentor */}
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
              ) : null}
            </div>
          )}
        </div>

        {/* ── Footer — solo visible en Tab 1 ───────────────── */}
        {tab === "asignacion" && (
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-100 flex-shrink-0">
            <p className="text-[10px] text-gray-300">Límite: {engInicio} → {engFin}</p>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-3.5 py-1.5 text-[12px] text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleGuardar} disabled={saving || asigLoad}
                className="flex items-center gap-1.5 px-4 py-1.5 text-[12px] bg-[#4a90e2] text-white rounded-lg hover:bg-[#357abd] disabled:opacity-50 transition-colors font-semibold"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Guardar
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
