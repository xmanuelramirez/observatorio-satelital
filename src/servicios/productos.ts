import type { FeatureCollection } from 'geojson'
import type { EntradaLeyenda, ResultadoAnalisis } from './analisis'
import { aplicarMascara, mascaraDeArea } from './mascara'
import { firmarHref } from './proveedores'
import { leerPila, metrosDeCelda, rejillaDe, type Rejilla } from './raster'
import { baseStac } from './proveedores'
import type { AssetBanda, Bbox } from '../tipos'

/**
 * Productos globales ya calculados, que no son escenas que uno elija por
 * fecha: son capas de referencia que alguien mas produjo y que aqui solo se
 * recortan al area y se miden.
 *
 * Viven aparte del analisis de escenas porque su ciclo es otro: no hay
 * busqueda por nubosidad, no hay mosaico del dia y no hay dos fechas que
 * comparar. Todos se leen de Planetary Computer, que los sirve como COG y
 * entrega firma anonima.
 */

export type IdProducto = 'agua-historica' | 'cobertura' | 'evapotranspiracion'

interface Interpretacion {
  bandas: Float32Array[]
  colorear: (valores: number[]) => string | undefined
  leyenda: EntradaLeyenda[]
  notas: string[]
}

interface DefinicionProducto {
  id: IdProducto
  etiqueta: string
  descripcion: string
  coleccion: string
  asset: string
  /** Resolucion nativa, para decirla sin adornos. */
  metros: number
  fuente: string
  interpretar: (valores: Float32Array, hectareasPorCelda: number) => Interpretacion
}

/** Azul que crece con la permanencia del agua. */
function colorDeAgua(porcentaje: number): string {
  const t = Math.max(0, Math.min(1, porcentaje / 100))
  return `rgb(${Math.round(190 - 150 * t)},${Math.round(225 - 100 * t)},${Math.round(245 - 55 * t)})`
}

/**
 * Colores oficiales de ESA WorldCover. Se respetan a proposito: es la
 * leyenda que cualquiera encuentra en la documentacion del producto, y
 * cambiarla solo confunde a quien ya la conoce.
 */
const CLASES_COBERTURA: Record<number, { nombre: string; color: string }> = {
  10: { nombre: 'Arbolado', color: '#006400' },
  20: { nombre: 'Matorral', color: '#ffbb22' },
  30: { nombre: 'Pastizal', color: '#ffff4c' },
  40: { nombre: 'Agrícola', color: '#f096ff' },
  50: { nombre: 'Construido', color: '#fa0000' },
  60: { nombre: 'Suelo desnudo', color: '#b4b4b4' },
  70: { nombre: 'Nieve y hielo', color: '#f0f0f0' },
  80: { nombre: 'Agua permanente', color: '#0064c8' },
  90: { nombre: 'Humedal herbáceo', color: '#0096a0' },
  95: { nombre: 'Manglar', color: '#00cf75' },
  100: { nombre: 'Musgo y liquen', color: '#fae6a0' },
}

function hectareas(celdas: number, hectareasPorCelda: number): string {
  return `${(celdas * hectareasPorCelda).toLocaleString('es-MX', { maximumFractionDigits: 0 })} ha`
}

export const PRODUCTOS: DefinicionProducto[] = [
  {
    id: 'agua-historica',
    etiqueta: 'Agua histórica',
    descripcion: 'Cuántas veces hubo agua en cada punto entre 1984 y 2021',
    coleccion: 'jrc-gsw',
    asset: 'occurrence',
    metros: 30,
    fuente: 'JRC Global Surface Water (Pekel et al.)',
    interpretar: (valores, haPorCelda) => {
      let permanente = 0
      let estacional = 0
      let ocasional = 0

      for (const valor of valores) {
        if (Number.isNaN(valor) || valor <= 0) continue
        if (valor >= 90) permanente++
        else if (valor >= 50) estacional++
        else ocasional++
      }

      const leyenda: EntradaLeyenda[] = [
        {
          color: colorDeAgua(95),
          etiqueta: 'Permanente (90 a 100 % de las veces)',
          detalle: hectareas(permanente, haPorCelda),
        },
        {
          color: colorDeAgua(70),
          etiqueta: 'Estacional (50 a 90 %)',
          detalle: hectareas(estacional, haPorCelda),
        },
        {
          color: colorDeAgua(25),
          etiqueta: 'Ocasional (menos de 50 %)',
          detalle: hectareas(ocasional, haPorCelda),
        },
      ]

      return {
        bandas: [valores],
        colorear: ([valor]) =>
          Number.isNaN(valor) || valor <= 0 ? undefined : colorDeAgua(valor),
        leyenda,
        notas: [
          'Frecuencia con la que Landsat vio agua en cada punto entre 1984 y 2021. Sirve para ver hasta dónde llegó el vaso en su mejor año, no para saber cómo está hoy.',
          `El agua permanente del área suma ${hectareas(permanente, haPorCelda)}; la estacional, ${hectareas(estacional, haPorCelda)}.`,
        ],
      }
    },
  },
  {
    id: 'cobertura',
    etiqueta: 'Cobertura del suelo',
    descripcion: 'Once clases a 10 m, año 2021',
    coleccion: 'esa-worldcover',
    asset: 'map',
    metros: 10,
    fuente: 'ESA WorldCover 10 m v200 (2021)',
    interpretar: (valores, haPorCelda) => {
      const conteo = new Map<number, number>()
      let total = 0

      for (const valor of valores) {
        if (Number.isNaN(valor)) continue
        const clase = Math.round(valor)
        if (!CLASES_COBERTURA[clase]) continue
        conteo.set(clase, (conteo.get(clase) ?? 0) + 1)
        total++
      }

      const leyenda: EntradaLeyenda[] = [...conteo.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([clase, celdas]) => ({
          color: CLASES_COBERTURA[clase].color,
          etiqueta: CLASES_COBERTURA[clase].nombre,
          detalle: `${hectareas(celdas, haPorCelda)} (${((celdas / total) * 100).toFixed(1)} por ciento)`,
        }))

      return {
        bandas: [valores],
        colorear: ([valor]) => {
          if (Number.isNaN(valor)) return undefined
          return CLASES_COBERTURA[Math.round(valor)]?.color
        },
        leyenda,
        notas: [
          'Clasificación de 2021, no de hoy: para ver qué cambió desde entonces, el modo Obra compara dos fechas de Sentinel-2.',
          'Los colores son los oficiales del producto, para que la leyenda coincida con su documentación.',
        ],
      }
    },
  },
  {
    id: 'evapotranspiracion',
    etiqueta: 'Evapotranspiración anual',
    descripcion: 'Milímetros al año, resolución de 500 m',
    coleccion: 'modis-16A3GF-061',
    asset: 'ET_500m',
    metros: 500,
    fuente: 'MODIS MOD16A3GF v061',
    interpretar: (valores, haPorCelda) => {
      const validos: number[] = []
      for (const valor of valores) {
        // Por encima de 3,000 mm al año son banderas del producto (agua,
        // urbano, sin datos), no evapotranspiracion.
        if (Number.isNaN(valor) || valor > 3000) continue
        validos.push(valor)
      }

      if (validos.length === 0) {
        return {
          bandas: [valores],
          colorear: () => undefined,
          leyenda: [],
          notas: ['El producto no trae valores válidos dentro del área.'],
        }
      }

      validos.sort((a, b) => a - b)
      const media = validos.reduce((suma, v) => suma + v, 0) / validos.length
      const p2 = validos[Math.floor(validos.length * 0.02)]
      const p98 = validos[Math.floor(validos.length * 0.98)]

      const color = (valor: number) => {
        const t = Math.max(0, Math.min(1, (valor - p2) / (p98 - p2 || 1)))
        return `rgb(${Math.round(240 - 180 * t)},${Math.round(230 - 60 * t)},${Math.round(200 - 120 * t)})`
      }

      return {
        bandas: [valores],
        colorear: ([valor]) =>
          Number.isNaN(valor) || valor > 3000 ? undefined : color(valor),
        leyenda: [0, 0.5, 1].map((t) => {
          const valor = p2 + t * (p98 - p2)
          return { color: color(valor), etiqueta: `${valor.toFixed(0)} mm al año` }
        }),
        notas: [
          `Media de ${media.toFixed(0)} mm al año sobre el área, entre ${p2.toFixed(0)} y ${p98.toFixed(0)} (percentiles 2 y 98) en ${hectareas(validos.length, haPorCelda)} con dato.`,
          'A 500 m de resolución, una celda mezcla ciudad y campo: sirve para el balance del municipio, no para un predio.',
          'Es el producto anual ya rellenado (gap-filled). OpenET, que sería el estándar fino, no cubre México.',
        ],
      }
    },
  },
]

interface ItemProducto {
  id: string
  assets: Record<string, { href: string; 'raster:bands'?: { nodata?: number; scale?: number; offset?: number }[] }>
  properties: Record<string, unknown>
}

async function buscarItems(coleccion: string, bbox: Bbox, senal?: AbortSignal): Promise<ItemProducto[]> {
  const respuesta = await fetch(`${baseStac('planetary-computer')}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collections: [coleccion], bbox, limit: 12 }),
    signal: senal,
  })

  if (!respuesta.ok) throw new Error(`El catálogo respondió ${respuesta.status}`)

  const datos = (await respuesta.json()) as { features?: ItemProducto[] }
  const items = datos.features ?? []
  if (items.length === 0) throw new Error('El producto no tiene cobertura sobre esta área')

  /*
   * Solo el año mas reciente. MODIS publica un item por año y por tesela, y
   * leerlos todos no solo tarda: firmar doce hrefs seguidos hace que el
   * firmador de Planetary Computer conteste 429.
   */
  const fecha = (item: ItemProducto) =>
    String(item.properties.datetime ?? item.properties.start_datetime ?? '')

  const masReciente = items
    .map(fecha)
    .sort()
    .at(-1)

  const delAnio = items.filter((item) => fecha(item).slice(0, 4) === (masReciente ?? '').slice(0, 4))

  return delAnio.length > 0 ? delAnio : items
}

export interface ParametrosProducto {
  producto: DefinicionProducto
  bbox: Bbox
  areaGeojson: FeatureCollection
  etiquetaArea: string
  tamano: number
  senal?: AbortSignal
}

export async function cargarProducto(
  parametros: ParametrosProducto,
): Promise<ResultadoAnalisis> {
  const { producto, bbox, areaGeojson, etiquetaArea, tamano, senal } = parametros

  const rejilla: Rejilla = rejillaDe(bbox, tamano, tamano)
  const dentro = mascaraDeArea(rejilla, areaGeojson)

  let celdasDentro = 0
  for (const marca of dentro) celdasDentro += marca

  const items = await buscarItems(producto.coleccion, bbox, senal)
  const anio = String(
    items[0]?.properties.datetime ?? items[0]?.properties.start_datetime ?? '',
  ).slice(0, 4)

  /*
   * Estos productos vienen en teselas grandes y el area puede caer en el
   * borde de dos. Se leen todas y se rellena hueco por hueco: la primera que
   * tenga dato en la celda manda, igual que en el mosaico de escenas.
   */
  const combinada = new Float32Array(rejilla.ancho * rejilla.alto).fill(Number.NaN)
  let usados = 0

  for (const item of items) {
    const asset = item.assets[producto.asset]
    if (!asset) continue

    const raster = asset['raster:bands']?.[0]
    const definicion: AssetBanda = {
      href: await firmarHref('planetary-computer', asset.href),
      escala: raster?.scale ?? null,
      desplazamiento: raster?.offset ?? null,
      sinDato: raster?.nodata ?? null,
    }

    const pila = await leerPila({ valor: definicion }, rejilla)
    const valores = pila.bandas.valor
    let aporto = false

    for (let i = 0; i < combinada.length; i++) {
      if (Number.isNaN(combinada[i]) && !Number.isNaN(valores[i])) {
        combinada[i] = valores[i]
        aporto = true
      }
    }

    if (aporto) usados++
    if (!combinada.some((valor) => Number.isNaN(valor))) break
  }

  if (usados === 0) throw new Error('Ninguna tesela del producto trajo datos sobre el área')

  aplicarMascara(combinada, dentro)

  const celda = metrosDeCelda(rejilla)
  const haPorCelda = (celda.ancho * celda.alto) / 10_000
  const interpretacion = producto.interpretar(combinada, haPorCelda)

  const notas = [
    `${producto.fuente}, resolución nativa de ${producto.metros} m.${anio ? ` Año ${anio}.` : ''}`,
    `Recortado al polígono de ${etiquetaArea}: ${(celdasDentro * haPorCelda).toLocaleString('es-MX', { maximumFractionDigits: 0 })} ha, sobre rejilla de ${tamano} por ${tamano}.`,
    ...interpretacion.notas,
    usados > 1 ? `Se unieron ${usados} teselas del producto.` : '',
  ].filter(Boolean)

  return {
    rejilla,
    bandas: interpretacion.bandas,
    colorear: interpretacion.colorear,
    leyenda: interpretacion.leyenda,
    notas,
    sello: `producto:${producto.id}:${tamano}:${bbox.join(',')}`,
  }
}
