/**
 * Precalcula las capas de referencia para cada area de interes.
 *
 * Son productos estaticos (WorldCover 2021, JRC 1984 a 2021, MODIS anual) y
 * las areas tambien son fijas, asi que no tiene sentido que cada visitante los
 * baje y los recorte en su navegador: tardaba casi nueve segundos por capa.
 * Aqui se calculan una vez con exactamente el mismo codigo que usa la app,
 * y se dejan como imagen mas un JSON con la leyenda y las notas. La app solo
 * los pinta.
 *
 * Uso:
 *   npm run precalcular
 *
 * Correrlo otra vez cuando cambie un poligono de area o cada que MODIS
 * publique un anio nuevo. La salida va versionada en public/precalculado.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import type { FeatureCollection } from 'geojson'
import { bboxDe } from '../src/servicios/geojson'
import { cargarProducto, PRODUCTOS, type IdProducto } from '../src/servicios/productos'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SALIDA = join(RAIZ, 'public', 'precalculado')

/** Las mismas tres areas publicas que ofrece la app. */
const AREAS = [
  { id: 'LIMITE', etiqueta: 'Límite municipal' },
  { id: 'LIMITE_URBANO', etiqueta: 'Límite urbano' },
  { id: 'CUENCA_PALOTE', etiqueta: 'Cuenca Palote' },
]

/**
 * Rejilla por producto. Como se calcula una sola vez, se puede ir fino donde
 * la resolucion nativa lo justifica; MODIS es de 500 m y afinar solo
 * inventaria detalle que el producto no tiene.
 */
const TAMANO: Record<IdProducto, number> = {
  'agua-historica': 1024,
  cobertura: 1024,
  evapotranspiracion: 256,
}

function aRgb(color: string): [number, number, number] {
  const directo = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(color)
  if (directo) return [Number(directo[1]), Number(directo[2]), Number(directo[3])]

  if (/^#[0-9a-f]{6}$/i.test(color)) {
    return [
      parseInt(color.slice(1, 3), 16),
      parseInt(color.slice(3, 5), 16),
      parseInt(color.slice(5, 7), 16),
    ]
  }

  throw new Error(`Color que el precalculo no sabe traducir: ${color}`)
}

async function esperar(ms: number) {
  await new Promise((seguir) => setTimeout(seguir, ms))
}

async function main() {
  const indice: Record<string, Record<string, string>> = {}

  for (const area of AREAS) {
    const texto = await readFile(join(RAIZ, 'public', 'capas', `${area.id}.geojson`), 'utf-8')
    const areaGeojson = JSON.parse(texto) as FeatureCollection
    const bbox = bboxDe(areaGeojson)

    for (const producto of PRODUCTOS) {
      const inicio = Date.now()
      const tamano = TAMANO[producto.id]

      const resultado = await cargarProducto({
        producto,
        bbox,
        areaGeojson,
        etiquetaArea: area.etiqueta,
        tamano,
      })

      const { rejilla, bandas, colorear } = resultado
      const png = new PNG({ width: rejilla.ancho, height: rejilla.alto })
      const valores = new Array<number>(bandas.length)

      for (let i = 0; i < rejilla.ancho * rejilla.alto; i++) {
        for (let b = 0; b < bandas.length; b++) valores[b] = bandas[b][i]
        const color = colorear(valores)
        const k = i * 4
        if (!color) {
          png.data[k + 3] = 0
          continue
        }
        const [r, g, bl] = aRgb(color)
        png.data[k] = r
        png.data[k + 1] = g
        png.data[k + 2] = bl
        png.data[k + 3] = 255
      }

      const carpeta = join(SALIDA, area.id)
      await mkdir(carpeta, { recursive: true })

      const buffer = PNG.sync.write(png, { colorType: 6 })
      await writeFile(join(carpeta, `${producto.id}.png`), buffer)

      const este = rejilla.xmin + rejilla.ancho * rejilla.pixelAncho
      const sur = rejilla.ymax - rejilla.alto * rejilla.pixelAlto

      await writeFile(
        join(carpeta, `${producto.id}.json`),
        JSON.stringify(
          {
            producto: producto.id,
            area: area.id,
            limites: [
              [sur, rejilla.xmin],
              [rejilla.ymax, este],
            ],
            leyenda: resultado.leyenda,
            notas: resultado.notas,
            // Marca del build y marca del dato van separadas: un precalculo
            // de hoy sobre un producto de 2021 sigue siendo dato de 2021.
            generado: new Date().toISOString(),
            fuente: producto.fuente,
          },
          null,
          2,
        ),
        'utf-8',
      )

      indice[area.id] ??= {}
      indice[area.id][producto.id] = `${area.id}/${producto.id}`

      const kb = (buffer.length / 1024).toFixed(0)
      console.log(
        `  ${area.id.padEnd(14)} ${producto.id.padEnd(20)} ${tamano}px  ${kb} KB  ${((Date.now() - inicio) / 1000).toFixed(1)} s`,
      )

      // El firmador de Planetary Computer limita las rafagas.
      await esperar(1500)
    }
  }

  await writeFile(join(SALIDA, 'indice.json'), JSON.stringify(indice, null, 2), 'utf-8')
  console.log(`\nListo: ${Object.keys(indice).length} areas en public/precalculado`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
