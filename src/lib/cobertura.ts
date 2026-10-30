import type { Bbox, Escena, GrupoDia } from '../tipos'

type Anillo = number[][]

function dentroDeAnillo(lon: number, lat: number, anillo: Anillo): boolean {
  let dentro = false
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i]
    const [xj, yj] = anillo[j]
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro
  }
  return dentro
}

function dentroDeHuella(lon: number, lat: number, escena: Escena): boolean {
  const huella = escena.huella as unknown as { geometry?: unknown; type?: string; coordinates?: unknown }
  const geometria = (huella.geometry ?? huella) as { type: string; coordinates: unknown }
  const poligonos =
    geometria.type === 'MultiPolygon' ? (geometria.coordinates as Anillo[][]) : [geometria.coordinates as Anillo[]]
  return poligonos.some((poligono) => dentroDeAnillo(lon, lat, poligono[0]))
}

/** Fraccion de una malla de 7 x 7 puntos sobre el area que cae dentro de las huellas del dia. */
export function coberturaDe(grupo: GrupoDia, bbox: Bbox): number {
  const [oeste, sur, este, norte] = bbox
  let dentro = 0
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      const lon = oeste + ((x + 0.5) / 7) * (este - oeste)
      const lat = sur + ((y + 0.5) / 7) * (norte - sur)
      if (grupo.escenas.some((escena) => dentroDeHuella(lon, lat, escena))) dentro++
    }
  }
  return dentro / 49
}

/**
 * Las fechas que sirven para un clic sin elegir nada. Una pasada de Sentinel-1 puede
 * rozar el area: la del 20/10/2026 cubria el 41 % del municipio y dejaba fuera la
 * presa, y el modo Agua decia 2 ha. Si ninguna cubre, se usan todas: mejor un
 * resultado con su nota de cobertura que ninguno.
 */
export function fechasCompletas(grupos: GrupoDia[], bbox: Bbox): GrupoDia[] {
  const completas = grupos.filter((grupo) => coberturaDe(grupo, bbox) >= 0.9)
  return completas.length > 0 ? completas : grupos
}

/** Sentinel-1 pasa en franjas: en radar, las fechas que no cubren el area ni se ofrecen. */
export function pasadasUtiles(idColeccion: string, grupos: GrupoDia[], bbox: Bbox): GrupoDia[] {
  return idColeccion === 'sentinel-1-rtc' ? fechasCompletas(grupos, bbox) : grupos
}
