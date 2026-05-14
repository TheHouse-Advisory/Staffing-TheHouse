"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, X, Calendar, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  getDetailedPersonAbsences,
  COLOR_AUSENCIA,
  SENIORITY_ORDER,
  type AusenciaDetalle,
  type DetalleAusenciasPersona,
} from "@/lib/queries/ausencias";
import { calculateBusinessDays } from "@/lib/utils/date-utils";

// ─────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────

interface PersonaItem {
  id: string;
  nombre: string;
  apellido: string;
  cargo_actual: string | null;
  seniority_order: number;
}

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

function seniorityIdx(cargo: string | null): number {
  if (!cargo) return SENIORITY_ORDER.length;
  const idx = SENIORITY_ORDER.findIndex((s) => s.toLowerCase() === cargo.toLowerCase());
  return idx === -1 ? SENIORITY_ORDER.length : idx;
}

function formatRango(inicio: string, fin: string): string {
  const MESES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  const fmt = (iso: string) => {
    const [, m, d] = iso.split("-");
    return `${parseInt(d)} ${MESES[parseInt(m) - 1]}`;
  };
  return inicio === fin ? fmt(inicio) : `${fmt(inicio)} – ${fmt(fin)}`;
}

function badgeStyle(dias: number): React.CSSProperties {
  if (dias === 0)  return { background: "#f3f4f6", color: "#9ca3af" };
  if (dias >= 15)  return { background: "#fef2f2", color: "#dc2626" };
  if (dias >= 10)  return { background: "#fff7ed", color: "#ea580c" };
  return                  { background: "#eff6ff", color: "#2563eb" };
}

// ─────────────────────────────────────────────────────────────
//  Bloque de lista de ausencias (reutilizable)
// ─────────────────────────────────────────────────────────────

function AusenciasBloque({
  titulo,
  icono,
  items,
  emptyMsg,
}: {
  titulo: string;
  icono: React.ReactNode;
  items: AusenciaDetalle[];
  emptyMsg: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[#aaa]">{icono}</span>
        <p className="text-[10px] font-bold text-[#888] uppercase tracking-widest">{titulo}</p>
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-[#bbb] italic pl-1">{emptyMsg}</p>
      ) : (
        <div className="space-y-1 max-h-36 overflow-y-auto pr-0.5">
          {items.map((a) => {
            const cfg = COLOR_AUSENCIA[a.tipo];
            return (
              <div
                key={a.id}
                className="flex items-center justify-between bg-[#fafafa] rounded-lg border border-[#f0f0f0] px-2.5 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: cfg?.bg ?? "#9ca3af" }}
                  />
                  <div className="min-w-0">
                    <p className="text-[11px] text-[#333] font-semibold truncate">
                      {formatRango(a.fechaInicio, a.fechaFin)}
                    </p>
                    <p className="text-[10px] text-[#999] truncate">{a.tipoLabel}</p>
                  </div>
                </div>
                {/* numDias calculado con expandirRangoHabil → excluye feriados Chile */}
                <span className="text-[11px] font-bold text-[#555] flex-shrink-0 ml-3 bg-white border border-[#e8e8e8] rounded-md px-1.5 py-0.5">
                  {a.numDias}d
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Popover flotante (UserSummaryCard)
// ─────────────────────────────────────────────────────────────

function PopoverDetalle({
  persona,
  onClose,
}: {
  persona: PersonaItem;
  onClose: () => void;
}) {
  const [data, setData]       = useState<DetalleAusenciasPersona | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    setLoading(true);
    getDetailedPersonAbsences(supabase, persona.id).then((d) => {
      setData(d);
      setLoading(false);
    });
  }, [persona.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const initiales = `${persona.nombre[0]}${persona.apellido[0]}`;

  return (
    <>
      {/* Overlay transparente — cierra al hacer click fuera */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
      />

      {/* Tarjeta flotante centrada */}
      <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 bg-white rounded-2xl border border-[#e8e8e8] shadow-2xl overflow-hidden">

        {/* Header tarjeta */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-[#f0f0f0] bg-[#fafafa]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[#1a1a1a] flex items-center justify-center text-white text-[12px] font-bold flex-shrink-0">
              {initiales}
            </div>
            <div>
              <p className="text-[13px] font-bold text-[#1a1a1a] leading-tight">
                {persona.nombre} {persona.apellido}
              </p>
              {persona.cargo_actual && (
                <p className="text-[10px] text-[#888] mt-0.5">{persona.cargo_actual}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[#e8e8e8] text-[#bbb] hover:text-[#555] transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Cuerpo */}
        {loading ? (
          <div className="flex items-center justify-center py-10 text-[#888] gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs">Cargando...</span>
          </div>
        ) : data ? (
          <div className="px-4 py-4 space-y-4">

            {/* Sección 1: Total días (badge destacado) */}
            <div className="flex items-center justify-between bg-[#f8faff] rounded-xl border border-[#dbeafe] px-4 py-3">
              <span className="text-[12px] font-semibold text-[#3b82f6]">
                Total días consumidos
              </span>
              <span
                className="text-[18px] font-black"
                style={badgeStyle(data.totalDiasAnioActual)}
              >
                {data.totalDiasAnioActual}
              </span>
            </div>

            {/* Sección 2: Futuras */}
            <AusenciasBloque
              titulo="Próximas ausencias"
              icono={<Clock className="w-3 h-3" />}
              items={data.ausenciasFuturas}
              emptyMsg="Sin ausencias planificadas"
            />

            {/* Sección 3: Pasadas */}
            <AusenciasBloque
              titulo="Historial año actual"
              icono={<Calendar className="w-3 h-3" />}
              items={data.ausenciasPasadasAnioActual}
              emptyMsg="Sin historial este año"
            />
          </div>
        ) : null}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
//  Sidebar principal
// ─────────────────────────────────────────────────────────────

export function SidebarAusencias() {
  const [personas, setPersonas]             = useState<PersonaItem[]>([]);
  const [loading, setLoading]               = useState(true);
  const [totales, setTotales]               = useState<Record<string, number>>({});
  const [loadingTotales, setLoadingTotales] = useState(false);
  // Estado local: persona cuyo popover está abierto
  const [popoverPersona, setPopoverPersona] = useState<PersonaItem | null>(null);

  const supabase   = createClient();
  const hoy        = new Date().toISOString().split("T")[0];
  const inicioAnio = `${new Date().getFullYear()}-01-01`;

  const cargar = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("persona")
      .select("id, nombre, apellido, cargo_actual")
      .eq("activo", true)
      .order("apellido");

    if (!data) { setLoading(false); return; }

    const lista: PersonaItem[] = (data as any[]).map((p) => ({
      id: p.id,
      nombre: p.nombre,
      apellido: p.apellido,
      cargo_actual: p.cargo_actual,
      seniority_order: seniorityIdx(p.cargo_actual),
    })).sort((a, b) =>
      a.seniority_order !== b.seniority_order
        ? a.seniority_order - b.seniority_order
        : a.apellido.localeCompare(b.apellido, "es")
    );

    setPersonas(lista);
    setLoading(false);

    // Totales de días (background) — una sola query
    setLoadingTotales(true);
    const { data: ausData } = await supabase
      .from("ausencia")
      .select("persona_id, fecha_inicio, fecha_fin")
      .gte("fecha_fin", inicioAnio)
      .lte("fecha_inicio", hoy);

    if (ausData) {
      const map: Record<string, number> = {};
      for (const a of ausData as { persona_id: string; fecha_inicio: string; fecha_fin: string }[]) {
        const ini = a.fecha_inicio > inicioAnio ? a.fecha_inicio : inicioAnio;
        const fin = a.fecha_fin   < hoy         ? a.fecha_fin   : hoy;
        if (ini <= fin) map[a.persona_id] = (map[a.persona_id] ?? 0) + calculateBusinessDays(ini, fin);
      }
      setTotales(map);
    }
    setLoadingTotales(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { cargar(); }, [cargar]);

  // Agrupar por cargo
  const grupos = new Map<string, PersonaItem[]>();
  for (const p of personas) {
    const cargo = p.cargo_actual ?? "Sin cargo";
    if (!grupos.has(cargo)) grupos.set(cargo, []);
    grupos.get(cargo)!.push(p);
  }

  return (
    <>
      {/* Panel lateral */}
      <div className="w-72 flex-shrink-0 bg-white border-l border-[#e8e8e8] flex flex-col overflow-hidden">

        <div className="px-4 py-3 border-b border-[#f0f0f0] flex-shrink-0">
          <h3 className="text-[12px] font-bold text-[#1a1a1a] uppercase tracking-wide">Equipo</h3>
          <p className="text-[10px] text-[#999] mt-0.5">Días consumidos · año actual</p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-[#888] gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-xs">Cargando...</span>
            </div>
          ) : (
            Array.from(grupos.entries()).map(([cargo, equipo]) => (
              <div key={cargo}>
                <div className="px-4 py-1.5 bg-[#f7f7f7] border-y border-[#efefef]">
                  <p className="text-[9px] font-bold text-[#aaa] uppercase tracking-widest truncate">
                    {cargo}
                  </p>
                </div>

                {equipo.map((p) => {
                  const dias = totales[p.id] ?? 0;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPopoverPersona(p)}
                      className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#f9f9f9] transition-colors border-b border-[#f5f5f5] group"
                    >
                      <span className="text-[12px] font-medium text-[#1a1a1a] truncate group-hover:text-[#333] transition-colors">
                        {p.nombre} {p.apellido}
                      </span>
                      <span
                        className="flex-shrink-0 ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={badgeStyle(dias)}
                      >
                        {loadingTotales ? "…" : `${dias}d`}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Popover flotante — renderizado fuera del sidebar para no quedar recortado */}
      {popoverPersona && (
        <PopoverDetalle
          persona={popoverPersona}
          onClose={() => setPopoverPersona(null)}
        />
      )}
    </>
  );
}
