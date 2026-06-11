"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  startOfISOWeek, addDays, addWeeks, addMonths,
  subWeeks, subMonths, format, startOfMonth, endOfMonth,
} from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight, ChevronDown, Plus, Pencil, X, Calendar, Users, Building2, AlignLeft, Briefcase, Trash2, Loader2, GripVertical, RotateCcw, Diamond, Plane, BarChart2, Search, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { createAnyClient } from "@/lib/supabase/client";
import { EngagementForm } from "@/components/engagements/EngagementForm";
import { ColaboradorModal } from "@/components/engagements/ColaboradorModal";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import type { Engagement } from "@/lib/types/database";
import { COLOR_AUSENCIA } from "@/lib/queries/ausencias";

// ── Cargos Asociado y Consultor Senior son la misma categoría visual ──
const GRUPO_SENIOR = ["Asociado", "Consultor Senior", "Asociado / Consultor Senior"];
const LABEL_SENIOR = "Asociado / Consultor Senior";
const GRUPO_DIR = ["Director de Proyectos", "Gerente de Proyectos", "Director / Gerente de Proyectos", "Director", "Gerente"];
const LABEL_DIR = "Director / Gerente de Proyectos";

function normalizeCargoDisplay(cargo: string): string {
  const c = cargo.trim(); // defensivo ante espacios en BD
  if (GRUPO_DIR.includes(c)) return LABEL_DIR;
  return GRUPO_SENIOR.includes(c) ? LABEL_SENIOR : c;
}
function matchesCargo(reqCargo: string | null, rowCargo: string): boolean {
  if (!reqCargo) return false;
  if (normalizeCargoDisplay(reqCargo) === rowCargo) return true;
  return false;
}

const JERARQUIA: Record<string, number> = {
  "Socio": 1,
  "Director / Gerente de Proyectos": 2, "Director de Proyectos": 2, "Director": 2,
  "Gerente de Proyectos": 2, "Gerente": 2,
  "Asociado / Consultor Senior": 4,
  "Asociado": 4, "Consultor Senior": 4,
  "Consultor de Proyectos": 5, "Consultor Proyecto": 5,
  "Consultor": 5, "Consultor Analista": 6, "Analista Senior": 6,
  "Consultor Trainee": 7, "Analista": 7, "Practicante": 8,
};

const COLORES: Record<string, string> = {
  "Socio": "#1a1a2e",
  "Director / Gerente de Proyectos": "#4a90e2", "Director de Proyectos": "#4a90e2", "Director": "#4a90e2",
  "Gerente de Proyectos": "#4a90e2", "Gerente": "#4a90e2",
  "Asociado / Consultor Senior": "#e2884a",
  "Asociado": "#e2884a", "Consultor Senior": "#4ab89a",
  "Consultor de Proyectos": "#e24a6a",
  "Consultor Analista": "#a0b84a", "Consultor Trainee": "#c07c4a",
};
const COLOR_DEFAULT = "#94a3b8";

type Vista = "dia" | "semana" | "mes";
interface Columna { label: string; sublabel: string; inicio: Date; fin: Date; }

function columnasDia(base: Date): Columna[] {
  const lunes = startOfISOWeek(base);
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(lunes, i);
    return { label: format(d, "EEE", { locale: es }), sublabel: format(d, "d MMM", { locale: es }), inicio: d, fin: d };
  });
}
function columnasSemana(base: Date): Columna[] {
  const inicio = startOfISOWeek(base);
  return Array.from({ length: 9 }, (_, i) => {
    const s = addWeeks(inicio, i);
    const fin = addDays(s, 6);
    return { label: format(s, "d MMM", { locale: es }), sublabel: format(fin, "d MMM", { locale: es }), inicio: s, fin };
  });
}
function columnasMes(base: Date): Columna[] {
  return Array.from({ length: 8 }, (_, i) => {
    const m = addMonths(base, i);
    return { label: format(m, "MMM", { locale: es }), sublabel: format(m, "yyyy"), inicio: startOfMonth(m), fin: endOfMonth(m) };
  });
}
function parseLocal(s: string): Date {
  // "2026-05-26" → local midnight (evita off-by-one por timezone UTC)
  return new Date(s + "T00:00:00");
}
function rangoSolapan(aIni: string, aFin: string | null, cIni: Date, cFin: Date) {
  if (!aFin) return parseLocal(aIni) <= cFin;
  return parseLocal(aIni) <= cFin && parseLocal(aFin) >= cIni;
}
// Devuelve si el engagement (período original o cualquier extensión) está activo en la columna
function engActivoEnCol(eng: { fecha_inicio: string; fecha_fin: string | null; extensiones: { fecha_inicio: string; fecha_fin: string }[] }, cIni: Date, cFin: Date): boolean {
  if (rangoSolapan(eng.fecha_inicio, eng.fecha_fin, cIni, cFin)) return true;
  return eng.extensiones.some((ex) => rangoSolapan(ex.fecha_inicio, ex.fecha_fin, cIni, cFin));
}
// Devuelve si la columna cae en la "brecha" entre el fin original y el inicio de una extensión
function engEnBrechaEnCol(eng: { fecha_fin: string | null; extensiones: { fecha_inicio: string; fecha_fin: string }[] }, cIni: Date, cFin: Date): boolean {
  if (!eng.fecha_fin || eng.extensiones.length === 0) return false;
  const finOrig = parseLocal(eng.fecha_fin);
  return eng.extensiones.some((ex) => {
    const extIni = parseLocal(ex.fecha_inicio);
    return cIni > finOrig && cFin < extIni;
  });
}
function iniciales(nombre: string, apellido: string, custom?: string | null) {
  if (custom?.trim()) return custom.trim().toUpperCase().slice(0, 3);
  return `${nombre[0] ?? ""}${apellido[0] ?? ""}`.toUpperCase();
}

interface PersonaAsig {
  id: string; nombre: string; apellido: string;
  iniciales?: string | null;
  cargo: string | null; pct: number;
  fecha_inicio: string; fecha_fin: string;
  asignacionId: string;
  estado_staffing: "CONFIRMADO" | "PLAN";
  requerimiento_id: string | null;
}
interface ReqData {
  id: string; cargo_requerido: string | null;
  fecha_inicio: string; fecha_fin: string;
  pct_dedicacion: number;
}
interface ActividadEng { tipo: "Viajes" | "Taller"; titulo: string; descripcion: string | null; fecha_inicio: string; fecha_fin: string; }

interface EngRow {
  id: string; codigo: string | null; nombre: string; cliente: string | null; tipo: string;
  fecha_inicio: string; fecha_fin: string | null;
  personas: PersonaAsig[];
  reqs: ReqData[];
  actividades: ActividadEng[];
  extensiones: { id: string; fecha_inicio: string; fecha_fin: string }[];
  raw: Engagement;
  sort_order: number | null;
}

export interface PanelInfo {
  reqId: string; engId: string; engNombre: string; engCliente: string;
  engInicio?: string; engFin?: string; cargo?: string;
}

interface Props {
  onAsignacionChange?: () => void;
  onOpenPanel?: (info: PanelInfo | null) => void;
  externalReloadKey?: number;
  vistaExterna?: Vista;
  baseExterna?: Date;
  /** Si se provee, delega el clic de avatar al padre (ej. inicio/page.tsx usa su propio modal) */
  onPersonaClick?: (personaId: string) => void;
  /** Si se provee, expande y hace scroll hasta ese engagement al cargar */
  openEngagementId?: string;
  /** Solo lectura: deshabilita drag&drop, edición y apertura de modales */
  readOnly?: boolean;
  /**
   * Modo simulación: habilita interacciones pero redirige TODAS las mutaciones
   * al estado local (engs) sin tocar Supabase. Úsalo en la vista de Planificación.
   */
  simulationMode?: boolean;
  /** Datos iniciales pre-cargados (snapshot). Solo se usa cuando simulationMode=true. */
  initialEngs?: EngRow[];
  /** Callback para inyectar una asignación simulada desde un panel externo (ej: PanelFitAsignacion) */
  onSimPersonaAsignada?: (handler: (payload: SimAsigPayload) => void) => void;
  /** Llamado cada vez que `engs` cambia en simulationMode → permite al padre capturar el estado */
  onSimEngsChange?: (engs: EngRow[]) => void;
  /** En simulationMode: en lugar de insertar directo, delega al padre para validar ausencias */
  onSimDropRequest?: (payload: SimAsigPayload) => void;
  /** Expone pushUndo al padre → permite que planificación registre acciones en el undoStack interno */
  onRegisterUndoPush?: (pushFn: (action: UndoEntry) => void) => void;
  /** Llamado cuando un cambio visual (color) no pasa por onSimEngsChange pero debe marcar el plan como modificado */
  onSimDirty?: () => void;
}

export interface SimAsigPayload {
  engagementId: string; reqId: string; personaId: string;
  nombre: string; apellido: string; cargo: string;
  pct: number; fechaInicio: string; fechaFin: string;
  simId?: string; // ID controlado por el padre para sincronizar undo
}

// ── Tipo para el undo stack (fuera del componente para evitar re-declaraciones) ──
type UndoEntry =
  | { type: "staffear";    engId: string; label: string; ids: string[] }
  | { type: "desasignar";  engId: string; label: string; asig: { engagement_id: string; requerimiento_id: string; persona_id: string; cargo_al_momento: string | null; pct_dedicacion: number | null; estado: string; estado_staffing: string; fecha_inicio: string; fecha_fin: string } }
  | { type: "resize";      engId: string; label: string; asignacionId: string; edge: "start" | "end"; prevDate: string }
  | { type: "resize_eng";  engId: string; label: string; field: string; prevDate: string }
  | { type: "move_eng";    engId: string; label: string; prevInicio: string; prevFin: string; finField: string }
  | { type: "color_semana"; engId: string; label: string; fecha: string; fecha_fin: string; prevEntry: { fecha: string; fecha_fin: string | null; intensidad: string } | null }
  | { type: "edit_reqs";   engId: string; label: string; engNombre: string; prevReqs: ReqData[]; prevPersonas: PersonaAsig[] };

export function DesgloceEngagements({ onAsignacionChange, onOpenPanel, externalReloadKey, vistaExterna, baseExterna, onPersonaClick, openEngagementId, readOnly = false, simulationMode = false, onSimPersonaAsignada, initialEngs, onSimEngsChange, onSimDirty, onSimDropRequest, onRegisterUndoPush }: Props) {
  const [vistaInterna, setVistaInterna] = useState<Vista>("semana");
  const [baseInterna, setBaseInterna] = useState<Date>(new Date());

  // Si vienen props externas las usamos; si no, usamos estado interno
  const vista = vistaExterna ?? vistaInterna;
  const base = baseExterna ?? baseInterna;
  const [engs, setEngs] = useState<EngRow[]>(() =>
    simulationMode && initialEngs ? structuredClone(initialEngs) : []
  );
  const [ausencias, setAusencias] = useState<{ persona_id: string; fecha_inicio: string; fecha_fin: string; tipo: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");

  // Notifica al padre cuando engs cambia en simulación (para persistencia del snapshot)
  useEffect(() => {
    if (simulationMode && onSimEngsChange && engs.length > 0) {
      onSimEngsChange(engs);
    }
  }, [engs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Registrar handler para inyección de asignaciones simuladas desde panel externo
  useEffect(() => {
    if (!simulationMode || !onSimPersonaAsignada) return;
    onSimPersonaAsignada((payload) => {
      setEngs((prev) => prev.map((eg) => {
        if (eg.id !== payload.engagementId) return eg;

        // Evitar duplicado: si la persona ya está asignada en este engagement, skip
        const yaExiste = eg.personas.some(
          (p) => p.id === payload.personaId &&
                 p.fecha_inicio === payload.fechaInicio &&
                 p.fecha_fin === payload.fechaFin
        );
        if (yaExiste) return eg;

        // Buscar slot libre del mismo cargo (requerimiento sin persona asignada)
        // Un slot libre = cargo existe en reqs pero ninguna PersonaAsig lo ocupa
        const reqLibre = eg.reqs.find((r) => {
          if (!r.cargo_requerido) return false;
          const cargoNormalizado = r.cargo_requerido.trim().toLowerCase();
          const cargoPayload = payload.cargo.trim().toLowerCase();
          if (cargoNormalizado !== cargoPayload) return false;
          // Verificar que ninguna persona ya esté asignada a ese req
          return !eg.personas.some((p) => p.requerimiento_id === r.id);
        });

        const simId = payload.simId ?? `sim_panel_${Date.now()}`;

        // Si no hay req libre, crear uno nuevo en eg.reqs para esta segunda persona
        let reqId: string | null = reqLibre?.id ?? null;
        let nuevosReqs = eg.reqs;
        if (!reqLibre) {
          const nuevoReqId = `sim_req_${eg.id}_${payload.cargo}_${Date.now()}`;
          const nuevoReq: ReqData = {
            id: nuevoReqId,
            cargo_requerido: payload.cargo,
            pct_dedicacion: payload.pct,
            fecha_inicio: payload.fechaInicio,
            fecha_fin: payload.fechaFin,
          };
          nuevosReqs = [...eg.reqs, nuevoReq];
          reqId = nuevoReqId;
        }

        const nuevaPersona: PersonaAsig = {
          asignacionId: simId,
          id: payload.personaId,
          nombre: payload.nombre,
          apellido: payload.apellido,
          iniciales: null,
          cargo: payload.cargo,
          pct: payload.pct,
          fecha_inicio: payload.fechaInicio,
          fecha_fin: payload.fechaFin,
          estado_staffing: "CONFIRMADO",
          requerimiento_id: reqId,
        };
        return { ...eg, reqs: nuevosReqs, personas: [...eg.personas, nuevaPersona] };
      }));
    });
  }, [simulationMode, onSimPersonaAsignada]);

  // Form crear/editar engagement
  const [formOpen, setFormOpen] = useState(false);
  const [engToEdit, setEngToEdit] = useState<Engagement | undefined>();
  const [reqsToEdit, setReqsToEdit] = useState<any[]>([]); // reqs locales al editar en simulación
  const [actividadesToEdit, setActividadesToEdit] = useState<any[]>([]); // actividades locales en simulación

  // Modal detalle engagement
  const [engModal, setEngModal] = useState<EngRow | null>(null);
  const [modalIndustria, setModalIndustria] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  // Captura reqs previos al abrir el form (para undo en modo no-simulación)
  const prevReqsForUndoRef = useRef<ReqData[]>([]);

  // Toast de alertas
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 15000); // 15 s según spec de negocio
  };

  // Modal de ausencias parciales (Inicio, modo real)
  type AusenciaItem = { fecha_inicio: string; fecha_fin: string; dias: number };
  const [ausenciaConfirmModal, setAusenciaConfirmModal] = useState<{
    nombre: string;
    ausencias: AusenciaItem[];
    onConfirm: () => Promise<void>;
    totalBloqueo?: boolean;
  } | null>(null);

  // ── Undo stack — registra hasta 3 acciones reversibles ──────────────────
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [undoing,   setUndoing]   = useState(false);
  // Encola una entrada (max 3); siempre usa actualización funcional para thread-safety
  function pushUndo(entry: UndoEntry) {
    setUndoStack(s => [...s.slice(-2), entry]);
  }

  // Expone pushUndo al padre (solo en simulationMode) → planificación lo llama tras cada acción sim
  useEffect(() => {
    if (simulationMode && onRegisterUndoPush) onRegisterUndoPush(pushUndo);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulationMode, onRegisterUndoPush]);

  async function handleUndo() {
    if (!undoStack.length || undoing) return;
    const last = undoStack[undoStack.length - 1];
    setUndoing(true);

    // ── SIMULACIÓN: revertir en estado local sin tocar Supabase ─────────
    if (simulationMode) {
      if (last.type === "staffear") {
        // Eliminar las asignaciones creadas localmente
        setEngs((prev) => prev.map((eg) =>
          eg.id !== last.engId ? eg : {
            ...eg,
            personas: eg.personas.filter((p) => !last.ids.includes(p.asignacionId)),
          }
        ));
      } else if (last.type === "desasignar") {
        // Re-insertar persona eliminada en el engagement
        const a = last.asig as any;
        const personaRestaurada: PersonaAsig = {
          asignacionId: a.id ?? `sim_undo_${Date.now()}`,
          id: a.persona_id,
          nombre: a.nombre ?? "",
          apellido: a.apellido ?? "",
          iniciales: null,
          cargo: a.cargo_al_momento ?? "",
          pct: a.pct_dedicacion ?? 100,
          fecha_inicio: a.fecha_inicio,
          fecha_fin: a.fecha_fin,
          estado_staffing: a.estado_staffing ?? "CONFIRMADO",
          requerimiento_id: a.requerimiento_id ?? null,
        };
        setEngs((prev) => prev.map((eg) =>
          eg.id !== last.engId ? eg : { ...eg, personas: [...eg.personas, personaRestaurada] }
        ));
      } else if (last.type === "resize") {
        // Restaurar fecha de barra de persona
        const campo = last.edge === "start" ? "fecha_inicio" : "fecha_fin";
        setEngs((prev) => prev.map((eg) => ({
          ...eg,
          personas: eg.personas.map((p) =>
            p.asignacionId !== last.asignacionId ? p : { ...p, [campo]: last.prevDate }
          ),
        })));
      } else if (last.type === "resize_eng") {
        // Restaurar fecha del engagement
        setEngs((prev) => prev.map((eg) =>
          eg.id !== last.engId ? eg : {
            ...eg,
            fecha_inicio: last.field === "fecha_inicio" ? last.prevDate : eg.fecha_inicio,
            fecha_fin:    last.field !== "fecha_inicio"  ? last.prevDate : eg.fecha_fin,
            raw: { ...(eg.raw as any), [last.field]: last.prevDate },
          }
        ));
      } else if (last.type === "move_eng") {
        setEngs((prev) => prev.map((eg) =>
          eg.id !== last.engId ? eg : {
            ...eg,
            fecha_inicio: last.prevInicio,
            fecha_fin: last.prevFin,
            raw: { ...(eg.raw as any), fecha_inicio: last.prevInicio, [last.finField]: last.prevFin },
          }
        ));
      } else if (last.type === "color_semana") {
        setDiasCriticosMap((prev) => {
          const next = new Map(prev);
          const sin = (next.get(last.engId) ?? []).filter(
            (dc) => !(dc.fecha === last.fecha && (dc.fecha_fin ?? last.fecha) === last.fecha_fin)
          );
          next.set(last.engId, last.prevEntry ? [...sin, last.prevEntry] : sin);
          return next;
        });
      } else if (last.type === "edit_reqs") {
        setEngs((prev) => prev.map((eg) =>
          eg.id !== last.engId ? eg : { ...eg, reqs: last.prevReqs, personas: last.prevPersonas }
        ));
      }
      setUndoStack(s => s.slice(0, -1));
      setUndoing(false);
      return;
    }
    // ────────────────────────────────────────────────────────────────────

    const sb = createAnyClient();
    if (last.type === "staffear") {
      // Eliminar las asignaciones creadas
      if (last.ids.length) await (sb as any).from("asignacion").delete().in("id", last.ids);
    } else if (last.type === "desasignar") {
      // Re-insertar la asignación eliminada
      await (sb as any).from("asignacion").insert(last.asig);
    } else if (last.type === "resize") {
      // Restaurar fecha de barra de persona
      await (sb as any).from("asignacion")
        .update({ [last.edge === "start" ? "fecha_inicio" : "fecha_fin"]: last.prevDate })
        .eq("id", last.asignacionId);
    } else if (last.type === "resize_eng") {
      // Restaurar fecha de barra del engagement
      await (sb as any).from("engagement")
        .update({ [last.field]: last.prevDate })
        .eq("id", last.engId);
    } else if (last.type === "move_eng") {
      // Restaurar posición completa del engagement
      await (sb as any).from("engagement")
        .update({ fecha_inicio: last.prevInicio, [last.finField]: last.prevFin })
        .eq("id", last.engId);
    } else if (last.type === "color_semana") {
      // Eliminar color actual y restaurar el previo (si existía)
      await sb.from("dia_critico").delete().eq("engagement_id", last.engId).eq("fecha", last.fecha);
      if (last.prevEntry) {
        await (sb as any).from("dia_critico").insert({ engagement_id: last.engId, fecha: last.prevEntry.fecha, fecha_fin: last.prevEntry.fecha_fin, intensidad: last.prevEntry.intensidad });
      }
      setDiasCriticosMap((prev) => {
        const next = new Map(prev);
        const sin = (next.get(last.engId) ?? []).filter((dc) => !(dc.fecha === last.fecha && (dc.fecha_fin ?? last.fecha) === last.fecha_fin));
        next.set(last.engId, last.prevEntry ? [...sin, last.prevEntry] : sin);
        return next;
      });
    } else if (last.type === "edit_reqs") {
      // Borrar todos los reqs actuales y restaurar los anteriores con sus IDs originales
      await sb.from("requerimiento_engagement").delete().eq("engagement_id", last.engId);
      if (last.prevReqs.length) {
        await (sb as any).from("requerimiento_engagement").insert(
          last.prevReqs.map((r) => ({ id: r.id, engagement_id: last.engId, cargo_requerido: r.cargo_requerido, fecha_inicio: r.fecha_inicio, fecha_fin: r.fecha_fin, pct_dedicacion: r.pct_dedicacion ?? 100 }))
        );
      }
    }
    setUndoStack(s => s.slice(0, -1));
    setUndoing(false);
    refresh(last.engId || undefined);
  }

  // Confirmación de planes
  const [confirmando, setConfirmando] = useState<string | null>(null);

  // Resize de PLAN por manillas
  const [resizing, setResizing] = useState<{ p: PersonaAsig; edge: "start" | "end" } | null>(null);
  const [resizeHoverIdx, setResizeHoverIdx] = useState<number | null>(null);
  const resizeHoverRef = useRef<number | null>(null);

  // Resize de la barra de Engagement (fecha_inicio / fecha_fin)
  const [resizingEng, setResizingEng] = useState<{ eng: EngRow; edge: "start" | "end" } | null>(null);
  const resizeEngHoverRef = useRef<number | null>(null);

  // Move completo de la barra del Engagement (arrastrar cuerpo de la barra)
  const [movingEng, setMovingEng] = useState<{ eng: EngRow; startColIdx: number } | null>(null);
  const [moveEngHoverIdx, setMoveEngHoverIdx] = useState<number | null>(null);
  const moveEngHoverRef = useRef<number | null>(null);
  // Ref síncrono: bloquea el drag vertical nativo del <tr> cuando resize o move de barra está activo
  const movingEngActiveRef  = useRef(false); // move cuerpo
  const resizingEngActiveRef = useRef(false); // resize bordes

  async function confirmarPlan(p: PersonaAsig, engId?: string) {
    setConfirmando(p.asignacionId);
    // ── SIMULACIÓN: sólo actualiza estado local ──────────────────────────
    if (simulationMode) {
      setEngs((prev) => prev.map((eg) =>
        eg.id !== engId ? eg : {
          ...eg,
          personas: eg.personas.map((pa) =>
            pa.asignacionId !== p.asignacionId ? pa : { ...pa, estado_staffing: "CONFIRMADO" }
          ),
        }
      ));
      setConfirmando(null);
      return;
    }
    // ────────────────────────────────────────────────────────────────────
    const sb = createAnyClient();
    await sb.from("asignacion")
      .update({ estado_staffing: "CONFIRMADO" })
      .eq("id", p.asignacionId);
    if (p.requerimiento_id) {
      const { data: competidores } = await sb.from("asignacion")
        .select("id")
        .eq("requerimiento_id", p.requerimiento_id)
        .eq("estado_staffing", "PLAN")
        .neq("id", p.asignacionId)
        .lte("fecha_inicio", p.fecha_fin)
        .gte("fecha_fin", p.fecha_inicio);
      if (competidores && competidores.length > 0) {
        await sb.from("asignacion")
          .delete()
          .in("id", (competidores as { id: string }[]).map((c) => c.id));
      }
    }
    setConfirmando(null);
    refresh(engId);
  }

  // Drag & Drop
  const [dragOverReqId, setDragOverReqId] = useState<string | null>(null);
  const [dragOverEngId, setDragOverEngId] = useState<string | null>(null);
  const [desasignando, setDesasignando] = useState<string | null>(null);
  // Ghost circles (extensión)
  const [dragOverGhostKey, setDragOverGhostKey] = useState<string | null>(null);
  const [ghostLoading, setGhostLoading] = useState<string | null>(null);

  // Papelera
  const [confirmPapeleraDesg, setConfirmPapeleraDesg] = useState<{ id: string; nombre: string } | null>(null);

  // Popup resumen persona (mantenido como estado legacy, ya no se usa directamente)
  const [avatarPopup, setAvatarPopup] = useState<{ personaId: string; x: number; y: number } | null>(null);

  // Modal multi-período: editar tramos de asignación de una persona en un engagement
  const [asigModal, setAsigModal] = useState<{
    persona: PersonaAsig;
    eng: EngRow;
  } | null>(null);

  // Intensidad por engagement (dias_criticos)
  type DcEntry = { fecha: string; fecha_fin: string | null; intensidad: string };
  const [diasCriticosMap, setDiasCriticosMap] = useState<Map<string, DcEntry[]>>(new Map());
  const [quickEdit, setQuickEdit] = useState<{ engId: string; fecha: string; fecha_fin: string; x: number; y: number } | null>(null);
  const instanceId = useRef(Math.random().toString(36).slice(2));
  const INTENSIDAD_COLOR: Record<string, string> = { rojo: "#ef4444", amarillo: "#f59e0b", verde: "#22c55e" };

  // Reordenamiento manual de engagements (drag & drop vertical)
  const [draggingEngId, setDraggingEngId]       = useState<string | null>(null);
  const [dragOverEngSortId, setDragOverEngSortId] = useState<string | null>(null);

  // Edición/eliminación de requerimiento desde la fila de cargo del tablero
  const [editReqModal,   setEditReqModal]   = useState<{ req: ReqData; engId: string } | null>(null);
  const [editFechas,     setEditFechas]     = useState({ inicio: "", fin: "" });
  const [deleteReqModal, setDeleteReqModal] = useState<{ reqs: ReqData[]; engId: string; cargo: string } | null>(null);
  const [reqLoading,     setReqLoading]     = useState(false);

  async function handleEngReorder(fromId: string, toId: string) {
    if (fromId === toId) return;
    const fromEng = engs.find(e => e.id === fromId);
    const toEng   = engs.find(e => e.id === toId);
    // Solo reordenar dentro del mismo tipo de sección
    if (!fromEng || !toEng || fromEng.tipo !== toEng.tipo) return;

    // Optimistic update: reordenar el array local de inmediato
    const next = [...engs];
    const fromIdx = next.findIndex(e => e.id === fromId);
    const toIdx   = next.findIndex(e => e.id === toId);
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    // Reasignar sort_order consecutivo
    const withOrder = next.map((e, i) => ({ ...e, sort_order: i + 1 }));
    setEngs(withOrder);

    // ── SIMULACIÓN: reorder ya aplicado optimísticamente, no persiste ───
    if (simulationMode) return;
    // ────────────────────────────────────────────────────────────────────
    // Persistir en Supabase (batch silencioso en segundo plano)
    const sb = createAnyClient();
    await Promise.all(
      withOrder.map(e => sb.from("engagement").update({ sort_order: e.sort_order }).eq("id", e.id))
    );
  }

  // Abre modal edición de fechas del requerimiento (primer req del cargo)
  function openEditReq(eng: EngRow, cargo: string) {
    const req = eng.reqs.find((r) => matchesCargo(r.cargo_requerido, cargo));
    if (!req) return;
    setEditFechas({ inicio: req.fecha_inicio, fin: req.fecha_fin });
    setEditReqModal({ req, engId: eng.id });
  }
  // Guarda fechas editadas — en simulación solo actualiza engs local
  async function saveEditReq() {
    if (!editReqModal) return;
    setReqLoading(true);
    if (simulationMode) {
      setEngs((prev) => prev.map((eg) =>
        eg.id !== editReqModal.engId ? eg : {
          ...eg,
          reqs: eg.reqs.map((r) =>
            r.id !== editReqModal.req.id ? r : { ...r, fecha_inicio: editFechas.inicio, fecha_fin: editFechas.fin }
          ),
        }
      ));
      setReqLoading(false);
      setEditReqModal(null);
      return;
    }
    const sb = createAnyClient();
    await sb.from("requerimiento_engagement")
      .update({ fecha_inicio: editFechas.inicio, fecha_fin: editFechas.fin })
      .eq("id", editReqModal.req.id);
    setReqLoading(false);
    setEditReqModal(null);
    refresh(editReqModal.engId);
  }
  // Abre confirmación de eliminación (agrupa todos los reqs del cargo)
  function openDeleteReq(eng: EngRow, cargo: string) {
    const reqs = eng.reqs.filter((r) => matchesCargo(r.cargo_requerido, cargo));
    if (reqs.length === 0) return;
    setDeleteReqModal({ reqs, engId: eng.id, cargo });
  }
  // Elimina reqs + sus asignaciones — en simulación solo limpia estado local
  async function confirmDeleteReq() {
    if (!deleteReqModal) return;
    setReqLoading(true);
    const ids = new Set(deleteReqModal.reqs.map((r) => r.id));
    if (simulationMode) {
      setEngs((prev) => prev.map((eg) =>
        eg.id !== deleteReqModal.engId ? eg : {
          ...eg,
          reqs: eg.reqs.filter((r) => !ids.has(r.id)),
          personas: eg.personas.filter((p) => !p.requerimiento_id || !ids.has(p.requerimiento_id)),
        }
      ));
      setReqLoading(false);
      setDeleteReqModal(null);
      return;
    }
    const sb = createAnyClient();
    const idsArr = [...ids];
    await sb.from("asignacion").delete().in("requerimiento_id", idsArr);
    await sb.from("requerimiento_engagement").delete().in("id", idsArr);
    setReqLoading(false);
    setDeleteReqModal(null);
    refresh(deleteReqModal.engId);
  }

  // Colapso por engagement
  const [colapsados, setColapsados] = useState<Set<string>>(new Set());
  function toggleColapso(id: string) {
    setColapsados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function colapsarTodos() { setColapsados(new Set(engs.map((e) => e.id))); }
  function expandirTodos()  { setColapsados(new Set()); }

  const columnas: Columna[] = useMemo(
    () =>
      vista === "dia" ? columnasDia(base) :
      vista === "semana" ? columnasSemana(base) :
      columnasMes(base),
    [vista, base]
  );

  const inicioStr = format(columnas[0].inicio, "yyyy-MM-dd");
  const finStr = format(columnas[columnas.length - 1].fin, "yyyy-MM-dd");
  // Lookback para ghost circles: trae asignaciones finalizadas hasta 90 días antes de la vista
  const lookbackStr = format(addDays(columnas[0].inicio, -90), "yyyy-MM-dd");

  useEffect(() => {
    // ── SIMULACIÓN: no re-fetch de engs/asigs, pero SÍ buscamos ausencias en vivo ──────
    if (simulationMode) {
      function fetchAusenciasSimulacion() {
        const sb = createAnyClient();
        sb.from("ausencia")
          .select("persona_id, fecha_inicio, fecha_fin, tipo")
          .lte("fecha_inicio", finStr)
          .gte("fecha_fin", inicioStr)
          .then(({ data }: { data: any }) => {
            setAusencias((data ?? []) as { persona_id: string; fecha_inicio: string; fecha_fin: string; tipo: string }[]);
          });
      }

      fetchAusenciasSimulacion();

      // Re-fetch automático cuando el usuario vuelve a esta pestaña / ventana
      // (cubre el caso: usuario va al sidebar Ausencias, crea una, vuelve al escenario)
      function handleVisibilityChange() {
        if (document.visibilityState === "visible") fetchAusenciasSimulacion();
      }
      document.addEventListener("visibilitychange", handleVisibilityChange);

      setLoading(false);
      return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    }
    // ─────────────────────────────────────────────────────────────────────────────────────
    async function load() {
      setLoading(true);
      const sb = createAnyClient();
      const cutoff = (() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split("T")[0]; })();
      const filtroCutoff = [`fecha_fin_real.gte.${cutoff}`, `and(fecha_fin_real.is.null,fecha_fin_estimada.gte.${cutoff})`, `and(fecha_fin_real.is.null,fecha_fin_estimada.is.null)`].join(",");

      // IDs de engagements con extensiones que solapan la vista actual
      const { data: extVisibles } = await (sb as any)
        .from("engagement_extension")
        .select("engagement_id")
        .lte("fecha_inicio", finStr)
        .gte("fecha_fin", inicioStr);
      const extEngIds = [...new Set((extVisibles ?? []).map((r: any) => r.engagement_id as string))];

      const [engRes, asigRes, ausRes] = await Promise.all([
        sb.from("engagement")
          .select("id, codigo, nombre, cliente, tipo, estado, descripcion, fecha_inicio, fecha_fin_estimada, fecha_fin_real, industria_id, sort_order")
          .eq("estado", "activo")
          .eq("is_deleted", false)
          // Incluye engagements activos en la vista O engagements con extensiones en este rango
          .or([
            `fecha_fin_real.gte.${inicioStr}`,
            `fecha_fin_estimada.gte.${inicioStr}`,
            `fecha_fin_real.is.null`,
            `fecha_inicio.gte.${inicioStr}`,
            ...(extEngIds.length > 0 ? [`id.in.(${extEngIds.join(",")})`] : []),
          ].join(","))
          .or(filtroCutoff),

        sb.from("asignacion")
          .select("id, engagement_id, persona_id, pct_dedicacion, fecha_inicio, fecha_fin, estado_staffing, requerimiento_id, persona:persona_id(nombre, apellido, cargo_actual, iniciales)" as any)
          .eq("estado", "activa")
          .lte("fecha_inicio", finStr)
          .gte("fecha_fin", lookbackStr),

        sb.from("ausencia")
          .select("persona_id, fecha_inicio, fecha_fin, tipo")
          .lte("fecha_inicio", finStr)
          .gte("fecha_fin", inicioStr),
      ]);

      const engMap = new Map<string, EngRow>();
      for (const e of (engRes.data ?? []) as any[]) {
        engMap.set(e.id, {
          id: e.id, codigo: e.codigo ?? null, nombre: e.nombre, cliente: e.cliente,
          tipo: e.tipo ?? "proyecto",
          fecha_inicio: e.fecha_inicio,
          fecha_fin: e.fecha_fin_real ?? e.fecha_fin_estimada ?? null,
          personas: [], reqs: [], actividades: [], extensiones: [], raw: e as Engagement,
          sort_order: e.sort_order ?? null,
        });
      }

      for (const a of (asigRes.data ?? []) as any[]) {
        const eng = engMap.get(a.engagement_id);
        if (!eng) continue;
        eng.personas.push({
          id: a.persona_id,
          nombre: a.persona?.nombre ?? "?",
          apellido: a.persona?.apellido ?? "",
          iniciales: a.persona?.iniciales ?? null,
          cargo: a.persona?.cargo_actual ?? null,
          pct: Number(a.pct_dedicacion),
          fecha_inicio: a.fecha_inicio,
          fecha_fin: a.fecha_fin,
          asignacionId: a.id,
          estado_staffing: (a.estado_staffing ?? "CONFIRMADO") as "CONFIRMADO" | "PLAN",
          requerimiento_id: a.requerimiento_id ?? null,
        });
      }

      for (const eng of engMap.values()) {
        eng.personas.sort((a, b) => {
          const ia = JERARQUIA[a.cargo ?? ""] ?? 99;
          const ib = JERARQUIA[b.cargo ?? ""] ?? 99;
          return ia !== ib ? ia - ib : a.apellido.localeCompare(b.apellido);
        });
      }

      // Requerimientos + días críticos en paralelo
      const engIds = [...engMap.keys()];
      if (engIds.length > 0) {
        const [{ data: reqData }, { data: dcData }, { data: actData }, { data: extData }] = await Promise.all([
          sb.from("requerimiento_engagement")
            .select("id, engagement_id, cargo_requerido, fecha_inicio, fecha_fin, pct_dedicacion")
            .in("engagement_id", engIds),
          sb.from("dia_critico")
            .select("engagement_id, fecha, fecha_fin, intensidad")
            .in("engagement_id", engIds)
            .order("created_at", { ascending: false }),
          (sb as any).from("engagement_actividades")
            .select("engagement_id, tipo, titulo, descripcion, fecha_inicio, fecha_fin")
            .in("engagement_id", engIds),
          (sb as any).from("engagement_extension")
            .select("id, engagement_id, fecha_inicio, fecha_fin")
            .in("engagement_id", engIds)
            .order("fecha_inicio"),
        ]);
        for (const ex of (extData ?? []) as any[]) {
          const eng = engMap.get(ex.engagement_id);
          if (eng) eng.extensiones.push({ id: ex.id, fecha_inicio: ex.fecha_inicio, fecha_fin: ex.fecha_fin });
        }
        for (const a of (actData ?? []) as any[]) {
          const eng = engMap.get(a.engagement_id);
          if (eng) eng.actividades.push({ tipo: a.tipo, titulo: a.titulo, descripcion: a.descripcion ?? null, fecha_inicio: a.fecha_inicio, fecha_fin: a.fecha_fin });
        }
        for (const r of (reqData ?? []) as any[]) {
          const eng = engMap.get(r.engagement_id);
          if (eng) eng.reqs.push({
            id: r.id, cargo_requerido: r.cargo_requerido,
            fecha_inicio: r.fecha_inicio, fecha_fin: r.fecha_fin,
            pct_dedicacion: Number(r.pct_dedicacion),
          });
        }
        const dcMap = new Map<string, DcEntry[]>();
        const seen = new Set<string>(); // deduplicar por engagement+fecha (ya ordenado desc → primero = más reciente)
        for (const dc of (dcData ?? []) as any[]) {
          const key = `${dc.engagement_id}|${dc.fecha}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (!dcMap.has(dc.engagement_id)) dcMap.set(dc.engagement_id, []);
          dcMap.get(dc.engagement_id)!.push({ fecha: dc.fecha, fecha_fin: dc.fecha_fin ?? null, intensidad: dc.intensidad ?? "rojo" });
        }
        setDiasCriticosMap(dcMap);
      }

      // Ordenar por sort_order (manual) primero, fallback alfabético
      setEngs([...engMap.values()].sort((a, b) => {
        if (a.sort_order !== null && b.sort_order !== null) return a.sort_order - b.sort_order;
        if (a.sort_order !== null) return -1;
        if (b.sort_order !== null) return 1;
        return a.nombre.localeCompare(b.nombre, "es");
      }));
      setAusencias((ausRes.data ?? []) as { persona_id: string; fecha_inicio: string; fecha_fin: string; tipo: string }[]);
      setLoading(false);
    }
    load();
  }, [inicioStr, finStr, lookbackStr, reloadKey, externalReloadKey]);

  async function abrirDetalleEng(eng: EngRow) {
    setEngModal(eng);
    setModalIndustria(null);
    if (eng.raw.industria_id) {
      const sb = createAnyClient();
      const { data } = await sb.from("cat_industria").select("nombre").eq("id", eng.raw.industria_id).single();
      setModalIndustria((data as any)?.nombre ?? null);
    }
  }

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        setEngModal(null);
      }
    }
    if (engModal) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [engModal]);

  function navAnterior() {
    if (vista === "dia")    setBaseInterna((b) => addDays(startOfISOWeek(b), -7));
    if (vista === "semana") setBaseInterna((b) => subWeeks(b, 5));
    if (vista === "mes")    setBaseInterna((b) => subMonths(b, 4));
  }
  function navSiguiente() {
    if (vista === "dia")    setBaseInterna((b) => addDays(startOfISOWeek(b), 7));
    if (vista === "semana") setBaseInterna((b) => addWeeks(b, 5));
    if (vista === "mes")    setBaseInterna((b) => addMonths(b, 4));
  }

  function refresh(focusId?: string) {
    // ── SIMULACIÓN: no re-fetch desde Supabase, preserva estado local ────
    if (simulationMode) return;
    // ─────────────────────────────────────────────────────────────────────
    if (focusId) focusEngIdRef.current = focusId;
    setReloadKey((k) => k + 1);
    onAsignacionChange?.();
    window.dispatchEvent(new CustomEvent("asignacionChanged"));
  }

  // Clic en avatar/barra → siempre abre ColaboradorModal unificado (tabs Asignación + Perfil)
  function handleAvatarClick(e: React.MouseEvent, p: PersonaAsig, eng: EngRow) {
    e.stopPropagation();
    if (readOnly) return; // Desarrollo: sin acceso a detalle
    setAsigModal({ persona: p, eng });
  }

  // Drop directo sobre el título del engagement — crea req + asignación CONFIRMADO automáticamente
  async function handleDropOnEngagement(e: React.DragEvent, eng: EngRow) {
    e.preventDefault();
    setDragOverEngId(null);
    if (readOnly) return;
    let data: { personaId: string; nombre: string; apellido: string; cargo_actual: string } | null = null;
    try { data = JSON.parse(e.dataTransfer.getData("persona")); } catch { return; }
    if (!data?.personaId) return;

    // ── SIMULACIÓN: delega al padre para validar ausencias antes de insertar ─
    if (simulationMode) {
      if (onSimDropRequest) {
        onSimDropRequest({
          engagementId: eng.id, reqId: "", personaId: data.personaId,
          nombre: data.nombre, apellido: data.apellido, cargo: data.cargo_actual ?? "",
          pct: 100,
          fechaInicio: eng.fecha_inicio,
          fechaFin: eng.fecha_fin ?? eng.fecha_inicio,
        });
      }
      return;
    }
    // ─────────────────────────────────────────────────────────────────────

    const sb = createAnyClient();
    const cargoRequerido = data.cargo_actual || null;

    // Busca req libre (sin asignación activa) con cargo coincidente
    const { data: reqsLibres } = await (sb as any)
      .from("requerimiento_engagement")
      .select("id, fecha_inicio, fecha_fin, cargo_requerido")
      .eq("engagement_id", eng.id)
      .eq("cargo_requerido", cargoRequerido ?? "");

    let reqId: string;
    let fechaInicio: string;
    let fechaFin: string;

    let reqMatch: any = null;
    if (reqsLibres && (reqsLibres as any[]).length > 0) {
      for (const r of reqsLibres as any[]) {
        const { count } = await (sb as any)
          .from("asignacion")
          .select("id", { count: "exact", head: true })
          .eq("requerimiento_id", r.id)
          .eq("estado", "activa");
        if ((count ?? 0) === 0) { reqMatch = r; break; }
      }
    }

    if (reqMatch) {
      // Reutiliza el req existente con sus fechas reales
      reqId = reqMatch.id;
      fechaInicio = reqMatch.fecha_inicio ?? eng.fecha_inicio;
      fechaFin = reqMatch.fecha_fin ?? eng.fecha_fin ?? eng.fecha_inicio;
    } else {
      // Crea req nuevo solo si no hay match libre
      fechaInicio = eng.fecha_inicio;
      fechaFin = eng.fecha_fin ?? eng.fecha_inicio;
      const { data: newReq, error: reqErr } = await (sb as any)
        .from("requerimiento_engagement")
        .insert({
          engagement_id: eng.id,
          cargo_requerido: cargoRequerido,
          fase_nombre: null,
          pct_dedicacion: 100,
          fecha_inicio: fechaInicio,
          fecha_fin: fechaFin,
          descripcion: null,
        })
        .select("id")
        .single();
      if (reqErr || !newReq) return;
      reqId = (newReq as any).id;
    }

    // Validar ausencias de la persona dentro del rango del engagement
    const { data: ausPersonaDrop } = await sb
      .from("ausencia")
      .select("fecha_inicio, fecha_fin")
      .eq("persona_id", data.personaId)
      .lte("fecha_inicio", fechaFin)
      .gte("fecha_fin", fechaInicio)
      .order("fecha_inicio");

    const baseInsert = {
      engagement_id: eng.id,
      requerimiento_id: reqId,
      persona_id: data.personaId,
      cargo_al_momento: cargoRequerido,
      pct_dedicacion: 100,
      estado: "activa",
      estado_staffing: "PLAN" as const,
    };

    const createdIds: string[] = [];
    if (!ausPersonaDrop || ausPersonaDrop.length === 0) {
      const { data: ins } = await (sb as any).from("asignacion").insert({ ...baseInsert, fecha_inicio: fechaInicio, fecha_fin: fechaFin }).select("id");
      if (ins) createdIds.push(...(ins as any[]).map((r: any) => r.id));
    } else {
      // Auto-split: segmentos sin ausencias
      const segments: { fecha_inicio: string; fecha_fin: string }[] = [];
      let cursor = fechaInicio;
      for (const aus of ausPersonaDrop as { fecha_inicio: string; fecha_fin: string }[]) {
        const segFin = format(addDays(new Date(aus.fecha_inicio + "T00:00:00"), -1), "yyyy-MM-dd");
        if (cursor <= segFin) segments.push({ fecha_inicio: cursor, fecha_fin: segFin });
        cursor = format(addDays(new Date(aus.fecha_fin + "T00:00:00"), 1), "yyyy-MM-dd");
      }
      if (cursor <= fechaFin) segments.push({ fecha_inicio: cursor, fecha_fin: fechaFin });

      // Bloqueo total: modal bloqueante
      if (segments.length === 0) {
        if (!reqMatch) await (sb as any).from("requerimiento_engagement").delete().eq("id", reqId);
        const ausItemsTotal: AusenciaItem[] = (ausPersonaDrop as { fecha_inicio: string; fecha_fin: string }[]).map((a) => ({
          fecha_inicio: a.fecha_inicio, fecha_fin: a.fecha_fin,
          dias: Math.round((new Date(a.fecha_fin + "T00:00:00").getTime() - new Date(a.fecha_inicio + "T00:00:00").getTime()) / 86400000) + 1,
        }));
        setAusenciaConfirmModal({ nombre: `${data.nombre} ${data.apellido}`.trim(), ausencias: ausItemsTotal, onConfirm: async () => setAusenciaConfirmModal(null), totalBloqueo: true });
        return;
      }

      // Ausencias parciales → modal de confirmación antes de insertar
      const nombre = `${data.nombre} ${data.apellido}`.trim();
      const ausItems: AusenciaItem[] = (ausPersonaDrop as { fecha_inicio: string; fecha_fin: string }[]).map((a) => ({
        fecha_inicio: a.fecha_inicio,
        fecha_fin: a.fecha_fin,
        dias: Math.round((new Date(a.fecha_fin + "T00:00:00").getTime() - new Date(a.fecha_inicio + "T00:00:00").getTime()) / 86400000) + 1,
      }));
      setAusenciaConfirmModal({
        nombre,
        ausencias: ausItems,
        onConfirm: async () => {
          for (const seg of segments) {
            const { data: ins } = await (sb as any).from("asignacion").insert({ ...baseInsert, ...seg }).select("id");
            if (ins) createdIds.push(...(ins as any[]).map((r: any) => r.id));
          }
          if (createdIds.length) pushUndo({ type: "staffear", engId: eng.id, label: `Staffear ${nombre}`, ids: createdIds });
          refresh(eng.id);
          setAusenciaConfirmModal(null);
        },
      });
      return; // espera confirmación del modal
    }

    // Registrar en undo stack
    if (createdIds.length) pushUndo({ type: "staffear", engId: eng.id, label: `Staffear ${data.nombre} ${data.apellido}`.trim(), ids: createdIds });
    refresh(eng.id);
  }

  // Drop de persona desde cuadrante EQUIPO sobre un slot vacío
  async function handleDrop(e: React.DragEvent, eng: EngRow, req: ReqData, forcePlan = false) {
    e.preventDefault();
    setDragOverReqId(null);
    if (readOnly) return;
    let data: { personaId: string; nombre: string; apellido: string; cargo_actual: string } | null = null;
    try { data = JSON.parse(e.dataTransfer.getData("persona")); } catch { return; }
    if (!data?.personaId) return;

    const sb = createAnyClient();
    const nombre = `${data.nombre} ${data.apellido}`.trim();

    // Consultar ausencias de la persona dentro del rango del requerimiento
    const { data: ausPersona } = await sb
      .from("ausencia")
      .select("fecha_inicio, fecha_fin")
      .eq("persona_id", data.personaId)
      .lte("fecha_inicio", req.fecha_fin ?? req.fecha_inicio)
      .gte("fecha_fin", req.fecha_inicio)
      .order("fecha_inicio");

    const baseInsert = {
      engagement_id: eng.id,
      requerimiento_id: req.id,
      persona_id: data.personaId,
      cargo_al_momento: data.cargo_actual,
      pct_dedicacion: req.pct_dedicacion,
      estado: "activa" as const,
      estado_staffing: (forcePlan ? "PLAN" : "CONFIRMADO") as "CONFIRMADO" | "PLAN",
    };

    const createdIdsReq: string[] = [];

    // ── SIMULACIÓN: delega al padre para validar ausencias antes de insertar ─
    if (simulationMode) {
      if (onSimDropRequest) {
        onSimDropRequest({
          engagementId: eng.id, reqId: req.id, personaId: data.personaId,
          nombre: data.nombre, apellido: data.apellido, cargo: data.cargo_actual ?? "",
          pct: req.pct_dedicacion ?? 100,
          fechaInicio: req.fecha_inicio,
          fechaFin: req.fecha_fin ?? req.fecha_inicio,
        });
      }
      return;
    }
    // ─────────────────────────────────────────────────────────────────────

    if (!ausPersona || ausPersona.length === 0) {
      // Sin ausencias: inserción normal
      const { data: ins } = await sb.from("asignacion").insert({
        ...baseInsert,
        fecha_inicio: req.fecha_inicio,
        fecha_fin: req.fecha_fin,
      }).select("id");
      if (ins) createdIdsReq.push(...(ins as any[]).map((r: any) => r.id));
    } else {
      // Auto-split: insertar segmentos libres entre ausencias
      const segments: { fecha_inicio: string; fecha_fin: string }[] = [];
      let cursor = req.fecha_inicio;
      const reqFin = req.fecha_fin ?? req.fecha_inicio;

      for (const aus of ausPersona as { fecha_inicio: string; fecha_fin: string }[]) {
        const ausIni = aus.fecha_inicio > cursor ? aus.fecha_inicio : cursor;
        const ausFin = aus.fecha_fin;
        // Segmento antes de la ausencia
        const segFin = format(addDays(new Date(ausIni + "T00:00:00"), -1), "yyyy-MM-dd");
        if (cursor <= segFin) segments.push({ fecha_inicio: cursor, fecha_fin: segFin });
        // Avanzar cursor al día siguiente del fin de la ausencia
        cursor = format(addDays(new Date(ausFin + "T00:00:00"), 1), "yyyy-MM-dd");
      }
      // Segmento final tras la última ausencia
      if (cursor <= reqFin) segments.push({ fecha_inicio: cursor, fecha_fin: reqFin });

      // Bloqueo total: modal bloqueante
      if (segments.length === 0) {
        const ausItemsTotal2: AusenciaItem[] = (ausPersona as { fecha_inicio: string; fecha_fin: string }[]).map((a) => ({
          fecha_inicio: a.fecha_inicio, fecha_fin: a.fecha_fin,
          dias: Math.round((new Date(a.fecha_fin + "T00:00:00").getTime() - new Date(a.fecha_inicio + "T00:00:00").getTime()) / 86400000) + 1,
        }));
        setAusenciaConfirmModal({ nombre, ausencias: ausItemsTotal2, onConfirm: async () => setAusenciaConfirmModal(null), totalBloqueo: true });
        return;
      }

      // Ausencias parciales → modal de confirmación
      const ausItems: AusenciaItem[] = (ausPersona as { fecha_inicio: string; fecha_fin: string }[]).map((a) => ({
        fecha_inicio: a.fecha_inicio,
        fecha_fin: a.fecha_fin,
        dias: Math.round((new Date(a.fecha_fin + "T00:00:00").getTime() - new Date(a.fecha_inicio + "T00:00:00").getTime()) / 86400000) + 1,
      }));
      setAusenciaConfirmModal({
        nombre,
        ausencias: ausItems,
        onConfirm: async () => {
          for (const seg of segments) {
            const { data: ins } = await sb.from("asignacion").insert({ ...baseInsert, ...seg }).select("id");
            if (ins) createdIdsReq.push(...(ins as any[]).map((r: any) => r.id));
          }
          if (createdIdsReq.length) pushUndo({ type: "staffear", engId: eng.id, label: `Staffear ${nombre}`, ids: createdIdsReq });
          refresh(eng.id);
          onOpenPanel?.(null);
          setAusenciaConfirmModal(null);
        },
      });
      return; // espera confirmación del modal
    }

    // Registrar en undo stack
    if (createdIdsReq.length) pushUndo({ type: "staffear", engId: eng.id, label: `Staffear ${nombre}`, ids: createdIdsReq });
    refresh(eng.id);
    onOpenPanel?.(null);
  }

  // Crea requerimiento para el período de extensión y asigna a personaId
  async function staffearEnExtension(
    eng: EngRow,
    cargo: string,
    ghost: PersonaAsig,
    personaId: string,
    cargoAlMomento: string
  ) {
    const extensionStart = format(addDays(new Date(ghost.fecha_fin + "T00:00:00"), 1), "yyyy-MM-dd");
    const extensionEnd = eng.fecha_fin ?? extensionStart;
    if (extensionStart > extensionEnd) return;

    const sb = createAnyClient();
    const cargoRequerido = cargo !== "Sin cargo" ? cargo : null;

    const { data: newReq, error: reqErr } = await (sb as any)
      .from("requerimiento_engagement")
      .insert({
        engagement_id: eng.id,
        cargo_requerido: cargoRequerido,
        fase_nombre: null,
        pct_dedicacion: ghost.pct,
        fecha_inicio: extensionStart,
        fecha_fin: extensionEnd,
        descripcion: null,
      })
      .select("id")
      .single();

    if (reqErr || !newReq) return;

    await (sb as any).from("asignacion").insert({
      engagement_id: eng.id,
      requerimiento_id: (newReq as any).id,
      persona_id: personaId,
      cargo_al_momento: cargoAlMomento || cargoRequerido,
      pct_dedicacion: ghost.pct,
      fecha_inicio: extensionStart,
      fecha_fin: extensionEnd,
      estado: "activa",
    });

    refresh(eng.id);
  }

  // Click en ghost → extiende a la misma persona
  async function handleGhostClick(eng: EngRow, cargo: string, ghost: PersonaAsig) {
    const key = `${eng.id}-${cargo}-${ghost.id}`;
    if (ghostLoading === key) return;
    setGhostLoading(key);
    await staffearEnExtension(eng, cargo, ghost, ghost.id, ghost.cargo ?? cargo);
    setGhostLoading(null);
  }

  // Drop sobre ghost → extiende a la persona arrastrada
  async function handleGhostDrop(e: React.DragEvent, eng: EngRow, cargo: string, ghost: PersonaAsig) {
    e.preventDefault();
    setDragOverGhostKey(null);
    let data: { personaId: string; nombre: string; apellido: string; cargo_actual: string } | null = null;
    try { data = JSON.parse(e.dataTransfer.getData("persona")); } catch { return; }
    if (!data?.personaId) return;
    await staffearEnExtension(eng, cargo, ghost, data.personaId, data.cargo_actual ?? cargo);
  }

  // Eliminar asignación (botón X en avatar)
  async function handleDesasignar(asignacionId: string, engId?: string) {
    setDesasignando(asignacionId);

    // ── SIMULACIÓN: eliminar del estado local únicamente ─────────────────
    if (simulationMode) {
      // Buscar datos de la persona en engs para poder revertir con undo
      let personaData: any = null;
      for (const eg of engs) {
        const p = eg.personas.find((p) => p.asignacionId === asignacionId);
        if (p) { personaData = { ...p, id: asignacionId, persona_id: p.id, engagement_id: eg.id, cargo_al_momento: p.cargo, pct_dedicacion: p.pct }; break; }
      }
      setEngs((prev) => prev.map((eg) =>
        engId && eg.id !== engId ? eg : {
          ...eg,
          personas: eg.personas.filter((p) => p.asignacionId !== asignacionId),
        }
      ));
      if (personaData) pushUndo({ type: "desasignar", engId: engId ?? personaData.engagement_id, label: "Desasignación", asig: personaData });
      setDesasignando(null);
      showToast("🗑️ [Simulación] Persona removida del escenario");
      return;
    }
    // ────────────────────────────────────────────────────────────────────

    const sb = createAnyClient();
    // Guardar datos antes de eliminar para permitir undo
    const { data: asigData } = await sb
      .from("asignacion")
      .select("engagement_id, requerimiento_id, persona_id, cargo_al_momento, pct_dedicacion, estado, estado_staffing, fecha_inicio, fecha_fin")
      .eq("id", asignacionId)
      .single();
    await sb.from("asignacion").delete().eq("id", asignacionId);
    if (asigData) {
      pushUndo({ type: "desasignar", engId: engId ?? asigData.engagement_id, label: "Desasignación", asig: asigData as any });
    }
    setDesasignando(null);
    refresh(engId);
  }

  // Mover engagement a papelera
  async function moverAPapelera(id: string) {
    // ── SIMULACIÓN: quitar engagement del estado local ───────────────────
    if (simulationMode) {
      setEngs((prev) => prev.filter((eg) => eg.id !== id));
      setConfirmPapeleraDesg(null);
      return;
    }
    // ────────────────────────────────────────────────────────────────────
    const sb2 = createAnyClient();
    await sb2.from("engagement").update({ is_deleted: true, deleted_at: new Date().toISOString() }).eq("id", id);
    setConfirmPapeleraDesg(null);
    refresh();
  }

  // Cierra quick-edit al clicar fuera
  useEffect(() => {
    if (!quickEdit) return;
    const handler = () => setQuickEdit(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [quickEdit]);

  // Sincroniza diasCriticosMap desde otras instancias sin reload completo
  useEffect(() => {
    const handler = (e: Event) => {
      const { engId, fecha, fecha_fin, intensidad, sourceId } = (e as CustomEvent).detail;
      if (sourceId === instanceId.current) return; // ignorar eventos propios
      setDiasCriticosMap((prev) => {
        const next = new Map(prev);
        const existing = (next.get(engId) ?? []).filter(
          (dc) => !(dc.fecha === fecha && (dc.fecha_fin ?? dc.fecha) === fecha_fin)
        );
        next.set(engId, [...existing, { fecha, fecha_fin, intensidad }]);
        return next;
      });
    };
    window.addEventListener("diaCriticoChanged", handler);
    return () => window.removeEventListener("diaCriticoChanged", handler);
  }, []);

  // ID del último engagement editado — para scroll post-reload
  const focusEngIdRef = useRef<string | null>(null);

  // Recarga al guardar cualquier engagement; captura el ID para el scroll posterior
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent).detail?.engagementId as string | undefined;
      if (id) focusEngIdRef.current = id;
      setReloadKey((k) => k + 1);
    };
    window.addEventListener("engagementChanged", handler);
    return () => window.removeEventListener("engagementChanged", handler);
  }, []);

  // Cuando el reload termina, expande y hace scroll al engagement editado
  useEffect(() => {
    if (loading) return;
    const id = focusEngIdRef.current ?? openEngagementId;
    if (!id) return;
    // Asegurar expansión
    setColapsados((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    const timer = setTimeout(() => {
      document.querySelector(`[data-eng-id="${id}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      focusEngIdRef.current = null; // limpiar tras el scroll
    }, 200);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Cursor global durante resize (persona o engagement)
  useEffect(() => {
    document.body.style.cursor = (resizing || resizingEng || movingEng) ? "ew-resize" : "";
    return () => { document.body.style.cursor = ""; };
  }, [resizing, resizingEng]);

  // Mouseup global: aplica MOVE completo de Engagement al soltar
  useEffect(() => {
    if (!movingEng) return;
    const onUp = async () => {
      const endIdx = moveEngHoverRef.current;
      if (endIdx !== null && endIdx !== movingEng.startColIdx) {
        const startCol = columnas[movingEng.startColIdx];
        const endCol   = columnas[endIdx];
        if (startCol && endCol) {
          const deltaDays = Math.round(
            (endCol.inicio.getTime() - startCol.inicio.getTime()) / 86400000
          );
          if (deltaDays !== 0) {
            const eng = movingEng.eng;
            const sb  = createAnyClient();
            const finField = (eng.raw as any).fecha_fin_real ? "fecha_fin_real" : "fecha_fin_estimada";
            const prevFin: string = (eng.raw as any)[finField] ?? eng.fecha_fin;
            const newInicio = format(addDays(new Date(eng.fecha_inicio + "T00:00:00"), deltaDays), "yyyy-MM-dd");
            const newFin    = format(addDays(new Date(prevFin        + "T00:00:00"), deltaDays), "yyyy-MM-dd");
            setUndoStack(s => [...s.slice(-2), {
              type: "move_eng" as const,
              engId: eng.id, label: `Mover "${eng.nombre}"`,
              prevInicio: eng.fecha_inicio, prevFin, finField,
            }]);
            // ── SIMULACIÓN: personas y reqs adoptan exactamente las fechas del engagement ──
            if (simulationMode) {
              setEngs((prev) => prev.map((eg) =>
                eg.id !== eng.id ? eg : {
                  ...eg, fecha_inicio: newInicio, fecha_fin: newFin,
                  raw: { ...(eg.raw as any), fecha_inicio: newInicio, [finField]: newFin },
                  personas: eg.personas.map((p) => ({ ...p, fecha_inicio: newInicio, fecha_fin: newFin })),
                  reqs:     eg.reqs.map((r)    => ({ ...r, fecha_inicio: newInicio, fecha_fin: newFin })),
                }
              ));
            } else {
              await (sb as any).from("engagement")
                .update({ fecha_inicio: newInicio, [finField]: newFin })
                .eq("id", eng.id);
              refresh(eng.id);
            }
            // ─────────────────────────────────────────────────────────────
          }
        }
      }
      movingEngActiveRef.current = false;
      setMovingEng(null);
      setMoveEngHoverIdx(null);
      moveEngHoverRef.current = null;
    };
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, [movingEng, columnas]);

  // Mouseup global: aplica resize de Engagement al soltar
  useEffect(() => {
    if (!resizingEng) return;
    const onUp = async () => {
      const idx = resizeEngHoverRef.current;
      if (idx !== null) {
        const col = columnas[idx];
        const newDate = resizingEng.edge === "start"
          ? format(col.inicio, "yyyy-MM-dd")
          : format(col.fin,    "yyyy-MM-dd");
        const sb = createAnyClient();
        // Determinar campo y fecha previa para undo
        const field = resizingEng.edge === "start"
          ? "fecha_inicio"
          : ((resizingEng.eng.raw as any).fecha_fin_real ? "fecha_fin_real" : "fecha_fin_estimada");
        const prevDate: string = (resizingEng.eng.raw as any)[field] ?? "";

        // ── SIMULACIÓN: personas y reqs adoptan exactamente las fechas del engagement ─
        if (simulationMode) {
          setEngs((prev) => prev.map((eg) => {
            if (eg.id !== resizingEng.eng.id) return eg;
            const nuevoInicio = field === "fecha_inicio" ? newDate : eg.fecha_inicio;
            const nuevoFin    = field !== "fecha_inicio"  ? newDate : (eg.fecha_fin ?? newDate);

            const personas = eg.personas.map((p) => ({ ...p, fecha_inicio: nuevoInicio, fecha_fin: nuevoFin }));
            const reqs     = eg.reqs.map((r)    => ({ ...r, fecha_inicio: nuevoInicio, fecha_fin: nuevoFin }));

            return {
              ...eg,
              fecha_inicio: nuevoInicio,
              fecha_fin:    nuevoFin,
              raw: { ...(eg.raw as any), [field]: newDate },
              personas,
              reqs,
            };
          }));
          if (prevDate) pushUndo({ type: "resize_eng", engId: resizingEng.eng.id, label: `Cambio fechas "${resizingEng.eng.nombre}"`, field, prevDate });
        } else {
          await (sb as any).from("engagement").update({ [field]: newDate }).eq("id", resizingEng.eng.id);
          if (prevDate) {
            setUndoStack(s => [...s.slice(-2), {
              type: "resize_eng" as const,
              engId: resizingEng.eng.id,
              label: `Cambio fechas "${resizingEng.eng.nombre}"`,
              field,
              prevDate,
            }]);
          }
          refresh(resizingEng.eng.id);
        }
        // ────────────────────────────────────────────────────────────────
      }
      resizingEngActiveRef.current = false;
      setResizingEng(null);
      resizeEngHoverRef.current = null;
    };
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, [resizingEng, columnas]);

  // Mouseup global: aplica resize al soltar
  useEffect(() => {
    if (!resizing) return;
    const onUp = async () => {
      const idx = resizeHoverRef.current;
      console.log("[resize] mouseup | edge:", resizing.edge, "| hoverIdx:", idx, "| asignacionId:", resizing.p.asignacionId);
      if (idx !== null) {
        const col = columnas[idx];
        const newDate = resizing.edge === "start"
          ? format(col.inicio, "yyyy-MM-dd")
          : format(col.fin, "yyyy-MM-dd");
        // ── SIMULACIÓN: actualiza fechas de persona en estado local ─────
        if (simulationMode) {
          const campo = resizing.edge === "start" ? "fecha_inicio" : "fecha_fin";
          const prevDate = resizing.p[campo as "fecha_inicio" | "fecha_fin"];
          setEngs((prev) => prev.map((eg) => ({
            ...eg,
            personas: eg.personas.map((p) =>
              p.asignacionId !== resizing.p.asignacionId ? p : { ...p, [campo]: newDate }
            ),
          })));
          if (prevDate) pushUndo({ type: "resize", engId: "", label: `Cambio fecha persona`, asignacionId: resizing.p.asignacionId, edge: resizing.edge, prevDate });
        } else {
        // ────────────────────────────────────────────────────────────────
        const sb = createAnyClient();
        // Guardar fecha original para undo antes de actualizar
        const { data: oldAsig, error: fetchErr } = await sb.from("asignacion")
          .select("fecha_inicio, fecha_fin, engagement_id")
          .eq("id", resizing.p.asignacionId)
          .single();
        if (fetchErr) console.error("[resize] Error al leer asignacion:", fetchErr, "| asignacionId:", resizing.p.asignacionId);
        const prevDate: string | null = oldAsig
          ? (resizing.edge === "start" ? (oldAsig as any).fecha_inicio : (oldAsig as any).fecha_fin)
          : null;
        const { error: updateErr } = await sb.from("asignacion")
          .update({ [resizing.edge === "start" ? "fecha_inicio" : "fecha_fin"]: format(newDate, "yyyy-MM-dd") })
          .eq("id", resizing.p.asignacionId);
        if (updateErr) console.error("[resize] Error al actualizar asignacion:", updateErr, "| asignacionId:", resizing.p.asignacionId, "| campo:", resizing.edge === "start" ? "fecha_inicio" : "fecha_fin", "| valor:", newDate);
        if (prevDate) {
          setUndoStack(s => [...s.slice(-2), {
            type: "resize" as const,
            engId: (oldAsig as any).engagement_id ?? "",
            label: "Ajuste de fechas",
            asignacionId: resizing.p.asignacionId,
            edge: resizing.edge,
            prevDate,
          }]);
        }
        refresh();
        } // fin else simulationMode
      }
      setResizing(null);
      setResizeHoverIdx(null);
      resizeHoverRef.current = null;
    };
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, [resizing, columnas]);

  function resolverIntensidad(eng: EngRow, col: Columna): string {
    const dcs = diasCriticosMap.get(eng.id) ?? [];
    const match = dcs.find((dc) => {
      const ini = new Date(dc.fecha + "T00:00:00");
      const fin = dc.fecha_fin ? new Date(dc.fecha_fin + "T00:00:00") : ini;
      return ini <= col.fin && fin >= col.inicio;
    });
    if (match) return match.intensidad;
    // Auto-verde: últimos 7 días del engagement
    if (eng.fecha_fin) {
      const finDate = new Date(eng.fecha_fin + "T00:00:00");
      if (col.inicio >= addDays(finDate, -7)) return "verde";
    }
    return "amarillo"; // default
  }

  async function aplicarIntensidad(fecha: string, fecha_fin: string, engId: string, intensidad: string) {
    // Capturar entrada previa para poder deshacer
    const prevEntry = (diasCriticosMap.get(engId) ?? []).find(
      (dc) => dc.fecha === fecha && (dc.fecha_fin ?? fecha) === fecha_fin
    ) ?? null;
    // Actualización optimista: el color cambia de inmediato en esta instancia
    setDiasCriticosMap((prev) => {
      const next = new Map(prev);
      const existing = (next.get(engId) ?? []).filter(
        (dc) => !(dc.fecha === fecha && (dc.fecha_fin ?? fecha) === fecha_fin)
      );
      next.set(engId, [...existing, { fecha, fecha_fin, intensidad }]);
      return next;
    });
    setQuickEdit(null);
    pushUndo({ type: "color_semana", engId, label: `Color semana ${fecha}`, fecha, fecha_fin, prevEntry });
    // ── SIMULACIÓN: el update optimista ya se aplicó arriba, no persiste en DB ─
    if (simulationMode) { onSimDirty?.(); return; }
    // ─────────────────────────────────────────────────────────────────────────
    // Persiste en DB: reemplaza cualquier registro previo para ese engagement+fecha
    const sb2 = createAnyClient();
    const { error: delErr } = await sb2.from("dia_critico").delete().eq("engagement_id", engId).eq("fecha", fecha);
    if (delErr) console.error("[dia_critico] delete error:", delErr);
    const { error: insErr } = await sb2.from("dia_critico").insert({ engagement_id: engId, fecha, fecha_fin, intensidad });
    if (insErr) console.error("[dia_critico] insert error:", insErr);
    // Notifica a otras instancias (no a esta — el optimistic update ya se aplicó arriba)
    window.dispatchEvent(new CustomEvent("diaCriticoChanged", { detail: { engId, fecha, fecha_fin, intensidad, sourceId: instanceId.current } }));
  }

  /**
   * Simulación: ajusta las fechas de PersonaAsig de un engagement
   * para que queden dentro del nuevo rango [nuevoInicio, nuevoFin].
   * - Si la persona empieza antes del nuevo inicio → se recorta al nuevo inicio.
   * - Si la persona termina después del nuevo fin → se recorta al nuevo fin.
   * - Si el engagement se desplazó (deltaDays != null) → se desplazan sus fechas.
   */
  function ajustarPersonasAlEngagement(
    egId: string,
    nuevoInicio: string,
    nuevoFin: string,
    deltaDays: number | null = null
  ) {
    setEngs((prev) => prev.map((eg) => {
      if (eg.id !== egId) return eg;
      const personas = eg.personas.map((p) => {
        let ini = deltaDays !== null
          ? format(addDays(new Date(p.fecha_inicio + "T00:00:00"), deltaDays), "yyyy-MM-dd")
          : p.fecha_inicio;
        let fin = deltaDays !== null
          ? format(addDays(new Date(p.fecha_fin + "T00:00:00"), deltaDays), "yyyy-MM-dd")
          : p.fecha_fin;
        // Recortar dentro del nuevo rango del engagement
        if (ini < nuevoInicio) ini = nuevoInicio;
        if (fin > nuevoFin)    fin = nuevoFin;
        return ini > fin ? null : { ...p, fecha_inicio: ini, fecha_fin: fin };
      }).filter(Boolean) as typeof eg.personas;
      return { ...eg, personas };
    }));
  }

  const hoy = new Date();

  return (
    <div className="flex flex-col h-full relative">
      {/* Toast de alertas staffing */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] max-w-lg w-full px-4">
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-300 text-amber-900 rounded-xl shadow-lg px-4 py-3 text-sm">
            <span className="text-amber-500 text-base leading-none mt-0.5">⚠</span>
            <p className="flex-1 leading-snug">{toast}</p>
            <button onClick={() => setToast(null)} className="text-amber-400 hover:text-amber-600 leading-none text-base font-bold">×</button>
          </div>
        </div>
      )}
      {/* Barra de controles — se oculta cuando la navegación es controlada externamente */}
      <div className="flex flex-col gap-1.5 mb-3 flex-shrink-0">
        {/* Fila 1: acciones principales + Resumen */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {!readOnly && <button
              onClick={() => { setEngToEdit(undefined); setFormOpen(true); }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white transition-colors hover:opacity-90"
              style={{ background: "#4a90e2" }}
            >
              <Plus className="w-3 h-3" />
              Nuevo proyecto
            </button>}
            {engs.length > 0 && (
              <button
                onClick={colapsados.size === engs.length ? expandirTodos : colapsarTodos}
                className="text-[11px] px-2.5 py-1 rounded-lg border border-gray-100 text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
              >
                {colapsados.size === engs.length ? "Expandir todos" : "Colapsar todos"}
              </button>
            )}
            {/* Botón Deshacer */}
            <button
              onClick={handleUndo}
              disabled={!undoStack.length || undoing}
              title={undoStack.length ? `Deshacer: ${undoStack[undoStack.length - 1]?.label}` : "Sin acciones para deshacer"}
              className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg border border-gray-100 text-gray-400 hover:text-[#4a90e2] hover:border-[#4a90e2]/30 hover:bg-blue-50 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-400 disabled:hover:border-gray-100 transition-all"
            >
              {undoing
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <RotateCcw className="w-3 h-3" />}
              <span>Deshacer{undoStack.length > 1 ? ` (${undoStack.length})` : ""}</span>
            </button>
          </div>
          {/* Resumen — oculto en readOnly */}
          {!readOnly && <Link
            href="/reportes/resumen-proyectos"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-gray-200 text-[10px] text-gray-400 hover:text-[#4a90e2] hover:border-[#4a90e2]/40 hover:bg-blue-50 transition-all"
          >
            <BarChart2 className="w-2.5 h-2.5" />
            <span>Resumen</span>
          </Link>}
        </div>
        {/* Fila 2: buscador + controles de vista */}
        <div className="flex items-center justify-between">
          {/* Buscador multi-criterio */}
          <div className="relative flex items-center">
            <Search className="absolute left-2 w-3 h-3 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por proyecto, código, cliente o persona..."
              className="pl-6 pr-2.5 py-1 text-[11px] rounded-lg border border-gray-200 bg-white text-gray-700 placeholder-gray-400 focus:outline-none focus:border-[#4a90e2] focus:ring-1 focus:ring-[#4a90e2]/30 w-64 transition-all"
            />
          </div>
          {/* Controles internos: solo visibles cuando no hay control externo */}
          {!vistaExterna && (
            <div className="flex items-center gap-1">
              <div className="flex rounded-md overflow-hidden border border-gray-100 text-[11px] font-semibold">
                {(["dia", "semana", "mes"] as Vista[]).map((v) => (
                  <button key={v} onClick={() => setVistaInterna(v)}
                    className="px-2.5 py-1 transition-colors"
                    style={vistaInterna === v ? { background: "#4a90e2", color: "#fff" } : { background: "#f9f9f9", color: "#888" }}>
                    {v === "dia" ? "Día" : v === "semana" ? "Semana" : "Mes"}
                  </button>
                ))}
              </div>
              <button onClick={navAnterior} className="p-1 rounded hover:bg-gray-100 text-gray-400">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button onClick={navSiguiente} className="p-1 rounded hover:bg-gray-100 text-gray-400">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-300">Cargando...</p>
      ) : engs.length === 0 ? (
        <p className="text-sm text-gray-300 italic">Sin engagements activos en este período.</p>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs border-collapse"
            style={{ minWidth: `${110 + columnas.length * 52}px`, tableLayout: "fixed" }}>
            {/* colgroup: fija col proyecto y distribuye el resto en partes iguales */}
            <colgroup>
              <col style={{ width: 110 }} />
              {columnas.map((_, i) => <col key={i} />)}
            </colgroup>
            <thead className="sticky top-0 bg-white z-20">
              <tr>
                <th className="text-left pr-2 pb-1.5 text-gray-400 font-semibold sticky left-0 bg-white z-30">
                  Proyecto
                </th>
                {columnas.map((col, i) => {
                  const esHoy = col.inicio <= hoy && hoy <= col.fin;
                  return (
                    <th key={i} className="text-center pb-1.5 font-semibold"
                      style={{ color: esHoy ? "#4a90e2" : "#aaa" }}>
                      <div className="capitalize">{col.label}</div>
                      <div className="font-normal text-[10px]">{col.sublabel}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {[
                { tipo: "proyecto",      label: "Proyectos",              color: "#4a90e2" },
                { tipo: "propuesta",     label: "Propuestas comerciales", color: "#9b59b6" },
                { tipo: "ayuda_interna", label: "Desarrollo interno",          color: "#27ae60" },
              ].flatMap(({ tipo, label, color: secColor }) => {
                const q = searchTerm.toLowerCase().trim();
                const lista = engs.filter((e) => {
                  if (e.tipo !== tipo) return false;
                  if (!q) return true;
                  if (e.nombre.toLowerCase().includes(q)) return true;
                  if (e.codigo?.toLowerCase().includes(q)) return true;
                  if (e.cliente?.toLowerCase().includes(q)) return true;
                  return e.personas.some((p) => {
                    const fullName = `${p.nombre} ${p.apellido}`.toLowerCase();
                    const initials = `${p.nombre.charAt(0)}${p.apellido.charAt(0)}`.toLowerCase();
                    return fullName.includes(q) || initials.includes(q);
                  });
                });
                if (lista.length === 0) return [];

                const filaSeccion = (
                  <tr key={`sec-${tipo}`}>
                    <td colSpan={columnas.length + 1} className="pt-2 pb-0.5">
                      <div className="flex items-center gap-2">
                        <div className="w-1 h-4 rounded-full flex-shrink-0" style={{ background: secColor }} />
                        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: secColor }}>{label}</span>
                        <span className="text-[10px] text-gray-300">{lista.length}</span>
                        <div className="flex-1 h-0.5 rounded-full" style={{ background: secColor, opacity: 0.35 }} />
                      </div>
                    </td>
                  </tr>
                );

                const filasEngs = lista.flatMap((eng, ei) => {
                  const estaColapsado = colapsados.has(eng.id);

                  // cargo normalizado: si la persona no tiene cargo propio, usa el del requerimiento
                  // Esto evita filas "Sin cargo" (vacías) cuando el cargo viene del req, no del perfil
                  const getPersonaCargo = (p: PersonaAsig): string => {
                    if (p.cargo?.trim()) return normalizeCargoDisplay(p.cargo.trim());
                    if (p.requerimiento_id) {
                      const req = eng.reqs.find((r) => r.id === p.requerimiento_id);
                      if (req?.cargo_requerido?.trim()) return normalizeCargoDisplay(req.cargo_requerido.trim());
                    }
                    return "Sin cargo";
                  };

                  // Agrupa TODOS los segmentos de un mismo colaborador (caso: auto-split por ausencias
                  // crea múltiples asignacion records para la misma persona → evita filas fantasma).
                  // segsPersona: personaId → todos sus segmentos de asignación en este engagement.
                  const segsPersona = new Map<string, PersonaAsig[]>();
                  for (const p of eng.personas.filter((p) => p?.id)) {
                    if (!segsPersona.has(p.id)) segsPersona.set(p.id, []);
                    segsPersona.get(p.id)!.push(p);
                  }
                  // Una sola entrada representativa por persona (usa el primer segmento)
                  const personasUnicas = Array.from(segsPersona.values()).map((segs) => segs[0]);

                  // Cargos desde personas asignadas (deduplicadas)
                  const cargosPersonas = new Set(personasUnicas.map(getPersonaCargo));

                  // Cargos de reqs sin persona asignada aún.
                  // NO filtramos por fecha aquí: el engagement ya pasó el filtro de fecha;
                  // sus reqs siempre deben ser visibles como filas vacías (drop-zone).
                  // La actividad por celda se controla en la renderización con rangoSolapan.
                  const cargosDeReqs = Array.from(new Set(
                    eng.reqs
                      .filter((r) =>
                        r.cargo_requerido?.trim() &&
                        !cargosPersonas.has(normalizeCargoDisplay(r.cargo_requerido.trim()))
                      )
                      .map((r) => normalizeCargoDisplay(r.cargo_requerido!.trim()))
                  ));

                  // Unión ordenada — personas primero, reqs vacíos al final según jerarquía
                  const cargosUnicos = Array.from(new Set([...cargosPersonas, ...cargosDeReqs]))
                    .sort((a, b) => (JERARQUIA[a] ?? 99) - (JERARQUIA[b] ?? 99));

                  // personaIdsEng: TODOS los ids (incluye lookback de 90 días → ghost circles)
                  const personaIdsEng = new Set(personasUnicas.map((p) => p.id));

                  // personasActivasIds: SOLO personas con asignación que solapa la vista actual.
                  // Se usa exclusivamente en "Ausentes" para evitar badges huérfanos de personas
                  // que ya terminaron su asignación pero siguen en eng.personas por el lookback.
                  const vistaInicio = columnas[0].inicio;
                  const vistaFin    = columnas[columnas.length - 1].fin;
                  const personasActivasIds = new Set(
                    eng.personas
                      .filter((p) => rangoSolapan(p.fecha_inicio, p.fecha_fin, vistaInicio, vistaFin))
                      .map((p) => p.id)
                  );

                  // Separador entre engagements — también actúa como zona de drop para reordenar
                  const isDragSep = dragOverEngSortId === eng.id;
                  const separador = ei > 0 ? (
                    <tr key={`sep-${eng.id}`}
                      onDragOver={(e) => { e.preventDefault(); setDragOverEngSortId(eng.id); }}
                      onDragLeave={() => setDragOverEngSortId(null)}
                      onDrop={(e) => { e.preventDefault(); if (draggingEngId) handleEngReorder(draggingEngId, eng.id); setDraggingEngId(null); setDragOverEngSortId(null); }}>
                      <td colSpan={columnas.length + 1} className="py-0.5">
                        <div className={`border-t-2 transition-colors duration-100 ${isDragSep ? "border-blue-400" : "border-gray-100"}`} />
                      </td>
                    </tr>
                  ) : null;

                  const filaHdr = (
                    <tr key={`hdr-${eng.id}`} data-eng-id={eng.id}
                      draggable={!readOnly}
                      onDragStart={(e) => { if (readOnly || movingEngActiveRef.current || resizingEngActiveRef.current) { e.preventDefault(); return; } setDraggingEngId(eng.id); e.dataTransfer.effectAllowed = "move"; }}
                      onDragEnd={() => { setDraggingEngId(null); setDragOverEngSortId(null); }}
                      style={{ opacity: draggingEngId === eng.id ? 0.45 : 1, transition: "opacity 0.15s" }}>
                      <td className="pt-1 pb-0.5 sticky left-0 bg-white z-10" style={{ width: 110, maxWidth: 110 }}>
                        {/* relative+overflow-hidden: los botones de acción son absolute y no afectan el ancho */}
                        <div className="relative flex items-center gap-0.5 group overflow-hidden">
                          {/* Grip — oculto en readOnly */}
                          {!readOnly && <span title="Arrastrar para reordenar">
                            <GripVertical className="w-3 h-3 flex-shrink-0 text-gray-200 group-hover:text-gray-400 cursor-grab transition-colors" />
                          </span>}
                          <button
                            onClick={() => toggleColapso(eng.id)}
                            title={estaColapsado ? "Expandir" : "Colapsar"}
                            className="p-0.5 rounded text-gray-300 hover:text-gray-500 transition-colors flex-shrink-0"
                          >
                            {estaColapsado
                              ? <ChevronRight className="w-3 h-3" />
                              : <ChevronDown className="w-3 h-3" />}
                          </button>
                          <div className="flex-1 min-w-0 overflow-hidden">
                            <button
                              onClick={() => abrirDetalleEng(eng)}
                              className="font-bold text-[#1a1a2e] truncate w-full text-[11px] text-left hover:text-[#4a90e2] hover:underline transition-colors block"
                              title={eng.codigo ? `${eng.codigo}: ${eng.nombre}` : eng.nombre}
                            >
                              {eng.codigo ? `${eng.codigo}: ${eng.nombre}` : eng.nombre}
                            </button>
                            {eng.cliente && <p className="text-[10px] text-gray-400 truncate w-full">{eng.cliente}</p>}
                          </div>
                          {/* Botones acción: ocultos en readOnly */}
                          {!readOnly && (
                          <div className="absolute right-0 top-0 bottom-0 flex items-center gap-0.5 bg-white pl-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => { prevReqsForUndoRef.current = eng.reqs ?? []; setEngToEdit(eng.raw); setReqsToEdit(eng.reqs ?? []); setActividadesToEdit(eng.actividades ?? []); setFormOpen(true); }}
                              title="Editar"
                              className="p-0.5 rounded hover:bg-gray-100 text-gray-400">
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => setConfirmPapeleraDesg({ id: eng.id, nombre: eng.nombre })}
                              title="Papelera"
                              className="p-0.5 rounded hover:bg-red-50 text-gray-300 hover:text-red-400">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                          )}
                        </div>
                      </td>
                      {columnas.map((col, i) => {
                        const esHoy = col.inicio <= hoy && hoy <= col.fin;
                        const activo  = engActivoEnCol(eng, col.inicio, col.fin);
                        const enBrecha = !activo && engEnBrechaEnCol(eng, col.inicio, col.fin);
                        const isDragTarget = dragOverEngId === eng.id;

                        if (!activo && !enBrecha) return (
                          <td key={i} className="py-1 px-1"
                            onMouseEnter={() => { if (resizingEng) resizeEngHoverRef.current = i; if (movingEng?.eng.id === eng.id) { moveEngHoverRef.current = i; setMoveEngHoverIdx(i); } }}
                            onDragOver={(ev) => { ev.preventDefault(); setDragOverEngId(eng.id); }}
                            onDragLeave={() => setDragOverEngId(null)}
                            onDrop={(ev) => handleDropOnEngagement(ev, eng)} />
                        );

                        // Celda de brecha: proyecto "dormido" entre fin original e inicio de extensión
                        if (enBrecha) return (
                          <td key={i} className="py-1 px-1"
                            onDragOver={(ev) => { ev.preventDefault(); setDragOverEngId(eng.id); }}
                            onDragLeave={() => setDragOverEngId(null)}
                            onDrop={(ev) => handleDropOnEngagement(ev, eng)}>
                            <div className="h-5 rounded-full" style={{ background: `${eng.raw.color ?? "#f59e0b"}22`, border: `1.5px dashed ${eng.raw.color ?? "#f59e0b"}66` }} title="Proyecto en pausa" />
                          </td>
                        );

                        const intensidad = resolverIntensidad(eng, col);
                        // Rojo: mantiene color base (amber) + borde cortado rojo. Verde/amarillo: color propio.
                        const esRojo    = intensidad === "rojo";
                        const barColor  = esRojo ? "#f59e0b" : (INTENSIDAD_COLOR[intensidad] ?? "#f59e0b");
                        const rojoOutline: React.CSSProperties = esRojo
                          ? { outline: "2px dashed #ef4444", outlineOffset: "-1px" }
                          : {};
                        // Actividades que solapan esta columna
                        const colInicioStr = format(col.inicio, "yyyy-MM-dd");
                        const colFinStr    = format(col.fin,    "yyyy-MM-dd");
                        const actCol = eng.actividades.filter(
                          (a) => a.fecha_inicio <= colFinStr && a.fecha_fin >= colInicioStr
                        );
                        const tieneViaje  = actCol.some((a) => a.tipo === "Viajes");
                        const tieneTaller = actCol.some((a) => a.tipo === "Taller");
                        // Textos para tooltips nativos (title HTML — sin interferir con clicks)
                        const tallerTip = actCol.filter((a) => a.tipo === "Taller").map((a) => `Taller: ${a.titulo}${a.descripcion ? ` — ${a.descripcion}` : ""}`).join("\n");
                        const viajeTip  = actCol.filter((a) => a.tipo === "Viajes").map((a) => `Viaje: ${a.titulo}${a.descripcion ? ` — ${a.descripcion}` : ""}`).join("\n");
                        // Detecta bordes del engagement para colocar manillas de resize
                        const prevColE = columnas[i - 1];
                        const nextColE = columnas[i + 1];
                        const isEngFirst = !prevColE || !engActivoEnCol(eng, prevColE.inicio, prevColE.fin);
                        const isEngLast  = !nextColE || !engActivoEnCol(eng, nextColE.inicio, nextColE.fin);

                        // Preview visual del move: calcula si esta col estaría activa tras el desplazamiento
                        const movePreviewActive = movingEng?.eng.id === eng.id && moveEngHoverIdx !== null && (() => {
                          const delta = Math.round((columnas[moveEngHoverIdx]?.inicio.getTime() - columnas[movingEng.startColIdx]?.inicio.getTime()) / 86400000);
                          if (!delta) return false;
                          const pi = format(addDays(new Date(eng.fecha_inicio + "T00:00:00"), delta), "yyyy-MM-dd");
                          const pf = eng.fecha_fin ? format(addDays(new Date(eng.fecha_fin + "T00:00:00"), delta), "yyyy-MM-dd") : null;
                          const extShifted = eng.extensiones.map((ex) => ({
                            id: ex.id,
                            fecha_inicio: format(addDays(new Date(ex.fecha_inicio + "T00:00:00"), delta), "yyyy-MM-dd"),
                            fecha_fin: format(addDays(new Date(ex.fecha_fin + "T00:00:00"), delta), "yyyy-MM-dd"),
                          }));
                          return engActivoEnCol({ fecha_inicio: pi, fecha_fin: pf, extensiones: extShifted }, col.inicio, col.fin);
                        })();

                        if (!estaColapsado) {
                          return (
                            <td key={i} className="py-1 px-1"
                              style={{ background: movePreviewActive ? "#dbeafe55" : isDragTarget ? "#dbeafe" : undefined, borderRadius: 6, transition: "background 0.15s" }}
                              onMouseEnter={() => { if (resizingEng) resizeEngHoverRef.current = i; if (movingEng?.eng.id === eng.id) { moveEngHoverRef.current = i; setMoveEngHoverIdx(i); } }}
                              onDragOver={(ev) => { ev.preventDefault(); setDragOverEngId(eng.id); }}
                              onDragLeave={() => setDragOverEngId(null)}
                              onDrop={(ev) => handleDropOnEngagement(ev, eng)}>
                              <div
                                className="relative h-5 rounded-full transition-all overflow-visible group/engbar"
                                style={{ background: barColor, ...rojoOutline, opacity: esHoy ? 1 : 0.5, cursor: movingEng?.eng.id === eng.id ? "grabbing" : "grab", ...(tieneViaje ? { border: "3px solid #92400e" } : tieneTaller ? { border: "3px solid #2563eb" } : {}) }}
                                title={readOnly ? "" : "Arrastra para mover · Borde para redimensionar · Clic para intensidad"}
                                onMouseDown={(ev) => {
                                  if (readOnly) return;
                                  ev.stopPropagation();
                                  movingEngActiveRef.current = true;
                                  setMovingEng({ eng, startColIdx: i });
                                  moveEngHoverRef.current = i;
                                  setMoveEngHoverIdx(i);
                                }}
                                onClick={(ev) => {
                                  if (readOnly) return;
                                  if (movingEng) return;
                                  ev.stopPropagation();
                                  setQuickEdit({ engId: eng.id, fecha: format(col.inicio, "yyyy-MM-dd"), fecha_fin: format(col.fin, "yyyy-MM-dd"), x: ev.clientX, y: ev.clientY });
                                }}>
                                {tieneTaller && (
                                  <div className="group/tip absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-auto">
                                    <Diamond className="w-5 h-5 text-blue-600 fill-sky-200 cursor-default" />
                                    <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-slate-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-[9999] opacity-0 group-hover/tip:opacity-100 transition-opacity duration-200 shadow-lg">
                                      {tallerTip}
                                    </div>
                                  </div>
                                )}
                                {tieneViaje && (
                                  <div className="group/tip absolute top-0.5 right-1 z-10 pointer-events-auto">
                                    <Plane className="w-3 h-3 cursor-default" style={{ color: "#92400e" }} />
                                    <div className="pointer-events-none absolute bottom-full right-0 mb-2 bg-slate-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-[9999] opacity-0 group-hover/tip:opacity-100 transition-opacity duration-200 shadow-lg">
                                      {viajeTip}
                                    </div>
                                  </div>
                                )}
                                {!readOnly && isEngFirst && <div onMouseDown={(ev) => { ev.stopPropagation(); resizingEngActiveRef.current = true; setResizingEng({ eng, edge: "start" }); resizeEngHoverRef.current = i; }} className="absolute left-0 top-0 bottom-0 w-4 cursor-ew-resize z-20 rounded-l-full hover:bg-white/40 transition-colors" />}
                                {!readOnly && isEngLast  && <div onMouseDown={(ev) => { ev.stopPropagation(); resizingEngActiveRef.current = true; setResizingEng({ eng, edge: "end"   }); resizeEngHoverRef.current = i; }} className="absolute right-0 top-0 bottom-0 w-4 cursor-ew-resize z-20 rounded-r-full hover:bg-white/40 transition-colors" />}
                              </div>
                            </td>
                          );
                        }

                        return (
                          <td key={i} className="py-1 px-0.5"
                            style={{ background: movePreviewActive ? "#dbeafe55" : isDragTarget ? "#dbeafe" : undefined, borderRadius: 6, transition: "background 0.15s" }}
                            onMouseEnter={() => { if (resizingEng) resizeEngHoverRef.current = i; if (movingEng?.eng.id === eng.id) { moveEngHoverRef.current = i; setMoveEngHoverIdx(i); } }}
                            onDragOver={(ev) => { ev.preventDefault(); setDragOverEngId(eng.id); }}
                            onDragLeave={() => setDragOverEngId(null)}
                            onDrop={(ev) => handleDropOnEngagement(ev, eng)}>
                            <div
                              className="relative h-7 rounded-full hover:opacity-100 transition-opacity overflow-visible group/engbar"
                              style={{ background: barColor, ...rojoOutline, opacity: movePreviewActive ? 1 : isDragTarget ? 1 : esHoy ? 1 : 0.75, cursor: movingEng?.eng.id === eng.id ? "grabbing" : "grab", ...(tieneViaje ? { border: "3px solid #92400e" } : tieneTaller ? { border: "3px solid #2563eb" } : {}) }}
                              title="Arrastra para mover · Borde para redimensionar · Clic para intensidad"
                              onMouseDown={(ev) => {
                                ev.stopPropagation();
                                movingEngActiveRef.current = true;
                                setMovingEng({ eng, startColIdx: i });
                                moveEngHoverRef.current = i;
                                setMoveEngHoverIdx(i);
                              }}
                              onClick={(ev) => {
                                if (movingEng) return;
                                ev.stopPropagation();
                                setQuickEdit({ engId: eng.id, fecha: format(col.inicio, "yyyy-MM-dd"), fecha_fin: format(col.fin, "yyyy-MM-dd"), x: ev.clientX, y: ev.clientY });
                              }}>
                              {tieneTaller && (
                                <div className="group/tip absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-auto">
                                  <Diamond className="w-6 h-6 text-blue-600 fill-sky-200 cursor-default" />
                                  <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-slate-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-[9999] opacity-0 group-hover/tip:opacity-100 transition-opacity duration-200 shadow-lg">
                                    {tallerTip}
                                  </div>
                                </div>
                              )}
                              {tieneViaje && (
                                <div className="group/tip absolute top-1 right-1.5 z-10 pointer-events-auto">
                                  <Plane className="w-3.5 h-3.5 cursor-default" style={{ color: "#92400e" }} />
                                  <div className="pointer-events-none absolute bottom-full right-0 mb-2 bg-slate-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-[9999] opacity-0 group-hover/tip:opacity-100 transition-opacity duration-200 shadow-lg">
                                    {viajeTip}
                                  </div>
                                </div>
                              )}
                              {isEngFirst && <div onMouseDown={(ev) => { ev.stopPropagation(); resizingEngActiveRef.current = true; setResizingEng({ eng, edge: "start" }); resizeEngHoverRef.current = i; }} className="absolute left-0 top-0 bottom-0 w-4 cursor-ew-resize z-20 rounded-l-full hover:bg-white/30 transition-colors" />}
                              {isEngLast  && <div onMouseDown={(ev) => { ev.stopPropagation(); resizingEngActiveRef.current = true; setResizingEng({ eng, edge: "end"   }); resizeEngHoverRef.current = i; }} className="absolute right-0 top-0 bottom-0 w-4 cursor-ew-resize z-20 rounded-r-full hover:bg-white/30 transition-colors" />}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );

                  // ── Fila unificada: label siempre presente, sin rowSpan ──────────
                  // Garantiza simetría matemática: CADA fila tiene exactamente
                  // la misma estructura (label col + date cols) con altura fija ROW_H.
                  const filasCargo = cargosUnicos.flatMap((cargo) => {
                    // Usa personasUnicas → 1 entrada por colaborador aunque haya múltiples segmentos.
                    // Si personas.length === 0 → cargo viene de un req nuevo sin asignar → muestra fila EMPTY
                    // como zona de drag-and-drop (comportamiento correcto, NO se corta con return []).
                    const personas = personasUnicas.filter((p) => getPersonaCargo(p) === cargo);
                    const cargoColor = COLORES[cargo] ?? COLOR_DEFAULT;
                    const confirmados = personas.filter((p) => p.estado_staffing === "CONFIRMADO");
                    const planesAll   = personas.filter((p) => p.estado_staffing === "PLAN");
                    const ROW_H  = 20;                       // altura fija para TODAS las filas
                    // última categoría del engagement → cierra con dashed inferior (separa de "Ausentes")
                    const isLastCargo = cargo === cargosUnicos[cargosUnicos.length - 1];

                    // barEdge usa TODOS los segmentos de la persona para detectar bordes correctamente
                    const barEdge = (pa: PersonaAsig, colIdx: number) => {
                      const allSegs = segsPersona.get(pa.id) ?? [pa];
                      const prev = columnas[colIdx - 1];
                      const next = columnas[colIdx + 1];
                      return {
                        isFirst: !prev || !allSegs.some((s) => rangoSolapan(s.fecha_inicio, s.fecha_fin, prev.inicio, prev.fin)),
                        isLast:  !next || !allSegs.some((s) => rangoSolapan(s.fecha_inicio, s.fecha_fin, next.inicio, next.fin)),
                      };
                    };

                    // Lista unificada: primero CONF, luego PLAN, mínimo 1 fila vacía
                    type RowKind = "CONF" | "PLAN" | "EMPTY";
                    const unifiedRows: { p: PersonaAsig | null; kind: RowKind }[] = [
                      ...confirmados.map((p) => ({ p, kind: "CONF" as const })),
                      ...planesAll.map((p)   => ({ p, kind: "PLAN" as const })),
                    ];
                    if (unifiedRows.length === 0) unifiedRows.push({ p: null, kind: "EMPTY" });

                    return unifiedRows.map(({ p, kind }, rowIdx) => {
                      const isFirstRow  = rowIdx === 0;
                      const isLastRow   = rowIdx === unifiedRows.length - 1;
                      // dashed solo al inicio del bloque; sin líneas entre personas del mismo cargo
                      const borderTopRow = isFirstRow ? "1px dashed #e2e8f0" : undefined;
                      // dashed inferior solo en la última fila del último cargo (divide con "Ausentes")
                      const borderBtmRow = isLastCargo && isLastRow ? "1px dashed #e2e8f0" : undefined;

                      return (
                        <tr key={`urow-${eng.id}-${cargo}-${rowIdx}`}>
                          {/* Label: texto real en fila 0, invisible en el resto (mismo espacio, simetría exacta) */}
                          <td className="py-0 sticky left-0 bg-white z-10 border-r border-gray-100"
                            style={{ width: 70, minWidth: 70, height: ROW_H, borderTop: borderTopRow, borderBottom: borderBtmRow }}>
                            {isFirstRow ? (
                              /* Fila visible: nombre cargo (clickable → panel sugeridos) + botones hover */
                              <div className="relative flex items-center h-full group/cargo overflow-hidden">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!onOpenPanel) return;
                                    const req = eng.reqs.find((r) => matchesCargo(r.cargo_requerido, cargo));
                                    // En simulación no hay reqs reales; usamos req sintético con fechas del engagement
                                    const reqId = req?.id ?? (simulationMode ? `sim_req_${eng.id}_${cargo}` : null);
                                    if (!reqId) return;
                                    onOpenPanel({ reqId, engId: eng.id, engNombre: eng.nombre, engCliente: eng.cliente ?? "", engInicio: eng.fecha_inicio, engFin: eng.fecha_fin ?? eng.fecha_inicio, cargo });
                                  }}
                                  title={onOpenPanel ? `Ver sugeridos para ${cargo}` : cargo}
                                  className={`text-[9px] font-medium pl-1 truncate leading-none text-left flex-1 transition-colors ${onOpenPanel && (eng.reqs.some((r) => matchesCargo(r.cargo_requerido, cargo)) || simulationMode) ? "text-gray-400 hover:text-blue-500 cursor-pointer" : "text-gray-400 cursor-default"}`}
                                  style={{ maxWidth: 46 }}>
                                  {cargo}
                                </button>
                                {!readOnly && (
                                  <div className="absolute right-0 top-0 bottom-0 flex items-center bg-white opacity-0 group-hover/cargo:opacity-100 transition-opacity">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); openEditReq(eng, cargo); }}
                                      title="Editar fechas del requerimiento"
                                      className="p-0.5 rounded hover:bg-blue-50 text-gray-200 hover:text-blue-400 transition-colors">
                                      <Pencil className="w-2.5 h-2.5" />
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); openDeleteReq(eng, cargo); }}
                                      title="Eliminar requerimiento"
                                      className="p-0.5 rounded hover:bg-red-50 text-gray-200 hover:text-red-400 transition-colors">
                                      <Trash2 className="w-2.5 h-2.5" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            ) : (
                              /* Filas invisibles: preservan el ancho para simetría exacta */
                              <p className="invisible text-[9px] font-medium pl-1">{cargo}</p>
                            )}
                          </td>

                          {/* Celdas de fechas — una rama por kind */}
                          {columnas.map((col, i) => {
                            // sin línea entre personas; solo la dashed superior del cargo
                            const btop = isFirstRow ? "1px dashed #e2e8f0" : undefined;

                            // ── EMPTY ──────────────────────────────────────────────────
                            if (kind === "EMPTY" || !p) {
                              const colIniStr   = format(col.inicio, "yyyy-MM-dd");
                              const reqsEnCol   = eng.reqs.filter((r) =>
                                matchesCargo(r.cargo_requerido, cargo) &&
                                rangoSolapan(r.fecha_inicio, r.fecha_fin, col.inicio, col.fin)
                              );
                              const esColActiva = rangoSolapan(eng.fecha_inicio, eng.fecha_fin, col.inicio, col.fin);
                              const ghostPersonas = eng.tipo === "ayuda_interna" && esColActiva && reqsEnCol.length === 0
                                ? personas.filter((gp) => gp.fecha_fin < colIniStr)
                                    .sort((a, b) => b.fecha_fin.localeCompare(a.fecha_fin))
                                    .filter((gp, _, arr) => arr.findIndex((q) => q.id === gp.id) === 0)
                                : [];
                              return (
                                <td key={i} className="px-0.5 py-0 align-middle"
                                  style={{ height: ROW_H, borderTop: btop, borderBottom: borderBtmRow }}
                                  onDragOver={(e) => { e.preventDefault(); if (reqsEnCol[0]) setDragOverReqId(reqsEnCol[0].id + "-plan"); }}
                                  onDragLeave={() => setDragOverReqId(null)}
                                  onDrop={(e) => { setDragOverReqId(null); if (reqsEnCol[0]) handleDrop(e, eng, reqsEnCol[0], true); }}>
                                  {ghostPersonas.map((gp) => {
                                    const { isFirst: gFirst } = barEdge(gp, i);
                                    const ghostKey = `${eng.id}-${cargo}-${gp.id}`;
                                    return (
                                      <div key={`ghost-${gp.asignacionId}`}
                                        className="flex items-center h-1.5 w-full cursor-pointer"
                                        style={{ border: `2px dashed ${cargoColor}80`, borderRadius: 4, opacity: dragOverGhostKey === ghostKey ? 1 : 0.6 }}
                                        onClick={() => handleGhostClick(eng, cargo, gp)}
                                        onDragOver={(e) => { e.preventDefault(); setDragOverGhostKey(ghostKey); }}
                                        onDragLeave={() => setDragOverGhostKey(null)}
                                        onDrop={(e) => handleGhostDrop(e, eng, cargo, gp)}>
                                        {gFirst && <span className="pl-2 text-[10px] font-bold" style={{ color: cargoColor }}>{iniciales(gp.nombre, gp.apellido, gp.iniciales)}</span>}
                                      </div>
                                    );
                                  })}
                                </td>
                              );
                            }

                            // ── CONF ───────────────────────────────────────────────────
                            if (kind === "CONF") {
                              const esHoy    = col.inicio <= hoy && hoy <= col.fin;
                              // Verifica TODOS los segmentos: barra visible si cualquier segmento solapa la columna
                              const isActive = (segsPersona.get(p.id) ?? [p]).some((s) => rangoSolapan(s.fecha_inicio, s.fecha_fin, col.inicio, col.fin));
                              const { isFirst, isLast } = barEdge(p, i);
                              // Ausencia activa de esta persona en esta columna
                              const tieneAusenciaConf = ausencias.some((a) => a.persona_id === p.id && rangoSolapan(a.fecha_inicio, a.fecha_fin, col.inicio, col.fin));
                              const barBgConf = tieneAusenciaConf
                                ? `repeating-linear-gradient(45deg, ${cargoColor}99 0px, ${cargoColor}99 4px, ${cargoColor}22 4px, ${cargoColor}22 8px)`
                                : cargoColor;
                              return (
                                <td key={i} className="px-0.5 py-0 relative"
                                  style={{ height: ROW_H, borderTop: btop, borderBottom: borderBtmRow }}
                                  onMouseEnter={() => { if (resizing) { setResizeHoverIdx(i); resizeHoverRef.current = i; } }}>
                                  {isActive && (
                                    <>
                                      <div className="relative group/bar h-1.5 w-full cursor-pointer overflow-visible"
                                        style={{ background: barBgConf, opacity: desasignando === p.asignacionId ? 0.3 : tieneAusenciaConf ? 0.55 : esHoy ? 1 : 0.85, borderRadius: 4, marginTop: 7 }}
                                        onClick={(e) => handleAvatarClick(e, p, eng)}
                                        title={`${p.nombre} ${p.apellido} · ${p.cargo ?? ""} · ${p.pct}%`}>
                                        {!readOnly && <button onClick={(e) => { e.stopPropagation(); handleDesasignar(p.asignacionId, eng.id); }}
                                          title="Desasignar"
                                          className="absolute top-0 right-0 bottom-0 w-4 flex items-center justify-center opacity-0 group-hover/bar:opacity-100 bg-red-500 transition-opacity z-10"
                                          style={{ borderRadius: "0 4px 4px 0" }}>
                                          <span className="text-white text-[8px] font-bold leading-none">×</span>
                                        </button>}
                                        {!readOnly && isFirst && <div onMouseDown={(ev) => { ev.stopPropagation(); setResizing({ p, edge: "start" }); setResizeHoverIdx(i); resizeHoverRef.current = i; focusEngIdRef.current = eng.id; }} className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-50 rounded-l hover:bg-white/30 transition-colors" />}
                                        {!readOnly && isLast  && <div onMouseDown={(ev) => { ev.stopPropagation(); setResizing({ p, edge: "end"   }); setResizeHoverIdx(i); resizeHoverRef.current = i; focusEngIdRef.current = eng.id; }} className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 rounded-r hover:bg-white/30 transition-colors" />}
                                      </div>
                                      {isFirst && (
                                        <div className="absolute flex items-center gap-0.5 z-20" style={{ top: "50%", left: 18, transform: "translateY(-50%)", pointerEvents: "none" }}>
                                          <div className="flex items-center justify-center rounded-full text-white font-bold select-none cursor-pointer shadow-sm"
                                            style={{ width: 14, height: 14, fontSize: 7, backgroundColor: cargoColor, border: "1.5px solid white" }}
                                            title={`${p.nombre} ${p.apellido} · ${p.cargo ?? ""} · ${p.pct}%`}>
                                            {iniciales(p.nombre, p.apellido, p.iniciales)}
                                          </div>
                                          {/* Ícono ausencia */}
                                          {tieneAusenciaConf && (
                                            <div className="group/tip relative" style={{ pointerEvents: "auto" }}>
                                              <AlertTriangle className="w-2.5 h-2.5 text-amber-500" />
                                              <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 bg-slate-900 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap z-[9999] opacity-0 group-hover/tip:opacity-100 transition-opacity shadow-lg">
                                                Personal con Ausencia en este periodo
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </>
                                  )}
                                </td>
                              );
                            }

                            // ── PLAN ───────────────────────────────────────────────────
                            const isActive = (segsPersona.get(p.id) ?? [p]).some((s) => rangoSolapan(s.fecha_inicio, s.fecha_fin, col.inicio, col.fin));
                            const { isFirst, isLast } = barEdge(p, i);
                            // Ausencia activa en esta columna
                            const tieneAusenciaPlan = ausencias.some((a) => a.persona_id === p.id && rangoSolapan(a.fecha_inicio, a.fecha_fin, col.inicio, col.fin));
                            // Ausencia en propuesto: franjas densas alto contraste (cargoColor sólido + amarillo alerta)
                            const barBgPlan = tieneAusenciaPlan
                              ? `repeating-linear-gradient(45deg, ${cargoColor} 0px, ${cargoColor} 5px, rgba(251,191,36,1) 5px, rgba(251,191,36,1) 10px)`
                              : `${cargoColor}55`;
                            const isResizeHover = resizing?.p.asignacionId === p.asignacionId && resizeHoverIdx === i;
                            const reqsEnCol     = eng.reqs.filter((r) =>
                              matchesCargo(r.cargo_requerido, cargo) &&
                              rangoSolapan(r.fecha_inicio, r.fecha_fin, col.inicio, col.fin)
                            );
                            return (
                              <td key={i} className="px-0.5 py-0 relative"
                                style={{ height: ROW_H, borderTop: btop, borderBottom: borderBtmRow, background: isResizeHover ? "#dbeafe" : "transparent" }}
                                onMouseEnter={() => { if (resizing) { setResizeHoverIdx(i); resizeHoverRef.current = i; } }}
                                onDragOver={(e) => { e.preventDefault(); if (!isActive && reqsEnCol[0]) setDragOverReqId(reqsEnCol[0].id + "-plan"); }}
                                onDragLeave={() => setDragOverReqId(null)}
                                onDrop={(e) => { setDragOverReqId(null); if (!isActive && reqsEnCol[0]) handleDrop(e, eng, reqsEnCol[0], true); }}>
                                {isActive && (
                                  <>
                                    <div className="relative group/bar overflow-visible cursor-pointer"
                                      style={{ height: 5, marginTop: 7, background: barBgPlan, border: `1.5px dashed ${cargoColor}`, borderRadius: 4, opacity: desasignando === p.asignacionId ? 0.2 : tieneAusenciaPlan ? 0.55 : 1 }}
                                      title={`PLAN · ${p.nombre} ${p.apellido} · ${p.pct}%`}
                                      onClick={(e) => handleAvatarClick(e, p, eng)}>
                                      {!readOnly && <button onClick={(e) => { e.stopPropagation(); handleDesasignar(p.asignacionId, eng.id); }}
                                        title="Quitar del plan"
                                        className="absolute top-0 right-0 bottom-0 w-4 flex items-center justify-center opacity-0 group-hover/bar:opacity-100 bg-red-400 transition-opacity z-10"
                                        style={{ borderRadius: "0 4px 4px 0" }}>
                                        <span className="text-white text-[8px] font-bold">×</span>
                                      </button>}
                                      {!readOnly && isFirst && <div onMouseDown={(ev) => { ev.stopPropagation(); setResizing({ p, edge: "start" }); setResizeHoverIdx(i); resizeHoverRef.current = i; focusEngIdRef.current = eng.id; }} className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-50 rounded-l-sm hover:bg-blue-400 transition-colors" />}
                                      {!readOnly && isLast  && <div onMouseDown={(ev) => { ev.stopPropagation(); setResizing({ p, edge: "end"   }); setResizeHoverIdx(i); resizeHoverRef.current = i; focusEngIdRef.current = eng.id; }} className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 rounded-r-sm hover:bg-blue-400 transition-colors" />}
                                    </div>
                                    {isFirst && (
                                      <div className="absolute flex items-center gap-0.5 z-20" style={{ top: "50%", left: 18, transform: "translateY(-50%)", pointerEvents: "none" }}>
                                        {!readOnly && <button
                                          style={{ pointerEvents: "auto" }}
                                          onClick={() => confirmarPlan(p, eng.id)} disabled={confirmando === p.asignacionId}
                                          title="Confirmar"
                                          className="w-3.5 h-3.5 rounded-full bg-green-500 text-white flex items-center justify-center hover:bg-green-600 disabled:opacity-50 text-[7px] font-bold shadow-sm border border-white flex-shrink-0">
                                          ✓
                                        </button>}
                                        <div className="flex items-center justify-center rounded-full text-white font-bold select-none shadow-sm"
                                          style={{ width: 14, height: 14, fontSize: 7, backgroundColor: cargoColor, border: "1.5px solid white", pointerEvents: "none" }}
                                          title={`PLAN · ${p.nombre} ${p.apellido} · ${p.cargo ?? ""} · ${p.pct}%`}>
                                          {iniciales(p.nombre, p.apellido, p.iniciales)}
                                        </div>
                                        {/* Ícono ausencia */}
                                        {tieneAusenciaPlan && (
                                          <div className="group/tip relative" style={{ pointerEvents: "auto" }}>
                                            <AlertTriangle className="w-2.5 h-2.5 text-amber-500" />
                                            <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 bg-slate-900 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap z-[9999] opacity-0 group-hover/tip:opacity-100 transition-opacity shadow-lg">
                                              Personal con Ausencia en este periodo
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    });
                  });

                  // Solo renderiza "Ausentes" si hay ausencias de personas ACTIVAS en la vista.
                  // personasActivasIds excluye el lookback de 90d → no aparecen badges huérfanos.
                  const hayAusentesEnVista = personasActivasIds.size > 0 && ausencias.some(
                    (a) => personasActivasIds.has(a.persona_id) &&
                      columnas.some((col) => rangoSolapan(a.fecha_inicio, a.fecha_fin, col.inicio, col.fin))
                  );
                  const filaAusentes = hayAusentesEnVista ? (
                    <tr key={`aus-${eng.id}`}>
                      <td className="pr-3 pt-1 pb-0.5 sticky left-0 bg-white z-10">
                        <p className="text-orange-400 pl-3 text-[11px]">Ausentes</p>
                      </td>
                      {columnas.map((col, i) => {
                        const ausentesEnCol = ausencias.filter((a) =>
                          personasActivasIds.has(a.persona_id) &&  // ← activas en vista, no lookback
                          rangoSolapan(a.fecha_inicio, a.fecha_fin, col.inicio, col.fin)
                        );
                        const vistos = new Set<string>();
                        const ausUnicos = ausentesEnCol.reduce<{ p: PersonaAsig; tipo: string }[]>((acc, a) => {
                          if (vistos.has(a.persona_id)) return acc;
                          vistos.add(a.persona_id);
                          const p = personasUnicas.find((pe) => pe.id === a.persona_id);
                          if (p) acc.push({ p, tipo: a.tipo ?? "otro" });
                          return acc;
                        }, []);
                        return (
                          <td key={i} className="pt-1 pb-0.5 px-1">
                            {/* Sin min-h: colapsa a 0 si no hay ausentes en esta columna */}
                            <div className="flex flex-wrap gap-0.5 justify-center items-center">
                              {ausUnicos.map(({ p, tipo }) => {
                                const cfg = COLOR_AUSENCIA[tipo as keyof typeof COLOR_AUSENCIA] ?? { bg: "#9ca3af", text: "#fff", label: "Ausencia" };
                                return (
                                <div key={p.id} title={`${p.nombre} ${p.apellido} — ${cfg.label}`}
                                  className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold"
                                  style={{ background: cfg.bg, color: cfg.text }}>
                                  {iniciales(p.nombre, p.apellido, p.iniciales)}
                                </div>
                                );
                              })}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ) : null;

                  return [
                    separador,
                    filaHdr,
                    ...(estaColapsado ? [] : [...filasCargo, filaAusentes]),
                  ].filter(Boolean);
                });

                return [filaSeccion, ...filasEngs];
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modal unificado de colaborador (Asignación + Perfil) ── */}
      {asigModal && (
        <ColaboradorModal
          personaId={asigModal.persona.id}
          personaNombre={`${asigModal.persona.nombre} ${asigModal.persona.apellido}`}
          engagementId={asigModal.eng.id}
          engagementNombre={asigModal.eng.nombre}
          engInicio={asigModal.eng.fecha_inicio}
          engFin={asigModal.eng.fecha_fin ?? asigModal.eng.fecha_inicio}
          requerimientoId={asigModal.persona.requerimiento_id}
          cargo={asigModal.persona.cargo}
          pct={asigModal.persona.pct}
          estadoStaffing={asigModal.persona.estado_staffing}
          simulationMode={simulationMode}
          onSimGuardado={(rangos) => {
            // Actualiza fechas de la persona en el estado local del plan
            setEngs((prev) => prev.map((eg) =>
              eg.id !== asigModal.eng.id ? eg : {
                ...eg,
                personas: eg.personas.map((p) =>
                  p.id !== asigModal.persona.id ? p : {
                    ...p,
                    fecha_inicio: rangos[0]?.inicio ?? p.fecha_inicio,
                    fecha_fin:    rangos[rangos.length - 1]?.fin ?? p.fecha_fin,
                  }
                ),
              }
            ));
          }}
          onClose={() => setAsigModal(null)}
          onGuardado={() => {
            setAsigModal(null);
            refresh(asigModal.eng.id);
          }}
        />
      )}

      {/* ── Quick-edit intensidad ── */}
      {quickEdit && (
        <div
          className="fixed z-50 bg-white rounded-xl shadow-2xl border border-gray-100 px-3 py-2 flex items-center gap-2"
          style={{ left: quickEdit.x, top: quickEdit.y, transform: "translate(-50%, 8px)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="text-[10px] text-gray-400 font-medium">Intensidad:</span>
          {(["rojo", "amarillo", "verde"] as const).map((int) => (
            <button
              key={int}
              onClick={() => aplicarIntensidad(quickEdit.fecha, quickEdit.fecha_fin, quickEdit.engId, int)}
              className="w-6 h-6 rounded-full hover:scale-110 transition-transform shadow-sm border-2 border-white"
              style={{ background: INTENSIDAD_COLOR[int] }}
              title={int.charAt(0).toUpperCase() + int.slice(1)}
            />
          ))}
          <button onClick={() => setQuickEdit(null)} className="ml-1 text-gray-300 hover:text-gray-500">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* ── Modal detalle engagement ── */}
      {engModal && (
        <div className="absolute inset-0 bg-black/10 rounded-xl z-20 flex items-start justify-end p-3">
          <div
            ref={modalRef}
            className="bg-white rounded-xl shadow-xl border border-gray-100 w-80 flex flex-col overflow-hidden"
            style={{ maxHeight: "96%" }}
          >
            {/* Header */}
            <div className="p-4 pb-3 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{
                        background: engModal.tipo === "proyecto" ? "#eaf4ff" : engModal.tipo === "propuesta" ? "#f5f0ff" : "#f0fdf4",
                        color:      engModal.tipo === "proyecto" ? "#1a5276"  : engModal.tipo === "propuesta" ? "#6b21a8"  : "#15803d",
                      }}>
                      {engModal.tipo === "proyecto" ? "Proyecto" : engModal.tipo === "propuesta" ? "Propuesta" : "Desarrollo interno"}
                    </span>
                  </div>
                  <h3 className="font-bold text-[#1a1a2e] text-sm leading-tight">{engModal.codigo ? `${engModal.codigo}: ${engModal.nombre}` : engModal.nombre}</h3>
                  {engModal.cliente && (
                    <p className="text-xs text-gray-400 mt-0.5">{engModal.cliente}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {!readOnly && <button
                    onClick={() => { const eg = engs.find(e => e.id === engModal.id); setEngToEdit(engModal.raw); setReqsToEdit(eg?.reqs ?? []); setActividadesToEdit(eg?.actividades ?? []); setFormOpen(true); setEngModal(null); }}
                    title="Editar"
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>}
                  <button
                    onClick={() => setEngModal(null)}
                    title="Cerrar"
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Body scrolleable */}
            <div className="overflow-y-auto p-4 flex-1 space-y-4">

              {/* Fechas */}
              <div className="flex items-start gap-2.5">
                <Calendar className="w-3.5 h-3.5 text-gray-300 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Fechas</p>
                  <p className="text-xs text-[#1a1a2e]">
                    {engModal.fecha_inicio
                      ? format(new Date(engModal.fecha_inicio + "T00:00:00"), "d 'de' MMM yyyy", { locale: es })
                      : "—"}
                    {" → "}
                    {engModal.fecha_fin
                      ? format(new Date(engModal.fecha_fin + "T00:00:00"), "d 'de' MMM yyyy", { locale: es })
                      : "Sin fecha de término"}
                  </p>
                </div>
              </div>

              {/* Industria */}
              {(modalIndustria || engModal.raw.industria_id) && (
                <div className="flex items-start gap-2.5">
                  <Building2 className="w-3.5 h-3.5 text-gray-300 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Industria</p>
                    <p className="text-xs text-[#1a1a2e]">
                      {modalIndustria ?? <span className="text-gray-300 italic">Cargando...</span>}
                    </p>
                  </div>
                </div>
              )}

              {/* Descripción */}
              {engModal.raw.descripcion && (
                <div className="flex items-start gap-2.5">
                  <AlignLeft className="w-3.5 h-3.5 text-gray-300 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Descripción</p>
                    <p className="text-xs text-[#555] leading-relaxed whitespace-pre-line">{engModal.raw.descripcion}</p>
                  </div>
                </div>
              )}

              {/* Roles / perfiles requeridos */}
              {engModal.reqs.length > 0 && (() => {
                const cargosUnicos = Array.from(
                  new Set(engModal.reqs.map((r) => r.cargo_requerido).filter(Boolean) as string[])
                ).sort((a, b) => (JERARQUIA[a] ?? 99) - (JERARQUIA[b] ?? 99));
                return (
                  <div className="flex items-start gap-2.5">
                    <Briefcase className="w-3.5 h-3.5 text-gray-300 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Perfiles requeridos</p>
                      <div className="flex flex-wrap gap-1.5">
                        {cargosUnicos.map((c) => {
                          const count = engModal.reqs.filter((r) => r.cargo_requerido === c).length;
                          return (
                            <span key={c} className="text-[11px] px-2 py-0.5 rounded-full bg-[#f1f5f9] text-[#475569] font-medium">
                              {c}{count > 1 && <span className="ml-1 text-[#94a3b8]">×{count}</span>}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Personas asignadas actualmente */}
              {engModal.personas.length > 0 && (
                <div className="flex items-start gap-2.5">
                  <Users className="w-3.5 h-3.5 text-gray-300 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Equipo asignado</p>
                    <div className="space-y-1">
                      {engModal.personas.map((p) => (
                        <div key={p.asignacionId} className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <div
                              className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0"
                              style={{ background: COLORES[normalizeCargoDisplay(p.cargo ?? "")] ?? COLOR_DEFAULT }}
                            >
                              {(p.nombre[0] ?? "")}{(p.apellido[0] ?? "")}
                            </div>
                            <span className="text-xs truncate text-[#1a1a2e]">{p.nombre} {p.apellido}</span>
                          </div>
                          <span className="text-[10px] text-gray-400 flex-shrink-0">{p.pct}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {/* ── Modal edición fechas de requerimiento ── */}
      <Modal
        open={!!editReqModal}
        onClose={() => !reqLoading && setEditReqModal(null)}
        title="Editar requerimiento de cargo"
        footer={
          <>
            <button
              onClick={() => setEditReqModal(null)}
              disabled={reqLoading}
              className="px-3 py-1.5 rounded-lg border border-[#e0e0e0] text-xs font-semibold text-[#555] hover:bg-[#f5f5f5] disabled:opacity-50 transition-colors">
              Cancelar
            </button>
            <button
              onClick={saveEditReq}
              disabled={reqLoading || !editFechas.inicio || !editFechas.fin}
              className="px-3 py-1.5 rounded-lg bg-[#4a90e2] text-white text-xs font-semibold hover:bg-[#357abd] disabled:opacity-50 transition-colors">
              {reqLoading ? "Guardando…" : "Guardar"}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[11px] text-gray-400">
            Cargo: <span className="font-semibold text-[#1a1a2e]">{editReqModal?.req.cargo_requerido ?? "—"}</span>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Fecha inicio</label>
              <input type="date" value={editFechas.inicio}
                max={editFechas.fin || undefined}
                onChange={(e) => setEditFechas((f) => ({ ...f, inicio: e.target.value }))}
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#e0e0e0] text-sm focus:outline-none focus:ring-2 focus:ring-[#4a90e2]/40 focus:border-[#4a90e2] transition-colors" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Fecha término</label>
              <input type="date" value={editFechas.fin}
                min={editFechas.inicio || undefined}
                onChange={(e) => setEditFechas((f) => ({ ...f, fin: e.target.value }))}
                className="w-full px-2.5 py-1.5 rounded-lg border border-[#e0e0e0] text-sm focus:outline-none focus:ring-2 focus:ring-[#4a90e2]/40 focus:border-[#4a90e2] transition-colors" />
            </div>
          </div>
        </div>
      </Modal>

      {/* ── Modal confirmación eliminar requerimiento ── */}
      <ConfirmDialog
        open={!!deleteReqModal}
        onClose={() => !reqLoading && setDeleteReqModal(null)}
        onConfirm={confirmDeleteReq}
        title="Eliminar requerimiento de cargo"
        message={`¿Estás seguro de que deseas eliminar el requerimiento "${deleteReqModal?.cargo ?? ""}" de este proyecto? Esta acción también desvinculará al personal asignado a este cargo.`}
        confirmLabel={reqLoading ? "Eliminando…" : "Sí, eliminar"}
      />

      {/* Modal crear / editar engagement */}
      <EngagementForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSuccess={() => {
          if (!simulationMode && engToEdit) {
            pushUndo({ type: "edit_reqs", engId: (engToEdit as any).id, label: `Editar cargos "${(engToEdit as any).nombre ?? ""}"`, engNombre: (engToEdit as any).nombre ?? "", prevReqs: prevReqsForUndoRef.current, prevPersonas: [] });
          }
          setFormOpen(false);
          refresh();
        }}
        engagement={engToEdit}
        simulationMode={simulationMode}
        simulationReqs={simulationMode ? reqsToEdit : undefined}
        simulationActividades={simulationMode ? actividadesToEdit : undefined}
        onSimSuccess={(eng) => {
          // Capturar estado previo antes de modificar (para undo en simulación)
          const engPrev = engs.find((e) => e.id === eng.id);
          const prevReqsSim  = engPrev?.reqs     ?? [];
          const prevPersonasSim = engPrev?.personas ?? [];
          // Convierte ReqRow[] del form → ReqData[] para engs local
          const nuevosReqs: ReqData[] = (eng.reqs ?? []).map((r: any, i: number) => ({
            id: r.id ?? `sim_req_${eng.id}_${i}_${Date.now()}`,
            cargo_requerido: r.cargo_requerido || null,
            pct_dedicacion: Number(r.pct_dedicacion) || 100,
            fecha_inicio: r.fecha_inicio,
            fecha_fin: r.fecha_fin ?? eng.fecha_fin,
            fase_nombre: r.fase_nombre || null,
          }));

          setEngs((prev) => {
            const existe = prev.find((e) => e.id === eng.id);
            if (existe) {
              // Edición: actualiza metadata + reemplaza reqs + recorta personas al nuevo rango
              return prev.map((e) => e.id !== eng.id ? e : {
                ...e,
                codigo: eng.codigo, nombre: eng.nombre, cliente: eng.cliente,
                tipo: eng.tipo, fecha_inicio: eng.fecha_inicio, fecha_fin: eng.fecha_fin,
                reqs: nuevosReqs,
                // Personas adoptan las fechas del engagement (comportamiento por defecto)
                personas: e.personas
                  .filter((p) => !p.requerimiento_id || nuevosReqs.some((r) => r.id === p.requerimiento_id))
                  .map((p) => ({ ...p, fecha_inicio: eng.fecha_inicio, fecha_fin: eng.fecha_fin ?? p.fecha_fin })),
                // Actualiza actividades (viajes/talleres) desde el form
                actividades: (eng.actividades ?? []).map((a: any) => ({
                  id: a.id, tipo: a.tipo, titulo: a.titulo ?? "",
                  descripcion: a.descripcion ?? "",
                  fecha_inicio: a.fecha_inicio, fecha_fin: a.fecha_fin,
                })),
                raw: { ...e.raw as any, ...eng },
              });
            }
            // Creación: nuevo engagement con reqs del form
            return [...prev, {
              id: eng.id, codigo: eng.codigo, nombre: eng.nombre,
              cliente: eng.cliente, tipo: eng.tipo,
              fecha_inicio: eng.fecha_inicio, fecha_fin: eng.fecha_fin,
              personas: [], reqs: nuevosReqs, actividades: [], extensiones: [],
              sort_order: prev.length + 1,
              raw: { ...eng, id: eng.id } as any,
            }];
          });
          if (engPrev) pushUndo({ type: "edit_reqs", engId: eng.id, label: `Editar cargos "${eng.nombre}"`, engNombre: eng.nombre, prevReqs: prevReqsSim, prevPersonas: prevPersonasSim });
          setFormOpen(false);
        }}
      />

      <ConfirmDialog
        open={!!confirmPapeleraDesg}
        onClose={() => setConfirmPapeleraDesg(null)}
        onConfirm={() => confirmPapeleraDesg && moverAPapelera(confirmPapeleraDesg.id)}
        title="Mover a la papelera"
        message={`¿Estás seguro de que quieres mover "${confirmPapeleraDesg?.nombre}" a la papelera? Podrás recuperarlo durante los próximos 30 días.`}
        confirmLabel="Mover a papelera"
      />

      {/* ── Modal: Ausencias parciales detectadas al staffear ── */}
      <Modal
        open={!!ausenciaConfirmModal}
        onClose={() => setAusenciaConfirmModal(null)}
        title={ausenciaConfirmModal?.totalBloqueo ? "⛔ No se puede staffear" : "⚠ Ausencias detectadas en este período"}
        footer={
          ausenciaConfirmModal?.totalBloqueo ? (
            <Button variant="secondary" onClick={() => setAusenciaConfirmModal(null)}>Entendido</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setAusenciaConfirmModal(null)}>Cancelar</Button>
              <Button variant="danger" onClick={() => ausenciaConfirmModal?.onConfirm()}>
                Asignar ({ausenciaConfirmModal?.ausencias.length === 1 ? "1 segmento" : `${ausenciaConfirmModal?.ausencias.length ?? 0} segmentos`})
              </Button>
            </>
          )
        }
      >
        {ausenciaConfirmModal && (
          <div className="space-y-3 text-[13px]">
            <p className="text-[#555]">
              <strong>{ausenciaConfirmModal.nombre}</strong> tiene ausencias registradas en el rango de este engagement:
            </p>
            <ul className="space-y-1.5">
              {ausenciaConfirmModal.ausencias.map((a, i) => (
                <li key={i} className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg">
                  <span className="text-amber-500">⚠</span>
                  <span className="text-[#555]">
                    {format(new Date(a.fecha_inicio + "T00:00:00"), "d MMM yyyy", { locale: es })} → {format(new Date(a.fecha_fin + "T00:00:00"), "d MMM yyyy", { locale: es })}
                    <span className="ml-2 text-[11px] font-semibold text-amber-600">({a.dias} día{a.dias !== 1 ? "s" : ""})</span>
                  </span>
                </li>
              ))}
            </ul>
            {ausenciaConfirmModal.totalBloqueo ? (
              <p className="text-red-700 text-[12px] font-medium bg-red-50 border border-red-200 rounded-lg p-3">
                No se puede staffear. <strong>{ausenciaConfirmModal.nombre}</strong> está ausente durante todo el período del proyecto.
              </p>
            ) : (
              <p className="text-[12px] text-[#888] bg-[#f8f8f8] rounded-lg p-2">
                Al confirmar, la asignación se dividirá automáticamente saltando los días de ausencia.
              </p>
            )}
          </div>
        )}
      </Modal>

    </div>
  );
}
