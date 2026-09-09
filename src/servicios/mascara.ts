import proj4 from 'proj4'
import type { FeatureCollection, Position } from 'geojson'
import { definicionCrs, type Rejilla } from './raster'

interface Arista {
  /** Coordenadas ya en pixeles de la rejilla. */
  x0: number
  y0: number
  x1: number
  y1: number
}

function anillosDe(datos: FeatureCollection): Position[][] {
  const anillos: Position[][] = []

  for (const feature of datos.features) {
    const geometria = feature.geometry
    if (!geometria) continue

    if (geometria.type === 'Polygon') {
      for (const anillo of geometria.coordinates) anillos.push(anillo as Position[])
    } else if (geometria.type === 'MultiPolygon') {
      for (const poligono of geometria.coordinates) {
        for (const anillo of poligono) anillos.push(anillo as Position[])
      }
    }
  }

  return anillos
}

/**
 * Rasteriza el area por barrido de lineas en el espacio de la propia rejilla.
 *
 * La alternativa obvia, probar punto por punto contra el poligono, es
 * inviable: el limite municipal trae miles de vertices y la rejilla cientos
 * de miles de celdas, y el navegador se congela. Aqui los vertices se
 * proyectan una sola vez y cada fila se resuelve con sus cruces ordenados,
 * que es lo que hace cualquier rasterizador.
 *
 * Los huecos salen gratis con la regla par e impar: un anillo interior
 * invierte la paridad y la celda queda fuera.
 */
export function mascaraDeArea(rejilla: Rejilla, area: FeatureCollection): Uint8Array {
  const dentro = new Uint8Array(rejilla.ancho * rejilla.alto)
  const anillos = anillosDe(area)
  if (anillos.length === 0) return dentro.fill(1)

  const crs = definicionCrs(rejilla.epsg)
  const aRejilla = crs === 'EPSG:4326' ? null : proj4('EPSG:4326', crs)

  const aristas: Arista[] = []
  let yMinimo = Infinity
  let yMaximo = -Infinity

  for (const anillo of anillos) {
    const pixeles: [number, number][] = anillo.map(([lon, lat]) => {
      const [x, y] = aRejilla ? aRejilla.forward([lon, lat]) : [lon, lat]
      return [(x - rejilla.xmin) / rejilla.pixelAncho, (rejilla.ymax - y) / rejilla.pixelAlto]
    })

    for (let i = 0, j = pixeles.length - 1; i < pixeles.length; j = i++) {
      const [x0, y0] = pixeles[j]
      const [x1, y1] = pixeles[i]
      if (y0 === y1) continue

      aristas.push({ x0, y0, x1, y1 })
      yMinimo = Math.min(yMinimo, y0, y1)
      yMaximo = Math.max(yMaximo, y0, y1)
    }
  }

  if (aristas.length === 0) return dentro

  const primeraFila = Math.max(0, Math.floor(yMinimo))
  const ultimaFila = Math.min(rejilla.alto - 1, Math.ceil(yMaximo))
  const cruces: number[] = []

  for (let fila = primeraFila; fila <= ultimaFila; fila++) {
    const y = fila + 0.5
    cruces.length = 0

    for (const arista of aristas) {
      const { x0, y0, x1, y1 } = arista
      if (y0 > y === y1 > y) continue
      cruces.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0))
    }

    if (cruces.length < 2) continue
    cruces.sort((a, b) => a - b)

    const base = fila * rejilla.ancho
    for (let par = 0; par + 1 < cruces.length; par += 2) {
      const desde = Math.max(0, Math.ceil(cruces[par] - 0.5))
      const hasta = Math.min(rejilla.ancho - 1, Math.floor(cruces[par + 1] - 0.5))
      for (let columna = desde; columna <= hasta; columna++) dentro[base + columna] = 1
    }
  }

  return dentro
}

export function aplicarMascara(banda: Float32Array, dentro: Uint8Array): void {
  for (let i = 0; i < banda.length; i++) {
    if (dentro[i] === 0) banda[i] = Number.NaN
  }
}
