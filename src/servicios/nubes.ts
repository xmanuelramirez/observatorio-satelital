/**
 * Mascara de nubes por pixel.
 *
 * El filtro de nubosidad de la busqueda es por escena completa: una escena con
 * 15 por ciento de nubes pasa el filtro aunque esas nubes caigan justo sobre
 * Leon. Y una nube sobre un terreno se parece a concreto nuevo, asi que sin
 * esto el modo obra inventa desarrollos donde solo hubo un cumulo.
 *
 * Cada mision codifica su mascara distinto y por eso hay dos lecturas.
 */

export type TipoMascaraNubes = 'scl' | 'qa_pixel'

/**
 * Sentinel-2 L2A publica SCL, una clasificacion por pixel de una sola banda.
 * Se descartan las clases que no son superficie observable:
 *
 *   0 sin dato          1 saturado o defectuoso   3 sombra de nube
 *   8 nube probable     9 nube muy probable      10 cirro delgado
 *  11 nieve
 *
 * Se conservan 2 (area oscura), 4 (vegetacion), 5 (sin vegetacion),
 * 6 (agua) y 7 (sin clasificar). La 7 se queda a proposito: descartarla
 * recorta bordes legitimos, y lo que de verdad estorba son las tres de nube.
 *
 * El 0 ya llega como NaN, porque el propio asset declara nodata 0.
 */
const CLASES_SCL_DESCARTADAS = new Set([0, 1, 3, 8, 9, 10, 11])

/**
 * Landsat C2 L2 publica QA_PIXEL, un mapa de bits. Los que interesan:
 *
 *   bit 0 relleno   bit 1 nube dilatada   bit 2 cirro
 *   bit 3 nube      bit 4 sombra de nube  bit 5 nieve
 *
 * Se usa el bit de nube dilatada, no solo el de nube: el borde de un cumulo
 * ya contamina la reflectancia aunque el clasificador no lo llame nube.
 */
const BITS_QA_DESCARTADOS = [1, 2, 3, 4, 5]

/** Como quedo cada celda segun la mascara. */
export const DESPEJADO = 0
export const NUBE = 1
export const SIN_DATO = 2

/**
 * Clasifica cada celda en despejada, nube o sin dato.
 *
 * Los tres estados importan y no se pueden colapsar en dos. Una celda sin
 * dato tambien hay que descartarla, pero no es nube: una escena de Landsat
 * que solo cubre un tercio del municipio dejaria el resto sin dato, y
 * contarlo como nube reportaba 99 por ciento de nubosidad en una escena que
 * declaraba 59.
 */
export function mascaraDeNubes(valores: Float32Array, tipo: TipoMascaraNubes): Uint8Array {
  const estado = new Uint8Array(valores.length)

  for (let i = 0; i < valores.length; i++) {
    const valor = valores[i]

    if (Number.isNaN(valor)) {
      estado[i] = SIN_DATO
      continue
    }

    if (tipo === 'scl') {
      estado[i] = CLASES_SCL_DESCARTADAS.has(Math.round(valor)) ? NUBE : DESPEJADO
      continue
    }

    const bits = Math.round(valor)
    // El bit 0 es relleno de la escena, no nube.
    estado[i] = (bits & 1) !== 0
      ? SIN_DATO
      : BITS_QA_DESCARTADOS.some((bit) => (bits & (1 << bit)) !== 0)
        ? NUBE
        : DESPEJADO
  }

  return estado
}

/** Pone NaN donde la mascara marca nube o falta de dato. */
export function descartarNubes(banda: Float32Array, estado: Uint8Array): void {
  for (let i = 0; i < banda.length; i++) {
    if (estado[i] !== DESPEJADO) banda[i] = Number.NaN
  }
}

/**
 * Nubosidad dentro del area, medida solo sobre lo que la escena alcanza a
 * ver. Si se midiera sobre el area completa, una escena que cubre un tercio
 * del municipio saldria casi totalmente nublada aunque este despejada.
 */
export function nubosidadEnArea(
  estado: Uint8Array,
  dentro: Uint8Array,
): { nubladas: number; observadas: number } {
  let nubladas = 0
  let observadas = 0

  for (let i = 0; i < estado.length; i++) {
    if (dentro[i] !== 1 || estado[i] === SIN_DATO) continue
    observadas++
    if (estado[i] === NUBE) nubladas++
  }

  return { nubladas, observadas }
}
