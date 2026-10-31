import { useEffect, useRef, useState } from 'react'
import { CAPAS_AREA } from '../datos/capas'
import { xDe, yDe } from '../lib/proyeccion'
import type { IdCapa, ModoVista } from '../tipos'
import VeloFoco from './VeloFoco'

export type SeccionPanel = 'escenas' | 'serie' | 'referencia' | 'hidrologia' | 'capas'

type Limites = [[number, number], [number, number]]

const NOMBRE_AREA: Partial<Record<IdCapa, string>> = {
  LIMITE: 'Municipio',
  LIMITE_URBANO: 'Zona urbana',
  CUENCA_PALOTE: 'Cuenca Palote',
}

const MODOS: { id: ModoVista; nombre: string; frase: string }[] = [
  { id: 'color', nombre: 'Cómo se ve', frase: 'La imagen de satélite, sin procesar' },
  { id: 'indice', nombre: 'Vegetación', frase: 'Dónde hay verde' },
  { id: 'calor', nombre: 'Calor', frase: 'Qué tan caliente está el suelo' },
  { id: 'agua', nombre: 'Agua', frase: 'Dónde hay agua, por radar' },
  { id: 'clases', nombre: 'Zonas parecidas', frase: 'Grupos sin nombre, no son tipos de suelo' },
  { id: 'cambio', nombre: 'Cambios', frase: 'Qué cambió entre dos fechas' },
  { id: 'obra', nombre: 'Obra nueva', frase: 'Cifra en corrección' },
]

const HERRAMIENTAS: { id: SeccionPanel; etiqueta: string }[] = [
  { id: 'serie', etiqueta: 'Evolución' },
  { id: 'referencia', etiqueta: 'Capas globales' },
  { id: 'hidrologia', etiqueta: 'Escurrimiento' },
]

/** Lo que cada tarjeta muestra de su modo. */
export interface MiniaturaModo {
  capa: { url: string; limites: Limites } | null
}

interface Props {
  area: IdCapa
  onArea: (id: IdCapa) => void
  modo: ModoVista | null
  onModo: (modo: ModoVista) => void
  miniaturas: Partial<Record<ModoVista, MiniaturaModo>>
  fondo: { url: string; limites: Limites } | null
  /** Encuadre de las tarjetas, [oeste, sur, este, norte]. */
  encuadre: [number, number, number, number] | null
  rutasFoco: string[]
  seccion: SeccionPanel | null
  onSeccion: (id: SeccionPanel) => void
}

function Miniatura({ fondo, capa, encuadre, rutasFoco }: { fondo: Props['fondo']; capa: MiniaturaModo['capa']; encuadre: Props['encuadre']; rutasFoco: string[] }) {
  const caja = useRef<HTMLDivElement>(null)
  const [tamano, setTamano] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = caja.current
    if (!el) return
    const observador = new ResizeObserver(() => setTamano({ w: el.clientWidth, h: el.clientHeight }))
    observador.observe(el)
    return () => observador.disconnect()
  }, [])

  if (!fondo || !encuadre) return <div ref={caja} className="mini" />

  // Encuadra el area dejando abajo el lugar del nombre.
  const anchoMundo = xDe(encuadre[2]) - xDe(encuadre[0])
  const altoMundo = yDe(encuadre[1]) - yDe(encuadre[3])
  const escala = Math.min((tamano.w - 8) / anchoMundo, (tamano.h - 22) / altoMundo) || 0
  const tx = (tamano.w - anchoMundo * escala) / 2 - xDe(encuadre[0]) * escala
  const ty = 4 + (tamano.h - 22 - altoMundo * escala) / 2 - yDe(encuadre[3]) * escala
  const estiloCaja = (l: Limites) => ({
    left: xDe(l[0][1]),
    top: yDe(l[1][0]),
    width: xDe(l[1][1]) - xDe(l[0][1]),
    height: yDe(l[0][0]) - yDe(l[1][0]),
  })
  const f = estiloCaja(fondo.limites)

  return (
    <div ref={caja} className="mini">
      <div className="mini-mundo" style={{ transform: `translate(${tx}px, ${ty}px) scale(${escala})` }}>
        <img src={fondo.url} alt="" style={estiloCaja(fondo.limites)} />
        {capa && <img src={capa.url} alt="" style={estiloCaja(capa.limites)} />}
        <svg style={f} viewBox={`${f.left} ${f.top} ${f.width} ${f.height}`}>
          <VeloFoco limites={fondo.limites} rutas={rutasFoco} />
        </svg>
      </div>
    </div>
  )
}

/** El panel en flujo: las secciones se eligen viendolas, con su nombre siempre a la vista. */
export default function PanelSecciones({
  area,
  onArea,
  modo,
  onModo,
  miniaturas,
  fondo,
  encuadre,
  rutasFoco,
  seccion,
  onSeccion,
}: Props) {
  return (
    <nav id="panel-secciones" aria-label="Secciones">
      <div className="marca">
        <img src={`${import.meta.env.BASE_URL}logo-sapal-blanco.png`} alt="SAPAL" />
        <h1>
          Observatorio
          <br />
          satelital
        </h1>
      </div>

      <div className="areas" role="radiogroup" aria-label="Área">
        {CAPAS_AREA.map((capa) => (
          <button
            key={capa.id}
            type="button"
            role="radio"
            aria-checked={area === capa.id}
            onClick={() => onArea(capa.id)}
            data-testid={`area-${capa.id}`}
            title={capa.etiqueta}
            className={area === capa.id ? 'activa' : ''}
          >
            {NOMBRE_AREA[capa.id] ?? capa.etiqueta}
          </button>
        ))}
      </div>

      <div className="tarjetas">
        {MODOS.map((opcion) => (
          <button
            key={opcion.id}
            type="button"
            onClick={() => onModo(opcion.id)}
            aria-pressed={modo === opcion.id}
            data-testid={`modo-${opcion.id}`}
            className={`tarjeta ${modo === opcion.id ? 'activa' : ''}`}
          >
            <Miniatura fondo={fondo} capa={miniaturas[opcion.id]?.capa ?? null} encuadre={encuadre} rutasFoco={rutasFoco} />
            <span>
              <b>{opcion.nombre}</b>
              <small>{opcion.frase}</small>
            </span>
          </button>
        ))}
      </div>

      <div className="mas">
        {HERRAMIENTAS.map((opcion) => (
          <button
            key={opcion.id}
            type="button"
            onClick={() => onSeccion(opcion.id)}
            aria-pressed={seccion === opcion.id}
            data-testid={`seccion-${opcion.id}`}
            className={seccion === opcion.id ? 'activa' : ''}
          >
            {opcion.etiqueta}
          </button>
        ))}
      </div>
    </nav>
  )
}
