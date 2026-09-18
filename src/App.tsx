import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import { CAPAS } from './datos/capas'
import { COLECCION_POR_DEFECTO, buscarColeccion } from './datos/colecciones'
import { bboxDe, cargarGeojson } from './servicios/geojson'
import { buscarEscenas, type ResultadoBusqueda } from './servicios/stac'
import { bandasDelAgua, type EntradaLeyenda } from './servicios/analisis'
import { pedirAnalisis, pedirSerie } from './servicios/calculo'
import { pintarResultado, type ResultadoPintado } from './servicios/pintura'
import { INDICES, indicesDisponibles, type DefinicionIndice } from './servicios/indices'
import type { Bbox, Escena, GrupoDia, IdCapa, ModoVista, NombreBanda } from './tipos'
import { diaLocal } from './lib/fecha'
import type { FuenteRaster } from './componentes/CapaAnalisis'
import Mapa, { type IdFondo } from './componentes/Mapa'
import PanelBusqueda from './componentes/PanelBusqueda'
import SelectorArea from './componentes/SelectorArea'
import ControlMapa from './componentes/ControlMapa'
import TarjetaResultado from './componentes/TarjetaResultado'
import PanelInsar from './componentes/PanelInsar'
import ListaEscenas from './componentes/ListaEscenas'
import PanelAnalisis from './componentes/PanelAnalisis'
import PanelSerie from './componentes/PanelSerie'
import PanelProductos from './componentes/PanelProductos'
import PanelEscurrimiento from './componentes/PanelEscurrimiento'
import {
  calcularEscurrimiento,
  leerSubcuencas,
  type CondicionCn,
  type ResultadoEscurrimiento,
} from './servicios/escurrimiento'
import { cargarProducto, PRODUCTOS, type IdProducto } from './servicios/productos'
import type { ResultadoSerie } from './servicios/serie'

type Pestana = 'escenas' | 'serie' | 'referencia' | 'hidrologia'

const PESTANAS: { id: Pestana; etiqueta: string }[] = [
  { id: 'escenas', etiqueta: 'Escenas' },
  { id: 'serie', etiqueta: 'Serie' },
  { id: 'referencia', etiqueta: 'Referencia' },
  { id: 'hidrologia', etiqueta: 'Hidrología' },
]

const ETIQUETA_MODO: Record<ModoVista, string> = {
  indice: 'Índice',
  cambio: 'Cambio',
  obra: 'Obra nueva',
  calor: 'Temperatura',
  agua: 'Agua por radar',
  clases: 'Clases',
  color: 'Color',
}

// Dia de Leon, no dia UTC: con toISOString, despues de las 18:00 locales
// "hoy" ya era manana.
function haceDias(dias: number): string {
  return diaLocal(Date.now() - dias * 86_400_000)
}

function hoy(): string {
  return diaLocal(new Date())
}

export default function App() {
  const [datosCapas, setDatosCapas] = useState<Record<string, FeatureCollection>>({})
  const [errorCapas, setErrorCapas] = useState<string | null>(null)
  const [visibles, setVisibles] = useState<Set<IdCapa>>(
    () => new Set(CAPAS.filter((c) => c.visiblePorDefecto).map((c) => c.id)),
  )

  const [area, setArea] = useState<IdCapa>('LIMITE')
  const [coleccion, setColeccion] = useState(COLECCION_POR_DEFECTO)
  const [desde, setDesde] = useState(() => haceDias(90))
  const [hasta, setHasta] = useState(hoy)
  const [nubesMax, setNubesMax] = useState(20)

  const [resultado, setResultado] = useState<ResultadoBusqueda | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null)
  /** Escenas activas, siempre del mismo dia. Mas de una significa mosaico. */
  const [seleccion, setSeleccion] = useState<Escena[]>([])

  const [modo, setModo] = useState<ModoVista>('indice')
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

  const [pestana, setPestana] = useState<Pestana>('escenas')
  const [busquedaPlegada, setBusquedaPlegada] = useState(false)

  const [opacidad, setOpacidad] = useState(1)
  const [fondo, setFondo] = useState<IdFondo>('ninguno')
  const [estadoRaster, setEstadoRaster] = useState<{ cargando: boolean; error: string | null }>({
    cargando: false,
    error: null,
  })

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
    cargarGeojson('capas/NUMERO_DE_CURVA.geojson')
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

  const limpiarAnalisis = useCallback(() => {
    setAnalisis(null)
    setErrorAnalisis(null)
  }, [])

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

  /**
   * Alterna una escena dentro del dia. Tocar una escena de otra fecha reinicia
   * la seleccion: un mosaico que mezclara dos fechas juntaria en una sola capa
   * terreno visto en momentos distintos, que es justo lo que el modo cambio
   * existe para separar.
   */
  const alternarEscena = useCallback(
    (escena: Escena) => {
      setSeleccion((previas) => {
        if (previas.length > 0 && previas[0].dia !== escena.dia) return [escena]
        const ya = previas.some((otra) => otra.id === escena.id)
        if (!ya) return [...previas, escena]
        return previas.filter((otra) => otra.id !== escena.id)
      })
      setReferencia((previa) => (previa.length > 0 && previa[0].dia !== escena.dia ? previa : []))
      limpiarAnalisis()
    },
    [limpiarAnalisis],
  )

  const seleccionarDia = useCallback(
    (escenasDelDia: Escena[]) => {
      setSeleccion(escenasDelDia)
      setReferencia((previa) =>
        previa.length > 0 && previa[0].dia !== escenasDelDia[0].dia ? previa : [],
      )
      limpiarAnalisis()
    },
    [limpiarAnalisis],
  )

  const alternarBandaKmeans = useCallback((banda: NombreBanda) => {
    setBandasKmeans((previas) =>
      previas.includes(banda) ? previas.filter((b) => b !== banda) : [...previas, banda],
    )
  }, [])

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
      setResultado(salida)
      setSerie(null)
      setBusquedaPlegada(true)
    } catch (error: unknown) {
      setErrorBusqueda(error instanceof Error ? error.message : String(error))
      setResultado(null)
    } finally {
      setBuscando(false)
    }
  }, [areaBbox, coleccion, desde, hasta, nubesMax, limpiarAnalisis])

  const lanzarAnalisis = useCallback(async () => {
    if (seleccion.length === 0 || !areaBbox) return

    setCalculando(true)
    setErrorAnalisis(null)

    try {
      const areaGeojson = datosCapas[area]
      if (!areaGeojson) throw new Error('El area todavia no termina de cargar')

      // Un analisis nuevo reemplaza a lo que hubiera en el mapa.
      setDesplazamiento(null)
      setProductoVista(null)
      setProducto(null)

      const salida = await pedirAnalisis({
        escenas: seleccion,
        escenasReferencia: referencia,
        coleccion,
        bbox: areaBbox,
        areaGeojson,
        etiquetaArea: CAPAS.find((c) => c.id === area)?.etiqueta ?? area,
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
      })
      setAnalisis(salida)
    } catch (error: unknown) {
      setErrorAnalisis(error instanceof Error ? error.message : String(error))
      setAnalisis(null)
    } finally {
      setCalculando(false)
    }
  }, [
    seleccion,
    referencia,
    areaBbox,
    datosCapas,
    area,
    coleccion,
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
  ])

  const lanzarEscurrimiento = useCallback(() => {
    if (!subcuencasCn) return

    setCalculandoEscurrimiento(true)
    setErrorEscurrimiento(null)

    try {
      const subcuencas = leerSubcuencas(subcuencasCn, condicionCn)
      if (subcuencas.length === 0) {
        throw new Error('La capa no trae número de curva en esa condición')
      }

      setEscurrimiento(
        calcularEscurrimiento({
          subcuencas,
          lluviaMm,
          condicion: condicionCn,
          zonasObra: analisis?.zonasObra ?? [],
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
          setProductoVista({
            fuente: { tipo: 'imagen', url: `${ruta}.png`, limites: datos.limites, clave: ruta },
            leyenda: datos.leyenda,
            notas: [
              ...datos.notas,
              `Precalculado al construir el sitio (${datos.generado.slice(0, 10)}), no en tu navegador.`,
            ],
          })
        } else {
          // Area sin precalculo: se calcula aqui, que es lo lento.
          const salida = await cargarProducto({
            producto: definicion,
            bbox: areaBbox,
            areaGeojson,
            etiquetaArea: CAPAS.find((c) => c.id === area)?.etiqueta ?? area,
            tamano: 512,
          })
          setProductoVista({
            fuente: { tipo: 'pintado', resultado: pintarResultado(salida) },
            leyenda: salida.leyenda,
            notas: salida.notas,
          })
        }

        setProducto(id)
        // La capa de referencia manda sobre lo que hubiera pintado antes.
        limpiarAnalisis()
        setDesplazamiento(null)
      } catch (error: unknown) {
        setErrorProducto(error instanceof Error ? error.message : String(error))
        setProductoVista(null)
        setProducto(null)
      } finally {
        setCargandoProducto(null)
      }
    },
    [areaBbox, datosCapas, area, limpiarAnalisis],
  )

  // Cambiar de area con una capa de referencia puesta la vuelve a cargar para
  // la nueva area; sin esto se quedaba pintada la del area anterior.
  useEffect(() => {
    if (producto) void lanzarProducto(producto)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area])

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
   * El color verdadero de Sentinel-2 se lee del COG completo, que da mas
   * detalle que la rejilla de analisis. Todo lo demas sale de las bandas.
   */
  const fuente = useMemo<FuenteRaster>(() => {
    // El desplazamiento gana: es un producto aparte que el usuario pidio ver.
    if (desplazamiento) return desplazamiento
    if (productoVista) return productoVista.fuente
    if (analisis) return { tipo: 'pintado', resultado: analisis }
    // Con dos mallas el atajo no sirve: cada COG trae su propia zona UTM y
    // pintarlos encima no es un mosaico. Ahi hay que pasar por el calculo.
    if (seleccion.length === 1 && modo === 'color' && coleccion.assetColorVerdadero) {
      const asset = seleccion[0].assets[coleccion.assetColorVerdadero]
      if (asset) return { tipo: 'cog', href: asset.href }
    }
    return null
  }, [desplazamiento, productoVista, analisis, seleccion, modo, coleccion])

  const errorRaster = errorAnalisis ?? estadoRaster.error

  const tituloResultado = productoVista
    ? (PRODUCTOS.find((p) => p.id === producto)?.etiqueta ?? 'Capa de referencia')
    : analisis && seleccion.length > 0
      ? `${ETIQUETA_MODO[modo]} · ${seleccion[0].dia}`
      : 'Resultado'

  const leyendaEnMapa = productoVista?.leyenda ?? analisis?.leyenda ?? []
  const notasEnMapa = productoVista?.notas ?? analisis?.notas ?? []

  return (
    <div className="flex h-full">
      <aside className="flex w-90 shrink-0 flex-col border-r border-filete bg-panel">
        <header className="border-b border-filete-fuerte bg-panel-hondo px-4 py-3.5">
          <p className="rotulo">Planeación Hídrica · León</p>
          <h1 className="mt-1 text-[17px] font-semibold tracking-tight">Observatorio satelital</h1>
        </header>

        {errorCapas && (
          <p className="border-b border-filete px-4 py-3 text-xs text-peligro" role="alert">
            No se pudieron cargar estas capas: {errorCapas}. El resto sigue disponible.
          </p>
        )}

        <SelectorArea area={area} onArea={setArea} />

        {/*
          Cuatro pestanas por tipo de trabajo, en vez de una columna con todo
          apilado: antes habia que bajar por nueve secciones para llegar al
          analisis de una escena.
        */}
        <nav className="flex gap-px border-b border-filete bg-filete" role="tablist">
          {PESTANAS.map((opcion) => (
            <button
              key={opcion.id}
              type="button"
              role="tab"
              aria-selected={pestana === opcion.id}
              onClick={() => setPestana(opcion.id)}
              className={`pestana ${pestana === opcion.id ? 'pestana-activa' : ''}`}
            >
              {opcion.etiqueta}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto" role="tabpanel">
          {pestana === 'escenas' && (
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
                plegado={busquedaPlegada}
                onDesplegar={() => setBusquedaPlegada(false)}
              />

              {/* La lista se desplaza sola para que el analisis no quede al fondo. */}
              <div className="max-h-[32vh] overflow-y-auto border-b border-filete">
                <ListaEscenas
                  grupos={grupos}
                  totalCoincidencias={resultado?.totalCoincidencias ?? null}
                  seleccion={seleccion}
                  onAlternar={alternarEscena}
                  onDiaCompleto={seleccionarDia}
                  buscando={buscando}
                  error={errorBusqueda}
                  yaBusco={resultado !== null || errorBusqueda !== null}
                />
              </div>

              <PanelAnalisis
                escenas={seleccion}
                coleccion={coleccion}
                modo={modo}
                onModo={(nuevo) => {
                  setModo(nuevo)
                  limpiarAnalisis()
                }}
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
                onCalcular={lanzarAnalisis}
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

          {pestana === 'serie' && (
            <PanelSerie
              indice={indice}
              fechasDisponibles={grupos.length}
              maxFechas={maxFechas}
              onMaxFechas={setMaxFechas}
              calculando={calculandoSerie}
              progreso={progresoSerie}
              resultado={serie}
              error={errorSerie}
              onCalcular={lanzarSerie}
              onCancelar={() => cancelarSerie.current?.abort()}
            />
          )}

          {pestana === 'referencia' && (
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

          {pestana === 'hidrologia' && (
            <>
              <PanelEscurrimiento
                disponible={subcuencasCn !== null}
                lluviaMm={lluviaMm}
                onLluviaMm={setLluviaMm}
                condicion={condicionCn}
                onCondicion={setCondicionCn}
                zonasObra={analisis?.zonasObra?.length ?? 0}
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
                  limpiarAnalisis()
                  setDesplazamiento(href ? { tipo: 'insar', href, limite } : null)
                }}
              />
            </>
          )}
        </div>
      </aside>

      <main className="relative min-w-0 flex-1">
        <Mapa
          capas={CAPAS}
          datosCapas={datosCapas}
          visibles={visibles}
          areaBbox={areaBbox}
          escenas={seleccion}
          fuente={fuente}
          opacidad={opacidad}
          marcas={desplazamiento || productoVista ? [] : (analisis?.marcas ?? [])}
          fondo={fondo}
          onEstadoRaster={setEstadoRaster}
        />

        <ControlMapa visibles={visibles} onVisible={alternarVisible} fondo={fondo} onFondo={setFondo} />

        <TarjetaResultado titulo={tituloResultado} leyenda={leyendaEnMapa} notas={notasEnMapa} />

        {seleccion.length > 0 && (
          <div className="absolute right-3 top-3 z-1000 w-76 border border-filete-fuerte bg-panel-hondo/95 text-xs">
            <div className="border-b border-filete px-3.5 py-3">
              <p className="rotulo">Escena en el mapa</p>
              <p className="cifra mt-1.5 text-[13px] font-semibold text-tinta">
                {seleccion[0].dia} · {seleccion.map((e) => e.malla || e.plataforma).join(' y ')}
              </p>
              {seleccion.length > 1 && (
                <p className="mt-1 text-acento">Mosaico de {seleccion.length} mallas</p>
              )}

              {(estadoRaster.cargando || calculando) && (
                <p className="mt-2 text-acento" role="status">
                  {calculando ? 'Leyendo bandas...' : 'Pintando sobre el mapa...'}
                </p>
              )}
            </div>

            <div className="px-3.5 py-3">
              <label className="block">
                <span className="mb-1 block text-tinta-suave">
                  Opacidad <span className="cifra text-tinta">{Math.round(opacidad * 100)} %</span>
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

              <button
                type="button"
                onClick={() => {
                  setSeleccion([])
                  setReferencia([])
                  limpiarAnalisis()
                }}
                className="boton mt-2.5 w-full"
              >
                Quitar del mapa
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
