/**
 * Zonas candidatas de cambio de cobertura entre dos fechas de la misma fase de lluvias (vista «Zonas de crecimiento»).
 *
 * Receta de la segunda adenda del dictamen del juez del 30/10/2026: par anual 20/09/2025 contra 22/09/2026, Sentinel-2
 * L2A, regla de obra nueva SIN C2 (NDBI sube 0.08 o mas, NDVI final 0.30 o menos, MNDWI negativo; el NDVI de la base no
 * limita, porque en un par anual una base verde que pasa a suelo es justo el cambio real). Mismo codigo de deteccion
 * que el modo Obra nueva de la plataforma. Declarado antes de medir en la seccion 0 de
 * `ORDENES-DEL-MASTER/2026-11-12-zonas-de-crecimiento.md`.
 *
 * Rotulo (textual del juez): «Zonas candidatas de cambio de cobertura (perdida de vegetacion o aumento de firma
 * construida) entre 20/09/2025 y 22/09/2026, misma fase de lluvias. No es obra confirmada ni superficie urbanizada.»
 *
 * Deja en `salidas/crecimiento/`: `candidatas-2025-2026.geojson` (una zona por poligono, con hectareas y centro) y
 * `candidatas-2025-2026.json` (resumen y contraste).
 *
 * Uso: npx tsx herramientas/crecimiento-reciente.ts
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FeatureCollection } from 'geojson'
import { bboxDe } from '../src/servicios/geojson'
import { buscarEscenas } from '../src/servicios/stac'
import { obtenerMosaico } from '../src/servicios/pilas'
import { aplicarMascara, mascaraDeArea } from '../src/servicios/mascara'
import { metrosDeCelda, rejillaDe } from '../src/servicios/raster'
import { INDICES, calcularIndice } from '../src/servicios/indices'
import { detectarObraNueva } from '../src/servicios/obranueva'
import { buscarColeccion } from '../src/datos/colecciones'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SALIDA = join(RAIZ, 'salidas', 'crecimiento')
const BASE = '2025-09-20'
const ACTUAL = '2026-09-22'
const UMBRAL_NDBI = 0.08
const NDVI_FINAL = 0.3
const AREA_MINIMA_HA = 1
/** Margen de 3 km alrededor del limite urbano, en grados (aprox. a 21 N). */
const MARGEN = 0.03
const LADO = 1600

async function main() {
  const coleccion = buscarColeccion('sentinel-2-c1-l2a')
  const urbano = JSON.parse(await readFile(join(RAIZ, 'public', 'capas', 'LIMITE_URBANO.geojson'), 'utf-8')) as FeatureCollection
  const municipio = JSON.parse(await readFile(join(RAIZ, 'public', 'capas', 'LIMITE.geojson'), 'utf-8')) as FeatureCollection
  const [x0, y0, x1, y1] = bboxDe(urbano)
  const bbox: [number, number, number, number] = [x0 - MARGEN, y0 - MARGEN, x1 + MARGEN, y1 + MARGEN]
  const rejilla = rejillaDe(bbox, LADO, LADO)
  const dentro = mascaraDeArea(rejilla, municipio)
  const enUrbano = mascaraDeArea(rejilla, urbano)
  const celda = metrosDeCelda(rejilla)
  const haPixel = (celda.ancho * celda.alto) / 10_000

  const fecha = async (dia: string) => {
    const { grupos } = await buscarEscenas({ coleccion, bbox, desde: dia, hasta: dia, nubesMax: 100, limite: 20 })
    const g = grupos.find((x) => x.dia === dia)
    if (!g) throw new Error(`No hay escenas del ${dia}`)
    const { pila } = await obtenerMosaico(g.escenas, coleccion, ['swir1', 'nir', 'rojo', 'verde'], rejilla, true)
    for (const banda of Object.values(pila.bandas)) aplicarMascara(banda, dentro)
    return pila
  }
  const antes = await fecha(BASE)
  const despues = await fecha(ACTUAL)
  const porId = (id: string) => INDICES.find((i) => i.id === id)!

  const r = detectarObraNueva({
    ndbiAntes: calcularIndice(antes, porId('ndbi')).valores,
    ndbiDespues: calcularIndice(despues, porId('ndbi')).valores,
    ndviAntes: calcularIndice(antes, porId('ndvi')).valores,
    ndviDespues: calcularIndice(despues, porId('ndvi')).valores,
    mndwiDespues: calcularIndice(despues, porId('mndwi')).valores,
    rejilla,
    hectareasPorCelda: haPixel,
    umbralNdbi: UMBRAL_NDBI,
    ndviMaximoDespues: NDVI_FINAL,
    // Sin C2: en un par anual de la misma fase, la base verde no indica secado.
    ndviMaximoBase: Number.POSITIVE_INFINITY,
    areaMinimaHa: AREA_MINIMA_HA,
  })

  // Celdas de cada zona: se reetiqueta la mascara por vecindad de 8 para sacar un poligono por zona (celdas como cuadros).
  const { ancho, alto, xmin, ymax, pixelAncho, pixelAlto } = rejilla
  const etiqueta = new Int32Array(ancho * alto)
  let n = 0
  const pila: number[] = []
  for (let i = 0; i < ancho * alto; i++) {
    if (r.mascara[i] !== 1 || etiqueta[i]) continue
    n++
    etiqueta[i] = n
    pila.push(i)
    while (pila.length) {
      const k = pila.pop()!
      const cx = k % ancho
      const cy = (k - cx) / ancho
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx
          const y = cy + dy
          if (x < 0 || y < 0 || x >= ancho || y >= alto) continue
          const j = y * ancho + x
          if (r.mascara[j] === 1 && !etiqueta[j]) {
            etiqueta[j] = n
            pila.push(j)
          }
        }
      }
    }
  }
  const zonas: Record<number, { celdas: number[]; urbano: number }> = {}
  for (let i = 0; i < etiqueta.length; i++) {
    const e = etiqueta[i]
    if (!e) continue
    zonas[e] ??= { celdas: [], urbano: 0 }
    zonas[e].celdas.push(i)
    if (enUrbano[i]) zonas[e].urbano++
  }
  const features = Object.entries(zonas).map(([id, z]) => {
    const cuadros = z.celdas.map((i) => {
      const x = i % ancho
      const y = (i - x) / ancho
      const lon0 = xmin + x * pixelAncho
      const lat0 = ymax - y * pixelAlto
      return [[[lon0, lat0], [lon0 + pixelAncho, lat0], [lon0 + pixelAncho, lat0 - pixelAlto], [lon0, lat0 - pixelAlto], [lon0, lat0]]]
    })
    const lon = z.celdas.reduce((s, i) => s + xmin + ((i % ancho) + 0.5) * pixelAncho, 0) / z.celdas.length
    const lat = z.celdas.reduce((s, i) => s + ymax - (Math.floor(i / ancho) + 0.5) * pixelAlto, 0) / z.celdas.length
    return {
      type: 'Feature' as const,
      properties: {
        id: `Z${String(id).padStart(3, '0')}`,
        hectareas: Number((z.celdas.length * haPixel).toFixed(2)),
        fraccion_en_limite_urbano: Number((z.urbano / z.celdas.length).toFixed(2)),
        lat: Number(lat.toFixed(5)),
        lon: Number(lon.toFixed(5)),
      },
      geometry: { type: 'MultiPolygon' as const, coordinates: cuadros },
    }
  })
  const haUrbano = features.reduce((s, f) => s + f.properties.hectareas * f.properties.fraccion_en_limite_urbano, 0)
  await mkdir(SALIDA, { recursive: true })
  await writeFile(join(SALIDA, 'candidatas-2025-2026.geojson'), JSON.stringify({ type: 'FeatureCollection', features }))
  const resumen = {
    base: BASE,
    actual: ACTUAL,
    regla: { umbralNdbi: UMBRAL_NDBI, ndviFinal: NDVI_FINAL, sinC2: true, areaMinimaHa: AREA_MINIMA_HA },
    celdaM: [Number(celda.ancho.toFixed(1)), Number(celda.alto.toFixed(1))],
    zonas: features.length,
    hectareasCandidatas: Number(r.hectareasTotales.toFixed(1)),
    hectareasCandidatasEnLimiteUrbano: Number(haUrbano.toFixed(1)),
    celdasComparables: r.celdasComparables,
    contraste: { juezMismoPar: 98.0, esriConstruidoAnualUrbano: 260 },
  }
  await writeFile(join(SALIDA, 'candidatas-2025-2026.json'), `${JSON.stringify(resumen, null, 2)}\n`)
  console.log(JSON.stringify(resumen, null, 2))
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
