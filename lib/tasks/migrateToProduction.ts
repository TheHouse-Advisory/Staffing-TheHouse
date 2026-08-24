/**
 * Script de migración: lleva el histórico de staging_sharepoint (anonimizado)
 * a las tablas de producción `engagement` y `asignacion`.
 *
 * IMPORTANTE — de-anonimización necesaria:
 *   Los campos de proyecto en staging_sharepoint están anonimizados (PROJECT_xxxx),
 *   así que este script los revierte a su valor real usando lib/tasks/private_map.json
 *   (proyectos) antes de insertar en producción. Sin este paso se insertarían
 *   literalmente strings "PROJECT_0002" como nombre real de un engagement.
 *   Las personas se resuelven a persona_id real vía lib/tasks/match_personas.json
 *   (coincidencias_exactas) — si un pseudónimo de persona no está ahí, esa
 *   asignación puntual se omite (el proyecto igual se migra si tiene datos válidos).
 *
 * SEGURIDAD — modo dry-run por defecto:
 *   Por defecto NO escribe nada en producción, solo muestra cuántos registros
 *   insertaría. Para ejecutar la escritura real: npx tsx lib/tasks/migrateToProduction.ts --confirm
 *
 * IDEMPOTENCIA:
 *   Si ya existe un engagement con el mismo `codigo`, se omite (evita duplicar
 *   en reejecuciones).
 */
import { config } from "dotenv";
import { createServiceClient } from "@/lib/supabase/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

config({ path: join(__dirname, "..", "..", ".env.local") });

const CONFIRMAR = process.argv.includes("--confirm");

function localizarArchivo(nombre: string): string {
  const candidatos = [
    join(process.cwd().split(".claude")[0], "lib/tasks", nombre),
    join(process.cwd(), "lib/tasks", nombre),
    join(__dirname, nombre),
  ];
  for (const c of candidatos) {
    if (existsSync(c)) return c;
  }
  throw new Error(`No se encontró ${nombre}. Rutas probadas:\n` + candidatos.join("\n"));
}

type Fecha = { d: number; m: number; y: number };

function parsearComponentes(valor: string | undefined | null): Fecha | null {
  if (!valor) return null;
  const m = valor.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return { d: Number(m[1]), m: Number(m[2]), y: Number(m[3]) };
}

function aFechaUTC(p: Fecha): number {
  return Date.UTC(p.y, p.m - 1, p.d);
}

function aISO(p: Fecha): string {
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

function intercambiar(p: Fecha): Fecha {
  return { d: p.m, m: p.d, y: p.y };
}

/** Blindaje final: descarta cualquier fecha que, tras las correcciones, siga fuera de rango. */
function aISOSiValida(p: Fecha | null): string | null {
  if (!p || p.m < 1 || p.m > 12 || p.d < 1 || p.d > 31) return null;
  return aISO(p);
}

/**
 * Interpreta el par fecha_inicio/fecha_término corrigiendo la confusión de
 * formato DD/MM vs MM/DD: si el "mes" es imposible (>12) se invierte con
 * seguridad; si ambos son ambiguos (<=12) pero fecha_término < fecha_inicio,
 * se prueba invertir término y/o inicio hasta que el orden sea válido.
 * Devuelve fechas en formato "YYYY-MM-DD" (o null si no hay dato/es irrecuperable).
 */
function parseFechaInteligente(
  fechaInicioStr: string | undefined | null,
  fechaTerminoStr: string | undefined | null
): { fechaInicio: string | null; fechaTermino: string | null } {
  let pInicio = parsearComponentes(fechaInicioStr);
  let pTermino = parsearComponentes(fechaTerminoStr);

  // Swap inequívoco: mes imposible (>12) con día válido como mes. Se aplica
  // ANTES de cualquier chequeo de nulos, para que el caso "solo una fecha
  // presente" también quede corregido.
  if (pTermino && pTermino.m > 12 && pTermino.d <= 12) pTermino = intercambiar(pTermino);
  if (pInicio && pInicio.m > 12 && pInicio.d <= 12) pInicio = intercambiar(pInicio);

  if (!pInicio || !pTermino) {
    return { fechaInicio: aISOSiValida(pInicio), fechaTermino: aISOSiValida(pTermino) };
  }

  if (aFechaUTC(pTermino) < aFechaUTC(pInicio)) {
    // Caso ambiguo: probar invertir término y luego inicio hasta resolver el orden.
    if (pTermino.d <= 12 && pTermino.m <= 12) {
      const candidato = intercambiar(pTermino);
      if (aFechaUTC(candidato) >= aFechaUTC(pInicio)) pTermino = candidato;
    }
    if (aFechaUTC(pTermino) < aFechaUTC(pInicio) && pInicio.d <= 12 && pInicio.m <= 12) {
      const candidato = intercambiar(pInicio);
      if (aFechaUTC(pTermino) >= aFechaUTC(candidato)) pInicio = candidato;
    }
  }

  // Si ningún intercambio resolvió el orden, las fechas son genuinamente
  // inconsistentes: se descarta el término en vez de violar fecha_fin >= fecha_inicio.
  if (aFechaUTC(pTermino) < aFechaUTC(pInicio)) {
    return { fechaInicio: aISOSiValida(pInicio), fechaTermino: null };
  }

  return { fechaInicio: aISOSiValida(pInicio), fechaTermino: aISOSiValida(pTermino) };
}

function parsearParticipantes(valor: unknown): string[] {
  if (typeof valor !== "string" || !valor.trim()) return [];
  try {
    const arr = JSON.parse(valor);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

type FilaProyecto = {
  "Código proyecto"?: string;
  "Nombre proyecto"?: string;
  Cliente?: string;
  Industria?: string;
  "Categoría principal"?: string;
  Participantes?: string;
  "Fecha Inicio"?: string;
  "Fecha término"?: string;
  "Resumen proyecto"?: string;
};

async function main() {
  // --- 1. Cargar mapas locales ---
  const rutaPrivateMap = localizarArchivo("private_map.json");
  const privateMap: { proyectos: Record<string, string> } = JSON.parse(readFileSync(rutaPrivateMap, "utf-8"));
  // Invertir proyectos: PROJECT_xxxx -> valor real (nombre/código/cliente/resumen original)
  const proyectoRealPorId = new Map<string, string>();
  for (const [real, id] of Object.entries(privateMap.proyectos ?? {})) proyectoRealPorId.set(id, real);

  const rutaMatch = localizarArchivo("match_personas.json");
  const matchPersonas: { coincidencias_exactas: Array<{ persona_id: string; ids_ficticios: string[] }> } = JSON.parse(
    readFileSync(rutaMatch, "utf-8")
  );
  const personaIdPorPseudonimo = new Map<string, string>();
  for (const grupo of matchPersonas.coincidencias_exactas ?? []) {
    for (const idFicticio of grupo.ids_ficticios) personaIdPorPseudonimo.set(idFicticio, grupo.persona_id);
  }

  // --- 2. Leer staging_sharepoint (tabla sin tipos generados -> cliente untyped) ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceClient() as any;
  const { data: filasStaging, error: errorStaging } = await supabase.from("staging_sharepoint").select("id, data");
  if (errorStaging) throw new Error(`Error leyendo staging_sharepoint: ${errorStaging.message}`);

  // Engagements ya migrados (por código real) -> evita duplicar en reejecuciones
  const { data: engagementsExistentes } = await supabase.from("engagement").select("id, codigo");
  const idPorCodigoExistente = new Map<string, string>(
    (engagementsExistentes ?? []).map((e: { id: string; codigo: string }) => [e.codigo, e.id])
  );

  // cargo_al_momento tiene FK a config_cargo(nombre): se usa el cargo_actual real
  // de cada persona (más preciso que un placeholder) con un valor válido de
  // respaldo si la persona no tiene cargo_actual registrado.
  const CARGO_RESPALDO = "Consultor de Proyectos";
  const { data: personasCargo } = await supabase.from("persona").select("id, cargo_actual");
  const cargoPorPersonaId = new Map<string, string>();
  for (const p of personasCargo ?? []) if (p.cargo_actual) cargoPorPersonaId.set(p.id, p.cargo_actual);

  let proyectosOmitidosPorCodigo = 0;
  let proyectosOmitidosPorDuplicado = 0;
  let engagementsInsertados = 0;
  let asignacionesInsertadas = 0;
  let asignacionesOmitidasPorPersona = 0;

  for (const filaDb of filasStaging ?? []) {
    const fila = filaDb.data as FilaProyecto;

    const codigoReal = proyectoRealPorId.get(fila["Código proyecto"] ?? "");
    const nombreReal = proyectoRealPorId.get(fila["Nombre proyecto"] ?? "");
    const clienteReal = proyectoRealPorId.get(fila["Cliente"] ?? "");
    const resumenReal = proyectoRealPorId.get(fila["Resumen proyecto"] ?? "");

    if (!codigoReal || !nombreReal) {
      proyectosOmitidosPorCodigo++;
      continue;
    }

    const { fechaInicio: fechaInicioInteligente, fechaTermino: fechaFinInteligente } = parseFechaInteligente(
      fila["Fecha Inicio"],
      fila["Fecha término"]
    );
    const fechaInicio = fechaInicioInteligente ?? new Date().toISOString().slice(0, 10);
    const fechaFin = fechaFinInteligente;

    const idExistente = idPorCodigoExistente.get(codigoReal);
    if (idExistente) {
      proyectosOmitidosPorDuplicado++;
      // Si quedó huérfano (0 asignaciones) por una corrida anterior interrumpida,
      // se completan sus asignaciones en vez de dejarlo así para siempre.
      if (CONFIRMAR) {
        const { count } = await supabase
          .from("asignacion")
          .select("id", { count: "exact", head: true })
          .eq("engagement_id", idExistente);
        if (!count) {
          const participantes = parsearParticipantes(fila["Participantes"]);
          for (const pseudonimo of participantes) {
            const personaId = personaIdPorPseudonimo.get(pseudonimo);
            if (!personaId) {
              asignacionesOmitidasPorPersona++;
              continue;
            }
            const { error: errorAsig } = await supabase.from("asignacion").insert({
              persona_id: personaId,
              engagement_id: idExistente,
              cargo_al_momento: cargoPorPersonaId.get(personaId) ?? CARGO_RESPALDO,
              pct_dedicacion: 100,
              fecha_inicio: fechaInicio,
              fecha_fin: fechaFin,
              estado: "activa",
              estado_staffing: "CONFIRMADO",
            });
            if (errorAsig) throw new Error(`Error insertando asignación (backfill) para engagement "${codigoReal}": ${errorAsig.message}`);
            asignacionesInsertadas++;
          }
        }
      }
      continue;
    }

    const nuevoEngagement = {
      nombre: nombreReal,
      codigo: codigoReal,
      cliente: clienteReal ?? nombreReal,
      descripcion: resumenReal ?? null,
      tipo: "proyecto" as const,
      estado: "terminado" as const, // histórico migrado: se asume finalizado
      fecha_inicio: fechaInicio,
      fecha_fin_estimada: fechaFin,
      fecha_fin_real: fechaFin,
      color: "#94a3b8",
      is_deleted: false,
    };

    if (!CONFIRMAR) {
      engagementsInsertados++; // conteo proyectado (dry-run)
    } else {
      const { data: insertado, error: errorInsert } = await supabase
        .from("engagement")
        .insert(nuevoEngagement)
        .select("id")
        .single();
      if (errorInsert) throw new Error(`Error insertando engagement "${codigoReal}": ${errorInsert.message}`);
      engagementsInsertados++;
      idPorCodigoExistente.set(codigoReal, insertado.id);

      const participantes = parsearParticipantes(fila["Participantes"]);
      for (const pseudonimo of participantes) {
        const personaId = personaIdPorPseudonimo.get(pseudonimo);
        if (!personaId) {
          asignacionesOmitidasPorPersona++;
          continue;
        }
        const { error: errorAsig } = await supabase.from("asignacion").insert({
          persona_id: personaId,
          engagement_id: insertado.id,
          cargo_al_momento: cargoPorPersonaId.get(personaId) ?? CARGO_RESPALDO,
          pct_dedicacion: 100,
          fecha_inicio: fechaInicio,
          fecha_fin: fechaFin,
          estado: "activa",
          estado_staffing: "CONFIRMADO",
        });
        if (errorAsig) throw new Error(`Error insertando asignación para engagement "${codigoReal}": ${errorAsig.message}`);
        asignacionesInsertadas++;
      }
    }
  }

  console.log(CONFIRMAR ? "✅ Migración ejecutada." : "🔎 Dry-run (sin escribir). Ejecuta con --confirm para migrar de verdad.");
  console.log(`   - Filas en staging: ${(filasStaging ?? []).length}`);
  console.log(`   - Engagements insertados: ${engagementsInsertados}`);
  console.log(`   - Proyectos omitidos (sin código/nombre real resuelto): ${proyectosOmitidosPorCodigo}`);
  console.log(`   - Proyectos omitidos (ya existían, mismo código): ${proyectosOmitidosPorDuplicado}`);
  if (CONFIRMAR) {
    console.log(`   - Asignaciones insertadas: ${asignacionesInsertadas}`);
    console.log(`   - Asignaciones omitidas (pseudónimo sin match en match_personas.json): ${asignacionesOmitidasPorPersona}`);
  }
}

main().catch((err) => {
  console.error("❌ Error en la migración:", err instanceof Error ? err.message : err);
  process.exit(1);
});
