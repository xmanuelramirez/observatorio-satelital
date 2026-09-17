import { useState } from 'react'
import type { DefinicionIndice } from '../servicios/indices'
import { serieComoCsv, type ResultadoSerie } from '../servicios/serie'

interface Props {
  indice: DefinicionIndice | null
  fechasDisponibles: number
  maxFechas: number
  onMaxFechas: (valor: number) => void
  calculando: boolean
  progreso: { hechas: number; total: number; dia: string } | null
  resultado: ResultadoSerie | null
  error: string | null
  onCalcular: () => void
  onCancelar: () => void
}

const ALTO = 120
const ANCHO = 320
const MARGEN = { arriba: 10, abajo: 22, izquierda: 34, derecha: 8 }

/**
 * Grafica la serie en SVG, sin libreria: son dos ejes y una polilinea, y
 * traer un paquete de graficas para esto pesaria mas que toda la pantalla.
 *
 * El eje vertical no arranca en cero a proposito y lo dice el rotulo: en un
 * indice normalizado lo que importa es la variacion, y forzar el cero
 * aplasta la curva hasta volverla una raya.
 */
function Grafica({ resultado }: { resultado: ResultadoSerie }) {
  const { puntos } = resultado
  const valores = puntos.map((punto) => punto.media)
  const minimo = Math.min(...valores)
  const maximo = Math.max(...valores)
  const rango = maximo - minimo || 1

  const anchoUtil = ANCHO - MARGEN.izquierda - MARGEN.derecha
  const altoUtil = ALTO - MARGEN.arriba - MARGEN.abajo

  const x = (i: number) =>
    MARGEN.izquierda + (puntos.length === 1 ? anchoUtil / 2 : (i / (puntos.length - 1)) * anchoUtil)
  const y = (valor: number) => MARGEN.arriba + altoUtil - ((valor - minimo) / rango) * altoUtil

  const linea = puntos.map((punto, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(punto.media)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} className="w-full" role="img"
      aria-label={`Serie de ${resultado.indice.etiqueta} con ${puntos.length} fechas`}>
      <line x1={MARGEN.izquierda} y1={MARGEN.arriba} x2={MARGEN.izquierda} y2={ALTO - MARGEN.abajo}
        stroke="var(--color-filete-fuerte)" strokeWidth="1" />
      <line x1={MARGEN.izquierda} y1={ALTO - MARGEN.abajo} x2={ANCHO - MARGEN.derecha}
        y2={ALTO - MARGEN.abajo} stroke="var(--color-filete-fuerte)" strokeWidth="1" />

      <text x={MARGEN.izquierda - 4} y={MARGEN.arriba + 4} textAnchor="end"
        fill="var(--color-rotulo)" fontSize="9" fontFamily="var(--font-mono)">
        {maximo.toFixed(2)}
      </text>
      <text x={MARGEN.izquierda - 4} y={ALTO - MARGEN.abajo} textAnchor="end"
        fill="var(--color-rotulo)" fontSize="9" fontFamily="var(--font-mono)">
        {minimo.toFixed(2)}
      </text>

      <path d={linea} fill="none" stroke="var(--color-acento)" strokeWidth="1.5" />

      {puntos.map((punto, i) => (
        <circle key={punto.dia} cx={x(i)} cy={y(punto.media)} r="2.5" fill="var(--color-acento)">
          <title>{`${punto.dia}: ${punto.media.toFixed(3)} (${(punto.fraccionValida * 100).toFixed(0)} % del área)`}</title>
        </circle>
      ))}

      <text x={MARGEN.izquierda} y={ALTO - 6} fill="var(--color-rotulo)" fontSize="9"
        fontFamily="var(--font-mono)">
        {puntos[0].dia}
      </text>
      <text x={ANCHO - MARGEN.derecha} y={ALTO - 6} textAnchor="end" fill="var(--color-rotulo)"
        fontSize="9" fontFamily="var(--font-mono)">
        {puntos[puntos.length - 1].dia}
      </text>
    </svg>
  )
}

export default function PanelSerie({
  indice,
  fechasDisponibles,
  maxFechas,
  onMaxFechas,
  calculando,
  progreso,
  resultado,
  error,
  onCalcular,
  onCancelar,
}: Props) {
  const [copiado, setCopiado] = useState(false)

  const copiar = async () => {
    if (!resultado) return
    try {
      await navigator.clipboard.writeText(serieComoCsv(resultado))
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      setCopiado(false)
    }
  }

  return (
    <section className="border-t border-filete px-4 py-3.5">
      <h2 className="rotulo mb-2.5">Serie de tiempo</h2>

      {fechasDisponibles === 0 ? (
        <p className="text-xs leading-snug text-tinta-suave">
          Busca escenas primero: la serie usa las fechas que devuelva la búsqueda.
        </p>
      ) : (
        <>
          <p className="mb-2.5 text-xs leading-snug text-tinta-suave">
            Media de {indice?.etiqueta ?? 'el índice'} sobre el área, fecha por fecha. Cada fecha
            es una lectura de bandas, así que corre sobre rejilla gruesa y con un tope de fechas
            repartidas a lo largo del periodo.
          </p>

          <label className="mb-2.5 block">
            <span className="mb-1 block text-xs text-tinta-suave">
              Fechas a calcular: <span className="cifra text-tinta">{maxFechas}</span> de{' '}
              <span className="cifra text-tinta">{fechasDisponibles}</span> encontradas
            </span>
            <input
              type="range"
              min={4}
              max={40}
              step={2}
              value={maxFechas}
              onChange={(evento) => onMaxFechas(Number(evento.target.value))}
              className="w-full"
            />
          </label>

          {calculando ? (
            <div>
              <button type="button" onClick={onCancelar} className="boton w-full">
                Cancelar
              </button>
              {progreso && (
                <p className="cifra mt-2 text-xs text-tinta-suave" role="status">
                  {progreso.hechas} de {progreso.total}
                  {progreso.dia ? ` · ${progreso.dia}` : ''}
                </p>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={onCalcular}
              disabled={indice === null}
              className="boton-principal"
            >
              Calcular serie
            </button>
          )}

          {error && (
            <p className="mt-2 text-xs leading-snug text-peligro" role="alert">
              {error}
            </p>
          )}

          {resultado && !calculando && (
            <div className="mt-3">
              <Grafica resultado={resultado} />

              <p className="mt-1.5 text-xs leading-snug text-rotulo">
                {resultado.puntos.length} fechas calculadas sobre rejilla de {resultado.tamano}.
                El eje vertical no arranca en cero: lo que interesa es la variación.
                {resultado.omitidas.length > 0 &&
                  ` Se omitieron ${resultado.omitidas.length} fechas por cobertura insuficiente.`}
              </p>

              <ul className="mt-2.5 max-h-44 overflow-y-auto">
                {[...resultado.puntos].reverse().map((punto) => (
                  <li
                    key={punto.dia}
                    className="flex items-baseline justify-between border-b border-filete py-1 text-xs"
                  >
                    <span className="cifra text-tinta-suave">{punto.dia}</span>
                    <span className="cifra text-tinta">{punto.media.toFixed(3)}</span>
                    <span className="cifra text-rotulo">
                      {(punto.fraccionValida * 100).toFixed(0)} %
                    </span>
                  </li>
                ))}
              </ul>

              <button type="button" onClick={copiar} className="boton mt-2.5 w-full">
                {copiado ? 'Copiado' : 'Copiar como CSV'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
