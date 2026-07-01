"use client";

import { useEffect, useState, useMemo } from "react";
import { Search } from "lucide-react";
import { addDays, addMonths, format, isWeekend, startOfMonth, startOfISOWeek } from "date-fns";
import { es } from "date-fns/locale";
import { createAnyClient } from "@/lib/supabase/client";
import { CARGOS, CARGO_COLORS, CARGO_COLOR_DEFAULT } from "@/lib/constants";
import { expandirRango, COLOR_AUSENCIA } from "@/lib/queries/ausencias";

// Iniciales de los días hábiles para la vista micro-semanal
const DIAS_SEMANA = ['L', 'M', 'X', 'J', 'V'];

// Suma n días a un string "YYYY-MM-DD"
function addDayStr(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

const JERARQUIA: Record<string, number> = {
  "Socio": 1, "Director de Proyectos": 2, "Director": 2,
  "Gerente de Proyectos": 3, "Gerente": 3, "Asociado": 4,
  "Consultor Senior": 5, "Consultor de Proyectos": 6, "Consultor Proyecto": 6,
  "Consultor": 6, "Consultor Analista": 7, "Analista Senior": 7,
  "Consultor Trainee": 8, "Analista": 8, "Practicante": 9,
};

interface PersonaFila {
  id: string;
  nombre: string;
  apellido: string;
  cargo: string;
  proyectos: { id: string; nombre: string; cliente: string; inicio: string; fin: string; pct: number }[];
  ausencias: { inicio: string; fin: string; tipo: string }[];
}

interface Columna {
  label: string;
  sublabel: string;
  inicioStr: string;
  finStr: string;
}

interface SimEngSnap {
  id: string; nombre: string; codigo?: string | null; cliente: string | null;
  fecha_inicio: string; fecha_fin: string;
  personas: { id: string; pct: number; fecha_inicio: string; fecha_fin: string }[];
}

interface Props {
  semanaInicio: Date;
  periodoVista?: "dia" | "semana" | "mes";
  /** Snapshot del escenario activo — reemplaza la query a asignacion */
  simulationSnapshot?: SimEngSnap[];
}

function getColumnas(semanaInicio: Date, pv: string): Columna[] {
  if (pv === "semana") {
    return Array.from({ length: 5 }, (_, i) => {
      const ini = addDays(semanaInicio, i * 7);
      const fin = addDays(ini, 6);
      return {
        label: format(ini, "d MMM", { locale: es }),
        sublabel: format(fin, "d MMM", { locale: es }),
        inicioStr: format(ini, "yyyy-MM-dd"),
        finStr: format(fin, "yyyy-MM-dd"),
      };
    });
  }
  if (pv === "mes") {
    return Array.from({ length: 4 }, (_, i) => {
      const mesInicio = startOfMonth(addMonths(semanaInicio, i));
      const mesFin = addDays(startOfMonth(addMonths(semanaInicio, i + 1)), -1);
      return {
        label: format(mesInicio, "MMM", { locale: es }),
        sublabel: format(mesInicio, "yyyy"),
        inicioStr: format(mesInicio, "yyyy-MM-dd"),
        finStr: format(mesFin, "yyyy-MM-dd"),
      };
    });
  }
  // dia: 7 columnas individuales
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(semanaInicio, i);
    const key = format(d, "yyyy-MM-dd");
    return {
      label: format(d, "EEE", { locale: es }),
      sublabel: format(d, "d MMM", { locale: es }),
      inicioStr: key,
      finStr: key,
    };
  });
}

function overlapsColumna(inicio: string, fin: string, col: Columna): boolean {
  return inicio <= col.finStr && fin >= col.inicioStr;
}

function calcDiasEngagement(inicio: string, fin: string | null) {
  const hoy = new Date().toISOString().split("T")[0];
  if (inicio > hoy) {
    const d = expandirRango(hoy, inicio).length - 1;
    return { dias: d, esFuturo: true };
  }
  const finClamp = fin && fin < hoy ? fin : hoy;
  return { dias: expandirRango(inicio, finClamp).length, esFuturo: false };
}

export function PerfilIndividualTablero({ semanaInicio, periodoVista, simulationSnapshot }: Props) {
  const [filas, setFilas] = useState<PersonaFila[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [esGYD, setEsGYD] = useState(false);
  const [ocultarVacacionesPorConfirmar, setOcultarVacacionesPorConfirmar] = useState(false);

  const pv = periodoVista ?? "dia";

  // Rango de fetch según período
  const totalDias = pv === "semana" ? 35 : pv === "mes" ? 120 : 7;
  const fechaInicio = format(semanaInicio, "yyyy-MM-dd");
  const fechaFin = format(addDays(semanaInicio, totalDias - 1), "yyyy-MM-dd");

  // Carga rol del usuario para ocultar datos de carga a G&D
  useEffect(() => {
    async function checkRol() {
      const sb = createAnyClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const { data } = await sb.from("persona").select("rol_sistema").eq("auth_user_id", user.id).single();
      const rol = (data as any)?.rol_sistema;
      setEsGYD(rol === "GyD" || rol === "AySr" || rol === "planificador" || rol === "Desarrollo");
      setOcultarVacacionesPorConfirmar(rol === "GyD" || rol === "AySr" || rol === "planificador");
    }
    checkRol();
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const sb = createAnyClient();

      if (simulationSnapshot) {
        // Modo simulación: proyectos desde snapshot, ausencias desde Supabase
        const [persRes, ausenRes] = await Promise.all([
          sb.from("persona").select("id, nombre, apellido, cargo_actual").eq("activo", true),
          sb.from("ausencia")
            .select("persona_id, fecha_inicio, fecha_fin, tipo")
            .lte("fecha_inicio", fechaFin)
            .gte("fecha_fin", fechaInicio),
        ]);

        const personas: PersonaFila[] = ((persRes.data ?? []) as any[])
          .sort((a, b) => {
            const ia = JERARQUIA[a.cargo_actual ?? ""] ?? 99;
            const ib = JERARQUIA[b.cargo_actual ?? ""] ?? 99;
            return ia !== ib ? ia - ib : a.apellido.localeCompare(b.apellido);
          })
          .map((p) => {
            // Proyectos del snapshot que incluyen a esta persona y solapan el rango visible
            const proyectos = simulationSnapshot
              .filter((eng) =>
                eng.fecha_inicio <= fechaFin &&
                (eng.fecha_fin ?? fechaFin) >= fechaInicio &&
                eng.personas.some((ps) => ps.id === p.id)
              )
              .map((eng) => {
                const ps = eng.personas.find((ps) => ps.id === p.id)!;
                return {
                  id: eng.id,
                  nombre: eng.codigo ? `${eng.codigo}: ${eng.nombre}` : eng.nombre,
                  cliente: eng.cliente ?? "",
                  inicio: ps.fecha_inicio,
                  fin: ps.fecha_fin,
                  pct: ps.pct,
                };
              });
            const ausencias = ((ausenRes.data ?? []) as any[])
              .filter((a) => a.persona_id === p.id)
              .map((a) => ({ inicio: a.fecha_inicio, fin: a.fecha_fin, tipo: a.tipo }));
            return { id: p.id, nombre: p.nombre, apellido: p.apellido,
                     cargo: p.cargo_actual ?? "Sin cargo", proyectos, ausencias };
          })
          .filter((p) => p.proyectos.length > 0 || p.ausencias.length > 0);

        setFilas(personas);
        setLoading(false);
        return;
      }

      // Modo real: query completa a Supabase
      const [persRes, asigRes, ausenRes] = await Promise.all([
        sb.from("persona").select("id, nombre, apellido, cargo_actual").eq("activo", true),
        sb.from("asignacion")
          .select("persona_id, pct_dedicacion, fecha_inicio, fecha_fin, engagement:engagement_id(id, codigo, nombre, cliente)" as any)
          .eq("estado", "activa")
          .lte("fecha_inicio", fechaFin)
          .gte("fecha_fin", fechaInicio),
        sb.from("ausencia")
          .select("persona_id, fecha_inicio, fecha_fin, tipo")
          .lte("fecha_inicio", fechaFin)
          .gte("fecha_fin", fechaInicio),
      ]);

      const personas: PersonaFila[] = ((persRes.data ?? []) as any[])
        .sort((a, b) => {
          const ia = JERARQUIA[a.cargo_actual ?? ""] ?? 99;
          const ib = JERARQUIA[b.cargo_actual ?? ""] ?? 99;
          return ia !== ib ? ia - ib : a.apellido.localeCompare(b.apellido);
        })
        .map((p) => {
          const asigsSinDedup = ((asigRes.data ?? []) as any[])
            .filter((a) => a.persona_id === p.id)
            .map((a) => {
              const eng = Array.isArray(a.engagement) ? a.engagement[0] : a.engagement;
              return {
                id: eng?.id ?? "",
                nombre: eng?.codigo ? `${eng.codigo}: ${eng.nombre ?? "—"}` : eng?.nombre ?? "—",
                cliente: eng?.cliente ?? "",
                inicio: a.fecha_inicio,
                fin: a.fecha_fin,
                pct: a.pct_dedicacion,
              };
            });
          // Deduplicar por engagement id — múltiples tramos del mismo engagement se unifican
          const engMap = new Map<string, typeof asigsSinDedup[0]>();
          for (const a of asigsSinDedup) {
            if (!engMap.has(a.id)) engMap.set(a.id, a);
          }
          const asigs = Array.from(engMap.values());
          const ausencias = ((ausenRes.data ?? []) as any[])
            .filter((a) => a.persona_id === p.id)
            .map((a) => ({ inicio: a.fecha_inicio, fin: a.fecha_fin, tipo: a.tipo }));
          return {
            id: p.id, nombre: p.nombre, apellido: p.apellido,
            cargo: p.cargo_actual ?? "Sin cargo", proyectos: asigs, ausencias,
          };
        })
        .filter((p) => p.proyectos.length > 0 || p.ausencias.length > 0);

      setFilas(personas);
      setLoading(false);
    }
    load();
  // simulationSnapshot referencia cambia con cada render de SandboxInicioView,
  // usar JSON como dependencia evita re-fetches infinitos
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fechaInicio, fechaFin, simulationSnapshot]);

  if (loading) return <p className="text-sm text-gray-300 p-2">Cargando...</p>;
  if (filas.length === 0) return <p className="text-sm text-gray-300 italic p-2">Sin actividad en este período.</p>;

  const hoy = format(new Date(), "yyyy-MM-dd");
  const columnas = getColumnas(semanaInicio, pv);

  // Oculta ausencias "vacaciones por confirmar" para roles restringidos
  const filasVisibles = ocultarVacacionesPorConfirmar
    ? filas.map((f) => ({ ...f, ausencias: f.ausencias.filter((a) => a.tipo !== "vacaciones_por_confirmar") }))
    : filas;

  // Filtrado frontend por persona, cargo o engagement
  const q = searchQuery.toLowerCase().trim();
  const filasFiltradas = q
    ? filasVisibles.filter((f) =>
        `${f.nombre} ${f.apellido}`.toLowerCase().includes(q) ||
        // Búsqueda por iniciales (ej: "MH" → "Mariana Hernández")
        `${f.nombre[0] ?? ""}${f.apellido[0] ?? ""}`.toLowerCase() === q ||
        f.cargo.toLowerCase().includes(q) ||
        f.proyectos.some((p) =>
          p.nombre.toLowerCase().includes(q) ||       // "CMPC14: Prioridad..." o solo nombre
          (p.cliente ?? "").toLowerCase().includes(q) // cliente/empresa
        )
      )
    : filasVisibles;

  // En modo día: filtrar fines de semana
  const columnasMostradas = pv === "dia"
    ? columnas.filter((c) => {
        const d = new Date(c.inicioStr + "T00:00:00");
        return !isWeekend(d);
      })
    : columnas;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Buscador */}
      <div className="relative mb-2 flex-shrink-0">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Buscar por persona, cargo o engagement..."
          className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-[#4a90e2] focus:border-[#4a90e2]"
        />
      </div>
    <div className="overflow-auto flex-1">
      <table className="w-full text-xs border-collapse" style={{ minWidth: 520 }}>
        <thead className="sticky top-0 bg-white z-20">
          <tr>
            <th className="text-left pr-3 pb-2 text-gray-400 font-semibold w-36 sticky left-0 bg-white z-30">
              Persona
            </th>
            {columnasMostradas.map((col, i) => {
              const esHoy = col.inicioStr <= hoy && hoy <= col.finStr;
              return (
                <th
                  key={i}
                  className="text-center pb-2 font-semibold"
                  style={{ color: esHoy ? "#4a90e2" : "#aaa", minWidth: pv === "dia" ? 48 : 72 }}
                >
                  <div className="capitalize">{col.label}</div>
                  <div className="font-normal text-[10px]">{col.sublabel}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {(() => {
            const cargoOrden = [...CARGOS];
            const sinCargo = filasFiltradas.filter(
              (f) => !cargoOrden.includes(f.cargo as typeof CARGOS[number])
            );
            const grupos = [
              ...cargoOrden.map((c) => ({ cargo: c, lista: filasFiltradas.filter((f) => f.cargo === c) })),
              ...(sinCargo.length > 0 ? [{ cargo: "Sin cargo", lista: sinCargo }] : []),
            ].filter((g) => g.lista.length > 0);

            return grupos.flatMap(({ cargo, lista }) => {
              const cargoColor = CARGO_COLORS[cargo] ?? CARGO_COLOR_DEFAULT;

              const filaSeccion = (
                <tr key={`sec-${cargo}`}>
                  <td colSpan={columnasMostradas.length + 1} className="pt-4 pb-1">
                    <div className="flex items-center gap-2">
                      <div className="w-1 h-4 rounded-full flex-shrink-0" style={{ background: cargoColor }} />
                      <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: cargoColor }}>{cargo}</span>
                      <span className="text-[10px] text-gray-300">{lista.length}</span>
                      <div className="flex-1 h-0.5 rounded-full" style={{ background: cargoColor, opacity: 0.35 }} />
                    </div>
                  </td>
                </tr>
              );

              const filasPersonas = lista.flatMap((persona, pi) => {
                const separador = pi > 0 ? (
                  <tr key={`sep-${persona.id}`}>
                    <td colSpan={columnasMostradas.length + 1} className="py-0.5">
                      <div className="border-t border-gray-100" />
                    </td>
                  </tr>
                ) : null;

                const filaHdr = (
                  <tr key={`hdr-${persona.id}`}>
                    <td className="pr-3 pt-2 pb-1 sticky left-0 bg-white z-10">
                      <p className="font-semibold text-[#1a1a2e] truncate max-w-[130px]">
                        {persona.nombre} {persona.apellido}
                      </p>
                    </td>
                    {columnasMostradas.map((_, i) => <td key={i} />)}
                  </tr>
                );

                const filasProyectos = persona.proyectos.map((proy, pi) => {
                  const { dias, esFuturo } = calcDiasEngagement(proy.inicio, proy.fin);
                  return (
                  <tr key={`proy-${persona.id}-${proy.id}-${pi}`}>
                    <td className="pr-3 py-0.5 sticky left-0 bg-white z-10">
                      <div className="flex items-center justify-between gap-1 pl-2 max-w-[130px]">
                        <p className="text-gray-500 truncate text-xs min-w-0">
                          {proy.nombre}
                          {proy.cliente && <span className="text-gray-300 ml-1">· {proy.cliente}</span>}
                        </p>
                        {!esGYD && <span
                          className="flex-shrink-0 text-[9px] font-bold px-1 py-0.5 rounded leading-none"
                          style={esFuturo
                            ? { background: "#f0fdf4", color: "#15803d" }
                            : { background: "#dbeafe", color: "#1d4ed8" }}
                        >
                          {esFuturo ? `En ${dias}d` : `${dias}d`}
                        </span>}
                      </div>
                    </td>
                    {columnasMostradas.map((col, i) => {
                      const activo = overlapsColumna(proy.inicio, proy.fin, col);
                      const semColor = esGYD
                        ? "#fef3c7"
                        : proy.pct < 50  ? "#16a34a"
                        : proy.pct <= 90 ? "#f59e0b"
                        : "#dc2626";

                      // ── Vista día: barra partida proyecto|ausencia cuando coinciden ──
                      if (pv === "dia" && activo) {
                        const aus = persona.ausencias.find(
                          (a) => a.inicio <= col.inicioStr && a.fin >= col.inicioStr
                        );
                        const ausColor = aus
                          ? (COLOR_AUSENCIA[aus.tipo as keyof typeof COLOR_AUSENCIA]?.bg ?? "#9ca3af")
                          : null;
                        // Inicial del día a partir de col.inicioStr (0=Dom,1=Lun,...6=Sáb)
                        const diaSemana = new Date(col.inicioStr + "T00:00:00").getDay();
                        const INICIAL_DIA: Record<number, string> = { 1:"L", 2:"M", 3:"X", 4:"J", 5:"V" };
                        const initialDia = INICIAL_DIA[diaSemana] ?? "";
                        const background = ausColor
                          ? `linear-gradient(to right, ${semColor} 50%, ${ausColor} 50%)`
                          : semColor;
                        return (
                          <td key={i} className="py-0.5 px-0.5">
                            <div
                              className="h-5 rounded relative overflow-hidden flex items-center justify-center text-[10px] font-semibold text-white"
                              style={{ background }}
                            >
                              {ausColor ? (
                                <>
                                  {/* % en la mitad izquierda (proyecto) */}
                                  {!esGYD && (
                                    <span className="absolute left-0 top-0 bottom-0 w-1/2 flex items-center justify-center text-[9px]">
                                      {proy.pct}%
                                    </span>
                                  )}
                                  {/* Inicial del día en la mitad derecha (ausencia) */}
                                  <span className="absolute right-0 top-0 bottom-0 w-1/2 flex items-center justify-center text-[9px] font-bold">
                                    {initialDia}
                                  </span>
                                </>
                              ) : (
                                !esGYD && `${proy.pct}%`
                              )}
                            </div>
                          </td>
                        );
                      }

                      // ── Vista semana: segmentar barra en 5 días (L–V) ──
                      if (pv === "semana" && activo) {
                        const segments = DIAS_SEMANA.map((initial, offset) => {
                          const dayStr = addDayStr(col.inicioStr, offset);
                          const aus = persona.ausencias.find(
                            (a) => a.inicio <= dayStr && a.fin >= dayStr
                          );
                          const ausColor = aus
                            ? (COLOR_AUSENCIA[aus.tipo as keyof typeof COLOR_AUSENCIA]?.bg ?? "#9ca3af")
                            : null;
                          return { initial, ausColor };
                        });

                        const hasAbsence = segments.some((s) => s.ausColor);
                        const gradientParts = segments.map((s, si) => {
                          const color = s.ausColor ?? semColor;
                          return `${color} ${si * 20}%, ${color} ${(si + 1) * 20}%`;
                        });
                        const background = hasAbsence
                          ? `linear-gradient(to right, ${gradientParts.join(", ")})`
                          : semColor;

                        return (
                          <td key={i} className="py-0.5 px-0.5">
                            <div
                              className="h-5 rounded relative overflow-hidden flex items-center justify-center"
                              style={{ background }}
                            >
                              {/* Iniciales de días con ausencia */}
                              {hasAbsence && segments.map((s, si) =>
                                s.ausColor ? (
                                  <span
                                    key={si}
                                    className="absolute top-0 bottom-0 flex items-center justify-center text-[9px] font-bold text-white"
                                    style={{ left: `${si * 20}%`, width: "20%" }}
                                  >
                                    {s.initial}
                                  </span>
                                ) : null
                              )}
                              {/* % carga sobre días sin ausencia (solo si todos los días están libres) */}
                              {!hasAbsence && !esGYD && (
                                <span className="text-[10px] font-semibold text-white">{proy.pct}%</span>
                              )}
                            </div>
                          </td>
                        );
                      }

                      // ── Vista mes: subdivisión por semanas ──
                      if (pv === "mes" && activo) {
                        const mesIni = new Date(col.inicioStr + "T00:00:00");
                        const mesFin = new Date(col.finStr + "T00:00:00");
                        const segs: { lbl: string; ausColor: string | null }[] = [];
                        let wStart = startOfISOWeek(mesIni);
                        if (addDays(wStart, 6) < mesIni) wStart = addDays(wStart, 7);
                        let idx = 1;
                        while (wStart <= mesFin) {
                          const wEnd = addDays(wStart, 6);
                          const clampIni = wStart < mesIni ? mesIni : wStart;
                          const clampFin = wEnd > mesFin ? mesFin : wEnd;
                          const wIniStr = format(clampIni, "yyyy-MM-dd");
                          const wFinStr = format(clampFin, "yyyy-MM-dd");
                          const aus = persona.ausencias.find((a) => a.inicio <= wFinStr && a.fin >= wIniStr);
                          const ausColor = aus ? (COLOR_AUSENCIA[aus.tipo as keyof typeof COLOR_AUSENCIA]?.bg ?? "#9ca3af") : null;
                          segs.push({ lbl: `S${idx}`, ausColor });
                          wStart = addDays(wStart, 7); idx++;
                        }
                        const segPct = 100 / segs.length;
                        const gradientParts = segs.map((s, si) => {
                          const c = s.ausColor ?? semColor;
                          return `${c} ${si * segPct}%, ${c} ${(si + 1) * segPct}%`;
                        });
                        return (
                          <td key={i} className="py-0.5 px-0.5">
                            <div className="h-5 rounded overflow-hidden relative"
                              style={{ background: `linear-gradient(to right, ${gradientParts.join(", ")})` }}>
                              {segs.map((s, si) => s.ausColor ? (
                                <div key={si} className="absolute inset-y-0 flex items-center justify-center select-none pointer-events-none"
                                  style={{ left: `${si * segPct}%`, width: `${segPct}%`, backgroundColor: s.ausColor }}>
                                  <span className="text-white font-black drop-shadow-sm" style={{ fontSize: 10, lineHeight: 1 }}>{s.lbl}</span>
                                </div>
                              ) : (
                                <span key={si} className="absolute text-white font-black select-none pointer-events-none"
                                  style={{ left: `${si * segPct + segPct / 2}%`, top: "50%", transform: "translate(-50%,-50%)", fontSize: 10, lineHeight: 1, opacity: 0.45 }}>
                                  {s.lbl}
                                </span>
                              ))}
                            </div>
                          </td>
                        );
                      }

                      // ── Vista día / mes sin activo: renderizado original ──
                      return (
                        <td key={i} className="py-0.5 px-0.5">
                          {activo ? (
                            <div
                              className="h-5 rounded flex items-center justify-center text-[10px] font-semibold text-white"
                              style={{ background: semColor }}
                            >
                              {!esGYD && `${proy.pct}%`}
                            </div>
                          ) : (
                            <div className="h-5 rounded bg-gray-50" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  );
                });

                const filaAusencia = persona.ausencias.length > 0 ? (
                  <tr key={`aus-${persona.id}`}>
                    <td className="pr-3 py-0.5 sticky left-0 bg-white z-10">
                      <p className="text-orange-400 pl-2 truncate max-w-[130px]">Ausencia</p>
                    </td>
                    {columnasMostradas.map((col, i) => {
                      const ausEnCol = persona.ausencias.filter((a) => overlapsColumna(a.inicio, a.fin, col));
                      const ausActiva = ausEnCol[0] ?? null;
                      const cfg = ausActiva ? (COLOR_AUSENCIA[ausActiva.tipo as keyof typeof COLOR_AUSENCIA] ?? { bg: "#9ca3af", label: "Ausencia" }) : null;
                      const tooltip = (() => {
                        if (!ausEnCol.length) return undefined;
                        const sorted = [...ausEnCol].sort((a, b) => a.inicio.localeCompare(b.inicio));
                        const iniStr = sorted[0].inicio;
                        const finStr = sorted[sorted.length - 1].fin;
                        const totalDias = sorted.reduce((acc, a) => {
                          const d = Math.round((new Date(a.fin + "T00:00:00").getTime() - new Date(a.inicio + "T00:00:00").getTime()) / 86400000) + 1;
                          return acc + d;
                        }, 0);
                        const tipos = [...new Set(sorted.map((a) => COLOR_AUSENCIA[a.tipo as keyof typeof COLOR_AUSENCIA]?.label ?? a.tipo))].join(" + ");
                        const fmtIni = format(new Date(iniStr + "T00:00:00"), "d MMM", { locale: es });
                        const fmtFin = format(new Date(finStr + "T00:00:00"), "d MMM", { locale: es });
                        return `${persona.nombre} ${persona.apellido} - ${tipos} - ${fmtIni} al ${fmtFin} - (${totalDias} ${totalDias === 1 ? "día" : "días"})`;
                      })();
                      return (
                        <td key={i} className="py-0.5 px-0.5">
                          {cfg ? (
                            <div className="h-5 rounded" style={{ background: cfg.bg }} title={tooltip} />
                          ) : (
                            <div className="h-5 rounded bg-gray-50" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ) : null;

                return [separador, filaHdr, ...filasProyectos, filaAusencia].filter(Boolean);
              });

              return [filaSeccion, ...filasPersonas];
            });
          })()}
        </tbody>
      </table>
    </div>
    </div>
  );
}
