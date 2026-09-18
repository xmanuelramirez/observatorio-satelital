import type { ReactNode } from 'react'

/**
 * La pestana Escenas es un flujo de tres pasos: buscar, elegir escena y
 * analizar. Cada paso lleva su numero, y el que ya se cumplio se pliega a una
 * linea con su resumen para que el siguiente quede a la vista sin bajar.
 */
export function TituloPaso({ numero, titulo }: { numero: number; titulo: string }) {
  return (
    <h2 className="rotulo flex items-center gap-2">
      <span className="cifra inline-flex h-4.5 w-4.5 items-center justify-center border border-acento text-acento">
        {numero}
      </span>
      {titulo}
    </h2>
  )
}

interface PropsPlegado {
  numero: number
  titulo: string
  children: ReactNode
  onCambiar: () => void
}

export function PasoPlegado({ numero, titulo, children, onCambiar }: PropsPlegado) {
  return (
    <section className="flex items-center justify-between gap-3 border-b border-filete px-4 py-2.5">
      <div className="min-w-0">
        <TituloPaso numero={numero} titulo={titulo} />
        <div className="mt-1 pl-6.5 text-xs leading-snug text-tinta-suave">{children}</div>
      </div>
      <button type="button" onClick={onCambiar} className="boton shrink-0">
        Cambiar
      </button>
    </section>
  )
}
