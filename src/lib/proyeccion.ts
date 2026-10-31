import type { FeatureCollection, Position } from 'geojson'

/**
 * Coordenadas en la misma proyeccion que el mapa (Mercator), en unidades de mil por
 * grado. Asi un SVG estirado entre dos esquinas coincide con Leaflet en todo el
 * recorte, y las medidas del difuminado no dependen del zoom.
 */
export const xDe = (lon: number) => lon * 1000
export const yDe = (lat: number) => -Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * (180 / Math.PI) * 1000

export function rutaSvg(geojson: FeatureCollection): string {
  let ruta = ''
  const anillo = (puntos: Position[]) => {
    ruta += `M${puntos.map(([lon, lat]) => `${xDe(lon).toFixed(1)} ${yDe(lat).toFixed(1)}`).join('L')}Z`
  }
  for (const rasgo of geojson.features) {
    const g = rasgo.geometry
    if (g.type === 'Polygon') g.coordinates.forEach(anillo)
    else if (g.type === 'MultiPolygon') g.coordinates.forEach((poligono) => poligono.forEach(anillo))
  }
  return ruta
}
