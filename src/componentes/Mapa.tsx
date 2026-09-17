import { useEffect } from 'react'
import { GeoJSON, MapContainer, TileLayer, useMap } from 'react-leaflet'
import { circleMarker } from 'leaflet'
import type { FeatureCollection } from 'geojson'
import type { Bbox, Capa, Escena, IdCapa } from '../tipos'
import CapaAnalisis, { type FuenteRaster } from './CapaAnalisis'

interface Props {
  capas: Capa[]
  datosCapas: Record<string, FeatureCollection>
  visibles: Set<IdCapa>
  areaBbox: Bbox | null
  escenas: Escena[]
  fuente: FuenteRaster
  opacidad: number
  fondo: IdFondo
  onEstadoRaster: (estado: { cargando: boolean; error: string | null }) => void
}

/**
 * Sin mapa satelital de fondo. La imagen que se analiza ya es satelital, y un
 * mosaico de Esri debajo solo confunde: no se distingue que pixel es del dato
 * y cual del fondo. Las opciones que quedan son de referencia, con calles y
 * nombres, o ninguna.
 */
const FONDOS = {
  ninguno: null,
  claro: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    atribucion: 'OpenStreetMap, CARTO',
  },
  oscuro: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    atribucion: 'OpenStreetMap, CARTO',
  },
} as const

export type IdFondo = keyof typeof FONDOS

/**
 * Leaflet mide su contenedor una vez y guarda el tamano. Si el mapa nace en
 * 0 por 0 (pestana cargada en segundo plano, panel que se abre despues) y
 * luego crece, se queda con el tamano viejo. Observar el contenedor lo
 * mantiene al dia y dispara el resize que AjustarA espera para encuadrar.
 */
function SeguirTamano() {
  const mapa = useMap()

  useEffect(() => {
    const observador = new ResizeObserver(() => mapa.invalidateSize({ animate: false }))
    observador.observe(mapa.getContainer())
    return () => observador.disconnect()
  }, [mapa])

  return null
}

/**
 * Encuadra el area, pero solo con el mapa ya medido. fitBounds sobre un
 * contenedor de 0 por 0 calcula un zoom invalido y deja la vista en NaN, que
 * es de donde salia el error; invalidar el tamano despues ya no lo repara.
 * Si todavia no hay tamano, espera al primer evento resize.
 */
function AjustarA({ bbox }: { bbox: Bbox | null }) {
  const mapa = useMap()

  useEffect(() => {
    if (!bbox) return

    const ajustar = (): boolean => {
      const tamano = mapa.getSize()
      if (tamano.x === 0 || tamano.y === 0) return false
      mapa.fitBounds(
        [
          [bbox[1], bbox[0]],
          [bbox[3], bbox[2]],
        ],
        { padding: [24, 24] },
      )
      return true
    }

    if (ajustar()) return

    const alCrecer = () => {
      if (ajustar()) mapa.off('resize', alCrecer)
    }
    mapa.on('resize', alCrecer)
    return () => {
      mapa.off('resize', alCrecer)
    }
  }, [mapa, bbox])

  return null
}

export default function Mapa({
  capas,
  datosCapas,
  visibles,
  areaBbox,
  escenas,
  fuente,
  opacidad,
  fondo,
  onEstadoRaster,
}: Props) {
  const base = FONDOS[fondo]

  return (
    /*
     * fadeAnimation apagado a proposito. Leaflet pone cada tile en opacidad 0
     * y la sube con un ciclo de requestAnimationFrame que solo arranca cuando
     * el tile dispara su evento de carga. Los tiles de GeoRasterLayer son
     * canvas que se dibujan aparte, ese evento no llega, y la imagen se queda
     * pintada pero invisible sobre el mapa base.
     */
    <MapContainer
      center={[21.12, -101.68]}
      zoom={11}
      zoomControl={false}
      fadeAnimation={false}
    >
      {base && (
        <TileLayer key={fondo} url={base.url} attribution={base.atribucion} maxZoom={19} />
      )}

      <CapaAnalisis fuente={fuente} opacidad={opacidad} onEstado={onEstadoRaster} />

      {escenas.map((escena) => (
        <GeoJSON
          key={`huella-${escena.id}`}
          data={escena.huella}
          style={{ color: '#ffffff', weight: 1, dashArray: '4 4', fillOpacity: 0 }}
        />
      ))}

      {capas.map((capa) => {
        const datos = datosCapas[capa.id]
        if (!datos || !visibles.has(capa.id)) return null

        return (
          <GeoJSON
            key={capa.id}
            data={datos}
            style={{
              color: capa.color,
              weight: capa.id === 'LIMITE' ? 2.5 : 2,
              fillOpacity: 0,
            }}
            pointToLayer={(_punto, latlng) =>
              circleMarker(latlng, {
                radius: 4,
                color: capa.color,
                weight: 1.5,
                fillColor: capa.color,
                fillOpacity: 0.75,
              })
            }
          />
        )
      })}

      <SeguirTamano />
      <AjustarA bbox={areaBbox} />
    </MapContainer>
  )
}
