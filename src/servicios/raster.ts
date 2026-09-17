import { fromUrl } from 'geotiff'
import proj4 from 'proj4'
import type { AssetBanda, Bbox } from '../tipos'

/**
 * Los COG de Sentinel-2 y Landsat vienen en UTM. proj4 solo trae 4326 y 3857
 * de fabrica, pero un codigo EPSG 326xx o 327xx describe una zona UTM completa,
 * asi que la definicion se arma sin necesidad de una base de CRS.
 */
export function definicionCrs(epsg: number): string {
  if (epsg === 4326) return 'EPSG:4326'
  if (epsg === 3857) return 'EPSG:3857'

  const familia = Math.floor(epsg / 100)
  if (familia === 326 || familia === 327) {
    const zona = epsg % 100
    const sur = familia === 327 ? ' +south' : ''
    return `+proj=utm +zone=${zona}${sur} +datum=WGS84 +units=m +no_defs`
  }

  throw new Error(`CRS no soportado todavia: EPSG:${epsg}`)
}

/** Codigo EPSG reservado para "definido por el usuario" en las geo keys. */
const EPSG_A_MEDIDA = 32767

/** CT_Sinusoidal en la tabla de transformaciones de GeoTIFF. Es la de MODIS. */
const CT_SINUSOIDAL = 24

type GeoKeys = Record<string, number | string | undefined>

/**
 * Arma la proyeccion desde las geo keys del propio archivo.
 *
 * La mayoria de los COG declaran un EPSG y con eso basta, pero MODIS no: su
 * rejilla sinusoidal no tiene codigo EPSG, asi que el archivo pone 32767
 * ("definido por el usuario") y describe la proyeccion por partes. Sin leer
 * esas partes, cualquier producto MODIS queda fuera del alcance de la app.
 */
export function crsDeGeoKeys(claves: GeoKeys): string {
  const numero = (clave: string): number | undefined => {
    const valor = claves[clave]
    return typeof valor === 'number' ? valor : undefined
  }

  const proyectado = numero('ProjectedCSTypeGeoKey')
  const geografico = numero('GeographicTypeGeoKey')

  if (proyectado && proyectado !== EPSG_A_MEDIDA) return definicionCrs(proyectado)
  if (!proyectado && geografico && geografico !== EPSG_A_MEDIDA) return definicionCrs(geografico)

  if (numero('ProjCoordTransGeoKey') === CT_SINUSOIDAL) {
    const radio = numero('GeogSemiMajorAxisGeoKey') ?? 6371007.181
    const centro = numero('ProjCenterLongGeoKey') ?? 0
    const este = numero('ProjFalseEastingGeoKey') ?? 0
    const norte = numero('ProjFalseNorthingGeoKey') ?? 0
    return `+proj=sinu +lon_0=${centro} +x_0=${este} +y_0=${norte} +R=${radio} +units=m +no_defs`
  }

  throw new Error(
    'El COG usa una proyeccion que la app todavia no sabe leer y no declara codigo EPSG',
  )
}

/** Reproyecta las cuatro esquinas, no solo dos: en UTM el rectangulo se curva. */
function bboxProyectado(bbox: Bbox, destino: string): Bbox {
  if (destino === 'EPSG:4326') return bbox

  const esquinas: [number, number][] = [
    [bbox[0], bbox[1]],
    [bbox[2], bbox[1]],
    [bbox[2], bbox[3]],
    [bbox[0], bbox[3]],
  ]

  const proyectadas = esquinas.map((esquina) => proj4('EPSG:4326', destino, esquina))
  const xs = proyectadas.map((p) => p[0])
  const ys = proyectadas.map((p) => p[1])

  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

export interface Rejilla {
  ancho: number
  alto: number
  epsg: number
  xmin: number
  ymax: number
  pixelAncho: number
  pixelAlto: number
  /** Metros por pixel de la rejilla de analisis, no del sensor. */
  metrosPorPixel: number
}

export interface PilaBandas {
  rejilla: Rejilla
  /** Reflectancia ya escalada a unidades fisicas, o NaN donde no hay dato. */
  bandas: Record<string, Float32Array>
}

/**
 * Metros por grado sobre el elipsoide WGS84, por la serie estandar.
 *
 * Dos cosas se pagan si se toma el atajo. Ignorar el coseno de la latitud
 * infla cada celda un 7 por ciento, porque en Leon un grado de longitud mide
 * 103.9 km y no 111.3. Y quedarse en la aproximacion esferica, 111_320 por el
 * coseno para longitud y 110_540 para latitud, deja la superficie del
 * municipio 0.2 por ciento corta: casi 3 km2 que se arrastran a cada cifra de
 * hectareas de la leyenda.
 */
function metrosPorGrado(latitud: number): { lon: number; lat: number } {
  const f = (latitud * Math.PI) / 180

  return {
    lat:
      111_132.92 -
      559.82 * Math.cos(2 * f) +
      1.175 * Math.cos(4 * f) -
      0.0023 * Math.cos(6 * f),
    lon: 111_412.84 * Math.cos(f) - 93.5 * Math.cos(3 * f) + 0.118 * Math.cos(5 * f),
  }
}

/** Latitud del centro de la rejilla, que es donde se evalua la escala. */
function latitudMedia(rejilla: Rejilla): number {
  return rejilla.ymax - (rejilla.alto * rejilla.pixelAlto) / 2
}

/** Tamano real de una celda en metros, con la celda tratada como rectangulo. */
export function metrosDeCelda(rejilla: Rejilla): { ancho: number; alto: number } {
  if (rejilla.epsg !== 4326) {
    return { ancho: rejilla.pixelAncho, alto: rejilla.pixelAlto }
  }

  const grado = metrosPorGrado(latitudMedia(rejilla))
  return {
    ancho: rejilla.pixelAncho * grado.lon,
    alto: rejilla.pixelAlto * grado.lat,
  }
}

/**
 * La rejilla de analisis se define desde el area, en grados, y no desde la
 * escena.
 *
 * Importa mas de lo que parece: los dos tiles MGRS que cubren Leon caen en
 * zonas UTM distintas, 13QHD en EPSG:32613 y 14QKJ en EPSG:32614. Si cada
 * escena impusiera su propia rejilla nativa no habria forma de sumarlas, ni de
 * restar dos fechas que vinieran de mallas distintas. Con una rejilla comun en
 * 4326 todas las escenas aterrizan en las mismas celdas.
 */
export function rejillaDe(bbox: Bbox, ancho: number, alto: number): Rejilla {
  const pixelAncho = (bbox[2] - bbox[0]) / ancho
  const pixelAlto = (bbox[3] - bbox[1]) / alto

  const rejilla: Rejilla = {
    ancho,
    alto,
    epsg: 4326,
    xmin: bbox[0],
    ymax: bbox[3],
    pixelAncho,
    pixelAlto,
    metrosPorPixel: 0,
  }

  rejilla.metrosPorPixel = metrosDeCelda(rejilla).ancho
  return rejilla
}

/** Bbox de la rejilla en sus propias unidades. */
function bboxDeRejilla(rejilla: Rejilla): Bbox {
  return [
    rejilla.xmin,
    rejilla.ymax - rejilla.alto * rejilla.pixelAlto,
    rejilla.xmin + rejilla.ancho * rejilla.pixelAncho,
    rejilla.ymax,
  ]
}

/** La ventana leida del COG, todavia en el CRS nativo de la escena. */
interface VentanaNativa {
  valores: Float32Array
  ancho: number
  alto: number
  /** Proyeccion nativa ya resuelta, en la forma que entiende proj4. */
  crs: string
  xmin: number
  ymax: number
  pixelAncho: number
  pixelAlto: number
}

async function leerVentanaNativa(
  asset: AssetBanda,
  destino: Rejilla,
): Promise<VentanaNativa> {
  const tiff = await fromUrl(asset.href)
  const imagen = await tiff.getImage()

  // geotiff 3 entrega las geo keys por metodo; la propiedad geoKeys va vacia.
  const conGeo = imagen as unknown as {
    getGeoKeys?: () => Record<string, number | string>
    geoKeys?: Record<string, number | string>
  }
  const claves = conGeo.getGeoKeys?.() ?? conGeo.geoKeys

  if (!claves) {
    throw new Error('El COG no declara su sistema de coordenadas y no se puede recortar')
  }

  const crs = crsDeGeoKeys(claves)
  const [xmin, ymin, xmax, ymax] = bboxProyectado(bboxDeRejilla(destino), crs)

  /**
   * El relleno de lo que queda fuera de la imagen. Sentinel-2 L2A y Landsat
   * C2 L2 declaran nodata 0; cuando el item no lo declara, 0 sigue siendo la
   * convencion de estos productos. Se pierde algun pixel legitimamente nulo en
   * los productos flotantes, y a cambio no se cuela relleno como si fuera dato.
   */
  const sinDato = asset.sinDato ?? 0

  const leidas = (await tiff.readRasters({
    bbox: [xmin, ymin, xmax, ymax],
    width: destino.ancho,
    height: destino.alto,
    interleave: false,
    resampleMethod: 'nearest',
    fillValue: sinDato,
  })) as unknown as ArrayLike<number>[]

  const crudos = leidas[0]
  const valores = new Float32Array(destino.ancho * destino.alto)
  const escala = asset.escala ?? 1
  const desplazamiento = asset.desplazamiento ?? 0

  for (let i = 0; i < valores.length; i++) {
    const crudo = crudos[i]
    valores[i] = crudo === sinDato ? Number.NaN : crudo * escala + desplazamiento
  }

  return {
    valores,
    ancho: destino.ancho,
    alto: destino.alto,
    crs,
    xmin,
    ymax,
    pixelAncho: (xmax - xmin) / destino.ancho,
    pixelAlto: (ymax - ymin) / destino.alto,
  }
}

/**
 * Indice de la ventana nativa que le toca a cada celda de la rejilla destino,
 * o -1 si la celda cae fuera.
 *
 * Se calcula una sola vez por escena y se reaprovecha en todas sus bandas: la
 * transformacion depende del CRS y de la ventana, no de que banda se lea, y
 * proyectar un cuarto de millon de puntos por banda seria tirar el tiempo.
 */
function mapaHaciaDestino(destino: Rejilla, ventana: VentanaNativa): Int32Array {
  const mapa = new Int32Array(destino.ancho * destino.alto)
  const crs = ventana.crs
  const aNativo = crs === 'EPSG:4326' ? null : proj4('EPSG:4326', crs)

  for (let fila = 0; fila < destino.alto; fila++) {
    const lat = destino.ymax - (fila + 0.5) * destino.pixelAlto
    const base = fila * destino.ancho

    for (let columna = 0; columna < destino.ancho; columna++) {
      const lon = destino.xmin + (columna + 0.5) * destino.pixelAncho
      const [x, y] = aNativo ? aNativo.forward([lon, lat]) : [lon, lat]

      const cx = Math.floor((x - ventana.xmin) / ventana.pixelAncho)
      const cy = Math.floor((ventana.ymax - y) / ventana.pixelAlto)

      mapa[base + columna] =
        cx >= 0 && cx < ventana.ancho && cy >= 0 && cy < ventana.alto
          ? cy * ventana.ancho + cx
          : -1
    }
  }

  return mapa
}

function claveVentana(ventana: VentanaNativa): string {
  return [
    ventana.crs,
    ventana.ancho,
    ventana.alto,
    ventana.xmin.toFixed(2),
    ventana.ymax.toFixed(2),
    ventana.pixelAncho.toFixed(4),
    ventana.pixelAlto.toFixed(4),
  ].join('|')
}

/**
 * Lee varias bandas sobre la misma rejilla destino. Asi B11 a 20 m y B04 a
 * 10 m quedan alineadas pixel a pixel sin remuestreo manual, que es lo que
 * permite operarlas juntas, y ademas quedan alineadas con las bandas de
 * cualquier otra escena, este o no en la misma zona UTM.
 */
export async function leerPila(
  assets: Record<string, AssetBanda>,
  destino: Rejilla,
): Promise<PilaBandas> {
  const nombres = Object.keys(assets)
  const ventanas = await Promise.all(
    nombres.map((nombre) => leerVentanaNativa(assets[nombre], destino)),
  )

  const mapas = new Map<string, Int32Array>()
  const bandas: Record<string, Float32Array> = {}

  nombres.forEach((nombre, indice) => {
    const ventana = ventanas[indice]
    const clave = claveVentana(ventana)

    let mapa = mapas.get(clave)
    if (!mapa) {
      mapa = mapaHaciaDestino(destino, ventana)
      mapas.set(clave, mapa)
    }

    const salida = new Float32Array(destino.ancho * destino.alto)
    for (let i = 0; i < salida.length; i++) {
      const origen = mapa[i]
      salida[i] = origen < 0 ? Number.NaN : ventana.valores[origen]
    }

    bandas[nombre] = salida
  })

  return { rejilla: destino, bandas }
}
