/**
 * Resumen semanal de obra nueva en la zona urbana.
 *
 * Toma la escena de Sentinel-2 mas reciente con poca nube y la compara contra
 * la mas cercana a un mes antes, con el mismo codigo y los mismos umbrales que
 * usa la app en el modo Obra nueva. Deja un JSON con las cifras y un PNG con
 * las zonas en `semanal/`, que el flujo semanal de GitHub sube al repositorio.
 * El vigia lee ese JSON y lo manda por Telegram: aqui no hay ninguna
 * credencial y el vigia no calcula nada.
 *
 * Uso:
 *   npm run semanal
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import type { FeatureCollection } from 'geojson'
import { bboxDe } from '../src/servicios/geojson'
import { buscarEscenas } from '../src/servicios/stac'
import { ejecutarAnalisis } from '../src/servicios/analisis'
import { pintarResultado } from '../src/servicios/pintura'
import { diasEntre } from '../src/servicios/obranueva'
import { obtenerMosaico } from '../src/servicios/pilas'
import { mascaraDeArea } from '../src/servicios/mascara'
import { rejillaDe } from '../src/servicios/raster'
import { buscarColeccion } from '../src/datos/colecciones'
import type { GrupoDia } from '../src/tipos'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SALIDA = join(RAIZ, 'semanal')
const AREA = { id: 'LIMITE_URBANO', etiqueta: 'Zona urbana' }

/** Los mismos valores con los que abre la app, para que el aviso y la app coincidan. */
const UMBRAL_OBRA = 0.08
const AREA_MINIMA_HA = 1
/** Nubosidad maxima de la escena completa; la mascara SCL limpia lo que quede sobre la ciudad. */
const NUBES_MAX = 15
/** Separacion buscada entre las dos fechas, y cuanto se tolera de mas o de menos. */
const SEPARACION_DIAS = 30
const TOLERANCIA_DIAS = 12
/** A 1024 celdas la zona urbana queda cerca de la resolucion nativa de 10 m. */
const TAMANO = 1024

/** Ancho del PNG que se manda. Telegram lo recomprime; mas grande no se ve mejor. */
const ANCHO_IMAGEN = 1100
const COLOR_OBRA: [number, number, number] = [255, 45, 110]
const COLOR_LIMITE: [number, number, number] = [255, 122, 69]
const COLOR_ARO: [number, number, number] = [255, 214, 10]

/** Digitos de 3 x 5 para numerar los aros: coinciden con la lista del mensaje. */
const DIGITOS: Record<string, string[]> = {
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
}

/**
 * Corte en percentiles 2 y 99.5 dentro del area, como hace cualquier visor
 * para el color verdadero. A 98 la ciudad, que es brillante, se quemaba.
 */
function estiramiento(valores: Float32Array, dentro: Uint8Array): [number, number] {
  const muestra: number[] = []
  for (let i = 0; i < valores.length; i += 7) {
    if (dentro[i] && Number.isFinite(valores[i])) muestra.push(valores[i])
  }
  muestra.sort((a, b) => a - b)
  const en = (fraccion: number) => muestra[Math.floor(muestra.length * fraccion)]
  return [en(0.02) ?? 0, en(0.995) ?? 0.3]
}

/**
 * Imagen para el mensaje: color verdadero de la fecha actual, el limite
 * urbano, la obra nueva encima y aros numerados en las cinco zonas mayores.
 * La capa sola de la app son manchas sobre transparente y en Telegram no se
 * entiende donde caen.
 */
async function componerImagen(
  grupo: GrupoDia,
  coleccion: ReturnType<typeof buscarColeccion>,
  bbox: [number, number, number, number],
  areaGeojson: FeatureCollection,
  obra: { rgba: Uint8ClampedArray; ancho: number; alto: number },
  principales: { lat: number; lon: number }[],
): Promise<PNG> {
  const rejilla = rejillaDe(bbox, obra.ancho, obra.alto)
  const { pila } = await obtenerMosaico(grupo.escenas, coleccion, ['rojo', 'verde', 'azul'], rejilla, false)
  const dentro = mascaraDeArea(rejilla, areaGeojson)
  const canales = (['rojo', 'verde', 'azul'] as const).map((banda) => {
    const valores = pila.bandas[banda]
    const [bajo, alto] = estiramiento(valores, dentro)
    return { valores, bajo, alto }
  })

  // La rejilla tiene celdas en grados; se reescala a la proporcion real del terreno.
  const [oeste, sur, este, norte] = bbox
  const proporcion = ((este - oeste) * Math.cos((((sur + norte) / 2) * Math.PI) / 180)) / (norte - sur)
  const ancho = ANCHO_IMAGEN
  const alto = Math.round(ANCHO_IMAGEN / proporcion)
  const png = new PNG({ width: ancho, height: alto })

  const celda = (x: number, y: number) =>
    Math.min(obra.alto - 1, Math.floor((y / alto) * obra.alto)) * obra.ancho +
    Math.min(obra.ancho - 1, Math.floor((x / ancho) * obra.ancho))

  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const i = celda(x, y)
      const o = (y * ancho + x) * 4
      let rgb: number[]
      if (obra.rgba[i * 4 + 3] > 0) {
        rgb = COLOR_OBRA
      } else {
        rgb = canales.map(({ valores, bajo, alto: tope }) => {
          const v = valores[i]
          if (!Number.isFinite(v)) return 0
          return Math.round(255 * Math.min(1, Math.max(0, (v - bajo) / (tope - bajo))) ** 0.8)
        })
        // Fuera del area se oscurece: el ojo va a la ciudad.
        if (!dentro[i]) rgb = rgb.map((c) => Math.round(c * 0.35))
      }
      png.data[o] = rgb[0]
      png.data[o + 1] = rgb[1]
      png.data[o + 2] = rgb[2]
      png.data[o + 3] = 255
    }
  }

  const pintar = (x: number, y: number, color: number[]) => {
    if (x < 0 || y < 0 || x >= ancho || y >= alto) return
    const o = (y * ancho + x) * 4
    png.data[o] = color[0]
    png.data[o + 1] = color[1]
    png.data[o + 2] = color[2]
  }

  // Limite urbano: celdas dentro con un vecino fuera, engrosado a 2 px.
  for (let y = 1; y < alto - 1; y++) {
    for (let x = 1; x < ancho - 1; x++) {
      if (!dentro[celda(x, y)]) continue
      if (!dentro[celda(x + 1, y)] || !dentro[celda(x - 1, y)] || !dentro[celda(x, y + 1)] || !dentro[celda(x, y - 1)]) {
        pintar(x, y, COLOR_LIMITE)
        pintar(x + 1, y, COLOR_LIMITE)
      }
    }
  }

  principales.forEach((zona, n) => {
    const cx = Math.round(((zona.lon - oeste) / (este - oeste)) * ancho)
    const cy = Math.round(((norte - zona.lat) / (norte - sur)) * alto)
    for (let grado = 0; grado < 360; grado += 0.5) {
      const r = (grado * Math.PI) / 180
      for (let radio = 20; radio <= 23; radio++) {
        pintar(Math.round(cx + radio * Math.cos(r)), Math.round(cy + radio * Math.sin(r)), COLOR_ARO)
      }
    }
    // Numero a la derecha del aro, con escala 4 y fondo negro para leerse sobre cualquier cosa.
    const escala = 4
    const x0 = cx + 27
    const y0 = cy - 10
    for (let y = -2; y < 5 * escala + 2; y++) {
      for (let x = -2; x < 3 * escala + 2; x++) pintar(x0 + x, y0 + y, [0, 0, 0])
    }
    DIGITOS[String(n + 1)].forEach((fila, fy) => {
      ;[...fila].forEach((bit, fx) => {
        if (bit !== '1') return
        for (let dy = 0; dy < escala; dy++) {
          for (let dx = 0; dx < escala; dx++) pintar(x0 + fx * escala + dx, y0 + fy * escala + dy, COLOR_ARO)
        }
      })
    })
  })

  return png
}

function diaLeon(fecha: Date): string {
  return fecha.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
}

function restarDias(dia: string, dias: number): string {
  const fecha = new Date(`${dia}T12:00:00Z`)
  fecha.setUTCDate(fecha.getUTCDate() - dias)
  return fecha.toISOString().slice(0, 10)
}

async function main() {
  const coleccion = buscarColeccion('sentinel-2-c1-l2a')
  const texto = await readFile(join(RAIZ, 'public', 'capas', `${AREA.id}.geojson`), 'utf-8')
  const areaGeojson = JSON.parse(texto) as FeatureCollection
  const bbox = bboxDe(areaGeojson)

  const hoy = diaLeon(new Date())
  const { grupos } = await buscarEscenas({
    coleccion,
    bbox,
    desde: restarDias(hoy, SEPARACION_DIAS + TOLERANCIA_DIAS + 21),
    hasta: hoy,
    nubesMax: NUBES_MAX,
    limite: 100,
  })
  if (grupos.length < 2) throw new Error(`Solo ${grupos.length} fechas con menos de ${NUBES_MAX} % de nubes`)

  // Mas reciente primero. La base es la fecha mas cercana a un mes antes.
  const actual = grupos[0]
  const objetivo = restarDias(actual.dia, SEPARACION_DIAS)
  const candidatas = grupos.filter(
    (g) => Math.abs(diasEntre(objetivo, g.dia)) <= TOLERANCIA_DIAS && g.dia !== actual.dia,
  )
  if (candidatas.length === 0) throw new Error(`No hay fecha base limpia cerca de ${objetivo}`)
  const base: GrupoDia = candidatas.reduce((mejor, g) =>
    Math.abs(diasEntre(objetivo, g.dia)) < Math.abs(diasEntre(objetivo, mejor.dia)) ? g : mejor,
  )

  const inicio = Date.now()
  const resultado = await ejecutarAnalisis({
    escenas: actual.escenas,
    escenasReferencia: base.escenas,
    coleccion,
    bbox,
    areaGeojson,
    etiquetaArea: AREA.etiqueta,
    modo: 'obra',
    indice: null,
    bandasKmeans: [],
    k: 4,
    tamano: TAMANO,
    umbralCambio: 0.1,
    umbralObra: UMBRAL_OBRA,
    areaMinimaObra: AREA_MINIMA_HA,
    quitarNubes: true,
    soloAgua: false,
    umbralAguaDb: -16,
  })
  const pintado = pintarResultado(resultado)
  const zonas = [...(resultado.zonasObra ?? [])].sort((a, b) => b.hectareas - a.hectareas)

  const png = await componerImagen(actual, coleccion, bbox, areaGeojson, pintado, zonas.slice(0, 5))
  await mkdir(SALIDA, { recursive: true })
  await writeFile(join(SALIDA, 'obra-nueva-urbana.png'), PNG.sync.write(png))
  const hectareas = zonas.reduce((suma, z) => suma + z.hectareas, 0)
  const redondear = (valor: number, decimales: number) => Number(valor.toFixed(decimales))

  const salida = {
    producto: 'obra-nueva',
    area: AREA,
    generado: new Date().toISOString(),
    coleccion: coleccion.etiqueta,
    fechaActual: actual.dia,
    fechaBase: base.dia,
    separacionDias: diasEntre(base.dia, actual.dia),
    nubesActual: actual.nubes,
    nubesBase: base.nubes,
    mallas: actual.escenas.map((e) => e.malla),
    parametros: { umbralNdbi: UMBRAL_OBRA, areaMinimaHa: AREA_MINIMA_HA, rejilla: TAMANO },
    zonas: zonas.length,
    hectareas: redondear(hectareas, 1),
    principales: zonas.slice(0, 5).map((z) => ({
      hectareas: redondear(z.hectareas, 1),
      lat: redondear(z.lat, 5),
      lon: redondear(z.lon, 5),
    })),
    limites: pintado.limites,
    imagen: 'obra-nueva-urbana.png',
    notas: resultado.notas,
  }
  await writeFile(join(SALIDA, 'obra-nueva-urbana.json'), `${JSON.stringify(salida, null, 2)}\n`)

  console.log(
    `obra nueva ${actual.dia} contra ${base.dia} (${salida.separacionDias} dias): ` +
      `${salida.zonas} zonas, ${salida.hectareas} ha, en ${((Date.now() - inicio) / 1000).toFixed(1)} s`,
  )
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
