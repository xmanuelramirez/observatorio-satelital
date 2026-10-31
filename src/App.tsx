import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import { CAPAS } from './datos/capas'
import { COLECCION_POR_DEFECTO, buscarColeccion } from './datos/colecciones'
import { bboxDe, cargarGeojson } from './servicios/geojson'
import { buscarEscenas, type ResultadoBusqueda } from './servicios/stac'
import { bandasDelAgua, type EntradaLeyenda, type ParametrosAnalisis } from './servicios/analisis'
import { pedirAnalisis, pedirSerie } from './servicios/calculo'
import { pintarResultado, type ResultadoPintado } from './servicios/pintura'
import { INDICES, indicesDisponibles, type DefinicionIndice } from './servicios/indices'
import { CIFRA_OBRA_SUSPENDIDA, avisoFenologia, diasEntre } from './servicios/obranueva'
import { colorDeIndice } from './servicios/paletas'
import type { Bbox, Escena, GrupoDia, IdCapa, ModoVista, NombreBanda } from './tipos'
import { diaLocal } from './lib/fecha'
import { fechasCompletas, pasadasUtiles } from './lib/cobertura'
import { COLECCION_ANTERIOR, NOTA_CRITERIO, NOTA_MES_APARTADO, NOTA_PROCESADO_ANTERIOR, ROTULO_LINEA_TIEMPO, mesesApartados } from './lib/lineaTiempo'
import { rutaSvg } from './lib/proyeccion'
import { useCifra } from './lib/useCifra'
import type { FuenteRaster } from './componentes/CapaAnalisis'
import Mapa, { type IdFondo } from './componentes/Mapa'
import PanelBusqueda from './componentes/PanelBusqueda'
import PanelSecciones, { type MiniaturaModo, type SeccionPanel } from './componentes/PanelSecciones'
import ControlMapa from './componentes/ControlMapa'
import GaleriaEscenas from './componentes/GaleriaEscenas'
import LecturaResultado from './componentes/LecturaResultado'
import PanelInsar from './componentes/PanelInsar'
import PanelAnalisis from './componentes/PanelAnalisis'
import PanelSerie from './componentes/PanelSerie'
import PanelProductos from './componentes/PanelProductos'
import PanelEscurrimiento from './componentes/PanelEscurrimiento'
import ReglaFechas from './componentes/ReglaFechas'
import {
  calcularEscurrimiento,
  leerSubcuencas,
  type CondicionCn,
  type ResultadoEscurrimiento,
} from './servicios/escurrimiento'
import { cargarProducto, PRODUCTOS, type IdProducto } from './servicios/productos'
import type { ResultadoSerie } from './servicios/serie'

const TITULO_SECCION: Record<SeccionPanel, string> = {
  escenas: 'Ajustes',
  serie: 'Evolución',
  referencia: 'Capas globales',
  hidrologia: 'Escurrimiento',
  capas: 'Capas',
}

const ETIQUETA_MODO: Record<ModoVista, string> = {
  indice: 'Vegetación',
  cambio: 'Cambio',
  obra: 'Obra nueva',
  calor: 'Calor',
  agua: 'Agua por radar',
  clases: 'Clases',
  color: 'Color',
}

/** La coleccion que da cada modo con un solo clic. Los demas salen de Sentinel-2. */
const COLECCION_DEL_MODO: Partial<Record<ModoVista, string>> = {
  agua: 'sentinel-1-rtc',
  calor: 'landsat-c2-l2',
}

const NOMBRE_AREA: Partial<Record<IdCapa, string>> = {
  LIMITE: 'Municipio',
  LIMITE_URBANO: 'Zona urbana',
  CUENCA_PALOTE: 'Cuenca Palote',
}

/** Lo que dice el titulo de cada modo: lo que se ve, en palabras de quien lo mira. */
const TITULO_MODO: Partial<Record<ModoVista, string>> = {
  color: 'Así se ve',
  calor: 'Qué tan caliente está el suelo',
  agua: 'Dónde hay agua',
  clases: 'Zonas que se parecen',
  cambio: 'Qué cambió entre dos fechas',
}

const NOMBRE_INDICE: Record<string, string> = {
  ndvi: 'Dónde hay vegetación',
  ndwi: 'Agua en plantas',
  mndwi: 'Agua superficial',
  ndbi: 'Superficie construida',
  ndci: 'Clorofila en agua',
  ndti: 'Turbiedad',
  nbr: 'Quema',
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
function fechaBreve(dia: string, conAno = false): string {
  const [a, m, d] = dia.split('-')
  return `${Number(d)} ${MESES[Number(m) - 1]}${conAno ? ` ${a}` : ''}`
}

function precargar(url: string): Promise<void> {
  return new Promise((listo, fallo) => {
    const imagen = new Image()
    imagen.onload = () => listo()
    imagen.onerror = () => fallo(new Error(url))
    imagen.src = url
  })
}

const DOS_FECHAS: ModoVista[] = ['cambio', 'obra', 'agua']
/** Leyendas de categorias: sirven mientras se calcula. Las de valores dependen de la fecha. */
const LEYENDA_DE_CATEGORIAS: ModoVista[] = ['agua', 'cambio', 'obra', 'clases']
const DIAS_DE_BUSQUEDA = 120
const SEPARACION_POR_OMISION = 30

/** Un modo ya calculado con la ultima escena, por `npm run apertura`. */
interface Registro {
  dia: string
  diaBase: string | null
  coleccion: string
  /** Falso si no hay nada que pintar: Color es el fondo, y Obra fuera de julio a octubre. */
  imagen: boolean
  limites: [[number, number], [number, number]] | null
  leyenda: EntradaLeyenda[]
  aviso: string | null
  notas: string[]
}

interface DatosArea {
  nombre: string
  limitesFondo: [[number, number], [number, number]]
  diaFondo: string
  fechas: Record<string, { dia: string; nubes: number | null }[]>
  modos: Record<string, Registro>
  serie: ResultadoSerie | null
}

/** Lo que deja `npm run historia`: una imagen limpia por mes, Color y NDVI, con una sola escala. */
interface Historia {
  limites: [[number, number], [number, number]]
  escala: { p2: number; p98: number }
  meses: Record<string, { dia: string; nubesArea: number; fuente: string; urbana: { rojo: number; ndvi: number } } | null>
}

interface Apertura {
  generado: string
  areas: Record<string, DatosArea>
}

// Dia de Leon, no dia UTC: con toISOString, despues de las 18:00 locales
// "hoy" ya era manana.
function haceDias(dias: number): string {
  return diaLocal(Date.now() - dias * 86_400_000)
}

function hoy(): string {
  return diaLocal(new Date())
}

/** La base mas cercana a 30 dias antes: la misma separacion que busca el resumen semanal. */
function baseCercana(grupos: GrupoDia[], dia: string): GrupoDia | null {
  const distancia = (g: GrupoDia) => Math.abs(diasEntre(g.dia, dia) - SEPARACION_POR_OMISION)
  return grupos
    .filter((g) => g.dia < dia)
    .reduce<GrupoDia | null>((mejor, g) => (!mejor || distancia(g) < distancia(mejor) ? g : mejor), null)
}

/** La superficie es el titular: el numero de zonas depende de la rejilla. */
function fraseObra(hectareas: string): string {
  if (CIFRA_OBRA_SUSPENDIDA) return 'Obra nueva: cifra en corrección'
  return `Obra probable: ${hectareas} ha`
}

function claveDe(modo: ModoVista, indice: DefinicionIndice | null): string {
  return modo === 'indice' ? `indice-${indice?.id ?? 'ndvi'}` : modo
}

export default function App() {
  const [datosCapas, setDatosCapas] = useState<Record<string, FeatureCollection>>({})
  const [errorCapas, setErrorCapas] = useState<string | null>(null)
  const [visibles, setVisibles] = useState<Set<IdCapa>>(() => new Set<IdCapa>(['LIMITE_URBANO', 'LIMITE']))

  const [apertura, setApertura] = useState<Apertura | null>(null)
  const [aperturaLista, setAperturaLista] = useState(false)
  /**
   * Falso: se ve lo precalculado de este modo y esta area, sin calcular nada.
   * Cierto: se eligio otra fecha u otros ajustes, y el resultado sale del calculo.
   */
  const [personalizado, setPersonalizado] = useState(false)
  /** Fecha de la linea de tiempo, si no es la de lo precalculado. */
  const [diaEvolucion, setDiaEvolucion] = useState<string | null>(null)
  /** La fecha marcada, al instante; la imagen la sigue en cuanto llega. */
  const [diaMarcado, setDiaMarcado] = useState<string | null>(null)
  const [historia, setHistoria] = useState<Historia | null>(null)
  const [reproduciendo, setReproduciendo] = useState(false)
  const pedidoFecha = useRef(0)
  const diaPendiente = useRef<string | null>(null)

  const [area, setArea] = useState<IdCapa>('LIMITE_URBANO')
  const [coleccion, setColeccion] = useState(COLECCION_POR_DEFECTO)
  const [desde, setDesde] = useState(() => haceDias(DIAS_DE_BUSQUEDA))
  const [hasta, setHasta] = useState(hoy)
  const [nubesMax, setNubesMax] = useState(20)

  const [resultado, setResultado] = useState<ResultadoBusqueda | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null)
  /** Escenas activas, siempre del mismo dia. Mas de una significa mosaico. */
  const [seleccion, setSeleccion] = useState<Escena[]>([])

  const [modo, setModo] = useState<ModoVista>('color')
  const [referencia, setReferencia] = useState<Escena[]>([])
  const [umbralCambio, setUmbralCambio] = useState(0.1)
  const [umbralObra, setUmbralObra] = useState(0.08)
  const [areaMinimaObra, setAreaMinimaObra] = useState(1)
  // Encendida por defecto: una nube sobre un terreno se parece a concreto
  // nuevo, y el filtro de la busqueda no ve donde cae la nube.
  const [quitarNubes, setQuitarNubes] = useState(true)
  const [soloAgua, setSoloAgua] = useState(false)
  // -17 dB es el valor habitual para agua en calma en VV.
  const [umbralAguaDb, setUmbralAguaDb] = useState(-17)
  const [desplazamiento, setDesplazamiento] = useState<FuenteRaster>(null)
  const [indice, setIndice] = useState<DefinicionIndice | null>(INDICES[0])
  const [bandasKmeans, setBandasKmeans] = useState<NombreBanda[]>([
    'verde',
    'rojo',
    'nir',
    'swir1',
  ])
  const [k, setK] = useState(5)
  const [tamano, setTamano] = useState(512)

  const [analisis, setAnalisis] = useState<ResultadoPintado | null>(null)
  const [calculando, setCalculando] = useState(false)
  const [errorAnalisis, setErrorAnalisis] = useState<string | null>(null)
  /** Solo cuenta el ultimo pedido: una respuesta tardia no pisa lo que se eligio despues. */
  const pedidoVigente = useRef(0)

  const [serie, setSerie] = useState<ResultadoSerie | null>(null)
  const [calculandoSerie, setCalculandoSerie] = useState(false)
  const [errorSerie, setErrorSerie] = useState<string | null>(null)
  const [maxFechas, setMaxFechas] = useState(12)
  const [progresoSerie, setProgresoSerie] = useState<{
    hechas: number
    total: number
    dia: string
  } | null>(null)
  const cancelarSerie = useRef<AbortController | null>(null)

  const [producto, setProducto] = useState<IdProducto | null>(null)
  /**
   * Lo que la capa de referencia pone en el mapa y en su leyenda. Casi
   * siempre es una imagen precalculada; solo si falta se calcula en vivo.
   */
  const [productoVista, setProductoVista] = useState<{
    fuente: FuenteRaster
    leyenda: EntradaLeyenda[]
    notas: string[]
  } | null>(null)
  const [cargandoProducto, setCargandoProducto] = useState<IdProducto | null>(null)
  const [errorProducto, setErrorProducto] = useState<string | null>(null)

  const [subcuencasCn, setSubcuencasCn] = useState<FeatureCollection | null>(null)
  const [lluviaMm, setLluviaMm] = useState(50)
  const [condicionCn, setCondicionCn] = useState<CondicionCn>('cn_medio')
  const [escurrimiento, setEscurrimiento] = useState<ResultadoEscurrimiento | null>(null)
  const [calculandoEscurrimiento, setCalculandoEscurrimiento] = useState(false)
  const [errorEscurrimiento, setErrorEscurrimiento] = useState<string | null>(null)

  /** Panel lateral abierto. Reduce el mapa en vez de encimarse con el. */
  const [seccion, setSeccion] = useState<SeccionPanel | null>(null)
  const [galeriaAbierta, setGaleriaAbierta] = useState(false)

  const [opacidad, setOpacidad] = useState(1)
  const [fondo, setFondo] = useState<IdFondo>('ninguno')
  const [estadoRaster, setEstadoRaster] = useState<{ cargando: boolean; error: string | null }>({
    cargando: false,
    error: null,
  })

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}apertura/apertura.json`)
      .then((respuesta) => (respuesta.ok ? (respuesta.json() as Promise<Apertura>) : null))
      .catch(() => null)
      .then((datos) => {
        setApertura(datos)
        setAperturaLista(true)
      })
    fetch(`${import.meta.env.BASE_URL}apertura/evolucion/historia/historia.json`)
      .then((respuesta) => (respuesta.ok ? (respuesta.json() as Promise<Historia>) : null))
      .catch(() => null)
      .then(setHistoria)
  }, [])

  /**
   * Cada capa se resuelve por separado a proposito. Con Promise.all, una sola
   * que falte deja la app sin ninguna, y el caso es real: las capas internas
   * no estan en el repositorio, asi que un clon nuevo corriendo en modo
   * desarrollo las pide y no las encuentra. Lo que falta se reporta por
   * nombre y lo demas sigue funcionando.
   */
  useEffect(() => {
    Promise.allSettled(
      CAPAS.map(async (capa) => [capa.id, await cargarGeojson(capa.archivo)] as const),
    ).then((resultados) => {
      const cargadas = resultados.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
      setDatosCapas(Object.fromEntries(cargadas))

      const faltantes = CAPAS.filter(
        (capa) => !cargadas.some(([id]) => id === capa.id),
      ).map((capa) => capa.etiqueta)

      setErrorCapas(faltantes.length > 0 ? faltantes.join(', ') : null)
    })
  }, [])

  useEffect(() => {
    cargarGeojson('capas/NUMERO_DE_CURVA_MARCO_V1.geojson')
      .then(setSubcuencasCn)
      .catch(() => setSubcuencasCn(null))
  }, [])

  const areaBbox = useMemo<Bbox | null>(() => {
    const datos = datosCapas[area]
    return datos ? bboxDe(datos) : null
  }, [datosCapas, area])

  const bandasDisponibles = useMemo(
    () => Object.keys(coleccion.bandas) as NombreBanda[],
    [coleccion],
  )

  const indicesPosibles = useMemo(
    () => indicesDisponibles(bandasDisponibles),
    [bandasDisponibles],
  )

  const grupos = useMemo<GrupoDia[]>(() => resultado?.grupos ?? [], [resultado])

  const datosArea = apertura?.areas[area] ?? null
  const clave = claveDe(modo, indice)
  /** Lo precalculado de este modo, se este viendo o no. */
  const registroBase = datosArea?.modos[clave] ?? null
  /** Lo que se ve ahora sin calcular. */
  const registro = personalizado ? null : registroBase

  /**
   * Las imagenes de esta area se piden de una vez, para que el cambio de modo no
   * espere a la red. Los fondos de las otras areas tambien.
   */
  useEffect(() => {
    if (!apertura) return
    const base = import.meta.env.BASE_URL
    for (const id of Object.keys(apertura.areas)) new Image().src = `${base}apertura/${id}/fondo.jpg`
    const propios = apertura.areas[area]
    if (!propios) return
    for (const [id, datos] of Object.entries(propios.modos)) {
      if (datos.imagen) new Image().src = `${base}apertura/${area}/${id}.png`
    }
  }, [apertura, area])

  /**
   * La comparacion es entre fechas, no entre mallas. Con la rejilla comun ya
   * da igual de que malla venga cada pixel, asi que la fecha base entra
   * completa y se mosaica igual que la fecha actual.
   */
  const diasReferencia = useMemo(() => {
    if (seleccion.length === 0) return []
    return grupos
      .filter((grupo) => grupo.dia !== seleccion[0].dia)
      .sort((a, b) => b.dia.localeCompare(a.dia))
  }, [grupos, seleccion])

  const alternarVisible = useCallback((id: IdCapa) => {
    setVisibles((previas) => {
      const siguiente = new Set(previas)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
  }, [])

  /** Deja de mostrar lo anterior: ningun resultado se queda bajo un rotulo que no es el suyo. */
  const soltarResultado = useCallback(() => {
    pedidoVigente.current += 1
    setCalculando(false)
    setAnalisis(null)
    setErrorAnalisis(null)
    setProductoVista(null)
    setProducto(null)
    setDesplazamiento(null)
  }, [])

  /** Un ajuste cambio: lo precalculado ya no le corresponde, hasta que se recalcule. */
  const limpiarAnalisis = useCallback(() => {
    soltarResultado()
    setPersonalizado(true)
  }, [soltarResultado])

  const cambiarColeccion = useCallback(
    (id: string) => {
      const nueva = buscarColeccion(id)
      const bandas = Object.keys(nueva.bandas) as NombreBanda[]
      const posibles = indicesDisponibles(bandas)

      setColeccion(nueva)
      setSeleccion([])
      setReferencia([])
      setResultado(null)
      setBandasKmeans(bandas.slice(0, Math.min(4, bandas.length)))
      setIndice(posibles[0] ?? null)
      if (posibles.length === 0 && (modo === 'indice' || modo === 'obra')) setModo('color')
      limpiarAnalisis()
    },
    [limpiarAnalisis, modo],
  )

  const alternarBandaKmeans = useCallback((banda: NombreBanda) => {
    setBandasKmeans((previas) =>
      previas.includes(banda) ? previas.filter((b) => b !== banda) : [...previas, banda],
    )
  }, [])

  /**
   * Calcula en vivo. Quita antes lo anterior: mientras tanto se ve el fondo, y la
   * tarjeta dice el modo nuevo. Quien acaba de cambiar una eleccion la pasa en
   * `cambios`, porque el estado todavia no se actualizo en este render.
   */
  const calcular = async (cambios: Partial<ParametrosAnalisis> = {}) => {
    setReproduciendo(false)
    const escenas = cambios.escenas ?? seleccion
    const areaGeojson = datosCapas[area]
    if (!areaBbox || !areaGeojson || escenas.length === 0) return

    soltarResultado()
    setPersonalizado(true)
    const id = pedidoVigente.current
    setCalculando(true)

    try {
      const salida = await pedirAnalisis({
        escenas,
        escenasReferencia: referencia,
        coleccion,
        bbox: areaBbox,
        areaGeojson,
        etiquetaArea: NOMBRE_AREA[area] ?? area,
        modo,
        indice,
        bandasKmeans,
        k,
        tamano,
        umbralCambio,
        umbralObra,
        areaMinimaObra,
        quitarNubes,
        soloAgua,
        umbralAguaDb,
        ...cambios,
      })
      if (id !== pedidoVigente.current) return
      setAnalisis(salida)
    } catch (error: unknown) {
      if (id !== pedidoVigente.current) return
      setErrorAnalisis(error instanceof Error ? error.message : String(error))
    } finally {
      if (id === pedidoVigente.current) setCalculando(false)
    }
  }

  /** Las fechas de la regla: se buscan solas al cambiar de area o de coleccion. */
  useEffect(() => {
    if (!areaBbox) return
    let cancelada = false

    setResultado(null)
    setSerie(null)
    setBuscando(true)
    setErrorBusqueda(null)
    buscarEscenas({ coleccion, bbox: areaBbox, desde, hasta, nubesMax, limite: 100 })
      .then((salida) => {
        if (!cancelada) setResultado({ ...salida, grupos: pasadasUtiles(coleccion.id, salida.grupos, areaBbox) })
      })
      .catch((error: unknown) => {
        if (!cancelada) setErrorBusqueda(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!cancelada) setBuscando(false)
      })

    return () => {
      cancelada = true
    }
    // Solo el area y la coleccion disparan esta busqueda; lo demas se busca con el boton de Ajustes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaBbox, coleccion.id])

  /**
   * Con las fechas ya buscadas, la seleccion se alinea con lo que se ve. Si este modo
   * no se pudo precalcular, se calcula solo: cambiar de seccion nunca pide otro clic.
   */
  useEffect(() => {
    if (personalizado || !resultado || !areaBbox || !aperturaLista) return
    if (registroBase) {
      setSeleccion(grupos.find((g) => g.dia === registroBase.dia)?.escenas ?? [])
      setReferencia(grupos.find((g) => g.dia === registroBase.diaBase)?.escenas ?? [])
      return
    }
    const utiles = fechasCompletas(grupos, areaBbox)
    const actual = [...utiles].sort((a, b) => b.dia.localeCompare(a.dia))[0]
    if (!actual) return
    const base = DOS_FECHAS.includes(modo) ? baseCercana(utiles, actual.dia) : null
    setSeleccion(actual.escenas)
    setReferencia(base?.escenas ?? [])
    void calcular({ escenas: actual.escenas, escenasReferencia: base?.escenas ?? [] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultado, registroBase, personalizado, aperturaLista])

  const lanzarBusqueda = useCallback(async () => {
    if (!areaBbox) return

    setBuscando(true)
    setErrorBusqueda(null)
    setSeleccion([])
    setReferencia([])
    limpiarAnalisis()

    try {
      const salida = await buscarEscenas({
        coleccion,
        bbox: areaBbox,
        desde,
        hasta,
        nubesMax,
        limite: 100,
      })
      const disponibles = pasadasUtiles(coleccion.id, salida.grupos, areaBbox)
      setResultado({ ...salida, grupos: disponibles })
      setSerie(null)
      const utiles = fechasCompletas(disponibles, areaBbox)
      const actual = [...utiles].sort((a, b) => b.dia.localeCompare(a.dia))[0]
      if (actual) {
        setSeleccion(actual.escenas)
        setReferencia(baseCercana(utiles, actual.dia)?.escenas ?? [])
      }
    } catch (error: unknown) {
      setErrorBusqueda(error instanceof Error ? error.message : String(error))
      setResultado(null)
    } finally {
      setBuscando(false)
    }
  }, [areaBbox, coleccion, desde, hasta, nubesMax, limpiarAnalisis])

  const elegirArea = (id: IdCapa) => {
    if (id === area) return
    setReproduciendo(false)
    soltarResultado()
    setPersonalizado(false)
    setVisibles((previas) => {
      const siguiente = new Set(previas)
      if (area !== 'LIMITE') siguiente.delete(area)
      siguiente.add(id)
      return siguiente
    })
    setArea(id)
  }

  /** Un clic: el modo y su imagen, ya calculada, de la ultima escena de esta area. */
  const elegirModo = (nuevo: ModoVista) => {
    setReproduciendo(false)
    soltarResultado()
    diaPendiente.current = null
    setPersonalizado(false)
    setSeccion((actual) => (actual === 'escenas' || actual === 'capas' ? actual : null))
    setModo(nuevo)

    const col = buscarColeccion(COLECCION_DEL_MODO[nuevo] ?? COLECCION_POR_DEFECTO.id)
    if (col.id !== coleccion.id) {
      const bandas = Object.keys(col.bandas) as NombreBanda[]
      setColeccion(col)
      setResultado(null)
      setSeleccion([])
      setReferencia([])
      setBandasKmeans(bandas.slice(0, Math.min(4, bandas.length)))
    }
    // Cambio esta precalculado con NDVI: el indice tiene que decir lo mismo que la imagen.
    if (nuevo === 'cambio' || !indice) setIndice(INDICES[0])
  }

  const elegirIndice = (definicion: DefinicionIndice) => {
    setReproduciendo(false)
    soltarResultado()
    setPersonalizado(false)
    setIndice(definicion)
  }

  // La linea de tiempo larga: Color y NDVI, de 2017 a hoy, con la misma imagen en las tres areas.
  const baseApertura = `${import.meta.env.BASE_URL}apertura`
  const fechasHistoria = useMemo(
    () =>
      Object.values(historia?.meses ?? {})
        .flatMap((mes) => (mes ? [{ dia: mes.dia, nubes: mes.nubesArea, fuente: mes.fuente }] : []))
        .sort((x, y) => x.dia.localeCompare(y.dia)),
    [historia],
  )
  const diasHistoria = useMemo(() => fechasHistoria.map((f) => f.dia), [fechasHistoria])
  const apartados = useMemo(() => mesesApartados(historia?.meses ?? {}), [historia])
  const ultimoDia = diasHistoria[diasHistoria.length - 1] ?? null
  const lineaLarga = !personalizado && !productoVista && !desplazamiento && ultimoDia !== null && (modo === 'color' || (modo === 'indice' && indice?.id === 'ndvi'))
  const urlColorDe = (dia: string) => `${baseApertura}/evolucion/historia/color-${dia.slice(0, 7)}.jpg`
  const urlNdviDe = (dia: string) => `${baseApertura}/evolucion/historia/indice-ndvi-${dia.slice(0, 7)}.png`
  /** La imagen que esta puesta. */
  const diaImagen = diaEvolucion ?? ultimoDia

  /** Las vecinas se piden de una vez, para que el cambio sea en seco. */
  const precargarVecinas = (dia: string) => {
    const i = diasHistoria.indexOf(dia)
    for (const vecino of diasHistoria.slice(Math.max(0, i - 2), i + 4)) {
      new Image().src = urlColorDe(vecino)
      new Image().src = urlNdviDe(vecino)
    }
  }

  /**
   * La fecha se marca al instante. La imagen cambia cuando ya esta lista; mientras, se
   * queda la anterior: nunca un salto en negro, y el mapa no se mueve.
   */
  const verFecha = (dia: string) => {
    const id = ++pedidoFecha.current
    setDiaMarcado(dia)
    precargarVecinas(dia)
    void Promise.all([precargar(urlColorDe(dia)), precargar(urlNdviDe(dia))])
      .catch(() => undefined)
      .then(() => {
        if (id === pedidoFecha.current) setDiaEvolucion(dia)
      })
  }

  // Reproducir: una fecha tras otra. Se rehace con cada fecha para no encimarse.
  useEffect(() => {
    if (!reproduciendo) return
    const espera = setTimeout(() => {
      const siguiente = diasHistoria[diasHistoria.indexOf(diaMarcado ?? ultimoDia ?? '') + 1]
      if (!siguiente) {
        setReproduciendo(false)
        return
      }
      verFecha(siguiente)
    }, 1000)
    return () => clearTimeout(espera)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reproduciendo, diaMarcado])

  const alternarReproduccion = () => {
    if (reproduciendo) {
      setReproduciendo(false)
      return
    }
    if ((diaMarcado ?? ultimoDia) === ultimoDia && diasHistoria[0]) verFecha(diasHistoria[0])
    setReproduciendo(true)
  }

  /** Clic en la regla: en los modos de dos fechas se mueve el marcador mas cercano. */
  const elegirDia = (dia: string) => {
    setReproduciendo(false)
    if (lineaLarga) {
      verFecha(dia)
      return
    }

    const grupo = grupos.find((g) => g.dia === dia)
    if (!grupo) {
      // La regla sale de lo precalculado antes de que responda el catalogo: el clic no se pierde.
      diaPendiente.current = dia
      return
    }

    if (!DOS_FECHAS.includes(modo)) {
      if (registroBase && dia === registroBase.dia) {
        soltarResultado()
        setPersonalizado(false)
        return
      }
      setSeleccion(grupo.escenas)
      setReferencia([])
      void calcular({ escenas: grupo.escenas, escenasReferencia: [] })
      return
    }

    const actual = seleccion[0]?.dia
    const previa = referencia[0]?.dia
    if (dia === actual || dia === previa) return

    const cerca = (otro: string | undefined) => (otro ? Math.abs(diasEntre(otro, dia)) : Infinity)
    let nuevaActual = cerca(actual) <= cerca(previa) ? dia : (actual ?? dia)
    let nuevaBase = cerca(actual) <= cerca(previa) ? (previa ?? '') : dia
    if (nuevaBase && nuevaBase > nuevaActual) [nuevaActual, nuevaBase] = [nuevaBase, nuevaActual]

    const escenas = grupos.find((g) => g.dia === nuevaActual)?.escenas ?? []
    const base = grupos.find((g) => g.dia === nuevaBase)?.escenas ?? []
    setSeleccion(escenas)
    setReferencia(base)
    if (registroBase && nuevaActual === registroBase.dia && nuevaBase === registroBase.diaBase) {
      soltarResultado()
      setPersonalizado(false)
      return
    }
    void calcular({ escenas, escenasReferencia: base })
  }

  const elegirDesdeGaleria = (escenas: Escena[]) => {
    const dia = escenas[0].dia
    const base = !DOS_FECHAS.includes(modo)
      ? []
      : referencia.length > 0 && referencia[0].dia !== dia
        ? referencia
        : (baseCercana(grupos, dia)?.escenas ?? [])
    setSeleccion(escenas)
    setReferencia(base)
    void calcular({ escenas, escenasReferencia: base })
  }

  useEffect(() => {
    const dia = diaPendiente.current
    if (!dia || grupos.length === 0) return
    diaPendiente.current = null
    elegirDia(dia)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupos])

  const lanzarEscurrimiento = useCallback(() => {
    if (!subcuencasCn) return

    setCalculandoEscurrimiento(true)
    setErrorEscurrimiento(null)

    try {
      const lectura = leerSubcuencas(subcuencasCn, condicionCn)
      // La politica va aqui y no en el servicio: el servicio tiene que poder
      // leer cualquier capa cuando se le pide. Una capa sin marco declarado es
      // la particion retirada copiada con el nombre nuevo, y sus cifras no
      // se cruzan con nada.
      if (!lectura.marco) {
        throw new Error(
          'La capa de número de curva no declara su marco (unidad y version_marco). No se calcula: puede ser la división retirada.',
        )
      }
      if (lectura.subcuencas.length === 0) {
        throw new Error('La capa no trae número de curva en esa condición')
      }

      setEscurrimiento(
        calcularEscurrimiento({
          lectura,
          lluviaMm,
          condicion: condicionCn,
          // Con la cifra suspendida, el numero de curva no sube sobre lo detectado.
          zonasObra: CIFRA_OBRA_SUSPENDIDA ? [] : (analisis?.zonasObra ?? []),
        }),
      )
    } catch (error: unknown) {
      setErrorEscurrimiento(error instanceof Error ? error.message : String(error))
      setEscurrimiento(null)
    } finally {
      setCalculandoEscurrimiento(false)
    }
  }, [subcuencasCn, condicionCn, lluviaMm, analisis])

  const lanzarProducto = useCallback(
    async (id: IdProducto) => {
      if (!areaBbox) return
      const areaGeojson = datosCapas[area]
      if (!areaGeojson) return

      const definicion = PRODUCTOS.find((p) => p.id === id)
      if (!definicion) return

      setCargandoProducto(id)
      setErrorProducto(null)

      try {
        const ruta = `${import.meta.env.BASE_URL}precalculado/${area}/${id}`
        const precalculado = await fetch(`${ruta}.json`).catch(() => null)

        if (precalculado?.ok) {
          const datos = (await precalculado.json()) as {
            limites: [[number, number], [number, number]]
            leyenda: EntradaLeyenda[]
            notas: string[]
            generado: string
          }
          // La capa de referencia manda sobre lo que hubiera pintado antes.
          soltarResultado()
          setProductoVista({
            fuente: { tipo: 'imagen', url: `${ruta}.png`, limites: datos.limites, clave: ruta },
            leyenda: datos.leyenda,
            notas: [
              ...datos.notas,
              `Precalculado al construir el sitio (${diaLocal(datos.generado)}), no en tu navegador.`,
            ],
          })
        } else {
          // Area sin precalculo: se calcula aqui, que es lo lento.
          const salida = await cargarProducto({
            producto: definicion,
            bbox: areaBbox,
            areaGeojson,
            etiquetaArea: NOMBRE_AREA[area] ?? area,
            tamano: 512,
          })
          soltarResultado()
          setProductoVista({
            fuente: { tipo: 'pintado', resultado: pintarResultado(salida) },
            leyenda: salida.leyenda,
            notas: salida.notas,
          })
        }

        setProducto(id)
      } catch (error: unknown) {
        setErrorProducto(error instanceof Error ? error.message : String(error))
        setProductoVista(null)
        setProducto(null)
      } finally {
        setCargandoProducto(null)
      }
    },
    [areaBbox, datosCapas, area, soltarResultado],
  )

  /** Abrir una herramienta ya muestra algo: no pide otro clic. */
  const alternarSeccion = (id: SeccionPanel) => {
    const abre = seccion !== id
    setSeccion(abre ? id : null)
    if (!abre) return
    if (id === 'referencia' && !producto) void lanzarProducto(PRODUCTOS[0].id)
    if (id === 'hidrologia' && subcuencasCn && !escurrimiento) lanzarEscurrimiento()
  }

  const lanzarSerie = useCallback(async () => {
    if (!areaBbox || !indice) return

    const areaGeojson = datosCapas[area]
    if (!areaGeojson) return

    const control = new AbortController()
    cancelarSerie.current = control

    setCalculandoSerie(true)
    setErrorSerie(null)
    setProgresoSerie({ hechas: 0, total: 0, dia: '' })

    try {
      const salida = await pedirSerie(
        {
          grupos,
          coleccion,
          indice,
          bbox: areaBbox,
          areaGeojson,
          quitarNubes,
          soloAgua,
          bandasAgua: bandasDelAgua(coleccion),
          // Rejilla gruesa a proposito: la media sobre miles de hectareas no
          // cambia por afinar la celda, y el tiempo de espera si.
          tamano: 128,
          maxFechas,
          coberturaMinima: 0.3,
        },
        (hechas, total, dia) => setProgresoSerie({ hechas, total, dia }),
        control.signal,
      )
      setSerie(salida)
    } catch (error: unknown) {
      setErrorSerie(error instanceof Error ? error.message : String(error))
      setSerie(null)
    } finally {
      setCalculandoSerie(false)
      setProgresoSerie(null)
      cancelarSerie.current = null
    }
  }, [areaBbox, indice, datosCapas, area, grupos, coleccion, quitarNubes, soloAgua, maxFechas])

  /**
   * Que se pinta encima del mapa.
   *
   * El color verdadero de una sola malla de Sentinel-2 se leia antes del COG
   * completo con georaster, sin pasar por el calculo. Se quito el 24 de
   * septiembre de 2026: esos paquetes de georaster usan `new Function` para
   * su polyfill de globalThis, la CSP del sitio lo bloquea, y la capa
   * descargaba el COG pero no pintaba nada. Se veia solo en produccion, nunca
   * en `npm run dev`, que no lleva cabeceras. Ahora el color verdadero sale
   * del mismo camino que los demas modos: bandas, worker e imagen. Tarda unos
   * segundos mas y funciona.
   */
  const fuenteModo = useMemo<FuenteRaster>(() => {
    // El desplazamiento gana: es un producto aparte que el usuario pidio ver.
    if (desplazamiento) return desplazamiento
    if (productoVista) return productoVista.fuente
    if (analisis) return { tipo: 'pintado', resultado: analisis }
    if (registro?.imagen && registro.limites) {
      return {
        tipo: 'imagen',
        url: `${import.meta.env.BASE_URL}apertura/${area}/${clave}.png`,
        limites: registro.limites,
        clave: `apertura:${area}:${clave}`,
      }
    }
    return null
  }, [desplazamiento, productoVista, analisis, registro, area, clave])

  // La misma serie al cambiar de fecha, otra al cambiar de area o de modulo: solo ahi hay barrido.
  const fuente: FuenteRaster =
    lineaLarga && modo === 'indice' && diaImagen && historia
      ? {
          tipo: 'imagen',
          url: urlNdviDe(diaImagen),
          limites: historia.limites,
          clave: `historia:${area}:${diaImagen}`,
          serie: `ndvi:${area}`,
        }
      : lineaLarga && modo === 'color'
        ? null
        : fuenteModo

  const errorRaster = errorAnalisis ?? estadoRaster.error
  const dosFechas = DOS_FECHAS.includes(modo)
  const diaActual = lineaLarga ? (diaMarcado ?? ultimoDia) : registro ? registro.dia : (seleccion[0]?.dia ?? null)
  const diaBase = !dosFechas ? null : registro ? registro.diaBase : (referencia[0]?.dia ?? null)
  const fechaVista = lineaLarga ? fechasHistoria.find((f) => f.dia === diaActual) : undefined
  const etiquetaArea = NOMBRE_AREA[area] ?? area

  const tituloResultado = productoVista
    ? (PRODUCTOS.find((p) => p.id === producto)?.etiqueta ?? 'Capa de referencia')
    : diaActual
      ? `${ETIQUETA_MODO[modo]} · ${diaActual}`
      : 'Resultado'

  const hectareasObra = (analisis?.zonasObra ?? []).reduce((suma, zona) => suma + zona.hectareas, 0)
  const hectareasVistas = useCifra(hectareasObra, 900, 1)

  const segundosCalculo = dosFechas ? 25 : 10

  /** El titulo cambia al hacer clic, sin esperar a nada. */
  const textoResultado = (): { frase: string; detalle: string; aviso: string | null } => {
    const fuenteDato = lineaLarga ? 'Sentinel-2 L2A' : (registro?.coleccion ?? coleccion.etiqueta)
    const fechas =
      diaActual && diaBase
        ? `${fechaBreve(diaBase)} a ${fechaBreve(diaActual, true)} · ${Math.abs(diasEntre(diaBase, diaActual))} días`
        : diaActual
          ? fechaBreve(diaActual, true)
          : ''
    const detalle = [etiquetaArea, fechas, fuenteDato.replace(' (SAR)', '')].filter(Boolean).join(' · ')
    const nombreModo =
      modo === 'indice' && indice
        ? `${NOMBRE_INDICE[indice.id] ?? ETIQUETA_MODO[modo]} (${indice.id.toUpperCase()})`
        : (TITULO_MODO[modo] ?? ETIQUETA_MODO[modo])

    if (productoVista) return { frase: tituloResultado, detalle: etiquetaArea, aviso: null }
    if (calculando) return { frase: nombreModo, detalle, aviso: null }
    if (lineaLarga) {
      const apartado = diaActual !== null && apartados.has(diaActual.slice(0, 7))
      return { frase: nombreModo, detalle, aviso: apartado ? `${ROTULO_LINEA_TIEMPO} ${NOTA_MES_APARTADO}` : ROTULO_LINEA_TIEMPO }
    }
    if (!registro && !analisis) {
      if (!personalizado) return { frase: nombreModo, detalle: `${etiquetaArea} · buscando imágenes...`, aviso: null }
      return { frase: nombreModo, detalle: `${detalle} · usa Recalcular en Ajustes`, aviso: null }
    }
    const aviso =
      registro?.aviso ??
      analisis?.aviso ??
      (modo === 'cambio' && analisis?.fenologia ? avisoFenologia(analisis.fenologia) : null)
    return { frase: modo === 'obra' ? fraseObra(hectareasVistas) : nombreModo, detalle, aviso }
  }
  const { frase, detalle, aviso } = textoResultado()

  // El fondo es de otra fecha cuando el dato no es de Sentinel-2 o se calculo otra fecha.
  const diaFondoVisto = diaImagen ?? datosArea?.diaFondo
  const notaFondo =
    !lineaLarga && !productoVista && diaActual && diaFondoVisto && diaActual !== diaFondoVisto
      ? `Imagen de fondo del ${fechaBreve(diaFondoVisto, true)}`
      : null

  const leyendaSerie: EntradaLeyenda[] | null =
    lineaLarga && modo === 'indice' && historia
      ? [0, 0.25, 0.5, 0.75, 1].map((t) => {
          const valor = historia.escala.p2 + t * (historia.escala.p98 - historia.escala.p2)
          return { color: colorDeIndice(valor, historia.escala.p2, historia.escala.p98), etiqueta: valor.toFixed(2) }
        })
      : lineaLarga
        ? []
        : null

  const leyendaEnMapa: EntradaLeyenda[] =
    leyendaSerie ??
    productoVista?.leyenda ??
    analisis?.leyenda ??
    registro?.leyenda ??
    (calculando && LEYENDA_DE_CATEGORIAS.includes(modo)
      ? (registroBase?.leyenda ?? []).map((entrada) => ({ ...entrada, detalle: undefined }))
      : [])
  const notasEnMapa =
    productoVista?.notas ??
    analisis?.notas ??
    (lineaLarga && diaActual
      ? [
          `Imagen del ${fechaBreve(diaActual, true)}, ${fechaVista?.nubes ?? 0} % de nubes sobre el área. Fuente: Sentinel-2 L2A (${fechaVista?.fuente ?? ''}).`,
          ...(fechaVista?.fuente === COLECCION_ANTERIOR ? [NOTA_PROCESADO_ANTERIOR] : []),
          `Toda la línea de tiempo lleva la misma escala, para que un cambio de color sea de la imagen y no del estiramiento. Se muestra una imagen limpia por mes; un mes sin imagen no tuvo ninguna con 10 % de nubes o menos.`,
          NOTA_CRITERIO,
        ]
      : (registro?.notas ?? []))

  // Lo que dicen los colores: cinco numeros solos no dicen nada.
  const sentidoLeyenda = productoVista
    ? null
    : modo === 'cambio'
      ? 'Hectáreas de cambio de cobertura, no de obra'
      : modo === 'indice' && indice && indice.id !== 'ndvi'
        ? indice.descripcion
        : null
  const extremosLeyenda: [string, string] | null = productoVista
    ? null
    : modo === 'indice'
      ? indice?.id === 'ndvi'
        ? ['Menos verde', 'Más verde']
        : ['Menos', 'Más']
      : modo === 'calor'
        ? ['Menos', 'Más']
        : null

  const miniaturas = useMemo(() => {
    const salida: Partial<Record<ModoVista, MiniaturaModo>> = {}
    if (!datosArea) return salida
    const base = `${import.meta.env.BASE_URL}apertura/${area}`
    const capa = (id: string) => {
      const r = datosArea.modos[id]
      return r?.imagen && r.limites ? { url: `${base}/${id}.png`, limites: r.limites } : null
    }
    salida.indice = { capa: capa('indice-ndvi') }
    salida.calor = { capa: capa('calor') }
    salida.agua = { capa: capa('agua') }
    salida.clases = { capa: capa('clases') }
    // Sin resultado de Cambio en la tarjeta: son entregable de los meses 3-4 (orden del MASTER).
    salida.obra = { capa: capa('obra') }
    return salida
  }, [datosArea, area])

  // La silueta es el municipio, mas el area si sale de el: la Cuenca Palote sale.
  const rutasFoco = useMemo(() => {
    const municipio = datosCapas.LIMITE
    if (!municipio) return []
    const propia = area !== 'LIMITE' && area !== 'LIMITE_URBANO' ? datosCapas[area] : null
    return propia ? [rutaSvg(municipio), rutaSvg(propia)] : [rutaSvg(municipio)]
  }, [datosCapas, area])

  const gruposRegla = lineaLarga ? fechasHistoria : grupos.length > 0 ? grupos : (datosArea?.fechas[coleccion.id] ?? [])
  // La serie de NDVI ya viene calculada; otro indice se pide con el boton del panel.
  const serieVista = serie ?? (indice?.id === 'ndvi' ? (datosArea?.serie ?? null) : null)

  // El fondo sale de la misma serie que la linea de tiempo: en Color, es lo que cambia de fecha.
  const fondoMapa =
    diaImagen && historia
      ? { url: urlColorDe(diaImagen), limites: historia.limites }
      : datosArea
        ? { url: `${baseApertura}/${area}/fondo.jpg`, limites: datosArea.limitesFondo }
        : null

  return (
    <div id="app">
      <PanelSecciones
        area={area}
        onArea={elegirArea}
        modo={productoVista ? null : modo}
        onModo={elegirModo}
        miniaturas={miniaturas}
        fondo={datosArea ? { url: `${baseApertura}/${area}/fondo.jpg`, limites: datosArea.limitesFondo } : null}
        encuadre={areaBbox}
        rutasFoco={rutasFoco}
        seccion={seccion}
        onSeccion={alternarSeccion}
      />

      <main id="centro">
        <div id="centro-fila">
          <section id="mapa">
            <div className="mapa-entra h-full">
              <Mapa
                capas={CAPAS}
                datosCapas={datosCapas}
                visibles={visibles}
                areaBbox={areaBbox}
                fuente={fuente}
                opacidad={opacidad}
                marcas={[]}
                fondo={fondo}
                imagenFondo={fondoMapa}
                rutasFoco={rutasFoco}
                onEstadoRaster={setEstadoRaster}
              />
            </div>

            {/* Los ids los usa el medidor de traslapes del departamento para nombrar el elemento en sus reportes. */}
            <div id="titulo">
              <h1 key={`${frase}`} className="sube">
                {frase}
              </h1>
              <p>
                {detalle}
                {notaFondo && ` · ${notaFondo}`}
              </p>
              {modo === 'indice' && !productoVista && (
                <div className="indices" role="radiogroup" aria-label="Índice">
                  {(indicesPosibles.length > 0 ? indicesPosibles : INDICES).map((definicion) => (
                    <button
                      key={definicion.id}
                      type="button"
                      role="radio"
                      aria-checked={indice?.id === definicion.id}
                      onClick={() => elegirIndice(definicion)}
                      title={definicion.descripcion}
                      className={indice?.id === definicion.id ? 'activa' : ''}
                    >
                      {definicion.id.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
              {(errorCapas || errorRaster || errorBusqueda) && (
                <div className="errores" role="alert">
                  {errorCapas && <p>No se pudieron cargar estas capas: {errorCapas}. El resto sigue disponible.</p>}
                  {errorRaster && <p>{errorRaster}</p>}
                  {errorBusqueda && <p>{errorBusqueda}</p>}
                </div>
              )}
            </div>

            <div id="controles">
              <button
                type="button"
                onClick={() => alternarSeccion('capas')}
                aria-pressed={seccion === 'capas'}
                data-testid="seccion-capas"
                className={seccion === 'capas' ? 'activa' : ''}
              >
                Capas
              </button>
              <button
                type="button"
                onClick={() => alternarSeccion('escenas')}
                aria-pressed={seccion === 'escenas'}
                data-testid="seccion-escenas"
                className={seccion === 'escenas' ? 'activa' : ''}
              >
                Ajustes
              </button>
            </div>

            <LecturaResultado
              titulo={tituloResultado}
              leyenda={leyendaEnMapa}
              extremos={extremosLeyenda}
              sentido={sentidoLeyenda}
              grupos={modo === 'clases' && !productoVista}
              aviso={aviso}
              notas={notasEnMapa}
              contraste={lineaLarga}
            />
          </section>

          {seccion && (
            <aside
              id="panel-lateral"
              className="flex max-h-[50%] min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-2xl bg-panel md:max-h-none md:w-96"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-filete px-4 py-2">
                <h2 className="text-[15px] font-semibold">{TITULO_SECCION[seccion]}</h2>
                <button type="button" onClick={() => setSeccion(null)} className="enlace">
                  Cerrar
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {seccion === 'capas' && (
                  <>
                    <ControlMapa visibles={visibles} onVisible={alternarVisible} fondo={fondo} onFondo={setFondo} />
                    <label className="block px-3.5 pb-3 text-xs">
                      <span className="mb-1 block text-tinta-suave">
                        Opacidad del resultado <span className="cifra text-tinta">{Math.round(opacidad * 100)} %</span>
                      </span>
                      <input
                        type="range"
                        min={0.2}
                        max={1}
                        step={0.05}
                        value={opacidad}
                        onChange={(e) => setOpacidad(Number(e.target.value))}
                        className="w-full"
                      />
                    </label>
                  </>
                )}

                {seccion === 'escenas' && (
                  <>
                    <PanelBusqueda
                      coleccion={coleccion}
                      onColeccion={cambiarColeccion}
                      desde={desde}
                      onDesde={setDesde}
                      hasta={hasta}
                      onHasta={setHasta}
                      nubesMax={nubesMax}
                      onNubesMax={setNubesMax}
                      buscando={buscando}
                      onBuscar={lanzarBusqueda}
                      plegado={false}
                      onDesplegar={() => undefined}
                    />
                    <PanelAnalisis
                      sinModos
                      escenas={seleccion}
                      coleccion={coleccion}
                      modo={modo}
                      onModo={elegirModo}
                      indices={indicesPosibles}
                      indice={indice}
                      onIndice={(id) => {
                        setIndice(indicesPosibles.find((i) => i.id === id) ?? null)
                        limpiarAnalisis()
                      }}
                      bandasDisponibles={bandasDisponibles}
                      bandasKmeans={bandasKmeans}
                      onBandaKmeans={alternarBandaKmeans}
                      k={k}
                      onK={setK}
                      tamano={tamano}
                      onTamano={setTamano}
                      calculando={calculando}
                      onCalcular={() => void calcular()}
                      error={errorRaster}
                      diasReferencia={diasReferencia}
                      referencia={referencia}
                      onDiaReferencia={(dia) => {
                        setReferencia(grupos.find((grupo) => grupo.dia === dia)?.escenas ?? [])
                        limpiarAnalisis()
                      }}
                      umbralCambio={umbralCambio}
                      onUmbralCambio={(valor) => {
                        setUmbralCambio(valor)
                        limpiarAnalisis()
                      }}
                      umbralObra={umbralObra}
                      onUmbralObra={(valor) => {
                        setUmbralObra(valor)
                        limpiarAnalisis()
                      }}
                      umbralAguaDb={umbralAguaDb}
                      onUmbralAguaDb={(valor) => {
                        setUmbralAguaDb(valor)
                        limpiarAnalisis()
                      }}
                      areaMinimaObra={areaMinimaObra}
                      onAreaMinimaObra={(valor) => {
                        setAreaMinimaObra(valor)
                        limpiarAnalisis()
                      }}
                      quitarNubes={quitarNubes}
                      onQuitarNubes={(valor) => {
                        setQuitarNubes(valor)
                        limpiarAnalisis()
                      }}
                      soloAgua={soloAgua}
                      onSoloAgua={(valor) => {
                        setSoloAgua(valor)
                        limpiarAnalisis()
                      }}
                    />
                  </>
                )}

                {seccion === 'serie' && (
                  <PanelSerie
                    indice={indicesPosibles.find((i) => i.id === indice?.id) ?? null}
                    fechasDisponibles={grupos.length}
                    maxFechas={maxFechas}
                    onMaxFechas={setMaxFechas}
                    calculando={calculandoSerie}
                    progreso={progresoSerie}
                    resultado={serieVista}
                    error={errorSerie}
                    onCalcular={lanzarSerie}
                    onCancelar={() => cancelarSerie.current?.abort()}
                  />
                )}

                {seccion === 'referencia' && (
                  <PanelProductos
                    activo={producto}
                    cargando={cargandoProducto}
                    error={errorProducto}
                    onCargar={lanzarProducto}
                    onQuitar={() => {
                      setProducto(null)
                      setProductoVista(null)
                    }}
                  />
                )}

                {seccion === 'hidrologia' && (
                  <>
                    <PanelEscurrimiento
                      disponible={subcuencasCn !== null}
                      lluviaMm={lluviaMm}
                      onLluviaMm={setLluviaMm}
                      condicion={condicionCn}
                      onCondicion={setCondicionCn}
                      zonasObra={CIFRA_OBRA_SUSPENDIDA ? 0 : (analisis?.zonasObra?.length ?? 0)}
                      calculando={calculandoEscurrimiento}
                      resultado={escurrimiento}
                      error={errorEscurrimiento}
                      onCalcular={lanzarEscurrimiento}
                    />

                    <PanelInsar
                      bbox={areaBbox}
                      desde={desde}
                      hasta={hasta}
                      onCargarDesplazamiento={(href, limite) => {
                        soltarResultado()
                        setDesplazamiento(href ? { tipo: 'insar', href, limite } : null)
                      }}
                    />
                  </>
                )}
              </div>
            </aside>
          )}
        </div>

        <ReglaFechas
          grupos={gruposRegla}
          actual={diaActual}
          base={diaBase}
          dosFechas={dosFechas}
          calculando={calculando}
          segundos={segundosCalculo}
          puedeReproducir={lineaLarga && diasHistoria.length > 1}
          reproduciendo={reproduciendo}
          onReproducir={alternarReproduccion}
          onElegir={elegirDia}
          onGaleria={() => setGaleriaAbierta(true)}
        />
      </main>

      {galeriaAbierta && (
        <GaleriaEscenas
          grupos={grupos}
          seleccion={seleccion}
          coleccion={coleccion.etiqueta}
          onElegir={elegirDesdeGaleria}
          onCerrar={() => setGaleriaAbierta(false)}
        />
      )}
    </div>
  )
}
