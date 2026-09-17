import type { FeatureCollection } from 'geojson'
import { firmarHref } from './proveedores'
import { leerPila, metrosDeCelda, rejillaDe, type PilaBandas, type Rejilla } from './raster'
import { calcularIndice, type DefinicionIndice } from './indices'
import { kmeans } from './kmeans'
import { aplicarMascara, mascaraDeArea } from './mascara'
import {
  aportacionEnArea,
  coberturaDelArea,
  combinarPilas,
  mascaraDeHuella,
} from './mosaico'
import { colorDeCambio, colorDeClase, colorDeGris, colorDeIndice } from './paletas'
import type { AssetBanda, Bbox, Coleccion, Escena, ModoVista, NombreBanda } from '../tipos'

export interface EntradaLeyenda {
  color: string
  etiqueta: string
  detalle?: string
}

export interface ResultadoAnalisis {
  rejilla: Rejilla
  /** Una banda para indice, cambio o clases; tres para color verdadero. */
  bandas: Float32Array[]
  colorear: (valores: number[]) => string | undefined
  leyenda: EntradaLeyenda[]
  notas: string[]
  /** Cambia con cada corrida para que la capa del mapa se reconstruya. */
  sello: string
}

export interface ParametrosAnalisis {
  /** Escenas del mismo dia que se mosaican, en orden de prioridad. */
  escenas: Escena[]
  /** Escenas de la fecha base, solo en modo cambio. Tambien se mosaican. */
  escenasReferencia: Escena[]
  coleccion: Coleccion
  bbox: Bbox
  areaGeojson: FeatureCollection
  etiquetaArea: string
  modo: ModoVista
  indice: DefinicionIndice | null
  bandasKmeans: NombreBanda[]
  k: number
  tamano: number
  /** Magnitud minima de cambio que se considera real, en unidades del indice. */
  umbralCambio: number
}

function assetsDe(
  escena: Escena,
  coleccion: Coleccion,
  bandas: NombreBanda[],
): Record<string, AssetBanda> {
  const salida: Record<string, AssetBanda> = {}

  for (const banda of bandas) {
    const nombreAsset = coleccion.bandas[banda]
    if (!nombreAsset) throw new Error(`${coleccion.etiqueta} no publica la banda ${banda}`)

    const asset = escena.assets[nombreAsset]
    if (!asset) throw new Error(`La escena no trae el asset ${nombreAsset}`)

    salida[banda] = asset
  }

  return salida
}

async function firmarAssets(
  assets: Record<string, AssetBanda>,
  escena: Escena,
): Promise<Record<string, AssetBanda>> {
  const entradas = await Promise.all(
    Object.entries(assets).map(async ([nombre, asset]) => {
      const href = await firmarHref(escena.proveedor, asset.href)
      return [nombre, { ...asset, href }] as const
    }),
  )
  return Object.fromEntries(entradas)
}

/**
 * Leer las bandas es lo caro de todo el proceso. Cambiar de indice o mover el
 * umbral no deberia volver a bajar los mismos megabytes, asi que la pila de
 * cada escena se guarda por escena, rejilla y juego de bandas.
 *
 * El cache es por escena y no por mosaico a proposito: las dos mallas de una
 * fecha se leen una sola vez aunque despues se cambie cuales se combinan.
 */
const cachePilas = new Map<string, PilaBandas>()

function claveRejilla(rejilla: Rejilla): string {
  return [
    rejilla.ancho,
    rejilla.alto,
    rejilla.xmin.toFixed(6),
    rejilla.ymax.toFixed(6),
    rejilla.pixelAncho.toFixed(8),
    rejilla.pixelAlto.toFixed(8),
  ].join(',')
}

/**
 * Una escena leida sobre la rejilla comun y recortada a su propia huella.
 *
 * El recorte por huella no es cosmetico. Al pedir una ventana mas grande que
 * la imagen, geotiff rellena el sobrante; ese relleno se anula por el nodata
 * declarado, pero la huella real de una malla MGRS no es el rectangulo de su
 * bbox en grados, asi que sin este paso el borde de la escena entraria al
 * mosaico como si fuera dato.
 */
async function obtenerPilaEscena(
  escena: Escena,
  coleccion: Coleccion,
  bandas: NombreBanda[],
  rejilla: Rejilla,
): Promise<PilaBandas> {
  const clave = [escena.id, claveRejilla(rejilla), [...bandas].sort().join(',')].join('|')

  const guardada = cachePilas.get(clave)
  if (guardada) return guardada

  const assets = await firmarAssets(assetsDe(escena, coleccion, bandas), escena)
  const pila = await leerPila(assets, rejilla)

  const huella = mascaraDeHuella(rejilla, escena.huella)
  for (const banda of Object.values(pila.bandas)) aplicarMascara(banda, huella)

  cachePilas.set(clave, pila)
  if (cachePilas.size > 12) cachePilas.delete(cachePilas.keys().next().value as string)

  return pila
}

/** Lee todas las escenas del dia sobre la misma rejilla y las funde en una. */
async function obtenerMosaico(
  escenas: Escena[],
  coleccion: Coleccion,
  bandas: NombreBanda[],
  rejilla: Rejilla,
) {
  if (escenas.length === 0) throw new Error('No hay escenas seleccionadas')

  const pilas = await Promise.all(
    escenas.map((escena) => obtenerPilaEscena(escena, coleccion, bandas, rejilla)),
  )

  return combinarPilas(pilas)
}

/**
 * La celda no es cuadrada: el bbox del area rara vez tiene la misma proporcion
 * que la rejilla, y ademas un grado de longitud mide menos que uno de latitud,
 * asi que ancho y alto difieren y elevar uno al cuadrado sesga la superficie
 * varios puntos porcentuales.
 */
function hectareasPorPixel(rejilla: Rejilla): number {
  const celda = metrosDeCelda(rejilla)
  return (celda.ancho * celda.alto) / 10_000
}

function percentiles(valores: Float32Array): [number, number] {
  const finitos: number[] = []
  for (const valor of valores) if (!Number.isNaN(valor)) finitos.push(valor)
  if (finitos.length === 0) return [0, 1]

  finitos.sort((a, b) => a - b)
  const en = (p: number) => finitos[Math.min(finitos.length - 1, Math.floor(p * finitos.length))]
  return [en(0.02), en(0.98)]
}

function bandasQuePide(
  modo: ModoVista,
  coleccion: Coleccion,
  indice: DefinicionIndice | null,
  bandasKmeans: NombreBanda[],
): NombreBanda[] {
  if (modo === 'indice' || modo === 'cambio') {
    if (!indice) throw new Error('Falta elegir el índice')
    return [indice.a, indice.b] as NombreBanda[]
  }
  if (modo === 'clases') return bandasKmeans
  return coleccion.bandas.rojo
    ? (['rojo', 'verde', 'azul'] as NombreBanda[])
    : (['vv'] as NombreBanda[])
}

/** Etiqueta corta de un conjunto de escenas: las mallas que lo forman. */
function etiquetaEscenas(escenas: Escena[]): string {
  const mallas = escenas.map((escena) => escena.malla || escena.plataforma).filter(Boolean)
  return mallas.length > 0 ? mallas.join(' y ') : escenas[0].dia
}

export async function ejecutarAnalisis(
  parametros: ParametrosAnalisis,
): Promise<ResultadoAnalisis> {
  const {
    escenas,
    escenasReferencia,
    coleccion,
    bbox,
    areaGeojson,
    etiquetaArea,
    modo,
    indice,
    bandasKmeans,
    k,
    tamano,
    umbralCambio,
  } = parametros

  if (escenas.length === 0) throw new Error('Elige al menos una escena')

  const notas: string[] = []
  const bandasPedidas = bandasQuePide(modo, coleccion, indice, bandasKmeans)
  if (bandasPedidas.length === 0) throw new Error('No hay bandas que leer con esos ajustes')

  if (modo === 'cambio' && escenasReferencia.length === 0) {
    throw new Error('Elige la fecha contra la cual comparar')
  }

  // La rejilla sale del area, no de la escena, y es la misma para todas las
  // escenas y todas las fechas. Sin eso no se pueden sumar dos mallas que
  // viven en zonas UTM distintas ni restar dos fechas de mallas diferentes.
  const rejilla = rejillaDe(bbox, tamano, tamano)
  const dentro = mascaraDeArea(rejilla, areaGeojson)
  const haPixel = hectareasPorPixel(rejilla)
  const celda = metrosDeCelda(rejilla)

  let celdasDentro = 0
  for (const marca of dentro) celdasDentro += marca

  const mosaico = await obtenerMosaico(escenas, coleccion, bandasPedidas, rejilla)
  const cobertura = coberturaDelArea(mosaico.procedencia, dentro)

  if (cobertura === 0) {
    throw new Error(
      'Ninguna de las escenas elegidas tiene dato válido dentro del área. Prueba con la otra malla de la misma fecha.',
    )
  }

  const pila = mosaico.pila
  for (const banda of Object.values(pila.bandas)) aplicarMascara(banda, dentro)

  notas.push(
    `Rejilla ${tamano} por ${tamano} sobre el área, celda de ${celda.ancho.toFixed(0)} por ${celda.alto.toFixed(0)} m (sensor nativo ${coleccion.gsd} m).`,
  )
  notas.push(
    `Recortado al polígono de ${etiquetaArea}: ${(celdasDentro * haPixel).toLocaleString('es-MX', { maximumFractionDigits: 0 })} ha dentro del área.`,
  )

  if (escenas.length > 1) {
    const reparto = aportacionEnArea(mosaico.procedencia, dentro, escenas.length)
    const detalle = escenas
      .map(
        (escena, i) =>
          `${escena.malla || escena.plataforma} ${((reparto[i] / celdasDentro) * 100).toFixed(0)} por ciento`,
      )
      .join(', ')
    notas.push(`Mosaico de ${escenas.length} escenas del ${escenas[0].dia}: ${detalle}.`)
  }

  notas.push(
    cobertura >= 0.999
      ? 'El área queda cubierta por completo.'
      : `Quedan sin dato ${((1 - cobertura) * 100).toFixed(1)} por ciento de las celdas del área.`,
  )

  const sello = [
    modo,
    escenas.map((escena) => escena.id).join('+'),
    escenasReferencia.map((escena) => escena.id).join('+'),
    indice?.id ?? '',
    bandasKmeans.join(','),
    k,
    tamano,
    umbralCambio,
  ].join(':')

  if (modo === 'cambio') {
    const mosaicoBase = await obtenerMosaico(escenasReferencia, coleccion, bandasPedidas, rejilla)
    const pilaReferencia = mosaicoBase.pila
    for (const banda of Object.values(pilaReferencia.bandas)) aplicarMascara(banda, dentro)

    const despues = calcularIndice(pila, indice!)
    const antes = calcularIndice(pilaReferencia, indice!)

    const delta = new Float32Array(despues.valores.length)
    let baja = 0
    let sube = 0
    let estable = 0
    let sumaDelta = 0
    let validos = 0

    for (let i = 0; i < delta.length; i++) {
      const a = antes.valores[i]
      const b = despues.valores[i]

      if (Number.isNaN(a) || Number.isNaN(b)) {
        delta[i] = Number.NaN
        continue
      }

      const d = b - a
      delta[i] = d
      validos++
      sumaDelta += d

      if (d <= -umbralCambio) baja++
      else if (d >= umbralCambio) sube++
      else estable++
    }

    if (validos === 0) {
      throw new Error('Las dos fechas no comparten píxeles válidos dentro del área')
    }

    const limite = Math.max(
      umbralCambio * 2,
      Math.max(Math.abs(percentiles(delta)[0]), Math.abs(percentiles(delta)[1])),
    )

    notas.unshift(
      `Diferencia de ${indice!.etiqueta}: ${escenasReferencia[0].dia} (${etiquetaEscenas(escenasReferencia)}) como base contra ${escenas[0].dia} (${etiquetaEscenas(escenas)}).`,
    )
    notas.push(
      `Cambio medio ${(sumaDelta / validos).toFixed(3)} sobre ${validos.toLocaleString('es-MX')} píxeles comparables, ${((validos / celdasDentro) * 100).toFixed(1)} por ciento del área. Umbral ${umbralCambio.toFixed(2)}.`,
    )

    const leyenda: EntradaLeyenda[] = [
      {
        color: colorDeCambio(-limite, limite) ?? '#c86',
        etiqueta: `Baja el ${indice!.etiqueta}`,
        detalle: `${(baja * haPixel).toLocaleString('es-MX', { maximumFractionDigits: 0 })} ha (${((baja / validos) * 100).toFixed(1)} por ciento)`,
      },
      {
        color: '#d8d8d8',
        etiqueta: 'Sin cambio relevante',
        detalle: `${(estable * haPixel).toLocaleString('es-MX', { maximumFractionDigits: 0 })} ha (${((estable / validos) * 100).toFixed(1)} por ciento)`,
      },
      {
        color: colorDeCambio(limite, limite) ?? '#68c',
        etiqueta: `Sube el ${indice!.etiqueta}`,
        detalle: `${(sube * haPixel).toLocaleString('es-MX', { maximumFractionDigits: 0 })} ha (${((sube / validos) * 100).toFixed(1)} por ciento)`,
      },
    ]

    return {
      rejilla,
      bandas: [delta],
      colorear: ([valor]) => {
        if (Number.isNaN(valor)) return undefined
        if (Math.abs(valor) < umbralCambio) return undefined
        return colorDeCambio(valor, limite)
      },
      leyenda,
      notas,
      sello,
    }
  }

  if (modo === 'indice') {
    const resultado = calcularIndice(pila, indice!)
    notas.push(
      `${indice!.etiqueta} entre ${resultado.p2.toFixed(2)} y ${resultado.p98.toFixed(2)} (percentiles 2 y 98 de ${resultado.validos.toLocaleString('es-MX')} píxeles válidos).`,
    )

    const leyenda: EntradaLeyenda[] = [0, 0.25, 0.5, 0.75, 1].map((t) => {
      const valor = resultado.p2 + t * (resultado.p98 - resultado.p2)
      return { color: colorDeIndice(valor, resultado.p2, resultado.p98), etiqueta: valor.toFixed(2) }
    })

    return {
      rejilla,
      bandas: [resultado.valores],
      colorear: ([valor]) =>
        Number.isNaN(valor) ? undefined : colorDeIndice(valor, resultado.p2, resultado.p98),
      leyenda,
      notas,
      sello,
    }
  }

  if (modo === 'clases') {
    const matrices = bandasKmeans.map((banda) => pila.bandas[banda])
    const resultado = kmeans(matrices, bandasKmeans, k)

    if (resultado.centroides.length === 0) {
      throw new Error('No hubo píxeles válidos suficientes para agrupar')
    }

    const totalClasificado = resultado.conteos.reduce((suma, c) => suma + c, 0)

    notas.push(
      resultado.convergio
        ? `k-means convergió en ${resultado.iteraciones} iteraciones sobre ${totalClasificado.toLocaleString('es-MX')} píxeles.`
        : `k-means se detuvo en el límite de ${resultado.iteraciones} iteraciones sin converger.`,
    )
    notas.push(
      `Bandas usadas: ${bandasKmeans.join(', ')}. Estandarizadas antes de agrupar y semilla fija, asi que el resultado se repite.`,
    )

    const leyenda: EntradaLeyenda[] = resultado.conteos.map((conteo, clase) => {
      const firma = resultado.centroides[clase]
        .map((valor, i) => `${bandasKmeans[i]} ${valor.toFixed(3)}`)
        .join(', ')

      return {
        color: colorDeClase(clase),
        etiqueta: `Clase ${clase + 1}`,
        detalle: `${(conteo * haPixel).toLocaleString('es-MX', { maximumFractionDigits: 0 })} ha (${((conteo / totalClasificado) * 100).toFixed(1)} por ciento) - ${firma}`,
      }
    })

    const etiquetas = new Float32Array(resultado.etiquetas.length)
    for (let i = 0; i < etiquetas.length; i++) {
      etiquetas[i] = resultado.etiquetas[i] < 0 ? Number.NaN : resultado.etiquetas[i]
    }

    return {
      rejilla,
      bandas: [etiquetas],
      colorear: ([valor]) => (Number.isNaN(valor) ? undefined : colorDeClase(Math.round(valor))),
      leyenda,
      notas,
      sello,
    }
  }

  const matrices = bandasPedidas.map((banda) => pila.bandas[banda])
  const rangos = matrices.map((matriz) => percentiles(matriz))

  notas.push(
    `Estirado por percentiles 2 y 98: ${bandasPedidas
      .map((banda, i) => `${banda} ${rangos[i][0].toFixed(3)} a ${rangos[i][1].toFixed(3)}`)
      .join(', ')}.`,
  )

  const aByte = (valor: number, rango: [number, number]) => {
    const t = (valor - rango[0]) / (rango[1] - rango[0] || 1)
    return Math.round(Math.min(1, Math.max(0, t)) * 255)
  }

  return {
    rejilla,
    bandas: matrices,
    colorear: (valores) => {
      if (valores.some((valor) => Number.isNaN(valor))) return undefined
      if (valores.length === 1) return colorDeGris(valores[0], rangos[0][0], rangos[0][1])
      const [r, g, b] = valores.map((valor, i) => aByte(valor, rangos[i]))
      return `rgb(${r},${g},${b})`
    },
    leyenda: [],
    notas,
    sello,
  }
}
