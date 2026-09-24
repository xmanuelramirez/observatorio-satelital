import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import { imageOverlay, type ImageOverlay, type Layer } from 'leaflet'
import parseGeoraster from 'georaster'
import GeoRasterLayer from 'georaster-layer-for-leaflet'
import { pixelesAImagen } from '../servicios/imagen'
import type { ResultadoPintado } from '../servicios/pintura'
import { colorDeCambio } from '../servicios/paletas'

export type FuenteRaster =
  | { tipo: 'insar'; href: string; limite: number }
  /** Resultado de un calculo, ya pintado por el worker. */
  | { tipo: 'pintado'; resultado: ResultadoPintado }
  /** Imagen ya pintada, precalculada en el despliegue. */
  | { tipo: 'imagen'; url: string; limites: [[number, number], [number, number]]; clave: string }
  | null

interface Props {
  fuente: FuenteRaster
  opacidad: number
  onEstado: (estado: { cargando: boolean; error: string | null }) => void
}

interface CapaMontada {
  capa: Layer & { setOpacity: (opacidad: number) => unknown }
  /** Direccion de un blob que hay que liberar al quitar la capa. */
  urlPropia: string | null
}

/**
 * Pinta cada resultado como una sola imagen y deja georaster solo para lo que
 * de verdad lo necesita: leer un COG completo (color verdadero) o un GeoTIFF
 * externo (InSAR), que no pasan por la rejilla de analisis.
 */
function comoImagen(url: string, limites: [[number, number], [number, number]], opacidad: number): ImageOverlay {
  return imageOverlay(url, limites, {
    pane: 'overlayPane',
    opacity: opacidad,
    interactive: false,
    // Sin suavizado: cada celda de la rejilla se ve como lo que es.
    className: 'capa-pixelada',
  })
}

export default function CapaAnalisis({ fuente, opacidad, onEstado }: Props) {
  const mapa = useMap()
  const montadaRef = useRef<CapaMontada | null>(null)

  const clave =
    fuente === null
      ? 'vacio'
      : fuente.tipo === 'insar'
        ? `insar:${fuente.href}:${fuente.limite}`
        : fuente.tipo === 'imagen'
          ? `img:${fuente.clave}`
          : `pix:${fuente.resultado.sello}`

  useEffect(() => {
    let cancelado = false

    const limpiar = () => {
      const montada = montadaRef.current
      if (!montada) return
      mapa.removeLayer(montada.capa)
      if (montada.urlPropia) URL.revokeObjectURL(montada.urlPropia)
      montadaRef.current = null
    }

    if (!fuente) {
      limpiar()
      onEstado({ cargando: false, error: null })
      return
    }

    onEstado({ cargando: true, error: null })

    const preparar = async (): Promise<CapaMontada> => {
      if (fuente.tipo === 'imagen') {
        return { capa: comoImagen(fuente.url, fuente.limites, opacidad), urlPropia: null }
      }

      if (fuente.tipo === 'pintado') {
        const url = await pixelesAImagen(fuente.resultado)
        return { capa: comoImagen(url, fuente.resultado.limites, opacidad), urlPropia: url }
      }

      const georaster = await parseGeoraster(fuente.href)
      const limite = fuente.limite

      return {
        capa: new GeoRasterLayer({
          georaster,
          pane: 'overlayPane',
          resolution: 256,
          opacity: opacidad,
          pixelValuesToColorFn: ([valor]) => {
            // HyP3 marca el vacio con 0 exacto fuera del area procesada.
            if (valor === null || valor === undefined || Number.isNaN(valor)) return undefined
            if (valor === 0) return undefined
            return colorDeCambio(valor, limite)
          },
        }),
        urlPropia: null,
      }
    }

    preparar()
      .then((montada) => {
        if (cancelado) {
          if (montada.urlPropia) URL.revokeObjectURL(montada.urlPropia)
          return
        }
        limpiar()
        montada.capa.addTo(mapa)
        montadaRef.current = montada
        onEstado({ cargando: false, error: null })
      })
      .catch((error: unknown) => {
        if (cancelado) return
        // Sin esto se queda pintada la capa anterior y parece resultado nuevo.
        limpiar()
        onEstado({
          cargando: false,
          error: error instanceof Error ? error.message : String(error),
        })
      })

    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  useEffect(() => {
    montadaRef.current?.capa.setOpacity(opacidad)
  }, [opacidad])

  useEffect(() => {
    return () => {
      const montada = montadaRef.current
      if (!montada) return
      mapa.removeLayer(montada.capa)
      if (montada.urlPropia) URL.revokeObjectURL(montada.urlPropia)
    }
  }, [mapa])

  return null
}
