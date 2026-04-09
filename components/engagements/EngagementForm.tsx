"use client";

import { useState, useEffect } from "react";
import { Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Drawer } from "@/components/ui/Drawer";
import { Button } from "@/components/ui/Button";
import { FieldWrapper, Input, Select, Textarea } from "@/components/ui/FormField";
import type { Engagement, RequerimientoEngagement } from "@/lib/types/database";


// Requerimiento en el formulario (sin id si es nuevo)
interface ReqRow {
  id?: string;        // existe si ya fue guardado
  fase_numero: number;
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
  nombre: "", cliente: "", tipo: "proyecto", estado: "propuesta",
  descripcion: "", fecha_inicio: "", fecha_fin_estimada: "", industria_id: "",
};

const EMPTY_REQ: Omit<ReqRow, "fase_numero"> = {
  fase_nombre: "", cargo_requerido: "", descripcion: "",
  pct_dedicacion: "", fecha_inicio: "", fecha_fin: "",
};

export function EngagementForm({ open, onClose, onSuccess, engagement }: EngagementFormProps) {
  const [form, setForm] = useState({ ...EMPTY_ENG });
  const [reqs, setReqs] = useState<ReqRow[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [cargos, setCargos] = useState<{ value: string; label: string }[]>([]);
  const [industrias, setIndustrias] = useState<{ value: string; label: string }[]>([]);

  useEffect(() => {
    if (!open) { setForm({ ...EMPTY_ENG }); setReqs([]); setErrors({}); setServerError(null); return; }
    async function load() {
      const supabase = createClient();
      const [c, i] = await Promise.all([
        supabase.from("config_cargo").select("nombre").order("nombre"),
        supabase.from("cat_industria").select("id,nombre").eq("activo", true).order("nombre"),
      ]);
      setCargos((c.data ?? []).map((r) => ({ value: r.nombre, label: r.nombre })));
      setIndustrias((i.data ?? []).map((r) => ({ value: r.id, label: r.nombre })));

      if (engagement) {
        setForm({
          nombre: engagement.nombre,
          cliente: engagement.cliente,
          tipo: engagement.tipo,
          estado: engagement.estado,
          descripcion: engagement.descripcion ?? "",
          fecha_inicio: engagement.fecha_inicio ?? "",
          fecha_fin_estimada: engagement.fecha_fin_estimada ?? "",
          industria_id: engagement.industria_id ?? "",
        });
        // Cargar requerimientos existentes
        const { data: reqData } = await supabase
          .from("requerimiento_engagement")
          .select("*")
          .eq("engagement_id", engagement.id)
          .order("fase_numero");
        setReqs((reqData ?? []).map((r: RequerimientoEngagement) => ({
          id: r.id,
          fase_numero: r.fase_numero,
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

  const setField = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const addReq = () =>
    setReqs((r) => [...r, { ...EMPTY_REQ, fase_numero: r.length + 1 }]);

  const removeReq = (idx: number) =>
    setReqs((r) => r.filter((_, i) => i !== idx).map((rq, i) => ({ ...rq, fase_numero: i + 1 })));

  const setReqField = (idx: number, field: keyof ReqRow) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => setReqs((rs) => rs.map((r, i) => i === idx ? { ...r, [field]: e.target.value } : r));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.nombre.trim()) e.nombre = "Requerido";
    if (!form.cliente.trim()) e.cliente = "Requerido";
    reqs.forEach((r, i) => {
      if (!r.pct_dedicacion || isNaN(Number(r.pct_dedicacion))) e[`req_${i}_pct`] = "% inválido";
      if (!r.fecha_inicio) e[`req_${i}_inicio`] = "Requerida";
      if (!r.fecha_fin) e[`req_${i}_fin`] = "Requerida";
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setLoading(true); setServerError(null);
    const supabase = createClient();

    const payload = {
      nombre: form.nombre.trim(),
      cliente: form.cliente.trim(),
      tipo: form.tipo as "propuesta" | "proyecto",
      estado: form.estado as Engagement["estado"],
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

    // Upsert requerimientos
    for (const [i, r] of reqs.entries()) {
      const reqPayload = {
        engagement_id: engId,
        fase_numero: i + 1,
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
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{serverError}</div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <FieldWrapper label="Nombre" required error={errors.nombre} className="col-span-2">
            <Input value={form.nombre} onChange={setField("nombre")} placeholder="Transformación Operacional..." error={!!errors.nombre} />
          </FieldWrapper>
          <FieldWrapper label="Cliente" required error={errors.cliente}>
            <Input value={form.cliente} onChange={setField("cliente")} placeholder="Empresa SA" error={!!errors.cliente} />
          </FieldWrapper>
          <FieldWrapper label="Industria">
            <Select value={form.industria_id} onChange={setField("industria_id")} options={industrias} placeholder="Sin industria" />
          </FieldWrapper>
          <FieldWrapper label="Tipo">
            <Select value={form.tipo} onChange={setField("tipo")}
              options={[{ value: "propuesta", label: "Propuesta comercial" }, { value: "proyecto", label: "Proyecto" }]} />
          </FieldWrapper>
          <FieldWrapper label="Estado">
            <Select value={form.estado} onChange={setField("estado")}
              options={[
                { value: "propuesta", label: "Propuesta" },
                { value: "activo", label: "Activo" },
                { value: "pausado", label: "Pausado" },
                { value: "terminado", label: "Terminado" },
                { value: "rechazado", label: "Rechazado" },
              ]} />
          </FieldWrapper>
          <FieldWrapper label="Fecha inicio">
            <Input type="date" value={form.fecha_inicio} onChange={setField("fecha_inicio")} />
          </FieldWrapper>
          <FieldWrapper label="Fecha fin estimada">
            <Input type="date" value={form.fecha_fin_estimada} onChange={setField("fecha_fin_estimada")} />
          </FieldWrapper>
        </div>

        <FieldWrapper label="Descripción">
          <Textarea value={form.descripcion} onChange={setField("descripcion")} placeholder="Contexto del engagement..." />
        </FieldWrapper>

        {/* Requerimientos */}
        <div className="border-t border-[#f0f0f0] pt-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-[#888] uppercase tracking-widest">Requerimientos</p>
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
                    <Select value={r.cargo_requerido} onChange={setReqField(i, "cargo_requerido")} options={cargos} placeholder="Cualquier cargo" />
                  </FieldWrapper>
                  <FieldWrapper label="% Dedicación" required error={errors[`req_${i}_pct`]}>
                    <Input type="number" min="1" max="100" value={r.pct_dedicacion}
                      onChange={setReqField(i, "pct_dedicacion")} placeholder="100" error={!!errors[`req_${i}_pct`]} />
                  </FieldWrapper>
                  <FieldWrapper label="Descripción">
                    <Input value={r.descripcion} onChange={setReqField(i, "descripcion")} placeholder="Rol en el proyecto" />
                  </FieldWrapper>
                  <FieldWrapper label="Fecha inicio" required error={errors[`req_${i}_inicio`]}>
                    <Input type="date" value={r.fecha_inicio} onChange={setReqField(i, "fecha_inicio")} error={!!errors[`req_${i}_inicio`]} />
                  </FieldWrapper>
                  <FieldWrapper label="Fecha fin" required error={errors[`req_${i}_fin`]}>
                    <Input type="date" value={r.fecha_fin} onChange={setReqField(i, "fecha_fin")} error={!!errors[`req_${i}_fin`]} />
                  </FieldWrapper>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Drawer>
  );
}
