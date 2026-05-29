"use client";

import { useState, useEffect } from "react";
import { AlertTriangle, CalendarRange, CheckCircle, Loader2, Trash2, UserPlus, X } from "lucide-react";
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
  ausencias: {
    tipoLabel: string; fechaInicio: string; fechaFin: string;
    numDias: number; conflicto: boolean;
  }[];
  asigSolap: { engNombre: string; pct: number; fechaInicio: string; fechaFin: string | null }[];
}

interface PersonaOption {
  id: string;
  nombre: string;
  apellido: string;
  cargo_actual: string | null;
}

interface ReqBase {
  id: string;
  fase_nombre: string | null;
  cargo_requerido: string | null;
  pct_dedicacion: number;
  descripcion: string | null;
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

async function fetchConflictos(
  sb: any,
  personaId: string,
  engagementId: string,
  fechaInicio: string,
  fechaFin: string
) {
  const [{ data: ausData }, { data: solapData }] = await Promise.all([
    sb.from("ausencia")
      .select("persona_id, tipo, fecha_inicio, fecha_fin")
      .eq("persona_id", personaId)
      .lte("fecha_inicio", fechaFin)
      .gte("fecha_fin", fechaInicio),
    sb.from("asignacion")
      .select("persona_id, pct_dedicacion, fecha_inicio, fecha_fin, engagement:engagement_id(nombre)")
      .eq("persona_id", personaId)
      .neq("engagement_id", engagementId)
      .eq("estado", "activa")
      .lte("fecha_inicio", fechaFin)
      .or(`fecha_fin.gte.${fechaInicio},fecha_fin.is.null`),
  ]);
  return { ausData: ausData ?? [], solapData: solapData ?? [] };
}

// ─── Props ────────────────────────────────────────────────────

interface Props {
  engagementId: string;
  engagementTipo?: string;
  onExtended?: () => void;
  onFechaFinChange?: (fecha: string) => void; // actualiza fecha_fin_estimada del form padre
}

// ─── Component ────────────────────────────────────────────────

export function ExtenderProyecto({ engagementId, engagementTipo, onExtended, onFechaFinChange }: Props) {
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [personas, setPersonas] = useState<ExtPersona[]>([]);
  const [reqs, setReqs] = useState<ReqBase[]>([]);
  const [loading, setLoading] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [exito, setExito] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Extensiones ya guardadas para este engagement
  const [extensionesGuardadas, setExtensionesGuardadas] = useState<{ id: string; fecha_inicio: string; fecha_fin: string }[]>([]);

  async function cargarExtensiones() {
    const sb = createAnyClient();
    const { data } = await (sb as any)
      .from("engagement_extension")
      .select("id, fecha_inicio, fecha_fin")
      .eq("engagement_id", engagementId)
      .order("fecha_inicio");
    setExtensionesGuardadas(data ?? []);
  }

  useEffect(() => { cargarExtensiones(); }, [engagementId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function eliminarExtension(id: string) {
    const sb = createAnyClient();
    await (sb as any).from("engagement_extension").delete().eq("id", id);
    setExtensionesGuardadas((prev) => prev.filter((e) => e.id !== id));
    window.dispatchEvent(new CustomEvent("engagementChanged", { detail: { engagementId } }));
  }

  // Picker para añadir más personas
  const [allPersonas, setAllPersonas] = useState<PersonaOption[]>([]);
  const [selectedAdd, setSelectedAdd] = useState("");
  const [addingPersona, setAddingPersona] = useState(false);

  // Carga todas las personas activas una vez para el picker
  useEffect(() => {
    const sb = createAnyClient();
    (sb as any)
      .from("persona")
      .select("id, nombre, apellido, cargo_actual")
      .eq("estado", "activo")
      .order("apellido")
      .then(({ data }: any) => setAllPersonas(data ?? []));
  }, []);

  // Reset cuando cambia el engagement
  useEffect(() => {
    setFechaInicio(""); setFechaFin(""); setPersonas([]); setReqs([]);
    setExito(false); setError(null); setSelectedAdd("");
  }, [engagementId]);

  // Carga equipo + conflictos cuando ambas fechas están definidas
  useEffect(() => {
    if (!fechaInicio || !fechaFin || fechaFin < fechaInicio) {
      setPersonas([]); setReqs([]);
      return;
    }
    let cancelled = false;

    async function load() {
      setLoading(true);
      setExito(false);
      setError(null);
      const sb = createAnyClient();

      // Equipo actual (asignaciones activas)
      const { data: asigData } = await (sb as any)
        .from("asignacion")
        .select("persona_id, pct_dedicacion, cargo_al_momento, persona:persona_id(nombre, apellido)")
        .eq("engagement_id", engagementId)
        .eq("estado", "activa");

      if (cancelled) return;

      // Dedup por personaId (la persona más reciente)
      const seen = new Set<string>();
      const unique = ((asigData ?? []) as any[]).filter((a) => {
        if (seen.has(a.persona_id)) return false;
        seen.add(a.persona_id); return true;
      });

      // Requerimientos base (deduplicados) para copiar al período extendido — todos los tipos
      const { data: reqData } = await (sb as any)
        .from("requerimiento_engagement")
        .select("id, fase_nombre, cargo_requerido, pct_dedicacion, descripcion")
        .eq("engagement_id", engagementId);
      if (!cancelled) {
        const seenReq = new Set<string>();
        const uniqueReqs = ((reqData ?? []) as any[]).filter((r: any) => {
          const key = `${r.fase_nombre}|${r.cargo_requerido}|${r.pct_dedicacion}`;
          if (seenReq.has(key)) return false;
          seenReq.add(key); return true;
        });
        setReqs(uniqueReqs as ReqBase[]);
      }

      if (unique.length === 0) { setPersonas([]); setLoading(false); return; }

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
  }, [fechaInicio, fechaFin, engagementId, engagementTipo]);

  // Eliminar persona de la lista
  function removePersona(personaId: string) {
    setPersonas((prev) => prev.filter((p) => p.personaId !== personaId));
  }

  // Añadir persona extra con verificación de conflictos
  async function addPersona(personaId: string) {
    if (!personaId || !fechaInicio || !fechaFin) return;
    if (personas.some((p) => p.personaId === personaId)) {
      setSelectedAdd(""); return;
    }
    const opt = allPersonas.find((a) => a.id === personaId);
    if (!opt) { setSelectedAdd(""); return; }

    setAddingPersona(true);
    const sb = createAnyClient();
    const { ausData, solapData } = await fetchConflictos(sb, personaId, engagementId, fechaInicio, fechaFin);

    const newP: ExtPersona = {
      personaId: opt.id,
      nombre: opt.nombre,
      apellido: opt.apellido,
      cargo: opt.cargo_actual ?? "",
      pct: 100,
      ausencias: (ausData as any[]).map((aus: any) => {
        const tipo = aus.tipo as TipoAusencia;
        return {
          tipoLabel: COLOR_AUSENCIA[tipo]?.label ?? aus.tipo,
          fechaInicio: aus.fecha_inicio,
          fechaFin: aus.fecha_fin,
          numDias: expandirRango(aus.fecha_inicio, aus.fecha_fin).length,
          conflicto: aus.fecha_inicio <= fechaFin && aus.fecha_fin >= fechaInicio,
        };
      }),
      asigSolap: (solapData as any[]).map((s: any) => ({
        engNombre: (s.engagement as any)?.nombre ?? "otro proyecto",
        pct: Number(s.pct_dedicacion),
        fechaInicio: s.fecha_inicio,
        fechaFin: s.fecha_fin ?? null,
      })),
    };

    setPersonas((prev) => [...prev, newP]);
    setSelectedAdd("");
    setAddingPersona(false);
  }

  async function guardar() {
    // Solo requiere fechas válidas — el equipo es opcional
    if (!fechaInicio || !fechaFin) return;
    setGuardando(true);
    setError(null);
    const sb = createAnyClient();

    // 0. Registrar el período de extensión (período independiente, sin tocar fecha_fin_estimada)
    //    No actualizamos fecha_fin_estimada para preservar el fin original y permitir gaps visuales
    const { error: extErr } = await (sb as any)
      .from("engagement_extension")
      .insert({ engagement_id: engagementId, fecha_inicio: fechaInicio, fecha_fin: fechaFin });
    if (extErr) { setError(extErr.message); setGuardando(false); return; }

    // 1. Crear requerimientos para el período extendido (solo si hay reqs que copiar)
    const reqPool = new Map<string, string[]>();
    if (reqs.length > 0) {
      const { data: newReqs, error: reqErr } = await (sb as any)
        .from("requerimiento_engagement")
        .insert(
          reqs.map((r) => ({
            engagement_id: engagementId,
            fase_nombre: r.fase_nombre,
            cargo_requerido: r.cargo_requerido,
            pct_dedicacion: r.pct_dedicacion,
            fecha_inicio: fechaInicio,
            fecha_fin: fechaFin,
            descripcion: r.descripcion ?? null,
          }))
        )
        .select("id, cargo_requerido");
      if (reqErr) { setError(reqErr.message); setGuardando(false); return; }
      for (const r of (newReqs ?? []) as any[]) {
        const key = r.cargo_requerido ?? "__any__";
        if (!reqPool.has(key)) reqPool.set(key, []);
        reqPool.get(key)!.push(r.id);
      }
    }

    // 2. Crear asignaciones para el equipo del período extendido (solo si hay personas)
    if (personas.length > 0) {
      const { error: err } = await (sb as any).from("asignacion").insert(
        personas.map((p) => {
          const pool = reqPool.get(p.cargo) ?? reqPool.get("__any__") ?? [];
          const requerimiento_id = pool.shift() ?? null;
          return {
            engagement_id: engagementId,
            persona_id: p.personaId,
            cargo_al_momento: p.cargo,
            pct_dedicacion: p.pct,
            fecha_inicio: fechaInicio,
            fecha_fin: fechaFin,
            estado: "activa",
            requerimiento_id,
          };
        })
      );
      if (err) { setError(err.message); setGuardando(false); return; }
    }

    setGuardando(false);
    setExito(true);
    await cargarExtensiones();
    // Usa el mismo camino confiable que el formulario principal: onExtended → onSuccess → refresh()
    onExtended?.();
  }

  const tieneAlgo = personas.length > 0 || reqs.length > 0;
  // Personas ya incluidas en el picker (para ocultarlas del dropdown)
  const idsEnLista = new Set(personas.map((p) => p.personaId));
  const opcionesAdd = allPersonas.filter((a) => !idsEnLista.has(a.id));

  return (
    <div className="space-y-4">
      <p className="text-xs text-[#aaa] leading-relaxed">
        Define el período. El equipo actual se añade automáticamente — puedes quitar personas o agregar más. Se verifican ausencias y solapamientos.
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

      {/* Lista de personas + picker */}
      {fechaInicio && fechaFin && (
        <>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-[#aaa]">
              <Loader2 className="w-4 h-4 animate-spin text-[#4a90e2]" />
              <span className="text-xs">Verificando equipo y conflictos…</span>
            </div>
          ) : (
            <div className="space-y-2.5">
              {/* Header */}
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold text-[#888] uppercase tracking-widest">
                  {personas.length === 0
                    ? "Sin equipo actual"
                    : `Equipo a extender · ${personas.length} persona${personas.length !== 1 ? "s" : ""}`}
                </p>
                {reqs.length > 0 && (
                  <span className="text-[10px] text-[#4a90e2] font-medium">
                    + {reqs.length} req{reqs.length !== 1 ? "s" : ""} copiado{reqs.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {/* Tarjetas del equipo */}
              {personas.map((p) => {
                const tieneConflicto = p.ausencias.some((a) => a.conflicto) || p.asigSolap.length > 0;
                const color = avatarColor(p.personaId);
                return (
                  <div
                    key={p.personaId}
                    className="border rounded-xl p-3 space-y-2"
                    style={{
                      borderColor: tieneConflicto ? "#fca5a5" : "#c7d9f4",
                      background: tieneConflicto ? "#fff8f8" : "#f8fbff",
                    }}
                  >
                    {/* Fila persona */}
                    <div className="flex items-center gap-2.5">
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
                        <p className="text-[10px] text-[#888]">{p.cargo || "Sin cargo"}</p>
                      </div>
                      <span className="flex-shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#dbeafe] text-[#1d4ed8]">
                        {p.pct}%
                      </span>
                      {/* Botón quitar */}
                      <button
                        onClick={() => removePersona(p.personaId)}
                        title="Quitar de la extensión"
                        className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[#ccc] hover:text-red-400 hover:bg-red-50 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Alertas ausencia */}
                    {p.ausencias.filter((a) => a.conflicto).map((a, j) => (
                      <div
                        key={`aus-${j}`}
                        className="flex items-start gap-1.5 text-[10px] rounded px-2 py-1.5 leading-tight bg-red-50 text-red-700"
                      >
                        <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-px text-red-500" />
                        <span>
                          <strong className="font-semibold">Ausencia en el período · </strong>
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
                          También en <em>{s.engNombre}</em> al {s.pct}%
                          {s.fechaInicio && ` · ${fmtDate(s.fechaInicio)} → ${s.fechaFin ? fmtDate(s.fechaFin) : "∞"}`}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}

              {/* Picker: añadir persona */}
              {opcionesAdd.length > 0 && (
                <div className="flex items-center gap-2 pt-1">
                  <UserPlus className="w-3.5 h-3.5 text-[#4a90e2] flex-shrink-0" />
                  <select
                    value={selectedAdd}
                    onChange={(e) => {
                      setSelectedAdd(e.target.value);
                      if (e.target.value) addPersona(e.target.value);
                    }}
                    disabled={addingPersona}
                    className="flex-1 text-xs border border-[#e8e8e8] rounded-lg px-2 py-1.5 bg-white text-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#4a90e2]"
                  >
                    <option value="">Añadir otra persona…</option>
                    {opcionesAdd.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.apellido}, {a.nombre}{a.cargo_actual ? ` · ${a.cargo_actual}` : ""}
                      </option>
                    ))}
                  </select>
                  {addingPersona && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#4a90e2] flex-shrink-0" />}
                </div>
              )}

              {/* Aviso si no hay equipo ni reqs */}
              {personas.length === 0 && reqs.length === 0 && (
                <p className="text-xs text-[#aaa] italic text-center py-2">
                  Sin equipo ni requerimientos en este engagement. Añade personas arriba.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* Extensiones guardadas */}
      {extensionesGuardadas.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-[#888] uppercase tracking-widest flex items-center gap-1.5">
            <CalendarRange className="w-3 h-3" /> Extensiones registradas
          </p>
          {extensionesGuardadas.map((ex) => (
            <div key={ex.id} className="flex items-center justify-between rounded-lg border border-[#c7d9f4] bg-[#f8fbff] px-3 py-2">
              <span className="text-xs text-[#1a1a2e]">
                {fmtDate(ex.fecha_inicio)} → {fmtDate(ex.fecha_fin)}
              </span>
              <button
                onClick={() => eliminarExtension(ex.id)}
                title="Eliminar extensión"
                className="text-[#ccc] hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Éxito */}
      {exito && (
        <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-xs text-green-700 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>
              Extensión guardada · tablero actualizado
              {personas.length > 0 && ` — ${personas.length} asignación${personas.length !== 1 ? "es" : ""}`}
              {reqs.length > 0 && ` · ${reqs.length} req${reqs.length !== 1 ? "s" : ""}`}
            </span>
          </div>
          <button
            onClick={() => {
              setExito(false);
              setFechaInicio(""); setFechaFin("");
              setPersonas([]); setReqs([]);
            }}
            className="text-[10px] font-medium underline text-green-600 hover:text-green-800 flex-shrink-0"
          >
            Nueva extensión
          </button>
        </div>
      )}

      {/* Botón guardar — disponible con solo tener fechas válidas */}
      {fechaInicio && fechaFin && !exito && !loading && (
        <div className="flex justify-end pt-1">
          <Button
            onClick={guardar}
            loading={guardando}
            disabled={guardando}
          >
            Guardar extensión
            {personas.length > 0 && ` (${personas.length} persona${personas.length !== 1 ? "s" : ""})`}
          </Button>
        </div>
      )}
    </div>
  );
}
