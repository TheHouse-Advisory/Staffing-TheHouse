"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Plus, Trash2, ChevronLeft, ChevronRight,
  Save, Loader2, X, AlertTriangle, Info, CalendarX, Check, Zap,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { createAnyClient } from "@/lib/supabase/client";
import { createClient } from "@/lib/supabase/client";
import { Topbar } from "@/components/layout/Topbar";
import { Button } from "@/components/ui/Button";
import { FieldWrapper, Input, Select, Textarea } from "@/components/ui/FormField";
import { CARGOS_OPTIONS } from "@/lib/constants";
import {
  fetchEngagementsConReqs,
  fetchPersonasFit,
  today,
  type ReqConEstado,
  type PersonaFit,
  type EngagementConReqs,
} from "@/lib/queries/planificacion";
import { PersonaFitTooltip } from "@/components/planificacion/PersonaFitTooltip";
import { cn } from "@/lib/utils";

// ── Tipos locales ─────────────────────────────────────────────────────────────

interface ReqRow {
  fase_nombre: string;
  cargo_requerido: string;
  descripcion: string;
  pct_dedicacion: string;
  fecha_inicio: string;
  fecha_fin: string;
}

interface Tentativa {
  id: string;
  requerimiento_id: string;
  persona_id: string;
  nombre: string;
  apellido: string;
  cargo: string;
  pct: number;
  fecha_inicio: string;
  fecha_fin: string;
}

// ── Utilidades de UI ──────────────────────────────────────────────────────────

const PALETTE = ["#4a90e2","#e2844a","#4ac27a","#9b4ae2","#e24a7a","#4ae2d5","#e2c24a","#7a4ae2"];

function avatarColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
  return PALETTE[Math.abs(h) % PALETTE.length];
}

function iniciales(n: string, a: string) {
  return `${n[0] ?? ""}${a[0] ?? ""}`.toUpperCase();
}

function nivelColors(nivel: string) {
  if (nivel === "excelente")   return { bg: "#dcf5e7", text: "#1a7a45" };
  if (nivel === "bueno")       return { bg: "#e8f4ff", text: "#1a5276" };
  if (nivel === "advertencia") return { bg: "#fff4d4", text: "#8a6200" };
  return { bg: "#ffd4d4", text: "#c02020" };
}

function nivelEmoji(nivel: string) {
  if (nivel === "excelente")   return "😊";
  if (nivel === "bueno")       return "🙂";
  if (nivel === "advertencia") return "😐";
  return "😟";
}

function formatFecha(f: string | null) {
  if (!f) return "—";
  try { return format(new Date(f + "T00:00:00"), "d MMM yy", { locale: es }); }
  catch { return f; }
}

// ── Valores vacíos ────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  nombre: "", cliente: "", tipo: "proyecto", estado: "activo",
  descripcion: "", fecha_inicio: "", fecha_fin_estimada: "",
  industria_id: "", categoria_id: "", nivel_dificultad: "",
};

const EMPTY_REQ: ReqRow = {
  fase_nombre: "", cargo_requerido: "", descripcion: "",
  pct_dedicacion: "100", fecha_inicio: "", fecha_fin: "",
};

// ── Componente principal ──────────────────────────────────────────────────────

export default function NuevoProyectoPage() {
  const router = useRouter();

  // ── Pasos ──────────────────────────────────────────────────────
  const [step, setStep] = useState<1 | 2>(1);
  const [engId, setEngId] = useState<string | null>(null);

  // ── Step 1: formulario ─────────────────────────────────────────
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [reqs, setReqs] = useState<ReqRow[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [industrias, setIndustrias] = useState<{ value: string; label: string }[]>([]);
  const [categorias, setCategorias] = useState<{ value: string; label: string }[]>([]);

  // ── Step 2: staffing ───────────────────────────────────────────
  const [engagement, setEngagement] = useState<EngagementConReqs | null>(null);
  const [loadingStep2, setLoadingStep2] = useState(false);
  const [reqSeleccionado, setReqSeleccionado] = useState<ReqConEstado | null>(null);
  const [fitPersonas, setFitPersonas] = useState<PersonaFit[]>([]);
  const [fitLoading, setFitLoading] = useState(false);
  const [tentativas, setTentativas] = useState<Tentativa[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [guardadoMsg, setGuardadoMsg] = useState<string | null>(null);
  const [tooltipPersonaId, setTooltipPersonaId] = useState<string | null>(null);

  // Cargar catálogos al montar
  useEffect(() => {
    async function load() {
      const supabase = createAnyClient();
      const [iData, cData] = await Promise.all([
        supabase.from("cat_industria").select("id,nombre").eq("activo", true).order("nombre"),
        supabase.from("cat_tematica").select("id,nombre").eq("activo", true).order("nombre"),
      ]);
      setIndustrias((iData.data ?? []).map((r: any) => ({ value: r.id, label: r.nombre })));
      setCategorias((cData.data ?? []).map((r: any) => ({ value: r.id, label: r.nombre })));
    }
    load();
  }, []);

  // ── Helpers Step 1 ─────────────────────────────────────────────

  const setField = (field: string) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const addReq = () =>
    setReqs((r) => [...r, { ...EMPTY_REQ, fecha_inicio: form.fecha_inicio, fecha_fin: form.fecha_fin_estimada }]);

  const removeReq = (idx: number) => setReqs((r) => r.filter((_, i) => i !== idx));

  const setReqField = (idx: number, field: keyof ReqRow) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => setReqs((rs) => rs.map((r, i) => i === idx ? { ...r, [field]: e.target.value } : r));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.nombre.trim()) e.nombre = "Requerido";
    if (!form.cliente.trim()) e.cliente = "Requerido";
    if (form.fecha_fin_estimada && form.fecha_inicio && form.fecha_fin_estimada < form.fecha_inicio)
      e.fecha_fin_estimada = "No puede ser anterior a la fecha de inicio";
    reqs.forEach((r, i) => {
      if (!r.pct_dedicacion || isNaN(Number(r.pct_dedicacion))) e[`req_${i}_pct`] = "% inválido";
      if (!r.fecha_inicio) e[`req_${i}_inicio`] = "Requerida";
      if (!r.fecha_fin) e[`req_${i}_fin`] = "Requerida";
      else if (r.fecha_inicio && r.fecha_fin < r.fecha_inicio) e[`req_${i}_fin`] = "Fecha inválida";
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleCrear = async () => {
    if (!validate()) return;
    setSaving(true);
    setServerError(null);
    const supabase = createAnyClient();

    const { data: { user } } = await supabase.auth.getUser();

    const corePayload = {
      nombre: form.nombre.trim(),
      cliente: form.cliente.trim(),
      tipo: form.tipo as "propuesta" | "proyecto",
      estado: form.estado as "activo" | "terminado",
      descripcion: form.descripcion.trim() || null,
      fecha_inicio: form.fecha_inicio || null,
      fecha_fin_estimada: form.fecha_fin_estimada || null,
      industria_id: form.industria_id || null,
      created_by: user?.id ?? null,
    };

    const { data, error } = await supabase.from("engagement").insert(corePayload).select("id").single();
    if (error || !data) { setServerError(error?.message ?? "Error al crear"); setSaving(false); return; }
    const newEngId = data.id;

    // Campos nuevos (requieren migración SQL) — se ignoran si aún no existen
    try {
      await supabase.from("engagement").update({
        categoria_id: form.categoria_id || null,
        nivel_dificultad: form.nivel_dificultad || null,
      }).eq("id", newEngId);
    } catch (_) {
      // migración pendiente — ignorar
    }
    setEngId(newEngId);

    for (const r of reqs) {
      await supabase.from("requerimiento_engagement").insert({
        engagement_id: newEngId,
        fase_nombre: r.fase_nombre.trim() || null,
        cargo_requerido: r.cargo_requerido || null,
        descripcion: r.descripcion.trim() || null,
        pct_dedicacion: Number(r.pct_dedicacion),
        fecha_inicio: r.fecha_inicio,
        fecha_fin: r.fecha_fin,
      });
    }

    setSaving(false);

    if (reqs.length === 0) {
      router.push(`/proyectos/${newEngId}`);
      return;
    }

    // Cargar datos para step 2
    setLoadingStep2(true);
    setStep(2);
    const supabase2 = createClient();
    const result = await fetchEngagementsConReqs(supabase2);
    const eng = result.engagements.find((e) => e.engagement_id === newEngId) ?? null;
    setEngagement(eng);
    setLoadingStep2(false);
  };

  // ── Helpers Step 2 ─────────────────────────────────────────────

  const handleSelectReq = useCallback(async (req: ReqConEstado) => {
    if (reqSeleccionado?.id === req.id) {
      setReqSeleccionado(null);
      setFitPersonas([]);
      setTooltipPersonaId(null);
      return;
    }
    setReqSeleccionado(req);
    setTooltipPersonaId(null);
    setFitLoading(true);
    const supabase = createClient();
    const result = await fetchPersonasFit(
      supabase,
      req,
      tentativas.map((t) => ({ persona_id: t.persona_id, requerimiento_id: t.requerimiento_id, pct: t.pct })),
      []
    );
    setFitPersonas(result.personas);
    setFitLoading(false);
  }, [reqSeleccionado?.id, tentativas]);

  const handleAsignar = useCallback((persona: PersonaFit) => {
    if (!reqSeleccionado) return;
    const hoy = today();
    setTentativas((prev) => {
      const sin = prev.filter((t) => t.requerimiento_id !== reqSeleccionado.id);
      return [...sin, {
        id: crypto.randomUUID(),
        requerimiento_id: reqSeleccionado.id,
        persona_id: persona.persona_id,
        nombre: persona.nombre,
        apellido: persona.apellido,
        cargo: persona.cargo_actual,
        pct: reqSeleccionado.pct_dedicacion,
        fecha_inicio: reqSeleccionado.fecha_inicio > hoy ? reqSeleccionado.fecha_inicio : hoy,
        fecha_fin: reqSeleccionado.fecha_fin,
      }];
    });
    setGuardadoMsg(null);
  }, [reqSeleccionado]);

  const handleGuardarPlan = useCallback(async () => {
    if (tentativas.length === 0 || !engId) return;
    setGuardando(true);
    setGuardadoMsg(null);
    const supabase = createClient() as any;

    const planNombre = `Plan ${format(new Date(), "d MMM yyyy HH:mm", { locale: es })}`;
    const { data: planData, error: planErr } = await supabase
      .from("propuesta_plan")
      .insert({ nombre: planNombre, estado: "borrador" })
      .select("id")
      .single();

    if (planErr || !planData) {
      setGuardadoMsg(`Error: ${planErr?.message ?? "desconocido"}`);
      setGuardando(false);
      return;
    }

    const planId = planData.id;
    const inserts = tentativas.map((t) => ({
      plan_id: planId,
      persona_id: t.persona_id,
      engagement_id: engId,
      requerimiento_id: t.requerimiento_id,
      pct_dedicacion: t.pct,
      fecha_inicio: t.fecha_inicio,
      fecha_fin: t.fecha_fin,
      estado: "borrador",
      cargo_al_momento: t.cargo,
    }));

    const { error: asigErr } = await supabase.from("asignacion_propuesta").insert(inserts);
    if (asigErr) {
      await supabase.from("propuesta_plan").delete().eq("id", planId);
      setGuardadoMsg(`Error: ${asigErr.message}`);
    } else {
      setGuardadoMsg(`✓ Plan guardado — ${tentativas.length} propuesta(s)`);
    }
    setGuardando(false);
  }, [tentativas, engId]);

  // ── Render ─────────────────────────────────────────────────────

  const minReqDate = form.fecha_inicio || undefined;
  const maxReqDate = form.fecha_fin_estimada || undefined;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Topbar
        titulo="Nuevo proyecto"
        actions={
          <Link
            href="/proyectos"
            className="flex items-center gap-1 text-sm text-[#888] hover:text-[#333] transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Volver
          </Link>
        }
      />

      {/* Indicador de pasos */}
      <div className="flex items-center gap-3 px-6 py-2.5 bg-[#f9f9f9] border-b border-[#e8e8e8] flex-shrink-0">
        <StepBadge num={1} label="Características" active={step === 1} done={step > 1} />
        <ChevronRight className="w-3.5 h-3.5 text-[#ccc]" />
        <StepBadge num={2} label="Staffing" active={step === 2} done={false} />
      </div>

      {/* ── Step 1 ── */}
      {step === 1 && (
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-3xl mx-auto space-y-5">
            {serverError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                {serverError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <FieldWrapper label="Nombre del proyecto" required error={errors.nombre} className="col-span-2">
                <Input value={form.nombre} onChange={setField("nombre")} placeholder="Transformación Operacional..." error={!!errors.nombre} />
              </FieldWrapper>
              <FieldWrapper label="Cliente" required error={errors.cliente}>
                <Input value={form.cliente} onChange={setField("cliente")} placeholder="Empresa SA" error={!!errors.cliente} />
              </FieldWrapper>
              <FieldWrapper label="Industria">
                <Select value={form.industria_id} onChange={setField("industria_id")} options={industrias} placeholder="Sin industria" />
              </FieldWrapper>
              <FieldWrapper label="Categoría">
                <Select value={form.categoria_id} onChange={setField("categoria_id")} options={categorias} placeholder="Sin categoría" />
              </FieldWrapper>
              <FieldWrapper label="Nivel de dificultad">
                <Select
                  value={form.nivel_dificultad}
                  onChange={setField("nivel_dificultad")}
                  options={[
                    { value: "bajo", label: "Bajo" },
                    { value: "medio", label: "Medio" },
                    { value: "alto", label: "Alto" },
                  ]}
                  placeholder="Sin especificar"
                />
              </FieldWrapper>
              <FieldWrapper label="Tipo">
                <Select
                  value={form.tipo}
                  onChange={setField("tipo")}
                  options={[
                    { value: "propuesta", label: "Propuesta comercial" },
                    { value: "proyecto", label: "Proyecto" },
                  ]}
                />
              </FieldWrapper>
              <FieldWrapper label="Estado">
                <Select
                  value={form.estado}
                  onChange={setField("estado")}
                  options={[
                    { value: "activo", label: "Activo" },
                    { value: "terminado", label: "Terminado" },
                  ]}
                />
              </FieldWrapper>
              <FieldWrapper label="Fecha inicio">
                <Input type="date" value={form.fecha_inicio} onChange={setField("fecha_inicio")} max={form.fecha_fin_estimada || undefined} />
              </FieldWrapper>
              <FieldWrapper label="Fecha fin estimada" error={errors.fecha_fin_estimada}>
                <Input type="date" value={form.fecha_fin_estimada} onChange={setField("fecha_fin_estimada")} min={form.fecha_inicio || undefined} error={!!errors.fecha_fin_estimada} />
              </FieldWrapper>
            </div>

            <FieldWrapper label="Descripción">
              <Textarea value={form.descripcion} onChange={setField("descripcion")} placeholder="Contexto del proyecto..." />
            </FieldWrapper>

            {/* Requerimientos */}
            <div className="border-t border-[#f0f0f0] pt-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs font-semibold text-[#888] uppercase tracking-widest">Requerimientos</p>
                  {(minReqDate || maxReqDate) && (
                    <p className="text-[10px] text-[#aaa] mt-0.5">
                      Las fechas deben estar dentro del rango del proyecto
                      {minReqDate && ` (desde ${minReqDate}`}{maxReqDate && ` → ${maxReqDate}`}{")"}
                    </p>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={addReq}>
                  <Plus className="w-3.5 h-3.5" /> Agregar
                </Button>
              </div>

              {reqs.length === 0 && (
                <p className="text-sm text-[#aaa] text-center py-4">Sin requerimientos. Puedes agregar luego desde el detalle del proyecto.</p>
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
                        <Select value={r.cargo_requerido} onChange={setReqField(i, "cargo_requerido")} options={CARGOS_OPTIONS} placeholder="Cualquier cargo" />
                      </FieldWrapper>
                      <FieldWrapper label="% Dedicación" required error={errors[`req_${i}_pct`]}>
                        <Input type="number" min="1" max="100" value={r.pct_dedicacion} onChange={setReqField(i, "pct_dedicacion")} error={!!errors[`req_${i}_pct`]} />
                      </FieldWrapper>
                      <FieldWrapper label="Descripción del rol">
                        <Input value={r.descripcion} onChange={setReqField(i, "descripcion")} placeholder="Líder de proyecto" />
                      </FieldWrapper>
                      <FieldWrapper label="Fecha inicio" required error={errors[`req_${i}_inicio`]}>
                        <Input type="date" value={r.fecha_inicio} onChange={setReqField(i, "fecha_inicio")} min={minReqDate} max={maxReqDate} error={!!errors[`req_${i}_inicio`]} />
                      </FieldWrapper>
                      <FieldWrapper label="Fecha fin" required error={errors[`req_${i}_fin`]}>
                        <Input type="date" value={r.fecha_fin} onChange={setReqField(i, "fecha_fin")} min={r.fecha_inicio || minReqDate} max={maxReqDate} error={!!errors[`req_${i}_fin`]} />
                      </FieldWrapper>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer de Step 1 */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#f0f0f0]">
              <Button variant="secondary" onClick={() => router.push("/proyectos")}>
                Cancelar
              </Button>
              <Button onClick={handleCrear} loading={saving}>
                {reqs.length === 0 ? "Crear proyecto" : "Crear y ver staffing"}
                {reqs.length > 0 && <ChevronRight className="w-4 h-4 ml-1" />}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 2 ── */}
      {step === 2 && (
        <div className="flex flex-1 overflow-hidden">

          {/* Panel izquierdo: requerimientos */}
          <div className="flex flex-col w-[320px] flex-shrink-0 border-r border-[#e8e8e8] overflow-hidden">
            <div className="px-4 py-3 bg-[#f9f9f9] border-b border-[#e8e8e8] flex-shrink-0">
              <p className="text-xs font-semibold text-[#888] uppercase tracking-widest">Requerimientos</p>
              <p className="text-[10px] text-[#aaa] mt-0.5">Haz click en un requerimiento para ver candidatos</p>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loadingStep2 ? (
                <div className="flex items-center justify-center h-32 gap-2 text-[#888]">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Cargando...</span>
                </div>
              ) : !engagement || engagement.requerimientos.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-[#aaa] text-sm">
                  Sin requerimientos
                </div>
              ) : (
                engagement.requerimientos.map((req) => {
                  const tentativa = tentativas.find((t) => t.requerimiento_id === req.id);
                  const isSelected = reqSeleccionado?.id === req.id;
                  return (
                    <div
                      key={req.id}
                      onClick={() => handleSelectReq(req)}
                      className={cn(
                        "px-4 py-3 border-b border-[#f5f5f5] cursor-pointer transition-all",
                        isSelected ? "bg-[#eaf4ff]" : "hover:bg-[#f9f9f9]"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ background: tentativa ? "#4a90e2" : "#e2844a" }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-[#1a1a1a]">
                              {req.cargo_requerido ?? "Sin cargo"}
                            </span>
                            <span className="text-[10px] bg-[#f0f0f0] text-[#666] px-1.5 py-0.5 rounded-full">
                              {req.pct_dedicacion}%
                            </span>
                            {req.fase_nombre && (
                              <span className="text-[10px] text-[#aaa]">{req.fase_nombre}</span>
                            )}
                          </div>
                          <p className="text-[10px] text-[#aaa] mt-0.5">
                            {formatFecha(req.fecha_inicio)} → {formatFecha(req.fecha_fin)}
                          </p>
                        </div>
                        <ChevronRight className={cn("w-3.5 h-3.5 flex-shrink-0 transition-colors", isSelected ? "text-[#4a90e2]" : "text-[#ddd]")} />
                      </div>

                      {/* Persona propuesta */}
                      {tentativa && (
                        <div
                          className="mt-2 ml-5 flex items-center gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="relative flex-shrink-0">
                            <div
                              className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-white text-[10px]"
                              style={{ background: avatarColor(tentativa.persona_id) }}
                            >
                              {iniciales(tentativa.nombre, tentativa.apellido)}
                            </div>
                            <div className="absolute inset-0 rounded-full ring-2 ring-dashed ring-[#4a90e2] ring-offset-1 pointer-events-none" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-medium text-[#4a90e2] truncate">
                              {tentativa.nombre} {tentativa.apellido}
                            </p>
                            <p className="text-[9px] text-[#aaa]">propuesto</p>
                          </div>
                          <button
                            onClick={() => setTentativas((prev) => prev.filter((t) => t.id !== tentativa.id))}
                            className="w-5 h-5 rounded-full bg-[#f0f0f0] hover:bg-red-100 text-[#aaa] hover:text-red-500 flex items-center justify-center transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer step 2 */}
            <div className="p-4 border-t border-[#e8e8e8] space-y-2 flex-shrink-0">
              {guardadoMsg && (
                <p className={cn(
                  "text-xs font-medium px-2 py-1 rounded",
                  guardadoMsg.startsWith("✓") ? "text-[#1a7a45] bg-[#f0faf5]" : "text-red-600 bg-red-50"
                )}>
                  {guardadoMsg}
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="flex-1"
                  onClick={() => router.push(`/proyectos/${engId}`)}
                >
                  {guardadoMsg?.startsWith("✓") ? "Ir al proyecto" : "Saltar"}
                </Button>
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={handleGuardarPlan}
                  loading={guardando}
                  disabled={tentativas.length === 0}
                >
                  <Save className="w-3.5 h-3.5" />
                  Guardar ({tentativas.length})
                </Button>
              </div>
            </div>
          </div>

          {/* Panel derecho: candidatos */}
          <div className="flex flex-col flex-1 overflow-hidden">
            {!reqSeleccionado ? (
              <div className="flex flex-col items-center justify-center h-full text-center text-[#aaa] px-6">
                <div className="w-14 h-14 rounded-full bg-[#f5f5f5] flex items-center justify-center mb-3">
                  <Zap className="w-6 h-6 text-[#ddd]" />
                </div>
                <p className="text-sm font-medium text-[#888]">Selecciona un requerimiento</p>
                <p className="text-xs mt-1 text-[#bbb]">Ver personas disponibles y su fit para el rol</p>
              </div>
            ) : (
              <div className="flex flex-col h-full">
                {/* Header del panel */}
                <div className="px-5 py-4 border-b border-[#e8e8e8] bg-[#f9f9f9] flex-shrink-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-[#1a1a1a]">
                        {reqSeleccionado.cargo_requerido ?? "Sin cargo"}{" "}
                        <span className="font-normal text-[#888]">{reqSeleccionado.pct_dedicacion}%</span>
                      </h3>
                      <p className="text-[10px] text-[#888] mt-1">
                        {formatFecha(reqSeleccionado.fecha_inicio)} → {formatFecha(reqSeleccionado.fecha_fin)}
                        {reqSeleccionado.fase_nombre && ` · ${reqSeleccionado.fase_nombre}`}
                      </p>
                    </div>
                    <button
                      onClick={() => { setReqSeleccionado(null); setFitPersonas([]); setTooltipPersonaId(null); }}
                      className="w-6 h-6 rounded-md flex items-center justify-center text-[#aaa] hover:text-[#555] hover:bg-[#eee] transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Lista de candidatos */}
                <div className="flex-1 overflow-y-auto">
                  {fitLoading ? (
                    <div className="flex items-center justify-center h-32 gap-2 text-[#888]">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">Calculando fit...</span>
                    </div>
                  ) : fitPersonas.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-center px-4 text-[#aaa]">
                      <p className="text-sm">No hay personas con cargo <strong>"{reqSeleccionado.cargo_requerido}"</strong></p>
                    </div>
                  ) : (
                    <div className="divide-y divide-[#f5f5f5]">
                      {fitPersonas.map((p) => {
                        const colors = nivelColors(p.nivel);
                        const emoji  = nivelEmoji(p.nivel);
                        return (
                          <div key={p.persona_id} className="px-5 py-3 hover:bg-[#fafafa] transition-colors">
                            {tooltipPersonaId === p.persona_id && (
                              <PersonaFitTooltip
                                personaId={p.persona_id}
                                nombre={p.nombre}
                                apellido={p.apellido}
                                cargo={p.cargo_actual}
                                industriaId={engagement?.industria_id ?? null}
                                categoriaId={engagement?.categoria_id ?? null}
                                industriaNombre={engagement?.industria_nombre ?? null}
                                categoriaNombre={engagement?.categoria_nombre ?? null}
                                fechaInicio={reqSeleccionado.fecha_inicio}
                                fechaFin={reqSeleccionado.fecha_fin}
                                onClose={() => setTooltipPersonaId(null)}
                              />
                            )}
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                title="Ver perfil"
                                onClick={() => setTooltipPersonaId(tooltipPersonaId === p.persona_id ? null : p.persona_id)}
                                className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-white text-xs flex-shrink-0 hover:ring-2 hover:ring-offset-1 hover:ring-[#1a1a1a] transition-all cursor-pointer"
                                style={{ background: avatarColor(p.persona_id) }}
                              >
                                {iniciales(p.nombre, p.apellido)}
                              </button>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <p className="text-xs font-semibold text-[#1a1a1a] truncate">{p.nombre} {p.apellido}</p>
                                  <span className="text-sm">{emoji}</span>
                                </div>
                                <p className="text-[10px] text-[#888]">{p.cargo_actual}</p>
                              </div>
                              <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                                <span
                                  className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                                  style={{ background: colors.bg, color: colors.text }}
                                >
                                  {p.pct_si_asigna}%
                                </span>
                                <button
                                  onClick={() => handleAsignar(p)}
                                  className="text-[10px] font-semibold px-2.5 py-1 rounded-md bg-[#1a1a1a] text-white hover:bg-[#333] transition-colors"
                                >
                                  Proponer
                                </button>
                              </div>
                            </div>

                            {/* Alertas */}
                            {p.alertas.length > 0 && (
                              <div className="mt-2 space-y-1">
                                {p.alertas.map((a, i) => (
                                  <div key={i} className="flex items-start gap-1.5">
                                    {a.nivel === "error"
                                      ? <AlertTriangle className="w-3 h-3 text-red-500 flex-shrink-0 mt-px" />
                                      : a.tipo === "ausencia_en_periodo"
                                      ? <CalendarX className="w-3 h-3 text-amber-500 flex-shrink-0 mt-px" />
                                      : <Info className="w-3 h-3 text-amber-500 flex-shrink-0 mt-px" />
                                    }
                                    <p className="text-[10px] text-[#666]">{a.mensaje}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-componentes ────────────────────────────────────────────────────────────

function StepBadge({ num, label, active, done }: { num: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className={cn("flex items-center gap-2", active || done ? "text-[#1a1a1a]" : "text-[#aaa]")}>
      <div className={cn(
        "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0",
        active ? "bg-[#1a1a1a] text-white"
          : done ? "bg-[#27ae60] text-white"
          : "bg-[#e8e8e8] text-[#888]"
      )}>
        {done ? <Check className="w-3.5 h-3.5" /> : num}
      </div>
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}
