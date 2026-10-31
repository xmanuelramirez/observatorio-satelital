/**
 * Lo que la app muestra sin calcular nada en el navegador.
 *
 * Por cada area deja en `public/apertura/<AREA>/` un fondo de color y una imagen
 * por modo con la ultima escena, y en `public/apertura/apertura.json` la leyenda,
 * las notas, las fechas de la regla y la serie de NDVI. Asi cambiar de area o de
 * modo es inmediato; en vivo solo se calcula con otra fecha o con otros ajustes.
 *
 * Corre el mismo codigo que la app, con las mismas reglas: Obra nueva sale sin
 * cifra y sin zonas fuera de julio a octubre (dictamen del juez del 30/10/2026).
 * No se versiona: pesa decenas de MB y cambia con cada escena. Lo genera
 * `npm run desplegar`, asi que la plataforma queda al dia del ultimo despliegue.
 *
 * Uso:
 *   npm run apertura
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import type { FeatureCollection } from 'geojson'
import { bboxDe } from '../src/servicios/geojson'
import { buscarEscenas } from '../src/servicios/stac'
import { bandasDelAgua, ejecutarAnalisis, type ParametrosAnalisis } from '../src/servicios/analisis'
import { pintarResultado, type ResultadoPintado } from '../src/servicios/pintura'
import { obtenerMosaico } from '../src/servicios/pilas'
import { rejillaDe } from '../src/servicios/raster'
import { INDICES, indicesDisponibles } from '../src/servicios/indices'
import { calcularSerie } from '../src/servicios/serie'
import { avisoFenologia, diasEntre } from '../src/servicios/obranueva'
import { fechasCompletas } from '../src/lib/cobertura'
import { diaLocal } from '../src/lib/fecha'
import { buscarColeccion } from '../src/datos/colecciones'
import type { Bbox, Coleccion, GrupoDia, IdCapa, ModoVista, NombreBanda } from '../src/tipos'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SALIDA = join(RAIZ, 'public', 'apertura')

/**
 * El fondo es mayor que el area a proposito: el mapa cambia de proporcion con la
 * ventana y con los paneles, y debe quedar cubierto en todos los casos. El
 * municipio pide menos holgura porque ya llena el alto.
 */
const AREAS: { id: IdCapa; nombre: string; holgura: number }[] = [
  { id: 'LIMITE_URBANO', nombre: 'Zona urbana', holgura: 2.4 },
  { id: 'LIMITE', nombre: 'Municipio', holgura: 1.8 },
  { id: 'CUENCA_PALOTE', nombre: 'Cuenca Palote', holgura: 2.8 },
]
const PROPORCION_FONDO = 2.8
const CORRIMIENTO_ESTE = 0.1
const ANCHO_FONDO = 3000
const CALIDAD_FONDO = 80
/** Fechas vecinas que se pueden usar para rellenar lo que la escena principal no cubre. */
const MAX_FECHAS_FONDO = 8

const TAMANO_MODO = 768
/** La rejilla del resumen semanal, que es la que valido el juez. */
const TAMANO_OBRA = 1024
const DIAS_DE_BUSQUEDA = 120
const NUBES_LISTA = 20
/** La escena se elige limpia: con nubes el mapa queda con huecos, aunque el mosaico cumpla. */
const NUBES_ESCENA = [5, 15]
const SEPARACION_DIAS = 30

function haceDias(dias: number): string {
  return diaLocal(Date.now() - dias * 86_400_000)
}

/** La red al catalogo falla de vez en cuando; un error suelto no debe tirar la corrida. */
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

function encuadreFondo(bbox: Bbox, holgura: number): Bbox {
  const [oeste, sur, este, norte] = bbox
  const cy = (sur + norte) / 2
  const alto = (norte - sur) * holgura
  const ancho = (alto * PROPORCION_FONDO) / Math.cos((cy * Math.PI) / 180)
  // Corrido al oriente: la tarjeta de resultado empuja el area a la izquierda del mapa.
  const cx = (oeste + este) / 2 + ancho * CORRIMIENTO_ESTE
  return [cx - ancho / 2, cy - alto / 2, cx + ancho / 2, cy + alto / 2]
}

/** Corte en percentiles sobre toda la imagen: la zona rural sale legible. Solo es presentacion. */
function estiramiento(valores: Float32Array): [number, number] {
  const muestra: number[] = []
  for (let i = 0; i < valores.length; i += 7) {
    if (Number.isFinite(valores[i]) && valores[i] > 0) muestra.push(valores[i])
  }
  muestra.sort((a, b) => a - b)
  const en = (fraccion: number) => muestra[Math.floor(muestra.length * fraccion)]
  return [en(0.01) ?? 0, en(0.995) ?? 0.3]
}

/**
 * Color verdadero con la escena principal y, donde le falte dato, fechas vecinas.
 * Sin relleno quedaba un rectangulo negro: la malla no llega al borde del mapa.
 */
async function fondoDe(diaPrincipal: string, limites: Bbox, ancho: number, alto: number) {
  const coleccion = buscarColeccion('sentinel-2-c1-l2a')
  const { grupos } = await conReintentos(() =>
    buscarEscenas({ coleccion, bbox: limites, desde: haceDias(DIAS_DE_BUSQUEDA), hasta: diaLocal(new Date()), nubesMax: 30, limite: 100 }),
  )
  const orden = [...grupos].sort((a, b) => {
    if (a.dia === diaPrincipal) return -1
    if (b.dia === diaPrincipal) return 1
    return Math.abs(diasEntre(a.dia, diaPrincipal)) - Math.abs(diasEntre(b.dia, diaPrincipal))
  })

  const rejilla = rejillaDe(limites, ancho, alto)
  const total = ancho * alto
  const canales = (['rojo', 'verde', 'azul'] as const).map(() => new Float32Array(total).fill(Number.NaN))
  const usadas: string[] = []
  let faltan = total

  for (const grupo of orden.slice(0, MAX_FECHAS_FONDO)) {
    if (faltan / total < 0.001) break
    const { pila } = await conReintentos(() => obtenerMosaico(grupo.escenas, coleccion, ['rojo', 'verde', 'azul'], rejilla, false))
    let aporto = false
    const r = pila.bandas.rojo
    for (let i = 0; i < total; i++) {
      if (Number.isFinite(canales[0][i]) || !Number.isFinite(r[i]) || r[i] <= 0) continue
      canales[0][i] = r[i]
      canales[1][i] = pila.bandas.verde[i]
      canales[2][i] = pila.bandas.azul[i]
      faltan--
      aporto = true
    }
    if (aporto) usadas.push(grupo.dia)
  }

  const cortes = canales.map(estiramiento)
  const rgba = new Uint8Array(total * 4)
  for (let i = 0; i < total; i++) {
    for (let c = 0; c < 3; c++) {
      const [bajo, tope] = cortes[c]
      const v = canales[c][i]
      const claro = Number.isFinite(v) ? Math.min(1, Math.max(0, (v - bajo) / (tope - bajo))) ** 0.7 : 0
      rgba[i * 4 + c] = Math.round(255 * claro)
    }
    rgba[i * 4 + 3] = 255
  }
  return { rgba, usadas, sinDato: faltan / total }
}

function hayPintura(pintado: ResultadoPintado): boolean {
  for (let i = 3; i < pintado.rgba.length; i += 4) if (pintado.rgba[i] > 0) return true
  return false
}

function comoPng(pintado: ResultadoPintado): Buffer {
  const png = new PNG({ width: pintado.ancho, height: pintado.alto })
  png.data = Buffer.from(pintado.rgba)
  return PNG.sync.write(png, { colorType: 6, deflateLevel: 9 })
}

/** La mas reciente con pocas nubes y, si el modo compara, la mas cercana a un mes antes. */
function parDe(grupos: GrupoDia[], bbox: Bbox, nubesEscena: number[]) {
  const completas = fechasCompletas(grupos, bbox)
  const tope = nubesEscena.find((nubes) => completas.some((g) => g.nubes !== null && g.nubes <= nubes))
  const limpias = tope === undefined ? completas : completas.filter((g) => g.nubes === null || g.nubes <= tope)
  const orden = [...limpias].sort((a, b) => b.dia.localeCompare(a.dia))
  const actual = orden[0]
  if (!actual) return null
  const distancia = (g: GrupoDia) => Math.abs(diasEntre(g.dia, actual.dia) - SEPARACION_DIAS)
  const base = orden.filter((g) => g.dia < actual.dia).reduce<GrupoDia | null>((mejor, g) => (!mejor || distancia(g) < distancia(mejor) ? g : mejor), null)
  return { actual, base }
}

async function main() {
  await mkdir(SALIDA, { recursive: true })
  const areas: Record<string, unknown> = {}
  const faltantes: string[] = []

  for (const area of AREAS) {
    const carpeta = join(SALIDA, area.id)
    await mkdir(carpeta, { recursive: true })
    const areaGeojson = JSON.parse(await readFile(join(RAIZ, 'public', 'capas', `${area.id}.geojson`), 'utf-8')) as FeatureCollection
    const bbox = bboxDe(areaGeojson)
    const desde = haceDias(DIAS_DE_BUSQUEDA)
    const hasta = diaLocal(new Date())

    const buscar = (id: string, nubesMax: number, dias = DIAS_DE_BUSQUEDA) => {
      const coleccion = buscarColeccion(id)
      return conReintentos(() => buscarEscenas({ coleccion, bbox, desde: dias === DIAS_DE_BUSQUEDA ? desde : haceDias(dias), hasta, nubesMax, limite: 100 })).then(({ grupos }) => ({ coleccion, grupos }))
    }

    const s2 = await buscar('sentinel-2-c1-l2a', NUBES_LISTA)
    const parS2 = parDe(s2.grupos, bbox, NUBES_ESCENA)
    if (!parS2) throw new Error(`${area.nombre}: sin escenas de Sentinel-2`)

    const limitesFondo = encuadreFondo(bbox, area.holgura)
    const altoFondo = Math.round(ANCHO_FONDO / PROPORCION_FONDO)
    const fondo = await fondoDe(parS2.actual.dia, limitesFondo, ANCHO_FONDO, altoFondo)
    await writeFile(join(carpeta, 'fondo.jpg'), jpeg.encode({ data: fondo.rgba, width: ANCHO_FONDO, height: altoFondo }, CALIDAD_FONDO).data)
    console.log(`${area.nombre}: fondo ${fondo.usadas.join(', ')}, sin dato ${(fondo.sinDato * 100).toFixed(2)} %`)

    const parametros = (modo: ModoVista, coleccion: Coleccion, tamano: number): ParametrosAnalisis => {
      const bandas = Object.keys(coleccion.bandas) as NombreBanda[]
      return {
        escenas: parS2.actual.escenas,
        escenasReferencia: parS2.base?.escenas ?? [],
        coleccion,
        bbox,
        areaGeojson,
        etiquetaArea: area.nombre,
        modo,
        indice: indicesDisponibles(bandas)[0] ?? INDICES[0],
        bandasKmeans: bandas.slice(0, Math.min(4, bandas.length)),
        k: 5,
        tamano,
        umbralCambio: 0.1,
        umbralObra: 0.08,
        areaMinimaObra: 1,
        quitarNubes: true,
        soloAgua: false,
        umbralAguaDb: -17,
      }
    }

    const modos: Record<string, unknown> = {
      color: {
        dia: parS2.actual.dia,
        diaBase: null,
        coleccion: s2.coleccion.etiqueta,
        imagen: false,
        limites: null,
        leyenda: [],
        aviso: null,
        notas: [
          `Color verdadero de ${s2.coleccion.etiqueta} del ${parS2.actual.dia}. El brillo está ajustado solo para presentación: es la imagen de fondo, no un dato medido.`,
          ...(fondo.usadas.length > 1
            ? [`Donde esa escena no tiene dato, la imagen se completa con ${fondo.usadas.slice(1).join(', ')}.`]
            : []),
        ],
      },
    }

    const guardar = async (clave: string, dia: string, diaBase: string | null, coleccion: Coleccion, cambios: Partial<ParametrosAnalisis>, modo: ModoVista, tamano = TAMANO_MODO) => {
      try {
        const resultado = await conReintentos(() => ejecutarAnalisis({ ...parametros(modo, coleccion, tamano), ...cambios }))
        const pintado = pintarResultado(resultado)
        const imagen = hayPintura(pintado)
        if (imagen) await writeFile(join(carpeta, `${clave}.png`), comoPng(pintado))
        modos[clave] = {
          dia,
          diaBase,
          coleccion: coleccion.etiqueta,
          imagen,
          limites: pintado.limites,
          leyenda: pintado.leyenda,
          aviso: pintado.aviso ?? (modo === 'cambio' && pintado.fenologia ? avisoFenologia(pintado.fenologia) : null),
          notas: pintado.notas,
        }
        console.log(`${area.nombre}: ${clave} ${dia}${diaBase ? ` contra ${diaBase}` : ''}`)
      } catch (error) {
        faltantes.push(`${area.nombre}/${clave}`)
        console.warn(`${area.nombre}: sin ${clave}:`, error)
      }
    }

    const dia = parS2.actual.dia
    const diaBase = parS2.base?.dia ?? null
    const indicesS2 = indicesDisponibles(Object.keys(s2.coleccion.bandas) as NombreBanda[])
    for (const indice of indicesS2) {
      await guardar(`indice-${indice.id}`, dia, null, s2.coleccion, { indice, escenasReferencia: [] }, 'indice')
    }
    await guardar('clases', dia, null, s2.coleccion, { escenasReferencia: [] }, 'clases')
    if (parS2.base) {
      await guardar('cambio', dia, diaBase, s2.coleccion, { indice: indicesS2.find((i) => i.id === 'ndvi') ?? indicesS2[0] }, 'cambio')
      await guardar('obra', dia, diaBase, s2.coleccion, {}, 'obra', TAMANO_OBRA)
    }

    const landsat = await buscar('landsat-c2-l2', 20, 90)
    const parLandsat = parDe(landsat.grupos, bbox, [])
    if (parLandsat) {
      await guardar('calor', parLandsat.actual.dia, null, landsat.coleccion, { escenas: parLandsat.actual.escenas, escenasReferencia: [] }, 'calor')
    } else {
      faltantes.push(`${area.nombre}/calor`)
    }

    const radar = await buscar('sentinel-1-rtc', 100, 60)
    const gruposRadar = fechasCompletas(radar.grupos, bbox)
    const parRadar = parDe(gruposRadar, bbox, [])
    if (parRadar) {
      await guardar('agua', parRadar.actual.dia, parRadar.base?.dia ?? null, radar.coleccion, { escenas: parRadar.actual.escenas, escenasReferencia: parRadar.base?.escenas ?? [] }, 'agua')
    } else {
      faltantes.push(`${area.nombre}/agua`)
    }

    let serie: unknown = null
    try {
      const ndvi = indicesS2.find((i) => i.id === 'ndvi')!
      serie = await conReintentos(() =>
        calcularSerie({
          grupos: s2.grupos,
          coleccion: s2.coleccion,
          indice: ndvi,
          bbox,
          areaGeojson,
          quitarNubes: true,
          soloAgua: false,
          bandasAgua: bandasDelAgua(s2.coleccion),
          tamano: 128,
          maxFechas: 12,
          coberturaMinima: 0.3,
        }),
      )
      console.log(`${area.nombre}: serie de NDVI`)
    } catch (error) {
      faltantes.push(`${area.nombre}/serie`)
      console.warn(`${area.nombre}: sin serie:`, error)
    }

    const fechas = (grupos: GrupoDia[]) => grupos.map((g) => ({ dia: g.dia, nubes: g.nubes }))
    const [oeste, sur, este, norte] = limitesFondo
    areas[area.id] = {
      nombre: area.nombre,
      limitesFondo: [[sur, oeste], [norte, este]],
      diaFondo: parS2.actual.dia,
      fechas: {
        [s2.coleccion.id]: fechas(s2.grupos),
        [landsat.coleccion.id]: fechas(landsat.grupos),
        [radar.coleccion.id]: fechas(gruposRadar),
      },
      modos,
      serie,
    }

    // Se escribe en cada area: una corrida que se cae a medias deja lo ya calculado.
    await writeFile(join(SALIDA, 'apertura.json'), `${JSON.stringify({ generado: new Date().toISOString(), areas })}\n`)
  }

  if (faltantes.length > 0) console.warn(`apertura: faltan ${faltantes.join(', ')}; la app los calcula en vivo.`)
  console.log('apertura: lista')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
