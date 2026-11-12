import { useState } from 'react'

/**
 * Tablero de «Zonas de crecimiento»: expansion y consolidacion por quinquenio, observadas (GHSL 2000-2020) y previstas por
 * el automata (horizontes 2025-2050), junto a la tasa de crecimiento de la poblacion. Lo genera
 * `herramientas/crecimiento_resumen.py`; solo se publica con dictamen del juez.
 *
 * Lo observado (techos) y lo previsto (suelo) miden cosas distintas: van en graficas separadas, cada una con su eje.
 * El detalle de una barra se abre con clic, no al pasar el cursor; en el autómata, el clic tambien cambia el horizonte
 * del mapa.
 */

type Ambito = 'municipio' | 'dentro_limite_urbano' | 'fuera_limite_urbano'

interface Partes {
  expansion_ha: number
  consolidacion_ha: number
  total_ha: number
}

interface Poblacion {
  inicio: number
  fin: number
  aumento: number
  tasa_anual: number
  fuente: string
}

interface Observado extends Record<Ambito, Partes> {
  periodo: string
  inicio: number
  fin: number
  poblacion: Poblacion
  ha_por_1000_hab_nuevos: number
}

interface Previsto extends Record<Ambito, Partes> {
  horizonte: number
  automata: { poligonos: number; pob: number; hab_por_ha: number | null }
  poblacion: Poblacion | null
  ha_por_1000_hab_nuevos: number | null
}

export interface DatosResumen {
  generado: string
  observado: Observado[]
  previsto: Previsto[]
}

interface Props {
  datos: DatosResumen
  horizonte: string | null
  onHorizonte: (etiqueta: string) => void
  /** Color de cada horizonte en el mapa, para ligar la barra con lo que se ve. */
  colores: Record<string, string>
}

const AMBITOS: { id: Ambito; etiqueta: string }[] = [
  { id: 'municipio', etiqueta: 'Municipio' },
  { id: 'dentro_limite_urbano', etiqueta: 'Dentro del límite urbano' },
  { id: 'fuera_limite_urbano', etiqueta: 'Fuera' },
]

// Mismos tonos que el mapa: palido lo que se extiende, cafe lo que rellena.
const COLOR_EXPANSION = '#f1dcb0'
const COLOR_CONSOLIDACION = '#a67652'

const ha = (n: number) => Math.round(n).toLocaleString('es-MX')
const pct = (n: number) => `${(n * 100).toFixed(1)} %`
const miles = (n: number) => Math.round(n).toLocaleString('es-MX')

interface Barra {
  clave: string
  etiqueta: string
  expansion: number
  consolidacion: number
  /** Marca de color junto a la etiqueta (el del horizonte en el mapa). */
  color?: string
}

/** Barras apiladas (expansion abajo, consolidacion arriba), con el total encima de cada una. */
function Barras({
  barras,
  elegida,
  onElegir,
  titulo,
}: {
  barras: Barra[]
  elegida: string | null
  onElegir: (clave: string) => void
  titulo: string
}) {
  const ancho = 440
  const alto = 150
  const arriba = 18
  const abajo = 22
  const util = alto - arriba - abajo
  const maximo = Math.max(1, ...barras.map((b) => b.expansion + b.consolidacion))
  const paso = ancho / barras.length
  const grueso = Math.min(34, paso * 0.56)
  const y = (v: number) => (v / maximo) * util

  return (
    <svg viewBox={`0 0 ${ancho} ${alto}`} className="resumen-grafica" role="img" aria-label={titulo}>
      <line x1={0} x2={ancho} y1={alto - abajo} y2={alto - abajo} className="resumen-base" />
      {barras.map((b, i) => {
        const x = i * paso + (paso - grueso) / 2
        const hExp = y(b.expansion)
        const hCon = y(b.consolidacion)
        const base = alto - abajo
        const activa = elegida === b.clave
        return (
          <g
            key={b.clave}
            className={`resumen-barra ${activa ? 'activa' : ''}`}
            onClick={() => onElegir(b.clave)}
            role="button"
            tabIndex={0}
            aria-pressed={activa}
            aria-label={`${b.etiqueta}: ${ha(b.expansion + b.consolidacion)} ha`}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onElegir(b.clave)
              }
            }}
          >
            {/* Blanco de clic mas grande que la barra. */}
            <rect x={i * paso} y={0} width={paso} height={alto} fill="transparent" />
            <rect x={x} y={base - hExp} width={grueso} height={Math.max(0, hExp)} rx={2} fill={COLOR_EXPANSION} />
            {hCon > 0 && (
              <rect
                x={x}
                y={base - hExp - hCon - (hExp > 0 ? 2 : 0)}
                width={grueso}
                height={Math.max(0, hCon)}
                rx={2}
                fill={COLOR_CONSOLIDACION}
              />
            )}
            <text x={x + grueso / 2} y={base - hExp - hCon - 7} textAnchor="middle" className="resumen-valor">
              {ha(b.expansion + b.consolidacion)}
            </text>
            {b.color && <rect x={i * paso + paso / 2 - 22} y={alto - 14} width={7} height={7} rx={1.5} fill={b.color} />}
            <text x={i * paso + paso / 2 + (b.color ? 4 : 0)} y={alto - 6} textAnchor="middle" className="resumen-eje">
              {b.etiqueta}
            </text>
            {activa && <line x1={x} x2={x + grueso} y1={alto - 1} y2={alto - 1} className="resumen-marca" />}
          </g>
        )
      })}
    </svg>
  )
}

/** Tasa anual por quinquenio, del censo y de la proyeccion; el hueco 2020-2025 se marca, no se rellena. */
function Tasas({ observado, previsto }: { observado: Observado[]; previsto: Previsto[] }) {
  const filas = [
    ...observado.map((o) => ({ clave: o.periodo, etiqueta: `${String(o.inicio).slice(2)}-${String(o.fin).slice(2)}`, tasa: o.poblacion.tasa_anual })),
    { clave: '2020-2025', etiqueta: '20-25', tasa: null as number | null },
    ...previsto
      .filter((p) => p.poblacion)
      .map((p) => ({ clave: String(p.horizonte), etiqueta: `${String(p.horizonte - 5).slice(2)}-${String(p.horizonte).slice(2)}`, tasa: p.poblacion!.tasa_anual })),
  ]
  const ancho = 440
  const alto = 112
  const arriba = 18
  const abajo = 22
  const util = alto - arriba - abajo
  const maximo = Math.max(...filas.map((f) => f.tasa ?? 0))
  const paso = ancho / filas.length
  const grueso = Math.min(18, paso * 0.4)
  return (
    <svg viewBox={`0 0 ${ancho} ${alto}`} className="resumen-grafica" role="img" aria-label="Crecimiento anual de la población por quinquenio">
      <line x1={0} x2={ancho} y1={alto - abajo} y2={alto - abajo} className="resumen-base" />
      <line x1={5 * paso} x2={5 * paso} y1={arriba - 10} y2={alto - abajo} className="resumen-corte" />
      {filas.map((f, i) => {
        const x = i * paso + (paso - grueso) / 2
        const h = f.tasa === null ? 0 : (f.tasa / maximo) * util
        return (
          <g key={f.clave}>
            {f.tasa === null ? (
              <text x={i * paso + paso / 2} y={alto - abajo - 6} textAnchor="middle" className="resumen-eje">
                —
              </text>
            ) : (
              <>
                <rect x={x} y={alto - abajo - h} width={grueso} height={h} rx={2} className="resumen-tasa" />
                <text x={x + grueso / 2} y={alto - abajo - h - 6} textAnchor="middle" className="resumen-valor">
                  {(f.tasa * 100).toFixed(1)}
                </text>
              </>
            )}
            <text x={i * paso + paso / 2} y={alto - 6} textAnchor="middle" className="resumen-eje">
              {f.etiqueta}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export default function ResumenCrecimiento({ datos, horizonte, onHorizonte, colores }: Props) {
  const [ambito, setAmbito] = useState<Ambito>('municipio')
  const [periodo, setPeriodo] = useState<string>(datos.observado[datos.observado.length - 1]?.periodo ?? '')
  const [tabla, setTabla] = useState(false)
  // El detalle sigue a lo ultimo que se toco: un periodo observado o un horizonte del automata.
  const [detalle, setDetalle] = useState<'observado' | 'previsto'>('previsto')

  const obs = datos.observado.find((o) => o.periodo === periodo)
  const prev = datos.previsto.find((p) => String(p.horizonte) === horizonte)
  const municipal = ambito === 'municipio'

  return (
    <section className="resumen px-4 py-3.5" data-testid="resumen-crecimiento">
      <h2 className="rotulo mb-2">Crecimiento por quinquenio</h2>
      <div className="indices mb-3" role="radiogroup" aria-label="Ámbito">
        {AMBITOS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={ambito === a.id}
            className={ambito === a.id ? 'activa' : ''}
            onClick={() => setAmbito(a.id)}
          >
            {a.etiqueta}
          </button>
        ))}
      </div>

      <p className="resumen-leyenda">
        <span><i style={{ background: COLOR_EXPANSION }} />Expansión</span>
        <span><i style={{ background: COLOR_CONSOLIDACION }} />Consolidación</span>
      </p>

      <h3 className="resumen-titulo">Observado: construcción nueva, ha de techo (GHSL)</h3>
      <Barras
        titulo="Construcción nueva observada por quinquenio"
        barras={datos.observado.map((o) => ({
          clave: o.periodo,
          etiqueta: o.periodo.replace(/(\d{2})(\d{2})-(\d{2})(\d{2})/, '$2-$4'),
          expansion: o[ambito].expansion_ha,
          consolidacion: o[ambito].consolidacion_ha,
        }))}
        elegida={detalle === 'observado' ? periodo : null}
        onElegir={(clave) => {
          setPeriodo(clave)
          setDetalle('observado')
        }}
      />

      <h3 className="resumen-titulo">Autómata: suelo previsto por horizonte, ha</h3>
      <Barras
        titulo="Suelo previsto por el autómata por horizonte"
        barras={datos.previsto.map((p) => ({
          clave: String(p.horizonte),
          etiqueta: String(p.horizonte),
          color: colores[String(p.horizonte)],
          expansion: p[ambito].expansion_ha,
          consolidacion: p[ambito].consolidacion_ha,
        }))}
        elegida={detalle === 'previsto' ? horizonte : null}
        onElegir={(clave) => {
          onHorizonte(clave)
          setDetalle('previsto')
        }}
      />

      <h3 className="resumen-titulo">Población: crecimiento anual, % (municipio)</h3>
      <Tasas observado={datos.observado} previsto={datos.previsto} />
      <p className="resumen-pie">Censos de INEGI hasta 2020; proyección CONAPO/SAPAL desde 2025. 2020-2025 no se calcula: une dos fuentes.</p>

      <div className="resumen-detalle" aria-live="polite">
        {detalle === 'observado' && obs && (
          <p>
            <strong>{obs.periodo}:</strong> {ha(obs[ambito].total_ha)} ha de techo nuevo ({ha(obs[ambito].expansion_ha)} en expansión y{' '}
            {ha(obs[ambito].consolidacion_ha)} en consolidación). La población creció {pct(obs.poblacion.tasa_anual)} al año (+
            {miles(obs.poblacion.aumento)} habitantes)
            {municipal ? `: ${obs.ha_por_1000_hab_nuevos.toFixed(1)} ha de techo por cada 1,000 habitantes nuevos.` : '.'}
          </p>
        )}
        {detalle === 'previsto' && prev && (
          <p>
            <strong>Horizonte {prev.horizonte}:</strong> {ha(prev[ambito].total_ha)} ha de suelo ({ha(prev[ambito].expansion_ha)} en expansión y{' '}
            {ha(prev[ambito].consolidacion_ha)} en consolidación). El modelo le asigna {miles(prev.automata.pob)} habitantes
            {prev.automata.hab_por_ha ? ` (${Math.round(prev.automata.hab_por_ha)} por ha)` : ''}.
            {prev.poblacion
              ? ` La proyección suma ${miles(prev.poblacion.aumento)} (${pct(prev.poblacion.tasa_anual)} al año)${
                  municipal && prev.ha_por_1000_hab_nuevos !== null
                    ? `: ${prev.ha_por_1000_hab_nuevos.toFixed(1)} ha de suelo por cada 1,000 habitantes nuevos.`
                    : '.'
                }`
              : ' Sin par en la proyección: es el año base supuesto.'}
          </p>
        )}
        {!municipal && <p className="tenue">La población es municipal: la relación por habitante solo se da para el municipio.</p>}
      </div>

      <p className="resumen-pie">
        Expansión: celda de 100 m con menos de 20 % construido al inicio del periodo; consolidación, 20 % o más. Lo observado mide
        techos y el autómata, suelo: no se comparan barra con barra. Horizontes del modelo; año base supuesto 2025.
      </p>
      <button type="button" className="enlace text-xs" onClick={() => setTabla((t) => !t)} aria-expanded={tabla}>
        {tabla ? 'Ocultar tabla' : 'Ver tabla'}
      </button>
      {tabla && (
        <div className="resumen-tabla">
          <table>
            <thead>
              <tr>
                <th>Periodo</th>
                <th>Expansión, ha</th>
                <th>Consolidación, ha</th>
                <th>Población, % anual</th>
              </tr>
            </thead>
            <tbody>
              {datos.observado.map((o) => (
                <tr key={o.periodo}>
                  <td>{o.periodo} (techo)</td>
                  <td>{ha(o[ambito].expansion_ha)}</td>
                  <td>{ha(o[ambito].consolidacion_ha)}</td>
                  <td>{pct(o.poblacion.tasa_anual)}</td>
                </tr>
              ))}
              {datos.previsto.map((p) => (
                <tr key={p.horizonte}>
                  <td>Horizonte {p.horizonte} (suelo)</td>
                  <td>{ha(p[ambito].expansion_ha)}</td>
                  <td>{ha(p[ambito].consolidacion_ha)}</td>
                  <td>{p.poblacion ? pct(p.poblacion.tasa_anual) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
