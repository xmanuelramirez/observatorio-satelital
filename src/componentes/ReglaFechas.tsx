import { diasEntre } from '../servicios/obranueva'
import { useCifra } from '../lib/useCifra'

interface Props {
  /** Cada fecha con imagen. Basta el dia y sus nubes: lo precalculado no trae las escenas. */
  grupos: { dia: string; nubes: number | null }[]
  /** Dia que se esta viendo. */
  actual: string | null
  /** Dia base, solo en los modos de dos fechas. */
  base: string | null
  dosFechas: boolean
  nubesMax: number
  calculando: boolean
  onElegir: (dia: string) => void
  onGaleria: () => void
}

const instante = (dia: string) => Date.parse(`${dia}T12:00:00Z`)

function fechaBreve(dia: string): string {
  return new Date(instante(dia))
    .toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .replace('.', '')
}

function fechaCorta(dia: string): string {
  return new Date(instante(dia)).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', timeZone: 'UTC' })
}

function mesesEntre(desde: number, hasta: number): { etiqueta: string; t: number }[] {
  const meses: { etiqueta: string; t: number }[] = []
  const cursor = new Date(desde)
  cursor.setUTCDate(1)
  cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  while (cursor.getTime() < hasta) {
    meses.push({
      etiqueta: cursor.toLocaleDateString('es-MX', { month: 'short', timeZone: 'UTC' }).replace('.', ''),
      t: cursor.getTime(),
    })
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return meses
}

/**
 * La regla sustituye a la lista de escenas: cada dia con imagen es una marca, y
 * mas alta quiere decir menos nubes. En los modos de dos fechas la separacion
 * se lee entre los dos marcadores, siempre visible, porque es dato exigido.
 *
 * Va en el flujo de la pagina, no sobre el mapa: asi no puede encimarse con nada.
 */
export default function ReglaFechas({
  grupos,
  actual,
  base,
  dosFechas,
  nubesMax,
  calculando,
  onElegir,
  onGaleria,
}: Props) {
  const separacion = dosFechas && actual && base ? Math.abs(diasEntre(base, actual)) : 0
  const separacionVista = useCifra(separacion, 500)

  const tiempos = grupos.map((g) => instante(g.dia))
  const desde = tiempos.length > 0 ? Math.min(...tiempos) : 0
  const hasta = tiempos.length > 0 ? Math.max(...tiempos) : 0
  const margen = Math.max(86_400_000, (hasta - desde) * 0.015)
  const pos = (t: number) => ((t - (desde - margen)) / (hasta - desde + margen * 2)) * 100

  const xActual = actual ? pos(instante(actual)) : null
  const xBase = dosFechas && base ? pos(instante(base)) : null

  return (
    <div className="flex shrink-0 items-stretch gap-4 border-t border-filete bg-fondo px-4 py-1.5" data-testid="regla-fechas">
      <div className="relative min-w-0 flex-1">
        <div className="relative h-5 text-xs">
          {calculando ? (
            <span className="text-tinta-suave" role="status">
              Calculando, unos {dosFechas ? 25 : 10} s
            </span>
          ) : (
            xActual !== null && (
              <span
                className="regla-rotulo absolute top-0.5 whitespace-nowrap font-medium"
                style={{ left: `${xBase !== null ? (xActual + xBase) / 2 : xActual}%` }}
              >
                {xBase !== null ? (
                  <>
                    {base && actual && `${fechaBreve(base < actual ? base : actual)} a ${fechaBreve(base < actual ? actual : base)} · `}
                    <span className="cifra">{separacionVista}</span> días
                  </>
                ) : (
                  actual && fechaCorta(actual)
                )}
              </span>
            )
          )}
        </div>

        {/*
          El tramo va en su propia franja, sobre las marcas y no detras: se desliza
          al cambiar de fecha sin encimarse con ninguna.
        */}
        <div className="relative h-1.5">
          {xActual !== null && xBase !== null && (
            <span
              className={`regla-tramo absolute inset-y-0 ${calculando ? 'regla-tramo-calculando' : ''}`}
              style={{ left: `${Math.min(xActual, xBase)}%`, width: `${Math.abs(xActual - xBase)}%` }}
            />
          )}
        </div>

        <div className="relative h-6">
          {grupos.map((grupo) => {
            const claro = grupo.nubes === null ? 0.5 : 1 - Math.min(1, grupo.nubes / Math.max(1, nubesMax))
            const esActual = grupo.dia === actual
            const esBase = dosFechas && grupo.dia === base
            const elegido = esActual || esBase
            return (
              <button
                key={grupo.dia}
                type="button"
                onClick={() => onElegir(grupo.dia)}
                data-testid={`escena-dia-${grupo.dia}`}
                aria-pressed={elegido}
                aria-label={`${fechaCorta(grupo.dia)}${grupo.nubes !== null ? `, ${grupo.nubes.toFixed(1)} % de nubes` : ''}`}
                title={`${fechaCorta(grupo.dia)}${grupo.nubes !== null ? ` · ${grupo.nubes.toFixed(1)} % nubes` : ''}`}
                className="regla-marca absolute bottom-0 flex h-full w-1 -translate-x-1/2 md:w-3.5 cursor-pointer items-end justify-center"
                style={{ left: `${pos(instante(grupo.dia))}%` }}
              >
                <span
                  className={`block ${esActual ? 'regla-elegida' : esBase ? 'regla-elegida-base' : 'w-0.75 bg-tinta-suave'}`}
                  style={{ height: elegido ? '100%' : `${28 + claro * 72}%` }}
                />
              </button>
            )
          })}
        </div>

        <div className="relative h-4 text-xs text-tinta-suave">
          {grupos.length > 0 &&
            mesesEntre(desde, hasta).map((mes) => (
              <span key={mes.t} className="absolute top-0" style={{ left: `${pos(mes.t)}%` }}>
                {mes.etiqueta}
              </span>
            ))}
        </div>
      </div>

      <button
        type="button"
        onClick={onGaleria}
        disabled={grupos.length === 0}
        data-testid="galeria-abrir"
        className="enlace shrink-0 self-center whitespace-nowrap"
      >
        Ver todas las escenas
      </button>
    </div>
  )
}
