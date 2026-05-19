"use client";

import { useState, useEffect } from "react";
import { Plus, Trash2, ChevronDown, ChevronUp, Users } from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";
import { Drawer } from "@/components/ui/Drawer";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { FieldWrapper, Input, Select, Textarea } from "@/components/ui/FormField";
import { MultiSelect } from "@/components/ui/MultiSelect";
import { CARGOS_OPTIONS } from "@/lib/constants";
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
}

interface EngagementFormProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  engagement?: Engagement;
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

export function EngagementForm({ open, onClose, onSuccess, engagement }: EngagementFormProps) {
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

  useEffect(() => {
    if (!open) {
      setForm({ ...EMPTY_ENG }); setReqs([]); setErrors({}); setServerError(null);
      setExtOpen(false);
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
        const [{ data: reqData }, { data: ecData }, { data: etData }] = await Promise.all([
          supabase.from("requerimiento_engagement").select("*").eq("engagement_id", engagement.id).order("fase_nombre"),
          (supabase as any).from("engagement_capacidad").select("capacidad_id").eq("engagement_id", engagement.id),
          (supabase as any).from("engagement_tematica").select("tematica_id").eq("engagement_id", engagement.id),
        ]);
        setForm({
          codigo: engagement.codigo ?? "",
          nombre: engagement.nombre,
          cliente: engagement.cliente,
          tipo: engagement.tipo,
          estado: engagement.estado,
          descripcion: engagement.descripcion ?? "",
          fecha_inicio: engagement.fecha_inicio ?? "",
          fecha_fin_estimada: engagement.fecha_fin_estimada ?? "",
          industria_id: engagement.industria_id ?? "",
          capacidades: (ecData ?? []).map((r: any) => r.capacidad_id),
          tematicas: (etData ?? []).map((r: any) => r.tematica_id),
        });
        setReqs((reqData ?? []).map((r: RequerimientoEngagement) => ({
          id: r.id,
          fase_nombre: r.fase_nombre ?? "",
          cargo_requerido: r.cargo_requerido ?? "",
          descripcion: r.descripcion ?? "",
          pct_dedicacion: String(r.pct_dedicacion),
          fecha_inicio: r.fecha_inicio,
          fecha_fin: r.fecha_fin,
        })));
      }
    }
    load();
  }, [open, engagement]);

  const setField = (field: string) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => setForm((f) => ({ ...f, [field]: e.target.value }));

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

  const addReq = () =>
    setReqs((r) => [...r, {
      ...EMPTY_REQ,
      fecha_inicio: form.fecha_inicio,
      fecha_fin: form.fecha_fin_estimada,
    }]);

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
      if (form.tipo !== "ayuda_interna" && !form.cliente.trim()) e.cliente = "Requerido";
    }
    if (form.fecha_fin_estimada && form.fecha_inicio && form.fecha_fin_estimada < form.fecha_inicio) {
      e.fecha_fin_estimada = "No puede ser anterior a la fecha de inicio";
    }
    if (!esPropuesta) {
      reqs.forEach((r, i) => {
        if (!r.pct_dedicacion || isNaN(Number(r.pct_dedicacion))) {
          e[`req_${i}_pct`] = "% inválido";
        }
        if (!r.fecha_inicio) {
          e[`req_${i}_inicio`] = "Requerida";
        } else if (form.fecha_inicio && r.fecha_inicio < form.fecha_inicio) {
          e[`req_${i}_inicio`] = `No puede ser antes del ${form.fecha_inicio}`;
        } else if (form.fecha_fin_estimada && r.fecha_inicio > form.fecha_fin_estimada) {
          e[`req_${i}_inicio`] = `No puede ser después del ${form.fecha_fin_estimada}`;
        }
        if (!r.fecha_fin) {
          e[`req_${i}_fin`] = "Requerida";
        } else if (r.fecha_inicio && r.fecha_fin < r.fecha_inicio) {
          e[`req_${i}_fin`] = "No puede ser anterior a la fecha de inicio";
        } else if (form.fecha_fin_estimada && r.fecha_fin > form.fecha_fin_estimada) {
          e[`req_${i}_fin`] = `No puede ser después del ${form.fecha_fin_estimada}`;
        }
      });
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setLoading(true); setServerError(null);
    const supabase = createAnyClient();

    const payload = {
      nombre: form.nombre.trim(),
      cliente: form.cliente.trim(),
      tipo: form.tipo as "propuesta" | "proyecto" | "ayuda_interna",
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

    for (const [i, r] of reqs.entries()) {
      const reqPayload = {
        engagement_id: engId,
        fase_nombre: r.fase_nombre.trim() || null,
        cargo_requerido: r.cargo_requerido || null,
        descripcion: r.descripcion.trim() || null,
        pct_dedicacion: Number(r.pct_dedicacion),
        fecha_inicio: r.fecha_inicio,
        fecha_fin: r.fecha_fin,
      };
      if (r.id) {
        await supabase.from("requerimiento_engagement").update(reqPayload).eq("id", r.id);
      } else {
        await supabase.from("requerimiento_engagement").insert(reqPayload);
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
          // 1. Extender fecha_fin de los reqs
          await supabase
            .from("requerimiento_engagement")
            .update({ fecha_fin: newFin })
            .in("id", reqsAExtender.map((r) => r.id));

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
    window.dispatchEvent(new CustomEvent("engagementChanged", { detail: { engagementId: engId } }));
    onSuccess();
    onClose();
  };

  // Límites de fecha para requerimientos
  const minReqDate = form.fecha_inicio || undefined;
  const maxReqDate = form.fecha_fin_estimada || undefined;

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
            required={form.tipo !== "ayuda_interna" && form.tipo !== "propuesta"}
            error={errors.cliente}
            hint={form.tipo === "ayuda_interna" || form.tipo === "propuesta" ? "Opcional" : undefined}
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
                { value: "proyecto", label: "Proyecto" },
                { value: "ayuda_interna", label: "Ayuda interna" },
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
            <Input type="date" value={form.fecha_inicio} onChange={setField("fecha_inicio")}
              max={form.fecha_fin_estimada || undefined} />
          </FieldWrapper>
          <FieldWrapper label="Fecha fin estimada" error={errors.fecha_fin_estimada}>
            <Input type="date" value={form.fecha_fin_estimada} onChange={setField("fecha_fin_estimada")}
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
            <div>
              <p className="text-xs font-semibold text-[#888] uppercase tracking-widest">Requerimientos</p>
              {(minReqDate || maxReqDate) && (
                <p className="text-[10px] text-[#aaa] mt-0.5">
                  Las fechas deben estar dentro del rango del engagement
                  {minReqDate && ` (desde ${minReqDate}`}{maxReqDate && ` → ${maxReqDate}`}{(minReqDate || maxReqDate) && ")"}
                </p>
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
            {reqs.map((r, i) => (
              <div key={i} className="border border-[#e8e8e8] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#888]">Requerimiento {i + 1}</span>
                  <button onClick={() => removeReq(i)} className="text-[#aaa] hover:text-red-500 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
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
            ))}
          </div>
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
                <ExtenderProyecto engagementId={engagement.id} engagementTipo={engagement.tipo} onExtended={onSuccess} />
              </div>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}
