import { useRef } from 'react'
import { diasEntre } from '../servicios/obranueva'

/** Punto lleno en la regla: una fecha limpia. Hueco: con mas nubes. */
const NUBES_LIMPIA = 10

interface Props {
  /** Cada fecha con imagen. Basta el dia y sus nubes: lo precalculado no trae las escenas. */
  grupos: { dia: string; nubes: number | null }[]
  /** Dia que se esta viendo. */
  actual: string | null
  /** Dia base, solo en los modos de dos fechas. */
  base: string | null
  dosFechas: boolean
  calculando: boolean
  segundos: number
  /** Nulo si este modo no tiene imagen por fecha: no se puede reproducir. */
  puedeReproducir: boolean
  reproduciendo: boolean
  onReproducir: () => void
  onElegir: (dia: string) => void
  onGaleria: () => void
}

const instante = (dia: string) => Date.parse(`${dia}T12:00:00Z`)
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function fechaBreve(dia: string, conAno = false): string {
  const [a, m, d] = dia.split('-')
  return `${Number(d)} ${MESES[Number(m) - 1]}${conAno ? ` ${a}` : ''}`
}

function marcasEntre(desde: number, hasta: number): { etiqueta: string; t: number }[] {
  const meses: { etiqueta: string; t: number }[] = []
  // En una serie de varios anios, una marca por anio: doce por anio no caben.
  if (hasta - desde > 400 * 86_400_000) {
    for (let a = new Date(desde).getUTCFullYear() + 1; Date.UTC(a, 0, 1) < hasta; a++) {
      meses.push({ etiqueta: String(a), t: Date.UTC(a, 0, 1) })
    }
    return meses
  }
  const cursor = new Date(desde)
  cursor.setUTCDate(1)
  cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  while (cursor.getTime() < hasta) {
    meses.push({ etiqueta: MESES[cursor.getUTCMonth()], t: cursor.getTime() })
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return meses
}

/**
 * La linea de tiempo: un punto por fecha con imagen. En Color y en NDVI, elegir una
 * fecha cambia la imagen al instante; «Reproducir» recorre las limpias. En los modos
 * de dos fechas, la separacion se lee aqui siempre, porque es dato exigido.
 *
 * Va en el flujo de la pagina, no sobre el mapa: asi no puede encimarse con nada.
 */
export default function ReglaFechas({
  grupos,
  actual,
  base,
  dosFechas,
  calculando,
  segundos,
  puedeReproducir,
  reproduciendo,
  onReproducir,
  onElegir,
  onGaleria,
}: Props) {
  const tiempos = grupos.map((g) => instante(g.dia))
  const desde = tiempos.length > 0 ? Math.min(...tiempos) : 0
  const hasta = tiempos.length > 0 ? Math.max(...tiempos) : 0
  const margen = Math.max(86_400_000, (hasta - desde) * 0.015)
  const pos = (t: number) => ((t - (desde - margen)) / (hasta - desde + margen * 2)) * 100

  // A este ancho no cabe un boton por fecha: la regla toma la mas cercana al cursor.
  // Con muchas fechas, raya delgada en vez de punto.
  const largos = grupos.length > 30
  const linea = useRef<HTMLDivElement>(null)
  const arrastrando = useRef(false)

  /** La fecha mas cercana al cursor: la regla se puede recorrer arrastrando. */
  const elegirEn = (clientX: number) => {
    const caja = linea.current?.getBoundingClientRect()
    if (!caja || grupos.length === 0) return
    const porcentaje = ((clientX - caja.left) / caja.width) * 100
    const cercana = grupos.reduce((mejor, g) =>
      Math.abs(pos(instante(g.dia)) - porcentaje) < Math.abs(pos(instante(mejor.dia)) - porcentaje) ? g : mejor,
    )
    if (cercana.dia !== actual) onElegir(cercana.dia)
  }

  const moverCon = (paso: number) => {
    const orden = [...grupos].sort((a, b) => a.dia.localeCompare(b.dia))
    const i = orden.findIndex((g) => g.dia === actual)
    const siguiente = orden[i + paso]
    if (siguiente) onElegir(siguiente.dia)
  }

  const xActual = actual ? pos(instante(actual)) : null
  const xBase = dosFechas && base ? pos(instante(base)) : null
  const separacion = dosFechas && actual && base ? Math.abs(diasEntre(base, actual)) : null
  const nubes = grupos.find((g) => g.dia === actual)?.nubes ?? null

  return (
    <section id="regla" data-testid="regla-fechas">
      <div className="regla-fecha">
        <b>{actual ? fechaBreve(actual, largos) : '...'}</b>
        <small role="status">
          {calculando
            ? `Calculando, unos ${segundos} s`
            : separacion !== null && base
              ? `Desde ${fechaBreve(base)} · ${separacion} días`
              : nubes !== null && nubes < 1
                ? 'Sin nubes'
                : nubes !== null
                  ? `${Math.round(nubes)} % de nubes`
                  : ''}
        </small>
      </div>

      <div
        ref={linea}
        className="regla-linea"
        onPointerDown={(evento) => {
          // Arrastrar solo donde cada fecha ya tiene imagen; en las demas, cada una calcula.
          arrastrando.current = largos
          evento.currentTarget.setPointerCapture(evento.pointerId)
          elegirEn(evento.clientX)
        }}
        onPointerMove={largos ? (evento) => arrastrando.current && elegirEn(evento.clientX) : undefined}
        onPointerUp={() => {
          arrastrando.current = false
        }}
        onKeyDown={(evento) => {
          if (evento.key === 'ArrowLeft') moverCon(-1)
          if (evento.key === 'ArrowRight') moverCon(1)
        }}
      >
        {grupos.length > 0 &&
          marcasEntre(desde, hasta).map((mes) => (
            <span key={mes.t} className="regla-mes" style={{ left: `${pos(mes.t)}%` }}>
              {mes.etiqueta}
            </span>
          ))}

        {xActual !== null && xBase !== null && (
          <span
            className={`regla-tramo ${calculando ? 'regla-tramo-calculando' : ''}`}
            style={{ left: `${Math.min(xActual, xBase)}%`, width: `${Math.abs(xActual - xBase)}%` }}
          />
        )}

        {grupos.map((grupo) => {
          const elegido = grupo.dia === actual || (dosFechas && grupo.dia === base)
          const nublada = grupo.nubes !== null && grupo.nubes > NUBES_LIMPIA
          const texto = `${fechaBreve(grupo.dia, true)}${grupo.nubes !== null ? `, ${grupo.nubes.toFixed(1)} % de nubes` : ''}`
          return (
            <button
              key={grupo.dia}
              type="button"
              // El mouse ya lo atiende la regla; aqui llega el teclado, que no trae detalle.
              onClick={(evento) => {
                if (evento.detail === 0) onElegir(grupo.dia)
              }}
              data-testid={`escena-dia-${grupo.dia}`}
              aria-pressed={elegido}
              aria-label={texto}
              title={texto}
              className={`${largos ? 'regla-raya' : 'regla-punto'} ${nublada ? 'nublada' : ''} ${elegido ? 'elegida' : ''}`}
              style={{ left: `${pos(instante(grupo.dia))}%` }}
            />
          )
        })}
      </div>

      <button
        type="button"
        onClick={onReproducir}
        disabled={!puedeReproducir}
        title={puedeReproducir ? undefined : 'Se reproduce en Cómo se ve y en Vegetación con NDVI'}
        className="regla-play"
      >
        {reproduciendo ? 'Pausa' : 'Reproducir'}
      </button>
      <button type="button" onClick={onGaleria} disabled={grupos.length === 0} data-testid="galeria-abrir" className="enlace regla-todas">
        Todas las imágenes
      </button>
    </section>
  )
}
