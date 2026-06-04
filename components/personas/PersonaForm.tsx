"use client";

import { useState, useEffect } from "react";
import { createAnyClient } from "@/lib/supabase/client";
import { Drawer } from "@/components/ui/Drawer";
import { Button } from "@/components/ui/Button";
import { FieldWrapper, Input, Select } from "@/components/ui/FormField";
import { MultiSelect, type Option } from "@/components/ui/MultiSelect";
import type { Persona } from "@/lib/types/database";

interface PersonaFormProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  persona?: Persona; // undefined = crear, definido = editar
}

// Cargos que pueden ser apalancadores
const CARGOS_LEVERAGER = ["Consultor Senior", "Consultor de Proyectos", "Consultor Proyecto", "Consultor Analista"];

interface FormState {
  nombre: string;
  apellido: string;
  iniciales: string;
  email: string;
  cargo_actual: string;
  fecha_ingreso: string;
  fecha_nacimiento: string;
  mentor_id: string;
  is_leverager: boolean;
  industrias: string[];
  capacidades: string[];
  tematicas: string[];
}

const EMPTY: FormState = {
  nombre: "",
  apellido: "",
  iniciales: "",
  email: "",
  cargo_actual: "",
  fecha_ingreso: "",
  fecha_nacimiento: "",
  mentor_id: "",
  is_leverager: false,
  industrias: [],
  capacidades: [],
  tematicas: [],
};

export function PersonaForm({ open, onClose, onSuccess, persona }: PersonaFormProps) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Catálogos
  const [cargos, setCargos] = useState<Option[]>([]);
  const [industrias, setIndustrias] = useState<Option[]>([]);
  const [capacidades, setCapacidades] = useState<Option[]>([]);
  const [tematicas, setTematicas] = useState<Option[]>([]);
  const [mentoresOpciones, setMentoresOpciones] = useState<Option[]>([]);

  // Cargar catálogos una vez
  useEffect(() => {
    if (!open) return;
    async function loadCatalogs() {
      const supabase = createAnyClient();
      const [c, i, cap, t, pers] = await Promise.all([
        supabase.from("config_cargo").select("nombre").order("nombre"),
        supabase.from("cat_industria").select("id,nombre").eq("activo", true).order("nombre"),
        supabase.from("cat_capacidad").select("id,nombre").eq("activo", true).order("nombre"),
        supabase.from("cat_tematica").select("id,nombre").eq("activo", true).order("nombre"),
        supabase.from("persona").select("id,nombre,apellido").eq("activo", true).order("apellido"),
      ]);
      setCargos((c.data ?? []).map((r: any) => ({ value: r.nombre, label: r.nombre })));
      setIndustrias((i.data ?? []).map((r: any) => ({ value: r.id, label: r.nombre })));
      setCapacidades((cap.data ?? []).map((r: any) => ({ value: r.id, label: r.nombre })));
      setTematicas((t.data ?? []).map((r: any) => ({ value: r.id, label: r.nombre })));
      // Excluir a la persona que se está editando de la lista de mentores
      setMentoresOpciones(
        ((pers.data ?? []) as { id: string; nombre: string; apellido: string }[])
          .filter((r) => r.id !== persona?.id)
          .map((r) => ({ value: r.id, label: `${r.nombre} ${r.apellido}` }))
      );
    }
    loadCatalogs();
  }, [open, persona?.id]);

  // Poblar form al editar
  useEffect(() => {
    if (!open) { setForm(EMPTY); setErrors({}); setServerError(null); return; }
    if (!persona) return;

    async function loadRelaciones() {
      const supabase = createAnyClient();
      const [pi, pc, pt] = await Promise.all([
        supabase.from("persona_industria").select("industria_id").eq("persona_id", persona!.id),
        supabase.from("persona_capacidad").select("capacidad_id").eq("persona_id", persona!.id),
        supabase.from("persona_tematica").select("tematica_id").eq("persona_id", persona!.id),
      ]);
      setForm({
        nombre: persona!.nombre,
        apellido: persona!.apellido,
        iniciales: persona!.iniciales ?? "",
        email: persona!.email,
        cargo_actual: persona!.cargo_actual ?? "",
        fecha_ingreso: persona!.fecha_ingreso ?? "",
        fecha_nacimiento: persona!.fecha_nacimiento ?? "",
        mentor_id: persona!.mentor_id ?? "",
        is_leverager: persona!.is_leverager ?? false,
        industrias: (pi.data ?? []).map((r: any) => r.industria_id),
        capacidades: (pc.data ?? []).map((r: any) => r.capacidad_id),
        tematicas: (pt.data ?? []).map((r: any) => r.tematica_id),
      });
    }
    loadRelaciones();
  }, [open, persona]);

  const set = (field: keyof FormState) => (value: string | string[]) =>
    setForm((f) => ({ ...f, [field]: value }));

  const validate = (): boolean => {
    const e: Partial<Record<keyof FormState, string>> = {}; // eslint-disable-line
    if (!form.nombre.trim()) e.nombre = "Requerido";
    if (!form.apellido.trim()) e.apellido = "Requerido";
    if (!form.email.trim()) e.email = "Requerido";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = "Email inválido";
    if (!form.cargo_actual) e.cargo_actual = "Requerido";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setLoading(true);
    setServerError(null);
    const supabase = createAnyClient();

    const payload = {
      nombre: form.nombre.trim(),
      apellido: form.apellido.trim(),
      iniciales: form.iniciales.trim().toUpperCase().slice(0, 3) || null,
      email: form.email.trim().toLowerCase(),
      cargo_actual: form.cargo_actual,
      fecha_ingreso: form.fecha_ingreso || null,
      fecha_nacimiento: form.fecha_nacimiento || null,
      mentor_id: form.mentor_id || null,
      // Si el cargo ya no es elegible, forzar false al guardar
      is_leverager: CARGOS_LEVERAGER.includes(form.cargo_actual) ? form.is_leverager : false,
    };

    let personaId: string;

    if (persona) {
      // Editar
      const { error } = await supabase
        .from("persona")
        .update(payload)
        .eq("id", persona.id);
      if (error) { setServerError(error.message); setLoading(false); return; }
      personaId = persona.id;
    } else {
      // Crear
      const { data, error } = await supabase
        .from("persona")
        .insert(payload)
        .select("id")
        .single();
      if (error || !data) { setServerError(error?.message ?? "Error al crear"); setLoading(false); return; }
      personaId = data.id;

      // Historial de cargo inicial
      await supabase.from("persona_cargo_historial").insert({
        persona_id: personaId,
        cargo: form.cargo_actual,
        fecha_inicio: form.fecha_ingreso || new Date().toISOString().split("T")[0],
      });
    }

    // Sincronizar relaciones N:N
    await syncRelaciones(supabase, personaId, form);

    setLoading(false);
    onSuccess();
    onClose();
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={persona ? "Editar persona" : "Nueva persona"}
      subtitle={persona ? `${persona.nombre} ${persona.apellido}` : "Agregar miembro al equipo"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} loading={loading}>
            {persona ? "Guardar cambios" : "Crear persona"}
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

        {/* Datos personales */}
        <div className="grid grid-cols-2 gap-4">
          <FieldWrapper label="Nombre" required error={errors.nombre}>
            <Input
              value={form.nombre}
              onChange={(e) => set("nombre")(e.target.value)}
              placeholder="María"
              error={!!errors.nombre}
            />
          </FieldWrapper>
          <FieldWrapper label="Apellido" required error={errors.apellido}>
            <Input
              value={form.apellido}
              onChange={(e) => set("apellido")(e.target.value)}
              placeholder="González"
              error={!!errors.apellido}
            />
          </FieldWrapper>
        </div>

        {/* Iniciales personalizadas */}
        <FieldWrapper
          label="Iniciales"
          hint="Opcional · máx. 3 caracteres · se muestran en avatares del Tablero, Inicio y Reportes"
        >
          <div className="flex items-center gap-3">
            {/* Preview del avatar */}
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[13px] font-bold flex-shrink-0 select-none"
              style={{ background: "#4a90e2" }}
            >
              {(form.iniciales.trim() ||
                `${form.nombre[0] ?? ""}${form.apellido[0] ?? ""}`.toUpperCase()) || "?"}
            </div>
            <div className="w-20">
              <Input
                value={form.iniciales}
                onChange={(e) =>
                  setForm((f) => ({ ...f, iniciales: e.target.value.toUpperCase().slice(0, 3) }))
                }
                placeholder={
                  `${form.nombre[0] ?? ""}${form.apellido[0] ?? ""}`.toUpperCase() || "AB"
                }
                maxLength={3}
              />
            </div>
          </div>
        </FieldWrapper>

        <FieldWrapper label="Email" required error={errors.email}>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => set("email")(e.target.value)}
            placeholder="mgonzalez@thehouse.cl"
            error={!!errors.email}
          />
        </FieldWrapper>

        <FieldWrapper label="Cargo" required error={errors.cargo_actual}>
          <Select
            value={form.cargo_actual}
            onChange={(e) => set("cargo_actual")(e.target.value)}
            options={cargos}
            placeholder="Seleccionar cargo"
            error={!!errors.cargo_actual}
          />
        </FieldWrapper>

        <FieldWrapper label="Fecha de ingreso">
          <Input
            type="date"
            value={form.fecha_ingreso}
            onChange={(e) => set("fecha_ingreso")(e.target.value)}
          />
        </FieldWrapper>

        <FieldWrapper label="Fecha de nacimiento">
          <Input
            type="date"
            value={form.fecha_nacimiento}
            onChange={(e) => set("fecha_nacimiento")(e.target.value)}
          />
        </FieldWrapper>

        <FieldWrapper label="Mentor" hint="Persona del equipo que guía su desarrollo">
          <Select
            value={form.mentor_id}
            onChange={(e) => set("mentor_id")(e.target.value)}
            options={mentoresOpciones}
            placeholder="Sin mentor asignado"
          />
        </FieldWrapper>

        {/* Toggle Apalancador — solo para cargos elegibles */}
        {CARGOS_LEVERAGER.includes(form.cargo_actual) && (
          <div className="flex items-center justify-between p-3 rounded-lg border border-[#e8e8e8] bg-[#fafafa]">
            <div>
              <p className="text-sm font-semibold text-[#1a1a2e]">¿Es Apalancador?</p>
              <p className="text-xs text-[#888] mt-0.5">
                Consultor que trabaja bajo la supervisión directa de un Socio o Director.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, is_leverager: !f.is_leverager }))}
              className="relative w-10 h-6 rounded-full transition-colors flex-shrink-0"
              style={{ background: form.is_leverager ? "#4a90e2" : "#e0e0e0" }}
            >
              <span
                className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform"
                style={{ transform: form.is_leverager ? "translateX(18px)" : "translateX(2px)" }}
              />
            </button>
          </div>
        )}

        {/* Preferencias de matching */}
        <div className="border-t border-[#f0f0f0] pt-5">
          <p className="text-xs font-semibold text-[#888] uppercase tracking-widest mb-4">
            Preferencias y experiencia
          </p>

          <div className="space-y-4">
            <FieldWrapper label="Industrias" hint="Experiencia sectorial">
              <MultiSelect
                options={industrias}
                value={form.industrias}
                onChange={(v) => set("industrias")(v)}
                placeholder="Agregar industrias..."
              />
            </FieldWrapper>

            <FieldWrapper label="Capacidades" hint="Habilidades técnicas">
              <MultiSelect
                options={capacidades}
                value={form.capacidades}
                onChange={(v) => set("capacidades")(v)}
                placeholder="Agregar capacidades..."
              />
            </FieldWrapper>

            <FieldWrapper label="Temáticas" hint="Áreas de interés">
              <MultiSelect
                options={tematicas}
                value={form.tematicas}
                onChange={(v) => set("tematicas")(v)}
                placeholder="Agregar temáticas..."
              />
            </FieldWrapper>
          </div>
        </div>

      </div>
    </Drawer>
  );
}

// Sincroniza las relaciones N:N borrando y re-insertando
async function syncRelaciones(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  personaId: string,
  form: FormState
) {
  await Promise.all([
    supabase.from("persona_industria").delete().eq("persona_id", personaId),
    supabase.from("persona_capacidad").delete().eq("persona_id", personaId),
    supabase.from("persona_tematica").delete().eq("persona_id", personaId),
  ]);

  const inserts: Promise<unknown>[] = [];

  if (form.industrias.length > 0) {
    inserts.push(
      supabase.from("persona_industria").insert(
        form.industrias.map((id) => ({ persona_id: personaId, industria_id: id }))
      )
    );
  }
  if (form.capacidades.length > 0) {
    inserts.push(
      supabase.from("persona_capacidad").insert(
        form.capacidades.map((id) => ({ persona_id: personaId, capacidad_id: id }))
      )
    );
  }
  if (form.tematicas.length > 0) {
    inserts.push(
      supabase.from("persona_tematica").insert(
        form.tematicas.map((id) => ({ persona_id: personaId, tematica_id: id }))
      )
    );
  }

  await Promise.all(inserts);
}
