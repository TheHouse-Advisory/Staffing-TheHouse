"use client";

import { useEffect, useState } from "react";
import { format, isSameDay, parseISO, startOfDay, addDays, subDays } from "date-fns";
import { es } from "date-fns/locale";
import { PartyPopper, Clock, CheckCircle2, Circle, ChevronDown, ChevronUp, Trash2, Cake, ClipboardCheck } from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";

// ── Tipos ────────────────────────────────────────────────────────

interface PersonaAniversario {
  id: string;
  nombre: string;
  apellido: string;
  cargo_actual: string | null;
  fecha_ingreso: string;
  años: number;
  fechaAniversario: Date;
}

interface PersonaCumpleanos {
  id: string;
  nombre: string;
  apellido: string;
  cargo_actual: string | null;
  fecha_nacimiento: string;
  edad: number;
  fechaCumple: Date;
}

interface AlertaEPP {
  engagement_id: string;
  engagement_nombre: string;
  cliente: string;
  fecha_fin: string;
  tipo: "por_terminar" | "recien_terminado";
  dias: number; // días restantes (por_terminar) o días desde fin (recien_terminado)
  personas: { id: string; nombre: string; apellido: string; cargo_actual: string | null }[];
}

interface AlertaChecked {
  alertaId: string;
  tipo: string;
  descripcion: string;
  fechaCheck: string;
}

const LS_KEY = "staffinghub_alertas_checked";

function leerChecks(): AlertaChecked[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]"); } catch { return []; }
}

function guardarChecks(checks: AlertaChecked[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(checks));
}

// ── Helpers de fecha ─────────────────────────────────────────────

function proximoAniversario(fechaIngreso: string, desde: Date): Date {
  const ingreso = parseISO(fechaIngreso);
  const aniv = new Date(desde.getFullYear(), ingreso.getMonth(), ingreso.getDate());
  if (aniv < startOfDay(desde)) aniv.setFullYear(aniv.getFullYear() + 1);
  return aniv;
}

function añosEn(fechaIngreso: string, enFecha: Date): number {
  return enFecha.getFullYear() - parseISO(fechaIngreso).getFullYear();
}

function proximoCumpleanos(fechaNac: string, desde: Date): Date {
  const nac = parseISO(fechaNac);
  const cumple = new Date(desde.getFullYear(), nac.getMonth(), nac.getDate());
  if (cumple < startOfDay(desde)) cumple.setFullYear(cumple.getFullYear() + 1);
  return cumple;
}

function edadEn(fechaNac: string, enFecha: Date): number {
  return enFecha.getFullYear() - parseISO(fechaNac).getFullYear();
}

function alertaId(tipo: string, personaId: string, año: number) {
  return `${tipo}-${personaId}-${año}`;
}

function diffDiasEntre(a: Date, b: Date) {
  return Math.ceil((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

// ── Tarjeta aniversario ──────────────────────────────────────────

function TarjetaAniversario({
  p, esHoy, diffDias, checked, onCheck,
}: {
  p: PersonaAniversario; esHoy: boolean; diffDias?: number; checked: boolean; onCheck: () => void;
}) {
  return (
    <div className={`flex items-start gap-4 p-4 rounded-xl border-2 transition-all ${
      checked ? "border-gray-100 bg-gray-50 opacity-60"
      : esHoy ? "border-[#4a90e2]/30 bg-[#eaf4ff]"
      : "border-gray-100 bg-white hover:bg-gray-50"
    }`}>
      <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
        style={{ backgroundColor: esHoy ? "#4a90e2" : "#94a3b8" }}>
        {p.nombre[0]}{p.apellido[0]}
      </div>
      <div className="flex-1">
        {esHoy ? (
          <p className={`font-semibold text-[#1a1a2e] ${checked ? "line-through text-gray-400" : ""}`}>
            🎉 Felicita a <span className={checked ? "" : "text-[#4a90e2]"}>{p.nombre} {p.apellido}</span>{" "}
            por cumplir <span className="font-bold">{p.años} {p.años === 1 ? "año" : "años"}</span> en la empresa
          </p>
        ) : (
          <p className={`font-semibold text-[#1a1a2e] ${checked ? "line-through text-gray-400" : ""}`}>
            {p.nombre} {p.apellido}
            <span className="ml-2 text-xs font-normal text-gray-400">
              cumple <span className="font-semibold text-[#1a1a2e]">{p.años} {p.años === 1 ? "año" : "años"}</span> en la empresa
            </span>
          </p>
        )}
        <p className="text-xs text-gray-400 mt-0.5">
          {esHoy ? (
            <>Ingresó el {format(parseISO(p.fecha_ingreso), "d 'de' MMMM 'de' yyyy", { locale: es })}</>
          ) : (
            <>
              El <span className="font-medium text-gray-600">{format(p.fechaAniversario, "d 'de' MMMM", { locale: es })}</span>
              {diffDias !== undefined && (
                <span className="ml-2 text-[#4a90e2] font-medium">en {diffDias} {diffDias === 1 ? "día" : "días"}</span>
              )}
            </>
          )}
          {p.cargo_actual && <span className="ml-2 text-gray-300">· {p.cargo_actual}</span>}
        </p>
      </div>
      <button onClick={onCheck} title={checked ? "Desmarcar" : "Marcar como gestionado"}
        className="flex-shrink-0 transition-transform hover:scale-110">
        {checked
          ? <CheckCircle2 className="w-6 h-6 text-[#27ae60]" />
          : <Circle className="w-6 h-6 text-gray-300 hover:text-[#27ae60]" />}
      </button>
    </div>
  );
}

// ── Tarjeta cumpleaños ───────────────────────────────────────────

function TarjetaCumpleanos({
  p, esHoy, diffDias, checked, onCheck,
}: {
  p: PersonaCumpleanos; esHoy: boolean; diffDias?: number; checked: boolean; onCheck: () => void;
}) {
  return (
    <div className={`flex items-start gap-4 p-4 rounded-xl border-2 transition-all ${
      checked ? "border-gray-100 bg-gray-50 opacity-60"
      : esHoy ? "border-[#e2884a]/30 bg-[#fff7f0]"
      : "border-gray-100 bg-white hover:bg-gray-50"
    }`}>
      <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
        style={{ backgroundColor: esHoy ? "#e2884a" : "#94a3b8" }}>
        {p.nombre[0]}{p.apellido[0]}
      </div>
      <div className="flex-1">
        {esHoy ? (
          <p className={`font-semibold text-[#1a1a2e] ${checked ? "line-through text-gray-400" : ""}`}>
            🎂 Felicita a <span className={checked ? "" : "text-[#e2884a]"}>{p.nombre} {p.apellido}</span>{" "}
            por sus <span className="font-bold">{p.edad} años</span>
          </p>
        ) : (
          <p className={`font-semibold text-[#1a1a2e] ${checked ? "line-through text-gray-400" : ""}`}>
            {p.nombre} {p.apellido}
            <span className="ml-2 text-xs font-normal text-gray-400">
              cumple <span className="font-semibold text-[#1a1a2e]">{p.edad} años</span>
            </span>
          </p>
        )}
        <p className="text-xs text-gray-400 mt-0.5">
          {esHoy ? (
            <>Nació el {format(parseISO(p.fecha_nacimiento), "d 'de' MMMM 'de' yyyy", { locale: es })}</>
          ) : (
            <>
              El <span className="font-medium text-gray-600">{format(p.fechaCumple, "d 'de' MMMM", { locale: es })}</span>
              {diffDias !== undefined && (
                <span className="ml-2 text-[#e2884a] font-medium">en {diffDias} {diffDias === 1 ? "día" : "días"}</span>
              )}
            </>
          )}
          {p.cargo_actual && <span className="ml-2 text-gray-300">· {p.cargo_actual}</span>}
        </p>
      </div>
      <button onClick={onCheck} title={checked ? "Desmarcar" : "Marcar como gestionado"}
        className="flex-shrink-0 transition-transform hover:scale-110">
        {checked
          ? <CheckCircle2 className="w-6 h-6 text-[#27ae60]" />
          : <Circle className="w-6 h-6 text-gray-300 hover:text-[#27ae60]" />}
      </button>
    </div>
  );
}

// ── Tarjeta EPP ──────────────────────────────────────────────────

function TarjetaEPP({
  alerta, checked, onCheck,
}: {
  alerta: AlertaEPP; checked: boolean; onCheck: () => void;
}) {
  const porTerminar = alerta.tipo === "por_terminar";
  const color = "#7c5cbf";
  const bgCard = porTerminar ? "border-[#7c5cbf]/30 bg-[#f5f0ff]" : "border-[#27ae60]/30 bg-[#f0fdf4]";
  const labelColor = porTerminar ? color : "#27ae60";

  return (
    <div className={`flex items-start gap-4 p-4 rounded-xl border-2 transition-all ${
      checked ? "border-gray-100 bg-gray-50 opacity-60" : bgCard
    }`}>
      {/* Icono */}
      <div className="w-10 h-10 rounded-full flex items-center justify-center text-white flex-shrink-0"
        style={{ backgroundColor: checked ? "#94a3b8" : labelColor }}>
        <ClipboardCheck className="w-5 h-5" />
      </div>

      {/* Contenido */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <p className={`font-semibold text-[#1a1a2e] ${checked ? "line-through text-gray-400" : ""}`}>
            EPP pendiente —{" "}
            <span style={{ color: checked ? undefined : labelColor }}>{alerta.engagement_nombre}</span>
          </p>
          <span className="text-xs px-2 py-0.5 rounded-full font-semibold flex-shrink-0"
            style={{ background: checked ? "#f0f0f0" : porTerminar ? "#ede9fe" : "#dcf5e7",
                     color: checked ? "#aaa" : labelColor }}>
            {porTerminar
              ? alerta.dias === 0 ? "Termina hoy" : `Termina en ${alerta.dias} ${alerta.dias === 1 ? "día" : "días"}`
              : alerta.dias === 0 ? "Terminó hoy" : `Terminó hace ${alerta.dias} ${alerta.dias === 1 ? "día" : "días"}`
            }
          </span>
        </div>
        {alerta.cliente && (
          <p className="text-xs text-gray-400 mb-2">{alerta.cliente}</p>
        )}
        {/* Personas involucradas */}
        {alerta.personas.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {alerta.personas.map((p) => (
              <span key={p.id}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-white border border-gray-200 text-gray-600 font-medium">
                <span className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0"
                  style={{ backgroundColor: labelColor }}>
                  {p.nombre[0]}{p.apellido[0]}
                </span>
                {p.nombre} {p.apellido}
                {p.cargo_actual && <span className="text-gray-300">· {p.cargo_actual}</span>}
              </span>
            ))}
          </div>
        )}
        <p className="text-xs text-gray-400 mt-1.5">
          Fin: <span className="font-medium text-gray-600">
            {format(parseISO(alerta.fecha_fin), "d 'de' MMMM yyyy", { locale: es })}
          </span>
        </p>
      </div>

      <button onClick={onCheck} title={checked ? "Desmarcar" : "Marcar como gestionado"}
        className="flex-shrink-0 transition-transform hover:scale-110">
        {checked
          ? <CheckCircle2 className="w-6 h-6 text-[#27ae60]" />
          : <Circle className="w-6 h-6 text-gray-300 hover:text-[#27ae60]" />}
      </button>
    </div>
  );
}

// ── Panel principal ──────────────────────────────────────────────

export function AlertasPanel() {
  const [anivHoy, setAnivHoy] = useState<PersonaAniversario[]>([]);
  const [anivProximos, setAnivProximos] = useState<PersonaAniversario[]>([]);
  const [cumpleHoy, setCumpleHoy] = useState<PersonaCumpleanos[]>([]);
  const [cumpleProximos, setCumpleProximos] = useState<PersonaCumpleanos[]>([]);
  const [eppAlertas, setEppAlertas] = useState<AlertaEPP[]>([]);
  const [loading, setLoading] = useState(true);
  const [checks, setChecks] = useState<AlertaChecked[]>([]);
  const [historialAbierto, setHistorialAbierto] = useState(false);

  useEffect(() => { setChecks(leerChecks()); }, []);

  useEffect(() => {
    async function load() {
      const sb = createAnyClient();
      const ahora = new Date();
      const hoyStr = format(ahora, "yyyy-MM-dd");
      const en7Str = format(addDays(ahora, 7), "yyyy-MM-dd");
      const hace7Str = format(subDays(ahora, 7), "yyyy-MM-dd");

      const [personasRes, engRes, asigRes] = await Promise.all([
        sb.from("persona")
          .select("id, nombre, apellido, cargo_actual, fecha_ingreso, fecha_nacimiento")
          .eq("activo", true),

        // Engagements que terminan en los próximos 7 días O terminaron en los últimos 7 días
        sb.from("engagement")
          .select("id, nombre, cliente, fecha_fin_estimada, fecha_fin_real, estado")
          .or(
            // por terminar: activo, fin estimado entre hoy y hoy+7
            `and(estado.eq.activo,fecha_fin_estimada.gte.${hoyStr},fecha_fin_estimada.lte.${en7Str}),` +
            // recién terminado: fin real entre hace 7 días y hoy
            `and(fecha_fin_real.gte.${hace7Str},fecha_fin_real.lte.${hoyStr})`
          ),

        sb.from("asignacion")
          .select("engagement_id, persona_id")
          .eq("estado", "activa"),
      ]);

      const personas = (personasRes.data ?? []) as {
        id: string; nombre: string; apellido: string;
        cargo_actual: string | null; fecha_ingreso: string | null; fecha_nacimiento: string | null;
      }[];

      // ── Aniversarios y cumpleaños ──
      const anivHoyArr: PersonaAniversario[] = [];
      const anivProxArr: PersonaAniversario[] = [];
      const cumpleHoyArr: PersonaCumpleanos[] = [];
      const cumpleProxArr: PersonaCumpleanos[] = [];

      for (const p of personas) {
        if (p.fecha_ingreso) {
          const fechaAniversario = proximoAniversario(p.fecha_ingreso, ahora);
          const años = añosEn(p.fecha_ingreso, fechaAniversario);
          if (años > 0) {
            const entrada: PersonaAniversario = { ...p, fecha_ingreso: p.fecha_ingreso, años, fechaAniversario };
            if (isSameDay(fechaAniversario, ahora)) {
              anivHoyArr.push(entrada);
            } else {
              const diff = diffDiasEntre(ahora, fechaAniversario);
              if (diff <= 30) anivProxArr.push(entrada);
            }
          }
        }
        if (p.fecha_nacimiento) {
          const fechaCumple = proximoCumpleanos(p.fecha_nacimiento, ahora);
          const edad = edadEn(p.fecha_nacimiento, fechaCumple);
          const entradaCumple: PersonaCumpleanos = { ...p, fecha_nacimiento: p.fecha_nacimiento, edad, fechaCumple };
          if (isSameDay(fechaCumple, ahora)) {
            cumpleHoyArr.push(entradaCumple);
          } else {
            const diff = diffDiasEntre(ahora, fechaCumple);
            if (diff <= 30) cumpleProxArr.push(entradaCumple);
          }
        }
      }

      anivProxArr.sort((a, b) => a.fechaAniversario.getTime() - b.fechaAniversario.getTime());
      cumpleProxArr.sort((a, b) => a.fechaCumple.getTime() - b.fechaCumple.getTime());

      // ── EPP ──
      const personaMap = new Map(personas.map((p) => [p.id, p]));
      const asigPorEng = new Map<string, string[]>();
      for (const a of (asigRes.data ?? []) as { engagement_id: string; persona_id: string }[]) {
        const arr = asigPorEng.get(a.engagement_id) ?? [];
        arr.push(a.persona_id);
        asigPorEng.set(a.engagement_id, arr);
      }

      const eppArr: AlertaEPP[] = [];
      for (const eng of (engRes.data ?? []) as any[]) {
        const finReal: string | null = eng.fecha_fin_real;
        const finEst: string | null = eng.fecha_fin_estimada;
        const estado: string = eng.estado;

        let tipo: "por_terminar" | "recien_terminado";
        let fechaFin: string;
        let dias: number;

        if (finReal && finReal >= hace7Str && finReal <= hoyStr) {
          // Terminó en los últimos 7 días
          tipo = "recien_terminado";
          fechaFin = finReal;
          dias = diffDiasEntre(parseISO(finReal), ahora);
        } else if (estado === "activo" && finEst && finEst >= hoyStr && finEst <= en7Str) {
          // Termina en los próximos 7 días
          tipo = "por_terminar";
          fechaFin = finEst;
          dias = diffDiasEntre(ahora, parseISO(finEst));
        } else {
          continue;
        }

        const personaIds = asigPorEng.get(eng.id) ?? [];
        const personasEng = personaIds
          .map((pid) => personaMap.get(pid))
          .filter(Boolean) as typeof personas;

        eppArr.push({
          engagement_id: eng.id,
          engagement_nombre: eng.nombre,
          cliente: eng.cliente ?? "",
          fecha_fin: fechaFin,
          tipo,
          dias,
          personas: personasEng,
        });
      }

      // Por terminar primero (más urgente), luego recién terminados
      eppArr.sort((a, b) => {
        if (a.tipo !== b.tipo) return a.tipo === "por_terminar" ? -1 : 1;
        return a.dias - b.dias;
      });

      setAnivHoy(anivHoyArr);
      setAnivProximos(anivProxArr);
      setCumpleHoy(cumpleHoyArr);
      setCumpleProximos(cumpleProxArr);
      setEppAlertas(eppArr);
      setLoading(false);
    }
    load();
  }, []);

  function toggleAniversario(p: PersonaAniversario, esHoy: boolean) {
    const id = alertaId("aniversario", p.id, p.años);
    toggleCheck(id, "aniversario",
      `${esHoy ? "🎉 " : ""}${p.nombre} ${p.apellido} — ${p.años} ${p.años === 1 ? "año" : "años"} en la empresa (${format(p.fechaAniversario, "d MMM yyyy", { locale: es })})`
    );
  }

  function toggleCumpleanos(p: PersonaCumpleanos, esHoy: boolean) {
    const id = alertaId("cumpleanos", p.id, p.edad);
    toggleCheck(id, "cumpleanos",
      `${esHoy ? "🎂 " : ""}${p.nombre} ${p.apellido} — ${p.edad} años (${format(p.fechaCumple, "d MMM yyyy", { locale: es })})`
    );
  }

  function toggleEPP(alerta: AlertaEPP) {
    const id = `epp-${alerta.engagement_id}-${alerta.fecha_fin}`;
    const desc = `EPP — ${alerta.engagement_nombre} (${alerta.tipo === "por_terminar" ? "termina" : "terminó"} el ${format(parseISO(alerta.fecha_fin), "d MMM yyyy", { locale: es })})`;
    toggleCheck(id, "epp", desc);
  }

  function toggleCheck(id: string, tipo: string, descripcion: string) {
    const yaChecked = checks.some((c) => c.alertaId === id);
    let nuevos: AlertaChecked[];
    if (yaChecked) {
      nuevos = checks.filter((c) => c.alertaId !== id);
    } else {
      nuevos = [...checks, { alertaId: id, tipo, descripcion, fechaCheck: new Date().toISOString() }];
    }
    setChecks(nuevos);
    guardarChecks(nuevos);
  }

  function eliminarDelHistorial(id: string) {
    const nuevos = checks.filter((c) => c.alertaId !== id);
    setChecks(nuevos);
    guardarChecks(nuevos);
  }

  function isCheckedAniv(p: PersonaAniversario) {
    return checks.some((c) => c.alertaId === alertaId("aniversario", p.id, p.años));
  }
  function isCheckedCumple(p: PersonaCumpleanos) {
    return checks.some((c) => c.alertaId === alertaId("cumpleanos", p.id, p.edad));
  }
  function isCheckedEPP(alerta: AlertaEPP) {
    return checks.some((c) => c.alertaId === `epp-${alerta.engagement_id}-${alerta.fecha_fin}`);
  }

  if (loading) return <p className="text-sm text-gray-400">Cargando alertas...</p>;

  const ahora = new Date();
  const sinAlertas =
    anivHoy.length === 0 && anivProximos.length === 0 &&
    cumpleHoy.length === 0 && cumpleProximos.length === 0 &&
    eppAlertas.length === 0;

  const eppPorTerminar = eppAlertas.filter((e) => e.tipo === "por_terminar");
  const eppTerminados  = eppAlertas.filter((e) => e.tipo === "recien_terminado");

  return (
    <div className="space-y-8">

      {/* ══ EDD y EPP ════════════════════════════════════════════ */}
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <div className="w-1 h-5 rounded-full bg-[#7c5cbf]" />
          <h2 className="text-xs font-bold text-[#7c5cbf] uppercase tracking-widest">EDD y EPP</h2>
        </div>

        {/* Por terminar — próximos 7 días */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-[#7c5cbf]" />
            <h3 className="text-sm font-bold text-[#1a1a2e] uppercase tracking-wide">Por terminar esta semana</h3>
          </div>
          {eppPorTerminar.length === 0 ? (
            <p className="text-sm text-gray-400 italic">Sin proyectos próximos a terminar.</p>
          ) : (
            <div className="space-y-2">
              {eppPorTerminar.map((a) => (
                <TarjetaEPP key={a.engagement_id + a.fecha_fin} alerta={a}
                  checked={isCheckedEPP(a)} onCheck={() => toggleEPP(a)} />
              ))}
            </div>
          )}
        </section>

        {/* Recién terminados — últimos 7 días */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <ClipboardCheck className="w-4 h-4 text-[#27ae60]" />
            <h3 className="text-sm font-bold text-[#1a1a2e] uppercase tracking-wide">Terminados esta semana</h3>
          </div>
          {eppTerminados.length === 0 ? (
            <p className="text-sm text-gray-400 italic">Sin proyectos terminados recientemente.</p>
          ) : (
            <div className="space-y-2">
              {eppTerminados.map((a) => (
                <TarjetaEPP key={a.engagement_id + a.fecha_fin} alerta={a}
                  checked={isCheckedEPP(a)} onCheck={() => toggleEPP(a)} />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ══ ANIVERSARIOS ══════════════════════════════════════════ */}
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <div className="w-1 h-5 rounded-full bg-[#4a90e2]" />
          <h2 className="text-xs font-bold text-[#4a90e2] uppercase tracking-widest">Aniversarios</h2>
        </div>

        <section>
          <div className="flex items-center gap-2 mb-3">
            <PartyPopper className="w-4 h-4 text-[#4a90e2]" />
            <h3 className="text-sm font-bold text-[#1a1a2e] uppercase tracking-wide">Hoy</h3>
          </div>
          {anivHoy.length === 0 ? (
            <p className="text-sm text-gray-400 italic">Sin aniversarios hoy.</p>
          ) : (
            <div className="space-y-2">
              {anivHoy.map((p) => (
                <TarjetaAniversario key={p.id} p={p} esHoy checked={isCheckedAniv(p)} onCheck={() => toggleAniversario(p, true)} />
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-gray-400" />
            <h3 className="text-sm font-bold text-[#1a1a2e] uppercase tracking-wide">Próximos 30 días</h3>
          </div>
          {anivProximos.length === 0 ? (
            <p className="text-sm text-gray-400 italic">Sin aniversarios en los próximos 30 días.</p>
          ) : (
            <div className="space-y-2">
              {anivProximos.map((p) => (
                <TarjetaAniversario key={p.id} p={p} esHoy={false}
                  diffDias={diffDiasEntre(ahora, p.fechaAniversario)}
                  checked={isCheckedAniv(p)} onCheck={() => toggleAniversario(p, false)} />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ══ CUMPLEAÑOS ════════════════════════════════════════════ */}
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <div className="w-1 h-5 rounded-full bg-[#e2884a]" />
          <h2 className="text-xs font-bold text-[#e2884a] uppercase tracking-widest">Cumpleaños</h2>
        </div>

        <section>
          <div className="flex items-center gap-2 mb-3">
            <Cake className="w-4 h-4 text-[#e2884a]" />
            <h3 className="text-sm font-bold text-[#1a1a2e] uppercase tracking-wide">Hoy</h3>
          </div>
          {cumpleHoy.length === 0 ? (
            <p className="text-sm text-gray-400 italic">Sin cumpleaños hoy.</p>
          ) : (
            <div className="space-y-2">
              {cumpleHoy.map((p) => (
                <TarjetaCumpleanos key={p.id} p={p} esHoy checked={isCheckedCumple(p)} onCheck={() => toggleCumpleanos(p, true)} />
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-gray-400" />
            <h3 className="text-sm font-bold text-[#1a1a2e] uppercase tracking-wide">Próximos 30 días</h3>
          </div>
          {cumpleProximos.length === 0 ? (
            <p className="text-sm text-gray-400 italic">Sin cumpleaños en los próximos 30 días.</p>
          ) : (
            <div className="space-y-2">
              {cumpleProximos.map((p) => (
                <TarjetaCumpleanos key={p.id} p={p} esHoy={false}
                  diffDias={diffDiasEntre(ahora, p.fechaCumple)}
                  checked={isCheckedCumple(p)} onCheck={() => toggleCumpleanos(p, false)} />
              ))}
            </div>
          )}
        </section>
      </div>

      {sinAlertas && (
        <p className="text-sm text-gray-400 italic text-center py-8">Sin alertas activas por ahora.</p>
      )}

      {/* ── Historial ────────────────────────────────────────────── */}
      {checks.length > 0 && (
        <section className="border-t border-gray-100 pt-4">
          <button onClick={() => setHistorialAbierto((v) => !v)}
            className="flex items-center gap-2 w-full text-left group">
            <CheckCircle2 className="w-4 h-4 text-[#27ae60]" />
            <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide flex-1">
              Historial gestionadas
              <span className="ml-2 text-xs font-semibold text-white bg-[#27ae60] rounded-full px-2 py-0.5 normal-case tracking-normal">
                {checks.length}
              </span>
            </h2>
            {historialAbierto ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>

          {historialAbierto && (
            <div className="mt-3 space-y-2">
              {[...checks].sort((a, b) => b.fechaCheck.localeCompare(a.fechaCheck)).map((c) => (
                <div key={c.alertaId}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-50 border border-gray-100">
                  <CheckCircle2 className="w-4 h-4 text-[#27ae60] flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-600 truncate">{c.descripcion}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      Gestionado el {format(parseISO(c.fechaCheck), "d 'de' MMMM 'de' yyyy, HH:mm", { locale: es })}
                    </p>
                  </div>
                  <button onClick={() => eliminarDelHistorial(c.alertaId)}
                    title="Eliminar del historial"
                    className="flex-shrink-0 text-gray-300 hover:text-red-400 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
