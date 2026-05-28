"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format, startOfISOWeek, addWeeks, addDays } from "date-fns";
import { es } from "date-fns/locale";
import { ArrowLeft, BarChart2, Loader2 } from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";
import { CARGOS } from "@/lib/constants";

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
  engagement_id: string;
  cargo: string;        // cargo_requerido
  fecha_inicio: string;
  fecha_fin: string;
}

interface AsigRow {
  engagement_id: string;
  cargo: string;        // cargo_al_momento
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

function iniciales(nombre: string, apellido: string): string {
  return (nombre.charAt(0) + apellido.charAt(0)).toUpperCase();
}

function solapan(
  aInicio: string, aFin: string | null,
  bInicio: string, bFin: string
): boolean {
  const aF = aFin ?? "9999-12-31"; // asignación abierta → siempre activa
  return aInicio <= bFin && aF >= bInicio;
}

/** Genera N semanas a partir del lunes actual */
function generarSemanas(n = 12): Semana[] {
  const hoy = new Date();
  const lunesBase = startOfISOWeek(hoy);
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

interface LineaCelda {
  cargo: string;
  textoConfirmado: string;  // "FT + ER"
  textoPlan: string;        // "GB/AJ"
  vacio: boolean;           // sin nadie → "?"
}

function buildLineas(
  engId: string,
  semana: Semana,
  reqs: ReqRow[],
  asigs: AsigRow[]
): LineaCelda[] {
  // 1. Requerimientos activos en esta semana para este engagement
  const reqsActivos = reqs.filter(
    (r) => r.engagement_id === engId && solapan(r.fecha_inicio, r.fecha_fin, semana.inicio, semana.fin)
  );
  if (reqsActivos.length === 0) return [];

  // 2. Asignaciones activas en esta semana para este engagement
  const asigsSemana = asigs.filter(
    (a) => a.engagement_id === engId && solapan(a.fecha_inicio, a.fecha_fin, semana.inicio, semana.fin)
  );

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

    const confirmados = asigsCargo.filter((a) => a.estado_staffing === "CONFIRMADO");
    const plan       = asigsCargo.filter((a) => a.estado_staffing === "PLAN");

    return {
      cargo,
      textoConfirmado: confirmados.map((a) => a.iniciales).join(" + "),
      textoPlan:       plan.map((a) => a.iniciales).join("/"),
      vacio:           confirmados.length === 0 && plan.length === 0,
    };
  });
}

// ─────────────────────────────────────────────────────────────
//  Componente celda
// ─────────────────────────────────────────────────────────────

function Celda({ lineas }: { lineas: LineaCelda[] }) {
  if (lineas.length === 0) return <td className="border border-[#e8e8e8] px-2 py-1 bg-white" />;
  return (
    <td className="border border-[#e8e8e8] px-2 py-1 bg-[#fef9f0] align-top min-w-[90px]">
      {lineas.map((l, i) => (
        <div key={i} className="text-[11px] leading-4 whitespace-nowrap">
          {/* Plan (propuesto) — en gris */}
          {l.textoPlan && (
            <span className="text-[#888]">{l.textoPlan}</span>
          )}
          {/* Separador si hay ambos */}
          {l.textoPlan && l.textoConfirmado && <span className="text-[#ccc] mx-0.5">·</span>}
          {/* Confirmado — en negro */}
          {l.textoConfirmado && (
            <span className="font-semibold text-[#1a1a1a]">{l.textoConfirmado}</span>
          )}
          {/* Vacío → ? rojo */}
          {l.vacio && (
            <span className="font-bold text-red-500">?</span>
          )}
        </div>
      ))}
    </td>
  );
}

// ─────────────────────────────────────────────────────────────
//  Tabla reutilizable
// ─────────────────────────────────────────────────────────────

function TablaCobertura({
  titulo, engs, semanas, reqs, asigs,
}: {
  titulo: string;
  engs: EngRow[];
  semanas: Semana[];
  reqs: ReqRow[];
  asigs: AsigRow[];
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
                {semanas.map((s) => (
                  <th key={s.inicio} className="border border-[#e8e8e8] px-2 py-2 text-center font-bold text-[11px] text-[#555] min-w-[90px] whitespace-nowrap">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {engs.map((eng) => {
                const lineasPorSemana = semanas.map((s) => buildLineas(eng.id, s, reqs, asigs));
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
                    {lineasPorSemana.map((lineas, i) => (
                      <Celda key={i} lineas={lineas} />
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

export default function ResumenProyectosPage() {
  const [engs, setEngs]   = useState<EngRow[]>([]);
  const [reqs, setReqs]   = useState<ReqRow[]>([]);
  const [asigs, setAsigs] = useState<AsigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const semanas = generarSemanas(12);
  const rangoInicio = semanas[0].inicio;
  const rangoFin    = semanas[semanas.length - 1].fin;

  useEffect(() => {
    async function load() {
      setLoading(true);
      const sb = createAnyClient();

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
        .select("engagement_id, cargo_requerido, fecha_inicio, fecha_fin")
        .in("engagement_id", engIds)
        .lte("fecha_inicio", rangoFin)
        .gte("fecha_fin", rangoInicio);

      setReqs(
        (reqData ?? [])
          .filter((r: any) => r.cargo_requerido)
          .map((r: any) => ({
            engagement_id: r.engagement_id,
            cargo: r.cargo_requerido,
            fecha_inicio: r.fecha_inicio,
            fecha_fin: r.fecha_fin,
          }))
      );

      // 3. Asignaciones activas en el rango con datos de persona
      const { data: asigData } = await sb
        .from("asignacion")
        .select("engagement_id, cargo_al_momento, fecha_inicio, fecha_fin, estado_staffing, persona:persona_id(nombre, apellido)")
        .in("engagement_id", engIds)
        .eq("estado", "activa")
        .lte("fecha_inicio", rangoFin)
        .or(`fecha_fin.gte.${rangoInicio},fecha_fin.is.null`);

      setAsigs(
        (asigData ?? []).map((a: any) => ({
          engagement_id: a.engagement_id,
          cargo: a.cargo_al_momento ?? "",
          iniciales: a.persona ? iniciales(a.persona.nombre ?? "?", a.persona.apellido ?? "?") : "??",
          estado_staffing: a.estado_staffing ?? "CONFIRMADO",
          fecha_inicio: a.fecha_inicio,
          fecha_fin: a.fecha_fin ?? null,
        }))
      );

      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ── */}
      <header className="h-14 bg-white border-b border-[#e8e8e8] flex items-center px-6 gap-3 flex-shrink-0">
        <Link href="/reportes" className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <BarChart2 className="w-4 h-4 text-[#4a90e2]" />
        <h1 className="text-[16px] font-bold flex-1 text-[#1a1a2e]">Resumen de Proyectos</h1>
        {!loading && (
          <span className="text-[11px] text-gray-400">{engs.length} proyectos activos</span>
        )}
      </header>

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
              </div>

              <TablaCobertura titulo="Proyectos Activos"       engs={proyectos}  semanas={semanas} reqs={reqs} asigs={asigs} />
              <TablaCobertura titulo="Propuestas Comerciales"  engs={propuestas} semanas={semanas} reqs={reqs} asigs={asigs} />

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
