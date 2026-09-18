import type { ResultadoPintado } from './pintura'

/**
 * Convierte los pixeles ya pintados en una imagen para el mapa.
 *
 * Antes cada resultado pasaba por georaster: la rejilla se copiaba a arreglos
 * anidados fila por fila, y GeoRasterLayer volvia a colorear cada pixel en
 * cada tile, en cada zoom y en cada paneo. El resultado ya esta en una rejilla
 * regular en grados, asi que basta ponerlo como una imagen entre sus cuatro
 * esquinas; el color ya lo resolvio el worker.
 *
 * Leaflet muestra en Mercator y la rejilla es regular en grados, asi que la
 * imagen se estira un poco en vertical. Sobre el municipio, medio grado de
 * latitud cerca de 21 N, el error es menor a un pixel en 512.
 */
export async function pixelesAImagen(pintado: ResultadoPintado): Promise<string> {
  const lienzo = document.createElement('canvas')
  lienzo.width = pintado.ancho
  lienzo.height = pintado.alto

  const contexto = lienzo.getContext('2d')!
  contexto.putImageData(new ImageData(pintado.rgba, pintado.ancho, pintado.alto), 0, 0)

  const blob = await new Promise<Blob>((resolver, rechazar) =>
    lienzo.toBlob(
      (resultado) =>
        resultado ? resolver(resultado) : rechazar(new Error('No se pudo generar la imagen')),
      'image/png',
    ),
  )

  return URL.createObjectURL(blob)
}
