/**
 * Pasa la guarda por lo que ya esta publicado, sin escribir imagenes, y prueba que atrapa las
 * escenas conocidas. Contraste declarado por el juez: en la coleccion vieja, entre el 25/01 y el
 * 05/03/2022, las seis fechas del 29/01 al 23/02 pasan de 1 000 DN (23/02: 1 320), y ninguna de
 * las escenas que usa la serie (69 a 467 DN). Tambien imprime el percentil 1 del rojo, el de bruma.
 *
 * Con --escribir, completa `historia.json` con las escenas y la linea base de cada mes. Cuando una
 * malla tiene dos versiones del procesado, relee el mes y se queda con la que reproduce la cifra
 * urbana guardada: la imagen publicada no cambia, solo se anota de donde salio.
 *
 * Uso: npx tsx herramientas/auditar-historia.ts [--escribir]
 */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FeatureCollection } from 'geojson'
import { bboxDe } from '../src/servicios/geojson'
import { buscarEscenas } from '../src/servicios/stac'
import { obtenerMosaico, obtenerPilaEscena } from '../src/servicios/pilas'
import { mascaraDeArea } from '../src/servicios/mascara'
import { rejillaDe } from '../src/servicios/raster'
import { buscarColeccion } from '../src/datos/colecciones'
import type { Coleccion, Escena } from '../src/tipos'
import { CORTE_MIL, percentilDeReflectancia, traeMilSinRestar } from './guarda-escena'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RUTA_JSON = join(RAIZ, 'public', 'apertura', 'evolucion', 'historia', 'historia.json')
const ESCRIBIR = process.argv.includes('--escribir')
const LADO_NUBES = 256
const LADO_NDVI = 1024
/** La cifra urbana del JSON va a 4 decimales. */
const TOLERANCIA = 0.0002

const c1 = buscarColeccion('sentinel-2-c1-l2a')
const vieja = { ...c1, id: 'sentinel-2-l2a' } as unknown as Coleccion

const sinDesplazamiento = (escena: Escena): Escena => ({
  ...escena,
  assets: Object.fromEntries(Object.entries(escena.assets).map(([k, a]) => [k, { ...a, desplazamiento: 0 }])),
})
const abierta = (escena: Escena) => ['red', 'green', 'blue', 'nir', 'scl'].every((n) => escena.assets[n]?.href.startsWith('https://'))
const med = (x: number[]) => {
  x.sort((a, b) => a - b)
  return x[x.length >> 1]
}

async function main() {
  const leerCapa = async (id: string) => JSON.parse(await readFile(join(RAIZ, 'public', 'capas', `${id}.geojson`), 'utf-8')) as FeatureCollection
  const municipio = await leerCapa('LIMITE')
  const cuenca = await leerCapa('CUENCA_PALOTE')
  const urbana = await leerCapa('LIMITE_URBANO')
  const bbox = bboxDe({ type: 'FeatureCollection', features: [...municipio.features, ...cuenca.features] })
  const rejilla = rejillaDe(bbox, LADO_NUBES, LADO_NUBES)
  const rejillaNdvi = rejillaDe(bbox, LADO_NDVI, LADO_NDVI)
  const urbanaNdvi = mascaraDeArea(rejillaNdvi, urbana)
  const urbanaGruesa = mascaraDeArea(rejilla, urbana)

  const dn = (v: number | null) => (v === null ? 'sin dato' : `${Math.round(v * 10000)} DN`)

  const medirEscena = async (escena: Escena, coleccion: Coleccion) => {
    const { pila } = await obtenerPilaEscena(escena, coleccion, ['rojo'], rejilla, true)
    const soloUrbana = Array.from(pila.bandas.rojo).filter((_, i) => urbanaGruesa[i])
    return {
      mala: traeMilSinRestar(pila.bandas.rojo),
      p01: percentilDeReflectancia(pila.bandas.rojo, 0.001),
      p1: percentilDeReflectancia(pila.bandas.rojo, 0.01),
      p1Urbana: percentilDeReflectancia(soloUrbana, 0.01),
    }
  }

  console.log(`--- Ventana de prueba, coleccion vieja, corte ${dn(CORTE_MIL)}`)
  const ventana = await buscarEscenas({ coleccion: vieja, bbox, desde: '2022-01-25', hasta: '2022-03-05', nubesMax: 100, limite: 60 })
  let atrapadas = 0
  for (const grupo of ventana.grupos) {
    for (const escena of grupo.escenas.filter(abierta).map(sinDesplazamiento)) {
      const m = await medirEscena(escena, vieja)
      if (m.mala) atrapadas++
      console.log(`${escena.id} base ${escena.lineaBase} p0.1 ${dn(m.p01)} ${m.mala ? 'DESCARTADA' : 'pasa'}`)
    }
  }
  console.log(`atrapadas en la ventana: ${atrapadas}`)

  console.log('--- Bruma, fecha de referencia del juez')
  const bruma = await buscarEscenas({ coleccion: c1, bbox, desde: '2025-11-09', hasta: '2025-11-09', nubesMax: 100, limite: 10 })
  for (const escena of bruma.grupos.flatMap((g) => g.escenas)) {
    const m = await medirEscena(escena, c1)
    console.log(`${escena.id} p1 ${m.p1?.toFixed(4)} p1 urbana ${m.p1Urbana?.toFixed(4)}`)
  }

  console.log('--- Meses publicados')
  const historia = JSON.parse(await readFile(RUTA_JSON, 'utf-8'))
  let malos = 0
  for (const [mes, dato] of Object.entries<any>(historia.meses)) {
    if (!dato) continue
    const coleccion = dato.fuente === 'sentinel-2-l2a' ? vieja : c1
    const { grupos } = await buscarEscenas({ coleccion, bbox, desde: dato.dia, hasta: dato.dia, nubesMax: 100, limite: 20 })
    const todas = (grupos.find((g) => g.dia === dato.dia)?.escenas ?? []).filter((e) => (coleccion === vieja ? abierta(e) : true))

    // Por malla, en el orden del STAC: la primera es la que tomaba la regla con que se genero el mes.
    const porMalla = new Map<string, Escena[]>()
    for (const escena of todas) porMalla.set(escena.malla, [...(porMalla.get(escena.malla) ?? []), escena])
    const versiones = Math.max(...[...porMalla.values()].map((v) => v.length))
    let elegidas = [...porMalla.values()].map((v) => v[0])
    let confirmada: boolean | null = null

    if (versiones > 1) {
      confirmada = false
      for (let k = 0; k < versiones && !confirmada; k++) {
        const prueba = [...porMalla.values()].map((v) => v[Math.min(k, v.length - 1)])
        const preparadas = coleccion === vieja ? prueba.map(sinDesplazamiento) : prueba
        const { pila } = await obtenerMosaico(preparadas, coleccion, ['rojo', 'nir'], rejillaNdvi, true)
        const rojos: number[] = []
        const ndvis: number[] = []
        pila.bandas.rojo.forEach((r: number, i: number) => {
          const n = pila.bandas.nir[i]
          if (urbanaNdvi[i] && Number.isFinite(r) && Number.isFinite(n) && n + r > 0) {
            rojos.push(r)
            ndvis.push((n - r) / (n + r))
          }
        })
        const difRojo = Math.abs(med(rojos) - dato.urbana.rojo)
        const difNdvi = Math.abs(med(ndvis) - dato.urbana.ndvi)
        console.log(`${mes} version ${prueba.map((e) => `${e.id}:${e.lineaBase}`).join(' ')} dif rojo ${difRojo.toFixed(4)} ndvi ${difNdvi.toFixed(4)}`)
        if (difRojo <= TOLERANCIA && difNdvi <= TOLERANCIA) {
          elegidas = prueba
          confirmada = true
        }
      }
    }

    const medidas = []
    for (const escena of elegidas) {
      medidas.push({ escena, ...(await medirEscena(coleccion === vieja ? sinDesplazamiento(escena) : escena, coleccion)) })
    }
    if (coleccion === vieja && medidas.some((m) => m.mala)) malos++
    console.log(
      `${mes} ${dato.dia} ${dato.fuente} ` +
        medidas.map((m) => `${m.escena.malla}:${m.escena.lineaBase} p0.1 ${dn(m.p01)} p1 ${m.p1?.toFixed(4)} urb ${m.p1Urbana?.toFixed(4)}${coleccion === vieja && m.mala ? ' DESCARTARIA' : ''}`).join(' | ') +
        (confirmada === false ? ' VERSION SIN CONFIRMAR' : ''),
    )

    if (ESCRIBIR && medidas.length > 0) {
      dato.escenas = confirmada === false ? [] : elegidas.map((e) => ({ id: e.id, lineaBase: e.lineaBase }))
      await writeFile(RUTA_JSON, `${JSON.stringify(historia)}\n`)
    }
  }
  console.log(`meses publicados que la guarda descartaria: ${malos}`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
