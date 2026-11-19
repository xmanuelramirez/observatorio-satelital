import { useId, useState, type ReactNode } from 'react'

/**
 * Titulo de seccion con su «?»: el como se calculo se abre con clic, no al pasar el cursor (leccion del 11/11/2026).
 */
export default function TituloConAyuda({ titulo, children }: { titulo: string; children: ReactNode }) {
  const [abierta, setAbierta] = useState(false)
  const id = useId()
  return (
    <>
      <h3 className="resumen-titulo ayuda-fila">
        <span>{titulo}</span>
        <button
          type="button"
          className={`ayuda-boton ${abierta ? 'activa' : ''}`}
          aria-expanded={abierta}
          aria-controls={id}
          aria-label={`Cómo se calculó: ${titulo}`}
          onClick={() => setAbierta((a) => !a)}
        >
          ?
        </button>
      </h3>
      {abierta && (
        <div id={id} className="ayuda-texto">
          {children}
        </div>
      )}
    </>
  )
}
