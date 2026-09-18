import { CAPAS_AREA } from '../datos/capas'
import type { IdCapa } from '../tipos'

/** Nombre corto para que las tres opciones quepan en una linea. */
const CORTO: Partial<Record<IdCapa, string>> = {
  LIMITE: 'Municipio',
  LIMITE_URBANO: 'Zona urbana',
  CUENCA_PALOTE: 'Cuenca Palote',
}

interface Props {
  area: IdCapa
  onArea: (id: IdCapa) => void
}

/**
 * El area va arriba y fuera de las pestanas porque la usan todas: escenas,
 * serie, capas de referencia e hidrologia recortan al mismo poligono.
 */
export default function SelectorArea({ area, onArea }: Props) {
  return (
    <div className="border-b border-filete px-4 py-3">
      <p className="rotulo mb-2">Área de interés</p>
      <div className="flex gap-px border border-filete bg-filete" role="radiogroup">
        {CAPAS_AREA.map((capa) => (
          <button
            key={capa.id}
            type="button"
            role="radio"
            aria-checked={area === capa.id}
            onClick={() => onArea(capa.id)}
            title={capa.etiqueta}
            className={`pestana flex-1 whitespace-nowrap px-1.5 normal-case tracking-normal ${area === capa.id ? 'pestana-activa' : ''}`}
            style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 500 }}
          >
            <span
              className="mr-1.5 inline-block h-0.75 w-3 align-middle"
              style={{ background: capa.color }}
            />
            {CORTO[capa.id] ?? capa.etiqueta}
          </button>
        ))}
      </div>
    </div>
  )
}
