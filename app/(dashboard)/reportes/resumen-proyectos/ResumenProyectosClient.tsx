"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { format, startOfISOWeek, addWeeks, subWeeks, addDays, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { ArrowLeft, BarChart2, Loader2, FileSpreadsheet } from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";
import { CARGOS } from "@/lib/constants";
import { NavegadorFechas } from "@/components/ui/NavegadorFechas";
import { getIniciales } from "@/lib/utils/iniciales";
import { actualizarAsignacionSemana } from "@/lib/queries/engagements";
import {
  CeldaAsignacionEditable,
  type LineaEditable,
  type AsigSlot,
  type PersonaOpcion,
  type ActualizarLineaParams,
} from "@/components/reportes/CeldaAsignacionEditable";

// ─────────────────────────────────────────────────────────────
//  Tipos internos
// ─────────────────────────────────────────────────────────────

interface EngRow {
  id: string;
  codigo: string | null;
  nombre: string;
  cliente: string;
  tipo: string;
  sort_order: number | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
}

interface ReqRow {
  id: string;
  engagement_id: string;
  cargo: string;        // cargo_requerido
  fecha_inicio: string;
  fecha_fin: string;
  pct_dedicacion: number;
}

interface AsigRow {
  id: string;
  engagement_id: string;
  persona_id: string;
  requerimiento_id: string | null;
  cargo: string;        // cargo_al_momento
  pct_dedicacion: number;
  iniciales: string;
  estado_staffing: "CONFIRMADO" | "PLAN";
  fecha_inicio: string;
  fecha_fin: string | null;
}

interface Semana {
  label: string;        // "25/05 a 29/05"
  inicio: string;       // "yyyy-MM-dd" (lunes)
  fin: string;          // "yyyy-MM-dd" (viernes)
}

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

function solapan(
  aInicio: string, aFin: string | null,
  bInicio: string, bFin: string
): boolean {
  const aF = aFin ?? "9999-12-31"; // asignación abierta → siempre activa
  return aInicio <= bFin && aF >= bInicio;
}

/** Genera N semanas a partir del lunes de `base` (por defecto: hoy) */
function generarSemanas(n = 12, base: Date = new Date()): Semana[] {
  const lunesBase = startOfISOWeek(base);
  return Array.from({ length: n }, (_, i) => {
    const lunes = addWeeks(lunesBase, i);
    const viernes = addDays(lunes, 4);
    return {
      label: `${format(lunes, "d/MM", { locale: es })} a ${format(viernes, "d/MM", { locale: es })}`,
      inicio: format(lunes, "yyyy-MM-dd"),
      fin: format(viernes, "yyyy-MM-dd"),
    };
  });
}

// ─────────────────────────────────────────────────────────────
//  Renderizado de una celda (engagement × semana)
// ─────────────────────────────────────────────────────────────

function buildLineas(
  eng: EngRow,
  semana: Semana,
  reqs: ReqRow[],
  asigs: AsigRow[]
): LineaEditable[] {
  const engId = eng.id;

  // 1. Requerimientos activos en esta semana para este engagement
  const reqsActivos = reqs.filter(
    (r) => r.engagement_id === engId && solapan(r.fecha_inicio, r.fecha_fin, semana.inicio, semana.fin)
  );

  // 2. Asignaciones activas en esta semana para este engagement
  const asigsSemana = asigs.filter(
    (a) => a.engagement_id === engId && solapan(a.fecha_inicio, a.fecha_fin, semana.inicio, semana.fin)
  );

  const toSlot = (a: AsigRow): AsigSlot => ({
    id: a.id,
    engagementId: a.engagement_id,
    personaId: a.persona_id,
    iniciales: a.iniciales,
    cargo: a.cargo,
    requerimientoId: a.requerimiento_id,
    pctDedicacion: a.pct_dedicacion,
    estadoStaffing: a.estado_staffing,
    fechaInicio: a.fecha_inicio,
    fechaFin: a.fecha_fin,
  });

  // Sin requerimiento formal esa semana: si el proyecto sigue vigente, deja
  // igual una línea editable (sin cargo asociado) para poder asignar ad-hoc.
  if (reqsActivos.length === 0) {
    const engVigente = solapan(eng.fecha_inicio ?? "0001-01-01", eng.fecha_fin, semana.inicio, semana.fin);
    if (!engVigente) return [];

    const confirmados = asigsSemana.filter((a) => a.estado_staffing === "CONFIRMADO").map(toSlot);
    const plan       = asigsSemana.filter((a) => a.estado_staffing === "PLAN").map(toSlot);

    return [{
      engagementId: engId,
      cargo: "",
      requerimientoId: null,
      pctDedicacion: 100,
      confirmados,
      plan,
      vacio: confirmados.length === 0 && plan.length === 0,
    }];
  }

  // 3. Cargos únicos con req, en orden de jerarquía CARGOS
  const cargosConReq = [...new Set(reqsActivos.map((r) => r.cargo))];
  const cargosOrdenados = [
    ...CARGOS.filter((c) => cargosConReq.includes(c)),
    ...cargosConReq.filter((c) => !(CARGOS as readonly string[]).includes(c)),
  ];

  return cargosOrdenados.map((cargo) => {
    const asigsCargo = asigsSemana.filter((a) => {
      // Normalizar: Director de Proyectos ↔ Gerente de Proyectos ambos cuentan para el mismo req
      const esDG = ["Director de Proyectos", "Gerente de Proyectos"].includes(a.cargo);
      const reqEsDG = ["Director de Proyectos", "Gerente de Proyectos"].includes(cargo);
      const esACS = ["Asociado", "Consultor Senior"].includes(a.cargo);
      const reqEsACS = ["Asociado", "Consultor Senior"].includes(cargo);
      if (esDG && reqEsDG) return true;
      if (esACS && reqEsACS) return true;
      return a.cargo === cargo;
    });

    const confirmados = asigsCargo.filter((a) => a.estado_staffing === "CONFIRMADO").map(toSlot);
    const plan       = asigsCargo.filter((a) => a.estado_staffing === "PLAN").map(toSlot);
    const reqMatch   = reqsActivos.find((r) => r.cargo === cargo);

    return {
      engagementId: engId,
      cargo,
      requerimientoId: reqMatch?.id ?? null,
      pctDedicacion: reqMatch?.pct_dedicacion ?? 100,
      confirmados,
      plan,
      vacio: confirmados.length === 0 && plan.length === 0,
    };
  });
}

// ─────────────────────────────────────────────────────────────
//  Tabla reutilizable
// ─────────────────────────────────────────────────────────────

function TablaCobertura({
  titulo, engs, semanas, reqs, asigs, personasDisponibles, onActualizar,
}: {
  titulo: string;
  engs: EngRow[];
  semanas: Semana[];
  reqs: ReqRow[];
  asigs: AsigRow[];
  personasDisponibles: PersonaOpcion[];
  onActualizar: (params: ActualizarLineaParams) => Promise<void>;
}) {
  if (engs.length === 0) return null;
  return (
    <div className="mb-8">
      <h2 className="text-[13px] font-bold text-[#1a1a2e] mb-3 flex items-center gap-2">
        <span className="w-1.5 h-4 rounded-full bg-[#4a90e2] inline-block" />
        {titulo}
        <span className="text-[11px] font-normal text-[#aaa]">{engs.length} proyectos</span>
      </h2>
      <div className="bg-white rounded-xl border border-[#e8e8e8] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="text-sm border-collapse w-full">
            <thead>
              <tr className="bg-[#f9f9f9] border-b border-[#e8e8e8]">
                <th className="border border-[#e8e8e8] px-3 py-2 text-left font-bold text-[11px] text-[#555] sticky left-0 bg-[#f9f9f9] z-10 min-w-[200px]">Proyecto</th>
                <th className="border border-[#e8e8e8] px-3 py-2 text-left font-bold text-[11px] text-[#555] min-w-[80px]">Inicio</th>
                <th className="border border-[#e8e8e8] px-3 py-2 text-left font-bold text-[11px] text-[#555] min-w-[80px]">Fin</th>
                {semanas.map((s) => (
                  <th key={s.inicio} className="border border-[#e8e8e8] px-2 py-2 text-center font-bold text-[11px] text-[#555] min-w-[90px] whitespace-nowrap">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {engs.map((eng) => {
                return (
                  <tr key={eng.id} className="border-b border-[#f5f5f5] hover:bg-[#fafafa]">
                    <td className="border border-[#e8e8e8] px-3 py-2 sticky left-0 bg-white z-10 align-top">
                      <p className="font-semibold text-[12px] text-[#1a1a1a] leading-tight">
                        {eng.codigo ? `${eng.codigo}: ` : ""}{eng.nombre}
                      </p>
                      <p className="text-[10px] text-[#888] mt-0.5">{eng.cliente}</p>
                    </td>
                    <td className="border border-[#e8e8e8] px-3 py-2 text-[11px] text-[#888] whitespace-nowrap align-top">
                      {eng.fecha_inicio
                        ? format(new Date(eng.fecha_inicio + "T00:00:00"), "d MMM yyyy", { locale: es })
                        : "—"}
                    </td>
                    <td className="border border-[#e8e8e8] px-3 py-2 text-[11px] text-[#888] whitespace-nowrap align-top">
                      {eng.fecha_fin
                        ? format(new Date(eng.fecha_fin + "T00:00:00"), "d MMM yyyy", { locale: es })
                        : "—"}
                    </td>
                    {semanas.map((s, i) => (
                      <CeldaAsignacionEditable
                        key={i}
                        semana={s}
                        lineas={buildLineas(eng, s, reqs, asigs)}
                        personasDisponibles={personasDisponibles}
                        onActualizar={onActualizar}
                      />
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Página principal
// ─────────────────────────────────────────────────────────────

export function ResumenProyectosClient() {
  const [engs, setEngs]   = useState<EngRow[]>([]);
  const [reqs, setReqs]   = useState<ReqRow[]>([]);
  const [asigs, setAsigs] = useState<AsigRow[]>([]);
  const [personas, setPersonas] = useState<PersonaOpcion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [errorExcel, setErrorExcel]       = useState<string | null>(null);
  const [baseFecha, setBaseFecha] = useState(() => startOfISOWeek(new Date()));
  const [actorNombre, setActorNombre] = useState("Usuario");
  const [ultimoCambio, setUltimoCambio] = useState<{ actor: string; fecha: string } | null>(null);

  const semanas = generarSemanas(12, baseFecha);
  const rangoInicio = semanas[0].inicio;
  const rangoFin    = semanas[semanas.length - 1].fin;

  const cargarUltimoCambio = useCallback(async () => {
    const sb = createAnyClient();
    const { data } = await sb
      .from("resumen_proyectos_log")
      .select("actor_nombre, creado_en")
      .order("creado_en", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) setUltimoCambio({ actor: data.actor_nombre, fecha: data.creado_en });
  }, []);

  useEffect(() => {
    async function cargarActor() {
      const sb = createAnyClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const { data } = await sb.from("persona").select("nombre, apellido").eq("auth_user_id", user.id).single();
      if (data) setActorNombre(`${data.nombre} ${data.apellido}`);
    }
    cargarActor();
    cargarUltimoCambio();
  }, [cargarUltimoCambio]);

  const load = useCallback(async () => {
    setLoading(true);
    const sb = createAnyClient();

    // 0. Personas activas (para el autocompletado de asignación)
    const { data: personaData } = await sb
      .from("persona")
      .select("id, nombre, apellido, iniciales")
      .eq("activo", true)
      .order("nombre");
    setPersonas(
      (personaData ?? []).map((p: any) => ({
        id: p.id,
        nombre: p.nombre,
        apellido: p.apellido,
        iniciales: getIniciales(p.nombre, p.apellido, p.iniciales),
      }))
    );

    // 1. Engagements activos que solapan el rango de 12 semanas
    const { data: engData, error: engErr } = await sb
      .from("engagement")
      .select("id, codigo, nombre, cliente, tipo, sort_order, fecha_inicio, fecha_fin_estimada, fecha_fin_real")
      .eq("estado", "activo")
      .eq("is_deleted", false)
      .neq("tipo", "ayuda_interna")
      .or(`fecha_fin_real.gte.${rangoInicio},fecha_fin_estimada.gte.${rangoInicio},fecha_fin_real.is.null,fecha_inicio.gte.${rangoInicio}`)
      .order("nombre");

    if (engErr) { setError(engErr.message); setLoading(false); return; }

    const rows: EngRow[] = (engData ?? []).map((e: any) => ({
      id: e.id, codigo: e.codigo ?? null, nombre: e.nombre,
      cliente: e.cliente,
      tipo: e.tipo ?? "",
      sort_order: e.sort_order ?? null,
      fecha_inicio: e.fecha_inicio ?? null,
      fecha_fin: e.fecha_fin_real ?? e.fecha_fin_estimada ?? null,
    }));
    setEngs(rows);

    if (rows.length === 0) { setLoading(false); return; }
    const engIds = rows.map((e) => e.id);

    // 2. Requerimientos que solapan el rango
    const { data: reqData } = await sb
      .from("requerimiento_engagement")
      .select("id, engagement_id, cargo_requerido, fecha_inicio, fecha_fin, pct_dedicacion")
      .in("engagement_id", engIds)
      .lte("fecha_inicio", rangoFin)
      .gte("fecha_fin", rangoInicio);

    setReqs(
      (reqData ?? [])
        .filter((r: any) => r.cargo_requerido)
        .map((r: any) => ({
          id: r.id,
          engagement_id: r.engagement_id,
          cargo: r.cargo_requerido,
          fecha_inicio: r.fecha_inicio,
          fecha_fin: r.fecha_fin,
          pct_dedicacion: Number(r.pct_dedicacion ?? 100),
        }))
    );

    // 3. Asignaciones activas en el rango con datos de persona
    const { data: asigData } = await sb
      .from("asignacion")
      .select("id, engagement_id, persona_id, requerimiento_id, cargo_al_momento, pct_dedicacion, fecha_inicio, fecha_fin, estado_staffing, persona:persona_id(nombre, apellido, iniciales)")
      .in("engagement_id", engIds)
      .eq("estado", "activa")
      .lte("fecha_inicio", rangoFin)
      .or(`fecha_fin.gte.${rangoInicio},fecha_fin.is.null`);

    setAsigs(
      (asigData ?? []).map((a: any) => ({
        id: a.id,
        engagement_id: a.engagement_id,
        persona_id: a.persona_id,
        requerimiento_id: a.requerimiento_id ?? null,
        cargo: a.cargo_al_momento ?? "",
        pct_dedicacion: Number(a.pct_dedicacion ?? 100),
        iniciales: a.persona ? getIniciales(a.persona.nombre ?? "?", a.persona.apellido ?? "?", a.persona.iniciales) : "??",
        estado_staffing: a.estado_staffing ?? "CONFIRMADO",
        fecha_inicio: a.fecha_inicio,
        fecha_fin: a.fecha_fin ?? null,
      }))
    );

    setLoading(false);
  }, [rangoInicio, rangoFin]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime: si otro usuario edita asignaciones mientras esta vista está
  // abierta, refresca automáticamente sin esperar a que alguien recargue.
  useEffect(() => {
    const sb = createAnyClient();
    const channel = sb
      .channel("resumen-proyectos-asignacion")
      .on("postgres_changes", { event: "*", schema: "public", table: "asignacion" }, () => {
        load();
        cargarUltimoCambio();
      })
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }, [load, cargarUltimoCambio]);

  async function handleActualizar(params: ActualizarLineaParams) {
    const sb = createAnyClient();
    const { error } = await actualizarAsignacionSemana(sb, { ...params, actorNombre });
    if (error) { setError(error); return; }
    await load();
    await cargarUltimoCambio();
  }

  async function descargarExcel() {
    setSincronizando(true);
    setErrorExcel(null);
    try {
      const res = await fetch("/api/reportes/resumen-proyectos-excel", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Error ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Resumen-Proyectos-Staffing.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErrorExcel(e instanceof Error ? e.message : "Error al sincronizar el Excel");
    } finally {
      setSincronizando(false);
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ── */}
      <header className="h-14 bg-white border-b border-[#e8e8e8] flex items-center px-6 gap-3 flex-shrink-0">
        <Link href="/reportes" className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <BarChart2 className="w-4 h-4 text-[#4a90e2]" />
        <h1 className="text-[16px] font-bold text-[#1a1a2e]">Resumen de Proyectos</h1>
        <NavegadorFechas
          label={`${format(new Date(semanas[0].inicio + "T00:00:00"), "d MMM", { locale: es })} – ${format(new Date(semanas[semanas.length - 1].fin + "T00:00:00"), "d MMM yyyy", { locale: es })}`}
          onPrev={() => setBaseFecha((b) => subWeeks(b, 4))}
          onNext={() => setBaseFecha((b) => addWeeks(b, 4))}
          onPrevWeek={() => setBaseFecha((b) => subWeeks(b, 1))}
          onNextWeek={() => setBaseFecha((b) => addWeeks(b, 1))}
          onHoy={() => setBaseFecha(startOfISOWeek(new Date()))}
          onSeleccionarFecha={(fecha) => setBaseFecha(startOfISOWeek(fecha))}
          compact
        />
        <div className="flex-1" />
        {!loading && (
          <div className="flex flex-col items-end leading-tight">
            <span className="text-[11px] text-gray-400">{engs.length} proyectos activos</span>
            {ultimoCambio && (
              <span className="text-[10px] text-gray-300" title={new Date(ultimoCambio.fecha).toLocaleString("es-CL")}>
                Último cambio por {ultimoCambio.actor} · {formatDistanceToNow(new Date(ultimoCambio.fecha), { addSuffix: true, locale: es })}
              </span>
            )}
          </div>
        )}
        <button
          onClick={descargarExcel}
          disabled={sincronizando}
          className="flex items-center gap-1.5 text-[12px] font-semibold text-white bg-[#1a7f4a] hover:bg-[#15693c] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg px-3 py-1.5 transition-colors"
        >
          {sincronizando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
          {sincronizando ? "Sincronizando..." : "Descargar Excel"}
        </button>
      </header>
      {errorExcel && (
        <div className="px-6 py-2 text-[12px] text-red-600 bg-red-50 border-b border-red-100 flex-shrink-0">
          Error al descargar: {errorExcel}
        </div>
      )}

      {/* ── Contenido ── */}
      <div className="flex-1 overflow-auto p-6">
        {loading && (
          <div className="flex items-center justify-center h-48 gap-2 text-[#888]">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Cargando resumen...</span>
          </div>
        )}
        {error && (
          <div className="text-sm text-red-500 p-4">Error: {error}</div>
        )}

        {!loading && !error && (() => {
          const byOrder = (a: EngRow, b: EngRow) =>
            (a.sort_order ?? 9999) - (b.sort_order ?? 9999);
          const proyectos  = engs.filter((e) => e.tipo === "proyecto").sort(byOrder);
          const propuestas = engs.filter((e) => e.tipo === "propuesta").sort(byOrder);
          return (
            <>
              {/* Leyenda */}
              <div className="flex items-center gap-4 mb-5 text-[11px] text-[#888]">
                <span><span className="font-semibold text-[#1a1a1a]">X + Y</span> = Confirmados</span>
                <span><span className="text-[#888]">X/Y</span> = Propuestos</span>
                <span><span className="font-bold text-red-500">?</span> = Sin asignar</span>
                <span className="text-[#bbb]">· Clic en una línea para editar (formato: PROP/PROP · CONF + CONF)</span>
              </div>

              <TablaCobertura
                titulo="Proyectos Activos" engs={proyectos} semanas={semanas} reqs={reqs} asigs={asigs}
                personasDisponibles={personas} onActualizar={handleActualizar}
              />
              <TablaCobertura
                titulo="Propuestas Comerciales" engs={propuestas} semanas={semanas} reqs={reqs} asigs={asigs}
                personasDisponibles={personas} onActualizar={handleActualizar}
              />

              {proyectos.length === 0 && propuestas.length === 0 && (
                <p className="text-sm text-[#aaa] text-center py-10">No hay proyectos activos en este período.</p>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}
