/**
 * Quita de dist las capas que no pueden salir del departamento.
 *
 * Filtrar la lista en capas.ts evita que la app las pida, pero no basta: los
 * archivos de public/ se copian a dist tal cual, y ahi quedarian descargables
 * aunque ninguna pantalla los muestre.
 *
 * Es lista blanca y no lista negra a proposito. Una capa nueva que nadie haya
 * clasificado no se publica: se borra del build y el script lo dice. Con una
 * lista negra, olvidar una linea la publicaria en silencio.
 *
 * Para un despliegue interno que si deba llevarlas:
 *     VITE_CAPAS_INTERNAS=true npm run build
 */

import { readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CARPETA = join(RAIZ, 'dist', 'capas')

/** Las unicas capas que pueden viajar a un sitio publico. */
const PUBLICAS = new Set(['LIMITE.geojson', 'LIMITE_URBANO.geojson', 'CUENCA_PALOTE.geojson'])

if (process.env.VITE_CAPAS_INTERNAS === 'true') {
  console.log('podar-capas: build interno, se conservan todas las capas.')
  process.exit(0)
}

if (!existsSync(CARPETA)) {
  console.error(`podar-capas: no existe ${CARPETA}. Corre vite build antes.`)
  process.exit(1)
}

const archivos = await readdir(CARPETA)
const quitados = []

for (const archivo of archivos) {
  if (PUBLICAS.has(archivo)) continue
  await rm(join(CARPETA, archivo))
  quitados.push(archivo)
}

const conservados = archivos.filter((a) => PUBLICAS.has(a))

if (conservados.length !== PUBLICAS.size) {
  const faltan = [...PUBLICAS].filter((a) => !conservados.includes(a))
  console.error(`podar-capas: faltan capas publicas en el build: ${faltan.join(', ')}`)
  process.exit(1)
}

console.log(`podar-capas: publicadas ${conservados.length} capas (${conservados.join(', ')}).`)
if (quitados.length > 0) {
  console.log(`podar-capas: excluidas del build ${quitados.length}: ${quitados.join(', ')}.`)
}
