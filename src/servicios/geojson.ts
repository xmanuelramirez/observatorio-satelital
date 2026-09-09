import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import type { Bbox } from '../tipos'

type Coleccionable = FeatureCollection | Feature<Geometry>

function recorrer(coordenadas: unknown, visitar: (posicion: Position) => void): void {
  if (!Array.isArray(coordenadas)) return
  if (typeof coordenadas[0] === 'number') {
    visitar(coordenadas as Position)
    return
  }
  for (const parte of coordenadas) recorrer(parte, visitar)
}

/** Calcula el bbox WGS84 de un GeoJSON sin arrastrar toda la libreria de Turf. */
export function bboxDe(datos: Coleccionable): Bbox {
  let oeste = Infinity
  let sur = Infinity
  let este = -Infinity
  let norte = -Infinity

  const geometrias: Geometry[] =
    datos.type === 'FeatureCollection'
      ? datos.features.map((f) => f.geometry).filter(Boolean)
      : [datos.geometry]

  for (const geometria of geometrias) {
    if (!geometria || geometria.type === 'GeometryCollection') continue
    recorrer(geometria.coordinates, ([x, y]) => {
      if (x < oeste) oeste = x
      if (y < sur) sur = y
      if (x > este) este = x
      if (y > norte) norte = y
    })
  }

  return [oeste, sur, este, norte]
}

export async function cargarGeojson(archivo: string): Promise<FeatureCollection> {
  const respuesta = await fetch(`${import.meta.env.BASE_URL}${archivo}`)
  if (!respuesta.ok) throw new Error(`No se pudo leer ${archivo} (${respuesta.status})`)
  return (await respuesta.json()) as FeatureCollection
}
