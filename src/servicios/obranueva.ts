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
 * Esas tres no separan obra de secado: al terminar las lluvias nada reverdece
 * dentro de la ventana, y del 15/10 al 09/11/2025 dieron 774.7 ha, de las que el
 * 98.9 % volvio a verdear un ano despues (dictamen del juez, 30/10/2026). Por eso
 * hay una cuarta, que decide el nivel y no si la celda cuenta:
 *
 *   4. Partir de suelo sin vegetacion (NDVI base de 0.35 o menos). Lo que cumple
 *      es obra probable, la unica cifra que se suma. Lo que partia verde va aparte
 *      como perdida de vegetacion a confirmar y nunca se suma: pasa a obra si en
 *      las lluvias siguientes (ago-sep) sigue con NDVI de 0.25 o menos.
 *
 * Aun asi es un CANDIDATO, no un dictamen: a 10 m una casa sola no se ve, y
 * un despalme sin construir cumple las condiciones. Por eso el resultado se
 * agrupa en zonas con area minima y se reporta como zonas a verificar. Tampoco es
 * el total urbanizado: unas 5 ha al mes contra unas 22 ha al mes del construido
 * de Esri.
 *
 * Y la regla solo es confiable con las dos fechas entre julio y octubre: de
 * noviembre a febrero la vegetacion ya seca sigue secandose sin mover el NDVI, y
 * C2 no lo ve (16/11 a 19/12/2025: 234 ha, de las que el 97 % volvio a verdear).
 * De marzo a mayo vuelve a verdear del 56 al 62 %. Hay que resolverlo antes de
 * marzo de 2027 (adenda del dictamen del 30/10/2026).
 */

/** NDVI maximo de la fecha base para contar como obra probable. Estable entre 0.30 y 0.40. */
export const NDVI_MAXIMO_BASE = 0.35

/** Mediana de cambio de NDVI fuera de lo construido a partir de la cual se avisa. */
export const UMBRAL_FENOLOGIA = 0.03

/** NDBI base debajo del cual una celda se toma como no construida al medir la fenologia. */
export const NDBI_NO_CONSTRUIDO = -0.05

/**
 * Suspendida por el dictamen al menos hasta junio de 2027, salvo que antes un
 * metodo pase la validacion retrospectiva mes por mes. El mapa pinta las zonas,
 * pero la leyenda y las notas no dan hectareas, y el escurrimiento no las usa.
 */
export const CIFRA_OBRA_SUSPENDIDA = true

/** La cifra solo se puede reanudar para pares con las dos fechas entre julio y octubre. */
export function parConfiable(diaBase: string, diaActual: string): boolean {
  const enVentana = (dia: string) => {
    const mes = Number(dia.split('-')[1])
    return mes >= 7 && mes <= 10
  }
  return enVentana(diaBase) && enVentana(diaActual)
}

export const AVISO_CIFRA_SUSPENDIDA =
  'Cifra en corrección: al terminar las lluvias el método contaba como obra las parcelas que se secan.'

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
  /** Obra probable: parte de suelo sin vegetacion. Es lo unico que se suma. */
  zonas: ZonaObra[]
  hectareasTotales: number
  /** Cumple la regla pero la base estaba verde. Lista aparte, nunca sumada a obra. */
  perdidaVegetacion: { zonas: ZonaObra[]; hectareas: number }
  fenologia: Fenologia
  /** Celdas de obra probable antes de descartar zonas chicas. */
  celdasCrudas: number
  /** Celdas comparables, es decir con dato valido en las dos fechas. */
  celdasComparables: number
}

/** Cuanto cambio el verdor fuera de lo construido: la medida del secado o el rebrote. */
export interface Fenologia {
  /** Mediana del cambio de NDVI en las celdas no construidas; null si no hay celdas. */
  medianaDndvi: number | null
  /** Si pasa de UMBRAL_FENOLOGIA, una parte de lo detectado es temporada y hay que decirlo. */
  aviso: boolean
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
  /** NDVI maximo de la fecha base para contar como obra probable. */
  ndviMaximoBase?: number
  /** Zonas menores a esto se descartan por ruido. */
  areaMinimaHa: number
}

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
    ndviMaximoBase = NDVI_MAXIMO_BASE,
    areaMinimaHa,
  } = parametros

  const { ancho, alto } = rejilla
  const total = ancho * alto
  const marcada = new Uint8Array(total)
  const conBaseVerde = new Uint8Array(total)

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
      if (nvA <= ndviMaximoBase) {
        marcada[i] = 1
        celdasCrudas++
      } else {
        conBaseVerde[i] = 1
      }
    }
  }

  const obra = agruparZonas(marcada, rejilla, hectareasPorCelda, areaMinimaHa)
  const perdida = agruparZonas(conBaseVerde, rejilla, hectareasPorCelda, areaMinimaHa)

  return {
    mascara: obra.mascara,
    zonas: obra.zonas,
    hectareasTotales: sumaHectareas(obra.zonas),
    perdidaVegetacion: { zonas: perdida.zonas, hectareas: sumaHectareas(perdida.zonas) },
    fenologia: medirFenologia(ndbiAntes, ndviAntes, ndviDespues),
    celdasCrudas,
    celdasComparables,
  }
}

/**
 * Mediana del cambio de NDVI fuera de lo construido. El modo Cambio la usa tambien:
 * le aplica el mismo artefacto estacional.
 */
export function medirFenologia(
  ndbiAntes: Float32Array,
  ndviAntes: Float32Array,
  ndviDespues: Float32Array,
): Fenologia {
  const cambios: number[] = []
  for (let i = 0; i < ndbiAntes.length; i++) {
    const d = ndviDespues[i] - ndviAntes[i]
    if (ndbiAntes[i] < NDBI_NO_CONSTRUIDO && !Number.isNaN(d)) cambios.push(d)
  }
  cambios.sort((a, b) => a - b)
  const medianaDndvi = cambios.length > 0 ? cambios[Math.floor(cambios.length / 2)] : null
  return {
    medianaDndvi,
    aviso: medianaDndvi !== null && Math.abs(medianaDndvi) > UMBRAL_FENOLOGIA,
  }
}

/** El mismo texto en todos los modos que comparan dos fechas. */
export function avisoFenologia(fenologia: Fenologia): string | null {
  if (!fenologia.aviso || fenologia.medianaDndvi === null) return null
  return `El verdor cambió fuera de lo construido (mediana de ${fenologia.medianaDndvi >= 0 ? '+' : ''}${fenologia.medianaDndvi.toFixed(3)} en NDVI): parte de lo detectado puede ser temporada y no un cambio real.`
}

function sumaHectareas(zonas: ZonaObra[]): number {
  return zonas.reduce((suma, zona) => suma + zona.hectareas, 0)
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
function agruparZonas(
  marcada: Uint8Array,
  rejilla: Rejilla,
  hectareasPorCelda: number,
  areaMinimaHa: number,
): { mascara: Float32Array; zonas: ZonaObra[] } {
  const { ancho, alto } = rejilla
  const total = ancho * alto
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

  return { mascara, zonas }
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
