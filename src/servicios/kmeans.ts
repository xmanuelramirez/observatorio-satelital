export interface ResultadoKmeans {
  /** Etiqueta de clase por pixel; -1 donde no habia dato. */
  etiquetas: Int32Array
  /** Centroides en las unidades originales de cada banda. */
  centroides: number[][]
  nombresBandas: string[]
  conteos: number[]
  iteraciones: number
  convergio: boolean
  inercia: number
}

/**
 * Congruencial lineal con semilla fija: la misma escena y los mismos ajustes
 * deben dar exactamente las mismas clases, o el resultado no es citable en un
 * informe.
 */
function generador(semilla: number): () => number {
  let estado = semilla >>> 0
  return () => {
    estado = (estado * 1664525 + 1013904223) >>> 0
    return estado / 4294967296
  }
}

function estandarizar(
  bandas: Float32Array[],
  indicesValidos: Int32Array,
): { datos: Float32Array[]; medias: number[]; desviaciones: number[] } {
  const medias: number[] = []
  const desviaciones: number[] = []
  const datos: Float32Array[] = []

  for (const banda of bandas) {
    let suma = 0
    for (const i of indicesValidos) suma += banda[i]
    const media = suma / indicesValidos.length

    let acumulado = 0
    for (const i of indicesValidos) {
      const d = banda[i] - media
      acumulado += d * d
    }
    const desviacion = Math.sqrt(acumulado / indicesValidos.length) || 1

    const normalizada = new Float32Array(indicesValidos.length)
    for (let j = 0; j < indicesValidos.length; j++) {
      normalizada[j] = (banda[indicesValidos[j]] - media) / desviacion
    }

    medias.push(media)
    desviaciones.push(desviacion)
    datos.push(normalizada)
  }

  return { datos, medias, desviaciones }
}

function distanciaCuadrada(datos: Float32Array[], punto: number, centro: number[]): number {
  let suma = 0
  for (let d = 0; d < datos.length; d++) {
    const delta = datos[d][punto] - centro[d]
    suma += delta * delta
  }
  return suma
}

/** Siembra tipo k-means++: separa los centros iniciales en vez de sortearlos. */
function sembrar(datos: Float32Array[], n: number, k: number, azar: () => number): number[][] {
  const dimensiones = datos.length
  const centros: number[][] = []
  const primero = Math.floor(azar() * n)
  centros.push(datos.map((d) => d[primero]))

  const distancias = new Float64Array(n).fill(Infinity)

  for (let c = 1; c < k; c++) {
    let total = 0
    for (let i = 0; i < n; i++) {
      const d = distanciaCuadrada(datos, i, centros[c - 1])
      if (d < distancias[i]) distancias[i] = d
      total += distancias[i]
    }

    let objetivo = azar() * total
    let elegido = n - 1
    for (let i = 0; i < n; i++) {
      objetivo -= distancias[i]
      if (objetivo <= 0) {
        elegido = i
        break
      }
    }

    const centro: number[] = []
    for (let d = 0; d < dimensiones; d++) centro.push(datos[d][elegido])
    centros.push(centro)
  }

  return centros
}

export function kmeans(
  bandas: Float32Array[],
  nombresBandas: string[],
  k: number,
  maxIteraciones = 40,
  semilla = 20260820,
): ResultadoKmeans {
  const totalPixeles = bandas[0].length

  const validos: number[] = []
  for (let i = 0; i < totalPixeles; i++) {
    if (bandas.every((b) => !Number.isNaN(b[i]))) validos.push(i)
  }
  const indicesValidos = Int32Array.from(validos)

  const etiquetas = new Int32Array(totalPixeles).fill(-1)
  if (indicesValidos.length < k) {
    return {
      etiquetas,
      centroides: [],
      nombresBandas,
      conteos: [],
      iteraciones: 0,
      convergio: false,
      inercia: 0,
    }
  }

  const { datos, medias, desviaciones } = estandarizar(bandas, indicesValidos)
  const n = indicesValidos.length
  const azar = generador(semilla)
  let centros = sembrar(datos, n, k, azar)

  const asignacion = new Int32Array(n).fill(-1)
  let iteraciones = 0
  let convergio = false
  let inercia = 0

  while (iteraciones < maxIteraciones) {
    iteraciones++
    let cambios = 0
    inercia = 0

    for (let i = 0; i < n; i++) {
      let mejor = 0
      let mejorDistancia = Infinity
      for (let c = 0; c < k; c++) {
        const d = distanciaCuadrada(datos, i, centros[c])
        if (d < mejorDistancia) {
          mejorDistancia = d
          mejor = c
        }
      }
      inercia += mejorDistancia
      if (asignacion[i] !== mejor) {
        asignacion[i] = mejor
        cambios++
      }
    }

    // Tolerancia en vez de cero cambios: con cientos de miles de pixeles
    // siempre hay unos cuantos oscilando en la frontera entre dos clases.
    if (cambios <= Math.max(1, Math.floor(n * 0.001))) {
      convergio = true
      break
    }

    const sumas = Array.from({ length: k }, () => new Float64Array(datos.length))
    const conteos = new Int32Array(k)

    for (let i = 0; i < n; i++) {
      const c = asignacion[i]
      conteos[c]++
      for (let d = 0; d < datos.length; d++) sumas[c][d] += datos[d][i]
    }

    centros = centros.map((centroPrevio, c) => {
      if (conteos[c] === 0) return centroPrevio
      return Array.from(sumas[c], (suma) => suma / conteos[c])
    })
  }

  const conteos = new Array<number>(k).fill(0)
  for (let i = 0; i < n; i++) {
    etiquetas[indicesValidos[i]] = asignacion[i]
    conteos[asignacion[i]]++
  }

  // Los centroides se devuelven en unidades originales, no estandarizadas.
  const centroides = centros.map((centro) =>
    centro.map((valor, d) => valor * desviaciones[d] + medias[d]),
  )

  return { etiquetas, centroides, nombresBandas, conteos, iteraciones, convergio, inercia }
}
