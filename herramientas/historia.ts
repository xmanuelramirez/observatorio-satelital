/**
 * Una imagen limpia por mes en la linea de tiempo larga: Color y NDVI del municipio.
 *
 * Fuente: `sentinel-2-c1-l2a` donde exista, porque viene reprocesada con un solo
 * criterio. Faltan 2017 y muchos meses hasta 2022, y ahi se usa `sentinel-2-l2a`
 * con desplazamiento 0, sin importar lo que declare su metadato: esa coleccion ya
 * resto el +1000 y aplicarlo otra vez cuenta doble (comprobado el 09/10/2026).
 *
 * Seis fechas de la vieja, del 29/01 al 23/02/2022, traen el +1000 sin restar en sus dos mallas
 * (12 escenas), con la misma bandera que las corregidas. La guarda por escena (`guarda-escena.ts`) descarta la fecha
 * que traiga una: restarle 0.1 dejaria una escena corregida a ojo junto a una sin corregir. Y si
 * un mes queda a mas de 0.05 de rojo de su mismo mes, la corrida termina en error, para que
 * `npm run desplegar` no publique sin que alguien lo vea. Cada mes guarda sus escenas y su
 * linea base. Una corrida normal no toca los meses cerrados.
 *
 * Criterio de exclusion y de rotulo, para todos los meses (dictamen del 30/10/2026):
 *  - Se excluye una fecha solo con causa fisica que el filtro de nubes no ve: eclipse
 *    (`FECHAS_EXCLUIDAS`), +1000 sin restar (`traeMilSinRestar`) o bruma (percentil 1 del rojo
 *    mayor de 0.06, como el 09/11/2025). La bruma NO esta en codigo: ese corte no separa. El
 *    09/11/2025 da 0.062 y 27 meses publicados de estiaje lo pasan, hasta 0.092 (auditoria del
 *    01/11/2026). Automatizarlo sacaria esos meses; el corte espera al juez.
 *  - Se rotula, sin excluir, todo mes a mas de 0.02 de rojo o 0.05 de NDVI de la mediana de su
 *    mismo mes, sobre la zona urbana. Quitarlos seria escoger datos. La app los calcula de este
 *    JSON (`mesesApartados`, en `src/lib/lineaTiempo.ts`): hoy son 2017-09, 2017-10, 2018-05,
 *    2018-07, 2018-12 y 2023-07.
 * La tabla del contraste entre colecciones esta en ese mismo archivo y sale de
 * `herramientas/contraste-colecciones.ts`.
 *
 * Todas las imagenes llevan la misma escala, la de una escena de referencia, para
 * que el color no brinque entre anios por el estiramiento. El JSON deja por mes la
 * reflectancia mediana sobre la zona urbana: es la cifra de contraste. Lo construido
 * casi no cambia de un anio a otro, asi que un brinco ahi es de la fuente, no del terreno.
 * Lo que queda fuera de la silueta (municipio y Cuenca Palote, que sale de el) no se
 * escribe: el recorte es parte de la imagen. La app recorta encima segun el area.
 *
 * Uso:
 *   npm run historia                    desde 2017 hasta el mes en curso
 *   npm run historia -- 2017-01 2019-12
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import type { FeatureCollection } from 'geojson'
import { bboxDe } from '../src/servicios/geojson'
import { buscarEscenas } from '../src/servicios/stac'
import { obtenerMosaico, obtenerPilaEscena } from '../src/servicios/pilas'
import { CORTE_ALARMA_ROJO, desviacionDelMismoMes, traeMilSinRestar } from './guarda-escena'
import { mascaraDeArea } from '../src/servicios/mascara'
import { rejillaDe } from '../src/servicios/raster'
import { aRgb } from '../src/servicios/pintura'
import { colorDeIndice } from '../src/servicios/paletas'
import { fechasCompletas } from '../src/lib/cobertura'
import { diaLocal } from '../src/lib/fecha'
import { buscarColeccion } from '../src/datos/colecciones'
import type { Coleccion, Escena, GrupoDia } from '../src/tipos'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** `HISTORIA_SALIDA` permite probar sin tocar lo que se publica. */
const SALIDA = process.env.HISTORIA_SALIDA ?? join(RAIZ, 'public', 'apertura', 'evolucion', 'historia')
const REFERENCIA = '2026-10-20'
const LADO_COLOR = 2000
const LADO_NDVI = 1024
const CALIDAD = 78
/** Rejilla gruesa para medir las nubes de cada candidata sin leer la escena entera. */
const LADO_NUBES = 256
const NUBES_ESCENA = 30
/** Una fecha cuenta como limpia con 10 % de nubes o menos sobre el municipio. */
const NUBES_AREA = 10
const CANDIDATAS = 4
/** El color de fuera del recorte: el mismo fondo de la pagina. */
const FUERA = [11, 16, 25]

/**
 * Fechas que el filtro de nubes no ve. El 8 de abril de 2024 hubo eclipse solar: la imagen
 * sale limpia y oscura, con el rojo urbano en 0.146 contra unos 0.22 de cualquier abril.
 */
const FECHAS_EXCLUIDAS = new Set(['2024-04-08'])

const c1 = buscarColeccion('sentinel-2-c1-l2a')
const vieja = { ...c1, id: 'sentinel-2-l2a' } as unknown as Coleccion

/** Ver el encabezado: en la coleccion vieja el desplazamiento declarado no se aplica. */
function sinDesplazamiento(escena: Escena): Escena {
  const assets = Object.fromEntries(Object.entries(escena.assets).map(([k, a]) => [k, { ...a, desplazamiento: 0 }]))
  return { ...escena, assets }
}

/**
 * La coleccion vieja repite algunas mallas con una copia en s3:// de una cubeta que cobra
 * al que lee, o con otra version del procesado. Solo sirven las que se pueden leer por
 * https, y una por malla: la de linea base mas reciente, no la que el STAC devuelva primero.
 */
function legibles(escenas: Escena[]): Escena[] {
  const vistas = new Set<string>()
  const recientes = [...escenas].sort((a, b) => (b.lineaBase ?? '').localeCompare(a.lineaBase ?? ''))
  return recientes.filter((escena) => {
    // Solo importan las bandas que se leen: los metadatos de la escena pueden seguir en s3://.
    const abierta = ['red', 'green', 'blue', 'nir', 'scl'].every((nombre) => escena.assets[nombre]?.href.startsWith('https://'))
    if (!abierta || vistas.has(escena.malla)) return false
    vistas.add(escena.malla)
    return true
  })
}

async function conReintentos<T>(trabajo: () => Promise<T>, intentos = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await trabajo()
    } catch (error) {
      if (i >= intentos) throw error
      await new Promise((listo) => setTimeout(listo, 20_000))
    }
  }
}

function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null
  valores.sort((a, b) => a - b)
  return valores[valores.length >> 1]
}

function finDeMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number)
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10)
}

function mesesEntre(desde: string, hasta: string): string[] {
  const salida: string[] = []
  let [a, m] = desde.split('-').map(Number)
  const [za, zm] = hasta.split('-').map(Number)
  while (a < za || (a === za && m <= zm)) {
    salida.push(`${a}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) {
      m = 1
      a++
    }
  }
  return salida
}

async function main() {
  const mesEnCurso = diaLocal(new Date()).slice(0, 7)
  const [desde = '2017-01', hasta = mesEnCurso] = process.argv.slice(2)
  await mkdir(SALIDA, { recursive: true })

  const leerCapa = async (id: string) => JSON.parse(await readFile(join(RAIZ, 'public', 'capas', `${id}.geojson`), 'utf-8')) as FeatureCollection
  const municipio = await leerCapa('LIMITE')
  const urbana = await leerCapa('LIMITE_URBANO')
  const cuenca = await leerCapa('CUENCA_PALOTE')
  const bbox = bboxDe({ type: 'FeatureCollection', features: [...municipio.features, ...cuenca.features] })
  // Se unen las mascaras, no los poligonos: en una sola capa, lo que se traslapa queda fuera.
  const mascaraSilueta = (rejilla: ReturnType<typeof rejillaDe>) => {
    const a = mascaraDeArea(rejilla, municipio)
    const b = mascaraDeArea(rejilla, cuenca)
    return a.map((v: number, i: number) => (v || b[i] ? 1 : 0))
  }

  const rejillaColor = rejillaDe(bbox, LADO_COLOR, LADO_COLOR)
  const rejillaNdvi = rejillaDe(bbox, LADO_NDVI, LADO_NDVI)
  const rejillaNubes = rejillaDe(bbox, LADO_NUBES, LADO_NUBES)
  const dentroColor = mascaraSilueta(rejillaColor)
  const dentroNdvi = mascaraSilueta(rejillaNdvi)
  const dentroNubes = mascaraSilueta(rejillaNubes)
  const urbanaNdvi = mascaraDeArea(rejillaNdvi, urbana)
  const celdasNubes = dentroNubes.reduce((s: number, v: number) => s + v, 0)

  // La escala de toda la serie sale de la misma escena.
  const { grupos: gruposRef } = await conReintentos(() => buscarEscenas({ coleccion: c1, bbox, desde: REFERENCIA, hasta: REFERENCIA, nubesMax: 30, limite: 20 }))
  const ref = gruposRef.find((g) => g.dia === REFERENCIA)
  if (!ref) throw new Error(`No aparece la escena de referencia ${REFERENCIA}`)
  const { pila: pilaRef } = await conReintentos(() => obtenerMosaico(ref.escenas, c1, ['rojo', 'verde', 'azul', 'nir'], rejillaNdvi, false))
  const percentil = (valores: number[], q: number) => {
    valores.sort((a, b) => a - b)
    return valores[Math.floor(valores.length * q)]
  }
  const cortes = (['rojo', 'verde', 'azul'] as const).map((banda) => {
    const v: number[] = []
    pilaRef.bandas[banda].forEach((x: number, i: number) => {
      if (dentroNdvi[i] && Number.isFinite(x) && x > 0) v.push(x)
    })
    return [percentil(v, 0.01), percentil(v, 0.995)] as [number, number]
  })
  const ndviRef: number[] = []
  for (let i = 0; i < LADO_NDVI * LADO_NDVI; i++) {
    const n = pilaRef.bandas.nir[i]
    const r = pilaRef.bandas.rojo[i]
    if (dentroNdvi[i] && Number.isFinite(n) && Number.isFinite(r) && n + r > 0) ndviRef.push((n - r) / (n + r))
  }
  const p2 = percentil(ndviRef, 0.02)
  const p98 = percentil(ndviRef, 0.98)

  const rutaJson = join(SALIDA, 'historia.json')
  const previo = existsSync(rutaJson) ? JSON.parse(await readFile(rutaJson, 'utf-8')) : { meses: {} }
  const meses: Record<string, unknown> = previo.meses
  const inicio = Date.now()
  const alarmas: string[] = []

  const buscarEn = async (coleccion: Coleccion, mes: string): Promise<GrupoDia[]> => {
    const { grupos } = await conReintentos(() =>
      buscarEscenas({ coleccion, bbox, desde: `${mes}-01`, hasta: finDeMes(mes), nubesMax: NUBES_ESCENA, limite: 60 }),
    )
    return fechasCompletas(grupos, bbox)
  }

  /** Misma lectura que `nubesSobreArea`: la pila queda en cache y no se baja dos veces. */
  const conMilSinRestar = async (grupo: GrupoDia, coleccion: Coleccion): Promise<Escena | null> => {
    for (const escena of grupo.escenas) {
      const { pila } = await conReintentos(() => obtenerPilaEscena(escena, coleccion, ['rojo'], rejillaNubes, true))
      if (traeMilSinRestar(pila.bandas.rojo)) return escena
    }
    return null
  }

  /** Las nubes que de verdad caen sobre la silueta, no las de toda la malla. */
  const nubesSobreArea = async (grupo: GrupoDia, coleccion: Coleccion): Promise<number> => {
    const { pila } = await conReintentos(() => obtenerMosaico(grupo.escenas, coleccion, ['rojo'], rejillaNubes, true))
    let sinDato = 0
    pila.bandas.rojo.forEach((v: number, i: number) => {
      if (dentroNubes[i] && !Number.isFinite(v)) sinDato++
    })
    return (100 * sinDato) / celdasNubes
  }

  for (const mes of mesesEntre(desde, hasta)) {
    const rutaColor = join(SALIDA, `color-${mes}.jpg`)
    const rutaNdvi = join(SALIDA, `indice-ndvi-${mes}.png`)
    // Un mes cerrado ya no cambia, con imagen o sin ella. El mes en curso se revisa siempre.
    if (mes !== mesEnCurso && (meses[mes] === null || (meses[mes] && existsSync(rutaColor) && existsSync(rutaNdvi)))) continue

    let elegida: { grupo: GrupoDia; coleccion: Coleccion; nubes: number; fuente: string } | null = null
    for (const [coleccion, fuente] of [[c1, 'sentinel-2-c1-l2a'], [vieja, 'sentinel-2-l2a']] as const) {
      const grupos = (await buscarEn(coleccion, mes))
        .map((g) => (coleccion === vieja ? { ...g, escenas: legibles(g.escenas).map(sinDesplazamiento) } : g))
        .filter((g) => g.escenas.length > 0 && !FECHAS_EXCLUIDAS.has(g.dia))
      const orden = [...grupos].sort((a, b) => (a.nubes ?? 99) - (b.nubes ?? 99))
      let candidatas = 0
      for (const grupo of orden) {
        if (candidatas >= CANDIDATAS) break
        // Una fecha descartada no gasta candidata: en febrero de 2022 las limpias son las que traen el +1000.
        if (coleccion === vieja) {
          const mala = await conMilSinRestar(grupo, coleccion)
          if (mala) {
            console.log(`${mes}: ${grupo.dia} descartada, ${mala.id} trae el +1000 sin restar`)
            continue
          }
        }
        candidatas++
        const nubes = await nubesSobreArea(grupo, coleccion)
        if (nubes <= NUBES_AREA && (!elegida || nubes < elegida.nubes)) elegida = { grupo, coleccion, nubes, fuente }
      }
      if (elegida) break
    }
    if (!elegida) {
      meses[mes] = null
      console.log(`${mes}: sin fecha limpia`)
      await writeFile(rutaJson, `${JSON.stringify({ limites: [[bbox[1], bbox[0]], [bbox[3], bbox[2]]], escala: { p2, p98, cortes }, meses })}\n`)
      continue
    }

    const { grupo, coleccion, nubes, fuente } = elegida
    const { pila } = await conReintentos(() => obtenerMosaico(grupo.escenas, coleccion, ['rojo', 'verde', 'azul'], rejillaColor, false))
    const total = LADO_COLOR * LADO_COLOR
    const rgba = new Uint8Array(total * 4)
    const bandasColor = [pila.bandas.rojo, pila.bandas.verde, pila.bandas.azul]
    for (let i = 0; i < total; i++) {
      for (let c = 0; c < 3; c++) {
        const [bajo, tope] = cortes[c]
        const v = bandasColor[c][i]
        const valor = Number.isFinite(v) ? Math.round(255 * Math.min(1, Math.max(0, (v - bajo) / (tope - bajo))) ** 0.7) : 0
        rgba[i * 4 + c] = dentroColor[i] ? valor : FUERA[c]
      }
      rgba[i * 4 + 3] = 255
    }
    await writeFile(rutaColor, jpeg.encode({ data: rgba, width: LADO_COLOR, height: LADO_COLOR }, CALIDAD).data)

    const { pila: pilaNdvi } = await conReintentos(() => obtenerMosaico(grupo.escenas, coleccion, ['rojo', 'nir'], rejillaNdvi, true))
    const png = new PNG({ width: LADO_NDVI, height: LADO_NDVI })
    const cache = new Map<string, [number, number, number]>()
    const rojoUrbano: number[] = []
    const nirUrbano: number[] = []
    const ndviUrbano: number[] = []
    for (let i = 0; i < LADO_NDVI * LADO_NDVI; i++) {
      const r = pilaNdvi.bandas.rojo[i]
      const n = pilaNdvi.bandas.nir[i]
      if (!dentroNdvi[i] || !Number.isFinite(r) || !Number.isFinite(n) || n + r <= 0) continue
      const ndvi = (n - r) / (n + r)
      if (urbanaNdvi[i]) {
        rojoUrbano.push(r)
        nirUrbano.push(n)
        ndviUrbano.push(ndvi)
      }
      const color = colorDeIndice(Math.round(ndvi * 200) / 200, p2, p98)
      let rgb = cache.get(color)
      if (!rgb) {
        rgb = aRgb(color)
        cache.set(color, rgb)
      }
      png.data[i * 4] = rgb[0]
      png.data[i * 4 + 1] = rgb[1]
      png.data[i * 4 + 2] = rgb[2]
      png.data[i * 4 + 3] = 255
    }
    await writeFile(rutaNdvi, PNG.sync.write(png, { colorType: 6, deflateLevel: 9 }))

    const redondo = (v: number | null) => (v === null ? null : Number(v.toFixed(4)))
    const pesoColor = (await stat(rutaColor)).size
    const pesoNdvi = (await stat(rutaNdvi)).size
    meses[mes] = {
      dia: grupo.dia,
      nubesArea: Number(nubes.toFixed(1)),
      fuente,
      escenas: grupo.escenas.map((escena) => ({ id: escena.id, lineaBase: escena.lineaBase })),
      urbana: { rojo: redondo(mediana(rojoUrbano)), nir: redondo(mediana(nirUrbano)), ndvi: redondo(mediana(ndviUrbano)) },
      bytes: pesoColor + pesoNdvi,
    }
    const rojoDelMes = redondo(mediana(rojoUrbano))
    const desviacion = rojoDelMes === null ? null : desviacionDelMismoMes(meses, mes, rojoDelMes)
    if (desviacion !== null && Math.abs(desviacion) > CORTE_ALARMA_ROJO) {
      alarmas.push(`${mes} (${grupo.dia}): rojo urbano a ${desviacion.toFixed(3)} de la mediana de su mismo mes`)
    }
    await writeFile(rutaJson, `${JSON.stringify({ limites: [[bbox[1], bbox[0]], [bbox[3], bbox[2]]], escala: { p2, p98, cortes }, meses })}\n`)
    console.log(`${mes}: ${grupo.dia} ${fuente}, nubes ${nubes.toFixed(1)} %, rojo urbano ${redondo(mediana(rojoUrbano))}, ${((pesoColor + pesoNdvi) / 1e6).toFixed(1)} MB, ${((Date.now() - inicio) / 60000).toFixed(1)} min`)
  }
  if (alarmas.length > 0) {
    // Con codigo de error se detiene `npm run desplegar`: el mes hay que verlo antes de publicarlo.
    console.error(`ALARMA, revisar antes de publicar:\n${alarmas.join('\n')}`)
    process.exitCode = 1
    return
  }
  console.log('historia: lista')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
