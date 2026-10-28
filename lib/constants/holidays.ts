// Feriados legales de Chile, calculados automáticamente para cualquier año (no hay que
// cargarlos a mano cada año). Reglas:
//  - Fijos: 1 ene, 1 y 21 may, 16 jul, 15 ago, 18 y 19 sep, 1 nov, 8 y 25 dic
//  - 2 ene si el 1 cae domingo (Ley 20.983)
//  - Viernes y Sábado Santo (según Pascua)
//  - Día de los Pueblos Indígenas: día del solsticio de invierno (Ley 21.357)
//  - San Pedro y San Pablo (29 jun) y Encuentro de Dos Mundos (12 oct): si caen martes,
//    miércoles o jueves pasan al lunes anterior; si caen viernes, al lunes siguiente (Ley 19.668)
//  - 17 sep si cae lunes y 20 sep si cae viernes (Ley 20.215)
//  - Iglesias Evangélicas (31 oct): si cae martes pasa al viernes 27; si cae miércoles,
//    al viernes 2 de noviembre (Ley 20.299)
// Los feriados que se decretan puntualmente por ley (p.ej. un "interferiado") no se pueden
// calcular: se agregan en FERIADOS_EXTRA. En diciembre, Alertas recuerda revisar el año siguiente.

export interface Feriado { fecha: string; nombre: string }

/** Feriados decretados puntualmente por ley, que no siguen una regla fija. */
const FERIADOS_EXTRA: Feriado[] = [
  // { fecha: "AAAA-MM-DD", nombre: "Feriado ..." },
];

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Día de la semana (0 = domingo) de una fecha del calendario, sin zona horaria. */
const diaSemana = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

/** Suma días a una fecha y la devuelve como "AAAA-MM-DD". */
function sumarDias(y: number, m: number, d: number, dias: number): string {
  const f = new Date(Date.UTC(y, m - 1, d + dias));
  return iso(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate());
}

/** Domingo de Pascua (algoritmo anónimo gregoriano). */
function pascua(y: number): { m: number; d: number } {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return { m: mes, d: dia };
}

/** Día (en hora de Chile, UTC-4 en junio) del solsticio de invierno austral (Meeus, cap. 27). */
function diaSolsticioJunio(y: number): number {
  const Y = (y - 2000) / 1000;
  const jde = 2451716.56767 + 365241.62603 * Y + 0.00325 * Y ** 2 + 0.00888 * Y ** 3 - 0.0003 * Y ** 4;
  const msUtc = (jde - 2440587.5) * 86400000 - 69000; // TT → UTC (~69 s)
  return new Date(msUtc - 4 * 3600000).getUTCDate();
}

/** Ley 19.668: martes–jueves → lunes anterior; viernes → lunes siguiente. */
function trasladarALunes(y: number, m: number, d: number): string {
  const dow = diaSemana(y, m, d);
  if (dow >= 2 && dow <= 4) return sumarDias(y, m, d, -(dow - 1));
  if (dow === 5) return sumarDias(y, m, d, 3);
  return iso(y, m, d);
}

const cache = new Map<number, Feriado[]>();

/** Lista de feriados legales de Chile de un año, ordenada por fecha. */
export function feriadosChile(y: number): Feriado[] {
  const enCache = cache.get(y);
  if (enCache) return enCache;

  const p = pascua(y);
  const lista: Feriado[] = [
    { fecha: iso(y, 1, 1), nombre: "Año Nuevo" },
    { fecha: sumarDias(y, p.m, p.d, -2), nombre: "Viernes Santo" },
    { fecha: sumarDias(y, p.m, p.d, -1), nombre: "Sábado Santo" },
    { fecha: iso(y, 5, 1), nombre: "Día del Trabajador" },
    { fecha: iso(y, 5, 21), nombre: "Día de las Glorias Navales" },
    { fecha: iso(y, 6, diaSolsticioJunio(y)), nombre: "Día de los Pueblos Indígenas" },
    { fecha: trasladarALunes(y, 6, 29), nombre: "San Pedro y San Pablo" },
    { fecha: iso(y, 7, 16), nombre: "Día de la Virgen del Carmen" },
    { fecha: iso(y, 8, 15), nombre: "Asunción de la Virgen" },
    { fecha: iso(y, 9, 18), nombre: "Independencia Nacional" },
    { fecha: iso(y, 9, 19), nombre: "Día de las Glorias del Ejército" },
    { fecha: trasladarALunes(y, 10, 12), nombre: "Encuentro de Dos Mundos" },
    { fecha: iso(y, 11, 1), nombre: "Día de Todos los Santos" },
    { fecha: iso(y, 12, 8), nombre: "Inmaculada Concepción" },
    { fecha: iso(y, 12, 25), nombre: "Navidad" },
  ];
  if (diaSemana(y, 1, 1) === 0) lista.push({ fecha: iso(y, 1, 2), nombre: "Feriado (Año Nuevo en domingo)" });
  if (diaSemana(y, 9, 17) === 1) lista.push({ fecha: iso(y, 9, 17), nombre: "Feriado Fiestas Patrias" });
  if (diaSemana(y, 9, 20) === 5) lista.push({ fecha: iso(y, 9, 20), nombre: "Feriado Fiestas Patrias" });
  const dowEvang = diaSemana(y, 10, 31);
  lista.push({
    fecha: dowEvang === 2 ? iso(y, 10, 27) : dowEvang === 3 ? iso(y, 11, 2) : iso(y, 10, 31),
    nombre: "Día de las Iglesias Evangélicas y Protestantes",
  });
  lista.push(...FERIADOS_EXTRA.filter((f) => f.fecha.startsWith(`${y}-`)));

  const ordenada = lista.sort((a, b) => a.fecha.localeCompare(b.fecha));
  cache.set(y, ordenada);
  return ordenada;
}

export function isHoliday(fechaISO: string): boolean {
  const y = Number(fechaISO.slice(0, 4));
  if (!y) return false;
  return feriadosChile(y).some((f) => f.fecha === fechaISO);
}
