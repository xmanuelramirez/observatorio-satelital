/**
 * Cifra de contraste de la linea de tiempo: la misma fecha leida en las dos colecciones de
 * Sentinel-2, mediana sobre la zona urbana. Una fecha por ventana, la primera en comun con
 * hasta 5 % de nubes en la escena. Su resultado es la tabla `CONTRASTE_COLECCIONES` de
 * `src/lib/lineaTiempo.ts`.
 *
 * Uso: npx tsx herramientas/contraste-colecciones.ts
 */

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FeatureCollection } from 'geojson'
import { bboxDe } from '../src/servicios/geojson'
import { buscarEscenas } from '../src/servicios/stac'
import { obtenerMosaico } from '../src/servicios/pilas'
import { mascaraDeArea } from '../src/servicios/mascara'
import { rejillaDe } from '../src/servicios/raster'
import { buscarColeccion } from '../src/datos/colecciones'
import type { Coleccion, Escena } from '../src/tipos'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LADO = 512
const VENTANAS: [string, string][] = [
  ['2018-05-20', '2018-06-10'],
  ['2019-03-01', '2019-04-30'],
  ['2020-03-01', '2020-04-30'],
  ['2021-03-01', '2021-04-30'],
  ['2022-11-01', '2022-12-31'],
  ['2023-04-01', '2023-05-15'],
  ['2025-03-01', '2025-04-15'],
]

const c1 = buscarColeccion('sentinel-2-c1-l2a')
const vieja = { ...c1, id: 'sentinel-2-l2a' } as unknown as Coleccion

/** Como en `historia.ts`: en la coleccion vieja no se aplica desplazamiento y solo se lee por https. */
function comoVieja(escenas: Escena[]): Escena[] {
  const vistas = new Set<string>()
  return escenas
    .filter((escena) => {
      const abierta = ['red', 'nir', 'scl'].every((nombre) => escena.assets[nombre]?.href.startsWith('https://'))
      if (!abierta || vistas.has(escena.malla)) return false
      vistas.add(escena.malla)
      return true
    })
    .map((escena) => ({
      ...escena,
      assets: Object.fromEntries(Object.entries(escena.assets).map(([k, a]) => [k, { ...a, desplazamiento: 0 }])),
    }))
}

function mediana(valores: number[]): number {
  valores.sort((a, b) => a - b)
  return valores[valores.length >> 1]
}

async function main() {
  const urbana = JSON.parse(await readFile(join(RAIZ, 'public', 'capas', 'LIMITE_URBANO.geojson'), 'utf-8')) as FeatureCollection
  const bbox = bboxDe(urbana)
  const rejilla = rejillaDe(bbox, LADO, LADO)
  const dentro = mascaraDeArea(rejilla, urbana)

  const medir = async (escenas: Escena[], coleccion: Coleccion) => {
    const { pila } = await obtenerMosaico(escenas, coleccion, ['rojo', 'nir'], rejilla, true)
    const rojos: number[] = []
    const ndvis: number[] = []
    for (let i = 0; i < LADO * LADO; i++) {
      const r = pila.bandas.rojo[i]
      const n = pila.bandas.nir[i]
      if (!dentro[i] || !Number.isFinite(r) || !Number.isFinite(n) || n + r <= 0) continue
      rojos.push(r)
      ndvis.push((n - r) / (n + r))
    }
    return { rojo: mediana(rojos), ndvi: mediana(ndvis) }
  }

  for (const [desde, hasta] of VENTANAS) {
    const [nueva, anterior] = await Promise.all(
      [c1, vieja].map((coleccion) => buscarEscenas({ coleccion, bbox, desde, hasta, nubesMax: 5, limite: 40 })),
    )
    const grupo = nueva.grupos.find((g) => anterior.grupos.some((otro) => otro.dia === g.dia))
    const otro = anterior.grupos.find((g) => g.dia === grupo?.dia)
    if (!grupo || !otro) {
      console.log(`${desde} a ${hasta}: sin fecha en común`)
      continue
    }
    const a = await medir(grupo.escenas, c1)
    const b = await medir(comoVieja(otro.escenas), vieja)
    console.log(`${grupo.dia}  rojo ${(b.rojo - a.rojo).toFixed(4)}  NDVI ${(b.ndvi - a.ndvi).toFixed(4)}`)
  }
}

void main()
