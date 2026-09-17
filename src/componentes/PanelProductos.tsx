import type { ResultadoAnalisis } from '../servicios/analisis'
import { PRODUCTOS, type IdProducto } from '../servicios/productos'

interface Props {
  activo: IdProducto | null
  cargando: IdProducto | null
  error: string | null
  /** Leyenda y notas del producto cargado; se muestran aqui y no en el panel
   *  de analisis, porque este no existe hasta elegir una escena. */
  resultado: ResultadoAnalisis | null
  onCargar: (id: IdProducto) => void
  onQuitar: () => void
}

/**
 * Capas de referencia ya calculadas por terceros. Se separan de las escenas a
 * proposito: aqui no se elige fecha ni nubosidad, solo se recorta al area y
 * se mide.
 */
export default function PanelProductos({
  activo,
  cargando,
  error,
  resultado,
  onCargar,
  onQuitar,
}: Props) {
  return (
    <section className="border-b border-filete px-4 py-3.5">
      <h2 className="rotulo mb-2.5">Capas de referencia</h2>

      <ul className="space-y-1.5">
        {PRODUCTOS.map((producto) => {
          const estaActivo = activo === producto.id
          const estaCargando = cargando === producto.id

          return (
            <li key={producto.id}>
              <button
                type="button"
                aria-pressed={estaActivo}
                disabled={cargando !== null}
                onClick={() => (estaActivo ? onQuitar() : onCargar(producto.id))}
                className={`boton w-full text-left ${estaActivo ? 'boton-activo' : ''}`}
              >
                <span className="block text-[13px]">
                  {estaCargando ? `${producto.etiqueta}: leyendo...` : producto.etiqueta}
                </span>
                <span className="mt-0.5 block text-xs text-rotulo">{producto.descripcion}</span>
              </button>
            </li>
          )
        })}
      </ul>

      {error && (
        <p className="mt-2 text-xs leading-snug text-peligro" role="alert">
          {error}
        </p>
      )}

      {resultado && (
        <div className="mt-3 border-t border-filete pt-3">
          {resultado.leyenda.length > 0 && (
            <ul className="space-y-2">
              {resultado.leyenda.map((entrada) => (
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

          <ul className="mt-2.5 space-y-1.5 text-xs leading-snug text-tinta-suave">
            {resultado.notas.map((nota) => (
              <li key={nota}>{nota}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-2 text-xs leading-snug text-rotulo">
        Vienen de Planetary Computer, ya procesadas. No dependen de la búsqueda de escenas.
      </p>
    </section>
  )
}
