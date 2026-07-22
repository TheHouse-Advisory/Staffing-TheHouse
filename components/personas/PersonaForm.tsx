"use client";

import { useState, useEffect } from "react";
import { createAnyClient } from "@/lib/supabase/client";
import { Drawer } from "@/components/ui/Drawer";
import { Button } from "@/components/ui/Button";
import { FieldWrapper, Input, Select } from "@/components/ui/FormField";
import { MultiSelect, type Option } from "@/components/ui/MultiSelect";
import { Trash2, Plus } from "lucide-react";
import type { Persona } from "@/lib/types/database";

// ── Desarrollo de Carrera (estado local, sin backend aún) ─────
interface PeriodoCargo {
  id: number; // clave local para React key
  cargo: string;
  fecha_inicio: string;
  fecha_fin: string;
}

const ESCALONES_FORM = [
  "Trainee",
  "Consultor Analista",
  "Consultor de Proyectos",
  "Senior",
  "Asociado",
  "Gerente",
  "Director",
  "Socio",
  "Desarrollo",
] as const;

let _nextId = 1;
function nextId() { return _nextId++; }

interface PersonaFormProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  persona?: Persona; // undefined = crear, definido = editar
  /** Solo admins pueden ver/editar el campo "Referente" */
  isAdmin?: boolean;
  /** Si se provee, hace scroll automático a esa sección al abrir el formulario */
  initialSection?: "desarrollo-carrera";
}

// Cargos que pueden ser apalancadores
const CARGOS_LEVERAGER = ["Consultor Senior", "Consultor de Proyectos", "Consultor Proyecto", "Consultor Analista"];
// Cargos que pueden ser "Referente" (incluye variantes con/sin "de Proyectos" — ver CARGOS_OCULTOS_GYD)
const CARGOS_REFERENTE = ["Director de Proyectos", "Director", "Gerente de Proyectos", "Gerente", "Asociado"];

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
  referente: boolean;
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
  referente: false,
  industrias: [],
  capacidades: [],
  tematicas: [],
};

export function PersonaForm({ open, onClose, onSuccess, persona, isAdmin = false, initialSection }: PersonaFormProps) {
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
  const [periodosCargo, setPeriodosCargo] = useState<PeriodoCargo[]>([]);
  // Marca cuando terminó de cargar los datos de relaciones (industrias/capacidades/temáticas/historial),
  // para no hacer scroll a una sección antes de que su layout final (chips, filas) esté renderizado
  const [relacionesReady, setRelacionesReady] = useState(false);

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
    if (!open) { setForm(EMPTY); setErrors({}); setServerError(null); setRelacionesReady(false); return; }
    if (!persona) { setRelacionesReady(true); return; }
    setRelacionesReady(false);

    async function loadRelaciones() {
      const supabase = createAnyClient();
      const [pi, pc, pt, hc] = await Promise.all([
        supabase.from("persona_industria").select("industria_id").eq("persona_id", persona!.id),
        supabase.from("persona_capacidad").select("capacidad_id").eq("persona_id", persona!.id),
        supabase.from("persona_tematica").select("tematica_id").eq("persona_id", persona!.id),
        supabase.from("historial_cargos").select("cargo, fecha_inicio, fecha_fin")
          .eq("persona_id", persona!.id).order("fecha_inicio", { ascending: true }),
      ]);
      setPeriodosCargo(
        ((hc.data ?? []) as { cargo: string; fecha_inicio: string; fecha_fin: string | null }[]).map(
          (r) => ({ id: nextId(), cargo: r.cargo, fecha_inicio: r.fecha_inicio, fecha_fin: r.fecha_fin ?? "" })
        )
      );
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
        referente: persona!.referente ?? false,
        industrias: (pi.data ?? []).map((r: any) => r.industria_id),
        capacidades: (pc.data ?? []).map((r: any) => r.capacidad_id),
        tematicas: (pt.data ?? []).map((r: any) => r.tematica_id),
      });
      setRelacionesReady(true);
    }
    loadRelaciones();
  }, [open, persona]);

  // Auto-scroll a la sección solicitada (ej: botón lápiz de "Desarrollo de Carrera" en el perfil).
  // Espera a que las relaciones terminen de cargar: recién ahí el layout final (chips, filas
  // de historial) está renderizado y la posición de la sección es la definitiva.
  useEffect(() => {
    if (!open || !initialSection || !relacionesReady) return;
    const id = initialSection === "desarrollo-carrera" ? "desarrollo-carrera-form" : null;
    if (!id) return;
    const t = setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
    return () => clearTimeout(t);
  }, [open, initialSection, relacionesReady]);

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
      referente: CARGOS_REFERENTE.includes(form.cargo_actual) ? form.referente : false,
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

      // Registrar cargo inicial en historial si no viene de periodosCargo
      // (se sincroniza justo abajo junto al resto de periodos)
    }

    // Sincronizar historial_cargos: borrar y re-insertar
    await supabase.from("historial_cargos").delete().eq("persona_id", personaId);
    const periodosFiltrados = periodosCargo.filter((p) => p.cargo && p.fecha_inicio);
    if (periodosFiltrados.length > 0) {
      await supabase.from("historial_cargos").insert(
        periodosFiltrados.map((p) => ({
          persona_id:  personaId,
          cargo:       p.cargo,
          fecha_inicio: p.fecha_inicio,
          fecha_fin:   p.fecha_fin || null,
        }))
      );
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

        {/* Toggle Referente — solo para cargos elegibles y solo visible para admins */}
        {isAdmin && CARGOS_REFERENTE.includes(form.cargo_actual) && (
          <div className="flex items-center justify-between p-3 rounded-lg border border-[#e8e8e8] bg-[#fafafa]">
            <div>
              <p className="text-sm font-semibold text-[#1a1a2e]">¿Es Referente?</p>
              <p className="text-xs text-[#888] mt-0.5">
                Director, Gerente o Asociado que actúa como referente del equipo.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, referente: !f.referente }))}
              className="relative w-10 h-6 rounded-full transition-colors flex-shrink-0"
              style={{ background: form.referente ? "#4a90e2" : "#e0e0e0" }}
            >
              <span
                className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform"
                style={{ transform: form.referente ? "translateX(18px)" : "translateX(2px)" }}
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

        {/* ── Desarrollo de Carrera ────────────────────────── */}
        <div id="desarrollo-carrera-form" className="border-t border-[#f0f0f0] pt-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-[#1a1a2e]">Desarrollo de Carrera</h3>
              <p className="text-[11px] text-[#aaa] mt-0.5">Historial de cargos en la consultora</p>
            </div>
            <button
              type="button"
              onClick={() =>
                setPeriodosCargo((prev) => [
                  ...prev,
                  { id: nextId(), cargo: "", fecha_inicio: "", fecha_fin: "" },
                ])
              }
              className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-lg border border-[#e0e0e0] text-[#555] hover:bg-[#f5f5f5] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Añadir periodo
            </button>
          </div>

          {periodosCargo.length === 0 ? (
            <p className="text-[12px] text-[#ccc] italic text-center py-4 border border-dashed border-[#e8e8e8] rounded-lg">
              Sin periodos registrados. Usa "+ Añadir periodo" para comenzar.
            </p>
          ) : (
            <div className="space-y-2">
              {/* Encabezado de columnas */}
              <div className="grid grid-cols-[1fr_130px_130px_32px] gap-2 px-1">
                <span className="text-[10px] font-semibold text-[#aaa] uppercase tracking-wide">Cargo</span>
                <span className="text-[10px] font-semibold text-[#aaa] uppercase tracking-wide">Inicio</span>
                <span className="text-[10px] font-semibold text-[#aaa] uppercase tracking-wide">Término</span>
                <span />
              </div>

              {periodosCargo.map((p) => {
                // Considera Desarrollo si el rol del persona o el cargo actual lo indica
                const esDesarrollo =
                  persona?.rol_sistema === "Desarrollo" ||
                  form.cargo_actual === "Desarrollo" ||
                  (form.cargo_actual ?? "").toLowerCase().includes("desarrollo");

                return (
                <div key={p.id} className="grid grid-cols-[1fr_130px_130px_32px] gap-2 items-center">
                  {/* Cargo: texto libre para Desarrollo, selector fijo para Consultoría */}
                  {esDesarrollo ? (
                    <input
                      type="text"
                      value={p.cargo}
                      onChange={(e) => {
                        const val = e.target.value;
                        const pid = p.id;
                        setPeriodosCargo((prev) =>
                          prev.map((x) => x.id === pid ? { ...x, cargo: val } : x)
                        );
                      }}
                      placeholder="Ej: Frontend Developer Sr"
                      autoComplete="off"
                      className="w-full border border-[#e0e0e0] rounded-lg px-2.5 py-2 text-[12px] text-[#1a1a1a] placeholder-[#ccc] focus:outline-none focus:border-[#4a90e2] transition-colors"
                    />
                  ) : (
                    <select
                      value={p.cargo}
                      onChange={(e) => {
                        const val = e.target.value;
                        const pid = p.id;
                        setPeriodosCargo((prev) =>
                          prev.map((x) => x.id === pid ? { ...x, cargo: val } : x)
                        );
                      }}
                      className="w-full border border-[#e0e0e0] rounded-lg px-2.5 py-2 text-[12px] text-[#1a1a1a] bg-white focus:outline-none focus:border-[#4a90e2] transition-colors"
                    >
                      <option value="">Seleccionar cargo…</option>
                      {p.cargo && !(ESCALONES_FORM as readonly string[]).includes(p.cargo) && (
                        <option value={p.cargo}>{p.cargo}</option>
                      )}
                      {ESCALONES_FORM.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  )}

                  {/* Fecha inicio */}
                  <input
                    type="date"
                    value={p.fecha_inicio}
                    onChange={(e) =>
                      setPeriodosCargo((prev) =>
                        prev.map((x) => x.id === p.id ? { ...x, fecha_inicio: e.target.value } : x)
                      )
                    }
                    className="border border-[#e0e0e0] rounded-lg px-2.5 py-2 text-[12px] text-[#1a1a1a] focus:outline-none focus:border-[#4a90e2] transition-colors w-full"
                  />

                  {/* Fecha término */}
                  <input
                    type="date"
                    value={p.fecha_fin}
                    min={p.fecha_inicio || undefined}
                    onChange={(e) =>
                      setPeriodosCargo((prev) =>
                        prev.map((x) => x.id === p.id ? { ...x, fecha_fin: e.target.value } : x)
                      )
                    }
                    placeholder="Presente"
                    className="border border-[#e0e0e0] rounded-lg px-2.5 py-2 text-[12px] text-[#1a1a1a] focus:outline-none focus:border-[#4a90e2] transition-colors w-full"
                  />

                  {/* Eliminar fila */}
                  <button
                    type="button"
                    onClick={() =>
                      setPeriodosCargo((prev) => prev.filter((x) => x.id !== p.id))
                    }
                    className="p-1.5 rounded-lg text-[#ccc] hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="Eliminar periodo"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
              })}

              <p className="text-[10px] text-[#bbb] pt-1">
                Deja "Término" vacío si es el cargo actual.
              </p>
            </div>
          )}
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
