/**
 * Tramos de un engagement: el contrato base + cada alargue (engagement_extension),
 * numerados por fecha ("Extensión 1", "Extensión 2"...). Compartido por el formulario
 * del proyecto y la ventana de asignación de una persona para usar los mismos nombres.
 */

export interface ExtensionBasica {
  id: string;
  fecha_inicio: string;
  fecha_fin: string;
}

export interface Tramo {
  key: string;               // "base" o id de la extensión
  titulo: string;            // "Contrato" | "Extensión N"
  inicio: string;            // YYYY-MM-DD
  fin: string;               // YYYY-MM-DD
  extensionId: string | null;
}

/** Extensiones ordenadas por inicio, con su número correlativo. */
export function numerarExtensiones<T extends ExtensionBasica>(exts: T[]): (T & { numero: number })[] {
  return [...exts]
    .sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio))
    .map((e, i) => ({ ...e, numero: i + 1 }));
}

/** Contrato base + alargues en orden cronológico. Sin fechas base, solo los alargues. */
export function armarTramos(baseInicio: string | null, baseFin: string | null, exts: ExtensionBasica[]): Tramo[] {
  const tramos: Tramo[] = [];
  if (baseInicio && baseFin) tramos.push({ key: "base", titulo: "Contrato", inicio: baseInicio, fin: baseFin, extensionId: null });
  for (const e of numerarExtensiones(exts)) {
    tramos.push({ key: e.id, titulo: `Extensión ${e.numero}`, inicio: e.fecha_inicio, fin: e.fecha_fin, extensionId: e.id });
  }
  return tramos;
}

/**
 * Tramo al que pertenece un período, según su fecha de inicio. Si parte en una pausa:
 * - y llega hasta el tramo siguiente (o no se sabe su fin): trabajo anticipado → tramo siguiente;
 * - y termina dentro de la pausa: trabajo de cierre → tramo anterior.
 * null solo si parte después del último tramo.
 */
export function tramoDePeriodo(tramos: Tramo[], periodo: { fecha_inicio: string; fecha_fin?: string | null }): Tramo | null {
  const dentro = tramos.find((t) => periodo.fecha_inicio >= t.inicio && periodo.fecha_inicio <= t.fin);
  if (dentro) return dentro;
  const i = tramos.findIndex((t) => periodo.fecha_inicio < t.inicio);
  if (i === -1) return null;
  const terminaEnPausa = !!periodo.fecha_fin && periodo.fecha_fin < tramos[i].inicio;
  return terminaEnPausa && i > 0 ? tramos[i - 1] : tramos[i];
}

/** Primer día en que puede partir un período del tramo: el día siguiente al fin del tramo anterior (incluye la pausa). */
export function inicioPermitido(tramos: Tramo[], tramo: Tramo, inicioProyecto: string): string {
  const i = tramos.findIndex((t) => t.key === tramo.key);
  return i > 0 ? sumarDias(tramos[i - 1].fin, 1) : inicioProyecto;
}

/** Último día en que puede terminar un período del tramo: el día antes del tramo siguiente (incluye trabajo de cierre en la pausa). */
export function finPermitido(tramos: Tramo[], tramo: Tramo): string {
  const i = tramos.findIndex((t) => t.key === tramo.key);
  return i >= 0 && i < tramos.length - 1 ? sumarDias(tramos[i + 1].inicio, -1) : tramo.fin;
}

/** Pausas (días sin tramo) entre tramos consecutivos. */
export function pausasEntre(tramos: Tramo[]): { despuesDe: string; inicio: string; fin: string }[] {
  const pausas: { despuesDe: string; inicio: string; fin: string }[] = [];
  for (let i = 0; i < tramos.length - 1; i++) {
    const ini = sumarDias(tramos[i].fin, 1);
    const fin = sumarDias(tramos[i + 1].inicio, -1);
    if (ini <= fin) pausas.push({ despuesDe: tramos[i].key, inicio: ini, fin });
  }
  return pausas;
}

/**
 * true si el período atraviesa una pausa completa (parte dentro de un tramo y sigue hasta el siguiente,
 * ej. un solo período del contrato al alargue). Partir dentro de la pausa NO cuenta: es trabajo anticipado.
 */
export function cruzaPausa(tramos: Tramo[], periodo: { fecha_inicio: string; fecha_fin: string }): boolean {
  return pausasEntre(tramos).some((p) => periodo.fecha_inicio < p.inicio && periodo.fecha_fin > p.fin);
}

/**
 * Cambia el inicio o el fin de UN alargue (no el contrato) y ajusta a su equipo:
 * - quien empezaba/terminaba con el alargue se mueve con él;
 * - al acortarlo, los períodos que quedan fuera se recortan o se quitan.
 * También mueve los requerimientos creados con las fechas exactas del alargue.
 */
export async function redimensionarExtensionConEquipo(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any, engagementId: string, ext: ExtensionBasica, edge: "start" | "end", nuevaFecha: string
): Promise<{ error: string | null }> {
  const campo = edge === "start" ? "fecha_inicio" : "fecha_fin";
  const anterior = edge === "start" ? ext.fecha_inicio : ext.fecha_fin;
  if (nuevaFecha === anterior) return { error: null };
  const acorta = edge === "end" ? nuevaFecha < anterior : nuevaFecha > anterior;

  const { error: extErr } = await sb.from("engagement_extension").update({ [campo]: nuevaFecha }).eq("id", ext.id);
  if (extErr) return { error: extErr.message };

  // Se ejecutan en orden: primero quitar lo que queda fuera, después mover y recortar (nunca fechas invertidas)
  const pasos: (() => PromiseLike<{ error: { message: string } | null }>)[] = [];
  // Al atrasar el inicio, solo se tocan los períodos que partían dentro del alargue
  // (los que partían antes, en la pausa, son trabajo anticipado y conservan su inicio)
  if (acorta) {
    pasos.push(() => edge === "end"
      ? sb.from("asignacion").delete().eq("extension_id", ext.id).gt("fecha_inicio", nuevaFecha)
      : sb.from("asignacion").delete().eq("extension_id", ext.id).gte("fecha_inicio", anterior).lt("fecha_fin", nuevaFecha));
  }
  // Quien empezaba/terminaba justo con el alargue se mueve con él
  pasos.push(() => sb.from("asignacion").update({ [campo]: nuevaFecha }).eq("extension_id", ext.id).eq(campo, anterior));
  if (acorta) {
    pasos.push(() => edge === "end"
      ? sb.from("asignacion").update({ fecha_fin: nuevaFecha }).eq("extension_id", ext.id).gt("fecha_fin", nuevaFecha)
      : sb.from("asignacion").update({ fecha_inicio: nuevaFecha }).eq("extension_id", ext.id).gte("fecha_inicio", anterior).lt("fecha_inicio", nuevaFecha));
  }
  // Requerimientos creados con las fechas exactas del alargue
  pasos.push(() => sb.from("requerimiento_engagement").update({ [campo]: nuevaFecha })
    .eq("engagement_id", engagementId).eq("fecha_inicio", ext.fecha_inicio).eq("fecha_fin", ext.fecha_fin));

  for (const paso of pasos) {
    const { error } = await paso();
    if (error) return { error: error.message };
  }
  return { error: null };
}

/**
 * Cambia inicio y fin de un alargue respetando los períodos de cada persona:
 * - si solo se traslada (mismo largo), todo el equipo se desplaza los mismos días;
 * - si cambia de largo, se ajustan los bordes (quien empezaba/terminaba con el alargue
 *   se mueve con él; lo que queda fuera se recorta o se quita).
 * Antes todo el equipo pasaba a ocupar el alargue completo y se perdían los períodos parciales.
 */
export async function cambiarFechasExtension(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any, engagementId: string, antes: ExtensionBasica, nuevoInicio: string, nuevoFin: string
): Promise<{ error: string | null }> {
  if (antes.fecha_inicio === nuevoInicio && antes.fecha_fin === nuevoFin) return { error: null };
  const dias = (a: string, b: string) => Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400000);
  const deltaIni = dias(antes.fecha_inicio, nuevoInicio);

  if (deltaIni === dias(antes.fecha_fin, nuevoFin)) {
    // Traslado: alargue, equipo y requerimientos se mueven los mismos días
    const { error: extErr } = await sb.from("engagement_extension").update({ fecha_inicio: nuevoInicio, fecha_fin: nuevoFin }).eq("id", antes.id);
    if (extErr) return { error: extErr.message };
    const { data: filas, error: leerErr } = await sb.from("asignacion").select("id, fecha_inicio, fecha_fin").eq("extension_id", antes.id);
    if (leerErr) return { error: leerErr.message };
    for (const f of (filas ?? []) as { id: string; fecha_inicio: string; fecha_fin: string | null }[]) {
      const { error } = await sb.from("asignacion").update({
        fecha_inicio: sumarDias(f.fecha_inicio, deltaIni),
        fecha_fin: f.fecha_fin ? sumarDias(f.fecha_fin, deltaIni) : null,
      }).eq("id", f.id);
      if (error) return { error: error.message };
    }
    const { error: reqErr } = await sb.from("requerimiento_engagement").update({ fecha_inicio: nuevoInicio, fecha_fin: nuevoFin })
      .eq("engagement_id", engagementId).eq("fecha_inicio", antes.fecha_inicio).eq("fecha_fin", antes.fecha_fin);
    return { error: reqErr?.message ?? null };
  }

  // Cambio de largo: se ajusta borde por borde. Si el fin se alarga, primero el fin
  // (así el alargue nunca queda con inicio > fin entre un paso y otro)
  let actual = { ...antes };
  const bordes: ("start" | "end")[] = nuevoFin >= antes.fecha_fin ? ["end", "start"] : ["start", "end"];
  for (const edge of bordes) {
    const nueva = edge === "start" ? nuevoInicio : nuevoFin;
    const { error } = await redimensionarExtensionConEquipo(sb, engagementId, actual, edge, nueva);
    if (error) return { error };
    actual = { ...actual, [edge === "start" ? "fecha_inicio" : "fecha_fin"]: nueva };
  }
  return { error: null };
}

/**
 * Elimina una extensión junto con su equipo: las asignaciones vinculadas (extension_id) y,
 * para extensiones antiguas sin vínculo, las asignaciones y cupos creados con exactamente
 * las fechas de la extensión. Antes solo se borraba la extensión y las personas seguían
 * ocupadas en un período que ya no existía.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function eliminarExtensionConEquipo(sb: any, extensionId: string): Promise<{ error: string | null }> {
  const { data: ext, error: extErr } = await sb.from("engagement_extension")
    .select("id, engagement_id, fecha_inicio, fecha_fin").eq("id", extensionId).single();
  if (extErr || !ext) return { error: extErr?.message ?? "No se encontró la extensión." };

  // Cada paso se puede repetir sin efectos extra: si uno falla, volver a eliminar completa lo que faltó
  const reintentar = (msg: string) => ({ error: `${msg} Vuelve a eliminar la extensión para terminar.` });

  // Requerimientos creados para el período de la extensión (mismas fechas exactas)
  const { data: reqsExt, error: leerReqErr } = await sb.from("requerimiento_engagement").select("id")
    .eq("engagement_id", ext.engagement_id).eq("fecha_inicio", ext.fecha_inicio).eq("fecha_fin", ext.fecha_fin);
  if (leerReqErr) return { error: leerReqErr.message };
  const reqIds = ((reqsExt ?? []) as { id: string }[]).map((r) => r.id);

  // 1. Equipo vinculado a la extensión
  const { error: delVincErr } = await sb.from("asignacion").delete().eq("extension_id", extensionId);
  if (delVincErr) return { error: delVincErr.message };
  // 2. Asignaciones que siguen apuntando a esos requerimientos sin ser del alargue (ej. un período
  //    movido al contrato): no se borran, solo se sueltan del cupo copiado. Sin esto el borrado del
  //    requerimiento fallaba por la clave foránea; antes se borraban y se perdía ese período.
  if (reqIds.length > 0) {
    const { error: soltarErr } = await sb.from("asignacion").update({ requerimiento_id: null }).in("requerimiento_id", reqIds);
    if (soltarErr) return reintentar(soltarErr.message);
  }
  // 3. Asignaciones antiguas sin vínculo (anteriores a extension_id): solo las sin requerimiento
  //    y con las fechas exactas; ya no se borran asignaciones de otros requerimientos que coincidan en fechas
  const { error: delFechasErr } = await sb.from("asignacion").delete()
    .eq("engagement_id", ext.engagement_id).is("extension_id", null).is("requerimiento_id", null)
    .eq("fecha_inicio", ext.fecha_inicio).eq("fecha_fin", ext.fecha_fin);
  if (delFechasErr) return reintentar(delFechasErr.message);
  // 4. Requerimientos de la extensión
  if (reqIds.length > 0) {
    const { error: delReqErr } = await sb.from("requerimiento_engagement").delete().in("id", reqIds);
    if (delReqErr) return reintentar(delReqErr.message);
  }

  const { error: delExtErr } = await sb.from("engagement_extension").delete().eq("id", extensionId);
  return delExtErr ? reintentar(delExtErr.message) : { error: null };
}

/**
 * Carga máxima de una persona en un proyecto: suma los % de los períodos que coinciden en el
 * tiempo (ej. dos roles a la vez) y toma el mayor entre momentos distintos (ej. contrato y alargue).
 */
export function cargaMaximaSimultanea(periodos: { fecha_inicio: string; fecha_fin: string | null; pct: number }[]): number {
  // El máximo de una suma de intervalos siempre ocurre en el inicio de alguno de ellos
  return periodos.reduce((max, p) => {
    const suma = periodos
      .filter((o) => o.fecha_inicio <= p.fecha_inicio && (!o.fecha_fin || o.fecha_fin >= p.fecha_inicio))
      .reduce((s, o) => s + Number(o.pct), 0);
    return suma > max ? suma : max;
  }, 0);
}

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(fecha + "T00:00:00");
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
