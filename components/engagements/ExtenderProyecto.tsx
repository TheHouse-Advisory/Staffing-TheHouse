"use client";

import { useState, useEffect } from "react";
import { AlertTriangle, CalendarX, CheckCircle, Loader2 } from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { FieldWrapper, Input } from "@/components/ui/FormField";
import { expandirRango, COLOR_AUSENCIA } from "@/lib/queries/ausencias";
import type { TipoAusencia } from "@/lib/types/database";

// ─── Types ────────────────────────────────────────────────────

interface ExtPersona {
  personaId: string;
  nombre: string;
  apellido: string;
  cargo: string;
  pct: number;
  incluir: boolean;
  ausencias: {
    tipoLabel: string; fechaInicio: string; fechaFin: string;
    numDias: number; conflicto: boolean;
  }[];
  asigSolap: { engNombre: string; pct: number; fechaInicio: string; fechaFin: string | null }[];
}

// ─── Helpers ──────────────────────────────────────────────────

function fmtDate(d: string) {
  try {
    const [y, m, day] = d.split("-");
    const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
    return `${parseInt(day)} ${meses[parseInt(m) - 1]} ${y.slice(2)}`;
  } catch { return d; }
}

function avatarColor(id: string) {
  const palette = ["#4a90e2","#e2844a","#4ac27a","#9b4ae2","#e24a7a"];
  let h = 0;
  for (const c of id) h = (h << 5) - h + c.charCodeAt(0);
  return palette[Math.abs(h) % palette.length];
}

// ─── Component ────────────────────────────────────────────────

interface Props {
  engagementId: string;
  onExtended?: () => void;
}

export function ExtenderProyecto({ engagementId, onExtended }: Props) {
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [personas, setPersonas] = useState<ExtPersona[]>([]);
  const [loading, setLoading] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [exito, setExito] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reload when engagement changes (e.g. parent re-opens)
  useEffect(() => {
    setFechaInicio(""); setFechaFin(""); setPersonas([]);
    setExito(false); setError(null);
  }, [engagementId]);

  // Auto-load team + conflict check when both dates are set
  useEffect(() => {
    if (!fechaInicio || !fechaFin || fechaFin < fechaInicio) {
      setPersonas([]);
      return;
    }
    let cancelled = false;

    async function load() {
      setLoading(true);
      setExito(false);
      setError(null);
      const sb = createAnyClient();

      const { data: asigData } = await (sb as any)
        .from("asignacion")
        .select("persona_id, pct_dedicacion, cargo_al_momento, persona:persona_id(nombre, apellido)")
        .eq("engagement_id", engagementId)
        .eq("estado", "activa");

      if (cancelled) return;

      // Dedup by personaId
      const seen = new Set<string>();
      const unique = ((asigData ?? []) as any[]).filter((a) => {
        if (seen.has(a.persona_id)) return false;
        seen.add(a.persona_id); return true;
      });

      if (unique.length === 0) {
        setPersonas([]); setLoading(false); return;
      }

      const ids = unique.map((a: any) => a.persona_id as string);

      const [{ data: ausData }, { data: solapData }] = await Promise.all([
        (sb as any)
          .from("ausencia")
          .select("persona_id, tipo, fecha_inicio, fecha_fin")
          .in("persona_id", ids)
          .lte("fecha_inicio", fechaFin)
          .gte("fecha_fin", fechaInicio),
        (sb as any)
          .from("asignacion")
          .select("persona_id, pct_dedicacion, fecha_inicio, fecha_fin, engagement:engagement_id(nombre)")
          .in("persona_id", ids)
          .neq("engagement_id", engagementId)
          .eq("estado", "activa")
          .lte("fecha_inicio", fechaFin)
          .or(`fecha_fin.gte.${fechaInicio},fecha_fin.is.null`),
      ]);

      if (cancelled) return;

      const ausMap = new Map<string, any[]>();
      for (const a of (ausData ?? []) as any[]) {
        if (!ausMap.has(a.persona_id)) ausMap.set(a.persona_id, []);
        ausMap.get(a.persona_id)!.push(a);
      }
      const solapMap = new Map<string, any[]>();
      for (const a of (solapData ?? []) as any[]) {
        if (!solapMap.has(a.persona_id)) solapMap.set(a.persona_id, []);
        solapMap.get(a.persona_id)!.push(a);
      }

      const ps: ExtPersona[] = unique.map((a: any) => ({
        personaId: a.persona_id,
        nombre: a.persona?.nombre ?? "—",
        apellido: a.persona?.apellido ?? "",
        cargo: a.cargo_al_momento ?? "",
        pct: Number(a.pct_dedicacion),
        incluir: true,
        ausencias: (ausMap.get(a.persona_id) ?? []).map((aus: any) => {
          const tipo = aus.tipo as TipoAusencia;
          return {
            tipoLabel: COLOR_AUSENCIA[tipo]?.label ?? aus.tipo,
            fechaInicio: aus.fecha_inicio,
            fechaFin: aus.fecha_fin,
            numDias: expandirRango(aus.fecha_inicio, aus.fecha_fin).length,
            conflicto: aus.fecha_inicio <= fechaFin && aus.fecha_fin >= fechaInicio,
          };
        }),
        asigSolap: (solapMap.get(a.persona_id) ?? []).map((s: any) => ({
          engNombre: (s.engagement as any)?.nombre ?? "otro proyecto",
          pct: Number(s.pct_dedicacion),
          fechaInicio: s.fecha_inicio,
          fechaFin: s.fecha_fin ?? null,
        })),
      }));

      setPersonas(ps);
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [fechaInicio, fechaFin, engagementId]);

  async function guardar() {
    const toInsert = personas.filter((p) => p.incluir);
    if (toInsert.length === 0) return;
    setGuardando(true);
    setError(null);
    const sb = createAnyClient();

    const { error: err } = await (sb as any).from("asignacion").insert(
      toInsert.map((p) => ({
        engagement_id: engagementId,
        persona_id: p.personaId,
        cargo_al_momento: p.cargo,
        pct_dedicacion: p.pct,
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin,
        estado: "activa",
      }))
    );

    if (err) { setError(err.message); setGuardando(false); return; }
    setExito(true);
    setGuardando(false);
    onExtended?.();
  }

  const seleccionados = personas.filter((p) => p.incluir).length;

  return (
    <div className="space-y-4">
      <p className="text-xs text-[#aaa] leading-relaxed">
        Define el nuevo período. El equipo actual se cargará automáticamente y se verificarán conflictos antes de guardar.
      </p>

      {/* Fechas */}
      <div className="grid grid-cols-2 gap-3">
        <FieldWrapper label="Inicio del alargue">
          <Input
            type="date"
            value={fechaInicio}
            onChange={(e) => setFechaInicio(e.target.value)}
            max={fechaFin || undefined}
          />
        </FieldWrapper>
        <FieldWrapper label="Fin del alargue">
          <Input
            type="date"
            value={fechaFin}
            onChange={(e) => setFechaFin(e.target.value)}
            min={fechaInicio || undefined}
          />
        </FieldWrapper>
      </div>

      {/* Lista de personas */}
      {fechaInicio && fechaFin && (
        <>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-[#aaa]">
              <Loader2 className="w-4 h-4 animate-spin text-[#4a90e2]" />
              <span className="text-xs">Verificando equipo y conflictos…</span>
            </div>
          ) : personas.length === 0 ? (
            <p className="text-xs text-[#aaa] italic text-center py-4">
              Sin asignaciones activas en este engagement.
            </p>
          ) : (
            <div className="space-y-2.5">
              <p className="text-[10px] font-semibold text-[#888] uppercase tracking-widest">
                Equipo propuesto · {seleccionados}/{personas.length} seleccionados
              </p>
              {personas.map((p, i) => {
                const tieneConflicto = p.ausencias.some((a) => a.conflicto) || p.asigSolap.length > 0;
                const color = avatarColor(p.personaId);
                return (
                  <div
                    key={p.personaId}
                    className="border rounded-xl p-3 space-y-2"
                    style={{
                      borderColor: tieneConflicto ? "#fca5a5" : p.incluir ? "#c7d9f4" : "#e8e8e8",
                      background:  tieneConflicto ? "#fff8f8" : p.incluir ? "#f8fbff" : "#fafafa",
                    }}
                  >
                    {/* Fila persona */}
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={p.incluir}
                        onChange={(e) =>
                          setPersonas((ps) => ps.map((x, j) => j === i ? { ...x, incluir: e.target.checked } : x))
                        }
                        className="w-4 h-4 flex-shrink-0 accent-[#4a90e2]"
                      />
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0"
                        style={{ background: color }}
                      >
                        {(p.nombre[0] ?? "").toUpperCase()}{(p.apellido[0] ?? "").toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-[#1a1a2e] truncate">
                          {p.nombre} {p.apellido}
                        </p>
                        <p className="text-[10px] text-[#888]">{p.cargo}</p>
                      </div>
                      <span className="flex-shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#dbeafe] text-[#1d4ed8]">
                        {p.pct}%
                      </span>
                    </div>

                    {/* Alertas ausencia */}
                    {p.ausencias.map((a, j) => (
                      <div
                        key={`aus-${j}`}
                        className={`flex items-start gap-1.5 text-[10px] rounded px-2 py-1.5 leading-tight ${
                          a.conflicto ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {a.conflicto
                          ? <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-px text-red-500" />
                          : <CalendarX className="w-3 h-3 flex-shrink-0 mt-px text-amber-500" />
                        }
                        <span>
                          {a.conflicto && <strong className="font-semibold">Ausencia en período · </strong>}
                          {a.tipoLabel} · {fmtDate(a.fechaInicio)} → {fmtDate(a.fechaFin)}{" "}
                          <span className="font-semibold">({a.numDias}d hábiles)</span>
                        </span>
                      </div>
                    ))}

                    {/* Alertas sobrecarga */}
                    {p.asigSolap.map((s, j) => (
                      <div
                        key={`sol-${j}`}
                        className="flex items-start gap-1.5 text-[10px] rounded px-2 py-1.5 leading-tight bg-orange-50 text-orange-700"
                      >
                        <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-px text-orange-500" />
                        <span>
                          <strong className="font-semibold">Carga alta · </strong>
                          Asignado a <em>{s.engNombre}</em> al {s.pct}%
                          {s.fechaInicio && ` (${fmtDate(s.fechaInicio)} → ${s.fechaFin ? fmtDate(s.fechaFin) : "∞"})`}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Error */}
      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Éxito */}
      {exito && (
        <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-xs text-green-700 flex items-center gap-2">
          <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
          Extensión guardada — {seleccionados} asignación{seleccionados !== 1 ? "es" : ""} creada{seleccionados !== 1 ? "s" : ""}.
        </div>
      )}

      {/* Botón guardar */}
      {personas.length > 0 && !exito && (
        <div className="flex justify-end pt-1">
          <Button
            onClick={guardar}
            loading={guardando}
            disabled={seleccionados === 0 || guardando}
          >
            Guardar extensión ({seleccionados} persona{seleccionados !== 1 ? "s" : ""})
          </Button>
        </div>
      )}
    </div>
  );
}
