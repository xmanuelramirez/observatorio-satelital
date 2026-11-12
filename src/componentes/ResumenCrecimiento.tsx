import { useState } from 'react'

/**
 * Tablero de «Zonas de crecimiento»: expansion y consolidacion por quinquenio, observadas (estimacion GHSL 2000-2020) y
 * previstas por el automata (horizontes 2025-2050), junto al crecimiento de la poblacion de los censos. Lo genera
 * `herramientas/crecimiento_resumen.py`, con las condiciones del dictamen del juez del 12/11/2026
 * (`ORDENES-DEL-MASTER/juez-2026-11-12-quinquenios/DICTAMEN.md`):
 *   1. Sin proyeccion de poblacion: la serie anterior se esta ajustando a la Intercensal 2025.
 *   2. Sin «ha por cada 1,000 habitantes nuevos»: el techo observado y el suelo del automata no se comparan.
 *   3. Lo observado se rotula como estimacion interpolada; techo y suelo en tablas separadas.
 *   4. La densidad del automata es un supuesto del modelo, no un resultado.
 *   5. Sensibilidad del umbral de expansion (10 a 30 %).
 *   6. El automata se cita con la union del vector.
 *   7. Tasas con las fechas reales de los censos.
 * El detalle de una barra se abre con clic, no al pasar el cursor; en el autómata, el clic tambien cambia el horizonte.
 */

type Ambito = 'municipio' | 'dentro_limite_urbano' | 'fuera_limite_urbano'

interface Partes {
  expansion_ha: number
  consolidacion_ha: number
  total_ha: number
}

interface Observado extends Record<Ambito, Partes> {
  periodo: string
  inicio: number
  fin: number
  poblacion: { inicio: number; fin: number; aumento: number; anios: number; tasa_anual: number }
  expansion_de_cada_100_por_umbral: Record<string, number>
}

interface Previsto extends Record<Ambito, Partes> {
  horizonte: number
  automata: { poligonos: number; pob: number; hab_por_ha_supuesto: number | null; hab_por_vivienda_supuesto: number }
}

export interface DatosResumen {
  generado: string
  observado_rotulo: string
  automata_ha_union: number
  fechas_censo: Record<string, string>
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
// Poblacion: color con un solo significado en el panel (ni gris, ni azul marino, ni el de ningun horizonte); validado
// contra los seis horizontes, expansion y consolidacion, con daltonismo, sobre el panel (MASTER, 12/11/2026).
const COLOR_POBLACION = '#4fc3d9'

const ha = (n: number) => Math.round(n).toLocaleString('es-MX')
const pct = (n: number) => `${(n * 100).toFixed(1)} %`
const miles = (n: number) => Math.round(n).toLocaleString('es-MX')
const corto = (periodo: string) => periodo.replace(/(\d{2})(\d{2})-(\d{2})(\d{2})/, '$2-$4')

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

/** Tasa anual de los censos por quinquenio, con las fechas reales de levantamiento. */
function Tasas({ observado }: { observado: Observado[] }) {
  const ancho = 440
  const alto = 104
  const arriba = 18
  const abajo = 22
  const util = alto - arriba - abajo
  const maximo = Math.max(...observado.map((o) => o.poblacion.tasa_anual))
  const paso = ancho / observado.length
  const grueso = Math.min(34, paso * 0.56)
  return (
    <svg viewBox={`0 0 ${ancho} ${alto}`} className="resumen-grafica" role="img" aria-label="Crecimiento anual de la población por quinquenio, censos">
      <line x1={0} x2={ancho} y1={alto - abajo} y2={alto - abajo} className="resumen-base" />
      {observado.map((o, i) => {
        const x = i * paso + (paso - grueso) / 2
        const h = (o.poblacion.tasa_anual / maximo) * util
        return (
          <g key={o.periodo}>
            <rect x={x} y={alto - abajo - h} width={grueso} height={h} rx={2} fill={COLOR_POBLACION} />
            <text x={x + grueso / 2} y={alto - abajo - h - 6} textAnchor="middle" className="resumen-valor">
              {(o.poblacion.tasa_anual * 100).toFixed(1)}
            </text>
            <text x={i * paso + paso / 2} y={alto - 6} textAnchor="middle" className="resumen-eje">
              {corto(o.periodo)}
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
  const umbral = (o: Observado) =>
    `con umbral de 10, 20 o 30 %, ${o.expansion_de_cada_100_por_umbral['10']}, ${o.expansion_de_cada_100_por_umbral['20']} o ${o.expansion_de_cada_100_por_umbral['30']} de cada 100 ha de techo nuevo son expansión`

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

      <h3 className="resumen-titulo">Observado: techo nuevo, ha</h3>
      <p className="resumen-pie">{datos.observado_rotulo}.</p>
      <Barras
        titulo="Techo nuevo estimado por quinquenio"
        barras={datos.observado.map((o) => ({
          clave: o.periodo,
          etiqueta: corto(o.periodo),
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
      <p className="resumen-pie">
        {datos.automata_ha_union.toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ha en total;
        cada barra es la superficie del vector en su horizonte. Horizontes del modelo; año
        base supuesto 2025.
      </p>
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

      <div className="resumen-detalle" aria-live="polite">
        {detalle === 'observado' && obs && (
          <p>
            <strong>{obs.periodo}:</strong> {ha(obs[ambito].total_ha)} ha de techo nuevo ({ha(obs[ambito].expansion_ha)} en expansión y{' '}
            {ha(obs[ambito].consolidacion_ha)} en consolidación). En el municipio, {umbral(obs)}.
          </p>
        )}
        {detalle === 'previsto' && prev && (
          <p>
            <strong>Horizonte {prev.horizonte}:</strong> {ha(prev[ambito].total_ha)} ha de suelo ({ha(prev[ambito].expansion_ha)} en expansión y{' '}
            {ha(prev[ambito].consolidacion_ha)} en consolidación). El modelo le asigna {miles(prev.automata.pob)} habitantes con un
            supuesto de {prev.automata.hab_por_ha_supuesto} hab/ha ({prev.automata.hab_por_vivienda_supuesto} hab/vivienda): es un
            insumo del modelo, no un resultado.
          </p>
        )}
      </div>

      <h3 className="resumen-titulo">Población del municipio: crecimiento anual, %</h3>
      <Tasas observado={datos.observado} />
      <p className="resumen-pie">
        Censos de INEGI (2015, Encuesta Intercensal), con las fechas reales de levantamiento. Siguiente paso: la proyección a
        2050, una vez ajustada a la Intercensal 2025.
      </p>

      <p className="resumen-pie">
        Expansión: celda de 100 m con menos de 20 % construido al inicio del periodo; consolidación, 20 % o más. El reparto
        depende del umbral (de 10 a 30 %, en 2010-2015 la expansión va de 38 a 68 de cada 100) y la expansión incluye relleno de
        borde y caserío disperso. Lo observado mide techo y el autómata, suelo: no se comparan entre sí.
      </p>
      <button type="button" className="enlace text-xs" onClick={() => setTabla((t) => !t)} aria-expanded={tabla}>
        {tabla ? 'Ocultar tablas' : 'Ver tablas'}
      </button>
      {tabla && (
        <div className="resumen-tabla">
          <table>
            <caption>Techo nuevo, estimación GHSL (ha)</caption>
            <thead>
              <tr>
                <th>Periodo</th>
                <th>Expansión</th>
                <th>Consolidación</th>
                <th>Expansión de cada 100, umbral 10/20/30 %</th>
                <th>Población, % anual</th>
              </tr>
            </thead>
            <tbody>
              {datos.observado.map((o) => (
                <tr key={o.periodo}>
                  <td>{o.periodo}</td>
                  <td>{ha(o[ambito].expansion_ha)}</td>
                  <td>{ha(o[ambito].consolidacion_ha)}</td>
                  <td>
                    {o.expansion_de_cada_100_por_umbral['10']}/{o.expansion_de_cada_100_por_umbral['20']}/{o.expansion_de_cada_100_por_umbral['30']}
                  </td>
                  <td>{pct(o.poblacion.tasa_anual)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table>
            <caption>Suelo previsto por el autómata (ha)</caption>
            <thead>
              <tr>
                <th>Horizonte</th>
                <th>Expansión</th>
                <th>Consolidación</th>
                <th>Habitantes del modelo</th>
              </tr>
            </thead>
            <tbody>
              {datos.previsto.map((p) => (
                <tr key={p.horizonte}>
                  <td>{p.horizonte}</td>
                  <td>{ha(p[ambito].expansion_ha)}</td>
                  <td>{ha(p[ambito].consolidacion_ha)}</td>
                  <td>{miles(p.automata.pob)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="resumen-pie">La sensibilidad del umbral y la población son del municipio.</p>
        </div>
      )}
    </section>
  )
}
