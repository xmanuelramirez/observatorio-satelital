import type { Rejilla } from './raster'

/**
 * Deteccion de obra nueva entre dos fechas.
 *
 * La regla no es un solo indice. Un NDBI que sube tambien lo produce un
 * terreno que se seco entre las dos tomas, y eso llenaria el mapa de falsos
 * positivos en un municipio donde media superficie es agricola. Se piden tres
 * condiciones a la vez:
 *
 *   1. El NDBI sube al menos el umbral. Es la firma de superficie
 *      impermeable: concreto y lamina reflejan mas en SWIR que en NIR.
 *   2. Despues queda poca vegetacion (NDVI bajo). Un cultivo que rebrota
 *      sube el NDBI en seca pero vuelve a verdear, y asi se descarta.
 *   3. No es agua (MNDWI negativo). Un vaso que baja de nivel deja suelo
 *      humedo que tambien mueve el NDBI.
 *
 * Aun asi es un CANDIDATO, no un dictamen: a 10 m una casa sola no se ve, y
 * un despalme sin construir cumple las tres condiciones. Por eso el resultado
 * se agrupa en zonas con area minima y se reporta como zonas a verificar.
 */

export interface ZonaObra {
  /** Numero de celdas de la zona. */
  celdas: number
  hectareas: number
  /** Centro de la zona, en grados, para ir a buscarla. */
  lat: number
  lon: number
}

export interface ResultadoObra {
  /** 1 en las celdas de una zona que sobrevivio al area minima, NaN en el resto. */
  mascara: Float32Array
  zonas: ZonaObra[]
  hectareasTotales: number
  /** Celdas que cumplieron la regla antes de descartar zonas chicas. */
  celdasCrudas: number
  /** Celdas comparables, es decir con dato valido en las dos fechas. */
  celdasComparables: number
}

export interface ParametrosObra {
  ndbiAntes: Float32Array
  ndbiDespues: Float32Array
  ndviAntes: Float32Array
  ndviDespues: Float32Array
  mndwiDespues: Float32Array | null
  rejilla: Rejilla
  hectareasPorCelda: number
  /** Cuanto tiene que subir el NDBI para contar. */
  umbralNdbi: number
  /** NDVI maximo que puede quedar despues para considerarlo construido. */
  ndviMaximoDespues: number
  /** Zonas menores a esto se descartan por ruido. */
  areaMinimaHa: number
}

/**
 * Agrupa las celdas marcadas en zonas conexas por vecindad de 8 y descarta
 * las que no llegan al area minima. Sin este paso el mapa se llena de celdas
 * sueltas, que a 100 m de lado son una hectarea cada una y no un desarrollo.
 *
 * El recorrido es iterativo con una pila propia: una version recursiva
 * desborda la pila de JavaScript en cuanto una zona pasa de unos miles de
 * celdas, y aqui una mancha urbana grande las tiene.
 */
export function detectarObraNueva(parametros: ParametrosObra): ResultadoObra {
  const {
    ndbiAntes,
    ndbiDespues,
    ndviAntes,
    ndviDespues,
    mndwiDespues,
    rejilla,
    hectareasPorCelda,
    umbralNdbi,
    ndviMaximoDespues,
    areaMinimaHa,
  } = parametros

  const { ancho, alto } = rejilla
  const total = ancho * alto
  const marcada = new Uint8Array(total)

  let celdasCrudas = 0
  let celdasComparables = 0

  for (let i = 0; i < total; i++) {
    const nbA = ndbiAntes[i]
    const nbD = ndbiDespues[i]
    const nvA = ndviAntes[i]
    const nvD = ndviDespues[i]

    if (Number.isNaN(nbA) || Number.isNaN(nbD) || Number.isNaN(nvA) || Number.isNaN(nvD)) continue
    celdasComparables++

    const subeConstruido = nbD - nbA >= umbralNdbi
    const quedaSinVegetacion = nvD <= ndviMaximoDespues
    const noEsAgua = mndwiDespues === null || !(mndwiDespues[i] >= 0)

    if (subeConstruido && quedaSinVegetacion && noEsAgua) {
      marcada[i] = 1
      celdasCrudas++
    }
  }

  const mascara = new Float32Array(total).fill(Number.NaN)
  const zonas: ZonaObra[] = []
  const celdasMinimas = Math.max(1, Math.ceil(areaMinimaHa / hectareasPorCelda))

  const visitada = new Uint8Array(total)
  const pila: number[] = []
  const zonaActual: number[] = []

  for (let inicio = 0; inicio < total; inicio++) {
    if (marcada[inicio] === 0 || visitada[inicio] === 1) continue

    zonaActual.length = 0
    pila.length = 0
    pila.push(inicio)
    visitada[inicio] = 1

    let sumaFila = 0
    let sumaColumna = 0

    while (pila.length > 0) {
      const celda = pila.pop()!
      zonaActual.push(celda)

      const fila = Math.floor(celda / ancho)
      const columna = celda % ancho
      sumaFila += fila
      sumaColumna += columna

      for (let df = -1; df <= 1; df++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (df === 0 && dc === 0) continue
          const f = fila + df
          const c = columna + dc
          if (f < 0 || f >= alto || c < 0 || c >= ancho) continue

          const vecina = f * ancho + c
          if (marcada[vecina] === 1 && visitada[vecina] === 0) {
            visitada[vecina] = 1
            pila.push(vecina)
          }
        }
      }
    }

    if (zonaActual.length < celdasMinimas) continue

    for (const celda of zonaActual) mascara[celda] = 1

    const filaMedia = sumaFila / zonaActual.length
    const columnaMedia = sumaColumna / zonaActual.length

    zonas.push({
      celdas: zonaActual.length,
      hectareas: zonaActual.length * hectareasPorCelda,
      lon: rejilla.xmin + (columnaMedia + 0.5) * rejilla.pixelAncho,
      lat: rejilla.ymax - (filaMedia + 0.5) * rejilla.pixelAlto,
    })
  }

  zonas.sort((a, b) => b.hectareas - a.hectareas)

  return {
    mascara,
    zonas,
    hectareasTotales: zonas.reduce((suma, zona) => suma + zona.hectareas, 0),
    celdasCrudas,
    celdasComparables,
  }
}

/**
 * Dias entre dos dias locales en formato YYYY-MM-DD.
 *
 * Se arma con Date.UTC a mediodia para que ningun cambio de huso mueva la
 * cuenta: solo importa la diferencia de calendario, no la hora de la toma.
 */
export function diasEntre(diaA: string, diaB: string): number {
  const aFecha = (dia: string) => {
    const [ano, mes, d] = dia.split('-').map(Number)
    return Date.UTC(ano, mes - 1, d, 12)
  }
  return Math.round(Math.abs(aFecha(diaB) - aFecha(diaA)) / 86_400_000)
}

/**
 * Comparar seca contra lluvias infla el cambio: la vegetacion anual aparece y
 * desaparece sola. Se avisa cuando las dos fechas caen en temporadas
 * distintas de Leon, donde las lluvias van de junio a octubre.
 */
export function mismaTemporada(diaA: string, diaB: string): boolean {
  const lluviosa = (dia: string) => {
    const mes = Number(dia.split('-')[1])
    return mes >= 6 && mes <= 10
  }
  return lluviosa(diaA) === lluviosa(diaB)
}
