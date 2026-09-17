import type { FeatureCollection } from 'geojson'
import { metrosDeCelda, rejillaDe, type Rejilla } from './raster'
import { obtenerMosaico } from './pilas'
import {
  calcularIndice,
  mascaraDeAgua,
  recortarAgua,
  type DefinicionIndice,
} from './indices'
import { kmeans } from './kmeans'
import { aplicarMascara, mascaraDeArea } from './mascara'
import { aportacionEnArea, coberturaDelArea } from './mosaico'
import { colorDeCambio, colorDeClase, colorDeGris, colorDeIndice } from './paletas'
import { detectarObraNueva, diasEntre, mismaTemporada } from './obranueva'
import { nubosidadEnArea } from './nubes'
import { INDICES } from './indices'
import type { Bbox, Coleccion, Escena, ModoVista, NombreBanda } from '../tipos'

/** Un solo color para la obra nueva: es una alerta, no una escala. */
const COLOR_OBRA = '#fb7185'

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
  /**
   * Puntos que el mapa marca aparte del raster. Una zona de obra de una
   * hectarea son cuatro celdas: a escala municipal no se ve, y sin marca el
   * resultado es invisible justo cuando mas importa.
   */
  marcas?: MarcaMapa[]
  /** Cambia con cada corrida para que la capa del mapa se reconstruya. */
  sello: string
}

export interface MarcaMapa {
  lat: number
  lon: number
  /** Area en hectareas, para dimensionar el circulo. */
  hectareas: number
  etiqueta: string
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
  /** Modo obra: cuanto tiene que subir el NDBI para contar como construido. */
  umbralObra: number
  /** Modo obra: zonas menores a esto se descartan por ruido. */
  areaMinimaObra: number
  /** Descartar nubes y sombras pixel por pixel con la mascara de la mision. */
  quitarNubes: boolean
  /** Calcular solo sobre la lamina de agua. Obligatorio para NDCI y NDTI. */
  soloAgua: boolean
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

/** Las que hacen falta para dibujar la lamina de agua con MNDWI, o NDWI si no hay SWIR. */
export function bandasDelAgua(coleccion: Coleccion): NombreBanda[] {
  return coleccion.bandas.swir1 ? ['verde', 'swir1'] : ['verde', 'nir']
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
  // Obra nueva cruza NDBI, NDVI y MNDWI, asi que pide sus cuatro bandas.
  if (modo === 'obra') {
    const necesarias: NombreBanda[] = ['swir1', 'nir', 'rojo', 'verde']
    const faltan = necesarias.filter((banda) => !coleccion.bandas[banda])
    if (faltan.length > 0) {
      throw new Error(
        `${coleccion.etiqueta} no publica ${faltan.join(' ni ')}, que hacen falta para obra nueva`,
      )
    }
    return necesarias
  }
  if (modo === 'clases') return bandasKmeans
  return coleccion.bandas.rojo
    ? (['rojo', 'verde', 'azul'] as NombreBanda[])
    : (['vv'] as NombreBanda[])
}

/**
 * Cuanto le costo la mascara de nubes a cada escena, dentro del area. Es un
 * dato que hay que ver: si descarto el 40 por ciento del municipio, el
 * resultado se sostiene sobre la mitad del terreno y conviene buscar otra fecha.
 */
function notaDeNubes(
  nubesPorEscena: (Uint8Array | null)[],
  escenas: Escena[],
  dentro: Uint8Array,
  celdasDentro: number,
  coleccion: Coleccion,
  cual: 'actual' | 'base',
): string {
  if (coleccion.mascaraNubes === null) {
    return `${coleccion.etiqueta} es radar: no hay nubes que descartar.`
  }

  if (nubesPorEscena.every((mascara) => mascara === null)) {
    return `Fecha ${cual} sin máscara por píxel: el filtro de la búsqueda es por escena completa, así que puede quedar nube sobre el área.`
  }

  const detalle = nubesPorEscena
    .map((mascara, i) => {
      const etiqueta = escenas[i].malla || escenas[i].plataforma
      if (!mascara) return `${etiqueta} sin máscara`

      const { nubladas, observadas } = nubosidadEnArea(mascara, dentro)
      if (observadas === 0) return `${etiqueta} no alcanza el área`

      const porcentaje = (nubladas / observadas) * 100
      const alcance = (observadas / celdasDentro) * 100
      const cobertura =
        alcance >= 99.5 ? '' : `, y esa escena solo cubre ${alcance.toFixed(0)} por ciento del área`
      return `${etiqueta} con ${porcentaje.toFixed(1)} por ciento nublado de lo que observa${cobertura}`
    })
    .join(', ')

  return `Máscara de nubes de la fecha ${cual} (${coleccion.mascaraNubes.tipo}): ${detalle}.`
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
    umbralObra,
    areaMinimaObra,
    quitarNubes,
    soloAgua,
  } = parametros

  if (escenas.length === 0) throw new Error('Elige al menos una escena')

  const notas: string[] = []
  const recorteAgua = soloAgua || indice?.soloAgua === true
  const bandasPedidas = [
    ...new Set([
      ...bandasQuePide(modo, coleccion, indice, bandasKmeans),
      ...(recorteAgua ? bandasDelAgua(coleccion) : []),
    ]),
  ]
  if (bandasPedidas.length === 0) throw new Error('No hay bandas que leer con esos ajustes')

  if ((modo === 'cambio' || modo === 'obra') && escenasReferencia.length === 0) {
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

  const mosaico = await obtenerMosaico(escenas, coleccion, bandasPedidas, rejilla, quitarNubes)
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
    notaDeNubes(mosaico.nubesPorEscena, escenas, dentro, celdasDentro, coleccion, 'actual'),
  )

  if (recorteAgua) {
    const agua = mascaraDeAgua(pila)
    let celdasAgua = 0
    for (const banda of Object.values(pila.bandas)) celdasAgua = recortarAgua(banda, agua)
    if (celdasAgua === 0) {
      throw new Error(
        'No se detectó lámina de agua en el área con esa fecha. Revisa que el vaso tenga agua y que la escena no esté nublada.',
      )
    }
    notas.push(
      `Recortado a la lámina de agua: ${(celdasAgua * haPixel).toLocaleString('es-MX', { maximumFractionDigits: 0 })} ha de agua, ${((celdasAgua / celdasDentro) * 100).toFixed(1)} por ciento del área.`,
    )
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
    umbralObra,
    areaMinimaObra,
    quitarNubes ? 'sinNubes' : 'conNubes',
    recorteAgua ? 'agua' : 'todo',
  ].join(':')

  // Separacion temporal: lo primero que hay que saber al comparar dos fechas.
  if (modo === 'cambio' || modo === 'obra') {
    const dias = diasEntre(escenasReferencia[0].dia, escenas[0].dia)
    notas.unshift(
      `Separación temporal: ${dias} días entre ${escenasReferencia[0].dia} y ${escenas[0].dia}. ${coleccion.etiqueta} revisita cada ${coleccion.revisitaDias} días, así que es el paso más fino disponible.`,
    )
    if (!mismaTemporada(escenasReferencia[0].dia, escenas[0].dia)) {
      notas.push(
        'Las dos fechas caen en temporadas distintas (las lluvias van de junio a octubre). El cambio incluye vegetación que aparece y desaparece sola; para obra nueva conviene comparar el mismo mes de dos años.',
      )
    }
  }

  if (modo === 'obra') {
    const mosaicoBase = await obtenerMosaico(
      escenasReferencia,
      coleccion,
      bandasPedidas,
      rejilla,
      quitarNubes,
    )
    const pilaReferencia = mosaicoBase.pila
    for (const banda of Object.values(pilaReferencia.bandas)) aplicarMascara(banda, dentro)
    notas.push(
      notaDeNubes(mosaicoBase.nubesPorEscena, escenasReferencia, dentro, celdasDentro, coleccion, 'base'),
    )

    const porId = (id: string) => INDICES.find((indice) => indice.id === id)!
    const ndbi = porId('ndbi')
    const ndvi = porId('ndvi')
    const mndwi = porId('mndwi')

    const resultado = detectarObraNueva({
      ndbiAntes: calcularIndice(pilaReferencia, ndbi).valores,
      ndbiDespues: calcularIndice(pila, ndbi).valores,
      ndviAntes: calcularIndice(pilaReferencia, ndvi).valores,
      ndviDespues: calcularIndice(pila, ndvi).valores,
      mndwiDespues: calcularIndice(pila, mndwi).valores,
      rejilla,
      hectareasPorCelda: haPixel,
      umbralNdbi: umbralObra,
      ndviMaximoDespues: 0.3,
      areaMinimaHa: areaMinimaObra,
    })

    if (resultado.celdasComparables === 0) {
      throw new Error('Las dos fechas no comparten píxeles válidos dentro del área')
    }

    notas.push(
      `Regla: NDBI sube ${umbralObra.toFixed(2)} o más, NDVI final bajo 0.30 y MNDWI negativo. ${resultado.celdasCrudas.toLocaleString('es-MX')} celdas la cumplieron sobre ${resultado.celdasComparables.toLocaleString('es-MX')} comparables.`,
    )
    notas.push(
      `Se descartaron las manchas menores a ${areaMinimaObra.toFixed(1)} ha, que a esta rejilla son menos de ${Math.max(1, Math.ceil(areaMinimaObra / haPixel))} celdas.`,
    )
    notas.push(
      'Son zonas candidatas, no un dictamen: un despalme sin construir cumple la misma regla, y a esta resolución una casa sola no se ve.',
    )

    for (const [i, zona] of resultado.zonas.slice(0, 5).entries()) {
      notas.push(
        `Zona ${i + 1}: ${zona.hectareas.toFixed(1)} ha, centro ${zona.lat.toFixed(5)}, ${zona.lon.toFixed(5)}`,
      )
    }

    const leyenda: EntradaLeyenda[] = [
      {
        color: COLOR_OBRA,
        etiqueta: `Obra nueva probable: ${resultado.zonas.length} zonas`,
        detalle: `${resultado.hectareasTotales.toLocaleString('es-MX', { maximumFractionDigits: 1 })} ha en total${
          resultado.zonas.length > 0 ? `, la mayor de ${resultado.zonas[0].hectareas.toFixed(1)} ha` : ''
        }`,
      },
    ]

    return {
      rejilla,
      bandas: [resultado.mascara],
      colorear: ([valor]) => (Number.isNaN(valor) ? undefined : COLOR_OBRA),
      leyenda,
      notas,
      marcas: resultado.zonas.map((zona, i) => ({
        lat: zona.lat,
        lon: zona.lon,
        hectareas: zona.hectareas,
        etiqueta: `Zona ${i + 1}: ${zona.hectareas.toFixed(1)} ha`,
      })),
      sello,
    }
  }

  if (modo === 'cambio') {
    const mosaicoBase = await obtenerMosaico(
      escenasReferencia,
      coleccion,
      bandasPedidas,
      rejilla,
      quitarNubes,
    )
    const pilaReferencia = mosaicoBase.pila
    for (const banda of Object.values(pilaReferencia.bandas)) aplicarMascara(banda, dentro)
    notas.push(
      notaDeNubes(mosaicoBase.nubesPorEscena, escenasReferencia, dentro, celdasDentro, coleccion, 'base'),
    )

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
      `Bandas usadas: ${bandasKmeans.join(', ')}. Estandarizadas antes de agrupar y semilla fija, así que el resultado se repite.`,
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
