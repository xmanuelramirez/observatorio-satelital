import { useEffect, useState } from 'react'
import type { Escena, GrupoDia } from '../tipos'

interface Props {
  grupos: GrupoDia[]
  seleccion: Escena[]
  coleccion: string
  onElegir: (escenas: Escena[]) => void
  onCerrar: () => void
}

function fechaLarga(dia: string): string {
  const [ano, mes, d] = dia.split('-').map(Number)
  return new Date(Date.UTC(ano, mes - 1, d)).toLocaleDateString('es-MX', {
    weekday: 'short',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * Las escenas encontradas a pantalla completa, con la vista previa grande,
 * para decidir cual analizar sin adivinar desde una miniatura de 40 px.
 * Clic en una imagen la amplia; Esc cierra la ampliacion y luego la galeria.
 *
 * La vista previa es la que publica el catalogo: sirve para ver nubes y
 * cobertura, no para medir. El analisis siempre lee las bandas completas.
 */
export default function GaleriaEscenas({ grupos, seleccion, coleccion, onElegir, onCerrar }: Props) {
  const [ampliada, setAmpliada] = useState<Escena | null>(null)

  useEffect(() => {
    const alPresionar = (evento: KeyboardEvent) => {
      if (evento.key !== 'Escape') return
      if (ampliada) setAmpliada(null)
      else onCerrar()
    }
    window.addEventListener('keydown', alPresionar)
    return () => window.removeEventListener('keydown', alPresionar)
  }, [ampliada, onCerrar])

  const elegir = (escenas: Escena[]) => {
    onElegir(escenas)
    onCerrar()
  }

  const totalEscenas = grupos.reduce((suma, g) => suma + g.escenas.length, 0)

  return (
    <div
      className="fixed inset-0 z-2000 flex flex-col bg-fondo"
      role="dialog"
      aria-modal="true"
      aria-label="Imágenes disponibles"
    >
      <header className="flex items-center justify-between gap-4 border-b border-filete-fuerte bg-panel-hondo px-6 py-3.5">
        <div>
          <p className="rotulo">Imágenes disponibles · {coleccion}</p>
          <p className="mt-1 text-[15px] font-semibold">
            <span className="cifra">{grupos.length}</span> fechas,{' '}
            <span className="cifra">{totalEscenas}</span> escenas
          </p>
        </div>
        <button type="button" onClick={onCerrar} className="boton">
          Cerrar <span className="cifra text-rotulo">(Esc)</span>
        </button>
      </header>

      {/* Las fechas se acomodan en columnas; dentro de cada una, sus mallas lado a lado. */}
      <div className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(28rem,1fr))] content-start gap-x-6 gap-y-7 overflow-y-auto px-6 py-5">
        {grupos.map((grupo) => {
          const esElDia = seleccion.length > 0 && seleccion[0].dia === grupo.dia
          return (
            <section key={grupo.dia}>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <h2 className="text-[15px] font-semibold first-letter:uppercase">{fechaLarga(grupo.dia)}</h2>
                {grupo.nubes !== null && (
                  <span className="cifra text-xs text-tinta-suave">{grupo.nubes.toFixed(1)} % nubes</span>
                )}
                {grupo.escenas.length > 1 && (
                  <button
                    type="button"
                    onClick={() => elegir(grupo.escenas)}
                    className={`boton ${esElDia && seleccion.length > 1 ? 'boton-activo' : ''}`}
                  >
                    Analizar el mosaico de {grupo.escenas.length} mallas
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {grupo.escenas.map((escena) => {
                  const activa = seleccion.length === 1 && seleccion[0].id === escena.id
                  return (
                    <figure
                      key={escena.id}
                      className={`border bg-panel ${activa ? 'border-acento' : 'border-filete-fuerte'}`}
                    >
                      <button
                        type="button"
                        onClick={() => setAmpliada(escena)}
                        className="block aspect-square w-full cursor-zoom-in bg-panel-hondo"
                        title="Ampliar"
                      >
                        {escena.thumbnail ? (
                          <img
                            src={escena.thumbnail}
                            alt={`Vista previa ${escena.malla} del ${escena.dia}`}
                            loading="lazy"
                            decoding="async"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="text-xs text-rotulo">Sin vista previa</span>
                        )}
                      </button>
                      <figcaption className="flex items-center justify-between gap-2 px-3 py-2">
                        <span className="leading-tight">
                          <span className="cifra block text-[13px] font-medium">
                            {escena.malla || escena.plataforma}
                          </span>
                          <span className="cifra block text-xs text-tinta-suave">
                            {escena.plataforma}
                            {escena.nubes !== null ? ` · ${escena.nubes.toFixed(1)} %` : ''}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => elegir([escena])}
                          className={`boton shrink-0 ${activa ? 'boton-activo' : ''}`}
                        >
                          Analizar
                        </button>
                      </figcaption>
                    </figure>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>

      {ampliada && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-fondo/95 p-6"
          onClick={() => setAmpliada(null)}
        >
          {ampliada.thumbnail && (
            <img
              src={ampliada.thumbnail}
              alt={`Vista previa ${ampliada.malla} del ${ampliada.dia}`}
              className="max-h-[80vh] max-w-full cursor-zoom-out object-contain"
            />
          )}
          <div className="flex items-center gap-3" onClick={(evento) => evento.stopPropagation()}>
            <span className="cifra text-[13px]">
              {ampliada.dia} · {ampliada.malla || ampliada.plataforma}
              {ampliada.nubes !== null ? ` · ${ampliada.nubes.toFixed(1)} % nubes` : ''}
            </span>
            <button type="button" onClick={() => elegir([ampliada])} className="boton">
              Analizar esta escena
            </button>
            <button type="button" onClick={() => setAmpliada(null)} className="boton">
              Volver
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
