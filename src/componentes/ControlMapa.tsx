import { CAPAS } from '../datos/capas'
import type { IdFondo } from './Mapa'
import type { IdCapa } from '../tipos'
import { ETIQUETA_FONDO } from '../datos/fondos'

interface Props {
  visibles: Set<IdCapa>
  onVisible: (id: IdCapa) => void
  fondo: IdFondo
  onFondo: (valor: IdFondo) => void
}

/** Capas vectoriales y mapa de referencia. Vive como una seccion mas del menu flotante. */
export default function ControlMapa({ visibles, onVisible, fondo, onFondo }: Props) {
  return (
    <div className="px-3.5 py-3 text-xs">
      <div className="space-y-1.5">
        {CAPAS.map((capa) => (
          <label key={capa.id} className="flex cursor-pointer items-center gap-2 text-[13px]">
            <input type="checkbox" checked={visibles.has(capa.id)} onChange={() => onVisible(capa.id)} />
            <span className="inline-block h-0.75 w-4 shrink-0" style={{ background: capa.color }} />
            {capa.etiqueta}
          </label>
        ))}
      </div>

      <p className="rotulo mb-1.5 mt-3">Mapa de referencia</p>
      <div className="flex gap-px border border-filete bg-filete">
        {(Object.keys(ETIQUETA_FONDO) as IdFondo[]).map((opcion) => (
          <button
            key={opcion}
            type="button"
            onClick={() => onFondo(opcion)}
            aria-pressed={fondo === opcion}
            className={`pestana ${fondo === opcion ? 'pestana-activa' : ''}`}
          >
            {ETIQUETA_FONDO[opcion]}
          </button>
        ))}
      </div>
    </div>
  )
}
