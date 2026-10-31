import { useEffect, useRef, useState } from 'react'

/** Cuenta hasta el valor nuevo. El valor de verdad ya cambio: esto solo lo anima. */
export function useCifra(valor: number, duracion = 700, decimales = 0): string {
  const [mostrado, setMostrado] = useState(valor)
  const anterior = useRef(0)

  useEffect(() => {
    const desde = anterior.current
    anterior.current = valor
    const inicio = performance.now()
    let cuadro = 0
    const avanzar = (ahora: number) => {
      const t = Math.min(1, (ahora - inicio) / duracion)
      const suave = 1 - (1 - t) ** 3
      setMostrado(desde + (valor - desde) * suave)
      if (t < 1) cuadro = requestAnimationFrame(avanzar)
    }
    cuadro = requestAnimationFrame(avanzar)
    return () => cancelAnimationFrame(cuadro)
  }, [valor, duracion])

  return mostrado.toFixed(decimales)
}
