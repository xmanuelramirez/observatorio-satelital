import type { AssetBanda, Bbox, Coleccion, Escena, GrupoDia } from '../tipos'
import { baseStac } from './proveedores'
import { diaLocal, rangoUTCdelDia } from '../lib/fecha'

/** Del inicio del primer dia local al ultimo segundo del ultimo, en UTC. */
export function intervaloUTC(desde: string, hasta: string): string {
  const inicio = rangoUTCdelDia(desde).desde
  const fin = new Date(Date.parse(rangoUTCdelDia(hasta).hasta) - 1000).toISOString()
  return `${inicio}/${fin}`
}

interface BandaRaster {
  nodata?: number
  scale?: number
  offset?: number
}

interface AssetStac {
  href: string
  'raster:bands'?: BandaRaster[]
}

interface ItemStac {
  id: string
  bbox: Bbox
  geometry: Escena['huella']
  properties: Record<string, unknown>
  assets: Record<string, AssetStac>
}

export interface ParametrosBusqueda {
  coleccion: Coleccion
  bbox: Bbox
  desde: string
  hasta: string
  nubesMax: number
  limite: number
}

export interface ResultadoBusqueda {
  grupos: GrupoDia[]
  totalCoincidencias: number | null
  devueltas: number
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : ''
}

function malla(props: Record<string, unknown>): string {
  const mgrs = texto(props['grid:code'])
  if (mgrs) return mgrs.replace('MGRS-', '')
  const path = props['landsat:wrs_path']
  const row = props['landsat:wrs_row']
  if (path && row) return `${path}/${row}`
  return ''
}

/**
 * La escala y el desplazamiento importan: NDVI sobre numeros crudos no da lo
 * mismo que sobre reflectancia, porque el offset no se cancela en la division.
 */
function aAssetBanda(asset: AssetStac): AssetBanda {
  const raster = asset['raster:bands']?.[0]
  return {
    href: asset.href,
    escala: raster?.scale ?? null,
    desplazamiento: raster?.offset ?? null,
    sinDato: raster?.nodata ?? null,
  }
}

function aEscena(item: ItemStac, coleccion: Coleccion): Escena {
  const props = item.properties
  const nubesCrudas = props['eo:cloud_cover']
  const fechaIso = texto(props.datetime)

  const assets: Record<string, AssetBanda> = {}
  for (const [nombre, asset] of Object.entries(item.assets)) {
    if (asset?.href) assets[nombre] = aAssetBanda(asset)
  }

  return {
    id: item.id,
    coleccion: coleccion.id,
    proveedor: coleccion.proveedor,
    fechaIso,
    // Dia de Leon. Recortar la cadena daba el dia UTC, y las pasadas
    // ascendentes de Sentinel-1 (cerca de las 00:49 UTC, 18:49 locales)
    // aparecian con la fecha del dia siguiente.
    dia: diaLocal(fechaIso),
    nubes: typeof nubesCrudas === 'number' ? nubesCrudas : null,
    plataforma: texto(props.platform).toUpperCase(),
    malla: malla(props),
    bbox: item.bbox,
    huella: item.geometry,
    thumbnail: assets[coleccion.assetVistaPrevia]?.href ?? null,
    assets,
  }
}

function agruparPorDia(escenas: Escena[]): GrupoDia[] {
  const mapa = new Map<string, Escena[]>()
  for (const escena of escenas) {
    const lista = mapa.get(escena.dia)
    if (lista) lista.push(escena)
    else mapa.set(escena.dia, [escena])
  }

  return [...mapa.entries()]
    .map(([dia, lista]) => {
      const conNubes = lista.filter((e) => e.nubes !== null)
      const nubes =
        conNubes.length > 0
          ? conNubes.reduce((suma, e) => suma + (e.nubes ?? 0), 0) / conNubes.length
          : null
      return { dia, escenas: lista, nubes }
    })
    .sort((a, b) => b.dia.localeCompare(a.dia))
}

export async function buscarEscenas(
  parametros: ParametrosBusqueda,
  senal?: AbortSignal,
): Promise<ResultadoBusqueda> {
  const { coleccion, bbox, desde, hasta, nubesMax, limite } = parametros

  const cuerpo: Record<string, unknown> = {
    collections: [coleccion.id],
    bbox,
    // El periodo se captura en dias de Leon; el catalogo compara en UTC.
    datetime: intervaloUTC(desde, hasta),
    sortby: [{ field: 'properties.datetime', direction: 'desc' }],
    limit: limite,
  }

  // Sentinel-1 es radar y no publica eo:cloud_cover: filtrarlo devolveria cero.
  if (coleccion.filtraNubes && nubesMax < 100) {
    cuerpo.query = { 'eo:cloud_cover': { lt: nubesMax } }
  }

  const respuesta = await fetch(`${baseStac(coleccion.proveedor)}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
    signal: senal,
  })

  if (!respuesta.ok) {
    throw new Error(`El catálogo respondió ${respuesta.status}`)
  }

  const datos = (await respuesta.json()) as {
    features?: ItemStac[]
    numberMatched?: number
  }

  const escenas = (datos.features ?? []).map((item) => aEscena(item, coleccion))

  return {
    grupos: agruparPorDia(escenas),
    totalCoincidencias: datos.numberMatched ?? null,
    devueltas: escenas.length,
  }
}
