"use client";

/**
 * SandboxInicioView — Réplica exacta del layout de Inicio para simulación.
 * readOnly={true} en DesgloceEngagements → ninguna mutación llega a Supabase.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  startOfISOWeek, addWeeks, subWeeks, addMonths, subMonths,
  format, isSameDay, parseISO, addDays,
} from "date-fns";
import { es } from "date-fns/locale";
import {
  ChevronLeft, ChevronRight, ChevronUp, ChevronDown, FlaskConical,
} from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";
import { CARGOS_OCULTOS_GYD } from "@/lib/constants";
import { GanttAusencias } from "@/components/inicio/GanttAusencias";
import { PerfilIndividualTablero } from "@/components/inicio/PerfilIndividualTablero";
import { DesgloceEngagements, type PanelInfo, type SimAsigPayload } from "@/components/inicio/DesgloceEngagements";
import { DisponiblesTablero, type AsigDetalle } from "@/components/inicio/DisponiblesTablero";
import { PanelFitAsignacion } from "@/components/engagements/PanelFitAsignacion";
import { PersonaResumenModal } from "@/components/personas/PersonaResumenModal";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import type { Persona } from "@/lib/types/database";

// ── Tipos ausencia ────────────────────────────────────────────
interface AusenciaPeriodo { fecha_inicio: string; fecha_fin: string; tipo: string; }

/** Segmenta [inicio, fin] excluyendo los períodos de ausencia. */
function segmentarSinAusencias(
  inicio: string, fin: string,
  ausencias: AusenciaPeriodo[]
): { inicio: string; fin: string }[] {
  const ordenadas = [...ausencias]
    .filter((a) => a.fecha_inicio <= fin && a.fecha_fin >= inicio)
    .sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio));
  const segmentos: { inicio: string; fin: string }[] = [];
  let cursor = inicio;
  for (const aus of ordenadas) {
    if (cursor < aus.fecha_inicio) segmentos.push({ inicio: cursor, fin: addDias(aus.fecha_inicio, -1) });
    if (aus.fecha_fin >= cursor) cursor = addDias(aus.fecha_fin, 1);
  }
  if (cursor <= fin) segmentos.push({ inicio: cursor, fin });
  return segmentos.filter((s) => s.inicio <= s.fin);
}
function addDias(fecha: string, dias: number): string {
  const d = new Date(fecha + "T00:00:00");
  d.setDate(d.getDate() + dias);
  return d.toISOString().split("T")[0];
}

// ── Constantes (idénticas a inicio/page.tsx) ──────────────────

const JERARQUIA_CARGOS = [
  "Socio", "Director de Proyectos", "Director", "Gerente de Proyectos", "Gerente",
  "Asociado", "Consultor Senior", "Consultor de Proyectos", "Consultor Proyecto",
  "Consultor", "Consultor Analista", "Analista Senior", "Consultor Trainee", "Analista", "Practicante",
];

const COLORES: Record<string, string> = {
  "Socio": "#1a1a2e", "Director de Proyectos": "#4a90e2", "Director": "#4a90e2",
  "Gerente de Proyectos": "#7c5cbf", "Gerente": "#7c5cbf", "Asociado": "#e2884a",
  "Consultor Senior": "#4ab89a", "Consultor de Proyectos": "#e24a6a",
  "Consultor Analista": "#a0b84a", "Consultor Trainee": "#c07c4a",
};
const COLOR_DEFAULT = "#94a3b8";

function iniciales(nombre: string, apellido: string, custom?: string | null) {
  if (custom?.trim()) return custom.trim().toUpperCase().slice(0, 3);
  return `${nombre[0] ?? ""}${apellido[0] ?? ""}`.toUpperCase();
}

function ocupColor(pct: number) {
  if (pct >= 90) return { bg: "#fef2f2", text: "#dc2626" };
  if (pct >= 60) return { bg: "#fefce8", text: "#ca8a04" };
  return { bg: "#f0fdf4", text: "#16a34a" };
}

function ordenarCargos(cargos: string[]) {
  return [...cargos].sort((a, b) => {
    const ia = JERARQUIA_CARGOS.indexOf(a), ib = JERARQUIA_CARGOS.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1; if (ib === -1) return -1;
    return ia - ib;
  });
}

// ── Tipos snapshot ────────────────────────────────────────────

interface PersonaSnap {
  id: string; nombre: string; apellido: string; iniciales: string | null;
  cargo: string; pct: number; fecha_inicio: string; fecha_fin: string;
  requerimiento_id?: string | null;
}
interface ReqSnapLocal { id: string; cargo_requerido: string | null; pct_dedicacion: number; fecha_inicio: string; fecha_fin: string | null; fase_nombre: string | null; persona_nombre?: string; }
interface ActividadSnapLocal { id?: string; tipo: string; titulo: string; fecha_inicio: string; fecha_fin: string; }
interface EngSnap {
  id: string; codigo: string | null; nombre: string; cliente: string | null;
  tipo: string; fecha_inicio: string; fecha_fin: string; personas: PersonaSnap[];
  reqs?: ReqSnapLocal[];
  actividades?: ActividadSnapLocal[];
}

/** Convierte EngSnap[] → EngRow[] que acepta DesgloceEngagements como initialEngs */
function snapToEngRows(snapshot: EngSnap[]): any[] {
  // Deduplicar por id Y por huella lógica (nombre+tipo+cliente).
  // Snapshots de planes aprobados varias veces pueden tener sim_eng_* + UUID_A + UUID_B
  // del mismo engagement con IDs distintos. Primer hit gana (preserva orden de sort_order).
  const seenId    = new Set<string>();
  const seenLogic = new Set<string>();
  const unique = snapshot.filter((e) => {
    const huella = `${e.nombre}|${e.tipo}|${(e.cliente ?? "").trim().toLowerCase()}`;
    if (seenId.has(e.id) || seenLogic.has(huella)) return false;
    seenId.add(e.id);
    seenLogic.add(huella);
    return true;
  });
  // Ordenar por sort_order antes de convertir → DesgloceEngagements recibe el array ya ordenado
  const sorted = [...unique].sort((a, b) => {
    const sa = (a as any).sort_order ?? Infinity;
    const sb = (b as any).sort_order ?? Infinity;
    if (sa !== sb) return sa - sb;
    return (a.nombre ?? "").localeCompare(b.nombre ?? "", "es");
  });

  return sorted.map((e, i) => ({
    id: e.id,
    codigo: e.codigo,
    nombre: e.nombre,
    cliente: e.cliente,
    tipo: e.tipo,
    fecha_inicio: e.fecha_inicio,
    fecha_fin: e.fecha_fin,
    sort_order: (e as any).sort_order ?? i,
    // Restaura reqs del snapshot (preserva eliminaciones hechas en simulación)
    reqs: (() => {
      const normC = (s: string) => s.trim().toLowerCase();
      const personasSinReq = e.personas.filter((p) => !p.requerimiento_id);
      return (e.reqs ?? []).map((r: any) => {
        // 1. Match exacto por requerimiento_id
        const personaExacta = e.personas.find((p) => p.requerimiento_id === r.id);
        // 2. Fallback: cargo match para asignaciones antiguas sin requerimiento_id
        const personaFallback = !personaExacta
          ? personasSinReq.find((p) => {
              const cp = normC(p.cargo ?? "");
              const cr = normC(r.cargo_requerido ?? "");
              return cp === cr || cr.includes(cp) || cp.includes(cr);
            })
          : null;
        const personaAsig = personaExacta ?? personaFallback;
        return {
          id: r.id,
          cargo_requerido: r.cargo_requerido ?? null,
          pct_dedicacion: r.pct_dedicacion ?? 100,
          fecha_inicio: r.fecha_inicio,
          fecha_fin: r.fecha_fin ?? r.fecha_inicio,
          fase_nombre: r.fase_nombre ?? null,
          persona_nombre: personaAsig
            ? `${personaAsig.nombre} ${personaAsig.apellido}`.trim()
            : (r.persona_nombre ?? undefined),
        };
      });
    })(),
    // Restaura actividades (viajes/talleres) del snapshot
    actividades: (e.actividades ?? []).map((a: any) => ({
      id: a.id,
      tipo: a.tipo,
      titulo: a.titulo ?? "",
      descripcion: "",
      fecha_inicio: a.fecha_inicio,
      fecha_fin: a.fecha_fin,
    })),
    extensiones: [],
    raw: { id: e.id, codigo: e.codigo, nombre: e.nombre, cliente: e.cliente,
           tipo: e.tipo, estado: "activo", fecha_inicio: e.fecha_inicio,
           fecha_fin_estimada: e.fecha_fin, fecha_fin_real: null } as any,
    personas: e.personas.map((p) => ({
      asignacionId: `snap_${e.id}_${p.id}`,
      id: p.id,
      nombre: p.nombre,
      apellido: p.apellido,
      iniciales: p.iniciales,
      cargo: p.cargo,
      pct: p.pct,
      fecha_inicio: p.fecha_inicio,
      fecha_fin: p.fecha_fin,
      estado_staffing: "CONFIRMADO",
      requerimiento_id: p.requerimiento_id ?? null,
    })),
  }));
}

// ── Props ──────────────────────────────────────────────────────

interface Props {
  planNombre: string;
  planId: string;
  snapshot: EngSnap[];
  /** Llamado cada vez que el tablero de simulación cambia → para persistir el snapshot actualizado */
  onSnapshotChange?: (engs: any[]) => void;
  /** Llamado cuando un cambio visual (color, etc.) no pasa por el snapshot pero debe degradar el estado */
  onSimDirty?: () => void;
  /** Solo lectura: deshabilita drag-drop y mutaciones en el tablero */
  readOnly?: boolean;
}

// ── Componente ─────────────────────────────────────────────────

export function SandboxInicioView({ planNombre, planId, snapshot, onSnapshotChange, onSimDirty, readOnly = false }: Props) {
  const [personas, setPersonas]       = useState<Persona[]>([]);
  const [asignacionesDetalle, setAsignacionesDetalle] = useState<AsigDetalle[]>([]);
  const [ausenciasActivas, setAusenciasActivas] = useState<{ persona_id: string; fecha_inicio: string; fecha_fin: string }[]>([]);
  const [loading, setLoading]         = useState(true);
  const [seleccionada, setSeleccionada] = useState<Persona | null>(null);
  const [isAdmin, setIsAdmin]         = useState(false);

  // Panel recomendaciones (simulación)
  const [panelReq, setPanelReq]           = useState<PanelInfo | null>(null);
  const [panelColapsado, setPanelColapsado] = useState(false);
  const [tableroReloadKey, setTableroReloadKey] = useState(0);
  function abrirPanel(info: PanelInfo | null) { setPanelReq(info); if (info) setPanelColapsado(false); }

  // Ref al handler de inyección de asignaciones simuladas en el tablero
  const simAsigHandlerRef = useRef<((p: SimAsigPayload) => void) | null>(null);
  const registerSimHandler = useCallback((handler: (p: SimAsigPayload) => void) => {
    simAsigHandlerRef.current = handler;
  }, []);

  // Ref al pushUndo interno de DesgloceEngagements, expuesto vía onRegisterUndoPush
  const pushUndoRef = useRef<((action: any) => void) | null>(null);
  const registerUndoPush = useCallback((pushFn: (action: any) => void) => {
    pushUndoRef.current = pushFn;
  }, []);

  // ── Modal confirmación D&D (escenario) ───────────────────────
  const [pendingSimDrop, setPendingSimDrop] = useState<SimAsigPayload | null>(null);
  const [pendingSimFechas, setPendingSimFechas] = useState<{ inicio: string; fin: string }>({ inicio: "", fin: "" });

  // ── Modal truncar desasignación (escenario) ──────────────────
  const [pendingSimDesasignar, setPendingSimDesasignar] = useState<{
    asignacionId: string; engId: string; nombrePersona: string;
  } | null>(null);
  const [simDesasignarFecha, setSimDesasignarFecha] = useState<string>("");

  // ── Modal de ausencias detectadas ────────────────────────────
  const [ausenciaModal, setAusenciaModal] = useState<{
    payload: SimAsigPayload;
    ausencias: AusenciaPeriodo[];
    segmentos: { inicio: string; fin: string }[];
  } | null>(null);

  /** Valida ausencias antes de inyectar la asignación simulada (panel Y drag&drop) */
  async function handleSimAsignarConValidacion(payload: SimAsigPayload) {
    // Abre modal de confirmación con fechas editables antes de validar ausencias
    const hoyStr = format(new Date(), "yyyy-MM-dd");
    const defaultInicio = payload.fechaInicio > hoyStr ? payload.fechaInicio : hoyStr;
    setPendingSimDrop(payload);
    setPendingSimFechas({ inicio: defaultInicio, fin: payload.fechaFin });
    return;
  }

  /** Ejecuta la validación de ausencias tras confirmar el modal D&D (escenario).
   *  En simulación no hay estado_staffing real — se delega al handler interno. */
  async function confirmSimDrop() {
    if (!pendingSimDrop) return;
    const payload = { ...pendingSimDrop, fechaInicio: pendingSimFechas.inicio, fechaFin: pendingSimFechas.fin };
    setPendingSimDrop(null);
    await _doSimAsignar(payload);
  }

  async function confirmSimDropRapido() {
    if (!pendingSimDrop) return;
    // Staffing rápido: usa las fechas por defecto ya calculadas, sin modificar
    const payload = { ...pendingSimDrop, fechaInicio: pendingSimFechas.inicio, fechaFin: pendingSimFechas.fin };
    setPendingSimDrop(null);
    await _doSimAsignar(payload);
  }

  async function _doSimAsignar(payload: SimAsigPayload) {
    const sb = createAnyClient();
    const { data: aus } = await sb
      .from("ausencia")
      .select("fecha_inicio, fecha_fin, tipo")
      .eq("persona_id", payload.personaId)
      .lte("fecha_inicio", payload.fechaFin)
      .gte("fecha_fin", payload.fechaInicio);

    const ausencias = (aus ?? []) as AusenciaPeriodo[];
    if (ausencias.length === 0) {
      const simId = `sim_panel_${payload.personaId}_${payload.engagementId}_${Date.now()}`;
      simAsigHandlerRef.current?.({ ...payload, simId });
      pushUndoRef.current?.({ type: "staffear", engId: payload.engagementId, label: `Staffear ${payload.nombre} ${payload.apellido}`, ids: [simId] });
      return;
    }
    const segmentos = segmentarSinAusencias(payload.fechaInicio, payload.fechaFin, ausencias);
    // segmentos vacíos = ausencia total → modal bloqueante; si hay segmentos = parcial → modal confirmación
    setAusenciaModal({ payload, ausencias, segmentos });
  }

  function confirmarConAusencias() {
    if (!ausenciaModal) return;
    const { payload, segmentos } = ausenciaModal;
    // Inyectar un segmento por cada período libre (saltando ausencias)
    for (const seg of segmentos) {
      const simId = `sim_panel_${payload.personaId}_${payload.engagementId}_${seg.inicio}`;
      simAsigHandlerRef.current?.({ ...payload, fechaInicio: seg.inicio, fechaFin: seg.fin, simId });
      pushUndoRef.current?.({ type: "staffear", engId: payload.engagementId, label: `Staffear ${payload.nombre} ${payload.apellido}`, ids: [simId] });
    }
    setAusenciaModal(null);
  }

  // Layout (idéntico a Inicio)
  const [equipoEstado, setEquipoEstado] = useState<"normal" | "colapsado" | "expandido">("normal");
  const [activeQuadrant, setActiveQuadrant] = useState<"both" | "tablero" | "resumen">("both");

  // RESÚMEN
  const [vistaResumen, setVistaResumen]   = useState<"gantt" | "perfil">("gantt");
  const [semanaResumen, setSemanaResumen] = useState(() => startOfISOWeek(new Date()));
  const [periodoResumen, setPeriodoResumen] = useState<"dia" | "semana" | "mes">("dia");

  /** Recibe el request de desasignación en sim y abre el modal de truncado */
  function handleSimDesasignarRequest(payload: { asignacionId: string; engId: string; nombrePersona: string }) {
    setSimDesasignarFecha(format(new Date(), "yyyy-MM-dd"));
    setPendingSimDesasignar(payload);
  }

  /** Trunca la persona en el snapshot local (sim) actualizando su fecha_fin */
  function confirmarSimDesasignar(fechaFin: string) {
    if (!pendingSimDesasignar) return;
    const { asignacionId, engId } = pendingSimDesasignar;
    setPendingSimDesasignar(null);
    onSnapshotChange?.(snapshot.map((eg: any) => {
      if (eg.id !== engId) return eg;
      return {
        ...eg,
        personas: eg.personas.map((p: any) =>
          p.asignacionId === asignacionId || p.requerimiento_id === asignacionId || (p.simId && p.simId === asignacionId)
            ? { ...p, fecha_fin: fechaFin }
            : p
        ),
      };
    }));
  }

  /** Elimina físicamente del snapshot (escenario: sin trazabilidad) */
  function eliminarSimAsignacionCompleta() {
    if (!pendingSimDesasignar) return;
    const { asignacionId, engId } = pendingSimDesasignar;
    setPendingSimDesasignar(null);
    onSnapshotChange?.(snapshot.map((eg: any) => {
      if (eg.id !== engId) return eg;
      return {
        ...eg,
        personas: eg.personas.filter((p: any) =>
          p.asignacionId !== asignacionId && p.requerimiento_id !== asignacionId && !(p.simId && p.simId === asignacionId)
        ),
      };
    }));
  }

  function navResumenPrev() {
    if (periodoResumen === "semana") setSemanaResumen((s) => subWeeks(s, 5));
    else if (periodoResumen === "mes") setSemanaResumen((s) => subMonths(s, 4));
    else setSemanaResumen((s) => subWeeks(s, 1));
  }
  function navResumenNext() {
    if (periodoResumen === "semana") setSemanaResumen((s) => addWeeks(s, 5));
    else if (periodoResumen === "mes") setSemanaResumen((s) => addMonths(s, 4));
    else setSemanaResumen((s) => addWeeks(s, 1));
  }
  const periodoLabel =
    periodoResumen === "semana"
      ? `${format(semanaResumen, "d MMM", { locale: es })} – ${format(addWeeks(semanaResumen, 5), "d MMM yyyy", { locale: es })}`
      : periodoResumen === "mes"
      ? `${format(semanaResumen, "MMM", { locale: es })} – ${format(addMonths(semanaResumen, 4), "MMM yyyy", { locale: es })}`
      : `${format(semanaResumen, "d MMM", { locale: es })} – ${format(addWeeks(semanaResumen, 1), "d MMM yyyy", { locale: es })}`;

  // ── Carga de datos (idéntica a inicio/page.tsx) ─────────────
  useEffect(() => {
    async function load() {
      const sb = createAnyClient();
      const hoy = format(new Date(), "yyyy-MM-dd");
      const en7dias = format(addDays(new Date(), 7), "yyyy-MM-dd");

      // Rol del usuario actual — solo para mostrar el badge "Referente" a admins
      const { data: { user } } = await sb.auth.getUser();
      if (user) {
        const { data: personaData } = await sb.from("persona").select("rol_sistema").eq("auth_user_id", user.id).single();
        setIsAdmin((personaData as any)?.rol_sistema === "admin");
      }

      const [persRes, asigDetalleRes, ausRes] = await Promise.all([
        sb.from("persona")
          .select("id, nombre, apellido, iniciales, cargo_actual, is_leverager, referente, fecha_ingreso")
          .eq("activo", true).order("cargo_actual").order("apellido"),
        (sb as any).from("asignacion")
          .select("persona_id, fecha_fin, engagement:engagement_id(tipo)")
          .eq("estado", "activa").lte("fecha_inicio", hoy).gte("fecha_fin", hoy),
        sb.from("ausencia")
          .select("persona_id, fecha_inicio, fecha_fin")
          .lte("fecha_inicio", en7dias).gte("fecha_fin", hoy),
      ]);

      setPersonas((persRes.data ?? []) as Persona[]);

      setAsignacionesDetalle(
        ((asigDetalleRes.data ?? []) as any[]).map((a) => ({
          persona_id: a.persona_id, fecha_fin: a.fecha_fin,
          tipo: a.engagement?.tipo ?? "proyecto",
        }))
      );
      setAusenciasActivas((ausRes.data ?? []) as { persona_id: string; fecha_inicio: string; fecha_fin: string }[]);
      setLoading(false);
    }
    load();
  }, [planId]); // recarga si cambia el plan

  // Ocupación simulada: recalcula en tiempo real cuando cambia el snapshot
  const ocupacionMap = useMemo(() => {
    const hoy = format(new Date(), "yyyy-MM-dd");
    const map: Record<string, number> = {};
    for (const eng of snapshot) {
      for (const p of eng.personas) {
        const inicio = (p.fecha_inicio ?? "").slice(0, 10);
        const fin    = (p.fecha_fin    ?? "").slice(0, 10);
        if (inicio <= hoy && hoy <= fin) {
          map[p.id] = (map[p.id] ?? 0) + Number(p.pct);
        }
      }
    }
    return map;
  }, [snapshot]);

  const { grupos, cargos } = useMemo(() => {
    const grupos: Record<string, Persona[]> = {};
    for (const p of personas) {
      const cargo = p.cargo_actual ?? "Sin cargo";
      if (!grupos[cargo]) grupos[cargo] = [];
      grupos[cargo].push(p);
    }
    return { grupos, cargos: ordenarCargos(Object.keys(grupos)) };
  }, [personas]);

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">


      {/* Layout 3 columnas (igual que inicio/page.tsx) */}
      <div className="flex gap-2 flex-1 min-h-0 p-2 overflow-hidden">

        {/* ── Columna izquierda: EQUIPO + DISPONIBLES ── */}
        <div
          className="flex flex-col gap-2 overflow-hidden transition-all duration-500 ease-in-out"
          style={
            equipoEstado === "colapsado"
              ? { flexGrow: 0, flexShrink: 0, flexBasis: 32 }
              : equipoEstado === "normal"
              ? { flexGrow: 0, flexShrink: 0, flexBasis: 160 }
              : { flexGrow: 1, flexShrink: 1, flexBasis: "0%", minWidth: 0 }
          }
        >
          {/* EQUIPO */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {equipoEstado === "colapsado" ? (
              <div className="w-10 h-full rounded-xl border border-gray-100 shadow-sm bg-white flex flex-col items-center py-3 gap-3">
                <button onClick={() => setEquipoEstado("normal")} title="Expandir equipo"
                  className="p-1 rounded hover:bg-gray-100 text-gray-400 transition-colors">
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex-1 flex items-center"
                  style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}>
                  Equipo
                </span>
              </div>
            ) : (
              <div className="w-full h-full bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col overflow-hidden relative">
                <div className="flex items-center justify-between mb-3 flex-shrink-0">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Equipo</p>
                  <div className="flex items-center gap-0.5">
                    {equipoEstado === "expandido" ? (
                      <button onClick={() => setEquipoEstado("normal")} title="Reducir"
                        className="p-1 rounded hover:bg-gray-100 text-gray-400 transition-colors">
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <>
                        <button onClick={() => setEquipoEstado("colapsado")} title="Colapsar"
                          className="p-1 rounded hover:bg-gray-100 text-gray-400 transition-colors">
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setEquipoEstado("expandido")} title="Ampliar"
                          className="p-1 rounded hover:bg-gray-100 text-gray-400 transition-colors">
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {loading ? (
                  <p className="text-sm text-gray-300">Cargando...</p>
                ) : (
                  <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                    {cargos.map((cargo) => {
                      const color = COLORES[cargo] ?? COLOR_DEFAULT;
                      return (
                        <div key={cargo}>
                          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{cargo}</p>
                          <div className="flex flex-wrap gap-2">
                            {grupos[cargo].map((p) => {
                              const pct = Math.round(ocupacionMap[p.id] ?? 0);
                              const oc = ocupColor(pct);
                              return (
                                <button key={p.id} onClick={() => setSeleccionada(p)}
                                  draggable
                                  onDragStart={(e) => e.dataTransfer.setData("persona", JSON.stringify({
                                    personaId: p.id,
                                    nombre: p.nombre,
                                    apellido: p.apellido,
                                    cargo_actual: p.cargo_actual,
                                  }))}
                                  title={`${p.nombre} ${p.apellido} — ${pct}% ocupado`}
                                  className="flex flex-col items-center gap-0.5 hover:scale-110 transition-transform cursor-grab active:cursor-grabbing">
                                  <div className="relative">
                                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[12px] font-bold shadow-sm"
                                      style={{ backgroundColor: color }}>
                                      {iniciales(p.nombre, p.apellido, p.iniciales)}
                                    </div>
                                    {p.is_leverager && (
                                      <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#3b5bdb] border-2 border-white flex items-center justify-center text-white font-bold leading-none" style={{ fontSize: 7 }}>A</span>
                                    )}
                                    {isAdmin && p.referente && (
                                      <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#e2884a] border-2 border-white flex items-center justify-center text-white font-bold leading-none" style={{ fontSize: 7 }}>R</span>
                                    )}
                                  </div>
                                  <span className="text-[9px] font-bold px-1 py-0.5 rounded-full leading-none"
                                    style={{ background: oc.bg, color: oc.text }}>
                                    {pct}%
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {seleccionada && (
                  <PersonaResumenModal personaId={seleccionada.id} onClose={() => setSeleccionada(null)} simulationSnapshot={snapshot as any} ocultarMatriz={readOnly} isAdmin={isAdmin} />
                )}
              </div>
            )}
          </div>

          {/* DISPONIBLES */}
          {equipoEstado !== "colapsado" && (
            <DisponiblesTablero personas={personas} asignaciones={asignacionesDetalle} ausencias={ausenciasActivas} />
          )}
        </div>

        {/* ── Columna central: TABLERO + RESÚMEN ── */}
        <div className="flex-1 min-w-0 flex flex-col gap-4 min-h-0 overflow-hidden">

          {/* TABLERO — readOnly: true → sin escritura en Supabase */}
          <div
            className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col overflow-hidden transition-all duration-500 ease-in-out"
            style={
              activeQuadrant === "resumen"
                ? { flexGrow: 0, flexShrink: 0, flexBasis: "44px" }
                : { flexGrow: 1, flexShrink: 1, flexBasis: "0%" }
            }
          >
            <div className="flex items-center justify-between mb-3 flex-shrink-0">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Tablero</p>
              <button onClick={() => setActiveQuadrant((q) => q === "tablero" ? "both" : "tablero")}
                className="p-1 rounded hover:bg-gray-100 text-gray-400 transition-colors">
                {activeQuadrant === "tablero" ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="flex-1 overflow-auto min-h-0">
              {/* simulationMode={true} + readOnly={false} → interacciones habilitadas, sin escribir en Supabase */}
              <DesgloceEngagements
                key={planId}
                readOnly={readOnly}
                simulationMode={true}
                initialEngs={snapToEngRows(snapshot)}
                onOpenPanel={readOnly ? undefined : abrirPanel}
                externalReloadKey={tableroReloadKey}
                onSimPersonaAsignada={readOnly ? undefined : registerSimHandler}
                onSimEngsChange={readOnly ? undefined : onSnapshotChange}
                onSimDirty={readOnly ? undefined : onSimDirty}
                onSimDropRequest={readOnly ? undefined : handleSimAsignarConValidacion}
                onRegisterUndoPush={readOnly ? undefined : registerUndoPush}
                onSimDesasignarRequest={readOnly ? undefined : handleSimDesasignarRequest}
                isAdmin={isAdmin}
              />
            </div>
          </div>

          {/* RESÚMEN */}
          <div
            className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col overflow-hidden transition-all duration-500 ease-in-out"
            style={
              activeQuadrant === "tablero"
                ? { flexGrow: 0, flexShrink: 0, flexBasis: "44px" }
                : { flexGrow: 1, flexShrink: 1, flexBasis: "0%" }
            }
          >
            <div className="flex items-center justify-between mb-3 flex-shrink-0">
              <div className="flex items-center gap-3">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest flex-shrink-0">Resúmen</p>
                {activeQuadrant !== "tablero" && (
                  <div className="flex rounded-md overflow-hidden border border-gray-100 text-[11px] font-semibold">
                    <button onClick={() => setVistaResumen("gantt")} className="px-2.5 py-1 transition-colors"
                      style={vistaResumen === "gantt" ? { background: "#4a90e2", color: "#fff" } : { background: "#f9f9f9", color: "#888" }}>
                      Ausencias
                    </button>
                    <button onClick={() => setVistaResumen("perfil")} className="px-2.5 py-1 transition-colors"
                      style={vistaResumen === "perfil" ? { background: "#4a90e2", color: "#fff" } : { background: "#f9f9f9", color: "#888" }}>
                      Perfil individual
                    </button>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {activeQuadrant !== "tablero" && (
                  <div className="flex items-center gap-1">
                    <div className="flex rounded-md overflow-hidden border border-gray-100 text-[11px] font-semibold">
                      {(["dia", "semana", "mes"] as const).map((pv) => (
                        <button key={pv} onClick={() => setPeriodoResumen(pv)} className="px-2 py-1 transition-colors"
                          style={periodoResumen === pv ? { background: "#1a1a1a", color: "#fff" } : { background: "#f9f9f9", color: "#888" }}>
                          {pv === "dia" ? "Día" : pv === "semana" ? "Semana" : "Mes"}
                        </button>
                      ))}
                    </div>
                    <button onClick={navResumenPrev} className="p-1 rounded hover:bg-gray-100 text-gray-400">
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-[11px] text-gray-400 whitespace-nowrap">{periodoLabel}</span>
                    <button onClick={navResumenNext} className="p-1 rounded hover:bg-gray-100 text-gray-400">
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                <button onClick={() => setActiveQuadrant((q) => q === "resumen" ? "both" : "resumen")}
                  className="p-1 rounded hover:bg-gray-100 text-gray-400 transition-colors">
                  {activeQuadrant === "resumen" ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto min-h-0">
              {vistaResumen === "gantt"
                ? <GanttAusencias vistaExterna={periodoResumen} baseExterna={semanaResumen} onVerPersona={() => {}} />
                : <PerfilIndividualTablero semanaInicio={semanaResumen} periodoVista={periodoResumen} simulationSnapshot={snapshot as any} />
              }
            </div>
          </div>

        </div>{/* fin columna central */}

        {/* ── Columna 3: Panel recomendaciones (simulado) ── */}
        <div
          className="flex-shrink-0 overflow-hidden transition-all duration-500 ease-in-out"
          style={{ width: !panelReq ? 0 : panelColapsado ? 40 : 380 }}
        >
          {panelReq && (
            panelColapsado ? (
              <div className="w-10 h-full rounded-xl border border-gray-100 shadow-sm bg-white flex flex-col items-center py-3 gap-3">
                <button onClick={() => setPanelColapsado(false)}
                  className="p-1 rounded hover:bg-gray-100 text-gray-400 transition-colors">
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex-1 flex items-center"
                  style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}>
                  Recomendaciones
                </span>
              </div>
            ) : (
              <div className="w-[380px] h-full rounded-xl border border-amber-200 shadow-sm overflow-hidden">
                {/* Badge simulación sobre el panel */}
                <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-50 border-b border-amber-200">
                  <FlaskConical className="w-3 h-3 text-amber-500" />
                  <span className="text-[10px] text-amber-600 font-medium">Simulación — asignación no persistirá en producción</span>
                </div>
                <PanelFitAsignacion
                  reqId={panelReq.reqId}
                  engagementId={panelReq.engId}
                  engagementNombre={panelReq.engNombre}
                  engagementCliente={panelReq.engCliente}
                  engInicio={panelReq.engInicio}
                  engFin={panelReq.engFin}
                  cargo={panelReq.cargo}
                  simulationMode={true}
                  onSimAsignar={handleSimAsignarConValidacion}
                  onClose={() => setPanelReq(null)}
                  onCollapse={() => setPanelColapsado(true)}
                  onAsignado={() => {
                    setPanelReq(null);
                    setPanelColapsado(false);
                    setTableroReloadKey((k) => k + 1);
                  }}
                />
              </div>
            )
          )}
        </div>

      </div>

      {/* ── Modal: Ausencias detectadas ──────────────────────── */}
      <Modal
        open={!!ausenciaModal}
        onClose={() => setAusenciaModal(null)}
        title={ausenciaModal?.segmentos.length === 0
          ? "⛔ No se puede staffear"
          : "⚠ Ausencias detectadas en este período"}
        footer={
          ausenciaModal?.segmentos.length === 0 ? (
            // Ausencia TOTAL → solo botón cerrar (bloqueante)
            <Button variant="secondary" onClick={() => setAusenciaModal(null)}>Entendido</Button>
          ) : (
            // Ausencia PARCIAL → cancelar o confirmar con segmentación
            <>
              <Button variant="secondary" onClick={() => setAusenciaModal(null)}>Cancelar</Button>
              <Button variant="danger" onClick={confirmarConAusencias}>
                {`Asignar (${ausenciaModal?.segmentos.length} segmento${(ausenciaModal?.segmentos.length ?? 0) > 1 ? "s" : ""})`}
              </Button>
            </>
          )
        }
      >
        {ausenciaModal && (
          <div className="space-y-3 text-[13px]">
            <p className="text-[#555]">
              <strong>{ausenciaModal.payload.nombre} {ausenciaModal.payload.apellido}</strong> tiene
              ausencias registradas en el rango de este engagement:
            </p>
            <ul className="space-y-1">
              {ausenciaModal.ausencias.map((a, i) => {
                const dias = Math.round(
                  (new Date(a.fecha_fin + "T00:00:00").getTime() - new Date(a.fecha_inicio + "T00:00:00").getTime()) / 86400000
                ) + 1;
                return (
                  <li key={i} className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg">
                    <span className="text-amber-500">⚠</span>
                    <span className="text-[#555]">
                      {a.fecha_inicio} → {a.fecha_fin}
                      <span className="ml-1.5 text-[11px] font-semibold text-amber-600">({dias} día{dias !== 1 ? "s" : ""})</span>
                      <span className="ml-1.5 text-[10px] text-[#aaa]">{a.tipo?.replace(/_/g, " ")}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            {ausenciaModal.segmentos.length === 0 ? (
              <p className="text-red-700 text-[13px] font-medium bg-red-50 border border-red-200 rounded-lg p-3">
                No se puede staffear. <strong>{ausenciaModal.payload.nombre} {ausenciaModal.payload.apellido}</strong> está ausente durante todo el período del proyecto.
              </p>
            ) : ausenciaModal.segmentos.length > 0 ? (
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-green-700 text-[12px] font-medium mb-1">Asignación se dividirá en:</p>
                {ausenciaModal.segmentos.map((s, i) => (
                  <p key={i} className="text-[12px] text-green-600">
                    Segmento {i + 1}: {s.inicio} → {s.fin}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </Modal>

      {/* ── Modal: Truncar desasignación en escenario ── */}
      {pendingSimDesasignar && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl border border-gray-100 p-6 w-full max-w-sm mx-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[14px] font-semibold text-[#1a1a2e]">¿Último día de trabajo?</p>
              <button onClick={() => setPendingSimDesasignar(null)} className="text-slate-400 hover:text-slate-600 transition-colors">✕</button>
            </div>
            <p className="text-[12px] text-slate-500 mb-4">
              ¿Cuál es el último día de <span className="font-semibold text-slate-700">{pendingSimDesasignar.nombrePersona}</span> en este proyecto?
            </p>
            <div className="mb-5">
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Último día de trabajo</label>
              <input
                type="date"
                value={simDesasignarFecha}
                onChange={(e) => setSimDesasignarFecha(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#4a90e2]"
              />
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPendingSimDesasignar(null)}
                className="px-4 py-2 text-[12px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => confirmarSimDesasignar(simDesasignarFecha)}
                disabled={!simDesasignarFecha}
                className="px-4 py-2 text-[12px] font-bold text-white bg-[#1a1a2e] hover:bg-[#2d2d4e] rounded-lg transition-colors disabled:opacity-40"
              >
                Confirmar
              </button>
            </div>
              <div className="flex justify-end">
                <button
                  onClick={eliminarSimAsignacionCompleta}
                  className="text-[11px] text-slate-400 hover:text-red-500 underline transition-colors"
                >
                  Eliminar por completo (Asignación de prueba o error)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Confirmación D&D en escenario ── */}
      {pendingSimDrop && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl border border-gray-100 p-6 w-full max-w-sm mx-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[14px] font-semibold text-[#1a1a2e]">Confirmar asignación (simulación)</p>
              <button onClick={confirmSimDropRapido} title="Staffing rápido con fechas por defecto" className="text-slate-400 hover:text-slate-600 transition-colors">✕</button>
            </div>
            <p className="text-[12px] text-slate-500 mb-4">
              Staffear <span className="font-semibold text-slate-700">{pendingSimDrop.nombre} {pendingSimDrop.apellido}</span> en este engagement
            </p>
            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Fecha Inicio</label>
                <input
                  type="date"
                  value={pendingSimFechas.inicio}
                  onChange={(e) => setPendingSimFechas((f) => ({ ...f, inicio: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#4a90e2]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Fecha Fin</label>
                <input
                  type="date"
                  value={pendingSimFechas.fin}
                  onChange={(e) => setPendingSimFechas((f) => ({ ...f, fin: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#4a90e2]"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPendingSimDrop(null)}
                className="px-4 py-2 text-[12px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmSimDrop}
                disabled={!pendingSimFechas.inicio || !pendingSimFechas.fin}
                className="px-4 py-2 text-[12px] font-bold text-white bg-[#1a1a2e] hover:bg-[#2d2d4e] rounded-lg transition-colors disabled:opacity-40"
              >
                Confirmar asignación
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
