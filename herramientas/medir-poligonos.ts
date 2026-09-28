/**
 * Mide un conjunto de poligonos y deja una tabla con una fila por poligono.
 *
 * Es la salida que le faltaba a la plataforma: hasta ahora todo lo calculado
 * vivia en la pantalla, asi que ninguna cifra podia entrar a un modelo, a una
 * ficha de piloto ni a otra app. Aqui el mismo codigo de la app corre fuera del
 * navegador sobre muchos poligonos y escribe JSON y CSV.
 *
 * Autorizado por Carlos el 28 de septiembre de 2026 (dictamen del reparto de la
 * Linea A, funcion H1).
 *
 * Reglas que vienen del dictamen y no se negocian aqui:
 *   - Cada fila lleva el identificador del poligono TAL COMO VIENE en la capa
 *     de origen. Esta herramienta no inventa identificadores ni los renombra.
 *   - Cada fila lleva `version_marco`, que se pasa por linea de comandos. Sin
 *     saber con que division se calculo, la cifra no se puede cruzar con nada.
 *   - Todas las fechas son dias de Leon, como en el resto de la plataforma.
 *
 * Uso:
 *   npm run medir -- --capa public/capas/LIMITE_URBANO.geojson --id HAS \
 *     --modo cobertura --version-marco urbano-v1
 *
 *   npm run medir -- --capa ruta/subcuencas.geojson --id id_subcuenca \
 *     --modo obra --desde 2026-06-01 --hasta 2026-09-28 --version-marco cauce-v1
 *
 * Modos: cobertura, obra, calor, indice.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Feature, FeatureCollection } from 'geojson'
import { bboxDe } from '../src/servicios/geojson'
import { buscarEscenas } from '../src/servicios/stac'
import { ejecutarAnalisis } from '../src/servicios/analisis'
import { cargarProducto, PRODUCTOS, CLASES_COBERTURA } from '../src/servicios/productos'
import { diasEntre } from '../src/servicios/obranueva'
import { metrosDeCelda, rejillaDe } from '../src/servicios/raster'
import { mascaraDeArea } from '../src/servicios/mascara'
import { buscarColeccion } from '../src/datos/colecciones'
import { INDICES } from '../src/servicios/indices'
import type { Escena, GrupoDia } from '../src/tipos'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SALIDA = join(RAIZ, 'salidas')

type Modo = 'cobertura' | 'obra' | 'calor' | 'indice'

interface Opciones {
  capa: string
  id: string | null
  versionMarco: string
  modo: Modo
  desde: string
  hasta: string
  indice: string
  tamano: number
  nubesMax: number
  salida: string | null
}

function leerOpciones(): Opciones {
  const args = process.argv.slice(2)
  const valor = (nombre: string): string | null => {
    const i = args.indexOf(`--${nombre}`)
    return i >= 0 && args[i + 1] ? args[i + 1] : null
  }
  const capa = valor('capa')
  if (!capa) throw new Error('Falta --capa con la ruta del GeoJSON de poligonos')

  const modo = (valor('modo') ?? 'cobertura') as Modo
  if (!['cobertura', 'obra', 'calor', 'indice'].includes(modo)) {
    throw new Error(`Modo desconocido: ${modo}`)
  }

  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
  const haceTresMeses = new Date(Date.now() - 92 * 86_400_000).toLocaleDateString('en-CA', {
    timeZone: 'America/Mexico_City',
  })

  return {
    capa,
    id: valor('id'),
    versionMarco: valor('version-marco') ?? 'sin-declarar',
    modo,
    desde: valor('desde') ?? haceTresMeses,
    hasta: valor('hasta') ?? hoy,
    indice: valor('indice') ?? 'ndvi',
    tamano: Number(valor('tamano') ?? 512),
    nubesMax: Number(valor('nubes') ?? 20),
    salida: valor('salida'),
  }
}

/** El identificador sale de la capa; si no hay propiedad, se usa la posicion. */
function identificador(rasgo: Feature, campo: string | null, posicion: number): string {
  if (campo && rasgo.properties && rasgo.properties[campo] !== undefined) {
    return String(rasgo.properties[campo])
  }
  return `rasgo-${posicion + 1}`
}

function unSoloRasgo(rasgo: Feature): FeatureCollection {
  return { type: 'FeatureCollection', features: [rasgo] }
}

const redondear = (valor: number, decimales = 1) => Number(valor.toFixed(decimales))

/** Hectareas que representa cada celda de la rejilla, igual que en la app. */
function hectareasPorCelda(bbox: [number, number, number, number], tamano: number): number {
  const celda = metrosDeCelda(rejillaDe(bbox, tamano, tamano))
  return (celda.ancho * celda.alto) / 10_000
}

/** Promedio de una banda solo dentro del poligono, saltando celdas sin dato. */
function promedioDentro(banda: Float32Array, dentro: Uint8Array): number | null {
  let suma = 0
  let cuenta = 0
  for (let i = 0; i < banda.length; i++) {
    if (!dentro[i]) continue
    const v = banda[i]
    if (!Number.isFinite(v)) continue
    suma += v
    cuenta++
  }
  return cuenta > 0 ? suma / cuenta : null
}

async function esperar(ms: number) {
  await new Promise((seguir) => setTimeout(seguir, ms))
}

/**
 * Las escenas se buscan UNA vez para toda la capa, no por poligono.
 *
 * Asi todos los poligonos quedan medidos con la misma fecha, que es lo unico
 * que permite comparar filas entre si. Buscar por poligono daria a cada uno la
 * escena que mejor le venga y la tabla dejaria de ser comparable.
 */
async function escenasDeLaCapa(opciones: Opciones, bbox: [number, number, number, number]) {
  const coleccion = buscarColeccion(opciones.modo === 'calor' ? 'landsat-c2-l2' : 'sentinel-2-c1-l2a')
  const { grupos } = await buscarEscenas({
    coleccion,
    bbox,
    desde: opciones.desde,
    hasta: opciones.hasta,
    nubesMax: opciones.nubesMax,
    limite: 100,
  })
  if (grupos.length === 0) throw new Error('El catalogo no devolvio escenas para ese periodo')

  const actual = grupos[0]
  let base: GrupoDia | null = null

  if (opciones.modo === 'obra') {
    // La fecha base se busca cerca de un mes antes, como en el resumen semanal.
    const candidatas = grupos.filter((g) => g.dia !== actual.dia && diasEntre(g.dia, actual.dia) >= 18)
    if (candidatas.length === 0) throw new Error('No hay fecha base con separacion suficiente')
    base = candidatas.reduce((mejor, g) =>
      Math.abs(diasEntre(g.dia, actual.dia) - 30) < Math.abs(diasEntre(mejor.dia, actual.dia) - 30)
        ? g
        : mejor,
    )
  }

  return { coleccion, actual, base }
}

async function main() {
  const opciones = leerOpciones()
  const texto = await readFile(resolve(RAIZ, opciones.capa), 'utf-8')
  const capa = JSON.parse(texto) as FeatureCollection
  const rasgos = capa.features ?? []
  if (rasgos.length === 0) throw new Error('La capa no trae ningun rasgo')

  console.log(`${rasgos.length} poligonos, modo ${opciones.modo}, marco ${opciones.versionMarco}`)

  const bboxCapa = bboxDe(capa)
  const escenas =
    opciones.modo === 'cobertura' ? null : await escenasDeLaCapa(opciones, bboxCapa)
  if (escenas) {
    console.log(
      `escena ${escenas.actual.dia}${escenas.base ? ` contra ${escenas.base.dia}` : ''} ` +
        `(${escenas.coleccion.etiqueta})`,
    )
  }

  const definicionIndice = INDICES.find((i) => i.id === opciones.indice) ?? null
  const filas: Record<string, string | number | null>[] = []
  const notasPorFila: Record<string, string[]> = {}

  for (const [posicion, rasgo] of rasgos.entries()) {
    const id = identificador(rasgo, opciones.id, posicion)
    const soloEste = unSoloRasgo(rasgo)
    const bbox = bboxDe(soloEste)
    const haCelda = hectareasPorCelda(bbox, opciones.tamano)
    const inicio = Date.now()

    const comun = {
      id,
      version_marco: opciones.versionMarco,
      modo: opciones.modo,
      rejilla: opciones.tamano,
    }

    if (opciones.modo === 'cobertura') {
      const producto = PRODUCTOS.find((p) => p.id === 'cobertura')!
      const resultado = await cargarProducto({
        producto,
        bbox,
        areaGeojson: soloEste,
        etiquetaArea: id,
        tamano: opciones.tamano,
      })
      const dentro = mascaraDeArea(resultado.rejilla, soloEste)
      const clases = resultado.bandas[0]
      const conteo = new Map<number, number>()
      let dentroTotal = 0
      for (let i = 0; i < clases.length; i++) {
        if (!dentro[i]) continue
        dentroTotal++
        const clase = clases[i]
        if (!Number.isFinite(clase)) continue
        conteo.set(clase, (conteo.get(clase) ?? 0) + 1)
      }
      const fila: Record<string, string | number | null> = {
        ...comun,
        area_ha: redondear(dentroTotal * haCelda),
      }
      for (const [clase, celdas] of [...conteo.entries()].sort((a, b) => b[1] - a[1])) {
        const nombre = CLASES_COBERTURA[clase]?.nombre ?? `clase_${clase}`
        fila[`ha_${nombre.toLowerCase().replace(/\s+/g, '_')}`] = redondear(celdas * haCelda)
      }
      filas.push(fila)
      notasPorFila[id] = resultado.notas
    } else {
      const { coleccion, actual, base } = escenas!
      const resultado = await ejecutarAnalisis({
        escenas: actual.escenas as Escena[],
        escenasReferencia: (base?.escenas ?? []) as Escena[],
        coleccion,
        bbox,
        areaGeojson: soloEste,
        etiquetaArea: id,
        modo: opciones.modo === 'obra' ? 'obra' : opciones.modo === 'calor' ? 'calor' : 'indice',
        indice: definicionIndice,
        bandasKmeans: [],
        k: 4,
        tamano: opciones.tamano,
        umbralCambio: 0.1,
        umbralObra: 0.08,
        areaMinimaObra: 1,
        quitarNubes: true,
        soloAgua: false,
        umbralAguaDb: -16,
      })

      const dentro = mascaraDeArea(resultado.rejilla, soloEste)
      let dentroTotal = 0
      for (const marca of dentro) dentroTotal += marca

      const fila: Record<string, string | number | null> = {
        ...comun,
        fecha_escena: actual.dia,
        nubes_escena_pct: actual.nubes === null ? null : redondear(actual.nubes),
        area_ha: redondear(dentroTotal * haCelda),
      }

      if (opciones.modo === 'obra') {
        const zonas = resultado.zonasObra ?? []
        fila.fecha_base = base!.dia
        fila.separacion_dias = diasEntre(base!.dia, actual.dia)
        fila.zonas_obra = zonas.length
        fila.obra_ha = redondear(zonas.reduce((suma, z) => suma + z.hectareas, 0))
        fila.obra_mayor_ha = redondear(zonas.reduce((mayor, z) => Math.max(mayor, z.hectareas), 0))
      } else if (opciones.modo === 'calor') {
        const media = promedioDentro(resultado.bandas[0], dentro)
        fila.temperatura_media_c = media === null ? null : redondear(media)
      } else {
        fila.indice = definicionIndice?.id ?? opciones.indice
        const media = promedioDentro(resultado.bandas[0], dentro)
        fila.indice_medio = media === null ? null : redondear(media, 3)
      }

      filas.push(fila)
      notasPorFila[id] = resultado.notas
    }

    console.log(`  ${id}: ${((Date.now() - inicio) / 1000).toFixed(1)} s`)
    // Pausa corta: Planetary Computer responde 429 si se le pide seguido.
    await esperar(800)
  }

  const nombre =
    opciones.salida ??
    `medidas-${opciones.modo}-${opciones.versionMarco}-${new Date().toISOString().slice(0, 10)}`
  await mkdir(SALIDA, { recursive: true })

  const columnas = [...new Set(filas.flatMap((f) => Object.keys(f)))]
  const csv = [
    columnas.join(','),
    ...filas.map((f) => columnas.map((c) => (f[c] === undefined || f[c] === null ? '' : f[c])).join(',')),
  ].join('\n')
  await writeFile(join(SALIDA, `${nombre}.csv`), `${csv}\n`, 'utf-8')

  await writeFile(
    join(SALIDA, `${nombre}.json`),
    `${JSON.stringify(
      {
        generado: new Date().toISOString(),
        capa: opciones.capa,
        campo_id: opciones.id,
        version_marco: opciones.versionMarco,
        modo: opciones.modo,
        periodo: { desde: opciones.desde, hasta: opciones.hasta },
        rejilla: opciones.tamano,
        escena: escenas ? { actual: escenas.actual.dia, base: escenas.base?.dia ?? null } : null,
        filas,
        notas: notasPorFila,
      },
      null,
      2,
    )}\n`,
    'utf-8',
  )

  console.log(`listo: salidas/${nombre}.csv y .json (${filas.length} filas)`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
