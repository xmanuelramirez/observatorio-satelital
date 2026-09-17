import type { PilaBandas } from './raster'

export type IdIndice = 'ndvi' | 'ndwi' | 'mndwi' | 'ndbi' | 'nbr'

export interface DefinicionIndice {
  id: IdIndice
  etiqueta: string
  descripcion: string
  /** Diferencia normalizada (a - b) / (a + b). */
  a: string
  b: string
}

export const INDICES: DefinicionIndice[] = [
  {
    id: 'ndvi',
    etiqueta: 'NDVI',
    descripcion: 'Vigor de la vegetación',
    a: 'nir',
    b: 'rojo',
  },
  {
    id: 'ndwi',
    etiqueta: 'NDWI',
    descripcion: 'Agua superficial (McFeeters)',
    a: 'verde',
    b: 'nir',
  },
  {
    id: 'mndwi',
    etiqueta: 'MNDWI',
    descripcion: 'Agua con menos falso positivo urbano',
    a: 'verde',
    b: 'swir1',
  },
  {
    id: 'ndbi',
    etiqueta: 'NDBI',
    descripcion: 'Superficie construida',
    a: 'swir1',
    b: 'nir',
  },
  {
    id: 'nbr',
    etiqueta: 'NBR',
    descripcion: 'Área quemada y estrés severo',
    a: 'nir',
    b: 'swir2',
  },
]

export function bandasQueUsa(indice: DefinicionIndice): string[] {
  return [indice.a, indice.b]
}

export function indicesDisponibles(bandasDeLaColeccion: string[]): DefinicionIndice[] {
  return INDICES.filter((indice) =>
    bandasQueUsa(indice).every((banda) => bandasDeLaColeccion.includes(banda)),
  )
}

export interface ResultadoIndice {
  valores: Float32Array
  /** Percentiles 2 y 98 de los pixeles validos, para estirar la rampa. */
  p2: number
  p98: number
  validos: number
}

export function calcularIndice(pila: PilaBandas, indice: DefinicionIndice): ResultadoIndice {
  const a = pila.bandas[indice.a]
  const b = pila.bandas[indice.b]

  if (!a || !b) {
    throw new Error(`Faltan bandas para ${indice.etiqueta}: se necesitan ${indice.a} y ${indice.b}`)
  }

  const valores = new Float32Array(a.length)
  const finitos: number[] = []

  for (let i = 0; i < a.length; i++) {
    const va = a[i]
    const vb = b[i]
    const suma = va + vb

    if (Number.isNaN(va) || Number.isNaN(vb) || suma === 0) {
      valores[i] = Number.NaN
      continue
    }

    const valor = (va - vb) / suma
    valores[i] = valor
    finitos.push(valor)
  }

  finitos.sort((x, y) => x - y)
  const percentil = (p: number) =>
    finitos.length === 0 ? 0 : finitos[Math.min(finitos.length - 1, Math.floor(p * finitos.length))]

  return { valores, p2: percentil(0.02), p98: percentil(0.98), validos: finitos.length }
}
