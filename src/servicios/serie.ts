import type { FeatureCollection } from 'geojson'
import { calcularIndice, type DefinicionIndice } from './indices'
import { aplicarMascara, mascaraDeArea } from './mascara'
import { obtenerMosaico } from './pilas'
import { rejillaDe } from './raster'
import type { Bbox, Coleccion, GrupoDia, NombreBanda } from '../tipos'

/**
 * Serie de tiempo de un indice sobre el area.
 *
 * Cada fecha cuesta una lectura de bandas completa, asi que la serie corre
 * sobre una rejilla mas gruesa que el analisis de una escena: la media de un
 * indice sobre miles de hectareas no cambia por afinar la celda, y si cambia
 * el tiempo de espera. Aun asi, veinte fechas son veinte lecturas: se avisa
 * el avance y se puede cancelar.
 */

export interface PuntoSerie {
  dia: string
  /** Media del indice sobre las celdas validas del area. */
  media: number
  /** Mediana: resiste mejor una nube que se escapo de la mascara. */
  mediana: number
  /** Celdas validas entre celdas del area. Abajo del minimo, la fecha se omite. */
  fraccionValida: number
  escenas: number
}

export interface ResultadoSerie {
  puntos: PuntoSerie[]
  /** Fechas que se leyeron pero quedaron por debajo del minimo de cobertura. */
  omitidas: { dia: string; fraccionValida: number }[]
  indice: DefinicionIndice
  /** Lado de la rejilla con la que se calculo. */
  tamano: number
}

export interface ParametrosSerie {
  grupos: GrupoDia[]
  coleccion: Coleccion
  indice: DefinicionIndice
  bbox: Bbox
  areaGeojson: FeatureCollection
  quitarNubes: boolean
  /** Lado de la rejilla; 128 basta para una media de area. */
  tamano: number
  /** Cuantas fechas como maximo, repartidas a lo largo del periodo. */
  maxFechas: number
  /** Fraccion minima del area con dato valido para aceptar la fecha. */
  coberturaMinima: number
  onProgreso?: (hechas: number, total: number, dia: string) => void
  senal?: AbortSignal
}

/**
 * Reparte las fechas a lo largo del periodo en vez de tomar las primeras.
 *
 * Con veinte fechas de un periodo de dos anios, quedarse con las mas
 * recientes daria una serie de dos meses. Se toman extremos y se reparte el
 * resto por posicion, que conserva la forma de la curva.
 */
export function repartirFechas<T>(lista: T[], maximo: number): T[] {
  if (lista.length <= maximo) return [...lista]
  if (maximo <= 1) return [lista[0]]

  const paso = (lista.length - 1) / (maximo - 1)
  const elegidas: T[] = []
  for (let i = 0; i < maximo; i++) elegidas.push(lista[Math.round(i * paso)])
  return elegidas
}

function resumen(valores: Float32Array): { media: number; mediana: number; validos: number } {
  const finitos: number[] = []
  let suma = 0

  for (const valor of valores) {
    if (Number.isNaN(valor)) continue
    finitos.push(valor)
    suma += valor
  }

  if (finitos.length === 0) return { media: Number.NaN, mediana: Number.NaN, validos: 0 }

  finitos.sort((a, b) => a - b)
  const medio = Math.floor(finitos.length / 2)
  const mediana =
    finitos.length % 2 === 0 ? (finitos[medio - 1] + finitos[medio]) / 2 : finitos[medio]

  return { media: suma / finitos.length, mediana, validos: finitos.length }
}

export async function calcularSerie(parametros: ParametrosSerie): Promise<ResultadoSerie> {
  const {
    grupos,
    coleccion,
    indice,
    bbox,
    areaGeojson,
    quitarNubes,
    tamano,
    maxFechas,
    coberturaMinima,
    onProgreso,
    senal,
  } = parametros

  const rejilla = rejillaDe(bbox, tamano, tamano)
  const dentro = mascaraDeArea(rejilla, areaGeojson)

  let celdasDentro = 0
  for (const marca of dentro) celdasDentro += marca
  if (celdasDentro === 0) throw new Error('El área no cae en la rejilla de la serie')

  // De la mas vieja a la mas nueva: una serie se lee hacia adelante.
  const ordenadas = [...grupos].sort((a, b) => a.dia.localeCompare(b.dia))
  const elegidas = repartirFechas(ordenadas, maxFechas)

  const bandas = [indice.a, indice.b] as NombreBanda[]
  const puntos: PuntoSerie[] = []
  const omitidas: { dia: string; fraccionValida: number }[] = []

  for (const [i, grupo] of elegidas.entries()) {
    if (senal?.aborted) throw new Error('Serie cancelada')
    onProgreso?.(i, elegidas.length, grupo.dia)

    const mosaico = await obtenerMosaico(grupo.escenas, coleccion, bandas, rejilla, quitarNubes)
    for (const banda of Object.values(mosaico.pila.bandas)) aplicarMascara(banda, dentro)

    const { valores } = calcularIndice(mosaico.pila, indice)
    const { media, mediana, validos } = resumen(valores)
    const fraccionValida = validos / celdasDentro

    if (validos === 0 || fraccionValida < coberturaMinima) {
      omitidas.push({ dia: grupo.dia, fraccionValida })
      continue
    }

    puntos.push({
      dia: grupo.dia,
      media,
      mediana,
      fraccionValida,
      escenas: grupo.escenas.length,
    })
  }

  onProgreso?.(elegidas.length, elegidas.length, '')

  if (puntos.length === 0) {
    throw new Error(
      'Ninguna fecha alcanzó la cobertura mínima. Sube el límite de nubosidad en la búsqueda o baja la cobertura exigida.',
    )
  }

  return { puntos, omitidas, indice, tamano }
}

/** Filas listas para pegar en una hoja de calculo. */
export function serieComoCsv(resultado: ResultadoSerie): string {
  const cabecera = 'dia,media,mediana,fraccion_valida,escenas'
  const filas = resultado.puntos.map(
    (punto) =>
      `${punto.dia},${punto.media.toFixed(4)},${punto.mediana.toFixed(4)},${punto.fraccionValida.toFixed(3)},${punto.escenas}`,
  )
  return [cabecera, ...filas].join('\n')
}
