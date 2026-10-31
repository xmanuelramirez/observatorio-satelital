import { useId } from 'react'
import { xDe, yDe } from '../lib/proyeccion'

interface Props {
  /** Recorte que cubre el velo: [[sur, oeste], [norte, este]]. */
  limites: [[number, number], [number, number]]
  /** Lo que queda a la vista: el municipio y, si sale de el, el area elegida. Se unen. */
  rutas: string[]
}

/**
 * Recorte literal: fuera de la silueta no hay imagen ni capas, y el borde es neto,
 * sin desvanecido (Carlos, 30/10/2026). Encima de todo, del color del fondo de la pagina. Va en un `<svg>` suelto, para usarlo en el
 * mapa y en las tarjetas.
 */
export default function VeloFoco({ limites, rutas }: Props) {
  const id = useId().replace(/:/g, '')
  const [[sur, oeste], [norte, este]] = limites
  const x0 = xDe(oeste)
  const y0 = yDe(norte)
  const w = xDe(este) - x0
  const h = yDe(sur) - y0

  return (
    <>
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x={x0} y={y0} width={w} height={h}>
          <rect x={x0} y={y0} width={w} height={h} fill="#fff" />
          {rutas.map((ruta) => (
            <path key={ruta.slice(0, 40)} d={ruta} fill="#000" fillRule="evenodd" />
          ))}
        </mask>
      </defs>
      <rect x={x0} y={y0} width={w} height={h} fill="#0b1019" mask={`url(#${id})`} />
    </>
  )
}
