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

/** Tope de paginas por busqueda: 8 por 100 son 800 escenas, de sobra para dos anios. */
const PAGINAS_MAXIMAS = 8

/**
 * El mismo cuerpo de busqueda, escrito como parametros de direccion.
 *
 * Las listas van separadas por comas y lo que es objeto, como el filtro de
 * nubes, viaja en JSON: asi lo define la API de STAC para las consultas por
 * GET y asi lo entiende Planetary Computer.
 */
function comoParametros(cuerpo: Record<string, unknown>): string {
  const parametros = new URLSearchParams()
  for (const [clave, valor] of Object.entries(cuerpo)) {
    if (valor === undefined || valor === null) continue
    if (clave === 'sortby') {
      const orden = valor as { field: string; direction: string }[]
      parametros.set(
        'sortby',
        orden.map((o) => `${o.direction === 'desc' ? '-' : '+'}${o.field}`).join(','),
      )
    } else if (Array.isArray(valor)) {
      parametros.set(clave, valor.join(','))
    } else if (typeof valor === 'object') {
      parametros.set(clave, JSON.stringify(valor))
    } else {
      parametros.set(clave, String(valor))
    }
  }
  return parametros.toString()
}

interface RespuestaStac {
  features?: ItemStac[]
  numberMatched?: number
  links?: { rel: string; href: string; body?: Record<string, unknown>; merge?: boolean }[]
}

/**
 * Busca en el catalogo pagina por pagina.
 *
 * Una sola pagina no alcanza para obra nueva. El catalogo devuelve lo mas
 * reciente primero, asi que con un periodo de dos anios y una pagina, la
 * fecha vieja contra la que se quiere comparar nunca aparecia en la lista.
 * Se siguen los enlaces "next" hasta el tope o hasta que se acaben.
 */
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

  const url = `${baseStac(coleccion.proveedor)}/search`
  const items: ItemStac[] = []
  let total: number | null = null
  let paginas = 0

  /*
   * Planetary Computer se pregunta por GET, no por POST.
   *
   * El 23 de septiembre de 2026 su puerta de enlace empezo a contestar 405 al
   * OPTIONS que el navegador manda antes de un POST con cuerpo JSON, asi que
   * la busqueda moria con "Failed to fetch" y Landsat y Sentinel-1 se
   * quedaron sin catalogo. El GET con parametros no necesita esa consulta
   * previa, devuelve lo mismo y respeta orden y filtro de nubes. Earth Search
   * sigue por POST, que es lo que mejor pagina.
   */
  const porGet = coleccion.proveedor === 'planetary-computer'
  let siguiente: Record<string, unknown> | null = cuerpo
  let siguienteUrl: string | null = porGet ? `${url}?${comoParametros(cuerpo)}` : null

  while ((porGet ? siguienteUrl !== null : siguiente !== null) && paginas < PAGINAS_MAXIMAS) {
    const respuesta: Response = porGet
      ? await fetch(siguienteUrl as string, { signal: senal })
      : await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(siguiente),
          signal: senal,
        })

    if (!respuesta.ok) {
      throw new Error(`El catálogo respondió ${respuesta.status}`)
    }

    const datos = (await respuesta.json()) as RespuestaStac
    items.push(...(datos.features ?? []))
    if (total === null && typeof datos.numberMatched === 'number') total = datos.numberMatched
    paginas++

    // El enlace "next" de POST trae el cuerpo de la siguiente pagina; con
    // merge, solo las claves que cambian respecto al cuerpo actual. El de GET
    // trae la direccion completa y se sigue tal cual.
    const next = datos.links?.find((enlace) => enlace.rel === 'next')
    const sinFilas = (datos.features ?? []).length === 0

    if (porGet) {
      siguienteUrl = !next?.href || sinFilas ? null : next.href
    } else if (!next?.body || sinFilas) {
      siguiente = null
    } else {
      siguiente = next.merge ? { ...siguiente, ...next.body } : next.body
    }
  }

  const escenas = items.map((item) => aEscena(item, coleccion))

  return {
    grupos: agruparPorDia(escenas),
    totalCoincidencias: total,
    devueltas: escenas.length,
  }
}
