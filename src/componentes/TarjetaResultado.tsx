import { useState } from 'react'
import type { EntradaLeyenda } from '../servicios/analisis'

interface Props {
  titulo: string
  leyenda: EntradaLeyenda[]
  notas: string[]
}

/**
 * Simbologia y notas del resultado que esta en el mapa, en dos tarjetas
 * flotantes separadas.
 *
 * La simbologia va sola en la esquina inferior derecha, como en un mapa
 * impreso, y queda arriba de la atribucion de Leaflet. Las notas del calculo
 * son la letra chica: van aparte, abajo a la izquierda y plegadas.
 */
export default function TarjetaResultado({ titulo, leyenda, notas }: Props) {
  const [notasAbiertas, setNotasAbiertas] = useState(false)

  return (
    <>
      {leyenda.length > 0 && (
        <div className="absolute bottom-7 right-3 z-1000 flex max-h-[calc(100vh-15rem)] w-72 flex-col border border-filete-fuerte bg-panel-hondo/95 text-xs">
          <div className="border-b border-filete px-3.5 py-2.5">
            <p className="rotulo">Simbología</p>
            <p className="mt-1 text-[13px] font-semibold text-tinta">{titulo}</p>
          </div>

          <ul className="min-h-0 space-y-2 overflow-y-auto px-3.5 py-3">
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
        </div>
      )}

      {notas.length > 0 && (
        <div className="absolute bottom-7 left-3 z-1000 flex max-h-[50vh] w-80 flex-col border border-filete-fuerte bg-panel-hondo/95 text-xs">
          <button
            type="button"
            aria-expanded={notasAbiertas}
            onClick={() => setNotasAbiertas(!notasAbiertas)}
            className="flex w-full cursor-pointer items-center justify-between px-3.5 py-2.5 text-left hover:bg-fondo"
          >
            <span className="rotulo">Notas del cálculo ({notas.length})</span>
            <span className="cifra text-rotulo">{notasAbiertas ? '−' : '+'}</span>
          </button>

          {notasAbiertas && (
            <ul className="min-h-0 space-y-1.5 overflow-y-auto border-t border-filete px-3.5 py-3 leading-snug text-tinta-suave">
              {notas.map((nota) => (
                <li key={nota}>{nota}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  )
}
