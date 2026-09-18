import type { ReactNode } from 'react'

interface Props {
  titulo: string
  /** Una linea que dice que hay dentro o que se eligio, para no tener que abrirla. */
  resumen: string
  abierta: boolean
  onAlternar: () => void
  children: ReactNode
}

/**
 * Tarjeta del menu flotante del margen izquierdo. Funcionan como acordeon:
 * App deja abierta solo una, las demas quedan en su encabezado de una linea.
 * La abierta toma el alto que le sobre a la columna y desplaza por dentro,
 * asi el mapa nunca queda tapado por mas de una tarjeta larga.
 */
export default function SeccionFlotante({ titulo, resumen, abierta, onAlternar, children }: Props) {
  return (
    <section
      className={`pointer-events-auto flex flex-col border bg-panel/95 shadow-lg shadow-black/40 ${
        abierta ? 'min-h-0 shrink border-acento' : 'shrink-0 border-filete-fuerte'
      }`}
    >
      <button
        type="button"
        aria-expanded={abierta}
        onClick={onAlternar}
        className={`flex w-full cursor-pointer items-center gap-3 px-3.5 py-2.5 text-left ${
          abierta ? 'bg-acento-suave' : 'hover:bg-fondo'
        }`}
      >
        <span className="min-w-0 flex-1">
          <span className={`block text-[13px] font-semibold ${abierta ? 'text-acento' : 'text-tinta'}`}>
            {titulo}
          </span>
          <span className="block truncate text-xs text-tinta-suave">{resumen}</span>
        </span>
        <span className="cifra text-base leading-none text-rotulo" aria-hidden="true">
          {abierta ? '−' : '+'}
        </span>
      </button>

      {abierta && <div className="min-h-0 overflow-y-auto border-t border-filete">{children}</div>}
    </section>
  )
}
