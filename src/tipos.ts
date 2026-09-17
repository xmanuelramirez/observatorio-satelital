import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { IdProveedor } from './servicios/proveedores'
import type { TipoMascaraNubes } from './servicios/nubes'

/** [oeste, sur, este, norte] en grados WGS84, el orden que pide STAC. */
export type Bbox = [number, number, number, number]

export type IdCapa =
  | 'LIMITE'
  | 'LIMITE_URBANO'
  | 'CUENCA_PALOTE'
  | 'EMA'
  | 'SENSORES_ARROYOS'

export interface Capa {
  id: IdCapa
  etiqueta: string
  archivo: string
  color: string
  tipo: 'poligono' | 'punto'
  /** Solo las capas de poligono sirven como area de busqueda. */
  esAreaInteres: boolean
  visiblePorDefecto: boolean
  /**
   * Si puede salir del departamento. Las capas de infraestructura propia no
   * entran a un despliegue publico; ver CAPAS en datos/capas.ts.
   */
  publica: boolean
}

export type IdColeccion = 'sentinel-2-c1-l2a' | 'landsat-c2-l2' | 'sentinel-1-rtc'

/**
 * Nombres internos de banda, iguales entre misiones. Sentinel-2 llama nir a
 * B08 y Landsat lo llama nir08: el mapa de cada coleccion resuelve eso para
 * que los indices se escriban una sola vez.
 */
export type NombreBanda = 'azul' | 'verde' | 'rojo' | 'nir' | 'swir1' | 'swir2' | 'vv' | 'vh'

export interface Coleccion {
  id: IdColeccion
  proveedor: IdProveedor
  etiqueta: string
  descripcion: string
  /** Resolucion nativa de las bandas que se usan, en metros. */
  gsd: number
  /** Revisita nominal de la constelacion, en dias. Es el paso temporal minimo. */
  revisitaDias: number
  /** Sentinel-1 es radar: no trae nubosidad y el filtro no aplica. */
  filtraNubes: boolean
  /** Asset con la mascara de nubes por pixel y como leerlo, si lo hay. */
  mascaraNubes: { asset: string; tipo: TipoMascaraNubes } | null
  /** Banda interna a nombre de asset en el item STAC. */
  bandas: Partial<Record<NombreBanda, string>>
  /** Asset RGB de 8 bits ya listo, si la coleccion lo publica. */
  assetColorVerdadero: string | null
  /** Asset que sirve de miniatura en la lista de resultados. */
  assetVistaPrevia: string
}

export interface AssetBanda {
  href: string
  escala: number | null
  desplazamiento: number | null
  sinDato: number | null
}

export interface Escena {
  id: string
  coleccion: IdColeccion
  proveedor: IdProveedor
  /** ISO completo tal como lo da STAC. */
  fechaIso: string
  /** YYYY-MM-DD, para agrupar. */
  dia: string
  nubes: number | null
  plataforma: string
  /** Codigo MGRS en Sentinel-2, path/row en Landsat, vacio en Sentinel-1. */
  malla: string
  bbox: Bbox
  huella: Geometry
  thumbnail: string | null
  /** Todos los assets del item, con su escala y valor nulo declarados. */
  assets: Record<string, AssetBanda>
}

export interface GrupoDia {
  dia: string
  escenas: Escena[]
  /** Promedio de nubosidad de las escenas del dia, null si la coleccion no la trae. */
  nubes: number | null
}

export type ModoVista = 'indice' | 'cambio' | 'obra' | 'clases' | 'color'

export type CapaCargada = { capa: Capa; datos: FeatureCollection | Feature<Geometry> }
