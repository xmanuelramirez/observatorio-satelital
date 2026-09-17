import type { PilaBandas } from './raster'

export type IdIndice = 'ndvi' | 'ndwi' | 'mndwi' | 'ndbi' | 'nbr' | 'ndci' | 'ndti'

export interface DefinicionIndice {
  id: IdIndice
  etiqueta: string
  descripcion: string
  /** Diferencia normalizada (a - b) / (a + b). */
  a: string
  b: string
  /**
   * Indices que solo significan algo sobre la lamina de agua. Sobre tierra,
   * un NDCI alto es vegetacion, no clorofila: por eso la app recorta al agua
   * antes de interpretarlos.
   */
  soloAgua?: boolean
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
    id: 'ndci',
    etiqueta: 'NDCI',
    descripcion: 'Clorofila en agua, borde rojo',
    a: 'rededge1',
    b: 'rojo',
    soloAgua: true,
  },
  {
    id: 'ndti',
    etiqueta: 'NDTI',
    descripcion: 'Turbidez relativa del agua',
    a: 'rojo',
    b: 'verde',
    soloAgua: true,
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

/**
 * Lamina de agua por pixel.
 *
 * Con SWIR se usa MNDWI, que distingue agua de superficie construida mucho
 * mejor que NDWI: el concreto tambien tiene NDWI alto y sin esto medio centro
 * de la ciudad entraria como si fuera vaso de presa. Sin SWIR se cae a NDWI,
 * que es lo unico disponible.
 */
export function mascaraDeAgua(pila: PilaBandas, umbral = 0): Uint8Array {
  const verde = pila.bandas.verde
  const swir1 = pila.bandas.swir1
  const nir = pila.bandas.nir
  const contraste = swir1 ?? nir

  if (!verde || !contraste) {
    throw new Error('Para recortar al agua hacen falta las bandas verde y swir1 (o nir)')
  }

  const agua = new Uint8Array(verde.length)
  for (let i = 0; i < verde.length; i++) {
    const v = verde[i]
    const c = contraste[i]
    const suma = v + c
    if (Number.isNaN(v) || Number.isNaN(c) || suma === 0) continue
    agua[i] = (v - c) / suma > umbral ? 1 : 0
  }

  return agua
}

/** Deja NaN fuera de la lamina de agua y devuelve cuantas celdas quedaron. */
export function recortarAgua(banda: Float32Array, agua: Uint8Array): number {
  let dentro = 0
  for (let i = 0; i < banda.length; i++) {
    if (agua[i] === 1) dentro++
    else banda[i] = Number.NaN
  }
  return dentro
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
