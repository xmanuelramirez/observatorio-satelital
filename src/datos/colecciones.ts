import type { Coleccion } from '../tipos'

/**
 * Dos catalogos, elegidos por lo que cada uno deja leer desde el navegador.
 *
 * Earth Search sirve Sentinel-2 como COG publicos: ni credencial ni firma.
 * Sus assets de Landsat y Sentinel-1, en cambio, son URIs s3:// de cubetas
 * requester-pays, imposibles de leer desde una pagina. Para esas dos misiones
 * se usa Planetary Computer, que guarda los COG en blobs privados pero entrega
 * un SAS anonimo y gratuito con una llamada.
 */
export const COLECCIONES: Coleccion[] = [
  {
    id: 'sentinel-2-c1-l2a',
    proveedor: 'earth-search',
    etiqueta: 'Sentinel-2 L2A',
    descripcion: '10 m, revisita nominal 5 dias, reflectancia de superficie',
    gsd: 10,
    filtraNubes: true,
    bandas: {
      azul: 'blue',
      verde: 'green',
      rojo: 'red',
      nir: 'nir',
      swir1: 'swir16',
      swir2: 'swir22',
    },
    assetColorVerdadero: 'visual',
    assetVistaPrevia: 'thumbnail',
  },
  {
    id: 'landsat-c2-l2',
    proveedor: 'planetary-computer',
    etiqueta: 'Landsat 8/9 C2 L2',
    descripcion: '30 m, 16 dias por satelite, archivo largo desde 1982',
    gsd: 30,
    filtraNubes: true,
    bandas: {
      azul: 'blue',
      verde: 'green',
      rojo: 'red',
      nir: 'nir08',
      swir1: 'swir16',
      swir2: 'swir22',
    },
    assetColorVerdadero: null,
    assetVistaPrevia: 'rendered_preview',
  },
  {
    id: 'sentinel-1-rtc',
    proveedor: 'planetary-computer',
    etiqueta: 'Sentinel-1 RTC (SAR)',
    descripcion: '10 m, 6 dias con 1C y 1D, gamma0 corregido por terreno',
    gsd: 10,
    filtraNubes: false,
    bandas: { vv: 'vv', vh: 'vh' },
    assetColorVerdadero: null,
    assetVistaPrevia: 'rendered_preview',
  },
]

export const COLECCION_POR_DEFECTO = COLECCIONES[0]

export function buscarColeccion(id: string): Coleccion {
  const encontrada = COLECCIONES.find((c) => c.id === id)
  if (!encontrada) throw new Error(`Coleccion desconocida: ${id}`)
  return encontrada
}
