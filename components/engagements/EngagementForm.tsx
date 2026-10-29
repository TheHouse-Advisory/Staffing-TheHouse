"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Plus, Trash2, ChevronDown, ChevronUp, Users, CalendarDays, Pencil } from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";
import { Drawer } from "@/components/ui/Drawer";
import { Button } from "@/components/ui/Button";
import { Modal, ConfirmDialog } from "@/components/ui/Modal";
import { FieldWrapper, Input, Select, Textarea } from "@/components/ui/FormField";
import { MultiSelect } from "@/components/ui/MultiSelect";
import { CARGOS_OPTIONS } from "@/lib/constants";
import { fLocal } from "@/lib/utils";
import { fetchAsignacionesEngagement, fetchAusenciasPersonas, construirEventosTimelineForm, crearExtensionEngagement } from "@/lib/queries/engagements";

// Normaliza cargo_requerido de la BD al value exacto de CARGOS_OPTIONS.
// Reqs creados via drag-drop guardan cargos individuales ("Director de Proyectos")
// pero CARGOS_OPTIONS usa valores combinados ("Director / Gerente de Proyectos").
// Sin esta normalización el Select no encuentra el match y cae al primer item ("Socio").
const CARGO_TO_OPTION: Record<string, string> = {
  "Director de Proyectos":          "Director / Gerente de Proyectos",
  "Gerente de Proyectos":           "Director / Gerente de Proyectos",
  "Director":                       "Director / Gerente de Proyectos",
  "Gerente":                        "Director / Gerente de Proyectos",
  "Director / Gerente de Proyectos":"Director / Gerente de Proyectos",
  "Asociado":                       "Asociado / Consultor Senior",
  "Consultor Senior":               "Asociado / Consultor Senior",
  "Asociado / Consultor Senior":    "Asociado / Consultor Senior",
};
function toCargoOption(cargo: string | null | undefined): string {
  if (!cargo?.trim()) return "";
  return CARGO_TO_OPTION[cargo.trim()] ?? cargo.trim();
}
// Reverse: opción del select → valor canónico para guardar en BD (un valor válido del FK)
const OPTION_TO_CARGO: Record<string, string> = {
  "Director / Gerente de Proyectos": "Director de Proyectos",
  "Asociado / Consultor Senior":     "Asociado",
};
function fromCargoOption(option: string): string {
  return OPTION_TO_CARGO[option] ?? option;
}
// Orden jerárquico de "Equipo del proyecto": Socio > Director/Gerente > Asociado/Consultor Senior >
// Consultor de Proyectos > Consultor Analista > Trainee > Desarrollo (mismo orden de CARGOS_OPTIONS).
// Sin cargo asignado ("Cualquier cargo") queda al final.
const ORDEN_CARGOS_EQUIPO = CARGOS_OPTIONS.map((o) => o.value);
function ordenCargoEquipo(cargo: string): number {
  const idx = ORDEN_CARGOS_EQUIPO.indexOf(cargo);
  return idx === -1 ? ORDEN_CARGOS_EQUIPO.length : idx;
}
import type { Engagement, RequerimientoEngagement } from "@/lib/types/database";
import { ExtenderProyecto, eliminarExtensionConEquipo } from "./ExtenderProyecto";

interface ReqRow {
  id?: string;
  fase_nombre: string;
  cargo_requerido: string;
  descripcion: string;
  pct_dedicacion: string;
  fecha_inicio: string;
  fecha_fin: string;
  /** Nombre de la persona asignada activamente a este req (si existe) */
  persona_nombre?: string;
  /** Solo en simulación: períodos de ausencia dentro del rango (para badge informativo) */
  ausenciasPeriodo?: { desde: string; hasta: string }[];
  /** Si viene de una asignación directa sin requerimiento_engagement vinculado: id de esa
   * asignación (para editarla/eliminarla directo) y de la persona. */
  asignacionId?: string;
  personaId?: string;
  /** Asignación de otra persona sobre un requerimiento compartido: id de ese requerimiento
   * (para no borrarlo como huérfano). */
  reqVinculadoId?: string;
}

// Arma las filas de "Equipo del proyecto" desde la BD. Si varias personas comparten un
// requerimiento, la primera queda en la fila del requerimiento y las demás como filas propias
// (asignacionId), para que cada una se vea y se pueda quitar sin afectar a las otras.
function armarFilasEquipo(reqData: RequerimientoEngagement[], asigRows: any[]): ReqRow[] {
  const personaPorReq = new Map<string, { nombre: string; personaId: string }>();
  for (const a of asigRows) {
    if (a.requerimiento_id && a.persona && !personaPorReq.has(a.requerimiento_id)) {
      personaPorReq.set(a.requerimiento_id, { nombre: `${a.persona.nombre} ${a.persona.apellido}`, personaId: a.persona_id });
    }
  }
  const filaAsignacion = (a: any, reqVinculadoId?: string): ReqRow => ({
    asignacionId: a.id,
    personaId: a.persona_id,
    reqVinculadoId,
    fase_nombre: "",
    cargo_requerido: toCargoOption(a.cargo_al_momento ?? a.persona.cargo_actual ?? ""),
    descripcion: "",
    pct_dedicacion: String(a.pct_dedicacion),
    fecha_inicio: a.fecha_inicio,
    fecha_fin: a.fecha_fin ?? "",
    persona_nombre: `${a.persona.nombre} ${a.persona.apellido}`,
  });
  const filasReq: ReqRow[] = reqData.map((r) => {
    const asignado = r.id ? personaPorReq.get(r.id) : undefined;
    return {
      id: r.id,
      fase_nombre: r.fase_nombre ?? "",
      cargo_requerido: toCargoOption(r.cargo_requerido),
      descripcion: r.descripcion ?? "",
      pct_dedicacion: String(r.pct_dedicacion),
      fecha_inicio: r.fecha_inicio ?? "",
      fecha_fin: r.fecha_fin ?? "",
      persona_nombre: asignado?.nombre,
      personaId: asignado?.personaId,
    };
  });
  // Asignaciones de otras personas sobre un requerimiento ya mostrado
  const filasCompartidas = asigRows
    .filter((a) => a.requerimiento_id && a.persona && personaPorReq.get(a.requerimiento_id)?.personaId !== a.persona_id)
    .map((a) => filaAsignacion(a, a.requerimiento_id));
  // Asignaciones directas sin requerimiento: se editan con UPDATE directo sobre `asignacion`
  const filasDirectas = asigRows.filter((a) => !a.requerimiento_id && a.persona).map((a) => filaAsignacion(a));
  return [...filasReq, ...filasCompartidas, ...filasDirectas];
}

interface ActividadRow {
  id?: string;
  tipo: "Viajes" | "Taller" | "";
  titulo: string;
  descripcion: string;
  fecha_inicio: string;
  fecha_fin: string;
}
const EMPTY_ACTIVIDAD: ActividadRow = { tipo: "", titulo: "", descripcion: "", fecha_inicio: "", fecha_fin: "" };

interface EngagementFormProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  engagement?: Engagement;
  /** Simulación: skip Supabase, devuelve los datos del form al padre */
  simulationMode?: boolean;
  onSimSuccess?: (eng: { id: string; codigo: string | null; nombre: string; cliente: string; tipo: string; fecha_inicio: string; fecha_fin: string; reqs: ReqRow[]; actividades: ActividadRow[] }) => void;
  /** Reqs del snapshot local (simulación): evita recargar desde Supabase real */
  simulationReqs?: ReqRow[];
  /** Actividades del snapshot local (simulación): evita recargar desde Supabase real */
  simulationActividades?: ActividadRow[];
}

const EMPTY_ENG = {
  codigo: "", nombre: "", cliente: "", tipo: "proyecto", estado: "activo",
  descripcion: "", fecha_inicio: "", fecha_fin_estimada: "", industria_id: "",
  capacidades: [] as string[],
  tematicas: [] as string[],
};

const EMPTY_REQ: ReqRow = {
  fase_nombre: "", cargo_requerido: "", descripcion: "",
  pct_dedicacion: "100", fecha_inicio: "", fecha_fin: "",
};

export function EngagementForm({ open, onClose, onSuccess, engagement, simulationMode = false, onSimSuccess, simulationReqs, simulationActividades }: EngagementFormProps) {
  const router = useRouter();
  const [form, setForm] = useState({ ...EMPTY_ENG });
  const [reqs, setReqs] = useState<ReqRow[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  // id del proyecto ya creado en este formulario, para que un reintento no lo duplique
  const creadoIdRef = useRef<string | null>(null);
  useEffect(() => { if (open) { creadoIdRef.current = null; extendidoRef.current = false; } }, [open]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [industrias, setIndustrias] = useState<{ value: string; label: string }[]>([]);
  const [capacidadesOpts, setCapacidadesOpts] = useState<{ value: string; label: string }[]>([]);
  const [tematicasOpts, setTematicasOpts] = useState<{ value: string; label: string }[]>([]);
  // Catálogo desactivado en Configuración: antes el proyecto que la tenía mostraba "Sin industria"
  const [industriasInactivas, setIndustriasInactivas] = useState<{ value: string; label: string }[]>([]);
  const [tematicasInactivas, setTematicasInactivas] = useState<{ value: string; label: string }[]>([]);

  const [extOpen, setExtOpen] = useState(false);
  // Sección "Equipo del proyecto": colapsada por defecto al abrir el formulario
  const [equipoOpen, setEquipoOpen] = useState(false);
  // Switch rápido de extensión (bajo Descripción): alternativa simple a "Extender Proyecto"
  const [mostrarExtension, setMostrarExtension] = useState(false);
  const [extFechaInicio, setExtFechaInicio] = useState("");
  const [extFechaFin, setExtFechaFin] = useState("");
  // id de la extensión ya guardada en BD (si existe) — determina update vs insert al guardar
  const [extId, setExtId] = useState<string | null>(null);
  const [nuevaIndustriaOpen, setNuevaIndustriaOpen] = useState(false);
  const [nuevaIndustriaNombre, setNuevaIndustriaNombre] = useState("");
  const [nuevaIndustriaLoading, setNuevaIndustriaLoading] = useState(false);
  const [nuevaIndustriaError, setNuevaIndustriaError] = useState<string | null>(null);
  const [showEliminarLista, setShowEliminarLista] = useState(false);
  const [eliminarCandidata, setEliminarCandidata] = useState<{ value: string; label: string } | null>(null);
  const [eliminarCheck, setEliminarCheck] = useState<{ loading: boolean; count: number }>({ loading: false, count: 0 });
  const [eliminarLoading, setEliminarLoading] = useState(false);
  // Capacidades
  const [nuevaCapacidadOpen, setNuevaCapacidadOpen] = useState(false);
  const [nuevaCapacidadNombre, setNuevaCapacidadNombre] = useState("");
  const [nuevaCapacidadLoading, setNuevaCapacidadLoading] = useState(false);
  const [nuevaCapacidadError, setNuevaCapacidadError] = useState<string | null>(null);
  const [showEliminarCapLista, setShowEliminarCapLista] = useState(false);
  const [eliminarCapCandidata, setEliminarCapCandidata] = useState<{ value: string; label: string } | null>(null);
  const [eliminarCapCheck, setEliminarCapCheck] = useState<{ loading: boolean; count: number }>({ loading: false, count: 0 });
  const [eliminarCapLoading, setEliminarCapLoading] = useState(false);
  // Temáticas
  const [nuevaTematicaOpen, setNuevaTematicaOpen] = useState(false);
  const [nuevaTematicaNombre, setNuevaTematicaNombre] = useState("");
  const [nuevaTematicaLoading, setNuevaTematicaLoading] = useState(false);
  const [nuevaTematicaError, setNuevaTematicaError] = useState<string | null>(null);
  const [showEliminarTemLista, setShowEliminarTemLista] = useState(false);
  const [eliminarTemCandidata, setEliminarTemCandidata] = useState<{ value: string; label: string } | null>(null);
  const [eliminarTemCheck, setEliminarTemCheck] = useState<{ loading: boolean; count: number }>({ loading: false, count: 0 });
  const [eliminarTemLoading, setEliminarTemLoading] = useState(false);
  // Actividades
  const [actividades, setActividades] = useState<ActividadRow[]>([]);
  const [actividadOpen, setActividadOpen] = useState(false);
  const [nuevaActividad, setNuevaActividad] = useState<ActividadRow>({ ...EMPTY_ACTIVIDAD });
  const [confirmActFuera, setConfirmActFuera] = useState(false);
  const [editingActividadIdx, setEditingActividadIdx] = useState<number | null>(null);
  // Acordeón de requerimientos: set de índices colapsados
  const [reqsColapsados, setReqsColapsados] = useState<Set<number>>(new Set());
  // Ids de asignaciones directas (sin requerimiento_engagement) que el usuario quitó de la lista
  const [asignacionesAEliminar, setAsignacionesAEliminar] = useState<string[]>([]);
  // Ausencias por persona, para intercalarlas cronológicamente en su tarjeta de "Equipo del proyecto"
  const [ausenciasPorPersona, setAusenciasPorPersona] = useState<Map<string, { inicio: string; fin: string; tipo: string }[]>>(new Map());
  // Persona quitada de un requerimiento compartido: se borran solo sus asignaciones de ese req
  const [asigPersonaReqAEliminar, setAsigPersonaReqAEliminar] = useState<{ reqId: string; personaId: string }[]>([]);
  // Fechas guardadas del alargue rápido (para mover al equipo si cambian)
  const [extPrev, setExtPrev] = useState<{ inicio: string; fin: string } | null>(null);
  const [confirmQuitarExt, setConfirmQuitarExt] = useState(false);
  // Se guardó una extensión desde "Extender Proyecto" sin cerrar el formulario
  const extendidoRef = useRef(false);

  // Ausencias de las personas con tramo en este engagement, para intercalarlas en su tarjeta
  async function cargarAusencias(supabase: any, filas: ReqRow[]) {
    const personaIds = [...new Set(filas.map((r) => r.personaId).filter(Boolean))] as string[];
    const { data: ausenciasData } = await fetchAusenciasPersonas(supabase, personaIds);
    const mapaAusencias = new Map<string, { inicio: string; fin: string; tipo: string }[]>();
    for (const a of ausenciasData) {
      const arr = mapaAusencias.get(a.persona_id) ?? [];
      arr.push({ inicio: a.fecha_inicio, fin: a.fecha_fin, tipo: a.tipo });
      mapaAusencias.set(a.persona_id, arr);
    }
    setAusenciasPorPersona(mapaAusencias);
  }

  // Tras "Extender Proyecto": agrega al equipo lo nuevo de la BD sin perder lo editado en pantalla
  async function recargarEquipo() {
    if (!engagement) return;
    extendidoRef.current = true;
    const supabase = createAnyClient();
    const [{ data: reqData }, asigResult, { data: extRows }] = await Promise.all([
      supabase.from("requerimiento_engagement").select("*").eq("engagement_id", engagement.id).order("fase_nombre"),
      fetchAsignacionesEngagement(supabase, engagement.id),
      (supabase as any).from("engagement_extension").select("id, fecha_inicio, fecha_fin")
        .eq("engagement_id", engagement.id).order("created_at", { ascending: false }).limit(1),
    ]);
    const frescas = armarFilasEquipo((reqData ?? []) as RequerimientoEngagement[], asigResult.data);
    const nuevas = frescas.filter((f) => !reqs.some((r) =>
      (f.id && !f.asignacionId && r.id === f.id) || (f.asignacionId && r.asignacionId === f.asignacionId)));
    const combinadas = [...reqs, ...nuevas];
    setReqs(combinadas);
    await cargarAusencias(supabase, combinadas);
    const ext = ((extRows ?? []) as { id: string; fecha_inicio: string; fecha_fin: string }[])[0];
    if (ext) {
      setMostrarExtension(true); setExtId(ext.id);
      setExtFechaInicio(ext.fecha_inicio); setExtFechaFin(ext.fecha_fin);
      setExtPrev({ inicio: ext.fecha_inicio, fin: ext.fecha_fin });
    }
  }

  // Cerrar: si hubo extensión, avisa al padre para que recargue
  const cerrar = () => {
    if (extendidoRef.current) { extendidoRef.current = false; onSuccess(); }
    onClose();
  };

  useEffect(() => {
    if (!open) {
      setForm({ ...EMPTY_ENG }); setReqs([]); setErrors({}); setServerError(null);
      setAsignacionesAEliminar([]); setAusenciasPorPersona(new Map());
      setAsigPersonaReqAEliminar([]); setExtPrev(null); setConfirmQuitarExt(false);
      setExtOpen(false); setEquipoOpen(false); setActividades([]); setActividadOpen(false); setNuevaActividad({ ...EMPTY_ACTIVIDAD }); setEditingActividadIdx(null);
      setMostrarExtension(false); setExtFechaInicio(""); setExtFechaFin(""); setExtId(null);
      return;
    }
    async function load() {
      const supabase = createAnyClient();
      const [iData, capData, temData] = await Promise.all([
        supabase.from("cat_industria").select("id,nombre,activo").order("nombre"),
        supabase.from("cat_capacidad").select("id,nombre").eq("activo", true).order("nombre"),
        supabase.from("cat_tematica").select("id,nombre,activo").order("nombre"),
      ]);
      // Activas para elegir; las inactivas se guardan aparte para mostrarlas solo si el proyecto ya las tiene
      const opcion = (r: any) => ({ value: r.id, label: r.nombre });
      const opcionInactiva = (r: any) => ({ value: r.id, label: `${r.nombre} (inactiva)` });
      setIndustrias((iData.data ?? []).filter((r: any) => r.activo).map(opcion));
      setIndustriasInactivas((iData.data ?? []).filter((r: any) => !r.activo).map(opcionInactiva));
      setCapacidadesOpts((capData.data ?? []).map(opcion));
      setTematicasOpts((temData.data ?? []).filter((r: any) => r.activo).map(opcion));
      setTematicasInactivas((temData.data ?? []).filter((r: any) => !r.activo).map(opcionInactiva));

      if (engagement) {
        const [{ data: reqData }, { data: ecData }, { data: etData }, asigResult, { data: extRows }] = await Promise.all([
          supabase.from("requerimiento_engagement").select("*").eq("engagement_id", engagement.id).order("fase_nombre"),
          (supabase as any).from("engagement_capacidad").select("capacidad_id").eq("engagement_id", engagement.id),
          (supabase as any).from("engagement_tematica").select("tematica_id").eq("engagement_id", engagement.id),
          fetchAsignacionesEngagement(supabase, engagement.id),
          (supabase as any).from("engagement_extension")
            .select("id, fecha_inicio, fecha_fin")
            .eq("engagement_id", engagement.id)
            .order("created_at", { ascending: false })
            .limit(1),
        ]);

        // Hidrata el switch de extensión rápida con el registro más reciente (si existe)
        const ext = ((extRows ?? []) as { id: string; fecha_inicio: string; fecha_fin: string }[])[0];
        setMostrarExtension(!!ext);
        setExtId(ext?.id ?? null);
        setExtFechaInicio(ext?.fecha_inicio ?? "");
        setExtFechaFin(ext?.fecha_fin ?? "");

        setExtPrev(ext ? { inicio: ext.fecha_inicio, fin: ext.fecha_fin } : null);
        setForm({
          codigo: engagement.codigo ?? "",
          nombre: engagement.nombre,
          cliente: engagement.cliente,
          tipo: engagement.tipo,
          estado: engagement.estado,
          descripcion: engagement.descripcion ?? "",
          fecha_inicio: engagement.fecha_inicio ?? "",
          // fecha_fin_estimada puede estar ausente en raw de sim_eng_* → fallback a fecha_fin
          fecha_fin_estimada: ((engagement.fecha_fin_estimada ?? (engagement as any).fecha_fin ?? "") as string).slice(0, 10),
          industria_id: engagement.industria_id ?? "",
          capacidades: (ecData ?? []).map((r: any) => r.capacidad_id),
          tematicas: (etData ?? []).map((r: any) => r.tematica_id),
        });
        // En simulación: consolida solo tramos ADYACENTES del mismo cargo (gap ≤ 90 días).
        // Tramos de personas distintas con el mismo cargo NO se fusionan.
        if (simulationMode && simulationReqs) {
          const sortedReqs = [...simulationReqs].sort((a, b) =>
            (a.fecha_inicio ?? "").localeCompare(b.fecha_inicio ?? "")
          );
          const consolidados: ReqRow[] = [];

          for (const r of sortedReqs) {
            const cargoNorm = (r.cargo_requerido ?? "").trim().toLowerCase();
            // Buscar grupo existente del mismo cargo cuya fecha_fin sea adyacente (gap ≤ 90 días)
            const grupoIdx = consolidados.findIndex((c) => {
              const cCargo = typeof c.cargo_requerido === "object"
                ? (c.cargo_requerido as any)?.value?.trim().toLowerCase()
                : (c.cargo_requerido ?? "").trim().toLowerCase();
              if (cCargo !== cargoNorm) return false;
              if (!c.fecha_fin || !r.fecha_inicio) return false;
              const gapDias = (new Date(r.fecha_inicio + "T00:00:00").getTime() -
                               new Date(c.fecha_fin    + "T00:00:00").getTime()) / 86400000;
              return gapDias > 0 && gapDias <= 90;
            });

            if (grupoIdx !== -1) {
              const g = consolidados[grupoIdx];
              const dFinGap = new Date(g.fecha_fin + "T00:00:00");
              dFinGap.setDate(dFinGap.getDate() + 1);
              const dIniGap = new Date(r.fecha_inicio + "T00:00:00");
              dIniGap.setDate(dIniGap.getDate() - 1);
              consolidados[grupoIdx] = {
                ...g,
                fecha_fin: r.fecha_fin ?? g.fecha_fin,
                ausenciasPeriodo: [
                  ...(g.ausenciasPeriodo ?? []),
                  { desde: dFinGap.toISOString().split("T")[0], hasta: dIniGap.toISOString().split("T")[0] },
                ],
              };
            } else {
              consolidados.push({
                id: r.id,
                fase_nombre: r.fase_nombre ?? "",
                cargo_requerido: toCargoOption(r.cargo_requerido ?? ""),
                descripcion: r.descripcion ?? "",
                pct_dedicacion: String(r.pct_dedicacion ?? 100),
                fecha_inicio: r.fecha_inicio ?? "",
                fecha_fin: r.fecha_fin ?? "",
                persona_nombre: (r as any).persona_nombre,
              });
            }
          }
          setReqs(consolidados);
        } else {
          const todosLosReqs = armarFilasEquipo((reqData ?? []) as RequerimientoEngagement[], asigResult.data);
          setReqs(todosLosReqs);
          await cargarAusencias(supabase, todosLosReqs);
        }
        // En simulación: usar actividades del snapshot local
        if (simulationMode && simulationActividades) {
          setActividades(simulationActividades);
        } else {
          const { data: actData } = await (supabase as any)
            .from("engagement_actividades").select("*").eq("engagement_id", engagement.id).order("fecha_inicio");
          setActividades((actData ?? []).map((a: any) => ({
            id: a.id, tipo: a.tipo, titulo: a.titulo,
            descripcion: a.descripcion ?? "", fecha_inicio: a.fecha_inicio, fecha_fin: a.fecha_fin,
          })));
        }
      }
    }
    load();
  }, [open, engagement]);

  const setField = (field: string) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => setForm((f) => ({ ...f, [field]: e.target.value }));

  /** Desplaza una fecha ISO en N días */
  const shiftDate = (fecha: string, deltaDays: number): string => {
    const d = new Date(fecha + "T00:00:00");
    d.setDate(d.getDate() + deltaDays);
    return d.toISOString().split("T")[0];
  };

  // Cambia fecha_inicio: en simulación los reqs adoptan la misma fecha del engagement
  const handleFechaInicioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nuevo = e.target.value;
    setForm((f) => ({ ...f, fecha_inicio: nuevo }));
    if (!nuevo) return;
    if (simulationMode) {
      // Reqs adoptan exactamente la nueva fecha de inicio del engagement
      setReqs((prev) => prev.map((r) => ({ ...r, fecha_inicio: nuevo })));
    } else {
      setReqs((prev) => prev.map((r) =>
        r.fecha_inicio && r.fecha_inicio < nuevo ? { ...r, fecha_inicio: nuevo } : r
      ));
    }
  };

  // Cambia fecha_fin_estimada: en simulación los reqs adoptan la misma fecha del engagement
  const applyFechaFin = (nuevo: string) => {
    setForm((f) => ({ ...f, fecha_fin_estimada: nuevo }));
    if (!nuevo) return;
    if (simulationMode) {
      // Reqs adoptan exactamente la nueva fecha de fin del engagement
      setReqs((prev) => prev.map((r) => ({ ...r, fecha_fin: nuevo })));
    } else {
      setReqs((prev) => prev.map((r) =>
        r.fecha_fin && r.fecha_fin > nuevo ? { ...r, fecha_fin: nuevo } : r
      ));
    }
  };
  const handleFechaFinChange = (e: React.ChangeEvent<HTMLInputElement>) => applyFechaFin(e.target.value);

  async function guardarNuevaIndustria() {
    const nombre = nuevaIndustriaNombre.trim();
    if (!nombre) { setNuevaIndustriaError("El nombre es obligatorio."); return; }
    setNuevaIndustriaLoading(true);
    setNuevaIndustriaError(null);
    const supabase = createAnyClient();
    const { data, error } = await supabase
      .from("cat_industria")
      .insert({ nombre, activo: true })
      .select("id, nombre")
      .single();
    setNuevaIndustriaLoading(false);
    if (error || !data) {
      setNuevaIndustriaError(error?.message ?? "Error al guardar.");
      return;
    }
    const nueva = { value: (data as any).id, label: (data as any).nombre };
    setIndustrias((prev) => [...prev, nueva].sort((a, b) => a.label.localeCompare(b.label, "es")));
    setForm((f) => ({ ...f, industria_id: (data as any).id }));
    setNuevaIndustriaNombre("");
    setNuevaIndustriaOpen(false);
  }

  async function abrirEliminarIndustria(ind: { value: string; label: string }) {
    setEliminarCandidata(ind);
    setEliminarCheck({ loading: true, count: 0 });
    const supabase = createAnyClient();
    const { count } = await (supabase as any)
      .from("engagement")
      .select("id", { count: "exact", head: true })
      .eq("industria_id", ind.value);
    setEliminarCheck({ loading: false, count: count ?? 0 });
  }

  async function confirmarEliminarIndustria() {
    if (!eliminarCandidata) return;
    setEliminarLoading(true);
    const supabase = createAnyClient();
    const { error: delErr } = await (supabase as any).from("cat_industria").update({ activo: false }).eq("id", eliminarCandidata.value);
    // Si la base rechaza, se cierra el diálogo y se muestra el error en el formulario sin tocar la lista
    if (delErr) { setServerError(`No se pudo eliminar la industria: ${delErr.message}`); setEliminarLoading(false); setEliminarCandidata(null); return; }
    setIndustrias((prev) => prev.filter((i) => i.value !== eliminarCandidata.value));
    if (form.industria_id === eliminarCandidata.value) setForm((f) => ({ ...f, industria_id: "" }));
    setEliminarLoading(false);
    setEliminarCandidata(null);
  }

  // ── Capacidades ─────────────────────────────────────────────
  async function guardarNuevaCapacidad() {
    const nombre = nuevaCapacidadNombre.trim();
    if (!nombre) { setNuevaCapacidadError("El nombre es obligatorio."); return; }
    setNuevaCapacidadLoading(true); setNuevaCapacidadError(null);
    const supabase = createAnyClient();
    const { data, error } = await (supabase as any).from("cat_capacidad").insert({ nombre, activo: true }).select("id,nombre").single();
    setNuevaCapacidadLoading(false);
    if (error || !data) { setNuevaCapacidadError(error?.message ?? "Error al guardar."); return; }
    const nueva = { value: (data as any).id, label: (data as any).nombre };
    setCapacidadesOpts((prev) => [...prev, nueva].sort((a, b) => a.label.localeCompare(b.label, "es")));
    setForm((f) => ({ ...f, capacidades: [...f.capacidades, (data as any).id] }));
    setNuevaCapacidadNombre(""); setNuevaCapacidadOpen(false);
  }
  async function abrirEliminarCapacidad(opt: { value: string; label: string }) {
    setEliminarCapCandidata(opt); setEliminarCapCheck({ loading: true, count: 0 });
    const supabase = createAnyClient();
    const { count } = await (supabase as any).from("engagement_capacidad").select("engagement_id", { count: "exact", head: true }).eq("capacidad_id", opt.value);
    setEliminarCapCheck({ loading: false, count: count ?? 0 });
  }
  async function confirmarEliminarCapacidad() {
    if (!eliminarCapCandidata) return;
    setEliminarCapLoading(true);
    const supabase = createAnyClient();
    const { error: delErr } = await (supabase as any).from("cat_capacidad").update({ activo: false }).eq("id", eliminarCapCandidata.value);
    if (delErr) { setServerError(`No se pudo eliminar la capacidad: ${delErr.message}`); setEliminarCapLoading(false); setEliminarCapCandidata(null); return; }
    setCapacidadesOpts((prev) => prev.filter((i) => i.value !== eliminarCapCandidata.value));
    setForm((f) => ({ ...f, capacidades: f.capacidades.filter((id) => id !== eliminarCapCandidata.value) }));
    setEliminarCapLoading(false); setEliminarCapCandidata(null);
  }

  // ── Temáticas ────────────────────────────────────────────────
  async function guardarNuevaTematica() {
    const nombre = nuevaTematicaNombre.trim();
    if (!nombre) { setNuevaTematicaError("El nombre es obligatorio."); return; }
    setNuevaTematicaLoading(true); setNuevaTematicaError(null);
    const supabase = createAnyClient();
    const { data, error } = await (supabase as any).from("cat_tematica").insert({ nombre, activo: true }).select("id,nombre").single();
    setNuevaTematicaLoading(false);
    if (error || !data) { setNuevaTematicaError(error?.message ?? "Error al guardar."); return; }
    const nueva = { value: (data as any).id, label: (data as any).nombre };
    setTematicasOpts((prev) => [...prev, nueva].sort((a, b) => a.label.localeCompare(b.label, "es")));
    setForm((f) => ({ ...f, tematicas: [...f.tematicas, (data as any).id] }));
    setNuevaTematicaNombre(""); setNuevaTematicaOpen(false);
  }
  async function abrirEliminarTematica(opt: { value: string; label: string }) {
    setEliminarTemCandidata(opt); setEliminarTemCheck({ loading: true, count: 0 });
    const supabase = createAnyClient();
    const { count } = await (supabase as any).from("engagement_tematica").select("engagement_id", { count: "exact", head: true }).eq("tematica_id", opt.value);
    setEliminarTemCheck({ loading: false, count: count ?? 0 });
  }
  async function confirmarEliminarTematica() {
    if (!eliminarTemCandidata) return;
    setEliminarTemLoading(true);
    const supabase = createAnyClient();
    const { error: delErr } = await (supabase as any).from("cat_tematica").update({ activo: false }).eq("id", eliminarTemCandidata.value);
    if (delErr) { setServerError(`No se pudo eliminar la temática: ${delErr.message}`); setEliminarTemLoading(false); setEliminarTemCandidata(null); return; }
    setTematicasOpts((prev) => prev.filter((i) => i.value !== eliminarTemCandidata.value));
    setForm((f) => ({ ...f, tematicas: f.tematicas.filter((id) => id !== eliminarTemCandidata.value) }));
    setEliminarTemLoading(false); setEliminarTemCandidata(null);
  }

  // fecha_fin_estimada puede estar vacía si el engagement usa fecha_fin_real
  const fechaFinEfectiva = form.fecha_fin_estimada || (engagement as any)?.fecha_fin_real || "";
  // Fin permitido para el equipo: incluye el alargue (si no, tras extender no se podía guardar)
  const limiteFinEquipo = mostrarExtension && extFechaFin && extFechaFin > fechaFinEfectiva ? extFechaFin : fechaFinEfectiva;

  const addReq = () => {
    setReqs((r) => {
      const newIndex = r.length;
      // Asegurar que el nuevo req esté expandido (fuera del set de colapsados)
      setReqsColapsados((prev) => { const next = new Set(prev); next.delete(newIndex); return next; });
      setTimeout(() => {
        document.getElementById(`req-card-${newIndex}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 60);
      return [...r, { ...EMPTY_REQ, fecha_inicio: form.fecha_inicio, fecha_fin: fechaFinEfectiva }];
    });
  };

  const removeReq = (idx: number) => {
    const target = reqs[idx];
    if (!target) return;
    if (target.asignacionId) {
      setAsignacionesAEliminar((prev) => [...prev, target.asignacionId!]);
    } else if (target.id && target.personaId && reqs.some((o) => o.reqVinculadoId === target.id)) {
      // Requerimiento compartido: se quita solo a esta persona, el resto del equipo sigue
      setAsigPersonaReqAEliminar((prev) => [...prev, { reqId: target.id!, personaId: target.personaId! }]);
    }
    setReqs((r) => r.filter((_, i) => i !== idx));
  };

  /** Agrega un tramo nuevo a la tarjeta consolidada de una persona (sin requerimiento vinculado). */
  const addTramoParaPersona = (personaId: string, personaNombre: string) => {
    setReqs((r) => {
      const tramosPersona = r.filter((row) => row.personaId === personaId);
      const ultimoFin = tramosPersona.reduce((max, row) => (row.fecha_fin && row.fecha_fin > max ? row.fecha_fin : max), "");
      const ultimo = tramosPersona[tramosPersona.length - 1];
      let nuevaFechaInicio = form.fecha_inicio;
      if (ultimoFin) {
        const d = new Date(ultimoFin + "T00:00:00");
        d.setDate(d.getDate() + 1);
        nuevaFechaInicio = d.toISOString().split("T")[0];
      }
      const nuevo: ReqRow = {
        personaId,
        persona_nombre: personaNombre,
        fase_nombre: "",
        cargo_requerido: ultimo?.cargo_requerido ?? "",
        descripcion: "",
        pct_dedicacion: ultimo?.pct_dedicacion ?? "100",
        fecha_inicio: nuevaFechaInicio,
        fecha_fin: fechaFinEfectiva,
      };
      return [...r, nuevo];
    });
  };

  const setReqField = (idx: number, field: keyof ReqRow) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => setReqs((rs) => rs.map((r, i) => i === idx ? { ...r, [field]: e.target.value } : r));

  const validate = () => {
    const e: Record<string, string> = {};
    const esPropuesta = form.tipo === "propuesta";

    // El nombre es obligatorio siempre: sin él la propuesta no se puede abrir desde la lista
    if (!form.nombre.trim()) e.nombre = "Requerido";
    if (!esPropuesta) {
      if (form.tipo !== "ayuda_interna" && form.tipo !== "posibles_proyectos" && !form.cliente.trim()) e.cliente = "Requerido";
    }
    if (form.fecha_fin_estimada && form.fecha_inicio && form.fecha_fin_estimada < form.fecha_inicio) {
      e.fecha_fin_estimada = "No puede ser anterior a la fecha de inicio";
    }
    // Límite = fin del proyecto o, si hay alargue, su fin
    const maxFin = limiteFinEquipo || null;
    if (!esPropuesta) {
      reqs.forEach((r, i) => {
        const pct = Number(r.pct_dedicacion);
        if (!r.pct_dedicacion || isNaN(pct) || pct < 1 || pct > 100) {
          e[`req_${i}_pct`] = "Debe estar entre 1 y 100";
        }
        if (!r.fecha_inicio) {
          e[`req_${i}_inicio`] = "Requerida";
        } else if (maxFin && r.fecha_inicio > maxFin) {
          e[`req_${i}_inicio`] = `No puede ser después del ${maxFin}`;
        }
        if (!r.fecha_fin) {
          e[`req_${i}_fin`] = "Requerida";
        } else if (r.fecha_inicio && r.fecha_fin < r.fecha_inicio) {
          e[`req_${i}_fin`] = "No puede ser anterior a la fecha de inicio";
        } else if (maxFin && r.fecha_fin > maxFin) {
          e[`req_${i}_fin`] = `No puede ser después del ${maxFin}`;
        }
      });
    }
    setErrors(e);
    // Errores dentro de "Equipo del proyecto": abrir la sección y avisar arriba (antes quedaban ocultos)
    const erroresEquipo = Object.keys(e).filter((k) => k.startsWith("req_"));
    if (erroresEquipo.length > 0) {
      setEquipoOpen(true);
      const idxs = new Set(erroresEquipo.map((k) => Number(k.split("_")[1])));
      setReqsColapsados((prev) => new Set([...prev].filter((i) => !idxs.has(i))));
      setServerError("Revisa los campos marcados en \"Equipo del proyecto\".");
    } else if (Object.keys(e).length > 0) {
      setServerError("Revisa los campos marcados.");
    } else {
      setServerError(null);
    }
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (extQuitadaConfirmada = false) => {
    if (!validate()) return;
    // Apagar el alargue borra su período y al equipo asignado: pedir confirmación
    if (!simulationMode && !mostrarExtension && extId && !extQuitadaConfirmada) {
      setConfirmQuitarExt(true);
      return;
    }
    setConfirmQuitarExt(false);
    setLoading(true); setServerError(null);

    // ── SIMULACIÓN: sin Supabase, notifica al padre con los datos del form ──
    if (simulationMode) {
      const simId = engagement?.id ?? `sim_eng_${Date.now()}`;
      onSimSuccess?.({
        id: simId,
        codigo: form.codigo.trim() || null,
        nombre: form.nombre.trim(),
        cliente: form.cliente.trim(),
        tipo: form.tipo,
        fecha_inicio: form.fecha_inicio,
        fecha_fin: form.fecha_fin_estimada,
        reqs,
        actividades, // viajes y talleres del engagement
      });
      setLoading(false);
      onSuccess();
      return;
    }
    // ────────────────────────────────────────────────────────────────────────

    const supabase = createAnyClient();

    const payload = {
      nombre: form.nombre.trim(),
      cliente: form.cliente.trim(),
      tipo: form.tipo as "propuesta" | "proyecto" | "ayuda_interna" | "posibles_proyectos",
      estado: form.estado as "activo" | "terminado",
      codigo: form.codigo.trim() || null,
      descripcion: form.descripcion.trim() || null,
      fecha_inicio: form.fecha_inicio || null,
      fecha_fin_estimada: form.fecha_fin_estimada || null,
      industria_id: form.industria_id || null,
    };

    let engId: string;
    if (engagement) {
      const { error } = await supabase.from("engagement").update(payload).eq("id", engagement.id);
      if (error) { setServerError(error.message); setLoading(false); return; }
      engId = engagement.id;
      // Borrar reqs huérfanos (los que el usuario quitó de "Equipo del proyecto")
      // Incluye los requerimientos compartidos que siguen teniendo a otra persona
      const savedIds = [...new Set(reqs.map((r) => r.id ?? r.reqVinculadoId).filter(Boolean) as string[])];
      const { data: reqsHuerfanos } = await (savedIds.length > 0
        ? supabase.from("requerimiento_engagement").select("id").eq("engagement_id", engId).not("id", "in", `(${savedIds.join(",")})`)
        : supabase.from("requerimiento_engagement").select("id").eq("engagement_id", engId));
      const idsHuerfanos = ((reqsHuerfanos ?? []) as { id: string }[]).map((r) => r.id);
      if (idsHuerfanos.length > 0) {
        // asignacion.requerimiento_id no tiene ON DELETE CASCADE: hay que borrar la(s)
        // asignación(es) vinculada(s) primero o el delete del req falla en silencio por FK
        // y la barra "fantasma" queda viva en el tablero.
        const { error: delAsigHuerfErr } = await supabase.from("asignacion").delete().in("requerimiento_id", idsHuerfanos);
        if (delAsigHuerfErr) { setServerError(`Error al quitar asignaciones del equipo: ${delAsigHuerfErr.message}`); setLoading(false); return; }
        const { error: delReqHuerfErr } = await supabase.from("requerimiento_engagement").delete().in("id", idsHuerfanos);
        if (delReqHuerfErr) { setServerError(`Error al quitar requerimientos: ${delReqHuerfErr.message}`); setLoading(false); return; }
      }
    } else if (creadoIdRef.current) {
      // Reintento tras un error posterior a la creación: se actualiza el proyecto ya creado
      // en vez de insertar otro (antes cada reintento duplicaba el proyecto)
      engId = creadoIdRef.current;
      const { error } = await supabase.from("engagement").update(payload).eq("id", engId);
      if (error) { setServerError(error.message); setLoading(false); return; }
      // Los cupos del intento anterior se reemplazan por los del formulario
      const { error: delAsigPrevErr } = await supabase.from("asignacion").delete().eq("engagement_id", engId);
      const { error: delReqPrevErr } = delAsigPrevErr ? { error: null } : await supabase.from("requerimiento_engagement").delete().eq("engagement_id", engId);
      if (delAsigPrevErr || delReqPrevErr) { setServerError((delAsigPrevErr ?? delReqPrevErr)!.message); setLoading(false); return; }
    } else {
      const { data, error } = await supabase.from("engagement").insert(payload).select("id").single();
      if (error || !data) { setServerError(error?.message ?? "Error"); setLoading(false); return; }
      engId = data.id;
      creadoIdRef.current = data.id;
    }

    // Capacidades, temáticas y actividades: reemplazo atómico en la base
    // (si algo falla, Postgres revierte también el borrado; ver migración 20261028_reemplazo_atomico_relaciones)
    const { error: relErr } = await (supabase as any).rpc("reemplazar_relaciones_engagement", {
      p_engagement_id: engId,
      p_capacidades: form.capacidades,
      p_tematicas: form.tematicas,
      p_actividades: actividades.map((a) => ({
        tipo: a.tipo,
        titulo: a.titulo.trim(),
        descripcion: a.descripcion.trim() || null,
        fecha_inicio: a.fecha_inicio,
        fecha_fin: a.fecha_fin,
      })),
    });
    if (relErr) { setServerError(`Error al guardar capacidades, temáticas o viajes/talleres: ${relErr.message}`); setLoading(false); return; }

    // Asignaciones directas que el usuario quitó de "Equipo del proyecto": se eliminan tal cual
    // (no tenían requerimiento_engagement vinculado, así que no hay nada más que limpiar).
    if (asignacionesAEliminar.length > 0) {
      const { error: delAsigErr } = await supabase.from("asignacion").delete().in("id", asignacionesAEliminar);
      if (delAsigErr) { setServerError(`Error al quitar asignaciones: ${delAsigErr.message}`); setLoading(false); return; }
    }
    // Persona quitada de un requerimiento compartido: solo sus asignaciones de ese requerimiento
    for (const { reqId, personaId } of asigPersonaReqAEliminar) {
      const { error: delPerErr } = await supabase.from("asignacion").delete()
        .eq("requerimiento_id", reqId).eq("persona_id", personaId);
      if (delPerErr) { setServerError(`Error al quitar asignaciones: ${delPerErr.message}`); setLoading(false); return; }
    }

    // Valores actuales de los cupos en la base, para saber qué cambió realmente al guardar
    const reqsPrevios = new Map<string, { pct_dedicacion: number; fecha_inicio: string | null; fecha_fin: string | null }>();
    const idsReqsGuardados = reqs.filter((r) => r.id).map((r) => r.id!);
    if (idsReqsGuardados.length > 0) {
      const { data: prevData, error: prevErr } = await supabase
        .from("requerimiento_engagement")
        .select("id, pct_dedicacion, fecha_inicio, fecha_fin")
        .in("id", idsReqsGuardados);
      if (prevErr) { setServerError(`Error al leer el equipo del proyecto: ${prevErr.message}`); setLoading(false); return; }
      for (const p of (prevData ?? []) as any[]) reqsPrevios.set(p.id, p);
    }

    for (const [i, r] of reqs.entries()) {
      // Fila de asignación directa (sin requerimiento_engagement): actualiza esa asignación
      // puntual en lugar de crear/editar un requerimiento.
      if (r.asignacionId) {
        const { error: asigErr } = await supabase
          .from("asignacion")
          .update({
            cargo_al_momento: r.cargo_requerido ? fromCargoOption(r.cargo_requerido) : null,
            pct_dedicacion: Number(r.pct_dedicacion),
            fecha_inicio: r.fecha_inicio,
            fecha_fin: r.fecha_fin || null,
          })
          .eq("id", r.asignacionId);
        if (asigErr) { setServerError(`Error al actualizar asignación de ${r.persona_nombre ?? "persona"}: ${asigErr.message}`); setLoading(false); return; }
        continue;
      }

      // Tramo nuevo agregado desde "Equipo del proyecto" para una persona ya asignada
      // (sin requerimiento_engagement): crea la asignación directa, no un requerimiento.
      if (!r.id && r.personaId) {
        const { error: insAsigErr } = await (supabase as any).from("asignacion").insert({
          engagement_id: engId,
          persona_id: r.personaId,
          requerimiento_id: null,
          cargo_al_momento: r.cargo_requerido ? fromCargoOption(r.cargo_requerido) : null,
          pct_dedicacion: Number(r.pct_dedicacion),
          fecha_inicio: r.fecha_inicio,
          fecha_fin: r.fecha_fin || null,
          estado: "activa",
          estado_staffing: "CONFIRMADO",
        });
        if (insAsigErr) { setServerError(`Error al crear tramo de ${r.persona_nombre ?? "persona"}: ${insAsigErr.message}`); setLoading(false); return; }
        continue;
      }

      const reqPayload = {
        engagement_id: engId,
        fase_nombre: r.fase_nombre.trim() || null,
        cargo_requerido: r.cargo_requerido ? fromCargoOption(r.cargo_requerido) : null,
        descripcion: r.descripcion.trim() || null,
        pct_dedicacion: Number(r.pct_dedicacion),
        fecha_inicio: r.fecha_inicio || null,
        fecha_fin: r.fecha_fin || null,
      };
      if (r.id) {
        const { error: updErr } = await supabase
          .from("requerimiento_engagement").update(reqPayload).eq("id", r.id);
        if (updErr) { setServerError(`Error en requerimiento ${i + 1}: ${updErr.message}`); setLoading(false); return; }

        // Cascada: solo si el cupo cambió de verdad, y solo a las asignaciones que tenían el
        // valor anterior. Antes, guardar el formulario (aunque fuera solo el nombre) dejaba a todas
        // las personas del cupo con sus fechas y % → tramos encimados y ocupación duplicada.
        const previo = reqsPrevios.get(r.id);
        if (previo) {
          const cascOps: Promise<any>[] = [];
          if (Number(previo.pct_dedicacion) !== reqPayload.pct_dedicacion) {
            cascOps.push(supabase.from("asignacion").update({ pct_dedicacion: reqPayload.pct_dedicacion })
              .eq("requerimiento_id", r.id).eq("estado", "activa").eq("pct_dedicacion", previo.pct_dedicacion));
          }
          if (reqPayload.fecha_inicio && previo.fecha_inicio && reqPayload.fecha_inicio !== previo.fecha_inicio) {
            cascOps.push(supabase.from("asignacion").update({ fecha_inicio: reqPayload.fecha_inicio })
              .eq("requerimiento_id", r.id).eq("estado", "activa").eq("fecha_inicio", previo.fecha_inicio));
          }
          if (reqPayload.fecha_fin && previo.fecha_fin && reqPayload.fecha_fin !== previo.fecha_fin) {
            cascOps.push(supabase.from("asignacion").update({ fecha_fin: reqPayload.fecha_fin })
              .eq("requerimiento_id", r.id).eq("estado", "activa").eq("fecha_fin", previo.fecha_fin));
          }
          if (cascOps.length > 0) {
            const cascErr = (await Promise.all(cascOps)).find((x: any) => x.error)?.error;
            if (cascErr) { setServerError(`Error al sincronizar asignaciones del requerimiento ${i + 1}: ${cascErr.message}`); setLoading(false); return; }
          }
        }
      } else {
        const { error: insErr } = await (supabase as any)
          .from("requerimiento_engagement").insert(reqPayload);
        if (insErr) { setServerError(`Error al crear requerimiento ${i + 1}: ${insErr.message}`); setLoading(false); return; }
      }
    }

    // ── Sincronización masiva de fechas en requerimientos ─────
    // Si cambia fecha_inicio o fecha_fin_estimada, alinear los reqs que
    // tenían la fecha anterior exacta (reqs con fechas personalizadas no se tocan).
    if (engagement) {
      const syncOps: Promise<any>[] = [];

      if (form.fecha_inicio && engagement.fecha_inicio &&
          form.fecha_inicio !== engagement.fecha_inicio) {
        syncOps.push(
          supabase
            .from("requerimiento_engagement")
            .update({ fecha_inicio: form.fecha_inicio })
            .eq("engagement_id", engId)
            .eq("fecha_inicio", engagement.fecha_inicio)
        );
      }

      // Reducción de fecha_fin (el bloque existente ya cubre la extensión)
      if (form.fecha_fin_estimada && engagement.fecha_fin_estimada &&
          form.fecha_fin_estimada < engagement.fecha_fin_estimada) {
        syncOps.push(
          supabase
            .from("requerimiento_engagement")
            .update({ fecha_fin: form.fecha_fin_estimada })
            .eq("engagement_id", engId)
            .eq("fecha_fin", engagement.fecha_fin_estimada)
        );
      }

      if (syncOps.length > 0) {
        const syncErr = (await Promise.all(syncOps)).find((r: any) => r.error)?.error;
        if (syncErr) { setServerError(`Error al sincronizar fechas de requerimientos: ${syncErr.message}`); setLoading(false); return; }
      }

      // Propaga el cambio de fechas a las asignaciones activas, solo a las que corresponde:
      // - nuevo inicio → solo quienes empezaban junto con el proyecto (misma fecha anterior)
      // - fin acortado → solo quienes terminaban después del nuevo fin (se recortan);
      //   quien ya había salido antes conserva su fecha (antes se le alargaba)
      const asigOps: Promise<any>[] = [];
      if (form.fecha_inicio && engagement.fecha_inicio && form.fecha_inicio !== engagement.fecha_inicio) {
        asigOps.push(
          supabase.from("asignacion")
            .update({ fecha_inicio: form.fecha_inicio })
            .eq("engagement_id", engId)
            .eq("estado", "activa")
            .eq("fecha_inicio", engagement.fecha_inicio)
        );
      }
      if (form.fecha_fin_estimada && engagement.fecha_fin_estimada &&
          form.fecha_fin_estimada < engagement.fecha_fin_estimada) {
        asigOps.push(
          supabase.from("asignacion")
            .update({ fecha_fin: form.fecha_fin_estimada })
            .eq("engagement_id", engId)
            .eq("estado", "activa")
            .gt("fecha_fin", form.fecha_fin_estimada)
            .lte("fecha_inicio", form.fecha_fin_estimada)
        );
      }
      if (asigOps.length > 0) {
        const massErr = (await Promise.all(asigOps)).find((r: any) => r.error)?.error;
        if (massErr) { setServerError(`Error al sincronizar fechas de asignaciones: ${massErr.message}`); setLoading(false); return; }
      }
    }

    // ── Cascada de extensión automática ───────────────────────
    // Si estamos editando y se extendió la fecha_fin, propagar en cascada:
    // 1. Extender reqs que aún tienen la fecha_fin anterior
    // 2. Insertar tramo PLAN para la persona CONFIRMADA que cubría el tramo final
    if (engagement && form.fecha_fin_estimada && engagement.fecha_fin_estimada) {
      const oldFin = engagement.fecha_fin_estimada;
      const newFin = form.fecha_fin_estimada;
      if (newFin > oldFin) {
        const { data: reqsAExtender } = await supabase
          .from("requerimiento_engagement")
          .select("id, cargo_requerido, pct_dedicacion")
          .eq("engagement_id", engId)
          .eq("fecha_fin", oldFin) as { data: { id: string; cargo_requerido: string | null; pct_dedicacion: number }[] | null };

        if (reqsAExtender && reqsAExtender.length > 0) {
          const reqIds = reqsAExtender.map((r) => r.id);

          // 1. Extender fecha_fin de los reqs
          const { error: extReqErr } = await supabase
            .from("requerimiento_engagement")
            .update({ fecha_fin: newFin })
            .in("id", reqIds);
          if (extReqErr) { setServerError(`Error al extender requerimientos: ${extReqErr.message}`); setLoading(false); return; }

          // 1b. Extender todas las asignaciones activas que llegaban hasta oldFin
          //     (cubre PLAN y cualquier otro estado_staffing sin excepción)
          const { error: extAsigErr } = await supabase
            .from("asignacion")
            .update({ fecha_fin: newFin })
            .in("requerimiento_id", reqIds)
            .eq("estado", "activa")
            .eq("fecha_fin", oldFin);
          if (extAsigErr) { setServerError(`Error al extender asignaciones: ${extAsigErr.message}`); setLoading(false); return; }

          // Inicio del tramo de extensión = día siguiente del fin anterior
          const dExt = new Date(oldFin + "T00:00:00");
          dExt.setDate(dExt.getDate() + 1);
          const extensionStart = dExt.toISOString().split("T")[0];

          // 2. Por cada req, buscar la última asignación CONFIRMADO que llegaba hasta oldFin
          for (const req of reqsAExtender) {
            const { data: ultimaAsig } = await (supabase as any)
              .from("asignacion")
              .select("persona_id, cargo_al_momento, pct_dedicacion")
              .eq("requerimiento_id", req.id)
              .eq("estado_staffing", "CONFIRMADO")
              .eq("estado", "activa")
              .eq("fecha_fin", oldFin)
              .order("fecha_fin", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (ultimaAsig) {
              const { error: tramoErr } = await supabase.from("asignacion").insert({
                engagement_id: engId,
                requerimiento_id: req.id,
                persona_id: (ultimaAsig as any).persona_id,
                cargo_al_momento: (ultimaAsig as any).cargo_al_momento,
                pct_dedicacion: (ultimaAsig as any).pct_dedicacion,
                fecha_inicio: extensionStart,
                fecha_fin: newFin,
                estado: "activa",
                estado_staffing: "PLAN",
              });
              if (tramoErr) { setServerError(`Error al crear tramo de extensión: ${tramoErr.message}`); setLoading(false); return; }
            }
          }
        }
      }
    }

    // Switch de extensión rápida: update si ya existía, insert si es nueva, delete si se apagó
    if (mostrarExtension && extFechaInicio && extFechaFin) {
      if (extId) {
        const { error: extErr } = await supabase
          .from("engagement_extension")
          .update({ fecha_inicio: extFechaInicio, fecha_fin: extFechaFin })
          .eq("id", extId);
        if (extErr) { setServerError(`Error al actualizar extensión: ${extErr.message}`); setLoading(false); return; }
        // Si cambiaron las fechas del alargue, mover también al equipo de ese período
        if (extPrev && (extPrev.inicio !== extFechaInicio || extPrev.fin !== extFechaFin)) {
          const nuevas = { fecha_inicio: extFechaInicio, fecha_fin: extFechaFin };
          const movOps = await Promise.all([
            supabase.from("asignacion").update(nuevas).eq("extension_id" as any, extId),
            supabase.from("asignacion").update(nuevas).eq("engagement_id", engId)
              .eq("fecha_inicio", extPrev.inicio).eq("fecha_fin", extPrev.fin),
            supabase.from("requerimiento_engagement").update(nuevas).eq("engagement_id", engId)
              .eq("fecha_inicio", extPrev.inicio).eq("fecha_fin", extPrev.fin),
          ]);
          const movErr = movOps.find((x: any) => x.error)?.error;
          if (movErr) { setServerError(`Error al mover el equipo del alargue: ${movErr.message}`); setLoading(false); return; }
        }
      } else {
        const { error: extErr } = await crearExtensionEngagement(supabase, {
          engagementId: engId,
          fechaInicio: extFechaInicio,
          fechaFin: extFechaFin,
          personas: [],
        });
        if (extErr) { setServerError(`Error al crear extensión: ${extErr}`); setLoading(false); return; }
      }
    } else if (!mostrarExtension && extId) {
      // Elimina la extensión y libera al equipo asignado a ese período
      const { error: extErr } = await eliminarExtensionConEquipo(supabase, extId);
      if (extErr) { setServerError(`Error al eliminar extensión: ${extErr}`); setLoading(false); return; }
    }

    setLoading(false);
    // Invalida caché del router de Next.js (evita datos stale tras guardar requerimientos)
    router.refresh();
    window.dispatchEvent(new CustomEvent("engagementChanged", { detail: { engagementId: engId } }));
    onSuccess();
    onClose();
  };

  // Límites de fecha para requerimientos (usa fecha_fin_real como fallback)
  const minReqDate = form.fecha_inicio || undefined;
  const maxReqDate = limiteFinEquipo || undefined;

  // Viajes/talleres deben caer dentro del engagement (incluida su extensión): si quedaban
  // fuera se guardaban igual pero no se veían en ninguna vista
  const minActDate = form.fecha_inicio || undefined;
  const maxActDate = (() => {
    const fin = fechaFinEfectiva || "";
    const ext = mostrarExtension && extFechaFin ? extFechaFin : "";
    return (ext > fin ? ext : fin) || undefined;
  })();

  // Agrega (o reemplaza, si se está editando) el viaje/taller del formulario
  function guardarActividad() {
    if (editingActividadIdx !== null) {
      setActividades((prev) => prev.map((a, j) => j === editingActividadIdx ? { ...nuevaActividad } : a));
      setEditingActividadIdx(null);
    } else {
      setActividades((prev) => [...prev, { ...nuevaActividad }]);
    }
    setActividadOpen(false);
    setNuevaActividad({ ...EMPTY_ACTIVIDAD });
    setErrors((p) => { const n = { ...p }; delete n.act_tipo; delete n.act_titulo; delete n.act_fechas; return n; });
  }

  // ── Agrupación de "Equipo del proyecto" por persona: nunca se repite un nombre en
  // varias tarjetas — todos sus tramos (con o sin requerimiento) viven en una sola ficha.
  // Los requerimientos aún sin nadie asignado (slots abiertos) se muestran aparte, como antes.
  const sinPersonaReqs: { r: ReqRow; idx: number }[] = [];
  const porPersonaReqs = new Map<string, { nombre: string; tramos: { r: ReqRow; idx: number }[] }>();
  reqs.forEach((r, idx) => {
    if (r.personaId) {
      const grupo = porPersonaReqs.get(r.personaId) ?? { nombre: r.persona_nombre ?? "—", tramos: [] };
      if (r.persona_nombre) grupo.nombre = r.persona_nombre;
      grupo.tramos.push({ r, idx });
      porPersonaReqs.set(r.personaId, grupo);
    } else {
      sinPersonaReqs.push({ r, idx });
    }
  });
  const gruposPersonaOrdenados = [...porPersonaReqs.entries()].sort(([, a], [, b]) => {
    const diff = ordenCargoEquipo(a.tramos[0]?.r.cargo_requerido ?? "") - ordenCargoEquipo(b.tramos[0]?.r.cargo_requerido ?? "");
    return diff !== 0 ? diff : a.nombre.localeCompare(b.nombre, "es");
  });

  return (
    <Drawer
      open={open}
      onClose={cerrar}
      title={engagement ? "Editar proyecto" : "Nuevo proyecto"}
      width="lg"
      footer={
        <>
          <Button variant="secondary" onClick={cerrar} disabled={loading}>Cancelar</Button>
          <Button onClick={() => handleSubmit()} loading={loading}>
            {engagement ? "Guardar cambios" : "Crear proyecto"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {serverError && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {serverError}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <FieldWrapper label="Nombre" required={form.tipo !== "propuesta"} error={errors.nombre} className="col-span-2">
            <Input value={form.nombre} onChange={setField("nombre")} placeholder="Transformación Operacional..." error={!!errors.nombre} />
          </FieldWrapper>
          <FieldWrapper label="Código identificador" className="col-span-2">
            <Input value={form.codigo} onChange={setField("codigo")} placeholder="Ej: PRJ-2026" />
          </FieldWrapper>
          <FieldWrapper
            label="Cliente"
            required={form.tipo !== "ayuda_interna" && form.tipo !== "propuesta" && form.tipo !== "posibles_proyectos"}
            error={errors.cliente}
            hint={form.tipo === "ayuda_interna" || form.tipo === "propuesta" || form.tipo === "posibles_proyectos" ? "Opcional" : undefined}
          >
            <Input
              value={form.cliente}
              onChange={setField("cliente")}
              placeholder={form.tipo === "ayuda_interna" ? "Equipo / área interna (opcional)" : "Empresa SA"}
              error={!!errors.cliente}
            />
          </FieldWrapper>
          <FieldWrapper label="Industria">
            <Select value={form.industria_id} onChange={setField("industria_id")} options={[...industrias, ...industriasInactivas.filter((o) => o.value === form.industria_id)]} placeholder="Sin industria" allowEmpty />
            <div className="mt-1 flex items-center gap-3">
              <button
                type="button"
                onClick={() => { setNuevaIndustriaNombre(""); setNuevaIndustriaError(null); setNuevaIndustriaOpen(true); }}
                className="flex items-center gap-1 text-[11px] text-[#2563eb] hover:underline"
              >
                <Plus className="w-3 h-3" /> Nueva industria
              </button>
              {industrias.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowEliminarLista((s) => !s)}
                  className="flex items-center gap-1 text-[11px] text-[#888] hover:text-red-500 hover:underline"
                >
                  <Trash2 className="w-3 h-3" /> Eliminar industria
                </button>
              )}
            </div>
            {showEliminarLista && (
              <div className="mt-2 border border-[#e8e8e8] rounded-lg overflow-hidden max-h-44 overflow-y-auto">
                {industrias.map((ind) => (
                  <div key={ind.value} className="flex items-center justify-between px-3 py-1.5 hover:bg-[#fafafa] border-b border-[#f0f0f0] last:border-0">
                    <span className="text-[12px] text-[#333]">{ind.label}</span>
                    <button
                      type="button"
                      onClick={() => abrirEliminarIndustria(ind)}
                      className="p-1 rounded hover:bg-[#fee2e2] text-[#ccc] hover:text-[#dc2626] transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </FieldWrapper>

          <Modal
            open={nuevaIndustriaOpen}
            onClose={() => setNuevaIndustriaOpen(false)}
            title="Nueva industria"
            footer={
              <>
                <Button variant="secondary" onClick={() => setNuevaIndustriaOpen(false)} disabled={nuevaIndustriaLoading}>
                  Cancelar
                </Button>
                <Button onClick={guardarNuevaIndustria} loading={nuevaIndustriaLoading}>
                  Guardar
                </Button>
              </>
            }
          >
            <div className="space-y-2">
              <label className="text-[11px] font-semibold text-[#888] uppercase tracking-wide">Nombre</label>
              <input
                autoFocus
                type="text"
                value={nuevaIndustriaNombre}
                onChange={(e) => setNuevaIndustriaNombre(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); guardarNuevaIndustria(); } }}
                placeholder="Ej. Tecnología"
                className="w-full border border-[#e0e0e0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb]"
              />
              {nuevaIndustriaError && (
                <p className="text-[11px] text-red-500">{nuevaIndustriaError}</p>
              )}
            </div>
          </Modal>

          <Modal
            open={!!eliminarCandidata}
            onClose={() => { if (!eliminarLoading) setEliminarCandidata(null); }}
            title="Eliminar industria"
            footer={
              eliminarCheck.loading || eliminarCheck.count > 0 ? (
                <Button variant="secondary" onClick={() => setEliminarCandidata(null)}>Cerrar</Button>
              ) : (
                <>
                  <Button variant="secondary" onClick={() => setEliminarCandidata(null)} disabled={eliminarLoading}>
                    Cancelar
                  </Button>
                  <Button variant="danger" onClick={confirmarEliminarIndustria} loading={eliminarLoading}>
                    Sí, eliminar
                  </Button>
                </>
              )
            }
          >
            {eliminarCheck.loading ? (
              <p className="text-sm text-[#888]">Verificando usos...</p>
            ) : eliminarCheck.count > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-red-600">No se puede eliminar la industria.</p>
                <p className="text-sm text-[#555]">
                  Hay <strong>{eliminarCheck.count}</strong> engagement{eliminarCheck.count !== 1 ? "s" : ""} asociado{eliminarCheck.count !== 1 ? "s" : ""} a <strong>{eliminarCandidata?.label}</strong>.
                </p>
              </div>
            ) : (
              <p className="text-sm text-[#555]">
                ¿Estás seguro de que deseas eliminar <strong>{eliminarCandidata?.label}</strong>? Esta acción no se puede deshacer y afectará a los formularios de creación/edición.
              </p>
            )}
          </Modal>

          <FieldWrapper label="Tipo">
            <Select value={form.tipo} onChange={setField("tipo")}
              options={[
                { value: "propuesta", label: "Propuesta comercial" },
                { value: "posibles_proyectos", label: "Posibles proyectos" },
                { value: "proyecto", label: "Proyecto" },
                { value: "ayuda_interna", label: "Desarrollo interno" },
              ]} />
          </FieldWrapper>
          <FieldWrapper label="Estado">
            <Select value={form.estado} onChange={setField("estado")}
              options={[
                { value: "activo", label: "Activo" },
                { value: "terminado", label: "Terminado" },
              ]} />
          </FieldWrapper>
          <FieldWrapper label="Fecha inicio">
            <Input type="date" value={form.fecha_inicio} onChange={handleFechaInicioChange}
              max={form.fecha_fin_estimada || undefined} />
          </FieldWrapper>
          <FieldWrapper label="Fecha fin estimada" error={errors.fecha_fin_estimada}>
            <Input type="date" value={form.fecha_fin_estimada} onChange={handleFechaFinChange}
              min={form.fecha_inicio || undefined} error={!!errors.fecha_fin_estimada} />
          </FieldWrapper>
        </div>

        <FieldWrapper label="Descripción">
          <Textarea value={form.descripcion} onChange={setField("descripcion")} placeholder="Contexto del engagement..." />
        </FieldWrapper>

        {/* Switch rápido de extensión: alternativa simple a "Extender Proyecto" (sin equipo) */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-[#888] uppercase tracking-widest">¿Quieres extender el proyecto?</span>
          <button
            type="button"
            role="switch"
            aria-checked={mostrarExtension}
            onClick={() => {
              const next = !mostrarExtension;
              setMostrarExtension(next);
              if (next && !extFechaInicio) {
                const base = fechaFinEfectiva || form.fecha_inicio;
                const inicio = base ? shiftDate(base, 1) : "";
                setExtFechaInicio(inicio);
                setExtFechaFin(inicio);
              }
            }}
            className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${mostrarExtension ? "bg-[#2563eb]" : "bg-[#d0d0d0]"}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${mostrarExtension ? "translate-x-4" : ""}`} />
          </button>
        </div>

        {mostrarExtension && (
          <div className="border border-[#c7d9f4] bg-[#f8fbff] rounded-xl p-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <FieldWrapper label="Inicio del alargue">
                <Input
                  type="date"
                  value={extFechaInicio}
                  onChange={(e) => setExtFechaInicio(e.target.value)}
                />
              </FieldWrapper>
              <FieldWrapper label="Fin del alargue">
                <Input
                  type="date"
                  value={extFechaFin}
                  onChange={(e) => setExtFechaFin(e.target.value)}
                  min={extFechaInicio || undefined}
                />
              </FieldWrapper>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {/* ── Temáticas ── */}
          <FieldWrapper label="Temáticas" hint="Áreas temáticas del engagement">
            <MultiSelect
              options={[...tematicasOpts, ...tematicasInactivas.filter((o) => form.tematicas.includes(o.value))]}
              value={form.tematicas}
              onChange={(v) => setForm((f) => ({ ...f, tematicas: v }))}
              placeholder="Agregar temáticas..."
            />
            <div className="mt-1 flex items-center gap-3">
              <button type="button" onClick={() => { setNuevaTematicaNombre(""); setNuevaTematicaError(null); setNuevaTematicaOpen(true); }}
                className="flex items-center gap-1 text-[11px] text-[#2563eb] hover:underline">
                <Plus className="w-3 h-3" /> Nueva temática
              </button>
              {tematicasOpts.length > 0 && (
                <button type="button" onClick={() => setShowEliminarTemLista((s) => !s)}
                  className="flex items-center gap-1 text-[11px] text-[#888] hover:text-red-500 hover:underline">
                  <Trash2 className="w-3 h-3" /> Eliminar
                </button>
              )}
            </div>
            {showEliminarTemLista && (
              <div className="mt-2 border border-[#e8e8e8] rounded-lg overflow-hidden max-h-44 overflow-y-auto">
                {tematicasOpts.map((opt) => (
                  <div key={opt.value} className="flex items-center justify-between px-3 py-1.5 hover:bg-[#fafafa] border-b border-[#f0f0f0] last:border-0">
                    <span className="text-[12px] text-[#333]">{opt.label}</span>
                    <button type="button" onClick={() => abrirEliminarTematica(opt)}
                      className="p-1 rounded hover:bg-[#fee2e2] text-[#ccc] hover:text-[#dc2626] transition-colors">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </FieldWrapper>
        </div>

        {/* ── Modal nueva temática ── */}
        <Modal open={nuevaTematicaOpen} onClose={() => setNuevaTematicaOpen(false)} title="Nueva temática"
          footer={<>
            <Button variant="secondary" onClick={() => setNuevaTematicaOpen(false)} disabled={nuevaTematicaLoading}>Cancelar</Button>
            <Button onClick={guardarNuevaTematica} loading={nuevaTematicaLoading}>Guardar</Button>
          </>}>
          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-[#888] uppercase tracking-wide">Nombre</label>
            <input autoFocus type="text" value={nuevaTematicaNombre}
              onChange={(e) => setNuevaTematicaNombre(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); guardarNuevaTematica(); } }}
              placeholder="Ej. Transformación digital"
              className="w-full border border-[#e0e0e0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb]" />
            {nuevaTematicaError && <p className="text-[11px] text-red-500">{nuevaTematicaError}</p>}
          </div>
        </Modal>

        {/* ── Modal eliminar temática ── */}
        <Modal open={!!eliminarTemCandidata} onClose={() => { if (!eliminarTemLoading) setEliminarTemCandidata(null); }} title="Eliminar temática"
          footer={eliminarTemCheck.loading || eliminarTemCheck.count > 0
            ? <Button variant="secondary" onClick={() => setEliminarTemCandidata(null)}>Cerrar</Button>
            : <>
                <Button variant="secondary" onClick={() => setEliminarTemCandidata(null)} disabled={eliminarTemLoading}>Cancelar</Button>
                <Button variant="danger" onClick={confirmarEliminarTematica} loading={eliminarTemLoading}>Sí, eliminar</Button>
              </>}>
          {eliminarTemCheck.loading ? (
            <p className="text-sm text-[#888]">Verificando usos...</p>
          ) : eliminarTemCheck.count > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-red-600">No se puede eliminar.</p>
              <p className="text-sm text-[#555]">Hay <strong>{eliminarTemCheck.count}</strong> proyecto{eliminarTemCheck.count !== 1 ? "s" : ""} asociado{eliminarTemCheck.count !== 1 ? "s" : ""} a <strong>{eliminarTemCandidata?.label}</strong>.</p>
            </div>
          ) : (
            <p className="text-sm text-[#555]">¿Estás seguro de eliminar <strong>{eliminarTemCandidata?.label}</strong>? Esta acción no se puede deshacer.</p>
          )}
        </Modal>

        {/* Requerimientos */}
        <div className="border-t border-[#f0f0f0] pt-5">
          <button
            type="button"
            onClick={() => setEquipoOpen((o) => !o)}
            className="w-full flex items-center justify-between group"
          >
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-[#888] uppercase tracking-widest">Equipo del proyecto</p>
              {reqs.length > 0 && <span className="text-[10px] text-[#aaa] font-medium">{reqs.length}</span>}
            </div>
            {equipoOpen
              ? <ChevronUp className="w-4 h-4 text-[#aaa] group-hover:text-[#666] transition-colors" />
              : <ChevronDown className="w-4 h-4 text-[#aaa] group-hover:text-[#666] transition-colors" />
            }
          </button>

          {equipoOpen && (
          <div className="mt-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div>
                {(minReqDate || maxReqDate) && (
                  <p className="text-[10px] text-[#aaa] mt-0.5">
                    Las fechas deben estar dentro del rango del engagement
                    {minReqDate && ` (desde ${minReqDate}`}{maxReqDate && ` → ${maxReqDate}`}{(minReqDate || maxReqDate) && ")"}
                  </p>
                )}
              </div>
              {reqs.length > 0 && (
                <button
                  type="button"
                  title={reqsColapsados.size > 0 ? "Expandir todos" : "Colapsar todos"}
                  onClick={() => {
                    if (reqsColapsados.size > 0) {
                      setReqsColapsados(new Set());
                    } else {
                      setReqsColapsados(new Set(reqs.map((_, idx) => idx)));
                    }
                  }}
                  className="p-0.5 rounded text-[#bbb] hover:text-[#4a90e2] hover:bg-blue-50 transition-colors"
                >
                  {reqsColapsados.size > 0
                    ? <ChevronDown className="w-3.5 h-3.5" />
                    : <ChevronUp className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={addReq}>
              <Plus className="w-3.5 h-3.5" /> Agregar
            </Button>
          </div>

          {reqs.length === 0 && (
            <p className="text-sm text-[#aaa] text-center py-4">Sin requerimientos definidos.</p>
          )}

          <div className="space-y-4">
            {/* Requerimientos aún sin persona asignada (slots abiertos) — una tarjeta por requerimiento, igual que antes */}
            {sinPersonaReqs.map(({ r, idx }) => {
              const colapsado = reqsColapsados.has(idx);
              const toggleReq = () => setReqsColapsados((prev) => {
                const next = new Set(prev);
                if (next.has(idx)) next.delete(idx); else next.add(idx);
                return next;
              });
              return (
                <div key={idx} id={`req-card-${idx}`} className="border border-[#e8e8e8] rounded-xl overflow-hidden">
                  {/* Cabecera siempre visible */}
                  <div
                    className="flex items-center justify-between px-4 py-3 cursor-pointer select-none hover:bg-[#fafafa] transition-colors"
                    onClick={toggleReq}
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-semibold text-[#888]">
                        Requerimiento
                        {r.fase_nombre && <span className="ml-1.5 font-normal text-[#aaa]">· {r.fase_nombre}</span>}
                        {r.cargo_requerido && <span className="ml-1.5 font-normal text-[#aaa]">· {r.cargo_requerido}</span>}
                      </span>
                      {/* Badge de ausencias en simulación */}
                      {r.ausenciasPeriodo && r.ausenciasPeriodo.length > 0 && (
                        <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 w-fit">
                          ⚠ Ausencia{r.ausenciasPeriodo.length > 1 ? "s" : ""} en periodo:{" "}
                          {r.ausenciasPeriodo.map((a, j) => (
                            <span key={j}>{j > 0 ? " · " : ""}{a.desde} → {a.hasta}</span>
                          ))}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleReq(); }}
                        className="text-[#ccc] hover:text-[#4a90e2] transition-colors"
                      >
                        {colapsado ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeReq(idx); }}
                        className="text-[#aaa] hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {/* Body colapsable */}
                  {!colapsado && (
                    <div className="px-4 pb-4 pt-1 space-y-3 border-t border-[#f0f0f0]">
                      <div className="grid grid-cols-2 gap-3">
                        <FieldWrapper label="Nombre de fase">
                          <Input value={r.fase_nombre} onChange={setReqField(idx, "fase_nombre")} placeholder="Diagnóstico" />
                        </FieldWrapper>
                        <FieldWrapper label="Cargo requerido">
                          <Select value={r.cargo_requerido} onChange={setReqField(idx, "cargo_requerido")}
                            options={CARGOS_OPTIONS} placeholder="Cualquier cargo" />
                        </FieldWrapper>
                        <FieldWrapper label="% Dedicación" required error={errors[`req_${idx}_pct`]}>
                          <Input type="number" min="1" max="100" step="0.5" value={r.pct_dedicacion}
                            onChange={setReqField(idx, "pct_dedicacion")} placeholder="100"
                            error={!!errors[`req_${idx}_pct`]} />
                        </FieldWrapper>
                        <FieldWrapper label="Descripción del rol">
                          <Input value={r.descripcion} onChange={setReqField(idx, "descripcion")} placeholder="Líder de proyecto" />
                        </FieldWrapper>
                        <FieldWrapper label="Fecha inicio" required error={errors[`req_${idx}_inicio`]}>
                          <Input type="date" value={r.fecha_inicio} onChange={setReqField(idx, "fecha_inicio")}
                            min={minReqDate} max={maxReqDate} error={!!errors[`req_${idx}_inicio`]} />
                        </FieldWrapper>
                        <FieldWrapper label="Fecha fin" required error={errors[`req_${idx}_fin`]}>
                          <Input type="date" value={r.fecha_fin} onChange={setReqField(idx, "fecha_fin")}
                            min={r.fecha_inicio || minReqDate} max={maxReqDate} error={!!errors[`req_${idx}_fin`]} />
                        </FieldWrapper>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Personas consolidadas: una sola tarjeta por persona, con sus tramos y ausencias intercalados cronológicamente */}
            {gruposPersonaOrdenados.map(([personaId, grupo]) => {
              const tramosOrdenados = [...grupo.tramos].sort((a, b) => a.r.fecha_inicio.localeCompare(b.r.fecha_inicio));
              // Solo ausencias dentro del rango del engagement (Fecha inicio → Fecha fin estimada/real):
              // se excluyen tanto las anteriores al inicio del proyecto como las posteriores a su fin.
              const ausenciasEnRango = (ausenciasPorPersona.get(personaId) ?? []).filter((a) =>
                (!form.fecha_inicio || a.fin >= form.fecha_inicio) &&
                (!fechaFinEfectiva || a.inicio <= fechaFinEfectiva)
              );
              const eventos = construirEventosTimelineForm(
                tramosOrdenados.map((t) => ({ idx: t.idx, inicio: t.r.fecha_inicio })),
                ausenciasEnRango
              );
              return (
                <div key={personaId} className="border border-[#e8e8e8] rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-[#fafafa] border-b border-[#f0f0f0]">
                    <span className="text-sm font-semibold text-[#1a1a1a]">{grupo.nombre}</span>
                    <button
                      type="button"
                      onClick={() => addTramoParaPersona(personaId, grupo.nombre)}
                      className="flex items-center gap-1 text-[11px] text-[#4a90e2] hover:text-[#2563eb] font-medium transition-colors"
                    >
                      <Plus className="w-3 h-3" /> Agregar tramo
                    </button>
                  </div>
                  <div className="divide-y divide-[#f0f0f0]">
                    {eventos.map((ev, evIdx) => {
                      if (ev.tipo === "ausencia") {
                        return (
                          <div key={`aus-${evIdx}`} className="px-4 py-2 bg-amber-50">
                            <p className="text-[11px] font-semibold text-amber-700 text-center tracking-tight">
                              ----- ausencia: {format(fLocal(ev.inicio), "d MMM", { locale: es })} al {format(fLocal(ev.fin), "d MMM yyyy", { locale: es })} - ({ev.diasHabiles} días) -----
                            </p>
                          </div>
                        );
                      }

                      const idx = ev.tramoIdx;
                      const r = reqs[idx];
                      const colapsado = reqsColapsados.has(idx);
                      const toggleReq = () => setReqsColapsados((prev) => {
                        const next = new Set(prev);
                        if (next.has(idx)) next.delete(idx); else next.add(idx);
                        return next;
                      });
                      return (
                        <div key={idx} id={`req-card-${idx}`} className="px-4 py-3">
                          <div
                            className="flex items-center justify-between cursor-pointer select-none"
                            onClick={toggleReq}
                          >
                            <span className="text-xs font-semibold text-[#888]">
                              {r.cargo_requerido || "Cualquier cargo"}
                              <span className="ml-1.5 font-normal text-[#aaa]">
                                · {r.fecha_inicio} → {r.fecha_fin || "hoy"}
                              </span>
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); toggleReq(); }}
                                className="text-[#ccc] hover:text-[#4a90e2] transition-colors"
                              >
                                {colapsado ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); removeReq(idx); }}
                                className="text-[#aaa] hover:text-red-500 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                          {!colapsado && (
                            <div className="grid grid-cols-2 gap-3 mt-3">
                              <FieldWrapper label="Cargo">
                                <Select value={r.cargo_requerido} onChange={setReqField(idx, "cargo_requerido")}
                                  options={CARGOS_OPTIONS} placeholder="Cualquier cargo" />
                              </FieldWrapper>
                              <FieldWrapper label="% Dedicación" required error={errors[`req_${idx}_pct`]}>
                                <Input type="number" min="1" max="100" step="0.5" value={r.pct_dedicacion}
                                  onChange={setReqField(idx, "pct_dedicacion")} placeholder="100"
                                  error={!!errors[`req_${idx}_pct`]} />
                              </FieldWrapper>
                              <FieldWrapper label="Fecha inicio" required error={errors[`req_${idx}_inicio`]}>
                                <Input type="date" value={r.fecha_inicio} onChange={setReqField(idx, "fecha_inicio")}
                                  min={minReqDate} max={maxReqDate} error={!!errors[`req_${idx}_inicio`]} />
                              </FieldWrapper>
                              <FieldWrapper label="Fecha fin" required error={errors[`req_${idx}_fin`]}>
                                <Input type="date" value={r.fecha_fin} onChange={setReqField(idx, "fecha_fin")}
                                  min={r.fecha_inicio || minReqDate} max={maxReqDate} error={!!errors[`req_${idx}_fin`]} />
                              </FieldWrapper>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          </div>
          )}
        </div>

        {/* ── Actividades Planificadas ── */}
        <div className="border-t border-[#f0f0f0] pt-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-[#f0f9ff] flex items-center justify-center">
                <CalendarDays className="w-3.5 h-3.5 text-[#4a90e2]" />
              </div>
              <p className="text-xs font-semibold text-[#888] uppercase tracking-widest">Actividades Planificadas</p>
            </div>
            <button
              type="button"
              onClick={() => { setActividadOpen(true); setNuevaActividad({ ...EMPTY_ACTIVIDAD }); setEditingActividadIdx(null); }}
              className="flex items-center gap-1 text-[11px] text-[#4a90e2] hover:text-[#2563eb] font-medium transition-colors"
            >
              <Plus className="w-3 h-3" /> Agregar actividad
            </button>
          </div>

          {/* Lista de actividades agregadas */}
          {actividades.length > 0 && (
            <div className="space-y-2 mb-3">
              {actividades.map((a, i) => (
                <div key={i} className="flex items-center gap-2 bg-[#f9f9f9] border border-[#f0f0f0] rounded-lg px-3 py-2 text-xs">
                  <span className={`px-2 py-0.5 rounded-full font-semibold flex-shrink-0 ${a.tipo === "Viajes" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"}`}>
                    {a.tipo}
                  </span>
                  <span className="font-medium text-[#1a1a1a] truncate flex-1">{a.titulo}</span>
                  <span className="text-[#aaa] flex-shrink-0 whitespace-nowrap">{a.fecha_inicio} → {a.fecha_fin}</span>
                  <button
                    type="button"
                    onClick={() => { setNuevaActividad({ ...a }); setEditingActividadIdx(i); setActividadOpen(true); }}
                    className="text-[#ccc] hover:text-[#4a90e2] transition-colors flex-shrink-0 ml-1"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setActividades((prev) => prev.filter((_, j) => j !== i))}
                    className="text-[#ccc] hover:text-red-500 transition-colors flex-shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Sub-formulario nueva actividad */}
          {actividadOpen && (
            <div className="border border-[#e8e8e8] rounded-xl p-4 space-y-3 bg-[#fafafa]">
              <div className="grid grid-cols-2 gap-3">
                <FieldWrapper label="Tipo" error={errors.act_tipo}>
                  <Select
                    value={nuevaActividad.tipo}
                    onChange={(e) => setNuevaActividad((p) => ({ ...p, tipo: (e as any).target?.value ?? e as any }))}
                    options={[{ value: "Viajes", label: "Viajes" }, { value: "Taller", label: "Taller" }]}
                    placeholder="Seleccionar"
                  />
                </FieldWrapper>
                <FieldWrapper label="Título" error={errors.act_titulo}>
                  <Input
                    value={nuevaActividad.titulo}
                    onChange={(e) => setNuevaActividad((p) => ({ ...p, titulo: e.target.value }))}
                    placeholder="ej: Workshop de diagnóstico"
                  />
                </FieldWrapper>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FieldWrapper label="Fecha inicio" error={errors.act_fechas}>
                  <Input type="date" value={nuevaActividad.fecha_inicio}
                    onChange={(e) => setNuevaActividad((p) => ({ ...p, fecha_inicio: e.target.value }))} />
                </FieldWrapper>
                <FieldWrapper label="Fecha término">
                  <Input type="date" value={nuevaActividad.fecha_fin}
                    min={nuevaActividad.fecha_inicio || undefined}
                    onChange={(e) => setNuevaActividad((p) => ({ ...p, fecha_fin: e.target.value }))} />
                </FieldWrapper>
              </div>
              {(minActDate || maxActDate) && (
                <p className="text-[11px] text-[#888] -mt-1">
                  Fechas del engagement: {minActDate ?? "…"} a {maxActDate ?? "…"}
                </p>
              )}
              <FieldWrapper label="Descripción (opcional)">
                <Textarea value={nuevaActividad.descripcion}
                  onChange={(e) => setNuevaActividad((p) => ({ ...p, descripcion: (e as any).target?.value ?? e as any }))}
                  placeholder="Detalles breves..." />
              </FieldWrapper>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => { setActividadOpen(false); setEditingActividadIdx(null); setErrors((p) => { const n = { ...p }; delete n.act_tipo; delete n.act_titulo; delete n.act_fechas; return n; }); }}
                  className="text-xs px-3 py-1.5 rounded-lg border border-[#e8e8e8] text-[#888] hover:bg-[#f5f5f5] transition-colors">
                  Cancelar
                </button>
                <button type="button"
                  onClick={() => {
                    const errs: Record<string, string> = {};
                    if (!nuevaActividad.tipo)          errs.act_tipo   = "Requerido";
                    if (!nuevaActividad.titulo.trim())  errs.act_titulo = "Requerido";
                    const { fecha_inicio: ai, fecha_fin: af } = nuevaActividad;
                    if (!ai || !af) errs.act_fechas = "Ingresa fecha de inicio y término.";
                    else if (af < ai) errs.act_fechas = "La fecha de término no puede ser anterior al inicio.";
                    if (Object.keys(errs).length) { setErrors((p) => ({ ...p, ...errs })); return; }
                    // Fuera de las fechas del engagement se permite, pero confirmando primero
                    // (en el Tablero se mostrará solo el ícono en esa semana, sin la barra)
                    if ((minActDate && ai < minActDate) || (maxActDate && af > maxActDate)) { setConfirmActFuera(true); return; }
                    guardarActividad();
                  }}
                  className="text-xs px-3 py-1.5 rounded-lg bg-[#4a90e2] text-white hover:bg-[#2563eb] transition-colors font-medium">
                  {editingActividadIdx !== null ? "Actualizar" : "Agregar"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Aviso: viaje/taller fuera de las fechas del engagement */}
        <ConfirmDialog
          open={confirmActFuera}
          onClose={() => setConfirmActFuera(false)}
          onConfirm={() => { setConfirmActFuera(false); guardarActividad(); }}
          title={`${nuevaActividad.tipo === "Taller" ? "Taller" : "Viaje"} fuera de las fechas del engagement`}
          confirmLabel="Confirmar"
          message={`Las fechas (${nuevaActividad.fecha_inicio} a ${nuevaActividad.fecha_fin}) quedan fuera del engagement (${minActDate ?? "…"} a ${maxActDate ?? "…"}). Se guardará igual y en el Tablero se mostrará solo el ícono de ${nuevaActividad.tipo === "Taller" ? "taller" : "viaje"} en esas semanas, sin la barra del proyecto. ¿Quieres continuar?`}
        />

        {/* Confirmación al apagar "¿Quieres extender el proyecto?" */}
        <ConfirmDialog
          open={confirmQuitarExt}
          onClose={() => setConfirmQuitarExt(false)}
          onConfirm={() => handleSubmit(true)}
          loading={loading}
          title="Eliminar alargue"
          confirmLabel="Eliminar y guardar"
          message={`Se eliminará el alargue${extPrev ? ` (${extPrev.inicio} a ${extPrev.fin})` : ""} y todas las asignaciones de ese período. ¿Quieres continuar?`}
        />

        {/* ── Extender Proyecto (solo en modo edición) ── */}
        {engagement && (
          <div className="border-t border-[#f0f0f0] pt-5">
            <button
              type="button"
              onClick={() => setExtOpen((o) => !o)}
              className="w-full flex items-center justify-between group"
            >
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-[#f0f9ff] flex items-center justify-center">
                  <Users className="w-3.5 h-3.5 text-[#4a90e2]" />
                </div>
                <p className="text-xs font-semibold text-[#888] uppercase tracking-widest">Extender Proyecto</p>
              </div>
              {extOpen
                ? <ChevronUp className="w-4 h-4 text-[#aaa] group-hover:text-[#666] transition-colors" />
                : <ChevronDown className="w-4 h-4 text-[#aaa] group-hover:text-[#666] transition-colors" />
              }
            </button>
            {extOpen && (
              <div className="mt-4">
                <ExtenderProyecto
                  engagementId={engagement.id}
                  engagementTipo={engagement.tipo}
                  onExtended={recargarEquipo}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}
