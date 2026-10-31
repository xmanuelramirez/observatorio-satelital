import { CAPAS_AREA } from '../datos/capas'
import type { DefinicionIndice } from '../servicios/indices'
import type { IdCapa, ModoVista } from '../tipos'

export type SeccionPanel = 'escenas' | 'serie' | 'referencia' | 'hidrologia' | 'capas'

const NOMBRE_AREA: Partial<Record<IdCapa, string>> = {
  LIMITE: 'Municipio',
  LIMITE_URBANO: 'Zona urbana',
  CUENCA_PALOTE: 'Cuenca Palote',
}

const MODOS: { id: ModoVista; etiqueta: string }[] = [
  { id: 'color', etiqueta: 'Color' },
  { id: 'indice', etiqueta: 'Vegetación' },
  { id: 'calor', etiqueta: 'Calor' },
  { id: 'agua', etiqueta: 'Agua' },
  { id: 'clases', etiqueta: 'Clases' },
  { id: 'cambio', etiqueta: 'Cambio' },
  { id: 'obra', etiqueta: 'Obra nueva' },
]

const HERRAMIENTAS: { id: SeccionPanel; etiqueta: string }[] = [
  { id: 'serie', etiqueta: 'Serie' },
  { id: 'referencia', etiqueta: 'Capas globales' },
  { id: 'hidrologia', etiqueta: 'Escurrimiento' },
]

interface Props {
  area: IdCapa
  onArea: (id: IdCapa) => void
  /** Nulo con una capa global en el mapa: ningun modo es el que se esta viendo. */
  modo: ModoVista | null
  onModo: (modo: ModoVista) => void
  /** Dia de la imagen de cada modo: Agua y Calor pueden traer otro. */
  fechas: Partial<Record<ModoVista, string>>
  indices: DefinicionIndice[]
  indice: DefinicionIndice | null
  onIndice: (indice: DefinicionIndice) => void
  seccion: SeccionPanel | null
  onSeccion: (id: SeccionPanel) => void
}

function fechaBreve(dia: string | undefined): string {
  if (!dia) return ''
  return new Date(`${dia}T12:00:00Z`)
    .toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .replace('.', '')
}

/**
 * Todas las secciones a la vista y por su nombre, siempre en el mismo lugar. Va en
 * el flujo de la pagina, asi que no puede encimarse con el mapa.
 */
export default function ColumnaSecciones({
  area,
  onArea,
  modo,
  onModo,
  fechas,
  indices,
  indice,
  onIndice,
  seccion,
  onSeccion,
}: Props) {
  return (
    <nav id="columna-secciones" aria-label="Secciones" className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-panel">
      <h1 className="px-4 pb-1 pt-3 text-[15px] font-semibold leading-tight tracking-tight">Observatorio satelital</h1>

      <h2 className="columna-grupo">Área</h2>
      <div role="radiogroup" aria-label="Área">
        {CAPAS_AREA.map((capa) => (
          <button
            key={capa.id}
            type="button"
            role="radio"
            aria-checked={area === capa.id}
            onClick={() => onArea(capa.id)}
            data-testid={`area-${capa.id}`}
            title={capa.etiqueta}
            className={`seccion ${area === capa.id ? 'seccion-activa' : ''}`}
          >
            {NOMBRE_AREA[capa.id] ?? capa.etiqueta}
          </button>
        ))}
      </div>

      <h2 className="columna-grupo">Análisis</h2>
      {MODOS.map((opcion) => (
        <div key={opcion.id}>
          <button
            type="button"
            onClick={() => onModo(opcion.id)}
            aria-pressed={modo === opcion.id}
            data-testid={`modo-${opcion.id}`}
            className={`seccion ${modo === opcion.id ? 'seccion-activa' : ''}`}
          >
            {opcion.etiqueta}
            <span className="seccion-fecha">{fechaBreve(fechas[opcion.id])}</span>
          </button>

          {opcion.id === 'indice' && modo === 'indice' && (
            <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 pb-1 pl-6 pr-3" role="radiogroup" aria-label="Índice">
              {indices.map((definicion) => (
                <button
                  key={definicion.id}
                  type="button"
                  role="radio"
                  aria-checked={indice?.id === definicion.id}
                  onClick={() => onIndice(definicion)}
                  title={definicion.descripcion}
                  className={`palabra ${indice?.id === definicion.id ? 'palabra-activa' : ''}`}
                >
                  {definicion.id.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}

      <h2 className="columna-grupo">Herramientas</h2>
      {HERRAMIENTAS.map((opcion) => (
        <button
          key={opcion.id}
          type="button"
          onClick={() => onSeccion(opcion.id)}
          aria-pressed={seccion === opcion.id}
          data-testid={`seccion-${opcion.id}`}
          className={`seccion ${seccion === opcion.id ? 'seccion-activa' : ''}`}
        >
          {opcion.etiqueta}
        </button>
      ))}

      <div className="mt-auto flex shrink-0 gap-4 border-t border-filete px-4 py-2">
        <button
          type="button"
          onClick={() => onSeccion('capas')}
          aria-pressed={seccion === 'capas'}
          data-testid="seccion-capas"
          className={`palabra ${seccion === 'capas' ? 'palabra-activa' : ''}`}
        >
          Capas
        </button>
        <button
          type="button"
          onClick={() => onSeccion('escenas')}
          aria-pressed={seccion === 'escenas'}
          data-testid="seccion-escenas"
          className={`palabra ${seccion === 'escenas' ? 'palabra-activa' : ''}`}
        >
          Ajustes
        </button>
      </div>
    </nav>
  )
}
