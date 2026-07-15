"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ChevronDown, ChevronUp, Users, CalendarDays, Pencil } from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";
import { Drawer } from "@/components/ui/Drawer";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { FieldWrapper, Input, Select, Textarea } from "@/components/ui/FormField";
import { MultiSelect } from "@/components/ui/MultiSelect";
import { CARGOS_OPTIONS } from "@/lib/constants";

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
import type { Engagement, RequerimientoEngagement } from "@/lib/types/database";
import { ExtenderProyecto } from "./ExtenderProyecto";

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
  const [serverError, setServerError] = useState<string | null>(null);
  const [industrias, setIndustrias] = useState<{ value: string; label: string }[]>([]);
  const [capacidadesOpts, setCapacidadesOpts] = useState<{ value: string; label: string }[]>([]);
  const [tematicasOpts, setTematicasOpts] = useState<{ value: string; label: string }[]>([]);

  const [extOpen, setExtOpen] = useState(false);
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
  const [editingActividadIdx, setEditingActividadIdx] = useState<number | null>(null);
  // Acordeón de requerimientos: set de índices colapsados
  const [reqsColapsados, setReqsColapsados] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open) {
      setForm({ ...EMPTY_ENG }); setReqs([]); setErrors({}); setServerError(null);
      setExtOpen(false); setActividades([]); setActividadOpen(false); setNuevaActividad({ ...EMPTY_ACTIVIDAD }); setEditingActividadIdx(null);
      return;
    }
    async function load() {
      const supabase = createAnyClient();
      const [iData, capData, temData] = await Promise.all([
        supabase.from("cat_industria").select("id,nombre").eq("activo", true).order("nombre"),
        supabase.from("cat_capacidad").select("id,nombre").eq("activo", true).order("nombre"),
        supabase.from("cat_tematica").select("id,nombre").eq("activo", true).order("nombre"),
      ]);
      setIndustrias((iData.data ?? []).map((r: any) => ({ value: r.id, label: r.nombre })));
      setCapacidadesOpts((capData.data ?? []).map((r: any) => ({ value: r.id, label: r.nombre })));
      setTematicasOpts((temData.data ?? []).map((r: any) => ({ value: r.id, label: r.nombre })));

      if (engagement) {
        const [{ data: reqData }, { data: ecData }, { data: etData }, { data: asigData }] = await Promise.all([
          supabase.from("requerimiento_engagement").select("*").eq("engagement_id", engagement.id).order("fase_nombre"),
          (supabase as any).from("engagement_capacidad").select("capacidad_id").eq("engagement_id", engagement.id),
          (supabase as any).from("engagement_tematica").select("tematica_id").eq("engagement_id", engagement.id),
          (supabase as any).from("asignacion")
            .select("requerimiento_id, persona:persona_id(nombre, apellido, cargo_actual)")
            .eq("engagement_id", engagement.id)
            .eq("estado", "activa"),
        ]);

        // Mapa requerimiento_id → nombre (match exacto)
        type AsigRow = { requerimiento_id: string | null; persona: { nombre: string; apellido: string; cargo_actual?: string } | null };
        const asigRows = (asigData ?? []) as AsigRow[];
        const personaPorReq = new Map<string, string>(
          asigRows
            .filter((a) => a.requerimiento_id && a.persona)
            .map((a) => [a.requerimiento_id!, `${a.persona!.nombre} ${a.persona!.apellido}`])
        );
        // Mapa cargo_normalizado → nombre — fallback para asignaciones antiguas sin requerimiento_id
        const normCargoEF = (s: string) => s.trim().toLowerCase();
        const cargoContieneEF = (cargoPersona: string, cargoReq: string) => {
          const cp = normCargoEF(cargoPersona);
          const cr = normCargoEF(cargoReq);
          return cp === cr || cr.includes(cp) || cp.includes(cr);
        };
        // Solo las asignaciones sin requerimiento_id vinculado
        const asigSinReq = asigRows.filter((a) => !a.requerimiento_id && a.persona);
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
          setReqs((reqData ?? []).map((r: RequerimientoEngagement) => ({
            id: r.id,
            fase_nombre: r.fase_nombre ?? "",
            cargo_requerido: toCargoOption(r.cargo_requerido),
            descripcion: r.descripcion ?? "",
            pct_dedicacion: String(r.pct_dedicacion),
            fecha_inicio: r.fecha_inicio ?? "",
            fecha_fin: r.fecha_fin ?? "",
            persona_nombre: r.id
              ? (personaPorReq.get(r.id) ??
                  (() => {
                    const m = asigSinReq.find((a) => cargoContieneEF(a.persona!.cargo_actual ?? "", r.cargo_requerido ?? ""));
                    return m ? `${m.persona!.nombre} ${m.persona!.apellido}` : undefined;
                  })())
              : undefined,
          })));
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
    await (supabase as any).from("cat_industria").update({ activo: false }).eq("id", eliminarCandidata.value);
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
    await (supabase as any).from("cat_capacidad").update({ activo: false }).eq("id", eliminarCapCandidata.value);
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
    await (supabase as any).from("cat_tematica").update({ activo: false }).eq("id", eliminarTemCandidata.value);
    setTematicasOpts((prev) => prev.filter((i) => i.value !== eliminarTemCandidata.value));
    setForm((f) => ({ ...f, tematicas: f.tematicas.filter((id) => id !== eliminarTemCandidata.value) }));
    setEliminarTemLoading(false); setEliminarTemCandidata(null);
  }

  // fecha_fin_estimada puede estar vacía si el engagement usa fecha_fin_real
  const fechaFinEfectiva = form.fecha_fin_estimada || (engagement as any)?.fecha_fin_real || "";

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

  const removeReq = (idx: number) =>
    setReqs((r) => r.filter((_, i) => i !== idx));

  const setReqField = (idx: number, field: keyof ReqRow) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => setReqs((rs) => rs.map((r, i) => i === idx ? { ...r, [field]: e.target.value } : r));

  const validate = () => {
    const e: Record<string, string> = {};
    const esPropuesta = form.tipo === "propuesta";

    if (!esPropuesta) {
      if (!form.nombre.trim()) e.nombre = "Requerido";
      if (form.tipo !== "ayuda_interna" && form.tipo !== "posibles_proyectos" && !form.cliente.trim()) e.cliente = "Requerido";
    }
    if (form.fecha_fin_estimada && form.fecha_inicio && form.fecha_fin_estimada < form.fecha_inicio) {
      e.fecha_fin_estimada = "No puede ser anterior a la fecha de inicio";
    }
    // Usa fecha_fin_real como límite cuando fecha_fin_estimada no está disponible
    const maxFin = form.fecha_fin_estimada || (engagement as any)?.fecha_fin_real || null;
    if (!esPropuesta) {
      reqs.forEach((r, i) => {
        if (!r.pct_dedicacion || isNaN(Number(r.pct_dedicacion))) {
          e[`req_${i}_pct`] = "% inválido";
        }
        if (!r.fecha_inicio) {
          e[`req_${i}_inicio`] = "Requerida";
        } else if (form.fecha_inicio && r.fecha_inicio < form.fecha_inicio) {
          e[`req_${i}_inicio`] = `No puede ser antes del ${form.fecha_inicio}`;
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
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
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
      // Borrar reqs huérfanos
      const savedIds = reqs.filter((r) => r.id).map((r) => r.id!);
      if (savedIds.length > 0) {
        await supabase.from("requerimiento_engagement")
          .delete().eq("engagement_id", engId).not("id", "in", `(${savedIds.join(",")})`);
      } else {
        await supabase.from("requerimiento_engagement").delete().eq("engagement_id", engId);
      }
    } else {
      const { data, error } = await supabase.from("engagement").insert(payload).select("id").single();
      if (error || !data) { setServerError(error?.message ?? "Error"); setLoading(false); return; }
      engId = data.id;
    }

    // Capacidades y temáticas: borrar y reinsertar
    await Promise.all([
      (supabase as any).from("engagement_capacidad").delete().eq("engagement_id", engId),
      (supabase as any).from("engagement_tematica").delete().eq("engagement_id", engId),
    ]);
    const caps = form.capacidades.map((id) => ({ engagement_id: engId, capacidad_id: id }));
    const tems = form.tematicas.map((id) => ({ engagement_id: engId, tematica_id: id }));
    await Promise.all([
      caps.length > 0 ? (supabase as any).from("engagement_capacidad").insert(caps) : Promise.resolve(),
      tems.length > 0 ? (supabase as any).from("engagement_tematica").insert(tems) : Promise.resolve(),
    ]);

    // Actividades: borrar todas y reinsertar (mismo patrón que capacidades)
    await (supabase as any).from("engagement_actividades").delete().eq("engagement_id", engId);
    if (actividades.length > 0) {
      await (supabase as any).from("engagement_actividades").insert(
        actividades.map((a) => ({
          engagement_id: engId,
          tipo: a.tipo,
          titulo: a.titulo.trim(),
          descripcion: a.descripcion.trim() || null,
          fecha_inicio: a.fecha_inicio,
          fecha_fin: a.fecha_fin,
        }))
      );
    }

    for (const [i, r] of reqs.entries()) {
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

        // Cascada: sincroniza fechas y pct_dedicacion en asignaciones activas
        const asigUpdate: Record<string, string | number | null> = {
          pct_dedicacion: reqPayload.pct_dedicacion,
        };
        if (reqPayload.fecha_inicio) asigUpdate.fecha_inicio = reqPayload.fecha_inicio;
        if (reqPayload.fecha_fin)    asigUpdate.fecha_fin    = reqPayload.fecha_fin;
        await supabase
          .from("asignacion")
          .update(asigUpdate)
          .eq("requerimiento_id", r.id)
          .eq("estado", "activa");
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

      if (syncOps.length > 0) await Promise.all(syncOps);

      // Propaga el mismo cambio de fechas a las asignaciones activas del engagement
      const asigMassUpdate: Record<string, string> = {};
      if (form.fecha_inicio && engagement.fecha_inicio && form.fecha_inicio !== engagement.fecha_inicio)
        asigMassUpdate.fecha_inicio = form.fecha_inicio;
      if (form.fecha_fin_estimada && engagement.fecha_fin_estimada &&
          form.fecha_fin_estimada < engagement.fecha_fin_estimada)
        asigMassUpdate.fecha_fin = form.fecha_fin_estimada;

      if (Object.keys(asigMassUpdate).length > 0) {
        await supabase
          .from("asignacion")
          .update(asigMassUpdate)
          .eq("engagement_id", engId)
          .eq("estado", "activa");
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
          await supabase
            .from("requerimiento_engagement")
            .update({ fecha_fin: newFin })
            .in("id", reqIds);

          // 1b. Extender todas las asignaciones activas que llegaban hasta oldFin
          //     (cubre PLAN y cualquier otro estado_staffing sin excepción)
          await supabase
            .from("asignacion")
            .update({ fecha_fin: newFin })
            .in("requerimiento_id", reqIds)
            .eq("estado", "activa")
            .eq("fecha_fin", oldFin);

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
              await supabase.from("asignacion").insert({
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
            }
          }
        }
      }
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
  const maxReqDate = form.fecha_fin_estimada || (engagement as any)?.fecha_fin_real || undefined;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={engagement ? "Editar proyecto" : "Nuevo proyecto"}
      width="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button onClick={handleSubmit} loading={loading}>
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
            <Select value={form.industria_id} onChange={setField("industria_id")} options={industrias} placeholder="Sin industria" allowEmpty />
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

        <div className="grid grid-cols-2 gap-4">
          {/* ── Capacidades ── */}
          <FieldWrapper label="Capacidades" hint="Habilidades técnicas requeridas">
            <MultiSelect
              options={capacidadesOpts}
              value={form.capacidades}
              onChange={(v) => setForm((f) => ({ ...f, capacidades: v }))}
              placeholder="Agregar capacidades..."
            />
            <div className="mt-1 flex items-center gap-3">
              <button type="button" onClick={() => { setNuevaCapacidadNombre(""); setNuevaCapacidadError(null); setNuevaCapacidadOpen(true); }}
                className="flex items-center gap-1 text-[11px] text-[#2563eb] hover:underline">
                <Plus className="w-3 h-3" /> Nueva capacidad
              </button>
              {capacidadesOpts.length > 0 && (
                <button type="button" onClick={() => setShowEliminarCapLista((s) => !s)}
                  className="flex items-center gap-1 text-[11px] text-[#888] hover:text-red-500 hover:underline">
                  <Trash2 className="w-3 h-3" /> Eliminar
                </button>
              )}
            </div>
            {showEliminarCapLista && (
              <div className="mt-2 border border-[#e8e8e8] rounded-lg overflow-hidden max-h-44 overflow-y-auto">
                {capacidadesOpts.map((opt) => (
                  <div key={opt.value} className="flex items-center justify-between px-3 py-1.5 hover:bg-[#fafafa] border-b border-[#f0f0f0] last:border-0">
                    <span className="text-[12px] text-[#333]">{opt.label}</span>
                    <button type="button" onClick={() => abrirEliminarCapacidad(opt)}
                      className="p-1 rounded hover:bg-[#fee2e2] text-[#ccc] hover:text-[#dc2626] transition-colors">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </FieldWrapper>

          {/* ── Temáticas ── */}
          <FieldWrapper label="Temáticas" hint="Áreas temáticas del engagement">
            <MultiSelect
              options={tematicasOpts}
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

        {/* ── Modal nueva capacidad ── */}
        <Modal open={nuevaCapacidadOpen} onClose={() => setNuevaCapacidadOpen(false)} title="Nueva capacidad"
          footer={<>
            <Button variant="secondary" onClick={() => setNuevaCapacidadOpen(false)} disabled={nuevaCapacidadLoading}>Cancelar</Button>
            <Button onClick={guardarNuevaCapacidad} loading={nuevaCapacidadLoading}>Guardar</Button>
          </>}>
          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-[#888] uppercase tracking-wide">Nombre</label>
            <input autoFocus type="text" value={nuevaCapacidadNombre}
              onChange={(e) => setNuevaCapacidadNombre(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); guardarNuevaCapacidad(); } }}
              placeholder="Ej. Análisis de datos"
              className="w-full border border-[#e0e0e0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb]" />
            {nuevaCapacidadError && <p className="text-[11px] text-red-500">{nuevaCapacidadError}</p>}
          </div>
        </Modal>

        {/* ── Modal eliminar capacidad ── */}
        <Modal open={!!eliminarCapCandidata} onClose={() => { if (!eliminarCapLoading) setEliminarCapCandidata(null); }} title="Eliminar capacidad"
          footer={eliminarCapCheck.loading || eliminarCapCheck.count > 0
            ? <Button variant="secondary" onClick={() => setEliminarCapCandidata(null)}>Cerrar</Button>
            : <>
                <Button variant="secondary" onClick={() => setEliminarCapCandidata(null)} disabled={eliminarCapLoading}>Cancelar</Button>
                <Button variant="danger" onClick={confirmarEliminarCapacidad} loading={eliminarCapLoading}>Sí, eliminar</Button>
              </>}>
          {eliminarCapCheck.loading ? (
            <p className="text-sm text-[#888]">Verificando usos...</p>
          ) : eliminarCapCheck.count > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-red-600">No se puede eliminar.</p>
              <p className="text-sm text-[#555]">Hay <strong>{eliminarCapCheck.count}</strong> proyecto{eliminarCapCheck.count !== 1 ? "s" : ""} asociado{eliminarCapCheck.count !== 1 ? "s" : ""} a <strong>{eliminarCapCandidata?.label}</strong>.</p>
            </div>
          ) : (
            <p className="text-sm text-[#555]">¿Estás seguro de eliminar <strong>{eliminarCapCandidata?.label}</strong>? Esta acción no se puede deshacer.</p>
          )}
        </Modal>

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
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div>
                <p className="text-xs font-semibold text-[#888] uppercase tracking-widest">Requerimientos</p>
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
            {reqs.map((r, i) => {
              const colapsado = reqsColapsados.has(i);
              const toggleReq = () => setReqsColapsados((prev) => {
                const next = new Set(prev);
                if (next.has(i)) next.delete(i); else next.add(i);
                return next;
              });
              return (
                <div key={i} id={`req-card-${i}`} className="border border-[#e8e8e8] rounded-xl overflow-hidden">
                  {/* Cabecera siempre visible */}
                  <div
                    className="flex items-center justify-between px-4 py-3 cursor-pointer select-none hover:bg-[#fafafa] transition-colors"
                    onClick={toggleReq}
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-semibold text-[#888]">
                        Requerimiento {i + 1}
                        {r.fase_nombre && <span className="ml-1.5 font-normal text-[#aaa]">· {r.fase_nombre}</span>}
                        {r.cargo_requerido && <span className="ml-1.5 font-normal text-[#aaa]">· {r.cargo_requerido}</span>}
                        {r.persona_nombre && (
                          <span className="ml-1.5 font-normal text-[#4a90e2]">· {r.persona_nombre}</span>
                        )}
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
                        onClick={(e) => { e.stopPropagation(); removeReq(i); }}
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
                          <Input value={r.fase_nombre} onChange={setReqField(i, "fase_nombre")} placeholder="Diagnóstico" />
                        </FieldWrapper>
                        <FieldWrapper label="Cargo requerido">
                          <Select value={r.cargo_requerido} onChange={setReqField(i, "cargo_requerido")}
                            options={CARGOS_OPTIONS} placeholder="Cualquier cargo" />
                        </FieldWrapper>
                        <FieldWrapper label="% Dedicación" required error={errors[`req_${i}_pct`]}>
                          <Input type="number" min="1" max="100" step="0.5" value={r.pct_dedicacion}
                            onChange={setReqField(i, "pct_dedicacion")} placeholder="100"
                            error={!!errors[`req_${i}_pct`]} />
                        </FieldWrapper>
                        <FieldWrapper label="Descripción del rol">
                          <Input value={r.descripcion} onChange={setReqField(i, "descripcion")} placeholder="Líder de proyecto" />
                        </FieldWrapper>
                        <FieldWrapper label="Fecha inicio" required error={errors[`req_${i}_inicio`]}>
                          <Input type="date" value={r.fecha_inicio} onChange={setReqField(i, "fecha_inicio")}
                            min={minReqDate} max={maxReqDate} error={!!errors[`req_${i}_inicio`]} />
                        </FieldWrapper>
                        <FieldWrapper label="Fecha fin" required error={errors[`req_${i}_fin`]}>
                          <Input type="date" value={r.fecha_fin} onChange={setReqField(i, "fecha_fin")}
                            min={r.fecha_inicio || minReqDate} max={maxReqDate} error={!!errors[`req_${i}_fin`]} />
                        </FieldWrapper>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
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
                <FieldWrapper label="Fecha inicio">
                  <Input type="date" value={nuevaActividad.fecha_inicio}
                    onChange={(e) => setNuevaActividad((p) => ({ ...p, fecha_inicio: e.target.value }))} />
                </FieldWrapper>
                <FieldWrapper label="Fecha término">
                  <Input type="date" value={nuevaActividad.fecha_fin}
                    onChange={(e) => setNuevaActividad((p) => ({ ...p, fecha_fin: e.target.value }))} />
                </FieldWrapper>
              </div>
              <FieldWrapper label="Descripción (opcional)">
                <Textarea value={nuevaActividad.descripcion}
                  onChange={(e) => setNuevaActividad((p) => ({ ...p, descripcion: (e as any).target?.value ?? e as any }))}
                  placeholder="Detalles breves..." />
              </FieldWrapper>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => { setActividadOpen(false); setEditingActividadIdx(null); setErrors((p) => { const n = { ...p }; delete n.act_tipo; delete n.act_titulo; return n; }); }}
                  className="text-xs px-3 py-1.5 rounded-lg border border-[#e8e8e8] text-[#888] hover:bg-[#f5f5f5] transition-colors">
                  Cancelar
                </button>
                <button type="button"
                  onClick={() => {
                    const errs: Record<string, string> = {};
                    if (!nuevaActividad.tipo)          errs.act_tipo   = "Requerido";
                    if (!nuevaActividad.titulo.trim())  errs.act_titulo = "Requerido";
                    if (Object.keys(errs).length) { setErrors((p) => ({ ...p, ...errs })); return; }
                    if (editingActividadIdx !== null) {
                      // Reemplazar actividad existente
                      setActividades((prev) => prev.map((a, j) => j === editingActividadIdx ? { ...nuevaActividad } : a));
                      setEditingActividadIdx(null);
                    } else {
                      setActividades((prev) => [...prev, { ...nuevaActividad }]);
                    }
                    setActividadOpen(false);
                    setNuevaActividad({ ...EMPTY_ACTIVIDAD });
                    setErrors((p) => { const n = { ...p }; delete n.act_tipo; delete n.act_titulo; return n; });
                  }}
                  className="text-xs px-3 py-1.5 rounded-lg bg-[#4a90e2] text-white hover:bg-[#2563eb] transition-colors font-medium">
                  {editingActividadIdx !== null ? "Actualizar" : "Agregar"}
                </button>
              </div>
            </div>
          )}
        </div>

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
                  onExtended={onSuccess}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}
