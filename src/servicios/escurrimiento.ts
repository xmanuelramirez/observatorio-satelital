import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
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
 *
 * Auditado por el juez el 28 de septiembre de 2026
 * (`ORDENES-DEL-MASTER/2026-09-28-DICTAMEN-JUEZ-ESCURRIMIENTO.md`). Tres reglas
 * salieron de ahi y no se tocan por separado:
 *
 * 1. Ninguna unidad se descarta en silencio. Las GeometryCollection se aplanan,
 *    y lo que no deja ningun anillo se reporta con su superficie.
 * 2. La llave de una fila es su posicion en la capa. El rotulo puede repetirse
 *    o faltar; la llave no, y de ella depende el reparto de hectareas.
 * 3. **La lamina se multiplica por la superficie con numero de curva, no por el
 *    area declarada de la subcuenca.** Multiplicar por el area completa aplica
 *    un CN a terreno que nunca se caracterizo: eso no es medir, es extrapolar.
 *    Las reglas 1 y 3 van juntas: aplanar sin corregir el area sube el volumen
 *    un 25.7 por ciento y lo empeora.
 */

/** Numero de curva de una superficie impermeable en condicion media. */
const CN_IMPERMEABLE = 98

/**
 * Celda del raster de numero de curva, 10 m.
 *
 * La capa vigente no declara `km2_con_cn`, pero si el conteo de celdas con CN.
 * El juez probo el tamano por geometria: el area de los poligonos entre
 * `celdas` da entre 1.0009 y 1.0013, que es el factor de escala UTM al
 * cuadrado. Solo se usa cuando la capa no trae la superficie ya calculada.
 */
const CELDA_KM2 = 1e-4

/** Debajo de esta fraccion la fila se marca: su CN describe parte de la unidad. */
export const FRACCION_MINIMA = 0.9

export type CondicionCn = 'cn_optimo' | 'cn_medio' | 'cn_critico'

export const CONDICIONES: { id: CondicionCn; etiqueta: string; descripcion: string }[] = [
  { id: 'cn_optimo', etiqueta: 'Óptima', descripcion: 'Suelo seco antes de la lluvia' },
  { id: 'cn_medio', etiqueta: 'Media', descripcion: 'Condición promedio, la de diseño' },
  { id: 'cn_critico', etiqueta: 'Crítica', descripcion: 'Suelo ya saturado' },
]

export interface Subcuenca {
  /** Posicion en la capa. Unica por construccion; no depende de los campos. */
  clave: number
  /** Solo para mostrar: `id_subcuenca`, `nombre` o `id`, lo que traiga la capa. */
  rotulo: string
  /** Superficie con numero de curva, en km2. Es la que multiplica la lamina. */
  areaKm2: number
  /** Superficie que la capa declara para la unidad completa, en km2. */
  areaDeclarada: number
  /** areaKm2 / areaDeclarada. Debajo de FRACCION_MINIMA la fila se marca. */
  fraccionConCn: number
  /**
   * Advertencia que trae la propia capa para esa unidad, si la trae.
   *
   * Manda sobre la que arma el panel: asi el criterio vive en un solo lugar y
   * si CAUCE lo cambia, la tabla lo sigue sin tocar codigo. En el marco v1 hay
   * cuatro unidades con aviso y cobertura por encima del umbral, que sin esto
   * se leerian como si no tuvieran nada que advertir.
   */
  aviso?: string
  cn: number
  anillos: Position[][]
}

export interface UnidadDescartada {
  rotulo: string
  areaDeclarada: number
}

export interface Lectura {
  subcuencas: Subcuenca[]
  /** Unidades sin geometria poligonal utilizable, con su superficie declarada. */
  descartadas: UnidadDescartada[]
  /** De donde salio la superficie con CN. */
  fuenteArea: 'km2_con_cn' | 'celdas'
}

export interface FilaEscurrimiento {
  clave: number
  rotulo: string
  areaKm2: number
  areaDeclarada: number
  fraccionConCn: number
  aviso?: string
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

/**
 * Lo que aportan solo las unidades que recibieron obra.
 *
 * Es el unico subtotal comparable con el area que se analizo en pantalla. El
 * total recorre todas las unidades de la capa, que es otra cosa. Advertencia
 * del juez: cubre 240 km2 y la zona urbana 230, parecidos por casualidad; no
 * son lo mismo y no se rotulan igual.
 */
export interface SubtotalReceptoras {
  unidades: number
  areaKm2: number
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
  /** Superficie con numero de curva sobre la que se calculo, en km2. */
  km2ConCn: number
  /** Superficie declarada de esas mismas unidades, en km2. */
  km2Declarados: number
  /** Unidades cuyo CN cubre menos de FRACCION_MINIMA de su superficie. */
  unidadesParciales: number
  descartadas: UnidadDescartada[]
  receptoras: SubtotalReceptoras
  fuenteArea: Lectura['fuenteArea']
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

/**
 * Anillos de cualquier geometria, incluida GeometryCollection.
 *
 * Hasta el 28 de septiembre de 2026 solo se leian Polygon y MultiPolygon, y
 * las 12 GeometryCollection de la capa vigente se caian sin mensaje: 613 km2
 * declarados que no aparecian en ninguna cifra ni en ningun aviso.
 */
export function anillosDe(geometria: Geometry | null | undefined): Position[][] {
  if (!geometria) return []
  if (geometria.type === 'Polygon') return geometria.coordinates
  if (geometria.type === 'MultiPolygon') return geometria.coordinates.flat()
  if (geometria.type === 'GeometryCollection') return geometria.geometries.flatMap(anillosDe)
  return []
}

/** Punto en poligono por conteo de cruces, con los anillos interiores restando. */
export function contiene(anillos: Position[][], lon: number, lat: number): boolean {
  let dentro = false

  for (const anillo of anillos) {
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
      const [xi, yi] = anillo[i]
      const [xj, yj] = anillo[j]
      const cruza = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
      if (cruza) dentro = !dentro
    }
  }

  return dentro
}

/**
 * El rotulo prefiere `nombre` porque se explica solo.
 *
 * La capa del marco v1 nombra sus unidades «B' 017» y trae ademas
 * `id_subcuenca` con el 17 pelado. Mostrar el numero solo invita justo al error
 * que el aviso del 28/09 pedia evitar: leer un 114 de esta capa como el 114 de
 * otra. El nombre lleva la unidad encima.
 */
function rotuloDe(propiedades: Record<string, unknown>, indice: number): string {
  const candidato = propiedades.nombre ?? propiedades.id_subcuenca ?? propiedades.id
  return candidato === undefined || candidato === null
    ? `Unidad ${indice + 1}`
    : String(candidato)
}

/**
 * Lee la capa y declara de donde sale la superficie con numero de curva.
 *
 * Si la capa no dice cuanta superficie tiene CN, el modo no corre. Caer al
 * `area_km2` seria justo el error que el dictamen prohibe, y ademas silencioso:
 * el resultado se veria bien y estaria inflado.
 */
export function leerSubcuencas(datos: FeatureCollection, condicion: CondicionCn): Lectura {
  const primera = datos.features[0]?.properties ?? {}
  const fuenteArea: Lectura['fuenteArea'] =
    Number.isFinite(Number(primera.km2_con_cn)) ? 'km2_con_cn' : 'celdas'

  const subcuencas: Subcuenca[] = []
  const descartadas: UnidadDescartada[] = []

  datos.features.forEach((rasgo: Feature, indice) => {
    const propiedades = (rasgo.properties ?? {}) as Record<string, unknown>
    const rotulo = rotuloDe(propiedades, indice)
    const areaDeclarada = Number(propiedades.area_km2 ?? 0)
    const cn = Number(propiedades[condicion])

    const areaKm2 =
      fuenteArea === 'km2_con_cn'
        ? Number(propiedades.km2_con_cn)
        : Number(propiedades.celdas ?? Number.NaN) * CELDA_KM2

    if (!Number.isFinite(areaKm2)) {
      throw new Error(
        'La capa no declara la superficie con número de curva (km2_con_cn o celdas). ' +
          'Sin ella el volumen sería una extrapolación.',
      )
    }

    const anillos = anillosDe(rasgo.geometry)
    if (anillos.length === 0) {
      descartadas.push({ rotulo, areaDeclarada })
      return
    }
    if (!Number.isFinite(cn) || areaKm2 <= 0) {
      descartadas.push({ rotulo, areaDeclarada })
      return
    }

    const aviso = String(propiedades.aviso ?? '').trim()

    const declarada = Number.isFinite(propiedades.fraccion_con_cn as number)
      ? Number(propiedades.fraccion_con_cn)
      : Number.NaN

    subcuencas.push({
      clave: indice,
      rotulo,
      areaKm2,
      areaDeclarada,
      fraccionConCn: Number.isFinite(declarada)
        ? declarada
        : areaDeclarada > 0
          ? areaKm2 / areaDeclarada
          : 1,
      aviso: aviso.length > 0 ? aviso : undefined,
      cn,
      anillos,
    })
  })

  return { subcuencas, descartadas, fuenteArea }
}

export interface ParametrosEscurrimiento {
  lectura: Lectura
  lluviaMm: number
  condicion: CondicionCn
  /** Zonas de obra nueva detectadas, para subir el numero de curva. */
  zonasObra: ZonaObra[]
}

export function calcularEscurrimiento(
  parametros: ParametrosEscurrimiento,
): ResultadoEscurrimiento {
  const { lectura, lluviaMm, condicion, zonasObra } = parametros
  const { subcuencas } = lectura

  const nuevasPorSubcuenca = new Map<number, number>()
  let zonasFuera = 0

  for (const zona of zonasObra) {
    const subcuenca = subcuencas.find((s) => contiene(s.anillos, zona.lon, zona.lat))
    if (!subcuenca) {
      zonasFuera++
      continue
    }
    nuevasPorSubcuenca.set(
      subcuenca.clave,
      (nuevasPorSubcuenca.get(subcuenca.clave) ?? 0) + zona.hectareas,
    )
  }

  const filas: FilaEscurrimiento[] = subcuencas.map((subcuenca) => {
    const hectareasNuevas = nuevasPorSubcuenca.get(subcuenca.clave) ?? 0
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
      clave: subcuenca.clave,
      rotulo: subcuenca.rotulo,
      areaKm2: subcuenca.areaKm2,
      areaDeclarada: subcuenca.areaDeclarada,
      fraccionConCn: subcuenca.fraccionConCn,
      aviso: subcuenca.aviso,
      cn: subcuenca.cn,
      cnNuevo,
      hectareasNuevas,
      laminaMm,
      laminaNuevaMm,
      volumenM3: aVolumen(laminaMm),
      volumenNuevoM3: aVolumen(laminaNuevaMm),
    }
  })

  const conObra = filas.filter((fila) => fila.hectareasNuevas > 0)
  const suma = (valores: number[]) => valores.reduce((total, valor) => total + valor, 0)

  return {
    filas: filas.sort((a, b) => b.volumenNuevoM3 - a.volumenNuevoM3),
    lluviaMm,
    condicion,
    totalVolumenM3: suma(filas.map((f) => f.volumenM3)),
    totalVolumenNuevoM3: suma(filas.map((f) => f.volumenNuevoM3)),
    hectareasNuevas: suma([...nuevasPorSubcuenca.values()]),
    zonasFuera,
    km2ConCn: suma(filas.map((f) => f.areaKm2)),
    km2Declarados: suma(filas.map((f) => f.areaDeclarada)),
    unidadesParciales: filas.filter((f) => f.fraccionConCn < FRACCION_MINIMA).length,
    descartadas: lectura.descartadas,
    receptoras: {
      unidades: conObra.length,
      areaKm2: suma(conObra.map((f) => f.areaKm2)),
      volumenM3: suma(conObra.map((f) => f.volumenM3)),
      volumenNuevoM3: suma(conObra.map((f) => f.volumenNuevoM3)),
    },
    fuenteArea: lectura.fuenteArea,
  }
}
