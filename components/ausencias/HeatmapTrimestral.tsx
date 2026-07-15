"use client";

import React, { useMemo, useState } from "react";
import { Calendar } from "lucide-react";
import { COLOR_AUSENCIA, isHoliday } from "@/lib/queries/ausencias";
import type { TipoAusencia } from "@/lib/types/database";
import { PopoverPersona } from "./PopoverPersona";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

// Micro-columna de día: 9px fijos, reutilizados en header, datos y en la fila de % Cuota.
// El ancho real lo impone el <colgroup> (table-fixed lo hace obligatorio); estas clases
// son la segunda barrera para que ningún contenido pueda ensanchar la columna.
const DIA_CLS = "w-[9px] max-w-[9px] h-6 p-0";
const PERSONA_CLS = "min-w-[80px] max-w-[80px] w-[80px]";
const DIA_PX = 9;
const PERSONA_PX = 80;

const BLOQUE_SOCIO      = "Socio";
const BLOQUE_GERENCIA   = "Gerentes y directores";
const BLOQUE_SENIOR     = "Seniors y asociados";
const BLOQUE_CONSULTOR  = "Consultores de proyecto, analistas y trainee";
const BLOQUE_DESARROLLO = "Desarrollo";
// Mismo orden que la vista mensual (HeatmapAusencias.tsx): Socio y Desarrollo van aparte.
const ORDEN_BLOQUES = [BLOQUE_SOCIO, BLOQUE_GERENCIA, BLOQUE_SENIOR, BLOQUE_CONSULTOR, BLOQUE_DESARROLLO];

const CARGO_A_BLOQUE: Record<string, string> = {
  "Socio": BLOQUE_SOCIO,
  "Director": BLOQUE_GERENCIA,
  "Director de Proyectos": BLOQUE_GERENCIA,
  "Gerente": BLOQUE_GERENCIA,
  "Gerente de Proyectos": BLOQUE_GERENCIA,
  "Asociado": BLOQUE_SENIOR,
  "Senior": BLOQUE_SENIOR,
  "Consultor Senior": BLOQUE_SENIOR,
  "Consultor de Proyectos": BLOQUE_CONSULTOR,
  "Consultor Proyecto": BLOQUE_CONSULTOR,
  "Consultor Analista": BLOQUE_CONSULTOR,
  "Analista Senior": BLOQUE_CONSULTOR,
  "Consultor Trainee": BLOQUE_CONSULTOR,
  "Analista": BLOQUE_CONSULTOR,
  "Practicante": BLOQUE_CONSULTOR,
  "Desarrollo": BLOQUE_DESARROLLO,
};

export interface PersonaTrimestral {
  id: string;
  nombre: string;
  apellido: string;
  cargo_actual: string | null;
  is_leverager?: boolean;
  referente?: boolean;
}

export interface AusenciaTrimestral {
  persona_id: string;
  tipo: TipoAusencia;
  fecha_inicio: string; // yyyy-mm-dd
  fecha_fin: string;    // yyyy-mm-dd
}

export interface TipoAusenciaDinamico {
  id: string;
  label: string;
  color_bg: string;
  color_text: string;
}

interface HeatmapTrimestralProps {
  year: number;
  startMonth: number; // 1-12, primer mes del trimestre a mostrar
  personasData: PersonaTrimestral[];
  ausenciasData: AusenciaTrimestral[];
  // Tipos de ausencia creados desde la BD (ej. "post_natal", "mba"): sin esto, cualquier
  // tipo que no esté en el catálogo estático COLOR_AUSENCIA cae al gris de fallback.
  tiposDinamicos?: TipoAusenciaDinamico[];
  rolActual?: string | null;
}

interface DiaCol {
  fecha: Date;
  dow: number; // 0=lunes … 4=viernes (fines de semana quedan filtrados antes de llegar aquí)
}

interface SemanaGrupo {
  semLabel: string;
  colSpan: number;
}

interface MesGrupo {
  mes: string;
  colSpan: number; // = cantidad exacta de días calendario de ese mes
  dias: DiaCol[];
  semanas: SemanaGrupo[];
}

function toISO(fecha: Date): string {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function siguienteDiaISO(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return toISO(d);
}

function formatFechaCL(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function diasEntre(inicioISO: string, finISO: string): number {
  const inicio = new Date(inicioISO + "T00:00:00");
  const fin = new Date(finISO + "T00:00:00");
  return Math.round((fin.getTime() - inicio.getTime()) / 86400000) + 1;
}

interface BloqueConsecutivo {
  inicio: string;
  fin: string;
}

// Funde ausencias de una persona en bloques continuos, sin importar si cambia el tipo
// (ej: vacaciones seguidas de un permiso administrativo cuentan como un solo bloque).
function calcularBloquesConsecutivos(ausencias: AusenciaTrimestral[]): BloqueConsecutivo[] {
  if (ausencias.length === 0) return [];
  const ordenadas = [...ausencias].sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio));
  const bloques: BloqueConsecutivo[] = [{ inicio: ordenadas[0].fecha_inicio, fin: ordenadas[0].fecha_fin }];
  for (let i = 1; i < ordenadas.length; i++) {
    const a = ordenadas[i];
    const actual = bloques[bloques.length - 1];
    if (a.fecha_inicio <= siguienteDiaISO(actual.fin)) {
      if (a.fecha_fin > actual.fin) actual.fin = a.fecha_fin;
    } else {
      bloques.push({ inicio: a.fecha_inicio, fin: a.fecha_fin });
    }
  }
  return bloques;
}

// Los 3 meses del trimestre, cada uno con sus días hábiles calendario (Lunes a Viernes;
// sábados y domingos se excluyen por completo, ni generan columna) y agrupados en semanas
// Sem1..SemN dentro del mes (la primera y última semana de cada mes pueden tener < 5 días).
function construirMeses(year: number, startMonth: number): MesGrupo[] {
  const meses: MesGrupo[] = [];
  for (let i = 0; i < 3; i++) {
    const mIndex = startMonth - 1 + i; // Date() normaliza overflow de mes/año
    const diasEnMes = new Date(year, mIndex + 1, 0).getDate();
    const dias: DiaCol[] = [];
    for (let day = 1; day <= diasEnMes; day++) {
      const fecha = new Date(year, mIndex, day);
      if (fecha.getDay() === 0 || fecha.getDay() === 6) continue; // domingo o sábado: fuera
      dias.push({ fecha, dow: (fecha.getDay() + 6) % 7 });
    }
    const semanas: SemanaGrupo[] = [];
    dias.forEach((d, idx) => {
      if (idx === 0 || d.dow === 0) semanas.push({ semLabel: `Sem${semanas.length + 1}`, colSpan: 0 });
      semanas[semanas.length - 1].colSpan++;
    });
    const mesNombre = MESES[((mIndex % 12) + 12) % 12];
    meses.push({ mes: mesNombre, colSpan: dias.length, dias, semanas });
  }
  return meses;
}

function cuotaColor(pct: number): { bg: string; text: string } {
  if (pct <= 25) return { bg: "#ecfdf5", text: "#065f46" };
  if (pct <= 50) return { bg: "#fffbeb", text: "#92400e" };
  if (pct <= 75) return { bg: "#fff7ed", text: "#9a3412" };
  return { bg: "#fef2f2", text: "#991b1b" };
}

export function HeatmapTrimestral({ year, startMonth, personasData, ausenciasData, tiposDinamicos = [], rolActual }: HeatmapTrimestralProps) {
  const meses = useMemo(() => construirMeses(year, startMonth), [year, startMonth]);

  // Resuelve color de un tipo: dinámico (BD) > estático (COLOR_AUSENCIA) > gris de fallback.
  // Mismo orden de resolución que colorDeTipo() en la vista mensual (HeatmapAusencias.tsx).
  function colorDeTipo(tipo: TipoAusencia): { bg: string; text: string; label: string } {
    const din = tiposDinamicos.find((t) => t.id === tipo);
    if (din) return { bg: din.color_bg, text: din.color_text, label: din.label };
    const est = COLOR_AUSENCIA[tipo];
    if (est) return est;
    return { bg: "#9ca3af", text: "#fff", label: tipo };
  }

  // Popover de resumen de ausencias — mismo componente que usan las vistas mes/semana
  const [popoverPersona, setPopoverPersona] = useState<PersonaTrimestral | null>(null);

  // Columnas continuas del trimestre completo, con marca de inicio de mes/semana/feriado para los bordes y estilos
  const columnas = useMemo(
    () =>
      meses.flatMap((m, mi) =>
        m.dias.map((d, di) => ({
          fecha: d.fecha,
          dow: d.dow,
          esInicioMes: di === 0 && mi > 0,
          esInicioSemana: d.dow === 0,
          esFeriado: isHoliday(toISO(d.fecha)),
        }))
      ),
    [meses]
  );

  // Semanas del trimestre "aplanadas", cada una con sus propios DiaCol — para las filas de
  // RESUMEN, que ya no pintan celda por día (a ~10px "11%" no cabe) sino una por semana.
  const semanasFlat = useMemo(() => {
    const out: { key: string; colSpan: number; dias: DiaCol[]; esInicioMes: boolean }[] = [];
    meses.forEach((m, mi) => {
      let cursor = 0;
      m.semanas.forEach((s, si) => {
        out.push({
          key: `${m.mes}-${s.semLabel}`,
          colSpan: s.colSpan,
          dias: m.dias.slice(cursor, cursor + s.colSpan),
          esInicioMes: si === 0 && mi > 0,
        });
        cursor += s.colSpan;
      });
    });
    return out;
  }, [meses]);

  const ausenciasPorPersona = useMemo(() => {
    const map = new Map<string, AusenciaTrimestral[]>();
    for (const a of ausenciasData) {
      if (!map.has(a.persona_id)) map.set(a.persona_id, []);
      map.get(a.persona_id)!.push(a);
    }
    return map;
  }, [ausenciasData]);

  function tipoEnDia(personaId: string, iso: string): TipoAusencia | null {
    const lista = ausenciasPorPersona.get(personaId);
    if (!lista) return null;
    return lista.find((a) => a.fecha_inicio <= iso && iso <= a.fecha_fin)?.tipo ?? null;
  }

  // Bloques consecutivos por persona, calculados una sola vez (no por celda) para el tooltip.
  const bloquesPorPersona = useMemo(() => {
    const map = new Map<string, BloqueConsecutivo[]>();
    for (const [personaId, lista] of ausenciasPorPersona) {
      map.set(personaId, calcularBloquesConsecutivos(lista));
    }
    return map;
  }, [ausenciasPorPersona]);

  function bloqueEnDia(personaId: string, iso: string): BloqueConsecutivo | null {
    const bloques = bloquesPorPersona.get(personaId);
    if (!bloques) return null;
    return bloques.find((b) => b.inicio <= iso && iso <= b.fin) ?? null;
  }

  const grupos = useMemo(() => {
    const map = new Map<string, PersonaTrimestral[]>();
    for (const bloque of ORDEN_BLOQUES) map.set(bloque, []);
    for (const p of personasData) {
      const bloque = CARGO_A_BLOQUE[p.cargo_actual ?? ""] ?? BLOQUE_CONSULTOR;
      map.get(bloque)!.push(p);
    }
    for (const lista of map.values()) lista.sort((a, b) => a.apellido.localeCompare(b.apellido));
    return ORDEN_BLOQUES.map((bloque) => [bloque, map.get(bloque) ?? []] as const);
  }, [personasData]);

  const totalDiasColumnas = columnas.length;

  if (personasData.length === 0) {
    return <p className="text-sm text-[#999] italic p-6">No hay personas para mostrar en este trimestre.</p>;
  }

  // Bordes finos por defecto (0.5px) para no restar espacio; el límite de mes se deja en 1px
  // porque sigue siendo la única referencia visual de "dónde empieza Agosto/Septiembre".
  function bordeClass(col: { esInicioMes: boolean; esInicioSemana: boolean }): string {
    if (col.esInicioMes) return "border-l border-l-gray-400";
    if (col.esInicioSemana) return "border-l-[0.5px] border-l-gray-200";
    return "";
  }

  return (
    <div className="h-full min-w-0 w-full max-w-full flex flex-col">
      <div className="flex items-center gap-2 px-1 pb-2">
        <Calendar className="w-3.5 h-3.5 text-[#888]" />
        <span className="text-[11px] font-bold text-[#555] uppercase tracking-wide">
          Vista panorámica · {MESES[(startMonth - 1) % 12]} – {MESES[(startMonth + 1) % 12]} {year}
        </span>
      </div>

      {/*
        Sin scroll horizontal, nunca. table-fixed + colgroup fijan el ancho de cada columna,
        pero este div es hijo de un flex-col: por defecto un flex-item no se encoge por debajo
        del ancho intrínseco de su contenido (min-width:auto), así que sin min-w-0 el layout
        completo se ensanchaba para que "quepan" los números de dos dígitos. min-w-0 fuerza el
        encogimiento real; overflow-x-hidden es solo la red de seguridad final.
      */}
      <div className="flex-1 min-w-0 w-full max-w-full overflow-x-hidden overflow-y-auto border border-[#ebebeb] rounded-lg">
        <table className="table-fixed w-full max-w-full border-collapse text-[11px]">
          <colgroup>
            <col style={{ width: PERSONA_PX }} />
            {columnas.map((_, i) => (
              <col key={i} style={{ width: DIA_PX }} />
            ))}
          </colgroup>

          <thead className="sticky top-0 z-20">
            {/* Fila 1 — Mes (colSpan = días calendario exactos de ese mes) */}
            <tr>
              <th
                rowSpan={3}
                className={`sticky left-0 z-30 bg-white border-b border-r border-[#ddd] px-1 py-0.5 text-left text-[10px] font-semibold text-[#888] uppercase tracking-wide align-bottom ${PERSONA_CLS}`}
              >
                Persona
              </th>
              {meses.map((m, i) => (
                <th
                  key={`${m.mes}-${i}`}
                  colSpan={m.colSpan}
                  className="border-b border-l border-emerald-800 bg-emerald-700 p-0 text-center text-[10px] font-bold text-white uppercase tracking-wide truncate"
                >
                  {m.mes}
                </th>
              ))}
            </tr>
            {/* Fila 2 — Semana (colSpan = días de esa semana dentro del mes, puede ser < 7 en los bordes) */}
            <tr>
              {meses.map((m) =>
                m.semanas.map((s, i) => (
                  <th
                    key={`${m.mes}-${s.semLabel}-${i}`}
                    colSpan={s.colSpan}
                    className="border-b border-l border-[#e5e5e5] bg-[#f5f5f8] p-0 text-center text-[8px] font-medium text-[#777] truncate"
                  >
                    {s.semLabel}
                  </th>
                ))
              )}
            </tr>
            {/* Fila 3 — Día individual (micro-columna 16px, un <th> por cada día hábil del trimestre) */}
            <tr>
              {columnas.map((col) => (
                <th
                  key={toISO(col.fecha)}
                  title={col.esFeriado ? "Feriado" : undefined}
                  className={`${DIA_CLS} text-center border-b-[0.5px] border-gray-200 overflow-hidden ${col.esFeriado ? "bg-gray-200" : "bg-[#fafafa]"} ${bordeClass(col)}`}
                >
                  <span className="text-[8px] font-semibold text-center block tracking-tighter truncate leading-none text-[#555]">
                    {col.fecha.getDate()}
                  </span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {grupos.map(([bloque, personas]) => {
              if (personas.length === 0) return null;

              return (
                <React.Fragment key={bloque}>
                  {/* Cabecera de bloque — mismo estilo que la fila de cargo (Nivel 1) de la vista mensual */}
                  <tr className="bg-[#f0f0f0] border-t-2 border-b border-[#ddd]">
                    <td
                      colSpan={totalDiasColumnas + 1}
                      className="sticky left-0 z-10 bg-[#f0f0f0] px-2 py-1.5 text-left truncate"
                    >
                      <span className="text-[10px] font-bold text-[#444] uppercase tracking-wide">{bloque}</span>
                      <span className="text-[9px] text-[#aaa] ml-1">· {personas.length} {personas.length === 1 ? "persona" : "personas"}</span>
                    </td>
                  </tr>

                  {/* Filas de personas */}
                  {personas.map((p, pi) => (
                    <tr key={p.id} className={pi % 2 === 0 ? "bg-white" : "bg-[#fafafa]"}>
                      <td className={`sticky left-0 z-20 bg-white border-r border-[#ebebeb] px-1 py-0 ${PERSONA_CLS}`}>
                        <div className="flex items-center gap-0.5 min-w-0">
                          {p.is_leverager && (
                            <span
                              className="w-3 h-3 rounded-full bg-[#3b5bdb] flex-shrink-0 flex items-center justify-center text-white font-black leading-none"
                              style={{ fontSize: 6 }}
                              title="Apalancador"
                            >
                              A
                            </span>
                          )}
                          {rolActual === "admin" && p.referente && (
                            <span
                              className="w-3 h-3 rounded-full bg-[#e2884a] flex-shrink-0 flex items-center justify-center text-white font-black leading-none"
                              style={{ fontSize: 6 }}
                              title="Referente"
                            >
                              R
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => setPopoverPersona(p)}
                            className="text-[8px] font-medium text-[#1a1a1a] truncate block min-w-0 flex-1 text-left cursor-pointer hover:underline hover:text-blue-600 transition-colors"
                            title="Ver resumen de ausencias"
                          >
                            {p.nombre} {p.apellido}
                          </button>
                        </div>
                      </td>
                      {columnas.map((col) => {
                        const iso = toISO(col.fecha);
                        // El feriado tiene prioridad visual: no pinta la ausencia encima, porque
                        // un feriado no debería contar como día de ausencia consumido.
                        const tipo = col.esFeriado ? null : tipoEnDia(p.id, iso);
                        const cfg = tipo ? colorDeTipo(tipo) : null;
                        // Tooltip: bloque consecutivo completo (funde tipos distintos si están pegados en el tiempo)
                        const bloque = cfg ? bloqueEnDia(p.id, iso) : null;
                        const tooltip = col.esFeriado
                          ? "Feriado"
                          : bloque
                            ? `${p.nombre} ${p.apellido} - ${formatFechaCL(bloque.inicio)} al ${formatFechaCL(bloque.fin)} (${diasEntre(bloque.inicio, bloque.fin)} días)`
                            : undefined;
                        return (
                          <td
                            key={iso}
                            className={`${DIA_CLS} border-b border-[#f5f5f5] ${bordeClass(col)} ${cfg ? "rounded-sm" : ""} ${col.esFeriado ? "bg-gray-200" : ""}`}
                            style={cfg ? { background: cfg.bg } : undefined}
                            title={tooltip}
                          />
                        );
                      })}
                    </tr>
                  ))}

                  {/*
                    Resumen SEMANAL del bloque (% Cuota = promedio de los % diarios de esa semana).
                    A ~10px de columna "11%" no entra por día, así que esta fila usa colSpan por
                    semana (igual que el header Sem1/Sem2...) en vez de una celda por día — eso le
                    da ~50px+ por celda, suficiente para el texto sin comprimirlo.
                  */}
                  <tr className="bg-[#f4f4f4] border-t border-b border-[#e0e0e0]">
                    <td
                      className={`sticky left-0 z-20 bg-[#f4f4f4] border-r border-[#e0e0e0] px-2 py-0.5 truncate ${PERSONA_CLS}`}
                      title={`RESUMEN - ${bloque.toUpperCase()}`}
                    >
                      <span className="text-[8px] font-bold text-[#555] uppercase tracking-wide truncate">RESUMEN - {bloque.toUpperCase()}</span>
                    </td>
                    {semanasFlat.map((s) => {
                      const pctsDias = s.dias.map((d) => {
                        const iso = toISO(d.fecha);
                        const total = personas.filter((p) => tipoEnDia(p.id, iso) !== null).length;
                        return personas.length > 0 ? (total / personas.length) * 100 : 0;
                      });
                      const pctProm = pctsDias.length > 0
                        ? Math.round(pctsDias.reduce((a, b) => a + b, 0) / pctsDias.length)
                        : 0;
                      const bordeSemana = s.esInicioMes ? "border-l border-l-gray-400" : "border-l-[0.5px] border-l-gray-200";
                      return (
                        <td
                          key={s.key}
                          colSpan={s.colSpan}
                          className={`text-center overflow-hidden ${bordeSemana}`}
                          title={`${pctProm}% promedio esa semana`}
                        >
                          {pctProm > 0 && (
                            <span className="text-[10px] font-bold text-center text-emerald-800">{pctProm}%</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {popoverPersona && (
        <PopoverPersona persona={popoverPersona} onClose={() => setPopoverPersona(null)} />
      )}
    </div>
  );
}
