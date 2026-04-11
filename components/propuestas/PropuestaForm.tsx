"use client";

import { useState, useEffect } from "react";
import { CheckCircle, AlertTriangle, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { createAnyClient } from "@/lib/supabase/client";
import { Drawer } from "@/components/ui/Drawer";
import { Button } from "@/components/ui/Button";
import { FieldWrapper, Input, Select, Textarea } from "@/components/ui/FormField";
import type { AsignacionPropuesta } from "@/lib/types/database";

// ─────────────────────────────────────────────────────────────
//  Tipos internos
// ─────────────────────────────────────────────────────────────

interface PersonaData {
  id: string;
  nombre: string;
  apellido: string;
  cargo_actual: string;
}

interface CoberturaReq {
  requerimiento_id: string;
  fase_nombre: string | null;
  cargo_requerido: string | null;
  pct_requerido: number;
  req_fecha_inicio: string;
  req_fecha_fin: string;
  pct_cubierto: number;
  pct_descubierto: number;
}

interface FormState {
  persona_id: string;
  engagement_id: string;
  requerimiento_id: string;
  pct_dedicacion: string;
  fecha_inicio: string;
  fecha_fin: string;
  notas: string;
}

const EMPTY: FormState = {
  persona_id: "", engagement_id: "", requerimiento_id: "",
  pct_dedicacion: "", fecha_inicio: "", fecha_fin: "", notas: "",
};

// ─────────────────────────────────────────────────────────────
//  Props
// ─────────────────────────────────────────────────────────────

interface PropuestaFormProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  propuesta?: AsignacionPropuesta;
  engagementId?: string;
}

// ─────────────────────────────────────────────────────────────
//  Componente BarraCobertura
// ─────────────────────────────────────────────────────────────

function BarraCobertura({ pct_cubierto, pct_requerido }: { pct_cubierto: number; pct_requerido: number }) {
  const pct = pct_requerido > 0 ? Math.min((pct_cubierto / pct_requerido) * 100, 100) : 0;
  const color = pct >= 100 ? "#27ae60" : pct >= 50 ? "#e6a800" : "#c0392b";
  return (
    <div className="h-1.5 rounded-full bg-[#e8e8e8] overflow-hidden mt-1.5">
      <div
        className="h-full rounded-full transition-all duration-300"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Componente tarjeta de requerimiento
// ─────────────────────────────────────────────────────────────

function ReqCard({
  req,
  selected,
  onClick,
}: {
  req: CoberturaReq;
  selected: boolean;
  onClick: () => void;
}) {
  const cubierto = req.pct_cubierto >= req.pct_requerido;
  const parcial = req.pct_cubierto > 0 && !cubierto;

  return (
    <button
      onClick={onClick}
      type="button"
      className={`w-full text-left p-3.5 rounded-xl border transition-all ${
        selected
          ? "border-[#4a90e2] bg-[#eaf4ff] ring-1 ring-[#4a90e2]"
          : cubierto
          ? "border-[#e8e8e8] bg-[#f9fdf9] opacity-70 cursor-default"
          : "border-[#e8e8e8] bg-white hover:border-[#c0d4f0] hover:bg-[#f5f9ff] cursor-pointer"
      }`}
      disabled={cubierto}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-[#555]">
              {req.fase_nombre ?? "Requerimiento"}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {req.cargo_requerido ? (
              <span className="text-xs px-1.5 py-0.5 rounded bg-[#eaf4ff] text-[#1a5276] font-medium">
                {req.cargo_requerido}
              </span>
            ) : (
              <span className="text-xs text-[#aaa]">Cualquier cargo</span>
            )}
            <span className="text-xs text-[#888]">{req.pct_requerido}% dedicación</span>
          </div>
          <div className="text-xs text-[#aaa] mt-0.5">
            {format(new Date(req.req_fecha_inicio + "T00:00:00"), "d MMM yy", { locale: es })}
            {" → "}
            {format(new Date(req.req_fecha_fin + "T00:00:00"), "d MMM yy", { locale: es })}
          </div>
          <BarraCobertura pct_cubierto={req.pct_cubierto} pct_requerido={req.pct_requerido} />
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-[#aaa]">
              {req.pct_cubierto}% / {req.pct_requerido}%
            </span>
            {cubierto && (
              <span className="text-[10px] font-medium text-[#27ae60]">✓ Cubierto</span>
            )}
            {parcial && (
              <span className="text-[10px] font-medium text-[#e6a800]">
                Faltan {req.pct_descubierto}%
              </span>
            )}
            {!cubierto && !parcial && (
              <span className="text-[10px] font-medium text-[#c0392b]">Sin cubrir</span>
            )}
          </div>
        </div>
        {!cubierto && (
          <div className="flex-shrink-0 mt-1">
            {selected ? (
              <CheckCircle className="w-4 h-4 text-[#4a90e2]" />
            ) : (
              <ChevronRight className="w-4 h-4 text-[#ccc]" />
            )}
          </div>
        )}
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
//  Componente principal
// ─────────────────────────────────────────────────────────────

export function PropuestaForm({ open, onClose, onSuccess, propuesta, engagementId }: PropuestaFormProps) {
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Catálogos
  const [personasData, setPersonasData] = useState<PersonaData[]>([]);
  const [engagements, setEngagements] = useState<{ value: string; label: string }[]>([]);

  // Requerimientos del engagement seleccionado (con cobertura)
  const [reqs, setReqs] = useState<CoberturaReq[]>([]);
  const [reqsLoading, setReqsLoading] = useState(false);
  const [reqSeleccionado, setReqSeleccionado] = useState<CoberturaReq | null>(null);

  // Persona que propone (mi ID)
  const [miPersonaId, setMiPersonaId] = useState<string>("");

  // Validación de cargo (hard-block)
  const cargoPersona = personasData.find((p) => p.id === form.persona_id)?.cargo_actual ?? null;
  const cargoReq = reqSeleccionado?.cargo_requerido ?? null;
  const cargoMismatch = !!cargoPersona && !!cargoReq && cargoPersona !== cargoReq;

  // ── Carga inicial (catálogos y datos de edición) ───────────
  useEffect(() => {
    if (!open) {
      setForm({ ...EMPTY, engagement_id: engagementId ?? "" });
      setErrors({});
      setServerError(null);
      setReqs([]);
      setReqSeleccionado(null);
      return;
    }

    async function load() {
      const supabase = createAnyClient();
      const { data: { user } } = await supabase.auth.getUser();

      const [pRes, eRes, meRes] = await Promise.all([
        supabase.from("persona").select("id,nombre,apellido,cargo_actual").eq("activo", true).order("apellido"),
        supabase.from("engagement").select("id,nombre").in("estado", ["propuesta", "activo"]).order("nombre"),
        user
          ? supabase.from("persona").select("id").eq("auth_user_id", user.id).single()
          : Promise.resolve({ data: null }),
      ]);

      setPersonasData((pRes.data ?? []) as PersonaData[]);
      setEngagements((eRes.data ?? []).map((e: any) => ({ value: e.id, label: e.nombre })));
      if (meRes.data) setMiPersonaId(meRes.data.id);

      if (propuesta) {
        setForm({
          persona_id: propuesta.persona_id,
          engagement_id: propuesta.engagement_id,
          requerimiento_id: propuesta.requerimiento_id ?? "",
          pct_dedicacion: String(propuesta.pct_dedicacion),
          fecha_inicio: propuesta.fecha_inicio,
          fecha_fin: propuesta.fecha_fin,
          notas: propuesta.notas ?? "",
        });
      } else if (engagementId) {
        setForm((f) => ({ ...f, engagement_id: engagementId }));
      }
    }
    load();
  }, [open, propuesta, engagementId]);

  // ── Cargar requerimientos cuando cambia el engagement ──────
  useEffect(() => {
    setReqs([]);
    setReqSeleccionado(null);
    if (!form.engagement_id) return;

    setReqsLoading(true);
    const supabase = createAnyClient();
    supabase
      .from("cobertura_engagement")
      .select("requerimiento_id, fase_nombre, cargo_requerido, pct_requerido, req_fecha_inicio, req_fecha_fin, pct_cubierto, pct_descubierto")
      .eq("engagement_id", form.engagement_id)
      .order("fase_nombre")
      .then(({ data }: any) => {
        setReqs((data ?? []) as CoberturaReq[]);
        setReqsLoading(false);
      });
  }, [form.engagement_id]);

  // ── Seleccionar requerimiento → auto-rellenar campos ───────
  const seleccionarReq = (req: CoberturaReq) => {
    if (req.pct_cubierto >= req.pct_requerido) return; // cubierto, no seleccionable

    const yaSeleccionado = reqSeleccionado?.requerimiento_id === req.requerimiento_id;
    if (yaSeleccionado) {
      setReqSeleccionado(null);
      setForm((f) => ({ ...f, requerimiento_id: "" }));
      return;
    }

    setReqSeleccionado(req);
    setForm((f) => ({
      ...f,
      requerimiento_id: req.requerimiento_id,
      // Usar pct_descubierto (el gap restante) como dedicación de esta propuesta
      pct_dedicacion: String(Math.max(req.pct_descubierto, 1)),
      fecha_inicio: req.req_fecha_inicio,
      fecha_fin: req.req_fecha_fin,
    }));
  };

  // ── Helpers de formulario ──────────────────────────────────
  const set = (field: keyof FormState) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const setEngagement = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setForm((f) => ({ ...f, engagement_id: e.target.value, requerimiento_id: "" }));
    setReqSeleccionado(null);
  };

  // ── Validación ─────────────────────────────────────────────
  const validate = () => {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (!form.persona_id) e.persona_id = "Requerido";
    if (!form.engagement_id) e.engagement_id = "Requerido";

    // Hard-block: cargo incompatible con el requerimiento
    if (cargoMismatch) {
      e.persona_id = `Cargo incompatible: el requerimiento pide "${cargoReq}" pero esta persona tiene "${cargoPersona}". Selecciona una persona con el cargo correcto.`;
    }

    const pct = Number(form.pct_dedicacion);
    if (!form.pct_dedicacion || isNaN(pct) || pct <= 0 || pct > 100)
      e.pct_dedicacion = "Entre 1 y 100";
    if (!form.fecha_inicio) e.fecha_inicio = "Requerida";
    if (!form.fecha_fin) e.fecha_fin = "Requerida";
    if (form.fecha_inicio && form.fecha_fin && form.fecha_fin < form.fecha_inicio)
      e.fecha_fin = "Debe ser después del inicio";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── Submit ─────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!validate()) return;
    setLoading(true);
    setServerError(null);
    const supabase = createAnyClient();

    // cargo_al_momento: snapshot del cargo actual de la persona
    const persona = personasData.find((p) => p.id === form.persona_id);
    const cargo_al_momento = persona?.cargo_actual ?? null;

    const payload = {
      persona_id: form.persona_id,
      engagement_id: form.engagement_id,
      requerimiento_id: form.requerimiento_id || null,
      pct_dedicacion: Number(form.pct_dedicacion),
      cargo_al_momento,
      fecha_inicio: form.fecha_inicio,
      fecha_fin: form.fecha_fin,
      notas: form.notas.trim() || null,
      propuesto_por: miPersonaId || null,
    };

    if (propuesta) {
      const { error } = await supabase
        .from("asignacion_propuesta")
        .update(payload)
        .eq("id", propuesta.id);
      if (error) { setServerError(error.message); setLoading(false); return; }
    } else {
      const { error } = await supabase
        .from("asignacion_propuesta")
        .insert({ ...payload, estado: "borrador" });
      if (error) { setServerError(error.message); setLoading(false); return; }
    }

    setLoading(false);
    onSuccess();
    onClose();
  };

  // ── Opciones de personas ──────────────────────────────────
  // Cuando hay requerimiento con cargo definido, mostrar cargo-match primero
  const personasOpciones = [...personasData]
    .sort((a, b) => {
      if (cargoReq) {
        const aMatch = a.cargo_actual === cargoReq ? 0 : 1;
        const bMatch = b.cargo_actual === cargoReq ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
      }
      return a.apellido.localeCompare(b.apellido, "es");
    })
    .map((p) => ({
      value: p.id,
      label: `${p.apellido}, ${p.nombre} — ${p.cargo_actual}${cargoReq && p.cargo_actual !== cargoReq ? " ⚠" : ""}`,
    }));

  const tieneReqs = reqs.length > 0;
  const reqsPendientes = reqs.filter((r) => r.pct_cubierto < r.pct_requerido);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={propuesta ? "Editar propuesta" : "Nueva propuesta de asignación"}
      width="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} loading={loading}>
            {propuesta ? "Guardar cambios" : "Crear borrador"}
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

        {/* ── Engagement ─────────────────────────────────────── */}
        <FieldWrapper label="Engagement" required error={errors.engagement_id}>
          <Select
            value={form.engagement_id}
            onChange={setEngagement}
            options={engagements}
            placeholder="Seleccionar engagement..."
            error={!!errors.engagement_id}
            disabled={!!engagementId && !propuesta}
          />
        </FieldWrapper>

        {/* ── Panel de requerimientos ────────────────────────── */}
        {form.engagement_id && (
          <div className="border border-[#e8e8e8] rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-[#f9f9f9] border-b border-[#e8e8e8] flex items-center justify-between">
              <p className="text-xs font-semibold text-[#888] uppercase tracking-widest">
                Requerimientos del engagement
              </p>
              {tieneReqs && (
                <span className="text-xs text-[#888]">
                  {reqsPendientes.length} pendiente{reqsPendientes.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <div className="p-3">
              {reqsLoading ? (
                <p className="text-sm text-[#888] text-center py-2">Cargando...</p>
              ) : reqs.length === 0 ? (
                <p className="text-sm text-[#aaa] text-center py-2">
                  Este engagement no tiene requerimientos definidos.
                </p>
              ) : (
                <div className="space-y-2">
                  {reqs.map((req) => (
                    <ReqCard
                      key={req.requerimiento_id}
                      req={req}
                      selected={reqSeleccionado?.requerimiento_id === req.requerimiento_id}
                      onClick={() => seleccionarReq(req)}
                    />
                  ))}
                </div>
              )}
            </div>
            {reqSeleccionado && (
              <div className="px-4 py-2.5 bg-[#eaf4ff] border-t border-[#c0d4f0] text-xs text-[#1a5276]">
                Proponiendo para: <strong>{reqSeleccionado.fase_nombre ?? "Requerimiento"}</strong>
                {" · "}
                <button
                  type="button"
                  onClick={() => { setReqSeleccionado(null); setForm((f) => ({ ...f, requerimiento_id: "" })); }}
                  className="underline hover:no-underline ml-1"
                >
                  Quitar selección
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Persona ───────────────────────────────────────── */}
        <FieldWrapper label="Persona" required error={errors.persona_id}>
          <Select
            value={form.persona_id}
            onChange={set("persona_id")}
            options={personasOpciones}
            placeholder="Seleccionar persona..."
            error={!!errors.persona_id}
          />
          {cargoReq && !cargoMismatch && (
            <p className="text-xs text-[#888] mt-1">
              El requerimiento pide: <strong>{cargoReq}</strong>
              {" — "}personas con ese cargo aparecen primero en la lista.
            </p>
          )}
        </FieldWrapper>

        {/* ── Error de cargo incompatible (hard-block) ──────── */}
        {cargoMismatch && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">No se puede crear la propuesta</p>
              <p className="text-xs mt-0.5">
                El requerimiento pide cargo <strong>{cargoReq}</strong>, pero{" "}
                {personasData.find((p) => p.id === form.persona_id)
                  ? `${personasData.find((p) => p.id === form.persona_id)!.nombre} ${personasData.find((p) => p.id === form.persona_id)!.apellido}`
                  : "esta persona"}{" "}
                tiene cargo <strong>{cargoPersona}</strong>. Selecciona una persona con el cargo correcto.
              </p>
            </div>
          </div>
        )}

        {/* ── % Dedicación ──────────────────────────────────── */}
        {reqSeleccionado ? (
          /* Cuando hay requerimiento: % bloqueado, solo lectura */
          <div>
            <p className="text-xs font-medium text-[#555] mb-1.5">% Dedicación</p>
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[#e8e8e8] bg-[#f9f9f9]">
              <span className="text-lg font-bold text-[#1a1a1a]">
                {reqSeleccionado.pct_descubierto}%
              </span>
              <div className="text-xs text-[#888] leading-snug">
                <p>Requerido por el requerimiento: <strong>{reqSeleccionado.pct_requerido}%</strong></p>
                {reqSeleccionado.pct_cubierto > 0 && (
                  <p>Ya cubierto: {reqSeleccionado.pct_cubierto}% → quedan <strong>{reqSeleccionado.pct_descubierto}%</strong></p>
                )}
              </div>
              <span className="ml-auto text-xs text-[#aaa] italic">bloqueado</span>
            </div>
          </div>
        ) : (
          /* Sin requerimiento: campo editable */
          <FieldWrapper
            label="% Dedicación"
            required
            error={errors.pct_dedicacion}
          >
            <Input
              type="number"
              min="1"
              max="100"
              value={form.pct_dedicacion}
              onChange={set("pct_dedicacion")}
              placeholder="100"
              error={!!errors.pct_dedicacion}
            />
          </FieldWrapper>
        )}

        {/* ── Período ───────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          <FieldWrapper label="Fecha inicio" required error={errors.fecha_inicio}>
            <Input
              type="date"
              value={form.fecha_inicio}
              onChange={set("fecha_inicio")}
              error={!!errors.fecha_inicio}
            />
          </FieldWrapper>
          <FieldWrapper label="Fecha fin" required error={errors.fecha_fin}>
            <Input
              type="date"
              value={form.fecha_fin}
              onChange={set("fecha_fin")}
              error={!!errors.fecha_fin}
            />
          </FieldWrapper>
        </div>

        {/* ── Notas ─────────────────────────────────────────── */}
        <FieldWrapper label="Notas" hint="Contexto para el admin que revisará la propuesta">
          <Textarea
            value={form.notas}
            onChange={set("notas")}
            placeholder="Razón de la asignación, disponibilidad, contexto del rol..."
          />
        </FieldWrapper>
      </div>
    </Drawer>
  );
}
