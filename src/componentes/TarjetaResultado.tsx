import { useState } from 'react'
import type { EntradaLeyenda } from '../servicios/analisis'

interface Props {
  titulo: string
  leyenda: EntradaLeyenda[]
  notas: string[]
}

/**
 * Leyenda y notas del resultado que esta en el mapa, flotando sobre el mapa.
 *
 * Antes vivian al final del panel lateral: para leer las hectareas habia que
 * bajar hasta el fondo y perder de vista los controles. Aqui se ven junto a
 * lo que describen. Las notas van plegadas porque son la letra chica.
 */
export default function TarjetaResultado({ titulo, leyenda, notas }: Props) {
  const [notasAbiertas, setNotasAbiertas] = useState(false)

  if (leyenda.length === 0 && notas.length === 0) return null

  return (
    <div className="absolute bottom-6 left-3 z-1000 flex max-h-[60vh] w-80 flex-col border border-filete-fuerte bg-panel-hondo/95 text-xs">
      <div className="border-b border-filete px-3.5 py-2.5">
        <p className="rotulo">{titulo}</p>
      </div>

      <div className="min-h-0 overflow-y-auto px-3.5 py-3">
        {leyenda.length > 0 && (
          <ul className="space-y-2">
            {leyenda.map((entrada) => (
              <li key={entrada.etiqueta} className="flex items-start gap-2.5 text-[13px]">
                <span
                  className="mt-1 inline-block h-3 w-3 shrink-0"
                  style={{ background: entrada.color }}
                />
                <span>
                  <span className="font-medium">{entrada.etiqueta}</span>
                  {entrada.detalle && (
                    <span className="cifra block text-xs text-tinta-suave">{entrada.detalle}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}

        {notas.length > 0 && (
          <div className={leyenda.length > 0 ? 'mt-3 border-t border-filete pt-2.5' : ''}>
            <button
              type="button"
              aria-expanded={notasAbiertas}
              onClick={() => setNotasAbiertas(!notasAbiertas)}
              className="flex w-full cursor-pointer items-center justify-between text-left"
            >
              <span className="rotulo">Notas del cálculo ({notas.length})</span>
              <span className="cifra text-rotulo">{notasAbiertas ? '−' : '+'}</span>
            </button>

            {notasAbiertas && (
              <ul className="mt-2 space-y-1.5 leading-snug text-tinta-suave">
                {notas.map((nota) => (
                  <li key={nota}>{nota}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
