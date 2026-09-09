import type { FeatureCollection, Geometry } from 'geojson'
import { mascaraDeArea } from './mascara'
import type { PilaBandas, Rejilla } from './raster'

/**
 * Une varias escenas del mismo dia en una sola pila.
 *
 * Existe porque Leon cae justo en el borde de dos mallas MGRS: cada fecha de
 * Sentinel-2 trae 13QHD y 14QKJ, y ninguna cubre el municipio completo. Peor
 * todavia, esas dos mallas viven en zonas UTM distintas, asi que sumarlas solo
 * es posible sobre la rejilla comun en grados que arma rejillaDe.
 */

/** La huella de la escena viene como Geometry suelta; la mascara pide features. */
export function mascaraDeHuella(rejilla: Rejilla, huella: Geometry): Uint8Array {
  const coleccion: FeatureCollection = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: huella, properties: {} }],
  }
  return mascaraDeArea(rejilla, coleccion)
}

export interface ResultadoMosaico {
  pila: PilaBandas
  /** Indice de la escena que aporto cada celda, o -1 si ninguna. */
  procedencia: Int16Array
  /** Celdas que aporto cada escena, en el mismo orden que se recibieron. */
  aportacion: number[]
}

/**
 * Gana la primera escena que tenga dato en la celda, asi que el orden en que
 * llegan es el orden de prioridad.
 *
 * Una celda se toma de una escena solo si esa escena tiene validas *todas* las
 * bandas ahi. Rellenar banda por banda seria peor que dejar el hueco: un NDVI
 * con el rojo de una fecha y el infrarrojo de otra no es un NDVI de nada.
 */
export function combinarPilas(pilas: PilaBandas[]): ResultadoMosaico {
  if (pilas.length === 0) throw new Error('No hay escenas que combinar')

  const rejilla = pilas[0].rejilla
  const nombres = Object.keys(pilas[0].bandas)
  const celdas = rejilla.ancho * rejilla.alto

  // Siempre se devuelven arreglos nuevos. Quien recibe el mosaico le aplica la
  // mascara del area encima, y esa escritura no puede tocar la pila por escena
  // que quedo guardada en cache para la siguiente corrida.
  const salida: Record<string, Float32Array> = {}
  for (const nombre of nombres) salida[nombre] = new Float32Array(celdas).fill(Number.NaN)

  const procedencia = new Int16Array(celdas).fill(-1)
  const aportacion = new Array<number>(pilas.length).fill(0)

  for (let i = 0; i < celdas; i++) {
    for (let escena = 0; escena < pilas.length; escena++) {
      const bandas = pilas[escena].bandas
      let completa = true

      for (const nombre of nombres) {
        if (Number.isNaN(bandas[nombre][i])) {
          completa = false
          break
        }
      }

      if (!completa) continue

      for (const nombre of nombres) salida[nombre][i] = bandas[nombre][i]
      procedencia[i] = escena
      aportacion[escena]++
      break
    }
  }

  return { pila: { rejilla, bandas: salida }, procedencia, aportacion }
}

/** Celdas con dato dentro del area, sobre el total de celdas del area. */
export function coberturaDelArea(procedencia: Int16Array, dentro: Uint8Array): number {
  let total = 0
  let cubiertas = 0

  for (let i = 0; i < procedencia.length; i++) {
    if (dentro[i] === 0) continue
    total++
    if (procedencia[i] >= 0) cubiertas++
  }

  return total > 0 ? cubiertas / total : 0
}

/** Celdas que aporto cada escena, contadas solo dentro del area. */
export function aportacionEnArea(
  procedencia: Int16Array,
  dentro: Uint8Array,
  escenas: number,
): number[] {
  const conteo = new Array<number>(escenas).fill(0)

  for (let i = 0; i < procedencia.length; i++) {
    if (dentro[i] === 0) continue
    const escena = procedencia[i]
    if (escena >= 0) conteo[escena]++
  }

  return conteo
}
