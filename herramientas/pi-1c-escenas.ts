/**
 * Planeacion Integral, frente 1c: una escena Sentinel-2 L2A de temporada de lluvias por año (2019-2026) sobre los
 * convenios, con NDVI, NDBI y MNDWI a unos 10 m. Metodo declarado en
 * `ORDENES-DEL-MASTER/2026-11-19-planeacion-integral-METODO.md` (seccion 1c).
 *
 * Escena por año: la mas despejada entre el 15/08 y el 31/10; 2025 y 2026 usan las mismas del cambio reciente
 * (20/09/2025 y 22/09/2026). Deja en `salidas/planeacion-integral/s2/` un `.bin` Float32 por indice y año y un
 * `rejilla.json` con la georreferencia (EPSG:4326). El conteo por poligono lo hace `pi_1c_construido.py`.
 *
 * Uso: npx tsx herramientas/pi-1c-escenas.ts
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FeatureCollection } from 'geojson'
import { bboxDe } from '../src/servicios/geojson'
import { buscarEscenas } from '../src/servicios/stac'
import { obtenerMosaico } from '../src/servicios/pilas'
import { rejillaDe } from '../src/servicios/raster'
import { INDICES, calcularIndice } from '../src/servicios/indices'
import { buscarColeccion } from '../src/datos/colecciones'
import { traeMilSinRestar } from './guarda-escena'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SALIDA = join(RAIZ, 'salidas', 'planeacion-integral', 's2')
const CONVENIOS = join(RAIZ, '..', '13. NUEVOS DESARROLLOS', 'salidas', 'planeacion-integral', 'convenios-2019-hoy.geojson')
const FIJAS: Record<number, string> = { 2025: '2025-09-20', 2026: '2026-09-22' }
const MARGEN = 0.01
const METROS = 10

async function main() {
  const coleccion = buscarColeccion('sentinel-2-c1-l2a')
  const conv = JSON.parse(await readFile(CONVENIOS, 'utf-8')) as FeatureCollection
  const [x0, y0, x1, y1] = bboxDe(conv)
  const bbox: [number, number, number, number] = [x0 - MARGEN, y0 - MARGEN, x1 + MARGEN, y1 + MARGEN]
  const latMedia = ((bbox[1] + bbox[3]) / 2) * (Math.PI / 180)
  const ancho = Math.round(((bbox[2] - bbox[0]) * 111_320 * Math.cos(latMedia)) / METROS)
  const alto = Math.round(((bbox[3] - bbox[1]) * 110_574) / METROS)
  const rejilla = rejillaDe(bbox, ancho, alto)
  await mkdir(SALIDA, { recursive: true })
  const porId = (id: string) => INDICES.find((i) => i.id === id)!
  const escenas: Record<string, { dia: string; nubes: number | null; escenas: number; trae_mil_sin_restar?: boolean }> = {}

  // ANIOS=2022 NUBES=60 rehace solo esos años con otra tolerancia de nubes (la mascara de nubes quita lo nublado).
  const soloAnios = process.env.ANIOS?.split(',').map(Number)
  const nubesMax = Number(process.env.NUBES ?? 20)
  const previo = soloAnios ? JSON.parse(await readFile(join(SALIDA, 'rejilla.json'), 'utf-8')) : null
  if (previo) Object.assign(escenas, previo.escenas)
  for (let anio = 2019; anio <= 2026; anio++) {
    if (soloAnios && !soloAnios.includes(anio)) continue
    const fija = FIJAS[anio]
    const { grupos } = await buscarEscenas({
      coleccion,
      bbox,
      desde: fija ?? `${anio}-08-15`,
      hasta: fija ?? `${anio}-10-31`,
      nubesMax: fija ? 100 : nubesMax,
      limite: 200,
    })
    const objetivo = Date.parse(`${anio}-09-20`)
    const g = fija
      ? grupos.find((x) => x.dia === fija)
      : [...grupos].sort((a, b) => (a.nubes ?? 100) - (b.nubes ?? 100) || Math.abs(Date.parse(a.dia) - objetivo) - Math.abs(Date.parse(b.dia) - objetivo))[0]
    if (!g) {
      console.warn(`${anio}: sin escena`)
      continue
    }
    const { pila } = await obtenerMosaico(g.escenas, coleccion, ['swir1', 'nir', 'rojo', 'verde'], rejilla, true)
    for (const id of ['ndvi', 'ndbi', 'mndwi']) {
      const v = calcularIndice(pila, porId(id)).valores
      await writeFile(join(SALIDA, `${anio}-${id}.bin`), Buffer.from(new Float32Array(v).buffer))
    }
    // Guarda de escena del observatorio (dictamen del 30/10): el +1000 sin restar sube lo mas oscuro de la escena.
    escenas[anio] = { dia: g.dia, nubes: g.nubes, escenas: g.escenas.length, trae_mil_sin_restar: traeMilSinRestar(pila.bandas.rojo) }
    console.log(`${anio}: ${g.dia}, nubes ${g.nubes}, ${g.escenas.length} escenas`)
  }
  await writeFile(
    join(SALIDA, 'rejilla.json'),
    JSON.stringify({ ancho, alto, xmin: rejilla.xmin, ymax: rejilla.ymax, pixelAncho: rejilla.pixelAncho, pixelAlto: rejilla.pixelAlto, epsg: 4326, escenas }, null, 1),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
