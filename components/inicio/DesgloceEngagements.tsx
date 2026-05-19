"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  startOfISOWeek, addDays, addWeeks, addMonths,
  subWeeks, subMonths, format, startOfMonth, endOfMonth,
} from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight, ChevronDown, Plus, Pencil, X, Calendar, Users, Building2, AlignLeft, Briefcase, Trash2, Loader2 } from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";
import { EngagementForm } from "@/components/engagements/EngagementForm";
import { ConfirmDialog } from "@/components/ui/Modal";
import { PersonaResumenModal } from "@/components/personas/PersonaResumenModal";
import type { Engagement } from "@/lib/types/database";

// ── Cargos Asociado y Consultor Senior son la misma categoría visual ──
const GRUPO_SENIOR = ["Asociado", "Consultor Senior", "Asociado / Consultor Senior"];
const LABEL_SENIOR = "Asociado / Consultor Senior";
const GRUPO_DIR = ["Director de Proyectos", "Gerente de Proyectos", "Director / Gerente de Proyectos", "Director", "Gerente"];
const LABEL_DIR = "Director / Gerente de Proyectos";

function normalizeCargoDisplay(cargo: string): string {
  if (GRUPO_DIR.includes(cargo)) return LABEL_DIR;
  return GRUPO_SENIOR.includes(cargo) ? LABEL_SENIOR : cargo;
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
  return Array.from({ length: 5 }, (_, i) => {
    const s = addWeeks(inicio, i);
    const fin = addDays(s, 6);
    return { label: format(s, "d MMM", { locale: es }), sublabel: format(fin, "d MMM", { locale: es }), inicio: s, fin };
  });
}
function columnasMes(base: Date): Columna[] {
  return Array.from({ length: 4 }, (_, i) => {
    const m = addMonths(base, i);
    return { label: format(m, "MMM", { locale: es }), sublabel: format(m, "yyyy"), inicio: startOfMonth(m), fin: endOfMonth(m) };
  });
}
function rangoSolapan(aIni: string, aFin: string | null, cIni: Date, cFin: Date) {
  if (!aFin) return new Date(aIni) <= cFin;
  return new Date(aIni) <= cFin && new Date(aFin) >= cIni;
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
    setTimeout(() => setToast(null), 6000);
  };

  // Confirmación de planes
  const [confirmando, setConfirmando] = useState<string | null>(null);

  // Resize de PLAN por manillas
  const [resizing, setResizing] = useState<{ p: PersonaAsig; edge: "start" | "end" } | null>(null);
  const [resizeHoverIdx, setResizeHoverIdx] = useState<number | null>(null);
  const resizeHoverRef = useRef<number | null>(null);

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

  // Popup resumen persona (PersonaResumenModal auto-contenido cuando no se provee onPersonaClick)
  const [avatarPopup, setAvatarPopup] = useState<{ personaId: string; x: number; y: number } | null>(null);

  // Intensidad por engagement (dias_criticos)
  type DcEntry = { fecha: string; fecha_fin: string | null; intensidad: string };
  const [diasCriticosMap, setDiasCriticosMap] = useState<Map<string, DcEntry[]>>(new Map());
  const [quickEdit, setQuickEdit] = useState<{ engId: string; fecha: string; fecha_fin: string; x: number; y: number } | null>(null);
  const instanceId = useRef(Math.random().toString(36).slice(2));
  const INTENSIDAD_COLOR: Record<string, string> = { rojo: "#ef4444", amarillo: "#f59e0b", verde: "#22c55e" };

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
          .select("id, codigo, nombre, cliente, tipo, estado, descripcion, fecha_inicio, fecha_fin_estimada, fecha_fin_real, industria_id")
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

      setEngs([...engMap.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")));
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

  // Clic en avatar de persona asignada → abre PersonaResumenModal o delega al padre
  function handleAvatarClick(e: React.MouseEvent, p: PersonaAsig) {
    e.stopPropagation();
    if (onPersonaClick) { onPersonaClick(p.id); return; }
    setAvatarPopup({ personaId: p.id, x: e.clientX, y: e.clientY });
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

    await (sb as any).from("asignacion").insert({
      engagement_id: eng.id,
      requerimiento_id: (newReq as any).id,
      persona_id: data.personaId,
      cargo_al_momento: cargoRequerido,
      pct_dedicacion: 100,
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
      estado: "activa",
      estado_staffing: "PLAN",
    });

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

    if (!ausPersona || ausPersona.length === 0) {
      // Sin ausencias: inserción normal
      await sb.from("asignacion").insert({
        ...baseInsert,
        fecha_inicio: req.fecha_inicio,
        fecha_fin: req.fecha_fin,
      });
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
        await sb.from("asignacion").insert({ ...baseInsert, ...seg });
      }

      // Toast informativo
      const msgs = (ausPersona as { fecha_inicio: string; fecha_fin: string }[]).map(
        (a) => `del ${a.fecha_inicio} al ${a.fecha_fin}`
      ).join(", ");
      showToast(`${nombre} tiene ausencias ${msgs}. Asignación ajustada automáticamente.`);
    }

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
    await sb.from("asignacion").delete().eq("id", asignacionId);
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

  // Cursor global durante resize
  useEffect(() => {
    document.body.style.cursor = resizing ? "ew-resize" : "";
    return () => { document.body.style.cursor = ""; };
  }, [resizing]);

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
        await sb.from("asignacion")
          .update({ [resizing.edge === "start" ? "fecha_inicio" : "fecha_fin"]: newDate })
          .eq("id", resizing.p.asignacionId);
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
            Nuevo Engagement
          </button>
          {engs.length > 0 && (
            <button
              onClick={colapsados.size === engs.length ? expandirTodos : colapsarTodos}
              className="text-[11px] px-2.5 py-1 rounded-lg border border-gray-100 text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
            >
              {colapsados.size === engs.length ? "Expandir todos" : "Colapsar todos"}
            </button>
          )}
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
            style={{ minWidth: `${180 + columnas.length * 80}px` }}>
            <thead className="sticky top-0 bg-white z-20">
              <tr>
                <th className="text-left pr-3 pb-2 text-gray-400 font-semibold sticky left-0 bg-white z-30" style={{ minWidth: 160 }}>
                  Engagement
                </th>
                {columnas.map((col, i) => {
                  const esHoy = col.inicio <= hoy && hoy <= col.fin;
                  return (
                    <th key={i} className="text-center pb-2 font-semibold"
                      style={{ minWidth: 76, color: esHoy ? "#4a90e2" : "#aaa" }}>
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
                    <td colSpan={columnas.length + 1} className="pt-4 pb-1">
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

                  // Cargos únicos normalizados (Asociado + Consultor Senior → un solo row)
                  const cargosDePersonas = eng.personas.map((p) => normalizeCargoDisplay(p.cargo ?? "Sin cargo"));
                  const cargosDeReqs = eng.reqs
                    .filter((r) => r.cargo_requerido)
                    .map((r) => normalizeCargoDisplay(r.cargo_requerido!));
                  const cargosUnicos = Array.from(new Set([...cargosDePersonas, ...cargosDeReqs]))
                    .sort((a, b) => (JERARQUIA[a] ?? 99) - (JERARQUIA[b] ?? 99));

                  const personaIdsEng = new Set(eng.personas.map((p) => p.id));

                  const separador = ei > 0 ? (
                    <tr key={`sep-${eng.id}`}>
                      <td colSpan={columnas.length + 1} className="py-0.5">
                        <div className="border-t-2 border-gray-100" />
                      </td>
                    </tr>
                  ) : null;

                  const filaHdr = (
                    <tr key={`hdr-${eng.id}`} data-eng-id={eng.id}>
                      <td className="pr-3 pt-2 pb-1 sticky left-0 bg-white z-10">
                        <div className="flex items-center gap-1 group">
                          {/* Chevron colapso */}
                          <button
                            onClick={() => toggleColapso(eng.id)}
                            title={estaColapsado ? "Expandir" : "Colapsar"}
                            className="p-0.5 rounded text-gray-300 hover:text-gray-500 transition-colors flex-shrink-0"
                          >
                            {estaColapsado
                              ? <ChevronRight className="w-3 h-3" />
                              : <ChevronDown className="w-3 h-3" />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <button
                              onClick={() => abrirDetalleEng(eng)}
                              className="font-bold text-[#1a1a2e] truncate max-w-[120px] text-[12px] text-left hover:text-[#4a90e2] hover:underline transition-colors"
                              title="Ver detalle del engagement"
                            >
                              {eng.codigo ? `${eng.codigo}: ${eng.nombre}` : eng.nombre}
                            </button>
                            {eng.cliente && <p className="text-[10px] text-gray-400 truncate max-w-[120px]">{eng.cliente}</p>}
                          </div>
                          <button onClick={() => { setEngToEdit(eng.raw); setFormOpen(true); }}
                            title="Editar engagement"
                            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-gray-100 text-gray-400 transition-opacity flex-shrink-0">
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => setConfirmPapeleraDesg({ id: eng.id, nombre: eng.nombre })}
                            title="Mover a la papelera"
                            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-400 transition-opacity flex-shrink-0">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                      {columnas.map((col, i) => {
                        const esHoy = col.inicio <= hoy && hoy <= col.fin;
                        const activo = rangoSolapan(eng.fecha_inicio, eng.fecha_fin, col.inicio, col.fin);
                        const isDragTarget = dragOverEngId === eng.id;

                        if (!activo) return (
                          <td key={i} className="py-1 px-1"
                            onDragOver={(ev) => { ev.preventDefault(); setDragOverEngId(eng.id); }}
                            onDragLeave={() => setDragOverEngId(null)}
                            onDrop={(ev) => handleDropOnEngagement(ev, eng)} />
                        );

                        const intensidad = resolverIntensidad(eng, col);
                        const barColor = INTENSIDAD_COLOR[intensidad] ?? "#f59e0b";

                        if (!estaColapsado) {
                          return (
                            <td key={i} className="py-1 px-1"
                              style={{ background: isDragTarget ? "#dbeafe" : undefined, borderRadius: 6, transition: "background 0.15s" }}
                              onDragOver={(ev) => { ev.preventDefault(); setDragOverEngId(eng.id); }}
                              onDragLeave={() => setDragOverEngId(null)}
                              onDrop={(ev) => handleDropOnEngagement(ev, eng)}>
                              <div
                                className="h-1.5 rounded-full cursor-pointer hover:h-2.5 transition-all"
                                style={{ background: barColor, opacity: esHoy ? 1 : 0.5 }}
                                title={`${intensidad.charAt(0).toUpperCase() + intensidad.slice(1)} · Clic para cambiar · Arrastra una persona para asignar`}
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  setQuickEdit({
                                    engId: eng.id,
                                    fecha: format(col.inicio, "yyyy-MM-dd"),
                                    fecha_fin: format(col.fin, "yyyy-MM-dd"),
                                    x: ev.clientX, y: ev.clientY,
                                  });
                                }}
                              />
                            </td>
                          );
                        }

                        return (
                          <td key={i} className="py-1 px-0.5"
                            style={{ background: isDragTarget ? "#dbeafe" : undefined, borderRadius: 6, transition: "background 0.15s" }}
                            onDragOver={(ev) => { ev.preventDefault(); setDragOverEngId(eng.id); }}
                            onDragLeave={() => setDragOverEngId(null)}
                            onDrop={(ev) => handleDropOnEngagement(ev, eng)}>
                            <div
                              className="h-5 rounded-full cursor-pointer hover:opacity-100 transition-opacity"
                              style={{ background: barColor, opacity: isDragTarget ? 1 : esHoy ? 1 : 0.75 }}
                              title={`${intensidad.charAt(0).toUpperCase() + intensidad.slice(1)} · Arrastra una persona para asignar`}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                setQuickEdit({
                                  engId: eng.id,
                                  fecha: format(col.inicio, "yyyy-MM-dd"),
                                  fecha_fin: format(col.fin, "yyyy-MM-dd"),
                                  x: ev.clientX, y: ev.clientY,
                                });
                              }}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );

                  const filasCargo = cargosUnicos.flatMap((cargo) => {
                    const personas = eng.personas.filter((p) =>
                      normalizeCargoDisplay(p.cargo ?? "Sin cargo") === cargo
                    );
                    const cargoColor = COLORES[cargo] ?? COLOR_DEFAULT;
                    const confirmados = personas.filter((p) => p.estado_staffing === "CONFIRMADO");

                    const barEdge = (p: PersonaAsig, colIdx: number) => {
                      const prev = columnas[colIdx - 1];
                      const next = columnas[colIdx + 1];
                      return {
                        isFirst: !prev || !rangoSolapan(p.fecha_inicio, p.fecha_fin, prev.inicio, prev.fin),
                        isLast:  !next || !rangoSolapan(p.fecha_inicio, p.fecha_fin, next.inicio, next.fin),
                      };
                    };

                    const planesAll = personas.filter((p) => p.estado_staffing === "PLAN");
                    const totalRowSpan = Math.max(confirmados.length, 1) + Math.max(planesAll.length, 1);

                    const labelCell = (
                      <td rowSpan={totalRowSpan} className="pr-2 py-0 sticky left-0 bg-white z-10 align-top border-r border-gray-100" style={{ minWidth: 110 }}>
                        <p className="text-gray-400 truncate pl-3 text-[11px] font-medium pt-1.5" style={{ maxWidth: 110 }}>{cargo}</p>
                      </td>
                    );

                    // ── Una fila por persona CONFIRMADA ────────────────────
                    const confRows: React.ReactElement[] = confirmados.length > 0
                      ? confirmados.map((p, pi) => (
                          <tr key={`conf-${eng.id}-${cargo}-${pi}`}>
                            {pi === 0 && labelCell}
                            {columnas.map((col, i) => {
                              const esHoy = col.inicio <= hoy && hoy <= col.fin;
                              const isActive = rangoSolapan(p.fecha_inicio, p.fecha_fin, col.inicio, col.fin);
                              const { isFirst, isLast } = barEdge(p, i);
                              return (
                                <td key={i} className="p-0" style={{ height: 28 }}>
                                  {isActive && (
                                    <div className="relative group/bar flex items-center h-6 w-full cursor-pointer overflow-visible"
                                      style={{
                                        backgroundColor: cargoColor,
                                        opacity: desasignando === p.asignacionId ? 0.3 : esHoy ? 1 : 0.85,
                                        borderRadius: `${isFirst ? 6 : 0}px ${isLast ? 6 : 0}px ${isLast ? 6 : 0}px ${isFirst ? 6 : 0}px`,
                                        marginLeft: isFirst ? 2 : 0, marginRight: isLast ? 2 : 0,
                                      }}
                                      onClick={(e) => handleAvatarClick(e, p)}
                                      title={`${p.nombre} ${p.apellido} · ${p.pct}%`}>
                                      {isFirst && <span className="pl-2 text-white text-[10px] font-bold truncate select-none">{iniciales(p.nombre, p.apellido)} <span className="opacity-80 font-normal">{p.apellido}</span></span>}
                                      {isLast  && <span className="ml-auto pr-1.5 text-white text-[9px] opacity-80 select-none">{p.pct}%</span>}
                                      <button onClick={(e) => { e.stopPropagation(); handleDesasignar(p.asignacionId, eng.id); }}
                                        title="Desasignar"
                                        className="absolute top-0 right-0 bottom-0 w-5 flex items-center justify-center opacity-0 group-hover/bar:opacity-100 bg-red-500 transition-opacity z-10"
                                        style={{ borderRadius: `0 ${isLast ? 6 : 0}px ${isLast ? 6 : 0}px 0` }}>
                                        <span className="text-white text-[9px] font-bold">×</span>
                                      </button>
                                      {/* Manillas resize — CONFIRMADO */}
                                      {isFirst && <div onMouseDown={(ev) => { ev.stopPropagation(); setResizing({ p, edge: "start" }); setResizeHoverIdx(i); resizeHoverRef.current = i; focusEngIdRef.current = eng.id; }} className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 rounded-l hover:bg-white/30 transition-colors" />}
                                      {isLast  && <div onMouseDown={(ev) => { ev.stopPropagation(); setResizing({ p, edge: "end"   }); setResizeHoverIdx(i); resizeHoverRef.current = i; focusEngIdRef.current = eng.id; }} className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 rounded-r hover:bg-white/30 transition-colors" />}
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))
                      : [(
                          <tr key={`conf-${eng.id}-${cargo}-empty`}>
                            {labelCell}
                            {columnas.map((col, i) => {
                              const colIniStr = format(col.inicio, "yyyy-MM-dd");
                              const reqsEnCol = eng.reqs.filter((r) =>
                                matchesCargo(r.cargo_requerido, cargo) &&
                                rangoSolapan(r.fecha_inicio, r.fecha_fin, col.inicio, col.fin)
                              );
                              const esColActiva = rangoSolapan(eng.fecha_inicio, eng.fecha_fin, col.inicio, col.fin);
                              const ghostPersonas = (eng.tipo === "ayuda_interna" && esColActiva && reqsEnCol.length === 0)
                                ? personas.filter((p) => p.fecha_fin < colIniStr)
                                    .sort((a, b) => b.fecha_fin.localeCompare(a.fecha_fin))
                                    .filter((p, _, arr) => arr.findIndex((q) => q.id === p.id) === 0)
                                : [];
                              return (
                                <td key={i} className="p-0 align-middle" style={{ height: 28 }}
                                  onDragOver={(e) => { e.preventDefault(); if (reqsEnCol[0]) setDragOverReqId(reqsEnCol[0].id + "-conf"); }}
                                  onDragLeave={() => setDragOverReqId(null)}
                                  onDrop={(e) => { setDragOverReqId(null); if (reqsEnCol[0]) handleDrop(e, eng, reqsEnCol[0], false); }}>
                                  {ghostPersonas.map((p) => {
                                    const { isFirst, isLast } = barEdge(p, i);
                                    const ghostKey = `${eng.id}-${cargo}-${p.id}`;
                                    return (
                                      <div key={`ghost-${p.asignacionId}`}
                                        className="flex items-center h-6 w-full cursor-pointer"
                                        style={{ border: `2px dashed ${cargoColor}80`, borderRadius: `${isFirst ? 6 : 0}px ${isLast ? 6 : 0}px ${isLast ? 6 : 0}px ${isFirst ? 6 : 0}px`, marginLeft: isFirst ? 2 : 0, marginRight: isLast ? 2 : 0, opacity: dragOverGhostKey === ghostKey ? 1 : 0.6 }}
                                        onClick={() => handleGhostClick(eng, cargo, p)}
                                        onDragOver={(e) => { e.preventDefault(); setDragOverGhostKey(ghostKey); }}
                                        onDragLeave={() => setDragOverGhostKey(null)}
                                        onDrop={(e) => handleGhostDrop(e, eng, cargo, p)}>
                                        {isFirst && <span className="pl-2 text-[10px] font-bold" style={{ color: cargoColor }}>{iniciales(p.nombre, p.apellido)}</span>}
                                      </div>
                                    );
                                  })}
                                </td>
                              );
                            })}
                          </tr>
                        )];

                    // ── Una fila exclusiva por persona PLAN ───────────────
                    const planRows: React.ReactElement[] = planesAll.length > 0
                      ? planesAll.map((p, pi) => (
                          <tr key={`plan-${eng.id}-${cargo}-${pi}`}>
                            {columnas.map((col, i) => {
                              const isActive = rangoSolapan(p.fecha_inicio, p.fecha_fin, col.inicio, col.fin);
                              const { isFirst, isLast } = barEdge(p, i);
                              const isResizeHover = resizing?.p.asignacionId === p.asignacionId && resizeHoverIdx === i;
                              const reqsEnCol = eng.reqs.filter((r) =>
                                matchesCargo(r.cargo_requerido, cargo) &&
                                rangoSolapan(r.fecha_inicio, r.fecha_fin, col.inicio, col.fin)
                              );
                              return (
                                <td key={i} className="p-0"
                                  style={{ height: 26, borderTop: "1px dashed #e2e8f0", background: isResizeHover ? "#dbeafe" : "transparent" }}
                                  onMouseEnter={() => { if (resizing) { setResizeHoverIdx(i); resizeHoverRef.current = i; } }}
                                  onDragOver={(e) => { e.preventDefault(); if (!isActive && reqsEnCol[0]) setDragOverReqId(reqsEnCol[0].id + "-plan"); }}
                                  onDragLeave={() => setDragOverReqId(null)}
                                  onDrop={(e) => { setDragOverReqId(null); if (!isActive && reqsEnCol[0]) handleDrop(e, eng, reqsEnCol[0], true); }}>
                                  {isActive && (
                                    <div className="relative group/bar flex items-center overflow-visible"
                                      style={{
                                        height: 20, marginTop: 3,
                                        backgroundColor: `${cargoColor}55`,
                                        border: `1.5px dashed ${cargoColor}`,
                                        borderRadius: `${isFirst ? 5 : 0}px ${isLast ? 5 : 0}px ${isLast ? 5 : 0}px ${isFirst ? 5 : 0}px`,
                                        marginLeft: isFirst ? 2 : 0, marginRight: isLast ? 2 : 0,
                                        opacity: desasignando === p.asignacionId ? 0.2 : 1,
                                      }}
                                      title={`PLAN · ${p.nombre} ${p.apellido} · ${p.pct}%`}>
                                      {isFirst && <span className="pl-2 text-[9px] font-bold truncate select-none" style={{ color: cargoColor }}>{iniciales(p.nombre, p.apellido)} <span className="opacity-70 font-normal">{p.apellido}</span></span>}
                                      {isFirst && (
                                        <button onClick={() => confirmarPlan(p, eng.id)} disabled={confirmando === p.asignacionId}
                                          title="Confirmar — sube a Línea Oficial"
                                          className="absolute -top-1.5 left-0 h-3.5 px-1 rounded-sm bg-green-500 text-white flex items-center z-10 hover:bg-green-600 disabled:opacity-50 text-[8px] font-bold">
                                          ✓
                                        </button>
                                      )}
                                      <button onClick={(e) => { e.stopPropagation(); handleDesasignar(p.asignacionId, eng.id); }}
                                        title="Quitar del plan"
                                        className="absolute top-0 right-0 bottom-0 w-4 flex items-center justify-center opacity-0 group-hover/bar:opacity-100 bg-red-400 transition-opacity z-10"
                                        style={{ borderRadius: `0 ${isLast ? 5 : 0}px ${isLast ? 5 : 0}px 0` }}>
                                        <span className="text-white text-[8px] font-bold">×</span>
                                      </button>
                                      {isFirst && <div onMouseDown={(ev) => { ev.stopPropagation(); setResizing({ p, edge: "start" }); setResizeHoverIdx(i); resizeHoverRef.current = i; focusEngIdRef.current = eng.id; }} className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 rounded-l-sm hover:bg-blue-400 transition-colors" />}
                                      {isLast  && <div onMouseDown={(ev) => { ev.stopPropagation(); setResizing({ p, edge: "end"   }); setResizeHoverIdx(i); resizeHoverRef.current = i; focusEngIdRef.current = eng.id; }} className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 rounded-r-sm hover:bg-blue-400 transition-colors" />}
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))
                      : [(
                          <tr key={`plan-${eng.id}-${cargo}-empty`}>
                            {columnas.map((col, i) => {
                              const reqsEnCol = eng.reqs.filter((r) =>
                                matchesCargo(r.cargo_requerido, cargo) &&
                                rangoSolapan(r.fecha_inicio, r.fecha_fin, col.inicio, col.fin)
                              );
                              const hayReq = reqsEnCol.length > 0;
                              return (
                                <td key={i} className="p-0 align-middle" style={{ height: 26, borderTop: "1px dashed #e2e8f0" }}
                                  onDragOver={(e) => { e.preventDefault(); if (reqsEnCol[0]) setDragOverReqId(reqsEnCol[0].id + "-plan"); }}
                                  onDragLeave={() => setDragOverReqId(null)}
                                  onDrop={(e) => { setDragOverReqId(null); if (reqsEnCol[0]) handleDrop(e, eng, reqsEnCol[0], true); }}>
                                  {hayReq && (
                                    <div className="flex items-center justify-center w-full" style={{ height: 20, border: `1px dashed ${cargoColor}40`, borderRadius: 4, margin: "3px 2px 0" }}>
                                      <span className="text-[9px]" style={{ color: `${cargoColor}60` }}>sim</span>
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        )];

                    return [...confRows, ...planRows];
                  });

                  const filaAusentes = (
                    <tr key={`aus-${eng.id}`}>
                      <td className="pr-3 py-0.5 sticky left-0 bg-white z-10">
                        <p className="text-orange-400 pl-3 text-[11px]">Ausentes</p>
                      </td>
                      {columnas.map((col, i) => {
                        const ausentesEnCol = ausencias.filter((a) =>
                          personaIdsEng.has(a.persona_id) &&
                          rangoSolapan(a.fecha_inicio, a.fecha_fin, col.inicio, col.fin)
                        );
                        const vistos = new Set<string>();
                        const ausUnicos = ausentesEnCol.reduce<PersonaAsig[]>((acc, a) => {
                          if (vistos.has(a.persona_id)) return acc;
                          vistos.add(a.persona_id);
                          const p = eng.personas.find((pe) => pe.id === a.persona_id);
                          if (p) acc.push(p);
                          return acc;
                        }, []);
                        return (
                          <td key={i} className="py-0.5 px-1">
                            <div className="flex flex-wrap gap-1 justify-center min-h-[28px] items-center">
                              {ausUnicos.map((p) => (
                                <div key={p.id} title={`${p.nombre} ${p.apellido} — ausente`}
                                  className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold"
                                  style={{ background: "#fed7aa", color: "#c2410c" }}>
                                  {iniciales(p.nombre, p.apellido)}
                                </div>
                              ))}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );

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

      {/* ── Popup resumen persona completo (tablero, sin onPersonaClick) ── */}
      {avatarPopup && !onPersonaClick && (
        <PersonaResumenModal
          personaId={avatarPopup.personaId}
          anchorX={avatarPopup.x}
          anchorY={avatarPopup.y}
          onClose={() => setAvatarPopup(null)}
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
