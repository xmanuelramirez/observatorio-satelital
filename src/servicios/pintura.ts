import type { EntradaLeyenda, MarcaMapa, ResultadoAnalisis } from './analisis'
import type { ZonaObra } from './obranueva'

/**
 * El resultado ya pintado: pixeles RGBA mas lo que acompana al mapa.
 *
 * Es lo que viaja del worker al hilo principal. Un ResultadoAnalisis no puede
 * cruzar esa frontera porque lleva una funcion (colorear), y las funciones no
 * se copian entre hilos. Los pixeles si, y ademas se transfieren sin copia.
 */
export interface ResultadoPintado {
  rgba: Uint8ClampedArray<ArrayBuffer>
  ancho: number
  alto: number
  /** [[sur, oeste], [norte, este]] en grados. */
  limites: [[number, number], [number, number]]
  leyenda: EntradaLeyenda[]
  notas: string[]
  marcas?: MarcaMapa[]
  zonasObra?: ZonaObra[]
  sello: string
}

/**
 * Traduce los colores que devuelven las paletas. Solo hay dos formatos en
 * toda la app, rgb() y hexadecimal, y se resuelven sin DOM para que esto
 * corra igual dentro del worker.
 */
export function aRgb(color: string): [number, number, number] {
  const directo = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(color)
  if (directo) return [Number(directo[1]), Number(directo[2]), Number(directo[3])]

  if (/^#[0-9a-f]{6}$/i.test(color)) {
    return [
      parseInt(color.slice(1, 3), 16),
      parseInt(color.slice(3, 5), 16),
      parseInt(color.slice(5, 7), 16),
    ]
  }

  throw new Error(`Color que la pintura no sabe traducir: ${color}`)
}

export function pintarResultado(resultado: ResultadoAnalisis): ResultadoPintado {
  const { rejilla, bandas, colorear } = resultado
  const { ancho, alto } = rejilla

  if (rejilla.epsg !== 4326) {
    throw new Error(`La pintura solo sabe de rejillas en grados, llegó EPSG:${rejilla.epsg}`)
  }

  const rgba = new Uint8ClampedArray(ancho * alto * 4)
  const cache = new Map<string, [number, number, number]>()
  const valores = new Array<number>(bandas.length)

  for (let i = 0; i < ancho * alto; i++) {
    for (let b = 0; b < bandas.length; b++) valores[b] = bandas[b][i]

    const color = colorear(valores)
    if (!color) continue

    let rgb = cache.get(color)
    if (!rgb) {
      rgb = aRgb(color)
      cache.set(color, rgb)
    }

    const k = i * 4
    rgba[k] = rgb[0]
    rgba[k + 1] = rgb[1]
    rgba[k + 2] = rgb[2]
    rgba[k + 3] = 255
  }

  const este = rejilla.xmin + ancho * rejilla.pixelAncho
  const sur = rejilla.ymax - alto * rejilla.pixelAlto

  return {
    rgba,
    ancho,
    alto,
    limites: [
      [sur, rejilla.xmin],
      [rejilla.ymax, este],
    ],
    leyenda: resultado.leyenda,
    notas: resultado.notas,
    marcas: resultado.marcas,
    zonasObra: resultado.zonasObra,
    sello: resultado.sello,
  }
}
