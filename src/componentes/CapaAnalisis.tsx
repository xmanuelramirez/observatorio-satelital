import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import parseGeoraster from 'georaster'
import GeoRasterLayer from 'georaster-layer-for-leaflet'
import type { ResultadoAnalisis } from '../servicios/analisis'
import { colorDeCambio } from '../servicios/paletas'

export type FuenteRaster =
  | { tipo: 'cog'; href: string }
  | { tipo: 'insar'; href: string; limite: number }
  | { tipo: 'memoria'; resultado: ResultadoAnalisis }
  | null

interface Props {
  fuente: FuenteRaster
  opacidad: number
  onEstado: (estado: { cargando: boolean; error: string | null }) => void
}

/** georaster espera banda por banda y fila por fila, no un TypedArray plano. */
function aFilas(banda: Float32Array, ancho: number, alto: number): number[][] {
  const filas: number[][] = new Array(alto)
  for (let y = 0; y < alto; y++) {
    const fila = new Array<number>(ancho)
    for (let x = 0; x < ancho; x++) fila[x] = banda[y * ancho + x]
    filas[y] = fila
  }
  return filas
}

export default function CapaAnalisis({ fuente, opacidad, onEstado }: Props) {
  const mapa = useMap()
  const capaRef = useRef<GeoRasterLayer | null>(null)

  const clave =
    fuente === null
      ? 'vacio'
      : fuente.tipo === 'cog'
        ? `cog:${fuente.href}`
        : fuente.tipo === 'insar'
          ? `insar:${fuente.href}:${fuente.limite}`
          : `mem:${fuente.resultado.sello}`

  useEffect(() => {
    let cancelado = false

    const limpiar = () => {
      if (capaRef.current) {
        mapa.removeLayer(capaRef.current)
        capaRef.current = null
      }
    }

    if (!fuente) {
      limpiar()
      onEstado({ cargando: false, error: null })
      return
    }

    onEstado({ cargando: true, error: null })

    const preparar = async (): Promise<GeoRasterLayer> => {
      if (fuente.tipo === 'cog') {
        const georaster = await parseGeoraster(fuente.href)
        return new GeoRasterLayer({
          georaster,
          // overlayPane va por encima del mapa base; en tilePane el fondo lo tapa.
          pane: 'overlayPane',
          resolution: 256,
          opacity: opacidad,
        })
      }

      if (fuente.tipo === 'insar') {
        const georaster = await parseGeoraster(fuente.href)
        const limite = fuente.limite

        return new GeoRasterLayer({
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
        })
      }

      const { rejilla, bandas, colorear } = fuente.resultado
      const valores = bandas.map((banda) => aFilas(banda, rejilla.ancho, rejilla.alto))

      const georaster = await parseGeoraster(valores, {
        noDataValue: Number.NaN,
        projection: rejilla.epsg,
        xmin: rejilla.xmin,
        ymax: rejilla.ymax,
        pixelWidth: rejilla.pixelAncho,
        pixelHeight: rejilla.pixelAlto,
      })

      return new GeoRasterLayer({
        georaster,
        pane: 'overlayPane',
        resolution: 256,
        opacity: opacidad,
        pixelValuesToColorFn: colorear,
      })
    }

    preparar()
      .then((capa) => {
        if (cancelado) return
        limpiar()
        capa.addTo(mapa)
        capaRef.current = capa
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
    capaRef.current?.setOpacity(opacidad)
  }, [opacidad])

  useEffect(() => {
    return () => {
      if (capaRef.current) mapa.removeLayer(capaRef.current)
    }
  }, [mapa])

  return null
}
