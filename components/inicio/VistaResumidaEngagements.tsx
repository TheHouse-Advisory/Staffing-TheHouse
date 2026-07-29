"use client";

import { format } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { COLOR_AUSENCIA } from "@/lib/queries/ausencias";
import type { TipoAusencia } from "@/lib/types/database";
import { nextDiaHabil, type EngRow, type PersonaAsig } from "./DesgloceEngagements";

interface AusenciaRow {
  persona_id: string;
  fecha_inicio: string;
  fecha_fin: string;
  tipo: string;
}

interface Props {
  engs: EngRow[];
  base: Date;
  ausencias: AusenciaRow[];
  /** Navegación de fechas — omitidas cuando la vista/base están controladas externamente. */
  onNavAnterior?: () => void;
  onDiaAnterior?: () => void;
  onDiaSiguiente?: () => void;
  onNavSiguiente?: () => void;
}

const BOTON_NAV = "text-xs font-semibold text-gray-500 hover:text-gray-800 px-1 py-0.5 rounded";

// Colores por cargo — espejo del mapa "COLORES" de InicioClient.tsx (panel EQUIPO), que
// sí distingue Director de Proyectos (azul) de Gerente de Proyectos (morado).
const CARGO_COLOR: Record<string, string> = {
  "Socio": "#1a1a2e",
  "Director de Proyectos": "#4a90e2", "Director": "#4a90e2",
  "Gerente de Proyectos": "#7c5cbf", "Gerente": "#7c5cbf",
  "Asociado": "#e2884a", "Asociado / Consultor Senior": "#e2884a",
  "Consultor Senior": "#4ab89a",
  "Consultor de Proyectos": "#e24a6a", "Consultor Proyecto": "#e24a6a", "Consultor": "#e24a6a",
  "Consultor Analista": "#a0b84a", "Analista Senior": "#a0b84a",
  "Consultor Trainee": "#c07c4a", "Analista": "#c07c4a", "Practicante": "#c07c4a",
  "Desarrollo": "#94a3b8",
};
const CARGO_COLOR_DEFAULT = "#94a3b8";

function colorPorCargo(cargo: string | null): string {
  if (!cargo) return CARGO_COLOR_DEFAULT;
  if (CARGO_COLOR[cargo]) return CARGO_COLOR[cargo];
  const c = cargo.toLowerCase();
  for (const [key, color] of Object.entries(CARGO_COLOR)) {
    if (c.includes(key.toLowerCase()) || key.toLowerCase().includes(c)) return color;
  }
  return CARGO_COLOR_DEFAULT;
}

function iniciales(nombre: string, apellido: string, custom?: string | null): string {
  if (custom?.trim()) return custom.trim().toUpperCase().slice(0, 3);
  return `${nombre[0] ?? ""}${apellido[0] ?? ""}`.toUpperCase();
}

function personaActivaEnDia(p: PersonaAsig, diaIso: string): boolean {
  return p.fecha_inicio <= diaIso && p.fecha_fin >= diaIso;
}

/** Ausencia de la persona que solapa con el día dado, si existe. */
function ausenciaDePersonaEnDia(personaId: string, diaIso: string, ausencias: AusenciaRow[]): AusenciaRow | undefined {
  return ausencias.find(
    (a) => a.persona_id === personaId && a.fecha_inicio <= diaIso && a.fecha_fin >= diaIso
  );
}

function labelAusencia(tipo: string): string {
  return COLOR_AUSENCIA[tipo as TipoAusencia]?.label ?? tipo;
}

function SeparadorSeccion({ label, cantidad, color }: { label: string; cantidad: number; color: string }) {
  return (
    <tr>
      <td colSpan={6} className="pt-2 pb-0.5">
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 rounded-full flex-shrink-0" style={{ background: color }} />
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color }}>{label}</span>
          <span className="text-[10px] text-gray-300">{cantidad}</span>
          <div className="flex-1 h-0.5 rounded-full" style={{ background: color, opacity: 0.35 }} />
        </div>
      </td>
    </tr>
  );
}

function FilaEngagement({ eng, diasIso, ausencias }: { eng: EngRow; diasIso: string[]; ausencias: AusenciaRow[] }) {
  return (
    <tr className="border-b border-gray-200 dark:border-gray-800">
      <td className="py-1.5 pr-2 font-semibold text-[#1a1a2e] truncate max-w-[160px] border-r border-gray-200 dark:border-gray-800">
        {eng.codigo ? `${eng.codigo}: ${eng.nombre}` : eng.nombre}
      </td>
      {diasIso.map((diaIso) => {
        const personasDia = Array.from(
          new Map(eng.personas.filter((p) => personaActivaEnDia(p, diaIso)).map((p) => [p.id, p])).values()
        );
        return (
          <td key={diaIso} className="py-1.5 px-1 align-top border-r border-gray-200 dark:border-gray-800 last:border-r-0">
            <div className="flex flex-wrap gap-0.5 items-center">
              {personasDia.map((p) => {
                const ausencia = ausenciaDePersonaEnDia(p.id, diaIso, ausencias);
                const title = ausencia
                  ? `${p.nombre} ${p.apellido} - AUSENTE (${labelAusencia(ausencia.tipo)})`
                  : `${p.nombre} ${p.apellido} - ${p.cargo ?? "Sin cargo"}`;
                return (
                  <div
                    key={p.asignacionId}
                    title={title}
                    className={`relative w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${ausencia ? "opacity-40 grayscale" : ""}`}
                    style={{ background: colorPorCargo(p.cargo) }}
                  >
                    <span className="text-[9px] font-semibold leading-none text-white select-none">
                      {iniciales(p.nombre, p.apellido, p.iniciales)}
                    </span>
                    {ausencia && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-gray-500 text-white text-[6px] font-bold flex items-center justify-center leading-none select-none ring-1 ring-white">
                        A
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </td>
        );
      })}
    </tr>
  );
}

export function VistaResumidaEngagements({
  engs, base, ausencias, onNavAnterior, onDiaAnterior, onDiaSiguiente, onNavSiguiente,
}: Props) {
  // Ventana móvil de 5 días hábiles consecutivos a partir de `base` (no se ancla al lunes ISO):
  // "<"/">" desplazan `base` un día hábil y esta ventana se recalcula completa a partir de ahí.
  const dias: Date[] = [base];
  while (dias.length < 5) dias.push(nextDiaHabil(dias[dias.length - 1]));
  const diasIso = dias.map((d) => format(d, "yyyy-MM-dd"));
  const inicioVentanaIso = diasIso[0];
  const finVentanaIso = diasIso[4];

  const hoyIso = format(new Date(), "yyyy-MM-dd");

  const activaEstaSemana = (e: EngRow) => (!e.fecha_fin || e.fecha_fin >= inicioVentanaIso) && e.fecha_inicio <= finVentanaIso;
  const proyectos = engs.filter((e) => e.tipo === "proyecto" && activaEstaSemana(e));
  const propuestas = engs.filter((e) => e.tipo === "propuesta" && activaEstaSemana(e));
  const engsSemana = [...proyectos, ...propuestas];

  return (
    <div className="flex-1 flex flex-col w-full h-full max-w-none min-h-0">
    <div className="flex-1 overflow-y-auto max-h-[calc(100vh-140px)]">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-white z-10">
          <tr className="border-b border-gray-200 dark:border-gray-800">
            <th className="text-left py-1.5 pr-2 text-gray-400 font-semibold whitespace-nowrap border-r border-gray-200 dark:border-gray-800">
              <div className="flex items-center justify-between gap-1">
                <span>Proyecto</span>
                {(onNavAnterior || onDiaAnterior) && (
                  <span className="flex items-center gap-0.5 flex-shrink-0">
                    {onNavAnterior && (
                      <button onClick={onNavAnterior} title="Semana anterior" className={BOTON_NAV}>
                        <ChevronsLeft className="w-3 h-3" />
                      </button>
                    )}
                    {onDiaAnterior && (
                      <button onClick={onDiaAnterior} title="Día hábil anterior" className={BOTON_NAV}>
                        <ChevronLeft className="w-3 h-3" />
                      </button>
                    )}
                  </span>
                )}
              </div>
            </th>
            {dias.map((d, i) => {
              const esHoy = diasIso[i] === hoyIso;
              const esUltima = i === dias.length - 1;
              return (
                <th
                  key={i}
                  className="text-center py-1.5 px-1 font-semibold whitespace-nowrap border-r border-gray-200 dark:border-gray-800 last:border-r-0"
                  style={{ color: esHoy ? "#4a90e2" : "#9ca3af" }}
                >
                  {esUltima && (onDiaSiguiente || onNavSiguiente) ? (
                    <div className="flex items-center justify-between gap-1">
                      <span>{format(d, "EEE", { locale: es })} {format(d, "d/MM")}</span>
                      <span className="flex items-center gap-0.5 flex-shrink-0">
                        {onDiaSiguiente && (
                          <button onClick={onDiaSiguiente} title="Día hábil siguiente" className={BOTON_NAV}>
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        )}
                        {onNavSiguiente && (
                          <button onClick={onNavSiguiente} title="Semana siguiente" className={BOTON_NAV}>
                            <ChevronsRight className="w-3 h-3" />
                          </button>
                        )}
                      </span>
                    </div>
                  ) : (
                    <>{format(d, "EEE", { locale: es })} {format(d, "d/MM")}</>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {engsSemana.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-3 text-gray-300 italic">Sin engagements activos esta semana.</td>
            </tr>
          ) : (
            <>
              {proyectos.length > 0 && (
                <SeparadorSeccion label="Proyectos" cantidad={proyectos.length} color="#4a90e2" />
              )}
              {proyectos.map((eng) => (
                <FilaEngagement key={eng.id} eng={eng} diasIso={diasIso} ausencias={ausencias} />
              ))}
              {propuestas.length > 0 && (
                <SeparadorSeccion label="Propuestas comerciales" cantidad={propuestas.length} color="#9b59b6" />
              )}
              {propuestas.map((eng) => (
                <FilaEngagement key={eng.id} eng={eng} diasIso={diasIso} ausencias={ausencias} />
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
      <p className="flex-shrink-0 text-[9px] text-gray-300 text-right pt-1 pr-1">
        <span className="inline-flex items-center justify-center w-3 h-3 rounded-full bg-gray-300 text-white text-[7px] font-bold align-middle mr-1">A</span>
        = persona ausente ese día
      </p>
    </div>
  );
}
