import { PRODUCTOS, type IdProducto } from '../servicios/productos'

interface Props {
  activo: IdProducto | null
  cargando: IdProducto | null
  error: string | null
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

      <p className="mt-2 text-xs leading-snug text-rotulo">
        Precalculadas al construir el sitio a partir de Planetary Computer: aparecen al
        instante y no dependen de la búsqueda de escenas.
      </p>
    </section>
  )
}
