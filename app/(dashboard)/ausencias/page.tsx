"use client";

import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Plus, BarChart2, Loader2 } from "lucide-react";
import { createClient, createAnyClient } from "@/lib/supabase/client";
import type { RolSistema } from "@/lib/types/database";
import { HeatmapAusencias } from "@/components/ausencias/HeatmapAusencias";
import { HeatmapTrimestral, type PersonaTrimestral, type AusenciaTrimestral } from "@/components/ausencias/HeatmapTrimestral";
import { HeatmapAusenciasSemana } from "@/components/ausencias/HeatmapAusenciasSemana";
import { ResumenVacaciones } from "@/components/ausencias/ResumenVacaciones";
import { useTiposAusencia } from "@/lib/hooks/useTiposAusencia";

// ── Constantes ─────────────────────────────────────────────────
// Feriado: entrada fija no gestionada desde BD
const LEYENDA_FERIADO = { id: "feriado", label: "Día feriado", color_bg: "#9ca3af", color_text: "#fff" };

const MESES = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];
const MESES_CORTO = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];


type VistaActiva = "week" | "month" | "quarter";
const VISTAS: { key: VistaActiva; label: string }[] = [
  { key: "week",    label: "Semana"    },
  { key: "month",   label: "Mes"       },
  { key: "quarter", label: "Trimestre" },
];

function getQuarter(d: Date): 1 | 2 | 3 | 4 {
  return (Math.floor(d.getMonth() / 3) + 1) as 1 | 2 | 3 | 4;
}

// ── Helpers de semana (lunes–viernes) ──────────────────────────
function getWeekStart(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // ajusta a lunes
  const start = new Date(d);
  start.setDate(d.getDate() + diff);
  return start;
}
function formatWeekLabel(d: Date): string {
  const start = getWeekStart(d);
  const end = new Date(start);
  end.setDate(start.getDate() + 4); // viernes
  const s = `${start.getDate()} ${MESES_CORTO[start.getMonth()]}`;
  const e = `${end.getDate()} ${MESES_CORTO[end.getMonth()]} ${end.getFullYear()}`;
  return `${s} – ${e}`;
}

// ── Página ─────────────────────────────────────────────────────
export default function AusenciasPage() {
  const now = new Date();
  const [rol, setRol] = useState<RolSistema | null>(null);
  const isReadOnly = rol === "Desarrollo" || rol === "planificador" || rol === "GyD" || rol === "AySr";
  const { tipos: tiposDB } = useTiposAusencia();
  // Leyenda = tipos de BD + feriado fijo al final
  const leyendaDinamica = [...tiposDB, LEYENDA_FERIADO];

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const sb = createAnyClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await sb.from("persona").select("rol_sistema").eq("auth_user_id", user.id).single();
      setRol((data?.rol_sistema as RolSistema) ?? null);
    })();
  }, []);

  const [vistaActiva, setVistaActiva] = useState<VistaActiva>("month");
  // quarter independiente para vista "Trimestre"
  const [yearAnio, setYearAnio]   = useState(now.getFullYear());
  const [quarterQ, setQuarterQ]   = useState<1|2|3|4>(getQuarter(now));
  const startMonthQ = (quarterQ - 1) * 3 + 1;

  // Datos de la vista Trimestre (HeatmapTrimestral es un componente puro sin fetch propio)
  const [personasQ, setPersonasQ]     = useState<PersonaTrimestral[]>([]);
  const [ausenciasQ, setAusenciasQ]   = useState<AusenciaTrimestral[]>([]);
  const [loadingQ, setLoadingQ]       = useState(false);

  useEffect(() => {
    if (vistaActiva !== "quarter") return;
    (async () => {
      setLoadingQ(true);
      const sb = createAnyClient();
      // Rango ampliado (+/-6 días) para cubrir las semanas de borde que HeatmapTrimestral asoma del mes anterior/siguiente
      const desde = new Date(yearAnio, startMonthQ - 1, 1 - 6).toISOString().split("T")[0];
      const hasta = new Date(yearAnio, startMonthQ + 2, 0 + 6).toISOString().split("T")[0];
      const [persRes, ausRes] = await Promise.all([
        sb.from("persona").select("id, nombre, apellido, cargo_actual, is_leverager, referente").eq("activo", true),
        sb.from("ausencia").select("persona_id, tipo, fecha_inicio, fecha_fin").lte("fecha_inicio", hasta).gte("fecha_fin", desde),
      ]);
      setPersonasQ((persRes.data ?? []) as PersonaTrimestral[]);
      setAusenciasQ((ausRes.data ?? []) as AusenciaTrimestral[]);
      setLoadingQ(false);
    })();
  }, [vistaActiva, yearAnio, quarterQ]); // eslint-disable-line react-hooks/exhaustive-deps
  // Una sola fecha pivot — cada vista deriva su rango desde aquí
  const [selectedDate, setSelectedDate] = useState<Date>(
    new Date(now.getFullYear(), now.getMonth(), 1)
  );
  const [modalOpen, setModalOpen]     = useState(false);
  const [resumenOpen, setResumenOpen] = useState(false);

  // Derivados para la vista mes
  const year  = selectedDate.getFullYear();
  const month = selectedDate.getMonth() + 1;

  // ── Navegación unificada ──────────────────────────────────────
  function navPrev() {
    if (vistaActiva === "quarter") {
      if (quarterQ === 1) { setQuarterQ(4); setYearAnio(y => y - 1); }
      else setQuarterQ(q => (q - 1) as 1|2|3|4);
      return;
    }
    const d = new Date(selectedDate);
    if (vistaActiva === "month") d.setMonth(d.getMonth() - 1);
    else                         d.setDate(d.getDate() - 7);
    setSelectedDate(d);
  }
  function navNext() {
    if (vistaActiva === "quarter") {
      if (quarterQ === 4) { setQuarterQ(1); setYearAnio(y => y + 1); }
      else setQuarterQ(q => (q + 1) as 1|2|3|4);
      return;
    }
    const d = new Date(selectedDate);
    if (vistaActiva === "month") d.setMonth(d.getMonth() + 1);
    else                         d.setDate(d.getDate() + 7);
    setSelectedDate(d);
  }
  function navHoy() {
    if (vistaActiva === "quarter") {
      setQuarterQ(getQuarter(now));
      setYearAnio(now.getFullYear());
      return;
    }
    setSelectedDate(new Date());
  }

  function getNavLabel(): string {
    if (vistaActiva === "quarter") return `Q${quarterQ} ${yearAnio}`;
    if (vistaActiva === "month")   return `${MESES[month - 1]} ${year}`;
    return formatWeekLabel(selectedDate);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header ──────────────────────────────────────────────── */}
      <header className="bg-white border-b border-[#e8e8e8] flex-shrink-0">

        <div className="h-14 flex items-center px-6 gap-4">
          <h1 className="text-[16px] font-bold text-[#1a1a1a] flex-shrink-0">Ausencias</h1>

          {/* Toggle Día / Semana / Mes */}
          <div className="flex items-center gap-1 bg-[#f3f4f6] rounded-xl p-1 flex-shrink-0">
            {VISTAS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => {
                  if (key === "quarter" && vistaActiva !== "quarter") {
                    setQuarterQ(getQuarter(now));
                    setYearAnio(now.getFullYear());
                  }
                  setVistaActiva(key);
                }}
                className="px-4 py-1.5 rounded-lg text-[12px] font-semibold transition-all duration-150"
                style={vistaActiva === key
                  ? { background: "#fff", color: "#1a1a1a", boxShadow: "0 1px 3px rgba(0,0,0,0.10)" }
                  : { background: "transparent", color: "#9ca3af" }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Navegación unificada */}
          <div className="flex items-center gap-2">
            <button
              onClick={navPrev}
              className="w-7 h-7 rounded-md border border-[#e0e0e0] bg-white flex items-center justify-center hover:bg-[#f5f5f5] transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5 text-[#555]" />
            </button>
            <span className="text-xs font-semibold text-[#1a1a1a] min-w-[170px] text-center">
              {getNavLabel()}
            </span>
            <button
              onClick={navNext}
              className="w-7 h-7 rounded-md border border-[#e0e0e0] bg-white flex items-center justify-center hover:bg-[#f5f5f5] transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5 text-[#555]" />
            </button>
            <button
              onClick={navHoy}
              className="ml-1 text-xs px-2.5 py-1 rounded-md border border-[#e0e0e0] hover:bg-[#f5f5f5] transition-colors text-[#555]"
            >
              Hoy
            </button>
          </div>

          <div className="flex-1" />

          {/* Acciones */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {rol !== "planificador" && rol !== "GyD" && rol !== "AySr" && (
              <button
                onClick={() => setResumenOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#e0e0e0] hover:bg-[#f5f5f5] rounded-lg text-[12px] font-semibold text-[#555] transition-colors"
              >
                <BarChart2 className="w-3.5 h-3.5" />
                Resumen vacaciones
              </button>
            )}
            {!isReadOnly && (
              <button
                onClick={() => setModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1a1a1a] hover:bg-[#333] rounded-lg text-[12px] font-semibold text-white transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Nueva ausencia
              </button>
            )}
          </div>
        </div>

        {/* Leyenda dinámica */}
        <div className="flex items-center gap-5 px-6 pb-3 flex-wrap">
          {leyendaDinamica.map((l) => (
            <div key={l.id} className="flex items-center gap-2 flex-shrink-0">
              <span
                className="w-3 h-3 rounded flex-shrink-0"
                style={{ background: l.color_bg, opacity: l.id === "feriado" ? 0.4 : 1 }}
              />
              <span className="text-[12px] text-[#555]">{l.label}</span>
            </div>
          ))}
        </div>
      </header>

      {/*
        ── Contenido ───────────────────────────────────────────────
        min-w-0 en ambos wrappers: son flex-items dentro de un flex-col (ver <div className="flex
        flex-col h-full"> que envuelve toda la página) y por defecto un flex-item nunca se encoge
        por debajo del ancho intrínseco de su contenido. Sin esto, la vista Trimestre (que calcula
        su ancho como % de su contenedor) heredaba un contenedor ya inflado por las ~90 micro-columnas
        y "100%" dejaba de significar el ancho real disponible en pantalla.
      */}
      <div className="flex-1 min-w-0 overflow-hidden px-2 py-4">
        <div className="h-full min-w-0 w-full max-w-full bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">

          {/* Vista Mes — HeatmapAusencias compactado */}
          {vistaActiva === "month" && (
            <HeatmapAusencias
              year={year}
              month={month}
              externalModalOpen={isReadOnly ? false : modalOpen}
              onExternalModalClose={() => setModalOpen(false)}
              readOnly={isReadOnly}
              rolActual={rol}
            />
          )}

          {/* Vista Trimestre — panorámica mes/semana/día con TOTAL y % Cuota por bloque */}
          {vistaActiva === "quarter" && (
            loadingQ ? (
              <div className="flex-1 flex items-center justify-center text-[#888] gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Cargando trimestre...</span>
              </div>
            ) : (
              <HeatmapTrimestral
                year={yearAnio}
                startMonth={startMonthQ}
                personasData={personasQ}
                ausenciasData={ausenciasQ}
                tiposDinamicos={tiposDB}
                rolActual={rol}
              />
            )
          )}

          {/* Vista Semana */}
          {vistaActiva === "week" && (
            <HeatmapAusenciasSemana
              selectedDate={selectedDate}
              externalModalOpen={isReadOnly ? false : modalOpen}
              onExternalModalClose={() => setModalOpen(false)}
              readOnly={isReadOnly}
              rolActual={rol}
            />
          )}

        </div>
      </div>

      {/* ── Panel resumen vacaciones ─────────────────────────────── */}
      <ResumenVacaciones
        open={resumenOpen}
        onClose={() => setResumenOpen(false)}
      />
    </div>
  );
}
