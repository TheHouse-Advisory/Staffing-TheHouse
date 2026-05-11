"use client";

import { useState, useEffect } from "react";
import { Plus, Trash2, ChevronDown, ChevronUp, Users } from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";
import { Drawer } from "@/components/ui/Drawer";
import { Button } from "@/components/ui/Button";
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
  nombre: "", cliente: "", tipo: "proyecto", estado: "activo",
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
    if (!form.nombre.trim()) e.nombre = "Requerido";
    if (form.tipo !== "ayuda_interna" && !form.cliente.trim()) e.cliente = "Requerido";
    if (form.fecha_fin_estimada && form.fecha_inicio && form.fecha_fin_estimada < form.fecha_inicio) {
      e.fecha_fin_estimada = "No puede ser anterior a la fecha de inicio";
    }
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

    setLoading(false);
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
      title={engagement ? "Editar engagement" : "Nuevo engagement"}
      width="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button onClick={handleSubmit} loading={loading}>
            {engagement ? "Guardar cambios" : "Crear engagement"}
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
          <FieldWrapper label="Nombre" required error={errors.nombre} className="col-span-2">
            <Input value={form.nombre} onChange={setField("nombre")} placeholder="Transformación Operacional..." error={!!errors.nombre} />
          </FieldWrapper>
          <FieldWrapper
            label="Cliente"
            required={form.tipo !== "ayuda_interna"}
            error={errors.cliente}
            hint={form.tipo === "ayuda_interna" ? "Opcional para ayuda interna" : undefined}
          >
            <Input
              value={form.cliente}
              onChange={setField("cliente")}
              placeholder={form.tipo === "ayuda_interna" ? "Equipo / área interna (opcional)" : "Empresa SA"}
              error={!!errors.cliente}
            />
          </FieldWrapper>
          <FieldWrapper label="Industria">
            <Select value={form.industria_id} onChange={setField("industria_id")} options={industrias} placeholder="Sin industria" />
          </FieldWrapper>
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
          <FieldWrapper label="Capacidades" hint="Habilidades técnicas requeridas">
            <MultiSelect
              options={capacidadesOpts}
              value={form.capacidades}
              onChange={(v) => setForm((f) => ({ ...f, capacidades: v }))}
              placeholder="Agregar capacidades..."
            />
          </FieldWrapper>
          <FieldWrapper label="Temáticas" hint="Áreas temáticas del engagement">
            <MultiSelect
              options={tematicasOpts}
              value={form.tematicas}
              onChange={(v) => setForm((f) => ({ ...f, tematicas: v }))}
              placeholder="Agregar temáticas..."
            />
          </FieldWrapper>
        </div>

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
                    <Input type="number" min="1" max="100" value={r.pct_dedicacion}
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
