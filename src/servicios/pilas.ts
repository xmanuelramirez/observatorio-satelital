/**
 * Lectura de bandas por escena y mosaico del dia, con su cache.
 *
 * Vive aparte de analisis.ts porque la serie de tiempo necesita exactamente
 * lo mismo: leer un dia sobre la rejilla del area, con su mascara de nubes.
 * Compartir el modulo es compartir tambien el cache, que es lo que evita
 * volver a bajar las mismas bandas al recalcular.
 */
import type { AssetBanda, Coleccion, Escena, NombreBanda } from '../tipos'
import { firmarHref } from './proveedores'
import { leerPila, type PilaBandas, type Rejilla } from './raster'
import { aplicarMascara } from './mascara'
import { combinarPilas, mascaraDeHuella } from './mosaico'
import { descartarNubes, mascaraDeNubes } from './nubes'

function assetsDe(
  escena: Escena,
  coleccion: Coleccion,
  bandas: NombreBanda[],
): Record<string, AssetBanda> {
  const salida: Record<string, AssetBanda> = {}

  for (const banda of bandas) {
    const nombreAsset = coleccion.bandas[banda]
    if (!nombreAsset) throw new Error(`${coleccion.etiqueta} no publica la banda ${banda}`)

    const asset = escena.assets[nombreAsset]
    if (!asset) throw new Error(`La escena no trae el asset ${nombreAsset}`)

    salida[banda] = asset
  }

  return salida
}

async function firmarAssets(
  assets: Record<string, AssetBanda>,
  escena: Escena,
): Promise<Record<string, AssetBanda>> {
  const entradas = await Promise.all(
    Object.entries(assets).map(async ([nombre, asset]) => {
      const href = await firmarHref(escena.proveedor, asset.href)
      return [nombre, { ...asset, href }] as const
    }),
  )
  return Object.fromEntries(entradas)
}

/**
 * Leer las bandas es lo caro de todo el proceso. Cambiar de indice o mover el
 * umbral no deberia volver a bajar los mismos megabytes, asi que la pila de
 * cada escena se guarda por escena, rejilla y juego de bandas.
 *
 * El cache es por escena y no por mosaico a proposito: las dos mallas de una
 * fecha se leen una sola vez aunque despues se cambie cuales se combinan.
 */
interface PilaEscena {
  pila: PilaBandas
  /** 1 donde la mascara de la mision descarto la celda, null si no se uso. */
  nubes: Uint8Array | null
}

const cachePilas = new Map<string, PilaEscena>()

function claveRejilla(rejilla: Rejilla): string {
  return [
    rejilla.ancho,
    rejilla.alto,
    rejilla.xmin.toFixed(6),
    rejilla.ymax.toFixed(6),
    rejilla.pixelAncho.toFixed(8),
    rejilla.pixelAlto.toFixed(8),
  ].join(',')
}

/**
 * Una escena leida sobre la rejilla comun y recortada a su propia huella.
 *
 * El recorte por huella no es cosmetico. Al pedir una ventana mas grande que
 * la imagen, geotiff rellena el sobrante; ese relleno se anula por el nodata
 * declarado, pero la huella real de una malla MGRS no es el rectangulo de su
 * bbox en grados, asi que sin este paso el borde de la escena entraria al
 * mosaico como si fuera dato.
 */
const CLAVE_NUBES = '__nubes'

export async function obtenerPilaEscena(
  escena: Escena,
  coleccion: Coleccion,
  bandas: NombreBanda[],
  rejilla: Rejilla,
  quitarNubes: boolean,
): Promise<PilaEscena> {
  const conMascara = quitarNubes && coleccion.mascaraNubes !== null
  const clave = [
    escena.id,
    claveRejilla(rejilla),
    [...bandas].sort().join(','),
    conMascara ? 'nubes' : 'crudo',
  ].join('|')

  const guardada = cachePilas.get(clave)
  if (guardada) return guardada

  const assets = await firmarAssets(assetsDe(escena, coleccion, bandas), escena)

  // La mascara viaja como una banda mas: asi se lee sobre la misma rejilla y
  // queda alineada celda a celda con las bandas que va a tachar.
  if (conMascara) {
    const asset = escena.assets[coleccion.mascaraNubes!.asset]
    if (asset) {
      assets[CLAVE_NUBES] = { ...asset, href: await firmarHref(escena.proveedor, asset.href) }
    }
  }

  const pila = await leerPila(assets, rejilla)

  const huella = mascaraDeHuella(rejilla, escena.huella)
  for (const banda of Object.values(pila.bandas)) aplicarMascara(banda, huella)

  let nubes: Uint8Array | null = null
  const valoresMascara = pila.bandas[CLAVE_NUBES]
  if (valoresMascara) {
    nubes = mascaraDeNubes(valoresMascara, coleccion.mascaraNubes!.tipo)
    delete pila.bandas[CLAVE_NUBES]
    for (const banda of Object.values(pila.bandas)) descartarNubes(banda, nubes)
  }

  const resultado: PilaEscena = { pila, nubes }
  cachePilas.set(clave, resultado)
  if (cachePilas.size > 12) cachePilas.delete(cachePilas.keys().next().value as string)

  return resultado
}

/** Lee todas las escenas del dia sobre la misma rejilla y las funde en una. */
export async function obtenerMosaico(
  escenas: Escena[],
  coleccion: Coleccion,
  bandas: NombreBanda[],
  rejilla: Rejilla,
  quitarNubes: boolean,
) {
  if (escenas.length === 0) throw new Error('No hay escenas seleccionadas')

  const porEscena = await Promise.all(
    escenas.map((escena) => obtenerPilaEscena(escena, coleccion, bandas, rejilla, quitarNubes)),
  )

  return {
    ...combinarPilas(porEscena.map((resultado) => resultado.pila)),
    nubesPorEscena: porEscena.map((resultado) => resultado.nubes),
  }
}


