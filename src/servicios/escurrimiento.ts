import type { Feature, FeatureCollection, Polygon, MultiPolygon, Position } from 'geojson'
import type { ZonaObra } from './obranueva'

/**
 * Escurrimiento por el metodo del numero de curva del SCS, sobre las
 * subcuencas que ya tiene el departamento.
 *
 * Lo que aporta el satelite no es el numero de curva, que ya existe, sino
 * cuanta superficie se impermeabilizo desde la ultima vez que se calculo. El
 * modo Obra entrega esas zonas; aqui se reparten por subcuenca, se sube el
 * numero de curva en la proporcion que les toca y se vuelve a correr la
 * lamina. La diferencia es el costo hidrologico del crecimiento.
 */

/** Numero de curva de una superficie impermeable en condicion media. */
const CN_IMPERMEABLE = 98

export type CondicionCn = 'cn_optimo' | 'cn_medio' | 'cn_critico'

export const CONDICIONES: { id: CondicionCn; etiqueta: string; descripcion: string }[] = [
  { id: 'cn_optimo', etiqueta: 'Óptima', descripcion: 'Suelo seco antes de la lluvia' },
  { id: 'cn_medio', etiqueta: 'Media', descripcion: 'Condición promedio, la de diseño' },
  { id: 'cn_critico', etiqueta: 'Crítica', descripcion: 'Suelo ya saturado' },
]

export interface Subcuenca {
  nombre: string
  areaKm2: number
  cn: number
  fraccionImpermeable: number
  geometria: Polygon | MultiPolygon
}

export interface FilaEscurrimiento {
  nombre: string
  areaKm2: number
  cn: number
  /** Numero de curva despues de sumar la obra nueva detectada. */
  cnNuevo: number
  hectareasNuevas: number
  /** Lamina de escurrimiento en milimetros. */
  laminaMm: number
  laminaNuevaMm: number
  /** Volumen en metros cubicos. */
  volumenM3: number
  volumenNuevoM3: number
}

export interface ResultadoEscurrimiento {
  filas: FilaEscurrimiento[]
  lluviaMm: number
  condicion: CondicionCn
  totalVolumenM3: number
  totalVolumenNuevoM3: number
  hectareasNuevas: number
  /** Zonas de obra que no cayeron en ninguna subcuenca del area. */
  zonasFuera: number
}

/**
 * Lamina de escurrimiento del SCS.
 *
 * Q = (P - 0.2 S)^2 / (P + 0.8 S), con S = 25400 / CN - 254 en milimetros.
 * Debajo de la abstraccion inicial (0.2 S) no escurre nada: la lluvia se la
 * queda el suelo.
 */
export function laminaEscurrida(lluviaMm: number, cn: number): number {
  const s = 25400 / cn - 254
  const abstraccion = 0.2 * s
  if (lluviaMm <= abstraccion) return 0
  return Math.pow(lluviaMm - abstraccion, 2) / (lluviaMm + 0.8 * s)
}

function anillosDe(geometria: Polygon | MultiPolygon): Position[][] {
  return geometria.type === 'Polygon'
    ? geometria.coordinates
    : geometria.coordinates.flatMap((poligono) => poligono)
}

/** Punto en poligono por conteo de cruces, con los anillos interiores restando. */
export function contiene(geometria: Polygon | MultiPolygon, lon: number, lat: number): boolean {
  let dentro = false

  for (const anillo of anillosDe(geometria)) {
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
      const [xi, yi] = anillo[i]
      const [xj, yj] = anillo[j]
      const cruza = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
      if (cruza) dentro = !dentro
    }
  }

  return dentro
}

export function leerSubcuencas(datos: FeatureCollection, condicion: CondicionCn): Subcuenca[] {
  return datos.features
    .filter((f): f is Feature<Polygon | MultiPolygon> =>
      f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon',
    )
    .map((f) => {
      const props = f.properties ?? {}
      const cn = Number(props[condicion])
      return {
        nombre: String(props.nombre ?? props.id ?? 'Subcuenca'),
        areaKm2: Number(props.area_km2 ?? 0),
        cn: Number.isFinite(cn) ? cn : Number.NaN,
        fraccionImpermeable: Number(props.fraccion_impermeable ?? 0),
        geometria: f.geometry,
      }
    })
    .filter((s) => Number.isFinite(s.cn) && s.areaKm2 > 0)
}

export interface ParametrosEscurrimiento {
  subcuencas: Subcuenca[]
  lluviaMm: number
  condicion: CondicionCn
  /** Zonas de obra nueva detectadas, para subir el numero de curva. */
  zonasObra: ZonaObra[]
}

export function calcularEscurrimiento(
  parametros: ParametrosEscurrimiento,
): ResultadoEscurrimiento {
  const { subcuencas, lluviaMm, condicion, zonasObra } = parametros

  const nuevasPorSubcuenca = new Map<string, number>()
  let zonasFuera = 0

  for (const zona of zonasObra) {
    const subcuenca = subcuencas.find((s) => contiene(s.geometria, zona.lon, zona.lat))
    if (!subcuenca) {
      zonasFuera++
      continue
    }
    nuevasPorSubcuenca.set(
      subcuenca.nombre,
      (nuevasPorSubcuenca.get(subcuenca.nombre) ?? 0) + zona.hectareas,
    )
  }

  const filas: FilaEscurrimiento[] = subcuencas.map((subcuenca) => {
    const hectareasNuevas = nuevasPorSubcuenca.get(subcuenca.nombre) ?? 0
    const areaHa = subcuenca.areaKm2 * 100

    /*
     * La obra nueva se trata como impermeable: el numero de curva de la
     * subcuenca se mueve hacia 98 en la proporcion de superficie que cambio.
     * Es una mezcla ponderada, no un salto: una hectarea nueva en una
     * subcuenca de mil apenas mueve la aguja, y eso es lo correcto.
     */
    const proporcion = areaHa > 0 ? Math.min(1, hectareasNuevas / areaHa) : 0
    const cnNuevo = subcuenca.cn + (CN_IMPERMEABLE - subcuenca.cn) * proporcion

    const laminaMm = laminaEscurrida(lluviaMm, subcuenca.cn)
    const laminaNuevaMm = laminaEscurrida(lluviaMm, cnNuevo)

    // Milimetros por kilometro cuadrado son miles de metros cubicos.
    const aVolumen = (mm: number) => mm * subcuenca.areaKm2 * 1000

    return {
      nombre: subcuenca.nombre,
      areaKm2: subcuenca.areaKm2,
      cn: subcuenca.cn,
      cnNuevo,
      hectareasNuevas,
      laminaMm,
      laminaNuevaMm,
      volumenM3: aVolumen(laminaMm),
      volumenNuevoM3: aVolumen(laminaNuevaMm),
    }
  })

  return {
    filas: filas.sort((a, b) => b.volumenNuevoM3 - a.volumenNuevoM3),
    lluviaMm,
    condicion,
    totalVolumenM3: filas.reduce((suma, fila) => suma + fila.volumenM3, 0),
    totalVolumenNuevoM3: filas.reduce((suma, fila) => suma + fila.volumenNuevoM3, 0),
    hectareasNuevas: [...nuevasPorSubcuenca.values()].reduce((suma, ha) => suma + ha, 0),
    zonasFuera,
  }
}
