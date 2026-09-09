declare module 'georaster' {
  export interface Georaster {
    width: number
    height: number
    numberOfRasters: number
    noDataValue: number | null
    projection: number
    xmin: number
    ymin: number
    xmax: number
    ymax: number
  }

  export interface MetadatosGeoraster {
    noDataValue: number | null
    projection: number
    xmin: number
    ymax: number
    pixelWidth: number
    pixelHeight: number
  }

  /** Con un solo argumento lee un COG remoto por rangos; con dos, arma uno en memoria. */
  export default function parseGeoraster(
    entrada: string | ArrayBuffer | number[][][],
    metadatos?: MetadatosGeoraster,
  ): Promise<Georaster>
}

declare module 'georaster-layer-for-leaflet' {
  import type { Georaster } from 'georaster'
  import type { GridLayer, GridLayerOptions } from 'leaflet'

  export interface OpcionesGeoRasterLayer extends GridLayerOptions {
    georaster?: Georaster
    georasters?: Georaster[]
    resolution?: number
    opacity?: number
    debugLevel?: number
    pixelValuesToColorFn?: (valores: number[]) => string | undefined
  }

  export default class GeoRasterLayer extends GridLayer {
    constructor(opciones: OpcionesGeoRasterLayer)
  }
}
