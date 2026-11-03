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
import { armarTramos, cruzaPausa, finPermitido, inicioPermitido, pausasEntre, tramoDePeriodo, type ExtensionBasica, type Tramo } from "./tramosEngagement";

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

// ── Tipos internos ────────────────────────────────────────────────
interface Rango {
  tempId: string;
  asignacionId: string | null;
  inicio: string;
  fin: string;
  /** Valores propios del tramo ya guardado (se conservan al reemplazar) */
  pct?: number;
  estadoStaffing?: string;
  cargo?: string | null;
  estado?: string;
  /** Alargue al que pertenece (se conserva al guardar para poder liberarlo si se borra el alargue) */
  extensionId?: string | null;
  /** Requerimiento (cupo) del período: cada alargue tiene su propia copia del cupo */
  requerimientoId?: string | null;
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
  /** Simulación: skip Supabase, notifica los rangos al padre para actualizar engs local */
  simulationMode?: boolean;
  onSimGuardado?: (rangos: { inicio: string; fin: string }[]) => void;
}

export function ColaboradorModal({
  personaId, personaNombre, engagementId, engagementNombre,
  engInicio, engFin, requerimientoId, cargo, pct, estadoStaffing,
  defaultTab = "asignacion", simulationMode = false, onSimGuardado,
  onClose, onGuardado,
}: Props) {
  const [tab, setTab] = useState<"asignacion" | "perfil">(defaultTab);

  // ── Estado Tab 1 — Asignación ─────────────────────────────────
  const [rangos,     setRangos]     = useState<Rango[]>([]);
  const [asigLoad,   setAsigLoad]   = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  // Tramos del proyecto (Contrato + Extensión N); vacío = sin alargues → vista simple de siempre
  const [tramos,     setTramos]     = useState<Tramo[]>([]);
  // Asignaciones cargadas al abrir: son las que se reemplazan al guardar
  const [idsOriginales, setIdsOriginales] = useState<string[]>([]);

  // ── Estado Tab 2 — Perfil ─────────────────────────────────────
  const [persona,       setPersona]       = useState<Persona | null>(null);
  const [resumen,       setResumen]       = useState<ResumenData | null>(null);
  const [perfilLoad,    setPerfilLoad]    = useState(false);
  const [perfilCargado, setPerfilCargado] = useState(false);
  const [showAusencias, setShowAusencias] = useState(false);
  const [showMatriz, setShowMatriz] = useState(false);

  // ── Carga Tab 1 al montar ─────────────────────────────────────
  useEffect(() => {
    const sb = createAnyClient();
    const q = sb
      .from("asignacion")
      .select("id, fecha_inicio, fecha_fin, pct_dedicacion, estado_staffing, cargo_al_momento, estado, extension_id, requerimiento_id")
      .eq("persona_id", personaId)
      .eq("engagement_id", engagementId)
      .order("fecha_inicio");
    Promise.all([
      q,
      (sb as any).from("engagement_extension").select("id, fecha_inicio, fecha_fin").eq("engagement_id", engagementId),
    ]).then(([{ data: todas }, { data: exts }]: [{ data: any[] | null }, { data: ExtensionBasica[] | null }]) => {
        setTramos(exts?.length ? armarTramos(engInicio, engFin, exts) : []);
        // Sin alargues: solo los períodos de este requerimiento (o los directos sin requerimiento).
        // Con alargues: todos los de la persona en el proyecto, porque cada alargue tiene su propio
        // requerimiento (copia del cupo) y si no, se veía solo el contrato o solo el alargue.
        const data = exts?.length
          ? (todas ?? [])
          : (todas ?? []).filter((a) => (requerimientoId ? a.requerimiento_id === requerimientoId : !a.requerimiento_id));
        setIdsOriginales(data.map((a) => a.id));
        setRangos(
          data.length
            ? data.map((a) => ({
                tempId: a.id, asignacionId: a.id, inicio: a.fecha_inicio, fin: a.fecha_fin,
                pct: Number(a.pct_dedicacion), estadoStaffing: a.estado_staffing, cargo: a.cargo_al_momento, estado: a.estado,
                extensionId: a.extension_id ?? null, requerimientoId: a.requerimiento_id ?? null,
              }))
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
          // Ocupación: solo asignaciones vigentes hoy (antes sumaba también las ya terminadas)
          sb.from("asignacion").select("pct_dedicacion").eq("persona_id", personaId).eq("estado", "activa")
            .lte("fecha_inicio", new Date().toISOString().slice(0, 10))
            .or(`fecha_fin.is.null,fecha_fin.gte.${new Date().toISOString().slice(0, 10)}`),
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
  // Sin tramo: período en todo el contrato; con tramo: limitado a ese tramo y vinculado a su alargue
  function addRango(tramo?: Tramo) {
    setRangos(prev => [...prev, {
      tempId: `new-${Date.now()}`, asignacionId: null,
      inicio: tramo?.inicio ?? engInicio, fin: tramo?.fin ?? engFin, extensionId: tramo?.extensionId ?? null,
    }]);
  }
  /** Corta un período que cruza una pausa en un período por cada tramo que toca. */
  function dividirRango(rng: Rango) {
    const partes = tramos
      .filter((t) => rng.inicio <= t.fin && rng.fin >= t.inicio)
      .map((t, i) => ({
        ...rng, tempId: `${rng.tempId}-p${i}`, asignacionId: i === 0 ? rng.asignacionId : null,
        inicio: rng.inicio > t.inicio ? rng.inicio : t.inicio,
        fin: rng.fin < t.fin ? rng.fin : t.fin,
        extensionId: t.extensionId,
      }));
    setRangos(prev => prev.flatMap((r) => (r.tempId === rng.tempId ? partes : [r])));
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
      // Partir antes del inicio del contrato está permitido (trabajo anticipado)
      if (r.fin   > finLimite)  return `Fecha ${r.fin} posterior al fin del proyecto (${finLimite}).`;
      // Partir en una pausa está permitido (trabajo anticipado antes de que arranque el tramo)
    }
    const sorted = [...rangos].sort((a, b) => a.inicio.localeCompare(b.inicio));
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].inicio <= sorted[i - 1].fin)
        return `Períodos solapados: ${sorted[i-1].inicio}–${sorted[i-1].fin} con ${sorted[i].inicio}–${sorted[i].fin}.`;
    }
    return null;
  }
  async function handleGuardar() {
    if (saving) return; // doble clic: el segundo guardado borraba lo que creó el primero
    const err = validate();
    if (err) { setError(err); return; }
    // Se bloquea desde el inicio (antes recién después de consultar ausencias)
    setSaving(true);

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
      setSaving(false);
      return; // bloqueo total — ninguna escritura en Supabase ocurre
    }

    setError(null);

    // ── SIMULACIÓN: actualiza solo el estado local del plan, sin tocar Supabase ──
    if (simulationMode) {
      onSimGuardado?.(rangos);
      setSaving(false);
      onGuardado();
      return;
    }
    // ─────────────────────────────────────────────────────────────────────────────

    const sb = createAnyClient();
    // Requerimiento de cada período: los existentes conservan el suyo; uno nuevo usa el de otro
    // período del mismo tramo (el cupo del contrato o la copia del alargue), si no el del cupo abierto
    const reqDe = (r: Rango) => {
      if (r.asignacionId) return r.requerimientoId ?? null;
      if (tramos.length === 0) return requerimientoId;
      const t = tramoDePeriodo(tramos, { fecha_inicio: r.inicio, fecha_fin: r.fin });
      const vecino = rangos.find((o) => o !== r && o.requerimientoId && tramoDePeriodo(tramos, { fecha_inicio: o.inicio, fecha_fin: o.fin })?.key === t?.key);
      return vecino?.requerimientoId ?? requerimientoId;
    };
    // 1) Insertar primero: si falla, las asignaciones previas quedan intactas
    const { error: insErr } = await (sb as any).from("asignacion").insert(
      rangos.map(r => ({
        engagement_id:    engagementId,
        requerimiento_id: reqDe(r),
        persona_id:       personaId,
        // Tramos existentes conservan su %, estado y cargo; los nuevos usan los del cupo
        cargo_al_momento: r.asignacionId ? (r.cargo ?? cargo) : cargo,
        pct_dedicacion:   r.pct ?? pct,
        estado:           r.estado ?? "activa",
        estado_staffing:  r.estadoStaffing ?? estadoStaffing,
        fecha_inicio:     r.inicio,
        fecha_fin:        r.fin,
        // Vínculo al alargue según las fechas del período (antes se perdía al guardar, o quedaba
        // el antiguo aunque el período se hubiera movido al contrato)
        extension_id:     tramos.length > 0
          ? (tramoDePeriodo(tramos, { fecha_inicio: r.inicio, fecha_fin: r.fin })?.extensionId ?? null)
          : (r.extensionId ?? null),
      }))
    );
    if (insErr) {
      setError(`No se pudo guardar la asignación: ${insErr.message}`);
      setSaving(false);
      return;
    }

    // 2) Recién ahora reemplazar: borrar exactamente las que se cargaron al abrir (las nuevas ya las reemplazan)
    const { error: delErr } = idsOriginales.length > 0
      ? await (sb as any).from("asignacion").delete().in("id", idsOriginales)
      : { error: null };
    if (delErr) {
      setError(`Asignación guardada, pero no se pudieron limpiar los períodos anteriores: ${delErr.message}`);
      setSaving(false);
      return;
    }

    setSaving(false);
    onGuardado();
  }

  // Fin permitido: el del último tramo (contrato o alargue)
  const finLimite = tramos.reduce((max, t) => (t.fin > max ? t.fin : max), engFin);

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
                  {(() => {
                    // Fila de un período; con tramo, las fechas quedan limitadas a ese tramo
                    const filaRango = (rng: Rango, idx: number, tramo?: Tramo) => {
                      const cruza = tramos.length > 0 && cruzaPausa(tramos, { fecha_inicio: rng.inicio, fecha_fin: rng.fin });
                      // Puede partir en la pausa previa al tramo (trabajo anticipado)
                      // (el contrato no tiene mínimo: se puede partir antes de su inicio)
                      const minIni = tramo && tramo.key !== "base" ? inicioPermitido(tramos, tramo, engInicio) : undefined;
                      const anticipado = !!tramo && !!rng.inicio && rng.inicio < tramo.inicio;
                      // Termina en la pausa siguiente (trabajo de cierre después del tramo)
                      const cierre = !!tramo && !!rng.fin && rng.fin > tramo.fin;
                      const maxFin = tramo ? finPermitido(tramos, tramo) : finLimite;
                      return (
                        <div key={rng.tempId} className={`bg-gray-50 rounded-lg px-3 py-2.5 ${cruza ? "ring-1 ring-amber-300" : ""}`}>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-300 font-bold w-4 flex-shrink-0 text-center">
                              {idx + 1}
                            </span>
                            <div className="flex items-center gap-1.5 flex-1 min-w-0">
                              <input
                                type="date" value={rng.inicio} min={minIni} max={maxFin}
                                onChange={(e) => updateRango(rng.tempId, "inicio", e.target.value)}
                                className="flex-1 min-w-0 px-2 py-1.5 text-[12px] border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#4a90e2]/40 focus:border-[#4a90e2] bg-white transition-colors"
                              />
                              <span className="text-gray-300 text-[11px] flex-shrink-0">→</span>
                              <input
                                type="date" value={rng.fin} min={rng.inicio || minIni} max={maxFin}
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
                          {anticipado && (
                            <p className="text-[10px] text-gray-400 mt-1.5 pl-6">Parte antes del inicio de este tramo (trabajo anticipado).</p>
                          )}
                          {cierre && !cruza && (
                            <p className="text-[10px] text-gray-400 mt-1.5 pl-6">Termina después del cierre de este tramo (trabajo de cierre).</p>
                          )}
                          {cruza && (
                            <div className="flex items-center justify-between gap-2 mt-1.5 pl-6">
                              <p className="text-[10px] text-amber-700">Este período sigue durante toda la pausa del proyecto. Si no trabaja en ella, divídelo.</p>
                              <button onClick={() => dividirRango(rng)} className="text-[10px] font-semibold text-[#4a90e2] hover:underline flex-shrink-0">
                                Dividir
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    };
                    const botonAgregar = (tramo?: Tramo) => (
                      <button
                        onClick={() => addRango(tramo)}
                        className="flex items-center gap-1.5 text-[12px] text-[#4a90e2] hover:text-[#357abd] px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors w-full font-medium"
                      >
                        <Plus className="w-3.5 h-3.5" /> Agregar período
                      </button>
                    );

                    // Sin alargues: lista simple de siempre
                    if (tramos.length === 0) return <>{rangos.map((r, i) => filaRango(r, i))}{botonAgregar()}</>;

                    // Con alargues: un bloque por tramo (Contrato, Extensión 1...), pausas en gris
                    const fmtT = (d: string) => format(new Date(d + "T00:00:00"), "d MMM yyyy", { locale: es });
                    const pausas = pausasEntre(tramos);
                    const ordenados = [...rangos].sort((a, b) => a.inicio.localeCompare(b.inicio));
                    const idxDe = (r: Rango) => ordenados.indexOf(r);
                    // Los que cruzan una pausa se muestran en el tramo donde empiezan
                    const sinTramo = ordenados.filter((r) => !tramoDePeriodo(tramos, { fecha_inicio: r.inicio, fecha_fin: r.fin }));
                    return (
                      <div className="space-y-3">
                        {tramos.map((t) => {
                          const pausa = pausas.find((p) => p.despuesDe === t.key);
                          const delTramo = ordenados.filter((r) => tramoDePeriodo(tramos, { fecha_inicio: r.inicio, fecha_fin: r.fin })?.key === t.key);
                          return (
                            <div key={t.key} className="space-y-1.5">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-[#4a90e2]">
                                {t.titulo} <span className="font-normal normal-case tracking-normal text-gray-400">· {fmtT(t.inicio)} → {fmtT(t.fin)}</span>
                              </p>
                              {delTramo.map((r) => filaRango(r, idxDe(r), t))}
                              {botonAgregar(t)}
                              {pausa && (
                                <div className="flex items-center gap-2 pt-1">
                                  <div className="flex-1 border-t border-dashed border-gray-200" />
                                  <span className="text-[10px] text-gray-400">Pausa: {fmtT(pausa.inicio)} → {fmtT(pausa.fin)} (sin asignaciones)</span>
                                  <div className="flex-1 border-t border-dashed border-gray-200" />
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {sinTramo.length > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600">Fuera de los tramos del proyecto</p>
                            {sinTramo.map((r) => filaRango(r, idxDe(r)))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
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

                  {/* Tags industrias / temáticas */}
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
                      <button
                        onClick={() => setShowMatriz((s) => !s)}
                        className="w-full flex justify-between items-center hover:bg-gray-50 rounded px-0.5 py-0.5 transition-colors"
                      >
                        <span className="text-gray-400 text-xs">
                          Talento
                          {getTalentBoxName(persona.talento_potencial, persona.talento_desempeno) && (
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
            <p className="text-[10px] text-gray-300">Proyecto: {engInicio} → {finLimite}</p>
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
