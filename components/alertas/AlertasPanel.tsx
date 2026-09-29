"use client";

import { useEffect, useState } from "react";
import { format, isSameDay, parseISO, startOfDay, addDays, subDays } from "date-fns";
import { es } from "date-fns/locale";
import { PartyPopper, Clock, CheckCircle2, Circle, ChevronDown, ChevronUp, Trash2, Cake, ClipboardCheck, FileSignature, Timer } from "lucide-react";
import { createAnyClient } from "@/lib/supabase/client";
import { calculateBusinessDays } from "@/lib/utils/date-utils";

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

/** Recordatorio de enviar planes de acción — engagements que pasaron (o nacieron) a tipo "proyecto"
 *  recientemente (created_at o updated_at dentro de la ventana). Color ámbar, distinto del morado EDD/EPP. */
interface AlertaPlanAccion {
  engagement_id: string;
  engagement_nombre: string;
  cliente: string;
  fecha: string; // created_at o updated_at, lo más reciente
  personas: { id: string; nombre: string; apellido: string; cargo_actual: string | null }[];
}

/** Alerta de 20 días hábiles consecutivos en una asignación dentro de un engagement
 *  tipo "propuesta" (Propuesta comercial). Color teal, distinto del resto. */
interface AlertaPropuesta20Dias {
  engagement_id: string;
  engagement_nombre: string;
  cliente: string;
  persona: { id: string; nombre: string; apellido: string; cargo_actual: string | null };
  /** Inicio de la racha continua actual */
  fecha_inicio: string;
  diasHabiles: number;
  /** Fecha exacta (yyyy-MM-dd) en que se cumplen los 20 días hábiles */
  fechaCumple: string;
}

interface AlertaChecked {
  alertaId: string;
  tipo: string;
  descripcion: string;
  fechaCheck: string;
}

const LS_KEY = "staffinghub_alertas_checked";
const HISTORIAL_DIAS = 30; // el registro del chequeo se borra del navegador pasado este plazo
const OCULTAR_CHECK_DIAS = 7; // alertas chequeadas hace más de 7 días corridos se ocultan del panel

function leerChecks(): AlertaChecked[] {
  if (typeof window === "undefined") return [];
  try {
    const todos: AlertaChecked[] = JSON.parse(localStorage.getItem(LS_KEY) ?? "[]");
    const limite = Date.now() - HISTORIAL_DIAS * 24 * 60 * 60 * 1000;
    const vigentes = todos.filter((c) => new Date(c.fechaCheck).getTime() >= limite);
    if (vigentes.length !== todos.length) guardarChecks(vigentes); // purga silenciosa de las vencidas
    return vigentes;
  } catch {
    return [];
  }
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

/** Fecha (yyyy-MM-dd) en que una asignación iniciada en fechaInicio cumple exactamente N días hábiles */
function fechaCumpleDiasHabiles(fechaInicio: string, n: number): string {
  let d = fechaInicio;
  while (calculateBusinessDays(fechaInicio, d) < n) {
    d = format(addDays(parseISO(d), 1), "yyyy-MM-dd");
  }
  return d;
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
            {p.años === 0 ? (
              <>🎉 Dale la bienvenida a <span className={checked ? "" : "text-[#4a90e2]"}>{p.nombre} {p.apellido}</span>{" "}
              — ¡hoy es su primer día en la empresa!</>
            ) : (
              <>🎉 Felicita a <span className={checked ? "" : "text-[#4a90e2]"}>{p.nombre} {p.apellido}</span>{" "}
              por cumplir <span className="font-bold">{p.años} {p.años === 1 ? "año" : "años"}</span> en la empresa</>
            )}
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

// ── Tarjeta Plan de Acción ────────────────────────────────────────

function TarjetaPlanAccion({
  alerta, checked, onCheck,
}: {
  alerta: AlertaPlanAccion; checked: boolean; onCheck: () => void;
}) {
  const color = "#f59e0b"; // ámbar — distinto del morado EDD/EPP, del azul Aniversarios y del naranja Cumpleaños

  return (
    <div className={`flex items-start gap-4 p-4 rounded-xl border-2 transition-all ${
      checked ? "border-gray-100 bg-gray-50 opacity-60" : "border-[#f59e0b]/30 bg-[#fffbeb]"
    }`}>
      <div className="w-10 h-10 rounded-full flex items-center justify-center text-white flex-shrink-0"
        style={{ backgroundColor: checked ? "#94a3b8" : color }}>
        <FileSignature className="w-5 h-5" />
      </div>

      <div className="flex-1 min-w-0">
        <p className={`font-semibold text-[#1a1a2e] ${checked ? "line-through text-gray-400" : ""}`}>
          Recordar: enviar planes de acción —{" "}
          <span style={{ color: checked ? undefined : color }}>{alerta.engagement_nombre}</span>
        </p>
        {alerta.cliente && (
          <p className="text-xs text-gray-400 mt-0.5 mb-2">{alerta.cliente}</p>
        )}
        {alerta.personas.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {alerta.personas.map((p) => (
              <span key={p.id}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-white border border-gray-200 text-gray-600 font-medium">
                <span className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0"
                  style={{ backgroundColor: color }}>
                  {p.nombre[0]}{p.apellido[0]}
                </span>
                {p.nombre} {p.apellido}
                {p.cargo_actual && <span className="text-gray-300">· {p.cargo_actual}</span>}
              </span>
            ))}
          </div>
        )}
        <p className="text-xs text-gray-400 mt-1.5">
          Proyecto desde: <span className="font-medium text-gray-600">
            {format(parseISO(alerta.fecha), "d 'de' MMMM yyyy", { locale: es })}
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

// ── Tarjeta Propuesta 20 días ────────────────────────────────────

function TarjetaPropuesta20Dias({
  alerta, checked, onCheck,
}: {
  alerta: AlertaPropuesta20Dias; checked: boolean; onCheck: () => void;
}) {
  const color = "#0d9488"; // teal — distinto del resto de categorías

  return (
    <div className={`flex items-start gap-4 p-4 rounded-xl border-2 transition-all ${
      checked ? "border-gray-100 bg-gray-50 opacity-60" : "border-[#0d9488]/30 bg-[#f0fdfa]"
    }`}>
      <div className="w-10 h-10 rounded-full flex items-center justify-center text-white flex-shrink-0"
        style={{ backgroundColor: checked ? "#94a3b8" : color }}>
        <Timer className="w-5 h-5" />
      </div>

      <div className="flex-1 min-w-0">
        <p className={`font-semibold text-[#1a1a2e] ${checked ? "line-through text-gray-400" : ""}`}>
          <span style={{ color: checked ? undefined : color }}>{alerta.persona.nombre} {alerta.persona.apellido}</span>
          {" "}ha cumplido <span className="font-bold">20 días hábiles</span> en la propuesta comercial{" "}
          <span style={{ color: checked ? undefined : color }}>{alerta.engagement_nombre}</span>
        </p>
        {alerta.cliente && (
          <p className="text-xs text-gray-400 mt-0.5">{alerta.cliente}</p>
        )}
        {alerta.persona.cargo_actual && (
          <p className="text-xs text-gray-300 mt-0.5">{alerta.persona.cargo_actual}</p>
        )}
        <p className="text-xs text-gray-400 mt-1.5">
          Inicio: <span className="font-medium text-gray-600">
            {format(parseISO(alerta.fecha_inicio), "d 'de' MMMM yyyy", { locale: es })}
          </span>
          <span className="ml-2 text-[#0d9488] font-medium">{alerta.diasHabiles} días hábiles</span>
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

interface AlertasPanelProps {
  /** Id de la persona (usuario logueado). Si se provee, marca la vista de hoy como "vista" — oculta el badge rojo del sidebar solo para este usuario. */
  personaId?: string;
}

export function AlertasPanel({ personaId }: AlertasPanelProps) {
  const [anivHoyRaw, setAnivHoy] = useState<PersonaAniversario[]>([]);
  const [anivProximosRaw, setAnivProximos] = useState<PersonaAniversario[]>([]);
  const [cumpleHoyRaw, setCumpleHoy] = useState<PersonaCumpleanos[]>([]);
  const [cumpleProximosRaw, setCumpleProximos] = useState<PersonaCumpleanos[]>([]);
  const [eppAlertasRaw, setEppAlertas] = useState<AlertaEPP[]>([]);
  const [planAccionAlertasRaw, setPlanAccionAlertas] = useState<AlertaPlanAccion[]>([]);
  const [propuesta20AlertasHoyRaw, setPropuesta20AlertasHoy] = useState<AlertaPropuesta20Dias[]>([]);
  const [propuesta20AlertasAnterioresRaw, setPropuesta20AlertasAnteriores] = useState<AlertaPropuesta20Dias[]>([]);
  const [propuesta20HistAbierto, setPropuesta20HistAbierto] = useState(false); // colapsado por defecto
  const [loading, setLoading] = useState(true);
  const [checks, setChecks] = useState<AlertaChecked[]>([]);
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const [planAccionAbierto, setPlanAccionAbierto] = useState(false); // colapsado por defecto

  useEffect(() => { setChecks(leerChecks()); }, []);

  // Marca "vista hoy" para ESTE usuario → el badge rojo de Alertas en el sidebar
  // deja de mostrarse solo para él; otros usuarios que no hayan entrado lo siguen viendo.
  // El query builder de supabase-js es "thenable": si no se hace await/.then() la
  // petición nunca se dispara — por eso el update se envuelve en una función async.
  useEffect(() => {
    if (!personaId) return;
    (async () => {
      const hoyStr = format(new Date(), "yyyy-MM-dd");
      const sb = createAnyClient();
      await (sb as any).from("persona").update({ alertas_vista_en: hoyStr }).eq("id", personaId);
    })();
  }, [personaId]);

  useEffect(() => {
    async function load() {
      const sb = createAnyClient();
      const ahora = new Date();
      const hoyStr = format(ahora, "yyyy-MM-dd");
      const en7Str = format(addDays(ahora, 7), "yyyy-MM-dd");
      const hace7Str = format(subDays(ahora, 7), "yyyy-MM-dd");

      const [personasRes, engRes, asigRes, engProyectoRecienteRes, engPropuestaRes] = await Promise.all([
        sb.from("persona")
          .select("id, nombre, apellido, cargo_actual, fecha_ingreso, fecha_nacimiento")
          .eq("activo", true),

        // Engagements que terminan en los próximos 7 días O terminaron en los últimos 7 días
        // (excluye "posibles_proyectos": no son proyectos reales en curso, no aplican a EPP/EDD)
        sb.from("engagement")
          .select("id, nombre, cliente, fecha_fin_estimada, fecha_fin_real, estado, tipo")
          .neq("tipo", "posibles_proyectos")
          .or(
            // por terminar: activo, fin estimado entre hoy y hoy+7
            `and(estado.eq.activo,fecha_fin_estimada.gte.${hoyStr},fecha_fin_estimada.lte.${en7Str}),` +
            // recién terminado: fin real entre hace 7 días y hoy
            `and(fecha_fin_real.gte.${hace7Str},fecha_fin_real.lte.${hoyStr})`
          ),

        sb.from("asignacion")
          .select("engagement_id, persona_id, fecha_inicio")
          .eq("estado", "activa"),

        // Engagements de tipo "proyecto" creados o escalados (tipo cambiado) en los últimos 7 días
        // → recordatorio de enviar planes de acción. No hay columna dedicada de "fecha de escalado",
        // así que se aproxima con created_at/updated_at (igual criterio que "Última actualización" del Tablero).
        sb.from("engagement")
          .select("id, nombre, cliente, tipo, estado, created_at, updated_at")
          .eq("tipo", "proyecto")
          .eq("estado", "activo")
          .eq("is_deleted", false)
          .or(`created_at.gte.${hace7Str},updated_at.gte.${hace7Str}`),

        // Engagements tipo "propuesta" (Propuesta comercial) activos → base para la
        // alerta de 20 días hábiles acumulados por persona asignada.
        sb.from("engagement")
          .select("id, nombre, cliente, tipo, estado")
          .eq("tipo", "propuesta")
          .eq("estado", "activo"),
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
          const entrada: PersonaAniversario = { ...p, fecha_ingreso: p.fecha_ingreso, años, fechaAniversario };
          if (isSameDay(fechaAniversario, ahora)) {
            // Incluye años=0 (ingresó hoy mismo) como alerta de bienvenida
            anivHoyArr.push(entrada);
          } else if (años > 0) {
            const diff = diffDiasEntre(ahora, fechaAniversario);
            if (diff <= 30) anivProxArr.push(entrada);
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

        const personaIds = [...new Set(asigPorEng.get(eng.id) ?? [])];
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

      // ── Planes de acción (engagements recién creados/escalados a "proyecto") ──
      const planAccionArr: AlertaPlanAccion[] = [];
      for (const eng of (engProyectoRecienteRes.data ?? []) as any[]) {
        const fecha: string = eng.updated_at && eng.updated_at > eng.created_at ? eng.updated_at : eng.created_at;
        const personaIds = [...new Set(asigPorEng.get(eng.id) ?? [])];
        const personasEng = personaIds
          .map((pid) => personaMap.get(pid))
          .filter(Boolean) as typeof personas;

        planAccionArr.push({
          engagement_id: eng.id,
          engagement_nombre: eng.nombre,
          cliente: eng.cliente ?? "",
          fecha,
          personas: personasEng,
        });
      }
      planAccionArr.sort((a, b) => b.fecha.localeCompare(a.fecha)); // más reciente primero

      // ── Propuestas comerciales: 20 días hábiles CONSECUTIVOS por persona+engagement ──
      // Se traen todos los tramos (activos y finalizados) de cada propuesta y se arma la
      // racha continua que llega hasta hoy: un tramo anterior se encadena solo si no deja
      // ningún día hábil libre antes del inicio de la racha. Solo personas asignadas hoy.
      const propuestaMap = new Map((engPropuestaRes.data ?? []).map((e: any) => [e.id, e]));
      const propuestaIds = Array.from(propuestaMap.keys());
      const { data: tramosData } = propuestaIds.length
        ? await sb.from("asignacion")
            .select("engagement_id, persona_id, fecha_inicio, fecha_fin, estado")
            .in("engagement_id", propuestaIds)
            .neq("estado", "cancelada")
        : { data: [] };

      type Tramo = { engagement_id: string; persona_id: string; fecha_inicio: string; fecha_fin: string | null; estado: string };
      const tramosPorClave = new Map<string, Tramo[]>();
      for (const t of (tramosData ?? []) as Tramo[]) {
        if (!t.fecha_inicio || t.fecha_inicio > hoyStr) continue;
        const key = `${t.persona_id}|${t.engagement_id}`;
        tramosPorClave.set(key, [...(tramosPorClave.get(key) ?? []), t]);
      }

      const finTramo = (t: Tramo) => (!t.fecha_fin || t.fecha_fin > hoyStr ? hoyStr : t.fecha_fin);
      const diaAnterior = (iso: string) => format(subDays(parseISO(iso), 1), "yyyy-MM-dd");
      const diaSiguiente = (iso: string) => format(addDays(parseISO(iso), 1), "yyyy-MM-dd");

      const propuesta20Map = new Map<string, AlertaPropuesta20Dias>();
      for (const [key, tramos] of Array.from(tramosPorClave)) {
        const [personaId, engId] = key.split("|");
        const eng = propuestaMap.get(engId) as any;
        const persona = personaMap.get(personaId);
        if (!eng || !persona) continue;

        // Debe estar asignada hoy (tramo activo que cubre hoy)
        const vigentes = tramos.filter((t) => t.estado === "activa" && (!t.fecha_fin || t.fecha_fin >= hoyStr));
        if (vigentes.length === 0) continue;

        // Retroceder encadenando tramos sin días hábiles libres entre medio
        let inicioRacha = vigentes.reduce((min, t) => (t.fecha_inicio < min ? t.fecha_inicio : min), vigentes[0].fecha_inicio);
        let cambio = true;
        while (cambio) {
          cambio = false;
          for (const t of tramos) {
            if (t.fecha_inicio >= inicioRacha) continue;
            const fin = finTramo(t);
            const pegado = fin >= diaAnterior(inicioRacha) ||
              calculateBusinessDays(diaSiguiente(fin), diaAnterior(inicioRacha)) === 0;
            if (pegado) { inicioRacha = t.fecha_inicio; cambio = true; }
          }
        }

        const diasHabiles = calculateBusinessDays(inicioRacha, hoyStr);
        if (diasHabiles < 20) continue;

        propuesta20Map.set(key, {
          engagement_id: eng.id,
          engagement_nombre: eng.nombre,
          cliente: eng.cliente ?? "",
          persona,
          fecha_inicio: inicioRacha,
          diasHabiles,
          fechaCumple: fechaCumpleDiasHabiles(inicioRacha, 20),
        });
      }
      const propuesta20Todas = Array.from(propuesta20Map.values()).sort((a, b) => b.diasHabiles - a.diasHabiles);
      // Vigente 7 días corridos desde que se cumple (día de cumplimiento + 6); luego pasa al historial
      const limiteVigenciaStr = format(subDays(ahora, 6), "yyyy-MM-dd");
      const propuesta20ArrHoy = propuesta20Todas.filter((a) => a.fechaCumple >= limiteVigenciaStr);
      const propuesta20ArrAnteriores = propuesta20Todas.filter((a) => a.fechaCumple < limiteVigenciaStr);

      setAnivHoy(anivHoyArr);
      setAnivProximos(anivProxArr);
      setCumpleHoy(cumpleHoyArr);
      setCumpleProximos(cumpleProxArr);
      setEppAlertas(eppArr);
      setPlanAccionAlertas(planAccionArr);
      setPropuesta20AlertasHoy(propuesta20ArrHoy);
      setPropuesta20AlertasAnteriores(propuesta20ArrAnteriores);
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

  function togglePlanAccion(alerta: AlertaPlanAccion) {
    const id = `plan_accion-${alerta.engagement_id}`;
    toggleCheck(id, "plan_accion", `Planes de acción enviados — ${alerta.engagement_nombre}`);
  }

  function togglePropuesta20(alerta: AlertaPropuesta20Dias) {
    const id = `propuesta20-${alerta.engagement_id}-${alerta.persona.id}`;
    const desc = `20 días hábiles — ${alerta.persona.nombre} ${alerta.persona.apellido} en ${alerta.engagement_nombre}`;
    toggleCheck(id, "propuesta20", desc);
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

  const idAniv = (p: PersonaAniversario) => alertaId("aniversario", p.id, p.años);
  const idCumple = (p: PersonaCumpleanos) => alertaId("cumpleanos", p.id, p.edad);
  const idEPP = (a: AlertaEPP) => `epp-${a.engagement_id}-${a.fecha_fin}`;
  const idPlanAccion = (a: AlertaPlanAccion) => `plan_accion-${a.engagement_id}`;
  const idPropuesta20 = (a: AlertaPropuesta20Dias) => `propuesta20-${a.engagement_id}-${a.persona.id}`;
  const esChecked = (id: string) => checks.some((c) => c.alertaId === id);

  // Oculta alertas chequeadas hace más de OCULTAR_CHECK_DIAS días corridos
  const limiteOculto = Date.now() - OCULTAR_CHECK_DIAS * 24 * 60 * 60 * 1000;
  const visible = <T,>(idFn: (x: T) => string) => (x: T) =>
    !checks.some((c) => c.alertaId === idFn(x) && new Date(c.fechaCheck).getTime() < limiteOculto);

  const isCheckedAniv = (p: PersonaAniversario) => esChecked(idAniv(p));
  const isCheckedCumple = (p: PersonaCumpleanos) => esChecked(idCumple(p));
  const isCheckedEPP = (a: AlertaEPP) => esChecked(idEPP(a));
  const isCheckedPlanAccion = (a: AlertaPlanAccion) => esChecked(idPlanAccion(a));
  const isCheckedPropuesta20 = (a: AlertaPropuesta20Dias) => esChecked(idPropuesta20(a));

  if (loading) return (
    <div className="space-y-3 animate-pulse">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-14 bg-gray-100 rounded-xl" />
      ))}
    </div>
  );

  // Listas visibles (sin las chequeadas hace más de 7 días)
  const anivHoy = anivHoyRaw.filter(visible(idAniv));
  const anivProximos = anivProximosRaw.filter(visible(idAniv));
  const cumpleHoy = cumpleHoyRaw.filter(visible(idCumple));
  const cumpleProximos = cumpleProximosRaw.filter(visible(idCumple));
  const eppAlertas = eppAlertasRaw.filter(visible(idEPP));
  const planAccionAlertas = planAccionAlertasRaw.filter(visible(idPlanAccion));
  const propuesta20AlertasHoy = propuesta20AlertasHoyRaw.filter(visible(idPropuesta20));
  const propuesta20AlertasAnteriores = propuesta20AlertasAnterioresRaw.filter(visible(idPropuesta20));

  const ahora = new Date();
  const sinAlertas =
    anivHoy.length === 0 && anivProximos.length === 0 &&
    cumpleHoy.length === 0 && cumpleProximos.length === 0 &&
    eppAlertas.length === 0 && planAccionAlertas.length === 0 &&
    propuesta20AlertasHoy.length === 0 && propuesta20AlertasAnteriores.length === 0;

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

      {/* ══ PLANES DE ACCIÓN ═══════════════════════════════════════ */}
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <div className="w-1 h-5 rounded-full bg-[#f59e0b]" />
          <h2 className="text-xs font-bold text-[#f59e0b] uppercase tracking-widest">Planes de Acción</h2>
        </div>

        <section>
          <button onClick={() => setPlanAccionAbierto((v) => !v)}
            className="flex items-center gap-2 mb-3 w-full text-left group">
            <FileSignature className="w-4 h-4 text-[#f59e0b]" />
            <h3 className="text-sm font-bold text-[#1a1a2e] uppercase tracking-wide flex-1">
              Proyectos nuevos o escalados
              {planAccionAlertas.length > 0 && (
                <span className="ml-2 text-xs font-semibold text-white bg-[#f59e0b] rounded-full px-2 py-0.5 normal-case tracking-normal">
                  {planAccionAlertas.length}
                </span>
              )}
            </h3>
            {planAccionAbierto ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>

          {planAccionAbierto && (
            planAccionAlertas.length === 0 ? (
              <p className="text-sm text-gray-400 italic">Sin proyectos nuevos pendientes de plan de acción.</p>
            ) : (
              <div className="space-y-2">
                {planAccionAlertas.map((a) => (
                  <TarjetaPlanAccion key={a.engagement_id} alerta={a}
                    checked={isCheckedPlanAccion(a)} onCheck={() => togglePlanAccion(a)} />
                ))}
              </div>
            )
          )}
        </section>
      </div>

      {/* ══ PROPUESTAS COMERCIALES — 20 DÍAS HÁBILES ═══════════════ */}
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <div className="w-1 h-5 rounded-full bg-[#0d9488]" />
          <h2 className="text-xs font-bold text-[#0d9488] uppercase tracking-widest">Propuestas Comerciales</h2>
        </div>

        {/* 20 días hábiles cumplidos en los últimos 7 días — siempre visible, abierta por defecto */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Timer className="w-4 h-4 text-[#0d9488]" />
            <h3 className="text-sm font-bold text-[#1a1a2e] uppercase tracking-wide">20 días hábiles cumplidos</h3>
          </div>
          {propuesta20AlertasHoy.length === 0 ? (
            <p className="text-sm text-gray-400 italic">Sin personas que hayan cumplido 20 días hábiles esta semana en propuestas comerciales.</p>
          ) : (
            <div className="space-y-2">
              {propuesta20AlertasHoy.map((a) => (
                <TarjetaPropuesta20Dias key={a.engagement_id + a.persona.id} alerta={a}
                  checked={isCheckedPropuesta20(a)} onCheck={() => togglePropuesta20(a)} />
              ))}
            </div>
          )}
        </section>

        {/* Cumplidos en días anteriores — acordeón colapsado por defecto */}
        <section>
          <button onClick={() => setPropuesta20HistAbierto((v) => !v)}
            className="flex items-center gap-2 mb-3 w-full text-left group">
            <Timer className="w-4 h-4 text-[#0d9488]" />
            <h3 className="text-sm font-bold text-[#1a1a2e] uppercase tracking-wide flex-1">
              Cumplidos en días anteriores
              {propuesta20AlertasAnteriores.length > 0 && (
                <span className="ml-2 text-xs font-semibold text-white bg-[#0d9488] rounded-full px-2 py-0.5 normal-case tracking-normal">
                  {propuesta20AlertasAnteriores.length}
                </span>
              )}
            </h3>
            {propuesta20HistAbierto ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>

          {propuesta20HistAbierto && (
            propuesta20AlertasAnteriores.length === 0 ? (
              <p className="text-sm text-gray-400 italic">Sin alertas históricas de propuestas comerciales.</p>
            ) : (
              <div className="space-y-2">
                {propuesta20AlertasAnteriores.map((a) => (
                  <TarjetaPropuesta20Dias key={a.engagement_id + a.persona.id} alerta={a}
                    checked={isCheckedPropuesta20(a)} onCheck={() => togglePropuesta20(a)} />
                ))}
              </div>
            )
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
