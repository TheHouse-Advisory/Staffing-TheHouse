/**
 * Script de cruce: compara los nombres reales de lib/tasks/private_map.json
 * (mapeo CSV SharePoint -> ID ficticio) contra la tabla `persona` de Supabase,
 * para saber quiénes ya existen en el sistema y quiénes son nuevos.
 *
 * No imprime nombres reales en consola — solo un resumen numérico.
 * El detalle (con nombres) queda únicamente en lib/tasks/match_personas.json.
 *
 * Ejecutar con: npx tsx lib/tasks/matchPersonas.ts
 */
import { config } from "dotenv";
import { createServiceClient } from "@/lib/supabase/server";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";

config({ path: join(__dirname, "..", "..", ".env.local") });

function localizarArchivo(nombre: string): string {
  const candidatos = [
    resolve(process.cwd().split(".claude")[0], `lib/tasks/${nombre}`),
    join(process.cwd(), `lib/tasks/${nombre}`),
    join(__dirname, nombre),
    resolve(`lib/tasks/${nombre}`),
  ];
  for (const c of candidatos) {
    if (existsSync(c)) return c;
  }
  throw new Error(`No se encontró ${nombre}. Rutas probadas:\n` + candidatos.join("\n"));
}

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function tokens(s: string): string[] {
  return normalizar(s).split(" ").filter(Boolean);
}

/** Distancia de Levenshtein simple (para tolerar typos menores). */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

type PersonaDb = { id: string; nombre: string; apellido: string; email: string | null };

/** true si todos los tokens del array corto están presentes en el array largo. */
function tokensSubset(cortos: string[], largos: string[]): boolean {
  return cortos.length > 0 && cortos.every((t) => largos.includes(t));
}

function evaluarCoincidencia(nombreCsv: string, p: PersonaDb): "exacta" | "posible" | null {
  const nombreCompletoDb = `${p.nombre} ${p.apellido}`;
  const normCsv = normalizar(nombreCsv);
  const normDb = normalizar(nombreCompletoDb);

  if (normCsv === normDb) return "exacta";

  const tCsv = tokens(nombreCsv);
  const tDb = tokens(nombreCompletoDb);

  if (tokensSubset(tCsv, tDb) || tokensSubset(tDb, tCsv)) return "posible";

  const distancia = levenshtein(normCsv, normDb);
  const umbral = Math.max(2, Math.floor(Math.max(normCsv.length, normDb.length) * 0.15));
  if (distancia <= umbral) return "posible";

  return null;
}

type GrupoConsolidado = {
  persona_id: string;
  email_normalizado: string | null;
  nombre_db: string;
  ids_ficticios: string[];
  nombres_csv: string[];
};

/** Clave de agrupación: email institucional normalizado (sin tildes, minúsculas), o el persona_id si no hay email. */
function claveGrupo(p: PersonaDb): string {
  return p.email ? `email:${normalizar(p.email)}` : `id:${p.id}`;
}

function agregarAGrupo(
  grupos: Map<string, GrupoConsolidado>,
  p: PersonaDb,
  idFicticio: string,
  nombreCsv: string
) {
  const clave = claveGrupo(p);
  const existente = grupos.get(clave);
  if (existente) {
    if (!existente.ids_ficticios.includes(idFicticio)) existente.ids_ficticios.push(idFicticio);
    if (!existente.nombres_csv.includes(nombreCsv)) existente.nombres_csv.push(nombreCsv);
  } else {
    grupos.set(clave, {
      persona_id: p.id,
      email_normalizado: p.email ? normalizar(p.email) : null,
      nombre_db: `${p.nombre} ${p.apellido}`,
      ids_ficticios: [idFicticio],
      nombres_csv: [nombreCsv],
    });
  }
}

async function main() {
  const rutaMap = localizarArchivo("private_map.json");
  const mapaPrivado: { personas: Record<string, string> } = JSON.parse(readFileSync(rutaMap, "utf-8"));
  const nombresCsv = Object.keys(mapaPrivado.personas ?? {});

  const supabase = createServiceClient();
  const { data, error } = await supabase.from("persona").select("id, nombre, apellido, email");
  if (error) throw new Error(`Error consultando persona: ${error.message}`);
  const personasDb = (data ?? []) as PersonaDb[];

  // Agrupadas por email institucional normalizado (o persona_id si no hay email):
  // así, dos IDs ficticios distintos que resuelven al mismo perfil real quedan
  // fusionados en una sola entrada en vez de duplicados.
  const gruposExactos = new Map<string, GrupoConsolidado>();
  const gruposPosibles = new Map<string, GrupoConsolidado>();
  const personasNuevas: Array<{ nombre_csv: string; id_ficticio: string }> = [];

  for (const nombreCsv of nombresCsv) {
    const idFicticio = mapaPrivado.personas[nombreCsv];
    const exacta = personasDb.find((p) => evaluarCoincidencia(nombreCsv, p) === "exacta");
    if (exacta) {
      agregarAGrupo(gruposExactos, exacta, idFicticio, nombreCsv);
      continue;
    }

    const posibles = personasDb.filter((p) => evaluarCoincidencia(nombreCsv, p) === "posible");
    if (posibles.length > 0) {
      for (const candidato of posibles) agregarAGrupo(gruposPosibles, candidato, idFicticio, nombreCsv);
      continue;
    }

    personasNuevas.push({ nombre_csv: nombreCsv, id_ficticio: idFicticio });
  }

  const coincidenciasExactas = [...gruposExactos.values()];
  const posiblesCoincidencias = [...gruposPosibles.values()];
  const idsFicticiosFusionados = coincidenciasExactas.filter((g) => g.ids_ficticios.length > 1).length;

  const resultado = {
    generado_en: new Date().toISOString(),
    total_csv: nombresCsv.length,
    total_persona_db: personasDb.length,
    coincidencias_exactas: coincidenciasExactas,
    posibles_coincidencias: posiblesCoincidencias,
    personas_nuevas: personasNuevas,
  };

  const rutaSalida = join(dirname(rutaMap), "match_personas.json");
  writeFileSync(rutaSalida, JSON.stringify(resultado, null, 2), "utf-8");

  const totalUnicasConsolidadas = coincidenciasExactas.length + personasNuevas.length;

  console.log("✅ Cruce de personas completado (sin mostrar nombres reales).");
  console.log(`   - Nombres en CSV: ${nombresCsv.length}`);
  console.log(`   - Personas en tabla persona: ${personasDb.length}`);
  console.log(`   - Coincidencias exactas (perfiles reales únicos): ${coincidenciasExactas.length}`);
  console.log(`     de las cuales con pseudónimos fusionados: ${idsFicticiosFusionados}`);
  console.log(`   - Posibles coincidencias (perfiles): ${posiblesCoincidencias.length}`);
  console.log(`   - Personas nuevas: ${personasNuevas.length}`);
  console.log(`   - Total personas únicas consolidadas (exactas + nuevas): ${totalUnicasConsolidadas}`);
  console.log(`   - Resultado: ${rutaSalida}`);
}

main().catch((err) => {
  console.error("❌ Error en el cruce:", err instanceof Error ? err.message : err);
  process.exit(1);
});
