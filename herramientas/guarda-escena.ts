/**
 * Guarda de la linea de tiempo contra lo que el filtro de nubes no ve. Condicion del dictamen
 * del 30/10/2026: en la coleccion vieja, ni el metadato ni la bandera dicen que escena trae el
 * +1000 sin restar. Lo dice el nivel de reflectancia: lo mas oscuro de una escena no llega a 0.1.
 *
 * Umbral y cifra de contraste, fijados por el juez antes de medir: percentil 0.1 del rojo mayor
 * de 1 000 DN. Las 17 escenas de 2022 que usa la serie dan entre 69 y 467 DN; la 13QHD del
 * 23/02/2022, que trae el +1000, da 1 320. Medido aqui sobre la rejilla de nubes, con
 * `auditar-historia.ts` (01/11/2026): los meses publicados de la vieja llegan a 587 DN y las
 * 12 escenas malas empiezan en 1 286.
 */

import { mediana } from '../src/lib/lineaTiempo'

/** 1 000 DN en reflectancia. */
export const CORTE_MIL = 0.1
/** Un rojo urbano tan lejos de su mismo mes no es temporada: el mayor apartado medido es 0.027. */
export const CORTE_ALARMA_ROJO = 0.05

/** Null si la escena no deja celdas que medir sobre la rejilla. */
export function percentilDeReflectancia(valores: ArrayLike<number>, q: number): number | null {
  const validos: number[] = []
  for (let i = 0; i < valores.length; i++) {
    if (Number.isFinite(valores[i]) && valores[i] > 0) validos.push(valores[i])
  }
  if (validos.length === 0) return null
  validos.sort((a, b) => a - b)
  return validos[Math.floor(validos.length * q)]
}

/** La banda roja de la escena, en reflectancia y sin desplazamiento aplicado. */
export function traeMilSinRestar(rojo: ArrayLike<number>): boolean {
  const oscuro = percentilDeReflectancia(rojo, 0.001)
  return oscuro !== null && oscuro > CORTE_MIL
}

/**
 * Alarma por mes: la ultima red si una escena pasa la guarda con el +1000. Se compara contra los
 * demas anios del mismo mes, sin contarse a si mismo. Null si no hay contra que comparar.
 */
export function desviacionDelMismoMes(
  meses: Record<string, unknown>,
  mes: string,
  rojo: number,
): number | null {
  const pares = Object.entries(meses).flatMap(([otro, dato]) => {
    const urbana = (dato as { urbana?: { rojo: number } } | null)?.urbana
    return urbana && otro !== mes && otro.slice(5) === mes.slice(5) ? [urbana.rojo] : []
  })
  return pares.length > 0 ? rojo - mediana(pares) : null
}
