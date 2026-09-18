import { useState } from 'react'
import { CAPAS } from '../datos/capas'
import type { IdFondo } from './Mapa'
import type { IdCapa } from '../tipos'

interface Props {
  visibles: Set<IdCapa>
  onVisible: (id: IdCapa) => void
  fondo: IdFondo
  onFondo: (valor: IdFondo) => void
}

const ETIQUETA_FONDO: Record<IdFondo, string> = {
  ninguno: 'Ninguno',
  claro: 'Claro',
  oscuro: 'Oscuro',
}

/**
 * Capas y mapa de referencia van sobre el mapa, no en el panel: son de la
 * vista, no del analisis, y en el panel empujaban hacia abajo lo importante.
 * Plegado por defecto para no tapar el area.
 */
export default function ControlMapa({ visibles, onVisible, fondo, onFondo }: Props) {
  const [abierto, setAbierto] = useState(false)

  return (
    <div className="absolute left-3 top-3 z-1000 w-56 border border-filete-fuerte bg-panel-hondo/95 text-xs">
      <button
        type="button"
        aria-expanded={abierto}
        onClick={() => setAbierto(!abierto)}
        className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left hover:bg-fondo"
      >
        <span className="rotulo">Capas del mapa</span>
        <span className="cifra text-rotulo">{abierto ? '−' : '+'}</span>
      </button>

      {abierto && (
        <div className="border-t border-filete px-3 py-2.5">
          <div className="space-y-1.5">
            {CAPAS.map((capa) => (
              <label key={capa.id} className="flex cursor-pointer items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={visibles.has(capa.id)}
                  onChange={() => onVisible(capa.id)}
                />
                <span className="inline-block h-0.75 w-4 shrink-0" style={{ background: capa.color }} />
                {capa.etiqueta}
              </label>
            ))}
          </div>

          <p className="rotulo mb-1.5 mt-3">Mapa de referencia</p>
          <div className="flex gap-px bg-filete">
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
      )}
    </div>
  )
}
