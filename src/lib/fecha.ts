/**
 * Fechas en hora de León — el bug que ya se pagó una vez.
 *
 * León opera en UTC-6 FIJO, sin horario de verano. La frontera de un día
 * local va de T06:00:00Z a T05:59:59Z del día siguiente.
 *
 * El error clásico es agrupar por día recortando la cadena ISO:
 *
 *     const dia = timestamp.substring(0, 10);   // MAL
 *
 * Eso agrupa por día UTC, no por día de León: todo lo ocurrido entre las
 * 18:00 y la medianoche local cae en el día siguiente. Es traicionero
 * porque FUNCIONA LA MITAD DEL DÍA — entre medianoche y las 18:00 locales
 * el recorte da el día correcto, así que pasa las pruebas de la mañana y
 * falla en los datos de la tarde. Se descubre cuando alguien pregunta por
 * qué el acumulado de ayer no cuadra con lo que se vio anoche.
 *
 * Usa estas funciones. No reimplementes la conversión a mano.
 */

export const ZONA = 'America/Mexico_City';

const FMT_DIA = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const FMT_LEGIBLE = new Intl.DateTimeFormat('es-MX', {
  timeZone: ZONA,
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

const FMT_CORTO = new Intl.DateTimeFormat('es-MX', {
  timeZone: ZONA,
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** Día local en formato YYYY-MM-DD. Es la clave correcta para agrupar. */
export function diaLocal(t: string | number | Date): string {
  // en-CA da YYYY-MM-DD, que ordena alfabéticamente igual que cronológicamente.
  return FMT_DIA.format(new Date(t));
}

/** "14 de junio de 2026" — para mostrar, no para agrupar. */
export function fechaLegible(t: string | number | Date): string {
  return FMT_LEGIBLE.format(new Date(t));
}

/** "14 jun, 08:30" — para bitácoras y listas densas. */
export function fechaCorta(t: string | number | Date): string {
  return FMT_CORTO.format(new Date(t));
}

/**
 * Agrupa registros por día local.
 *
 * Esta es la operación donde el bug aparece, así que aquí está resuelta una
 * sola vez en lugar de repetirse en cada pantalla.
 */
export function agruparPorDia<T>(
  registros: T[],
  marca: (r: T) => string | number | Date,
): Map<string, T[]> {
  const salida = new Map<string, T[]>();
  for (const r of registros) {
    const dia = diaLocal(marca(r));
    const lista = salida.get(dia) ?? [];
    lista.push(r);
    salida.set(dia, lista);
  }
  return salida;
}

/**
 * Frontera UTC de un día local, para filtrar en consultas.
 *
 * diaLocal '2026-09-08'  ->  desde 2026-09-08T06:00:00Z
 *                            hasta 2026-09-09T06:00:00Z (exclusivo)
 */
export function rangoUTCdelDia(diaLocal: string): { desde: string; hasta: string } {
  const [a, m, d] = diaLocal.split('-').map(Number);
  const desde = new Date(Date.UTC(a, m - 1, d, 6, 0, 0));
  const hasta = new Date(desde.getTime() + 24 * 60 * 60 * 1000);
  return { desde: desde.toISOString(), hasta: hasta.toISOString() };
}
