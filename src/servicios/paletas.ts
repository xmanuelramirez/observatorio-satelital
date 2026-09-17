/** Paleta categorica para las clases de k-means, legible sobre fondo oscuro. */
export const PALETA_CLASES = [
  '#2b7fb8',
  '#43a047',
  '#f2c744',
  '#e0623c',
  '#8e6bbf',
  '#00a5a5',
  '#c2185b',
  '#7d6b52',
]

export function colorDeClase(clase: number): string {
  return PALETA_CLASES[clase % PALETA_CLASES.length]
}

function mezclar(a: [number, number, number], b: [number, number, number], t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t)
  const g = Math.round(a[1] + (b[1] - a[1]) * t)
  const azul = Math.round(a[2] + (b[2] - a[2]) * t)
  return `rgb(${r},${g},${azul})`
}

const PARADAS: [number, number, number][] = [
  [140, 90, 50],
  [216, 200, 160],
  [245, 245, 235],
  [130, 190, 110],
  [20, 90, 40],
]

/** Rampa continua tierra a vegetacion, util para NDVI y para el resto de indices. */
export function colorDeIndice(valor: number, minimo: number, maximo: number): string {
  const rango = maximo - minimo || 1
  const t = Math.min(1, Math.max(0, (valor - minimo) / rango))
  const escalado = t * (PARADAS.length - 1)
  const indice = Math.min(PARADAS.length - 2, Math.floor(escalado))
  return mezclar(PARADAS[indice], PARADAS[indice + 1], escalado - indice)
}

/**
 * Rampa divergente para diferencias entre dos fechas. Rojo es perdida, azul es
 * ganancia y el centro queda casi transparente para que solo resalte lo que
 * cambio de verdad.
 */
export function colorDeCambio(valor: number, limite: number): string | undefined {
  const t = Math.max(-1, Math.min(1, valor / (limite || 1)))

  if (Math.abs(t) < 0.001) return undefined

  if (t < 0) {
    const f = -t
    return `rgb(${Math.round(200 + 55 * f)},${Math.round(210 - 150 * f)},${Math.round(210 - 160 * f)})`
  }

  return `rgb(${Math.round(210 - 170 * t)},${Math.round(215 - 60 * t)},${Math.round(220 + 35 * t)})`
}

/**
 * Rampa termica: azul frio, amarillo templado, rojo caliente. No es la misma
 * que la de indices a proposito: una temperatura no se lee como un indice, y
 * usar la misma escala invita a compararlas.
 */
export function colorDeCalor(valor: number, minimo: number, maximo: number): string {
  const t = Math.max(0, Math.min(1, (valor - minimo) / (maximo - minimo || 1)))

  const frio: [number, number, number] = [49, 104, 168]
  const templado: [number, number, number] = [240, 217, 130]
  const caliente: [number, number, number] = [176, 42, 42]

  return t < 0.5 ? mezclar(frio, templado, t * 2) : mezclar(templado, caliente, (t - 0.5) * 2)
}

export function colorDeGris(valor: number, minimo: number, maximo: number): string {
  const rango = maximo - minimo || 1
  const t = Math.min(1, Math.max(0, (valor - minimo) / rango))
  const g = Math.round(t * 255)
  return `rgb(${g},${g},${g})`
}
