import { useEffect, useRef } from 'react'
import { CircleMarker, GeoJSON, ImageOverlay, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { circleMarker } from 'leaflet'
import type { FeatureCollection } from 'geojson'
import type { Bbox, Capa, Escena, IdCapa } from '../tipos'
import CapaAnalisis, { type FuenteRaster } from './CapaAnalisis'
import type { MarcaMapa } from '../servicios/analisis'

interface Props {
  capas: Capa[]
  datosCapas: Record<string, FeatureCollection>
  visibles: Set<IdCapa>
  areaBbox: Bbox | null
  escenas: Escena[]
  fuente: FuenteRaster
  opacidad: number
  /** Zonas detectadas que se marcan aparte del raster. */
  marcas: MarcaMapa[]
  fondo: IdFondo
  /** Color de Sentinel-2 del ultimo resumen: lo que se ve debajo de todo al abrir. */
  imagenFondo: { url: string; limites: [[number, number], [number, number]] } | null
  onEstadoRaster: (estado: { cargando: boolean; error: string | null }) => void
}

/**
 * Mapas de fondo, y por que estos.
 *
 * Hasta el 28 de septiembre de 2026 el fondo eran los mosaicos de CARTO. Ese
 * dia empezaron a devolver una imagen que dice "API KEY REQUIRED", con codigo
 * 200: el mapa no fallaba, se llenaba de ese cartel. No se crean llaves ni
 * cuentas por un fondo de referencia, asi que se cambio a dos fuentes que
 * responden sin registro.
 *
 * El fondo sigue en "Ninguno" al abrir. La imagen que se analiza ya es
 * satelital, y un mosaico debajo confunde que pixel es del dato y cual del
 * fondo; el fondo se enciende para ubicarse, no para leer el resultado. Por
 * eso tambien va la advertencia en la tarjeta de capas.
 */
const FONDOS = {
  ninguno: null,
  mapa: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    atribucion: '&copy; OpenStreetMap',
  },
  satelite: {
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    atribucion: 'Powered by Esri. Imagen: Esri, Maxar, Earthstar Geographics',
  },
} as const

export type IdFondo = keyof typeof FONDOS

/**
 * Leaflet mide su contenedor una vez y guarda el tamano. Si el mapa nace en
 * 0 por 0 (pestana cargada en segundo plano, panel que se abre despues) y
 * luego crece, se queda con el tamano viejo. Observar el contenedor lo
 * mantiene al dia y dispara el resize que AjustarA espera para encuadrar.
 */
/** Atribucion de las imagenes que se analizan; el fondo de referencia trae la suya. */
function AtribucionFuentes() {
  const mapa = useMap()

  useEffect(() => {
    const texto = 'Contiene datos modificados de Copernicus Sentinel 2026'
    mapa.attributionControl?.addAttribution(texto)
    return () => {
      mapa.attributionControl?.removeAttribution(texto)
    }
  }, [mapa])

  return null
}

function SeguirTamano() {
  const mapa = useMap()

  // Sin la bandera que Leaflet pone por omision; las atribuciones de fuentes se quedan.
  useEffect(() => {
    mapa.attributionControl?.setPrefix('<a href="https://leafletjs.com">Leaflet</a>')
  }, [mapa])

  useEffect(() => {
    const contenedor = mapa.getContainer()
    const observador = new ResizeObserver(() => {
      // Sin alto, Leaflet calcula la vista en NaN. Pasa en celular con el menu abierto.
      if (contenedor.clientWidth > 0 && contenedor.clientHeight > 0) mapa.invalidateSize({ animate: false })
    })
    observador.observe(contenedor)
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
  const usuarioMovio = useRef(false)

  // Mover o acercar el mapa a mano cancela el reencuadre automatico. Se
  // escucha el gesto en el contenedor y no los eventos del mapa, porque
  // fitBounds tambien dispara movestart y se cancelaria a si mismo.
  useEffect(() => {
    const contenedor = mapa.getContainer()
    const marcar = () => {
      usuarioMovio.current = true
    }
    contenedor.addEventListener('pointerdown', marcar)
    contenedor.addEventListener('wheel', marcar, { passive: true })
    return () => {
      contenedor.removeEventListener('pointerdown', marcar)
      contenedor.removeEventListener('wheel', marcar)
    }
  }, [mapa])

  useEffect(() => {
    if (!bbox) return

    // Elegir otra area es una peticion explicita de encuadre.
    usuarioMovio.current = false

    const ajustar = (): boolean => {
      const tamano = mapa.getSize()
      if (tamano.x === 0 || tamano.y === 0) return false
      mapa.fitBounds(
        [
          [bbox[1], bbox[0]],
          [bbox[3], bbox[2]],
        ],
        // La tarjeta de resultado ocupa la esquina derecha. Un mapa angosto no
        // puede cederle ese margen: el encuadre quedaria en un zoom invalido.
        { paddingTopLeft: [24, 24], paddingBottomRight: [tamano.x > 900 ? 372 : 24, 24], animate: false },
      )
      return true
    }

    ajustar()

    /*
     * Se sigue reencuadrando en cada cambio de tamano mientras nadie haya
     * tocado el mapa. Sin esto, una ventana que crece despues de cargar deja
     * el area encuadrada para el tamano viejo: se ve chica y sobra margen.
     */
    const alCambiarTamano = () => {
      if (!usuarioMovio.current) ajustar()
    }
    mapa.on('resize', alCambiarTamano)
    return () => {
      mapa.off('resize', alCambiarTamano)
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
  marcas,
  fondo,
  imagenFondo,
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
      // Sin escalones de zoom: el area se encuadra al alto disponible, no al entero mas cercano.
      zoomSnap={0}
      zoomDelta={0.5}
    >
      {base && (
        <TileLayer key={fondo} url={base.url} attribution={base.atribucion} maxZoom={19} />
      )}

      {imagenFondo && (
        <ImageOverlay
          key={imagenFondo.url}
          url={imagenFondo.url}
          bounds={imagenFondo.limites}
          className="fondo-apertura"
        />
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

      {/*
        El radio crece con la raiz del area, no con el area: al ojo, el area
        del circulo es lo que se compara, y si el radio fuera proporcional una
        zona de 10 ha se veria cien veces mayor que una de 1 ha.
      */}
      {marcas.map((marca, i) => (
        <CircleMarker
          key={`${marca.lat},${marca.lon}`}
          center={[marca.lat, marca.lon]}
          radius={Math.max(6, Math.min(26, 5 * Math.sqrt(marca.hectareas)))}
          pathOptions={{
            color: '#fb7185',
            weight: 2,
            fillColor: '#fb7185',
            fillOpacity: 0.2,
            // Entran escalonadas, de la mayor a la menor; la clase da el retardo.
            className: `zona-entra zd${Math.min(i, 9)}`,
          }}
        >
          <Tooltip direction="top">{marca.etiqueta}</Tooltip>
        </CircleMarker>
      ))}

      <AtribucionFuentes />
      <SeguirTamano />
      <AjustarA bbox={areaBbox} />
    </MapContainer>
  )
}
