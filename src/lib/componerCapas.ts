/**
 * Junta en una sola imagen las capas prendidas de una capa precalculada por grupos («Zonas de crecimiento»): el mapa
 * sigue recibiendo una imagen, y prender, apagar o cambiar de horizonte la cambia en seco, sin barrido.
 *
 * Cada combinacion se compone una vez y se guarda: volver a un horizonte ya visto es instantaneo.
 */

const imagenes = new Map<string, Promise<HTMLImageElement>>()
const compuestas = new Map<string, Promise<string>>()

function cargar(url: string): Promise<HTMLImageElement> {
  let promesa = imagenes.get(url)
  if (!promesa) {
    promesa = new Promise<HTMLImageElement>((resolver, rechazar) => {
      const imagen = new Image()
      imagen.onload = () => resolver(imagen)
      imagen.onerror = () => rechazar(new Error(`No se pudo leer ${url.split('/').pop()}`))
      imagen.src = url
    })
    promesa.catch(() => imagenes.delete(url))
    imagenes.set(url, promesa)
  }
  return promesa
}

/** Dibuja las imagenes en orden (la primera abajo) y devuelve la direccion de la imagen compuesta. */
export function componerCapas(urls: string[]): Promise<string> {
  const clave = urls.join('|')
  let promesa = compuestas.get(clave)
  if (!promesa) {
    promesa = (async () => {
      const capas = await Promise.all(urls.map(cargar))
      const lienzo = document.createElement('canvas')
      lienzo.width = capas[0]?.naturalWidth ?? 1
      lienzo.height = capas[0]?.naturalHeight ?? 1
      const contexto = lienzo.getContext('2d')
      if (!contexto) throw new Error('El navegador no deja componer la capa')
      for (const capa of capas) contexto.drawImage(capa, 0, 0)
      const blob = await new Promise<Blob>((resolver, rechazar) =>
        lienzo.toBlob((b) => (b ? resolver(b) : rechazar(new Error('No se pudo componer la capa'))), 'image/png'),
      )
      return URL.createObjectURL(blob)
    })()
    promesa.catch(() => compuestas.delete(clave))
    compuestas.set(clave, promesa)
  }
  return promesa
}
