"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { format, startOfISOWeek, addWeeks, addDays } from "date-fns";
import { es } from "date-fns/locale";
import { Plus, X, Loader2, FlaskConical, Save, AlertTriangle, RotateCcw, RefreshCw, Trash2 } from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";
import { SandboxInicioView } from "@/components/planificacion/SandboxInicioView";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

// ─── Tipos ────────────────────────────────────────────────────

interface PersonaAsig {
  id: string;
  nombre: string;
  apellido: string;
  iniciales: string | null;
  cargo: string;
  pct: number;
  fecha_inicio: string;
  fecha_fin: string;
  requerimiento_id?: string | null;
}

interface ReqSnap {
  id: string;
  cargo_requerido: string | null;
  pct_dedicacion: number;
  fecha_inicio: string;
  fecha_fin: string | null;
  fase_nombre: string | null;
}

interface ActividadSnap {
  id?: string;
  tipo: string;
  titulo: string;
  fecha_inicio: string;
  fecha_fin: string;
}

interface EngSnap {
  id: string;
  codigo: string | null;
  nombre: string;
  cliente: string | null;
  tipo: string;
  fecha_inicio: string;
  fecha_fin: string;
  personas: PersonaAsig[];
  reqs?: ReqSnap[];
  actividades?: ActividadSnap[]; // viajes y talleres del engagement
}

interface PlanSimulacion {
  id: string;
  nombre: string;
  creadoEn: string;
  estado: "Borrador" | "Aceptado" | "Rechazado";
  snapshot: EngSnap[];
  mutaciones: Record<string, number | null>;
  /** true si ya tiene un snapshot de data_real_previa en Supabase (plan aprobado) */
  tieneRealPrevia?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────


const ESTADO_STYLE: Record<PlanSimulacion["estado"], string> = {
  Borrador:  "bg-slate-100 text-slate-600",
  Aceptado:  "bg-green-100 text-green-700",
  Rechazado: "bg-red-100 text-red-600",
};

// ─── Persistencia Supabase + localStorage (fallback) ─────────

const LS_KEY = "planificacion_sandbox_v1";

/** @deprecated usar persistirPlan. Alias para compatibilidad. */
function guardarPlanes(planes: PlanSimulacion[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(planes)); } catch {}
}

/** Carga planes desde Supabase. Fallback a localStorage si falla. */
async function cargarPlanesRemoto(): Promise<PlanSimulacion[]> {
  try {
    const sb = createAnyClient();
    const { data, error } = await sb
      .from("plan_simulacion")
      .select("id, nombre, estado, creado_en, data_simulada, data_real_previa")
      .order("creado_en", { ascending: false });
    if (error || !data) throw error;
    return (data as any[]).map((row) => ({
      id: row.id,
      nombre: row.nombre,
      estado: row.estado as PlanSimulacion["estado"],
      creadoEn: row.creado_en,
      snapshot: (row.data_simulada ?? []) as EngSnap[],
      mutaciones: {},
      tieneRealPrevia: row.data_real_previa != null,
    }));
  } catch {
    // Fallback: localStorage mientras la tabla no exista
    try { return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]"); } catch { return []; }
  }
}

/** Upsert del plan en Supabase + localStorage como caché. */
async function persistirPlan(plan: PlanSimulacion): Promise<void> {
  // Siempre guardar en localStorage (cache inmediato)
  try {
    const local = JSON.parse(localStorage.getItem(LS_KEY) ?? "[]") as PlanSimulacion[];
    const actualizado = local.some((p) => p.id === plan.id)
      ? local.map((p) => p.id === plan.id ? plan : p)
      : [plan, ...local];
    localStorage.setItem(LS_KEY, JSON.stringify(actualizado));
  } catch {}

  // Persistir en Supabase
  const sb = createAnyClient();
  await (sb as any).from("plan_simulacion").upsert({
    id:            plan.id,
    nombre:        plan.nombre,
    estado:        plan.estado,
    creado_en:     plan.creadoEn,
    data_simulada: plan.snapshot,
  }, { onConflict: "id" });
}

/** Elimina el plan de Supabase + localStorage. */
/**
 * Elimina SOLO el contenedor del escenario (plan_simulacion + localStorage).
 * NUNCA toca las tablas reales (asignacion, engagement, etc.).
 * Si el plan estaba "Aceptado", su data ya está en el Tablero real y debe permanecer intacta.
 */
async function eliminarPlanRemoto(id: string): Promise<void> {
  // 1. Borrar de localStorage
  try {
    const local = JSON.parse(localStorage.getItem(LS_KEY) ?? "[]") as PlanSimulacion[];
    localStorage.setItem(LS_KEY, JSON.stringify(local.filter((p) => p.id !== id)));
  } catch {}
  // 2. Borrar SOLO la fila de plan_simulacion (no toca asignacion ni engagement)
  const sb = createAnyClient();
  await (sb as any).from("plan_simulacion").delete().eq("id", id);
  // ✅ Las tablas reales (asignacion, engagement) quedan intactas
}

// ─── Query snapshot ───────────────────────────────────────────

async function fetchSnapshot(): Promise<EngSnap[]> {
  const sb = createAnyClient();
  const hoy = format(new Date(), "yyyy-MM-dd");
  const fin  = format(addDays(new Date(), 90), "yyyy-MM-dd");

  const [engsRes, asigRes] = await Promise.all([
    sb.from("engagement")
      .select("id, codigo, nombre, cliente, tipo, fecha_inicio, fecha_fin_estimada, fecha_fin_real")
      .in("estado", ["activo", "propuesta", "pausado"])
      .eq("is_deleted", false)
      // Incluye engagements sin fecha_inicio (recién creados) y los que empiezan dentro del horizonte
      .or(`fecha_inicio.is.null,fecha_inicio.lte.${fin}`)
      // Incluye los que aún no terminaron o no tienen fecha fin
      .or(`fecha_fin_real.gte.${hoy},fecha_fin_estimada.gte.${hoy},fecha_fin_real.is.null,fecha_fin_estimada.is.null`),
    sb.from("asignacion")
      .select("id, persona_id, engagement_id, pct_dedicacion, fecha_inicio, fecha_fin, persona:persona_id(nombre, apellido, iniciales, cargo_actual)")
      .eq("estado", "activa")
      // Incluye asignaciones sin fecha_inicio y las que empiezan dentro del horizonte
      .or(`fecha_inicio.is.null,fecha_inicio.lte.${fin}`)
      // Incluye asignaciones abiertas o vigentes
      .or(`fecha_fin.gte.${hoy},fecha_fin.is.null`) as any,
  ]);

  const engs = (engsRes.data ?? []) as any[];
  const asigs = (asigRes.data ?? []) as any[];

  return engs.map((e) => {
    const personas: PersonaAsig[] = asigs
      .filter((a) => a.engagement_id === e.id)
      .map((a) => {
        const p = Array.isArray(a.persona) ? a.persona[0] : a.persona;
        return {
          id: a.persona_id,
          nombre: p?.nombre ?? "",
          apellido: p?.apellido ?? "",
          iniciales: p?.iniciales ?? null,
          cargo: p?.cargo_actual ?? "",
          pct: a.pct_dedicacion,
          fecha_inicio: a.fecha_inicio,
          fecha_fin: a.fecha_fin,
        };
      });
    return {
      id: e.id,
      codigo: e.codigo ?? null,
      nombre: e.nombre,
      cliente: e.cliente ?? null,
      tipo: e.tipo ?? "proyecto",
      fecha_inicio: e.fecha_inicio,
      fecha_fin: e.fecha_fin_real ?? e.fecha_fin_estimada ?? null,
      personas,
    };
  });
}

// ─── Componente principal ─────────────────────────────────────

export function GanttPlanificacion() {
  const router = useRouter();
  const [planes, setPlanes]           = useState<PlanSimulacion[]>([]);
  const [planActivo, setPlanActivo]   = useState<string | null>(null);
  const [modalOpen, setModalOpen]     = useState(false);
  const [nombreInput, setNombreInput] = useState("");
  const [cargando, setCargando]       = useState(false);
  const [loadingPlanes, setLoadingPlanes] = useState(true);

  // Semana de navegación para la grilla
  const [semana, setSemana] = useState(() => startOfISOWeek(new Date()));
  const COLS = 6; // semanas visibles
  const columnas = Array.from({ length: COLS }, (_, i) => addWeeks(semana, i));

  // Carga inicial: Supabase con fallback localStorage
  useEffect(() => {
    cargarPlanesRemoto().then((data) => {
      setPlanes(data);
      setLoadingPlanes(false);
    });
  }, []);

  const plan = planes.find((p) => p.id === planActivo) ?? null;
  const [sincronizando, setSincronizando] = useState(false);
  const [toastSync,     setToastSync]     = useState(false);
  const [modalEliminar, setModalEliminar] = useState<{ id: string; nombre: string; tipo: "aceptado" | "borrador" } | null>(null);

  type CambioPendiente = { etiqueta: string; descripcion: string; color: "green" | "red" | "yellow" };
  const [cambiosPendientes,    setCambiosPendientes]    = useState<CambioPendiente[]>([]);
  const [cargandoCambios,      setCargandoCambios]      = useState(false);

  /**
   * Smart Pull: abre un escenario fusionando su snapshot con el Tablero real.
   *
   * Reglas de merge:
   * A) Proyectos NUEVOS en producción → se inyectan completos al escenario.
   * B) Proyectos EXISTENTES en el escenario:
   *    - Personas presentes en producción pero NO en el escenario → se añaden.
   *    - Personas presentes en el escenario pero NO en producción → se conservan
   *      (fueron añadidas en simulación).
   *    - Personas en ambos → se conservan las fechas/datos de la simulación
   *      (el planificador manda sobre el Tablero real).
   * C) Estado "Aceptado" + hay diferencias → pasa a "Borrador" automáticamente.
   */
  async function abrirEscenarioConPull(id: string) {
    if (planActivo === id) { setPlanActivo(null); return; }

    setPlanActivo(id);
    const planSeleccionado = planes.find((p) => p.id === id);
    if (!planSeleccionado) return;

    setSincronizando(true);
    try {
      // Pull paralelo: tablero + personas activas + ausencias vigentes
      const hoy = format(new Date(), "yyyy-MM-dd");
      const sb = createAnyClient();
      const [tableroProd, persRes, ausRes] = await Promise.all([
        fetchSnapshot(),
        sb.from("persona").select("id, nombre, apellido, iniciales, cargo_actual, is_leverager").eq("activo", true),
        sb.from("ausencia").select("persona_id, fecha_inicio, fecha_fin, tipo")
          .lte("fecha_inicio", format(addDays(new Date(), 30), "yyyy-MM-dd"))
          .gte("fecha_fin", hoy),
      ]);

      // Actualizar personas y ausencias en el snapshot (para que el cuadrante EQUIPO
      // y las validaciones de ausencias usen datos frescos)
      // Estos se usan en SandboxInicioView que ya los carga en su propio useEffect,
      // pero los guardamos en el snapshot para coherencia del merge.
      const personasActuales = (persRes.data ?? []) as any[];
      const ausenciasActuales = (ausRes.data ?? []) as any[];
      console.log(`[Smart Pull] Datos frescos: ${tableroProd.length} engs, ${personasActuales.length} personas, ${ausenciasActuales.length} ausencias`);

      const prodMap = new Map(tableroProd.map((e) => [e.id, e]));
      const snapshotActual = planSeleccionado.snapshot;
      const idsEnSnapshot = new Set(snapshotActual.map((e) => e.id));

      // huboMergeEstructural: personas nuevas o engagements nuevos → puede degradar estado
      // huboMergeMetadata:    solo nombre/cargo actualizados → NO degrada estado
      let huboMergeEstructural = false;
      let huboMergeMetadata    = false;

      // Mapa de personas actuales para actualizar nombre/cargo en snapshot
      const personaMap = new Map(personasActuales.map((p: any) => [p.id, p]));

      // B) Merge de proyectos existentes
      const snapshotMergeado: EngSnap[] = snapshotActual.map((engSim) => {
        const engProd = prodMap.get(engSim.id);

        // Actualizar nombre/cargo de personas ya en el escenario con datos frescos de DB
        const personasActualizadas = engSim.personas.map((p) => {
          const pReal = personaMap.get(p.id);
          if (!pReal) return p; // persona eliminada, conservar en simulación
          // Actualiza nombre e iniciales si cambiaron, pero preserva fechas de simulación
          return {
            ...p,
            nombre:    pReal.nombre    ?? p.nombre,
            apellido:  pReal.apellido  ?? p.apellido,
            iniciales: pReal.iniciales ?? p.iniciales,
            cargo:     pReal.cargo_actual ?? p.cargo, // cargo actualizado
          };
        });

        if (!engProd) return { ...engSim, personas: personasActualizadas };

        // IDs de personas ya en el escenario para este engagement
        const idsPersonasSim = new Set(engSim.personas.map((p) => p.id));

        // Personas nuevas en producción que el escenario no tiene aún
        const personasNuevasDeProd = engProd.personas.filter(
          (p) => !idsPersonasSim.has(p.id)
        );

        if (personasNuevasDeProd.length === 0 &&
            JSON.stringify(personasActualizadas) === JSON.stringify(engSim.personas)) {
          return engSim;
        }

        if (personasNuevasDeProd.length > 0) {
          huboMergeEstructural = true; // nueva persona inyectada → cambio estructural
        } else {
          huboMergeMetadata = true;    // solo nombre/cargo actualizado → metadata
        }
        return {
          ...engSim,
          personas: [...personasActualizadas, ...personasNuevasDeProd],
        };
      });

      // A) Proyectos NUEVOS en producción → inyectar solo si no tienen gemelo lógico en snapshot.
      //    Gemelo lógico = mismo nombre+tipo+cliente (evita duplicados cuando el snapshot tiene
      //    sim_eng_* y producción tiene UUID_A/UUID_B del mismo engagement aprobado anteriormente).
      //    Solo cuentan como "estructural" los de tipo distinto a ayuda_interna.
      const huellasEnSnapshot = new Set(
        snapshotActual.map((e) => `${e.nombre}|${e.tipo}|${(e.cliente ?? "").trim().toLowerCase()}`)
      );
      const engNuevos = tableroProd.filter((e) => {
        if (idsEnSnapshot.has(e.id)) return false; // mismo ID ya en snapshot
        const huella = `${e.nombre}|${e.tipo}|${(e.cliente ?? "").trim().toLowerCase()}`;
        return !huellasEnSnapshot.has(huella); // excluir gemelos lógicos
      });
      const engNuevosEstructurales = engNuevos.filter((e) => e.tipo !== "ayuda_interna");
      if (engNuevosEstructurales.length > 0) huboMergeEstructural = true;

      if (!huboMergeEstructural && !huboMergeMetadata) return; // nada cambió, no mutar estado

      const nuevoSnapshot: EngSnap[] = [...snapshotMergeado, ...engNuevos];

      // C) "Aceptado" + cambio ESTRUCTURAL → Borrador
      //    Cambios de metadata (nombre/cargo) no degradan el estado aprobado
      const nuevoEstado = (planSeleccionado.estado === "Aceptado" && huboMergeEstructural)
        ? "Borrador"
        : planSeleccionado.estado;

      const planActualizado: PlanSimulacion = {
        ...planSeleccionado,
        snapshot: nuevoSnapshot,
        estado: nuevoEstado as PlanSimulacion["estado"],
        tieneRealPrevia: nuevoEstado === "Borrador" ? false : planSeleccionado.tieneRealPrevia,
      };

      setPlanes((prev) => prev.map((p) => p.id === id ? planActualizado : p));
      try {
        const local = JSON.parse(localStorage.getItem(LS_KEY) ?? "[]") as PlanSimulacion[];
        localStorage.setItem(LS_KEY, JSON.stringify(local.map((p) => p.id === id ? planActualizado : p)));
      } catch {}

      console.log(`[Smart Pull] Merge completado en "${planSeleccionado.nombre}":`,
        { engNuevos: engNuevos.length, personasMergeadas: snapshotMergeado.filter((_, i) => snapshotActual[i]?.personas.length !== snapshotMergeado[i]?.personas.length).length }
      );
    } finally {
      setSincronizando(false);
    }
  }

  // ── Sincronizar escenario activo con datos reales ─────────
  async function sincronizarConDatosReales() {
    if (!planActivo) return;
    const planSeleccionado = planes.find((p) => p.id === planActivo);
    if (!planSeleccionado) return;

    setSincronizando(true);
    try {
      const hoy = format(new Date(), "yyyy-MM-dd");
      const sb  = createAnyClient();
      const [tableroProd, persRes] = await Promise.all([
        fetchSnapshot(),
        sb.from("persona").select("id, nombre, apellido, iniciales, cargo_actual, is_leverager").eq("activo", true),
      ]);

      const prodMap      = new Map(tableroProd.map((e: any) => [e.id, e]));
      const personaMap   = new Map((persRes.data ?? []).map((p: any) => [p.id, p]));
      const snapshotActual = planSeleccionado.snapshot;

      // 1) Mantener solo los engagements que siguen existiendo en producción
      //    (o que son sim_eng_* — propios de la simulación, sin par en prod)
      const snapshotFiltrado = snapshotActual.filter((engSim) => {
        if (engSim.id.startsWith("sim_eng_")) return true; // propio de simulación → conservar
        return prodMap.has(engSim.id); // fue eliminado del tablero real → sacar
      });

      // 2) Merge de personas en engagements existentes (mismo algoritmo que Smart Pull)
      const snapshotMergeado: EngSnap[] = snapshotFiltrado.map((engSim) => {
        const engProd = prodMap.get(engSim.id);
        const personasActualizadas = engSim.personas.map((p) => {
          const pReal = (personaMap as any).get(p.id);
          if (!pReal) return p;
          return { ...p, nombre: pReal.nombre ?? p.nombre, apellido: pReal.apellido ?? p.apellido,
                         iniciales: pReal.iniciales ?? p.iniciales, cargo: pReal.cargo_actual ?? p.cargo };
        });
        if (!engProd) return { ...engSim, personas: personasActualizadas };
        const idsPersonasSim = new Set(engSim.personas.map((p) => p.id));
        const personasNuevas = engProd.personas.filter((p: any) => !idsPersonasSim.has(p.id));
        return { ...engSim, personas: [...personasActualizadas, ...personasNuevas] };
      });

      // 3) Inyectar engagements nuevos en producción que el snapshot no tiene
      const huellasEnSnapshot = new Set(
        snapshotActual.map((e) => `${e.nombre}|${e.tipo}|${(e.cliente ?? "").trim().toLowerCase()}`)
      );
      const idsEnSnapshot = new Set(snapshotActual.map((e) => e.id));
      const engNuevos = tableroProd.filter((e: any) => {
        if (idsEnSnapshot.has(e.id)) return false;
        const huella = `${e.nombre}|${e.tipo}|${(e.cliente ?? "").trim().toLowerCase()}`;
        return !huellasEnSnapshot.has(huella);
      });

      const nuevoSnapshot: EngSnap[] = [...snapshotMergeado, ...engNuevos];

      const planActualizado: PlanSimulacion = {
        ...planSeleccionado,
        snapshot: nuevoSnapshot,
        // Si el plan era Aceptado y hay cambios estructurales (eliminados o nuevos no-ayuda_interna), degradar a Borrador
        estado: (planSeleccionado.estado === "Aceptado" &&
                 (snapshotFiltrado.length !== snapshotActual.length ||
                  engNuevos.filter((e: any) => e.tipo !== "ayuda_interna").length > 0))
          ? "Borrador"
          : planSeleccionado.estado,
      };
      if (planActualizado.estado === "Borrador" && planSeleccionado.estado === "Aceptado") {
        planActualizado.tieneRealPrevia = false;
      }

      setPlanes((prev) => prev.map((p) => p.id === planActivo ? planActualizado : p));
      try {
        const local = JSON.parse(localStorage.getItem(LS_KEY) ?? "[]") as PlanSimulacion[];
        localStorage.setItem(LS_KEY, JSON.stringify(local.map((p) => p.id === planActivo ? planActualizado : p)));
      } catch {}

      // Toast de éxito
      setToastSync(true);
      setTimeout(() => setToastSync(false), 3000);
    } finally {
      setSincronizando(false);
    }
  }

  // ── Crear plan ──────────────────────────────────────────────
  async function handleCrear() {
    if (!nombreInput.trim()) return;
    setCargando(true);
    try {
      const snapshot = await fetchSnapshot();
      const nuevo: PlanSimulacion = {
        id: `plan_${Date.now()}`,
        nombre: nombreInput.trim(),
        creadoEn: new Date().toISOString(),
        estado: "Borrador",
        snapshot,
        mutaciones: {},
      };
      setPlanes([nuevo, ...planes]);
      await persistirPlan(nuevo); // guarda en Supabase + localStorage
      setPlanActivo(nuevo.id);
      setModalOpen(false);
      setNombreInput("");
    } finally {
      setCargando(false);
    }
  }

  // ── Cambiar estado del plan ─────────────────────────────────
  async function cambiarEstado(id: string, estado: PlanSimulacion["estado"]) {
    // "Aceptado" NUNCA puede aplicarse silenciosamente — siempre requiere modal
    if (estado === "Aceptado") {
      console.warn("[Planificación] cambiarEstado('Aceptado') bloqueado. Usar aprobarPlan() con modal.");
      return;
    }
    const actualizado = planes.find((p) => p.id === id);
    if (!actualizado) return;
    const nuevo = { ...actualizado, estado };
    setPlanes(planes.map((p) => p.id === id ? nuevo : p));
    await persistirPlan(nuevo);
  }

  // ── Mutaciones del snapshot (drag&drop, pct, eliminación) ──────────────
  // Huella estructural: engagement IDs + persona IDs por engagement (ordenados).
  // Si la huella no cambia, es una re-hidratación/re-render, NO una edición del usuario.
  function snapshotHuella(snap: EngSnap[]): string {
    return JSON.stringify(
      [...snap]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((e) => [e.id, [...(e.personas ?? [])].map((p) => p.id).sort()])
    );
  }

  function handleSnapshotChange(nextSnapshot: EngSnap[]) {
    if (!planActivo) return;
    // Usa setPlanes funcional para siempre leer el estado más reciente (evita stale closure)
    setPlanes((prev) => {
      const planActualizado = prev.find((p) => p.id === planActivo);
      if (!planActualizado) return prev;

      // Protección anti-regresión: si el plan está "Aceptado" y la huella estructural
      // del snapshot no cambió, es una re-hidratación (prop refresh, re-render de parent).
      // Solo actualizamos el snapshot en memoria SIN degradar el estado.
      if (planActualizado.estado === "Aceptado") {
        if (snapshotHuella(nextSnapshot) === snapshotHuella(planActualizado.snapshot)) {
          return prev.map((p) => p.id !== planActivo ? p : { ...p, snapshot: nextSnapshot });
        }
      }

      // Huella cambió → acción real del usuario → degradar "Aceptado" → "Borrador"
      const estadoDegradado = planActualizado.estado === "Aceptado" ? "Borrador" : planActualizado.estado;
      const nuevo = {
        ...planActualizado,
        snapshot: nextSnapshot,
        estado: estadoDegradado as PlanSimulacion["estado"],
        tieneRealPrevia: estadoDegradado === "Borrador" ? false : planActualizado.tieneRealPrevia,
      };
      const siguientes = prev.map((p) => p.id !== planActivo ? p : nuevo);
      try { localStorage.setItem(LS_KEY, JSON.stringify(siguientes)); } catch {}
      return siguientes;
    });
  }

  // ── Persistir degradación "Aceptado" → "Borrador" en Supabase ──────────
  // Se activa cuando el plan activo baja de "Aceptado" a "Borrador" por una edición.
  useEffect(() => {
    if (!planActivo) return;
    const plan = planes.find((p) => p.id === planActivo);
    if (!plan || plan.estado !== "Borrador" || plan.tieneRealPrevia !== false) return;
    // Solo persiste si realmente venía de "Aceptado" (tieneRealPrevia se limpia junto al downgrade)
    const sb = createAnyClient();
    (sb as any)
      .from("plan_simulacion")
      .update({ estado: "Borrador", data_real_previa: null })
      .eq("id", planActivo)
      .then(({ error }: { error: any }) => {
        if (error) console.warn("[Planificación] No se pudo persistir degradación a Borrador:", error.message);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planes, planActivo]);

  // ── Guardar cambios del plan (persiste en localStorage; no toca tablas reales) ──
  const [guardando, setGuardando] = useState(false);
  const [guardadoOk, setGuardadoOk] = useState(false);
  async function guardarPlan() {
    if (!planActivo) return;
    setGuardando(true);
    try {
      // Lee el plan más reciente desde el estado (evita stale closure)
      const planActual = planes.find((p) => p.id === planActivo);
      if (!planActual) return;
      await persistirPlan(planActual);
      setGuardadoOk(true);
      setTimeout(() => setGuardadoOk(false), 2500);
    } finally {
      setGuardando(false);
    }
  }

  // ── Modales de confirmación ────────────────────────────────────────────────
  const [modalAprobar,   setModalAprobar]   = useState(false);
  const [modalDeshacer,  setModalDeshacer]  = useState(false);
  const [aprobando,      setAprobando]      = useState(false);
  const [deshaciendo,    setDeshaciendo]    = useState(false);
  const [errorModal,     setErrorModal]     = useState<string | null>(null);
  const [exitoMsg,       setExitoMsg]       = useState<string | null>(null);

  // ── Aprobar plan: snapshot real → aplica simulado → Aceptado ──────────────
  async function ejecutarAprobacion() {
    if (!plan) return;
    setAprobando(true);
    setErrorModal(null);
    try {
      // 0. Guarda el snapshot más reciente (lee del estado actual, no del closure stale)
      const planActual = planes.find((p) => p.id === plan.id) ?? plan;
      await persistirPlan(planActual);
      const sb = createAnyClient();

      // 0b. Leer data_simulada CONFIRMADA desde Supabase (evita problemas de closure/stale state)
      const { data: planRow, error: planReadErr } = await (sb as any)
        .from("plan_simulacion")
        .select("data_simulada")
        .eq("id", plan.id)
        .single();
      if (planReadErr) throw planReadErr;
      const snapshotConfirmado: EngSnap[] = (planRow?.data_simulada ?? []) as EngSnap[];
      console.log(`[Aprobación] Snapshot leído desde Supabase: ${snapshotConfirmado.length} engagements`);
      snapshotConfirmado.forEach(e => {
        console.log(`  → ${e.nombre} [${e.id}]: ${e.personas?.length ?? 0} personas, tipo: ${e.tipo}`);
        (e.personas ?? []).forEach(p => console.log(`      persona: ${p.nombre} ${p.apellido} | cargo: ${p.cargo} | ${p.fecha_inicio} → ${p.fecha_fin}`));
      });

      // A. Snapshot de asignaciones reales actuales → data_real_previa
      const { data: asigActuales, error: fetchErr } = await sb
        .from("asignacion")
        .select("*")
        .eq("estado", "activa");
      if (fetchErr) throw fetchErr;

      const { error: backupErr } = await (sb as any)
        .from("plan_simulacion")
        .update({ data_real_previa: asigActuales ?? [] })
        .eq("id", plan.id);
      if (backupErr) throw backupErr;

      // B.1 Detectar e insertar engagements NUEVOS del snapshot (creados en simulación)
      //     Los ids de simulación empiezan con "sim_eng_"; los reales son UUIDs.
      const engIdsSnapshot = snapshotConfirmado.map((e) => e.id);
      const engNuevos = snapshotConfirmado.filter((e) => e.id.startsWith("sim_eng_"));
      const engExistentesCheck = engIdsSnapshot.filter((id) => !id.startsWith("sim_eng_"));

      // Mapa: sim_eng_id → id real generado (para reasignar asignaciones)
      const idMap = new Map<string, string>();
      // snapshotFinal: snapshot con IDs reales (se rellena en B.1b si hay sim_eng_*)
      // Usado en el setPlanes final para no sobreescribir los IDs reales con el estado stale.
      let snapshotFinal: EngSnap[] = snapshotConfirmado as unknown as EngSnap[];

      if (engNuevos.length > 0) {
        for (const eng of engNuevos) {
          const { data: newEng, error: engInsErr } = await (sb as any)
            .from("engagement")
            .insert({
              nombre:             eng.nombre,
              codigo:             eng.codigo  || null,
              cliente:            eng.cliente || null,
              tipo:               eng.tipo ?? "proyecto",
              estado:             "activo",
              is_deleted:         false,
              fecha_inicio:       eng.fecha_inicio || null,
              fecha_fin_estimada: eng.fecha_fin    || null,
            })
            .select("id")
            .single();
          if (engInsErr) throw engInsErr;
          idMap.set(eng.id, newEng.id); // sim_eng_xxx → UUID real
        }

        // B.1b: reemplazar IDs simulados por UUIDs reales en data_simulada
        // Evita que Smart Pull los detecte como "nuevos" en futuras aperturas
        // y cree duplicados en DB en aprobaciones posteriores.
        snapshotFinal = snapshotConfirmado.map((e) => ({
          ...e,
          id: idMap.get(e.id) ?? e.id,
        })) as unknown as EngSnap[];
        await (sb as any)
          .from("plan_simulacion")
          .update({ data_simulada: snapshotFinal })
          .eq("id", plan.id);
      }

      // B.2 Marcar como "terminado" los engagements reales que el planificador eliminó del escenario.
      //     IMPORTANTE: usar los mismos filtros de fecha que fetchSnapshot para NO tocar engagements
      //     fuera del horizonte visible (ej: "Desarrollo Interno" sin fecha_fin, proyectos futuros).
      const hoyAprobacion = format(new Date(), "yyyy-MM-dd");
      const finAprobacion  = format(addDays(new Date(), 90), "yyyy-MM-dd");
      const { data: engsActivos } = await sb
        .from("engagement")
        .select("id")
        .eq("estado", "activo")
        // ayuda_interna ya incluidos en el snapshot — sus eliminaciones sí deben aplicarse
        .or(`fecha_inicio.is.null,fecha_inicio.lte.${finAprobacion}`)
        .or(`fecha_fin_real.gte.${hoyAprobacion},fecha_fin_estimada.gte.${hoyAprobacion},fecha_fin_real.is.null,fecha_fin_estimada.is.null`);
      const idsRealesActivos = (engsActivos ?? []).map((e: any) => e.id);
      const idsEliminados = idsRealesActivos.filter(
        (id: string) => !engExistentesCheck.includes(id) && !idMap.has(id)
      );
      if (idsEliminados.length > 0) {
        const { error: inactErr } = await (sb as any)
          .from("engagement")
          .update({ estado: "terminado" })
          .in("id", idsEliminados);
        if (inactErr) throw inactErr;
      }

      // B. Borrar asignaciones reales activas actuales
      const { error: deleteErr } = await sb
        .from("asignacion")
        .delete()
        .eq("estado", "activa");
      if (deleteErr) throw deleteErr;

      // C. Insertar asignaciones del plan simulado en la tabla real
      // Reemplazar IDs simulados por los UUIDs reales generados en B.1
      const nuevasAsig = snapshotConfirmado.flatMap((eng) =>
        eng.personas.map((p) => {
          // Usar cargo del requerimiento si existe (para que aparezca bajo el grupo correcto en Tablero)
          const reqSnap = p.requerimiento_id
            ? (eng.reqs ?? []).find((r) => r.id === p.requerimiento_id)
            : null;
          const cargoFinal = reqSnap?.cargo_requerido || p.cargo || null;
          return {
            engagement_id:    idMap.get(eng.id) ?? eng.id,
            persona_id:       p.id,
            cargo_al_momento: cargoFinal,
            pct_dedicacion:   p.pct ?? 100,
            fecha_inicio:     (p.fecha_inicio || eng.fecha_inicio) || null,
            fecha_fin:        (p.fecha_fin    || eng.fecha_fin)    || null,
            estado:           "activa",
            estado_staffing:  "CONFIRMADO",
            requerimiento_id: null, // los IDs simulados no existen en DB real
          };
        })
      ).filter((a) => a.persona_id && a.engagement_id && a.fecha_inicio && a.fecha_fin);

      console.log(`[Aprobación] Insertando ${nuevasAsig.length} asignaciones:`, nuevasAsig);

      if (nuevasAsig.length > 0) {
        for (let i = 0; i < nuevasAsig.length; i += 100) {
          const lote = nuevasAsig.slice(i, i + 100);
          const { error: insertErr, data: insertData } = await (sb as any)
            .from("asignacion")
            .insert(lote)
            .select("id");
          if (insertErr) throw new Error(`Error inserting assignments: ${insertErr.message}`);
          console.log(`[Aprobación] Lote ${i/100 + 1} insertado:`, insertData?.length, "filas");
        }
      }

      // D. Sincronizar metadatos de engagements existentes (nombre, fechas, cliente)
      for (const eng of snapshotConfirmado.filter((e) => !e.id.startsWith("sim_eng_"))) {
        await (sb as any).from("engagement")
          .update({
            nombre:             eng.nombre,
            codigo:             eng.codigo,
            cliente:            eng.cliente ?? null,
            fecha_inicio:       eng.fecha_inicio,
            fecha_fin_estimada: eng.fecha_fin ?? null,
          })
          .eq("id", eng.id);
        // No lanzamos error si falla (el eng puede no existir o tener restricciones)
      }

      // E. Sincronizar actividades (viajes/talleres) de todos los engagements del plan
      const engIdsReales = snapshotConfirmado.map((e) => idMap.get(e.id) ?? e.id)
        .filter((id) => !id.startsWith("sim_eng_"));

      if (engIdsReales.length > 0) {
        // Borrar actividades actuales de estos engagements
        await (sb as any).from("engagement_actividades")
          .delete()
          .in("engagement_id", engIdsReales);

        // Insertar actividades del snapshot
        const nuevasActividades = snapshotConfirmado.flatMap((eng) => {
          const realId = idMap.get(eng.id) ?? eng.id;
          return (eng.actividades ?? []).map((a) => ({
            engagement_id: realId,
            tipo:          a.tipo,
            titulo:        a.titulo ?? "",
            descripcion:   "",
            fecha_inicio:  a.fecha_inicio,
            fecha_fin:     a.fecha_fin,
          }));
        });

        if (nuevasActividades.length > 0) {
          const { error: actErr } = await (sb as any)
            .from("engagement_actividades")
            .insert(nuevasActividades);
          if (actErr) console.warn("[Planificación] Error al insertar actividades:", actErr.message);
        }
      }

      // F. Marcar plan como Aceptado en plan_simulacion
      const { error: updatePlanErr } = await (sb as any)
        .from("plan_simulacion")
        .update({ estado: "Aceptado" })
        .eq("id", plan.id);
      if (updatePlanErr) throw updatePlanErr;

      console.log(`[Planificación] Fusión real completada: ${nuevasAsig.length} asignaciones aplicadas desde el escenario "${plan.nombre}"`);

      // E. Actualiza estado local + refresca todos los componentes del dashboard
      // Usa snapshotFinal (con IDs reales) en lugar del plan stale para que el Smart Pull
      // posterior no detecte sim_eng_* como "nuevos" y degrade el estado a Borrador.
      setPlanes((prev) => prev.map((p) =>
        p.id !== plan.id ? p : { ...p, snapshot: snapshotFinal, estado: "Aceptado" as const, tieneRealPrevia: true }
      ));
      // planAprobado → fuerza re-fetch completo del Tablero en Inicio
      window.dispatchEvent(new CustomEvent("planAprobado"));
      window.dispatchEvent(new CustomEvent("asignacionChanged"));
      router.refresh();
      setModalAprobar(false);
      setExitoMsg(`✅ Escenario "${plan.nombre}" publicado. ${nuevasAsig.length} asignaciones aplicadas. Ve a Inicio > Tablero para ver los cambios.`);
      setTimeout(() => setExitoMsg(null), 8000);
    } catch (err: any) {
      console.error("[Planificación] Error en aprobación:", err);
      setErrorModal(err?.message ?? "Error desconocido al aprobar el plan.");
    } finally {
      setAprobando(false);
    }
  }

  // ── Deshacer aprobación: restaura snapshot real previo → Borrador ──────────
  async function ejecutarDeshacer() {
    if (!plan) return;
    setDeshaciendo(true);
    setErrorModal(null);
    try {
      const sb = createAnyClient();

      // A. Leer data_real_previa del plan
      const { data: planRow, error: fetchErr } = await (sb as any)
        .from("plan_simulacion")
        .select("data_real_previa")
        .eq("id", plan.id)
        .single();
      if (fetchErr) throw fetchErr;
      const realPrevia = planRow?.data_real_previa as any[] | null;
      if (!realPrevia) throw new Error("No hay respaldo previo para restaurar.");

      // B. Borrar asignaciones actuales (las del plan aprobado)
      const { error: deleteErr } = await sb
        .from("asignacion")
        .delete()
        .eq("estado", "activa");
      if (deleteErr) throw deleteErr;

      // C. Restaurar asignaciones reales previas en lotes de 100
      if (realPrevia.length > 0) {
        // Campos seguros para re-insertar (excluye created_at y campos auto)
        const filas = realPrevia.map(({ id: _id, created_at: _ca, ...rest }: any) => rest);
        for (let i = 0; i < filas.length; i += 100) {
          const lote = filas.slice(i, i + 100);
          const { error: insertErr } = await (sb as any)
            .from("asignacion")
            .insert(lote);
          if (insertErr) throw insertErr;
        }
      }

      // D. Regresar estado del plan a Borrador y limpiar respaldo
      const { error: updateErr } = await (sb as any)
        .from("plan_simulacion")
        .update({ estado: "Borrador", data_real_previa: null })
        .eq("id", plan.id);
      if (updateErr) throw updateErr;

      console.log(`[Planificación] Reversión completada: ${realPrevia.length} asignaciones restauradas.`);

      const actualizado = { ...plan, estado: "Borrador" as const, tieneRealPrevia: false };
      setPlanes((prev) => prev.map((p) => p.id === plan.id ? actualizado : p));
      window.dispatchEvent(new CustomEvent("planAprobado"));
      window.dispatchEvent(new CustomEvent("asignacionChanged"));
      router.refresh(); // invalida caché → re-fetch al navegar a Inicio
      setModalDeshacer(false);
      setExitoMsg(`↩ Aprobación revertida. ${realPrevia.length} asignaciones originales restauradas.`);
      setTimeout(() => setExitoMsg(null), 8000);
    } catch (err: any) {
      console.error("[Planificación] Error en reversión:", err);
      setErrorModal(err?.message ?? "Error desconocido al deshacer la aprobación.");
    } finally {
      setDeshaciendo(false);
    }
  }

  // ── Eliminar plan — abre modal según estado ────────────────
  async function eliminarPlan(id: string) {
    const planAEliminar = planes.find((p) => p.id === id);
    if (!planAEliminar) return;
    const tipo = planAEliminar.estado === "Aceptado" ? "aceptado" : "borrador";
    setModalEliminar({ id, nombre: planAEliminar.nombre, tipo });

    if (tipo === "borrador") {
      // Calcular diff entre snapshot del escenario y datos reales
      setCargandoCambios(true);
      setCambiosPendientes([]);
      try {
        const prod = await fetchSnapshot();
        const snap = planAEliminar.snapshot as EngSnap[];
        const prodMap = new Map(prod.map((e: any) => [e.id, e]));
        const prodSet = new Set(prod.map((e: any) => e.id));
        const changes: CambioPendiente[] = [];

        // Engagements nuevos creados en el escenario (no existen en prod)
        snap.forEach((e) => {
          if (e.id.startsWith("sim_eng_") || !prodSet.has(e.id)) {
            changes.push({
              etiqueta: "Nuevo",
              descripcion: `"${e.nombre}"${e.cliente ? ` — ${e.cliente}` : ""} (${e.tipo === "ayuda_interna" ? "Desarrollo Interno" : e.tipo === "propuesta" ? "Propuesta" : "Proyecto"})`,
              color: "green",
            });
          }
        });

        // Engagements eliminados del escenario (existen en prod pero no en snapshot)
        const snapIds = new Set(snap.map((e) => e.id));
        prod.forEach((e: any) => {
          if (!snapIds.has(e.id)) {
            changes.push({
              etiqueta: "Eliminado",
              descripcion: `"${e.nombre}"${e.cliente ? ` — ${e.cliente}` : ""} (${e.tipo === "ayuda_interna" ? "Desarrollo Interno" : e.tipo === "propuesta" ? "Propuesta" : "Proyecto"})`,
              color: "red",
            });
          }
        });

        // Engagements existentes: comparar fechas, personas y pct
        snap.forEach((e) => {
          const eProd = prodMap.get(e.id);
          if (!eProd) return; // ya cubierto como "nuevo"

          const partes: string[] = [];

          // Fechas del engagement
          const finiSim = (e.fecha_inicio ?? "").slice(0, 10);
          const ffinSim = (e.fecha_fin    ?? "").slice(0, 10);
          const finiProd = (eProd.fecha_inicio ?? "").slice(0, 10);
          const ffinProd = (eProd.fecha_fin    ?? "").slice(0, 10);
          if (finiSim !== finiProd) partes.push(`fecha inicio: ${finiProd || "—"} → ${finiSim || "—"}`);
          if (ffinSim !== ffinProd) partes.push(`fecha fin: ${ffinProd || "—"} → ${ffinSim || "—"}`);

          // Personas: altas, bajas y cambios de pct/fechas
          const prodPersonaMap = new Map((eProd.personas ?? []).map((p: any) => [p.id, p]));
          const simPersonaIds  = new Set((e.personas ?? []).map((p) => p.id));
          const prodPersonaIds = new Set((eProd.personas ?? []).map((p: any) => p.id));

          const agregadas = [...simPersonaIds].filter((pid) => !prodPersonaIds.has(pid)).length;
          const removidas = [...prodPersonaIds].filter((pid) => !simPersonaIds.has(pid)).length;
          if (agregadas > 0) partes.push(`${agregadas} persona${agregadas > 1 ? "s" : ""} agregada${agregadas > 1 ? "s" : ""}`);
          if (removidas > 0) partes.push(`${removidas} persona${removidas > 1 ? "s" : ""} removida${removidas > 1 ? "s" : ""}`);

          // Cambios de pct o fechas de asignación por persona
          (e.personas ?? []).forEach((pSim) => {
            const pProd = prodPersonaMap.get(pSim.id);
            if (!pProd) return; // ya contado como "agregada"
            const subPartes: string[] = [];
            if ((pSim.pct ?? 0) !== (pProd.pct ?? 0))
              subPartes.push(`dedicación ${pProd.pct}% → ${pSim.pct}%`);
            const asiIniSim  = (pSim.fecha_inicio ?? "").slice(0, 10);
            const asiIniProd = (pProd.fecha_inicio ?? "").slice(0, 10);
            const asiFinSim  = (pSim.fecha_fin    ?? "").slice(0, 10);
            const asiFinProd = (pProd.fecha_fin   ?? "").slice(0, 10);
            if (asiIniSim !== asiIniProd) subPartes.push(`inicio asignación de ${pSim.nombre}`);
            if (asiFinSim !== asiFinProd) subPartes.push(`fin asignación de ${pSim.nombre}`);
            if (subPartes.length > 0) partes.push(subPartes.join(", "));
          });

          if (partes.length > 0) {
            changes.push({
              etiqueta: "Modificado",
              descripcion: `"${e.nombre}"${e.cliente ? ` — ${e.cliente}` : ""}: ${partes.join(" · ")}`,
              color: "yellow",
            });
          }
        });

        setCambiosPendientes(changes);
      } finally {
        setCargandoCambios(false);
      }
    }
  }

  async function confirmarEliminarPlan() {
    if (!modalEliminar) return;
    const { id } = modalEliminar;
    setModalEliminar(null);
    setPlanes((prev) => prev.filter((p) => p.id !== id));
    if (planActivo === id) setPlanActivo(null);
    await eliminarPlanRemoto(id);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#fafafa]">

      {/* ── Galería de planes — barra compacta ────────────────── */}
      <div className="flex-shrink-0 bg-white border-b border-[#e8e8e8] px-4 py-1.5 flex items-center gap-3">
        {/* Título + contador */}
        <FlaskConical className="w-3.5 h-3.5 text-[#4a90e2] flex-shrink-0" />
        <span className="text-[11px] font-semibold text-[#1a1a2e] flex-shrink-0">Escenarios</span>
        <span className="text-[10px] text-[#aaa] flex-shrink-0">({planes.length})</span>

        {/* Tarjetas inline */}
        <div className="flex gap-2 overflow-x-auto flex-1 min-w-0">
          {loadingPlanes && (
            <span className="text-[11px] text-[#ccc] italic flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />Cargando...
            </span>
          )}
          {!loadingPlanes && planes.length === 0 && (
            <span className="text-[11px] text-[#ccc] italic">Sin escenarios.</span>
          )}
          {planes.map((p) => (
            <div
              key={p.id}
              onClick={() => abrirEscenarioConPull(p.id)}
              className={`flex-shrink-0 flex items-center gap-2 border rounded-lg px-2.5 py-1 cursor-pointer transition-all ${
                planActivo === p.id
                  ? "border-[#4a90e2] bg-blue-50"
                  : "border-[#e8e8e8] bg-white hover:border-[#4a90e2]/40"
              }`}>
              <span className="text-[11px] font-semibold text-[#1a1a2e] max-w-[120px] truncate">{p.nombre}</span>
              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${ESTADO_STYLE[p.estado]}`}>{p.estado}</span>
              {/* Cambio rápido de estado — "Aceptado" siempre abre el modal */}
              <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                {(["Borrador", "Aceptado", "Rechazado"] as const).map((est) => (
                  <button key={est}
                    onClick={() => {
                      if (est === "Aceptado") {
                        // Selecciona este plan y abre el modal de confirmación
                        setPlanActivo(p.id);
                        setErrorModal(null);
                        setModalAprobar(true);
                      } else {
                        cambiarEstado(p.id, est);
                      }
                    }}
                    className={`text-[8px] px-1 py-0.5 rounded border transition-colors ${
                      p.estado === est ? "border-current font-bold " + ESTADO_STYLE[est] : "border-[#e8e8e8] text-[#bbb] hover:text-[#4a90e2] hover:border-[#4a90e2]"
                    }`}>{est}</button>
                ))}
              </div>
              <button onClick={(e) => { e.stopPropagation(); eliminarPlan(p.id); }}
                title="Eliminar escenario"
                className="text-[#ccc] hover:text-red-400 transition-colors flex-shrink-0">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>

        {/* Botón crear */}
        <button onClick={() => setModalOpen(true)}
          className="flex-shrink-0 flex items-center gap-1 bg-[#1a1a2e] text-white text-[11px] font-semibold px-2.5 py-1 rounded-lg hover:bg-[#2d2d4a] transition-colors">
          <Plus className="w-3 h-3" />Crear
        </button>
      </div>

      {/* ── Barra de acciones del plan activo — compacta ── */}
      {plan && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-1 bg-amber-50 border-b border-amber-200">
          <FlaskConical className="w-3 h-3 text-amber-500 flex-shrink-0" />
          <span className="text-[11px] font-semibold text-[#1a1a2e] truncate max-w-[200px]">{plan.nombre}</span>
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${ESTADO_STYLE[plan.estado]}`}>{plan.estado}</span>
          <span className="text-[10px] text-amber-600 flex-shrink-0">🔒 Solo simulación</span>
          {sincronizando && (
            <span className="flex items-center gap-1 text-[10px] text-blue-600 flex-shrink-0">
              <Loader2 className="w-3 h-3 animate-spin" />Sincronizando con Tablero...
            </span>
          )}
          {toastSync && (
            <span className="flex items-center gap-1 text-[10px] text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-lg flex-shrink-0">
              ✓ Datos sincronizados correctamente
            </span>
          )}
          <div className="flex-1" />

          {/* Sincronizar con datos reales */}
          <button
            onClick={sincronizarConDatosReales}
            disabled={sincronizando}
            title="Actualiza el escenario con los datos reales actuales del Tablero"
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold border border-[#4a90e2] text-[#4a90e2] bg-white rounded-lg hover:bg-blue-50 disabled:opacity-50 transition-colors">
            {sincronizando ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Actualizar con data real
          </button>

          {/* Guardar */}
          <button onClick={guardarPlan} disabled={guardando}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-[#1a1a2e] text-white rounded-lg hover:bg-[#2d2d4a] disabled:opacity-50 transition-colors">
            {guardando ? <Loader2 className="w-3 h-3 animate-spin" /> : guardadoOk ? "✓ Guardado" : <><Save className="w-3 h-3" />Guardar</>}
          </button>

          {/* Aprobar — solo si está en Borrador o Rechazado */}
          {plan.estado !== "Aceptado" && (
            <button onClick={() => { setErrorModal(null); setModalAprobar(true); }}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              title="Publica este escenario y aplica sus asignaciones a la empresa">
              ✅ Aprobar escenario
            </button>
          )}

          {/* Deshacer aprobación — solo si está Aceptado y tiene snapshot previo */}
          {plan.estado === "Aceptado" && plan.tieneRealPrevia && (
            <button onClick={() => { setErrorModal(null); setModalDeshacer(true); }}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              title="Revierte las asignaciones reales al estado anterior a la aprobación">
              <RotateCcw className="w-3 h-3" />Deshacer Aprobación
            </button>
          )}
        </div>
      )}

      {/* ── Vista del plan activo: layout Inicio, datos aislados del snapshot ── */}
      {plan ? (
        <div className="flex-1 overflow-hidden">
          <SandboxInicioView
            key={plan.id}
            planId={plan.id}
            planNombre={plan.nombre}
            snapshot={plan.snapshot}
            onSnapshotChange={(engRows: any[]) => {
              // Convierte EngRow[] → EngSnap[] preservando reqs del estado local
              const nextSnapshot: EngSnap[] = engRows.map((eg) => ({
                id: eg.id,
                codigo: eg.codigo ?? null,
                nombre: eg.nombre,
                cliente: eg.cliente ?? null,
                tipo: eg.tipo ?? "proyecto",
                fecha_inicio: eg.fecha_inicio,
                fecha_fin: eg.fecha_fin ?? eg.fecha_inicio,
                personas: (eg.personas ?? []).map((p: any) => ({
                  id: p.id,
                  nombre: p.nombre,
                  apellido: p.apellido,
                  iniciales: p.iniciales ?? null,
                  cargo: p.cargo ?? "",
                  pct: p.pct ?? 100,
                  fecha_inicio: p.fecha_inicio,
                  fecha_fin: p.fecha_fin,
                })),
                reqs: (eg.reqs ?? []).map((r: any) => ({
                  id: r.id,
                  cargo_requerido: r.cargo_requerido ?? null,
                  pct_dedicacion: r.pct_dedicacion ?? 100,
                  fecha_inicio: r.fecha_inicio,
                  fecha_fin: r.fecha_fin ?? null,
                  fase_nombre: r.fase_nombre ?? null,
                })),
                // Preserva actividades (viajes/talleres) del engagement
                actividades: (eg.actividades ?? []).map((a: any) => ({
                  id: a.id,
                  tipo: a.tipo,
                  titulo: a.titulo ?? "",
                  fecha_inicio: a.fecha_inicio,
                  fecha_fin: a.fecha_fin,
                })),
              }));
              handleSnapshotChange(nextSnapshot);
            }}
          />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-[#ccc] text-[13px]">
          {planes.length > 0 ? "Selecciona un escenario para visualizarlo" : ""}
        </div>
      )}

      {/* ── Modal crear plan ────────────────────────────────── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-xl border border-[#e8e8e8] w-full max-w-sm mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[15px] font-bold text-[#1a1a2e]">Nuevo escenario de simulación</h3>
              <button onClick={() => setModalOpen(false)} className="text-[#aaa] hover:text-[#555]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <label className="block text-[11px] font-semibold text-[#888] uppercase tracking-wide mb-1">
              Nombre del escenario
            </label>
            <input
              type="text"
              autoFocus
              value={nombreInput}
              onChange={(e) => setNombreInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCrear()}
              placeholder="Ej: Escenario Q3 - Propuesta BHP"
              className="w-full border border-[#e0e0e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:border-[#4a90e2] mb-4"
            />
            <p className="text-[11px] text-[#aaa] mb-4">
              Se tomará una foto del estado actual de asignaciones. Los cambios aquí no afectarán los datos reales.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-[12px] text-[#888] hover:text-[#555] border border-[#e8e8e8] rounded-lg">
                Cancelar
              </button>
              <button onClick={handleCrear} disabled={cargando || !nombreInput.trim()}
                className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-semibold bg-[#4a90e2] text-white rounded-lg hover:bg-[#357abd] disabled:opacity-50 transition-colors">
                {cargando ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Cargando...</> : "Crear escenario"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Modal: Confirmar Aprobación ──────────────────────── */}
      <Modal
        open={modalAprobar}
        onClose={() => !aprobando && setModalAprobar(false)}
        title="¿Confirmar publicación del Plan?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalAprobar(false)} disabled={aprobando}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={ejecutarAprobacion} loading={aprobando}>
              {aprobando ? "Publicando..." : "Confirmar y Publicar"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-[13px] text-amber-800 leading-snug">
              Al confirmar, este escenario <strong>reemplazará de forma definitiva</strong> la
              data real de asignaciones de la empresa.
            </p>
          </div>
          <p className="text-[13px] text-[#555] leading-relaxed">
            Se guardará un <strong>respaldo automático</strong> del estado actual antes de aplicar
            los cambios, permitiendo revertir si es necesario.
          </p>
          <p className="text-[13px] text-[#555]">
            El Tablero principal (sidebar Inicio y Tablero) se actualizará automáticamente al
            completar la operación.
          </p>
          {plan && (
            <div className="p-2 bg-[#f8f8f8] rounded-lg">
              <p className="text-[11px] text-[#888]">Escenario a publicar:</p>
              <p className="text-[13px] font-bold text-[#1a1a2e]">{plan.nombre}</p>
              <p className="text-[11px] text-[#aaa]">{plan.snapshot.length} proyectos · {plan.snapshot.reduce((acc, e) => acc + e.personas.length, 0)} asignaciones simuladas</p>
            </div>
          )}
          {errorModal && (
            <p className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded p-2">{errorModal}</p>
          )}
        </div>
      </Modal>

      {/* ── Modal: Confirmar Deshacer Aprobación ─────────────── */}
      <Modal
        open={modalDeshacer}
        onClose={() => !deshaciendo && setModalDeshacer(false)}
        title="Deshacer Aprobación — Volver Atrás"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalDeshacer(false)} disabled={deshaciendo}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={ejecutarDeshacer} loading={deshaciendo}>
              {deshaciendo ? "Revirtiendo..." : "Confirmar Reversión"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
            <RotateCcw className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-[13px] text-red-800 leading-snug">
              Esto <strong>restaurará las asignaciones reales</strong> al estado exacto anterior
              a la aprobación de este escenario.
            </p>
          </div>
          <p className="text-[13px] text-[#555] leading-relaxed">
            Las asignaciones actuales (aplicadas por este plan) serán eliminadas y reemplazadas
            por el respaldo guardado automáticamente.
          </p>
          <p className="text-[13px] text-[#555]">
            El estado del escenario volverá a <strong>Borrador</strong> y podrás editarlo nuevamente.
          </p>
          {errorModal && (
            <p className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded p-2">{errorModal}</p>
          )}
        </div>
      </Modal>

      {/* ── Modal: Eliminar escenario Aceptado ──────────────────── */}
      <Modal
        open={modalEliminar?.tipo === "aceptado"}
        onClose={() => setModalEliminar(null)}
        title="Eliminar escenario"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalEliminar(null)}>Cancelar</Button>
            <Button variant="danger" onClick={confirmarEliminarPlan}>Confirmar Eliminación</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-[13px] text-blue-800 leading-snug">
              Este plan ya fue incorporado en la data real, por lo que eliminarlo de la simulación
              no alterará el tablero principal.
            </p>
          </div>
          <p className="text-[13px] text-[#555] leading-relaxed">
            Solo se borrará el registro del escenario <strong>"{modalEliminar?.nombre}"</strong>.
            Las asignaciones y datos reales quedan intactos.
          </p>
        </div>
      </Modal>

      {/* ── Modal: Eliminar escenario Borrador/Rechazado ─────────── */}
      <Modal
        open={modalEliminar?.tipo === "borrador"}
        onClose={() => setModalEliminar(null)}
        title="Eliminar escenario"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalEliminar(null)}>Cancelar</Button>
            <Button variant="danger" onClick={confirmarEliminarPlan}>Confirmar</Button>
          </>
        }
      >
        <div className="space-y-3">
          {/* Mensaje adaptado: si hay cambios pendientes → advertencia crítica; si no → aviso suave */}
          {cargandoCambios || cambiosPendientes.length > 0 ? (
            <>
              <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-[13px] text-red-800 leading-snug font-medium">
                  ¿Estás seguro de que quieres eliminar este escenario?
                </p>
              </div>
              <p className="text-[13px] text-[#555] leading-relaxed">
                Hay cambios de planificación en <strong>"{modalEliminar?.nombre}"</strong> que{" "}
                <strong>NO han sido incorporados</strong> dentro de la data real de la app.
                Este cambio es <strong>irreversible</strong>.
              </p>
            </>
          ) : (
            <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
              <p className="text-[13px] text-blue-800 leading-snug">
                Este escenario no tiene cambios pendientes por incorporar. Su data ya está reflejada
                en el tablero principal. Eliminarlo solo borrará el registro de planificación.
              </p>
            </div>
          )}

          {/* ── Cambios pendientes por incorporar — solo si hay algo que mostrar ── */}
          {(cargandoCambios || cambiosPendientes.length > 0) && (
          <div className="border border-[#e8e8e8] rounded-lg overflow-hidden">
            <div className="bg-[#f5f5f5] px-3 py-2 border-b border-[#e8e8e8]">
              <span className="text-[11px] font-semibold text-[#555] uppercase tracking-wide">
                Cambios que se perderán
              </span>
            </div>
            <div className="max-h-[200px] overflow-y-auto divide-y divide-[#f0f0f0]">
              {cargandoCambios && (
                <div className="flex items-center gap-2 px-3 py-3 text-[12px] text-[#999]">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Calculando cambios pendientes...
                </div>
              )}
              {!cargandoCambios && cambiosPendientes.length === 0 && (
                <p className="px-3 py-3 text-[12px] text-[#aaa] italic">
                  No se detectaron cambios respecto a la data real.
                </p>
              )}
              {!cargandoCambios && cambiosPendientes.map((c, i) => (
                <div key={i} className="flex items-start gap-2.5 px-3 py-2">
                  <span className={`mt-0.5 flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    c.color === "green"  ? "bg-green-100 text-green-700" :
                    c.color === "red"   ? "bg-red-100 text-red-700"     :
                                          "bg-yellow-100 text-yellow-700"
                  }`}>
                    {c.etiqueta}
                  </span>
                  <span className="text-[12px] text-[#444] leading-snug">{c.descripcion}</span>
                </div>
              ))}
            </div>
          </div>
          )}
        </div>
      </Modal>

      {/* ── Banner de éxito flotante ──────────────────────────── */}
      {exitoMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] max-w-lg w-full px-4">
          <div className="flex items-start gap-3 bg-green-50 border border-green-300 text-green-900 rounded-xl shadow-lg px-4 py-3 text-[13px]">
            <span className="text-green-500 text-base leading-none mt-0.5">✅</span>
            <span className="flex-1">{exitoMsg}</span>
            <button onClick={() => setExitoMsg(null)} className="text-green-400 hover:text-green-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

