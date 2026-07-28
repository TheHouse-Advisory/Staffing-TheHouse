"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { format, startOfISOWeek, addWeeks, addDays } from "date-fns";
import { es } from "date-fns/locale";
import { createAnyClient } from "@/lib/supabase/client";
import { getIniciales } from "@/lib/utils/iniciales";

interface EngRow {
  id: string;
  nombre: string;
}

interface ReqRow {
  engagement_id: string;
  fecha_inicio: string;
  fecha_fin: string;
}

interface AsigRow {
  engagement_id: string;
  iniciales: string;
  estado_staffing: "CONFIRMADO" | "PLAN";
  fecha_inicio: string;
  fecha_fin: string | null;
}

interface Semana {
  label: string;
  inicio: string;
  fin: string;
}

const N_SEMANAS = 4;
const N_PROYECTOS = 4;

function solapan(aInicio: string, aFin: string | null, bInicio: string, bFin: string): boolean {
  return aInicio <= bFin && (aFin ?? "9999-12-31") >= bInicio;
}

function generarSemanas(): Semana[] {
  const lunesBase = startOfISOWeek(new Date());
  return Array.from({ length: N_SEMANAS }, (_, i) => {
    const lunes = addWeeks(lunesBase, i);
    const viernes = addDays(lunes, 4);
    return {
      label: format(lunes, "d/MM", { locale: es }),
      inicio: format(lunes, "yyyy-MM-dd"),
      fin: format(viernes, "yyyy-MM-dd"),
    };
  });
}

/** Miniatura en vivo del Resumen de Proyectos (tarjeta de Reportes). Solo lectura. */
export function ResumenProyectosPreview() {
  const [engs, setEngs] = useState<EngRow[]>([]);
  const [reqs, setReqs] = useState<ReqRow[]>([]);
  const [asigs, setAsigs] = useState<AsigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const semanas = generarSemanas();

  useEffect(() => {
    async function load() {
      const sb = createAnyClient();
      const rangoInicio = semanas[0].inicio;
      const rangoFin = semanas[semanas.length - 1].fin;

      const { data: engData } = await sb
        .from("engagement")
        .select("id, nombre")
        .eq("estado", "activo")
        .eq("is_deleted", false)
        .eq("tipo", "proyecto")
        .order("sort_order")
        .limit(N_PROYECTOS);

      const rows: EngRow[] = (engData ?? []).map((e: any) => ({ id: e.id, nombre: e.nombre }));
      setEngs(rows);
      if (rows.length === 0) { setLoading(false); return; }
      const engIds = rows.map((e) => e.id);

      const [{ data: reqData }, { data: asigData }] = await Promise.all([
        sb
          .from("requerimiento_engagement")
          .select("engagement_id, cargo_requerido, fecha_inicio, fecha_fin")
          .in("engagement_id", engIds)
          .lte("fecha_inicio", rangoFin)
          .gte("fecha_fin", rangoInicio),
        sb
          .from("asignacion")
          .select("engagement_id, fecha_inicio, fecha_fin, estado_staffing, persona:persona_id(nombre, apellido, iniciales)")
          .in("engagement_id", engIds)
          .eq("estado", "activa")
          .lte("fecha_inicio", rangoFin)
          .or(`fecha_fin.gte.${rangoInicio},fecha_fin.is.null`),
      ]);

      setReqs(
        (reqData ?? [])
          .filter((r: any) => r.cargo_requerido)
          .map((r: any) => ({ engagement_id: r.engagement_id, fecha_inicio: r.fecha_inicio, fecha_fin: r.fecha_fin }))
      );
      setAsigs(
        (asigData ?? []).map((a: any) => ({
          engagement_id: a.engagement_id,
          iniciales: a.persona ? getIniciales(a.persona.nombre ?? "?", a.persona.apellido ?? "?", a.persona.iniciales) : "??",
          estado_staffing: a.estado_staffing ?? "CONFIRMADO",
          fecha_inicio: a.fecha_inicio,
          fecha_fin: a.fecha_fin ?? null,
        }))
      );
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-slate-300" />
      </div>
    );
  }

  if (engs.length === 0) {
    return <p className="text-[11px] text-slate-300 font-medium">Sin proyectos activos</p>;
  }

  return (
    <div className="w-full h-full overflow-hidden px-2.5 pt-2 pb-1.5 flex flex-col">
      <table className="text-[9px] border-collapse w-full table-fixed flex-1">
        <colgroup>
          <col style={{ width: "42%" }} />
          {semanas.map((s) => (
            <col key={s.inicio} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="text-left font-bold text-slate-400 pb-1 pr-1 truncate">Proyecto</th>
            {semanas.map((s) => (
              <th key={s.inicio} className="font-bold text-slate-400 pb-1 text-center truncate">{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {engs.map((eng) => {
            const reqsEng = reqs.filter((r) => r.engagement_id === eng.id);
            const asigsEng = asigs.filter((a) => a.engagement_id === eng.id);
            return (
              <tr key={eng.id} className="border-t border-slate-100">
                <td className="py-1 pr-1 font-semibold text-[#1a1a2e] truncate overflow-hidden whitespace-nowrap">{eng.nombre}</td>
                {semanas.map((s) => {
                  const activo = reqsEng.some((r) => solapan(r.fecha_inicio, r.fecha_fin, s.inicio, s.fin));
                  if (!activo) {
                    return (
                      <td key={s.inicio} className="py-1 text-center">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-100" />
                      </td>
                    );
                  }

                  const asigsSemana = asigsEng.filter((a) => solapan(a.fecha_inicio, a.fecha_fin, s.inicio, s.fin));
                  const hayConf = asigsSemana.some((a) => a.estado_staffing === "CONFIRMADO");
                  const hayPlan = asigsSemana.some((a) => a.estado_staffing === "PLAN");
                  const color = hayConf ? "bg-emerald-500" : hayPlan ? "bg-amber-400" : "bg-red-400";

                  return (
                    <td key={s.inicio} className="py-1 text-center">
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${color}`} />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
