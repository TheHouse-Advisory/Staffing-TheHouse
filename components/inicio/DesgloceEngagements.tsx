"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  startOfISOWeek, addDays, addWeeks, addMonths,
  subWeeks, subMonths, format, startOfMonth, endOfMonth,
} from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight, ChevronDown, Plus, Pencil, X, Calendar, Users, Building2, AlignLeft, Briefcase, Trash2, Loader2, GripVertical, RotateCcw } from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";
import { EngagementForm } from "@/components/engagements/EngagementForm";
import { ColaboradorModal } from "@/components/engagements/ColaboradorModal";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import type { Engagement } from "@/lib/types/database";

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
function iniciales(nombre: string, apellido: string) {
  return `${nombre[0] ?? ""}${apellido[0] ?? ""}`.toUpperCase();
}

interface PersonaAsig {
  id: string; nombre: string; apellido: string;
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
interface EngRow {
  id: string; codigo: string | null; nombre: string; cliente: string | null; tipo: string;
  fecha_inicio: string; fecha_fin: string | null;
  personas: PersonaAsig[];
  reqs: ReqData[];
  raw: Engagement;
  sort_order: number | null; // orden manual del usuario
}

export interface PanelInfo {
  reqId: string; engId: string; engNombre: string; engCliente: string;
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
}

// ── Tipo para el undo stack (fuera del componente para evitar re-declaraciones) ──
type UndoEntry =
  | { type: "staffear";    engId: string; label: string; ids: string[] }
  | { type: "desasignar";  engId: string; label: string; asig: { engagement_id: string; requerimiento_id: string; persona_id: string; cargo_al_momento: string | null; pct_dedicacion: number | null; estado: string; estado_staffing: string; fecha_inicio: string; fecha_fin: string } }
  | { type: "resize";      engId: string; label: string; asignacionId: string; edge: "start" | "end"; prevDate: string }
  | { type: "resize_eng";  engId: string; label: string; field: string; prevDate: string }
  | { type: "move_eng";    engId: string; label: string; prevInicio: string; prevFin: string; finField: string };

export function DesgloceEngagements({ onAsignacionChange, onOpenPanel, externalReloadKey, vistaExterna, baseExterna, onPersonaClick, openEngagementId }: Props) {
  const [vistaInterna, setVistaInterna] = useState<Vista>("semana");
  const [baseInterna, setBaseInterna] = useState<Date>(new Date());

  // Si vienen props externas las usamos; si no, usamos estado interno
  const vista = vistaExterna ?? vistaInterna;
  const base = baseExterna ?? baseInterna;
  const [engs, setEngs] = useState<EngRow[]>([]);
  const [ausencias, setAusencias] = useState<{ persona_id: string; fecha_inicio: string; fecha_fin: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  // Form crear/editar engagement
  const [formOpen, setFormOpen] = useState(false);
  const [engToEdit, setEngToEdit] = useState<Engagement | undefined>();

  // Modal detalle engagement
  const [engModal, setEngModal] = useState<EngRow | null>(null);
  const [modalIndustria, setModalIndustria] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Toast de alertas
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 15000); // 15 s según spec de negocio
  };

  // ── Undo stack — registra hasta 3 acciones reversibles ──────────────────
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [undoing,   setUndoing]   = useState(false);
  // Encola una entrada (max 3); siempre usa actualización funcional para thread-safety
  function pushUndo(entry: UndoEntry) {
    setUndoStack(s => [...s.slice(-2), entry]);
  }

  async function handleUndo() {
    if (!undoStack.length || undoing) return;
    const last = undoStack[undoStack.length - 1];
    setUndoing(true);
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
  // Guarda fechas editadas en Supabase (actualiza todos los reqs del mismo cargo)
  async function saveEditReq() {
    if (!editReqModal) return;
    setReqLoading(true);
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
  // Elimina reqs + sus asignaciones en cascada
  async function confirmDeleteReq() {
    if (!deleteReqModal) return;
    setReqLoading(true);
    const sb = createAnyClient();
    const ids = deleteReqModal.reqs.map((r) => r.id);
    await sb.from("asignacion").delete().in("requerimiento_id", ids);
    await sb.from("requerimiento_engagement").delete().in("id", ids);
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
    async function load() {
      setLoading(true);
      const sb = createAnyClient();
      const cutoff = (() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split("T")[0]; })();
      const filtroCutoff = [`fecha_fin_real.gte.${cutoff}`, `and(fecha_fin_real.is.null,fecha_fin_estimada.gte.${cutoff})`, `and(fecha_fin_real.is.null,fecha_fin_estimada.is.null)`].join(",");

      const [engRes, asigRes, ausRes] = await Promise.all([
        sb.from("engagement")
          .select("id, codigo, nombre, cliente, tipo, estado, descripcion, fecha_inicio, fecha_fin_estimada, fecha_fin_real, industria_id, sort_order")
          .eq("estado", "activo")
          .eq("is_deleted", false)
          .lte("fecha_inicio", finStr)
          .or(`fecha_fin_real.gte.${inicioStr},fecha_fin_estimada.gte.${inicioStr},fecha_fin_real.is.null`)
          .or(filtroCutoff),

        sb.from("asignacion")
          .select("id, engagement_id, persona_id, pct_dedicacion, fecha_inicio, fecha_fin, estado_staffing, requerimiento_id, persona:persona_id(nombre, apellido, cargo_actual)" as any)
          .eq("estado", "activa")
          .lte("fecha_inicio", finStr)
          .gte("fecha_fin", lookbackStr),

        sb.from("ausencia")
          .select("persona_id, fecha_inicio, fecha_fin")
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
          personas: [], reqs: [], raw: e as Engagement,
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
        const [{ data: reqData }, { data: dcData }] = await Promise.all([
          sb.from("requerimiento_engagement")
            .select("id, engagement_id, cargo_requerido, fecha_inicio, fecha_fin, pct_dedicacion")
            .in("engagement_id", engIds),
          sb.from("dia_critico")
            .select("engagement_id, fecha, fecha_fin, intensidad")
            .in("engagement_id", engIds)
            .order("created_at", { ascending: false }),
        ]);
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
      setAusencias((ausRes.data ?? []) as { persona_id: string; fecha_inicio: string; fecha_fin: string }[]);
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
    if (focusId) focusEngIdRef.current = focusId;
    setReloadKey((k) => k + 1);
    onAsignacionChange?.();
    window.dispatchEvent(new CustomEvent("asignacionChanged"));
  }

  // Clic en avatar/barra → siempre abre ColaboradorModal unificado (tabs Asignación + Perfil)
  function handleAvatarClick(e: React.MouseEvent, p: PersonaAsig, eng: EngRow) {
    e.stopPropagation();
    setAsigModal({ persona: p, eng });
  }

  // Drop directo sobre el título del engagement — crea req + asignación CONFIRMADO automáticamente
  async function handleDropOnEngagement(e: React.DragEvent, eng: EngRow) {
    e.preventDefault();
    setDragOverEngId(null);
    let data: { personaId: string; nombre: string; apellido: string; cargo_actual: string } | null = null;
    try { data = JSON.parse(e.dataTransfer.getData("persona")); } catch { return; }
    if (!data?.personaId) return;

    const sb = createAnyClient();
    const cargoRequerido = data.cargo_actual || null;
    const fechaInicio = eng.fecha_inicio;
    const fechaFin = eng.fecha_fin ?? eng.fecha_inicio;

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
      requerimiento_id: (newReq as any).id,
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
      for (const seg of segments) {
        const { data: ins } = await (sb as any).from("asignacion").insert({ ...baseInsert, ...seg }).select("id");
        if (ins) createdIds.push(...(ins as any[]).map((r: any) => r.id));
      }
      // Toast explícito con detalle (15 s)
      const nombre = `${data.nombre} ${data.apellido}`.trim();
      const msgs = (ausPersonaDrop as { fecha_inicio: string; fecha_fin: string }[]).map((a) => {
        const dias = Math.round(
          (new Date(a.fecha_fin + "T00:00:00").getTime() - new Date(a.fecha_inicio + "T00:00:00").getTime()) / 86400000
        ) + 1;
        return `del ${format(new Date(a.fecha_inicio + "T00:00:00"), "d MMM yyyy", { locale: es })} al ${format(new Date(a.fecha_fin + "T00:00:00"), "d MMM yyyy", { locale: es })} (${dias} día${dias !== 1 ? "s" : ""})`;
      }).join(" · ");
      showToast(`⚠ Alerta: ${nombre} tiene ausencias ${msgs} dentro del rango de este proyecto. Los días ausentes no serán contabilizados como días staffeados.`);
    }

    // Registrar en undo stack
    if (createdIds.length) pushUndo({ type: "staffear", engId: eng.id, label: `Staffear ${data.nombre} ${data.apellido}`.trim(), ids: createdIds });
    refresh(eng.id);
  }

  // Drop de persona desde cuadrante EQUIPO sobre un slot vacío
  async function handleDrop(e: React.DragEvent, eng: EngRow, req: ReqData, forcePlan = false) {
    e.preventDefault();
    setDragOverReqId(null);
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

      for (const seg of segments) {
        const { data: ins } = await sb.from("asignacion").insert({ ...baseInsert, ...seg }).select("id");
        if (ins) createdIdsReq.push(...(ins as any[]).map((r: any) => r.id));
      }

      // Toast explícito con detalle por ausencia (15 s)
      const msgs = (ausPersona as { fecha_inicio: string; fecha_fin: string }[]).map((a) => {
        const dias = Math.round(
          (new Date(a.fecha_fin + "T00:00:00").getTime() - new Date(a.fecha_inicio + "T00:00:00").getTime()) / 86400000
        ) + 1;
        return `del ${format(new Date(a.fecha_inicio + "T00:00:00"), "d MMM yyyy", { locale: es })} al ${format(new Date(a.fecha_fin + "T00:00:00"), "d MMM yyyy", { locale: es })} (${dias} día${dias !== 1 ? "s" : ""})`;
      }).join(" · ");
      showToast(`⚠ Alerta: ${nombre} tiene ausencias ${msgs} dentro del rango de este proyecto. Los días ausentes no serán contabilizados como días staffeados.`);
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
            await (sb as any).from("engagement")
              .update({ fecha_inicio: newInicio, [finField]: newFin })
              .eq("id", eng.id);
            setUndoStack(s => [...s.slice(-2), {
              type: "move_eng" as const,
              engId:     eng.id,
              label:     `Mover "${eng.nombre}"`,
              prevInicio: eng.fecha_inicio,
              prevFin,
              finField,
            }]);
            refresh(eng.id);
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
      if (idx !== null) {
        const col = columnas[idx];
        const newDate = resizing.edge === "start"
          ? format(col.inicio, "yyyy-MM-dd")
          : format(col.fin, "yyyy-MM-dd");
        const sb = createAnyClient();
        // Guardar fecha original para undo antes de actualizar
        const { data: oldAsig } = await sb.from("asignacion")
          .select("fecha_inicio, fecha_fin, engagement_id")
          .eq("id", resizing.p.asignacionId)
          .single();
        const prevDate: string | null = oldAsig
          ? (resizing.edge === "start" ? (oldAsig as any).fecha_inicio : (oldAsig as any).fecha_fin)
          : null;
        await sb.from("asignacion")
          .update({ [resizing.edge === "start" ? "fecha_inicio" : "fecha_fin"]: newDate })
          .eq("id", resizing.p.asignacionId);
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
    // Persiste en DB: reemplaza cualquier registro previo para ese engagement+fecha
    const sb2 = createAnyClient();
    const { error: delErr } = await sb2.from("dia_critico").delete().eq("engagement_id", engId).eq("fecha", fecha);
    if (delErr) console.error("[dia_critico] delete error:", delErr);
    const { error: insErr } = await sb2.from("dia_critico").insert({ engagement_id: engId, fecha, fecha_fin, intensidad });
    if (insErr) console.error("[dia_critico] insert error:", insErr);
    // Notifica a otras instancias (no a esta — el optimistic update ya se aplicó arriba)
    window.dispatchEvent(new CustomEvent("diaCriticoChanged", { detail: { engId, fecha, fecha_fin, intensidad, sourceId: instanceId.current } }));
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
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setEngToEdit(undefined); setFormOpen(true); }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white transition-colors hover:opacity-90"
            style={{ background: "#4a90e2" }}
          >
            <Plus className="w-3 h-3" />
            Nuevo proyecto
          </button>
          {engs.length > 0 && (
            <button
              onClick={colapsados.size === engs.length ? expandirTodos : colapsarTodos}
              className="text-[11px] px-2.5 py-1 rounded-lg border border-gray-100 text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
            >
              {colapsados.size === engs.length ? "Expandir todos" : "Colapsar todos"}
            </button>
          )}
          {/* Botón Deshacer — activo solo cuando hay acciones en el stack */}
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
                { tipo: "ayuda_interna", label: "Ayuda interna",          color: "#27ae60" },
              ].flatMap(({ tipo, label, color: secColor }) => {
                const lista = engs.filter((e) => e.tipo === tipo);
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
                      draggable
                      onDragStart={(e) => { if (movingEngActiveRef.current || resizingEngActiveRef.current) { e.preventDefault(); return; } setDraggingEngId(eng.id); e.dataTransfer.effectAllowed = "move"; }}
                      onDragEnd={() => { setDraggingEngId(null); setDragOverEngSortId(null); }}
                      style={{ opacity: draggingEngId === eng.id ? 0.45 : 1, transition: "opacity 0.15s" }}>
                      <td className="pt-1 pb-0.5 sticky left-0 bg-white z-10" style={{ width: 110, maxWidth: 110 }}>
                        {/* relative+overflow-hidden: los botones de acción son absolute y no afectan el ancho */}
                        <div className="relative flex items-center gap-0.5 group overflow-hidden">
                          {/* Grip — visible on hover, señaliza que la fila es arrastrable */}
                          <span title="Arrastrar para reordenar">
                            <GripVertical className="w-3 h-3 flex-shrink-0 text-gray-200 group-hover:text-gray-400 cursor-grab transition-colors" />
                          </span>
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
                          {/* Botones acción: absolute para no sumar ancho al layout */}
                          <div className="absolute right-0 top-0 bottom-0 flex items-center gap-0.5 bg-white pl-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => { setEngToEdit(eng.raw); setFormOpen(true); }}
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
                        </div>
                      </td>
                      {columnas.map((col, i) => {
                        const esHoy = col.inicio <= hoy && hoy <= col.fin;
                        const activo = rangoSolapan(eng.fecha_inicio, eng.fecha_fin, col.inicio, col.fin);
                        const isDragTarget = dragOverEngId === eng.id;

                        if (!activo) return (
                          <td key={i} className="py-1 px-1"
                            onMouseEnter={() => { if (resizingEng) resizeEngHoverRef.current = i; if (movingEng?.eng.id === eng.id) { moveEngHoverRef.current = i; setMoveEngHoverIdx(i); } }}
                            onDragOver={(ev) => { ev.preventDefault(); setDragOverEngId(eng.id); }}
                            onDragLeave={() => setDragOverEngId(null)}
                            onDrop={(ev) => handleDropOnEngagement(ev, eng)} />
                        );

                        const intensidad = resolverIntensidad(eng, col);
                        // Rojo: mantiene color base (amber) + borde cortado rojo. Verde/amarillo: color propio.
                        const esRojo    = intensidad === "rojo";
                        const barColor  = esRojo ? "#f59e0b" : (INTENSIDAD_COLOR[intensidad] ?? "#f59e0b");
                        const rojoOutline: React.CSSProperties = esRojo
                          ? { outline: "2px dashed #ef4444", outlineOffset: "-1px" }
                          : {};
                        // Detecta bordes del engagement para colocar manillas de resize
                        const prevColE = columnas[i - 1];
                        const nextColE = columnas[i + 1];
                        const isEngFirst = !prevColE || !rangoSolapan(eng.fecha_inicio, eng.fecha_fin, prevColE.inicio, prevColE.fin);
                        const isEngLast  = !nextColE || !rangoSolapan(eng.fecha_inicio, eng.fecha_fin, nextColE.inicio, nextColE.fin);

                        // Preview visual del move: calcula si esta col estaría activa tras el desplazamiento
                        const movePreviewActive = movingEng?.eng.id === eng.id && moveEngHoverIdx !== null && (() => {
                          const delta = Math.round((columnas[moveEngHoverIdx]?.inicio.getTime() - columnas[movingEng.startColIdx]?.inicio.getTime()) / 86400000);
                          if (!delta) return false;
                          const pi = format(addDays(new Date(eng.fecha_inicio + "T00:00:00"), delta), "yyyy-MM-dd");
                          const pf = format(addDays(new Date(eng.fecha_fin    + "T00:00:00"), delta), "yyyy-MM-dd");
                          return rangoSolapan(pi, pf, col.inicio, col.fin);
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
                                className="relative h-1.5 rounded-full transition-all overflow-visible group/engbar"
                                style={{ background: barColor, ...rojoOutline, opacity: esHoy ? 1 : 0.5, cursor: movingEng?.eng.id === eng.id ? "grabbing" : "grab" }}
                                title="Arrastra para mover · Borde para redimensionar · Clic para intensidad"
                                onMouseDown={(ev) => {
                                  // Solo cuerpo (no los handles de borde que hacen stopPropagation)
                                  ev.stopPropagation();
                                  movingEngActiveRef.current = true;
                                  setMovingEng({ eng, startColIdx: i });
                                  moveEngHoverRef.current = i;
                                  setMoveEngHoverIdx(i);
                                }}
                                onClick={(ev) => {
                                  if (movingEng) return; // fue drag, no click
                                  ev.stopPropagation();
                                  setQuickEdit({ engId: eng.id, fecha: format(col.inicio, "yyyy-MM-dd"), fecha_fin: format(col.fin, "yyyy-MM-dd"), x: ev.clientX, y: ev.clientY });
                                }}>
                                {isEngFirst && <div onMouseDown={(ev) => { ev.stopPropagation(); resizingEngActiveRef.current = true; setResizingEng({ eng, edge: "start" }); resizeEngHoverRef.current = i; }} className="absolute left-0 top-0 bottom-0 w-4 cursor-ew-resize z-20 rounded-l-full hover:bg-white/40 transition-colors" />}
                                {isEngLast  && <div onMouseDown={(ev) => { ev.stopPropagation(); resizingEngActiveRef.current = true; setResizingEng({ eng, edge: "end"   }); resizeEngHoverRef.current = i; }} className="absolute right-0 top-0 bottom-0 w-4 cursor-ew-resize z-20 rounded-r-full hover:bg-white/40 transition-colors" />}
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
                              className="relative h-3 rounded-full hover:opacity-100 transition-opacity overflow-visible group/engbar"
                              style={{ background: barColor, ...rojoOutline, opacity: movePreviewActive ? 1 : isDragTarget ? 1 : esHoy ? 1 : 0.75, cursor: movingEng?.eng.id === eng.id ? "grabbing" : "grab" }}
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
                                    if (!req) return;
                                    onOpenPanel({ reqId: req.id, engId: eng.id, engNombre: eng.nombre, engCliente: eng.cliente ?? "" });
                                  }}
                                  title={onOpenPanel ? `Ver sugeridos para ${cargo}` : cargo}
                                  className={`text-[9px] font-medium pl-1 truncate leading-none text-left flex-1 transition-colors ${onOpenPanel && eng.reqs.some((r) => matchesCargo(r.cargo_requerido, cargo)) ? "text-gray-400 hover:text-blue-500 cursor-pointer" : "text-gray-400 cursor-default"}`}
                                  style={{ maxWidth: 46 }}>
                                  {cargo}
                                </button>
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
                                        {gFirst && <span className="pl-2 text-[10px] font-bold" style={{ color: cargoColor }}>{iniciales(gp.nombre, gp.apellido)}</span>}
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
                              return (
                                <td key={i} className="px-0.5 py-0 relative"
                                  style={{ height: ROW_H, borderTop: btop, borderBottom: borderBtmRow }}>
                                  {isActive && (
                                    <>
                                      <div className="relative group/bar h-1.5 w-full cursor-pointer overflow-visible"
                                        style={{ backgroundColor: cargoColor, opacity: desasignando === p.asignacionId ? 0.3 : esHoy ? 1 : 0.85, borderRadius: 4, marginTop: 7 }}
                                        onClick={(e) => handleAvatarClick(e, p, eng)}
                                        title={`${p.nombre} ${p.apellido} · ${p.cargo ?? ""} · ${p.pct}%`}>
                                        <button onClick={(e) => { e.stopPropagation(); handleDesasignar(p.asignacionId, eng.id); }}
                                          title="Desasignar"
                                          className="absolute top-0 right-0 bottom-0 w-4 flex items-center justify-center opacity-0 group-hover/bar:opacity-100 bg-red-500 transition-opacity z-10"
                                          style={{ borderRadius: "0 4px 4px 0" }}>
                                          <span className="text-white text-[8px] font-bold leading-none">×</span>
                                        </button>
                                        {isFirst && <div onMouseDown={(ev) => { ev.stopPropagation(); setResizing({ p, edge: "start" }); setResizeHoverIdx(i); resizeHoverRef.current = i; focusEngIdRef.current = eng.id; }} className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 rounded-l hover:bg-white/30 transition-colors" />}
                                        {isLast  && <div onMouseDown={(ev) => { ev.stopPropagation(); setResizing({ p, edge: "end"   }); setResizeHoverIdx(i); resizeHoverRef.current = i; focusEngIdRef.current = eng.id; }} className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 rounded-r hover:bg-white/30 transition-colors" />}
                                      </div>
                                      {isFirst && (
                                        <div className="absolute flex items-center justify-center rounded-full text-white font-bold select-none cursor-pointer z-20 shadow-sm"
                                          style={{ width: 14, height: 14, fontSize: 7, backgroundColor: cargoColor, border: "1.5px solid white", top: "50%", left: 2, transform: "translateY(-50%)" }}
                                          title={`${p.nombre} ${p.apellido} · ${p.cargo ?? ""} · ${p.pct}%`}
                                          onClick={(e) => { e.stopPropagation(); handleAvatarClick(e, p, eng); }}>
                                          {iniciales(p.nombre, p.apellido)}
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
                                    <div className="relative group/bar overflow-visible"
                                      style={{ height: 5, marginTop: 7, backgroundColor: `${cargoColor}55`, border: `1.5px dashed ${cargoColor}`, borderRadius: 4, opacity: desasignando === p.asignacionId ? 0.2 : 1 }}
                                      title={`PLAN · ${p.nombre} ${p.apellido} · ${p.pct}%`}>
                                      <button onClick={(e) => { e.stopPropagation(); handleDesasignar(p.asignacionId, eng.id); }}
                                        title="Quitar del plan"
                                        className="absolute top-0 right-0 bottom-0 w-4 flex items-center justify-center opacity-0 group-hover/bar:opacity-100 bg-red-400 transition-opacity z-10"
                                        style={{ borderRadius: "0 4px 4px 0" }}>
                                        <span className="text-white text-[8px] font-bold">×</span>
                                      </button>
                                      {isFirst && <div onMouseDown={(ev) => { ev.stopPropagation(); setResizing({ p, edge: "start" }); setResizeHoverIdx(i); resizeHoverRef.current = i; focusEngIdRef.current = eng.id; }} className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 rounded-l-sm hover:bg-blue-400 transition-colors" />}
                                      {isLast  && <div onMouseDown={(ev) => { ev.stopPropagation(); setResizing({ p, edge: "end"   }); setResizeHoverIdx(i); resizeHoverRef.current = i; focusEngIdRef.current = eng.id; }} className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 rounded-r-sm hover:bg-blue-400 transition-colors" />}
                                    </div>
                                    {isFirst && (
                                      <div className="absolute flex items-center gap-0.5 z-20" style={{ top: "50%", left: 2, transform: "translateY(-50%)" }}>
                                        <button onClick={() => confirmarPlan(p, eng.id)} disabled={confirmando === p.asignacionId}
                                          title="Confirmar"
                                          className="w-3.5 h-3.5 rounded-full bg-green-500 text-white flex items-center justify-center hover:bg-green-600 disabled:opacity-50 text-[7px] font-bold shadow-sm border border-white flex-shrink-0">
                                          ✓
                                        </button>
                                        <div className="flex items-center justify-center rounded-full text-white font-bold select-none shadow-sm"
                                          style={{ width: 14, height: 14, fontSize: 7, backgroundColor: cargoColor, border: "1.5px solid white" }}
                                          title={`PLAN · ${p.nombre} ${p.apellido} · ${p.cargo ?? ""} · ${p.pct}%`}>
                                          {iniciales(p.nombre, p.apellido)}
                                        </div>
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
                        const ausUnicos = ausentesEnCol.reduce<PersonaAsig[]>((acc, a) => {
                          if (vistos.has(a.persona_id)) return acc;
                          vistos.add(a.persona_id);
                          const p = personasUnicas.find((pe) => pe.id === a.persona_id);
                          if (p) acc.push(p);
                          return acc;
                        }, []);
                        return (
                          <td key={i} className="pt-1 pb-0.5 px-1">
                            {/* Sin min-h: colapsa a 0 si no hay ausentes en esta columna */}
                            <div className="flex flex-wrap gap-0.5 justify-center items-center">
                              {ausUnicos.map((p) => (
                                <div key={p.id} title={`${p.nombre} ${p.apellido} — ausente`}
                                  className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold"
                                  style={{ background: "#fed7aa", color: "#c2410c" }}>
                                  {iniciales(p.nombre, p.apellido)}
                                </div>
                              ))}
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
                      {engModal.tipo === "proyecto" ? "Proyecto" : engModal.tipo === "propuesta" ? "Propuesta" : "Ayuda interna"}
                    </span>
                  </div>
                  <h3 className="font-bold text-[#1a1a2e] text-sm leading-tight">{engModal.codigo ? `${engModal.codigo}: ${engModal.nombre}` : engModal.nombre}</h3>
                  {engModal.cliente && (
                    <p className="text-xs text-gray-400 mt-0.5">{engModal.cliente}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => { setEngToEdit(engModal.raw); setFormOpen(true); setEngModal(null); }}
                    title="Editar"
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
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
        onSuccess={() => { setFormOpen(false); refresh(); }}
        engagement={engToEdit}
      />

      <ConfirmDialog
        open={!!confirmPapeleraDesg}
        onClose={() => setConfirmPapeleraDesg(null)}
        onConfirm={() => confirmPapeleraDesg && moverAPapelera(confirmPapeleraDesg.id)}
        title="Mover a la papelera"
        message={`¿Estás seguro de que quieres mover "${confirmPapeleraDesg?.nombre}" a la papelera? Podrás recuperarlo durante los próximos 30 días.`}
        confirmLabel="Mover a papelera"
      />

    </div>
  );
}
