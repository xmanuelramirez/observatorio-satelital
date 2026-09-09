import type { Bbox } from '../tipos'

/**
 * Busqueda de pares interferometricos en el catalogo de ASF.
 *
 * La API de busqueda es publica y trae CORS, asi que el navegador puede
 * armar la lista de pares. El procesamiento es otra historia: HyP3 exige
 * token de NASA Earthdata y no manda cabeceras CORS, asi que someter el
 * trabajo tiene que ocurrir fuera del navegador. Ver herramientas/hyp3_subsidencia.py
 */

const BUSQUEDA = 'https://api.daac.asf.alaska.edu/services/search/param'

/** Pasado este numero de dias la coherencia se degrada y el par deja de servir. */
export const BASE_TEMPORAL_MAXIMA = 48

export interface GranuloSlc {
  nombre: string
  dia: string
  fecha: Date
  ruta: number
  cuadro: number
  direccion: 'ASCENDING' | 'DESCENDING'
  polarizacion: string
}

export interface PilaInsar {
  clave: string
  ruta: number
  cuadro: number
  direccion: 'ASCENDING' | 'DESCENDING'
  granulos: GranuloSlc[]
}

export interface ParInsar {
  referencia: GranuloSlc
  secundario: GranuloSlc
  /** Dias entre las dos tomas. */
  baseTemporal: number
  coherenciaProbable: 'buena' | 'aceptable' | 'dudosa'
}

function wktDe(bbox: Bbox): string {
  const [o, s, e, n] = bbox
  return `POLYGON((${o} ${s},${e} ${s},${e} ${n},${o} ${n},${o} ${s}))`
}

interface FilaAsf {
  granuleName?: string
  startTime?: string
  path?: number | string
  frame?: number | string
  flightDirection?: string
  polarization?: string
  canInSAR?: boolean
}

export async function buscarGranulos(
  bbox: Bbox,
  desde: string,
  hasta: string,
  senal?: AbortSignal,
): Promise<GranuloSlc[]> {
  const parametros = new URLSearchParams({
    platform: 'SENTINEL-1',
    processingLevel: 'SLC',
    beamMode: 'IW',
    intersectsWith: wktDe(bbox),
    start: `${desde}T00:00:00Z`,
    end: `${hasta}T23:59:59Z`,
    output: 'jsonlite',
  })

  const respuesta = await fetch(`${BUSQUEDA}?${parametros}`, { signal: senal })
  if (!respuesta.ok) {
    throw new Error(`El catalogo de ASF respondio ${respuesta.status}`)
  }

  const cuerpo = (await respuesta.json()) as { results?: FilaAsf[] }
  const filas = cuerpo.results ?? []

  return filas
    .filter((fila) => fila.canInSAR && fila.granuleName && fila.startTime)
    .map((fila) => ({
      nombre: fila.granuleName!,
      dia: fila.startTime!.slice(0, 10),
      fecha: new Date(fila.startTime!),
      ruta: Number(fila.path ?? 0),
      cuadro: Number(fila.frame ?? 0),
      direccion: fila.flightDirection === 'ASCENDING' ? 'ASCENDING' : 'DESCENDING',
      polarizacion: fila.polarization ?? '',
    }))
}

/**
 * Un par solo es valido si las dos tomas vienen de la misma orbita y el mismo
 * cuadro. Mezclar rutas produce geometrias distintas y el interferograma no
 * significa nada, por eso se agrupa antes de formar pares.
 */
export function agruparEnPilas(granulos: GranuloSlc[]): PilaInsar[] {
  const pilas = new Map<string, PilaInsar>()

  for (const granulo of granulos) {
    const clave = `${granulo.ruta}-${granulo.cuadro}-${granulo.direccion}`
    let pila = pilas.get(clave)

    if (!pila) {
      pila = {
        clave,
        ruta: granulo.ruta,
        cuadro: granulo.cuadro,
        direccion: granulo.direccion,
        granulos: [],
      }
      pilas.set(clave, pila)
    }

    if (!pila.granulos.some((otro) => otro.dia === granulo.dia)) {
      pila.granulos.push(granulo)
    }
  }

  for (const pila of pilas.values()) {
    pila.granulos.sort((a, b) => a.fecha.getTime() - b.fecha.getTime())
  }

  return [...pilas.values()]
    .filter((pila) => pila.granulos.length >= 2)
    .sort((a, b) => b.granulos.length - a.granulos.length)
}

/**
 * Pares consecutivos dentro de una pila. La referencia es la toma anterior:
 * con ese orden, un desplazamiento vertical negativo es hundimiento.
 */
export function formarPares(pila: PilaInsar): ParInsar[] {
  const pares: ParInsar[] = []

  for (let i = 0; i < pila.granulos.length - 1; i++) {
    const referencia = pila.granulos[i]
    const secundario = pila.granulos[i + 1]
    const dias = Math.round(
      (secundario.fecha.getTime() - referencia.fecha.getTime()) / 86_400_000,
    )

    pares.push({
      referencia,
      secundario,
      baseTemporal: dias,
      coherenciaProbable: dias <= 12 ? 'buena' : dias <= BASE_TEMPORAL_MAXIMA ? 'aceptable' : 'dudosa',
    })
  }

  return pares
}

/** Par de extremos: mide el acumulado de todo el periodo en un solo trabajo. */
export function parDeExtremos(pila: PilaInsar): ParInsar | null {
  if (pila.granulos.length < 2) return null

  const referencia = pila.granulos[0]
  const secundario = pila.granulos[pila.granulos.length - 1]
  const dias = Math.round((secundario.fecha.getTime() - referencia.fecha.getTime()) / 86_400_000)

  return {
    referencia,
    secundario,
    baseTemporal: dias,
    coherenciaProbable: dias <= 12 ? 'buena' : dias <= BASE_TEMPORAL_MAXIMA ? 'aceptable' : 'dudosa',
  }
}

/** Linea lista para pegar en el script de HyP3. */
export function comandoHyp3(par: ParInsar): string {
  return `python herramientas/hyp3_subsidencia.py ${par.referencia.nombre} ${par.secundario.nombre}`
}
