import { useState } from 'react'

/**
 * «Ritmo de crecimiento»: tomas, convenios, factibilidades y satélite por año, en una sola lectura. Pedido de Carlos del
 * 18/11/2026; publicado por su decisión del 19/11. Lo genera `herramientas/ritmo_crecimiento_json.py` con las condiciones
 * del dictamen del juez (`ORDENES-DEL-MASTER/2026-11-18-DICTAMEN-JUEZ-RITMO-CRECIMIENTO.md`):
 *   - sin habitantes; la parte de tomas en convenios es cota inferior;
 *   - consolidación solo con años completos; factibilidad a convenio por superficie;
 *   - techo solo como agregado 2000-2020.
 * Solo totales por año del padrón: ninguna cuenta ni ubicación. El detalle de un año se abre con clic.
 */

interface Anio {
  anio: number
  parcial: boolean
  tomas_domesticas: number
  tomas_todas: number
  tomas_fuera_limite: number
  convenios: number
  unidades_convenidas: number
  convenios_ha: number
  en_convenios_desde_2020_de_cada_100: number
  factibilidad_ha: number | null
  factibilidad_bajo_convenio_de_cada_100_ha: number | null
}

export interface DatosRitmo {
  generado: string
  corte: string
  promedio_tomas_2021_2025: number
  censo_2010_2020: { tomas_nuevas: number; viviendas_habitadas_mas: number; razon: number }
  anios: Anio[]
  cohortes: { cohorte: number; acumulado_de_cada_100: number[] }[]
  por_contratar_unidades: number
  techo_m2_por_toma_2000_2020: number
  automata_2025_2030: { ha: number; fuera_limite_de_cada_100: number }
  /** Frases de lectura del dictamen; viajan con los datos, no en el codigo. */
  lectura: { consolidacion: string; coherencia: string }
}

// Tomas en tinta; convenios con el mismo tono de su contorno en el mapa.
const COLOR_TOMAS = 'var(--color-tinta)'
const COLOR_CONVENIOS = '#78dcdc'

const n = (v: number) => Math.round(v).toLocaleString('es-MX')
const etiquetaAnio = (a: Anio) => (a.parcial ? `${a.anio}*` : String(a.anio))

/** Por año: tomas domésticas nuevas (barra ancha) y unidades convenidas (barra delgada al lado). */
function BarrasAnio({ anios, elegido, onElegir }: { anios: Anio[]; elegido: number; onElegir: (a: number) => void }) {
  const ancho = 440
  const alto = 160
  const arriba = 18
  const abajo = 22
  const util = alto - arriba - abajo
  const maximo = Math.max(...anios.flatMap((a) => [a.tomas_domesticas, a.unidades_convenidas]))
  const paso = ancho / anios.length
  const grueso = Math.min(26, paso * 0.4)
  const delgado = Math.min(10, paso * 0.16)
  const y = (v: number) => (v / maximo) * util
  const base = alto - abajo

  return (
    <svg viewBox={`0 0 ${ancho} ${alto}`} className="resumen-grafica" role="img" aria-label="Tomas domésticas nuevas y unidades convenidas por año">
      <line x1={0} x2={ancho} y1={base} y2={base} className="resumen-base" />
      {anios.map((a, i) => {
        const x = i * paso + (paso - grueso - delgado - 3) / 2
        const activa = elegido === a.anio
        const hT = y(a.tomas_domesticas)
        const hC = y(a.unidades_convenidas)
        return (
          <g
            key={a.anio}
            className={`resumen-barra ${activa ? 'activa' : ''}`}
            onClick={() => onElegir(a.anio)}
            role="button"
            tabIndex={0}
            aria-pressed={activa}
            aria-label={`${a.anio}: ${n(a.tomas_domesticas)} tomas domésticas, ${n(a.unidades_convenidas)} unidades convenidas`}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onElegir(a.anio)
              }
            }}
          >
            <rect x={i * paso} y={0} width={paso} height={alto} fill="transparent" />
            <rect x={x} y={base - hT} width={grueso} height={hT} rx={2} fill={COLOR_TOMAS} opacity={a.parcial ? 0.45 : 0.92} />
            <rect x={x + grueso + 3} y={base - hC} width={delgado} height={hC} rx={2} fill={COLOR_CONVENIOS} opacity={a.parcial ? 0.45 : 1} />
            <text x={x + grueso / 2} y={base - hT - 6} textAnchor="middle" className="resumen-valor">
              {(a.tomas_domesticas / 1000).toFixed(1)}
            </text>
            <text x={i * paso + paso / 2} y={alto - 6} textAnchor="middle" className="resumen-eje">
              {etiquetaAnio(a)}
            </text>
            {activa && <line x1={x} x2={x + grueso + 3 + delgado} y1={alto - 1} y2={alto - 1} className="resumen-marca" />}
          </g>
        )
      })}
    </svg>
  )
}

/** Consolidación acumulada por cohorte de firma: de cada 100 unidades convenidas, cuántas ya tienen contrato. */
function Cohortes({ cohortes }: { cohortes: DatosRitmo['cohortes'] }) {
  const ancho = 440
  const alto = 150
  const izq = 26
  const der = 40
  const arriba = 10
  const abajo = 22
  const kMax = Math.max(...cohortes.map((c) => c.acumulado_de_cada_100.length)) - 1
  const x = (k: number) => izq + (k / Math.max(1, kMax)) * (ancho - izq - der)
  const y = (v: number) => arriba + (1 - v / 100) * (alto - arriba - abajo)
  const recientes = cohortes.length

  return (
    <svg viewBox={`0 0 ${ancho} ${alto}`} className="resumen-grafica" role="img" aria-label="Consolidación acumulada por cohorte de firma">
      {[0, 50, 100].map((v) => (
        <g key={v}>
          <line x1={izq} x2={ancho - der} y1={y(v)} y2={y(v)} className={v === 0 ? 'resumen-base' : 'resumen-corte'} />
          <text x={izq - 5} y={y(v) + 4} textAnchor="end" className="resumen-eje">{v}</text>
        </g>
      ))}
      {Array.from({ length: kMax + 1 }, (_, k) => (
        <text key={k} x={x(k)} y={alto - 6} textAnchor="middle" className="resumen-eje">
          {k === 0 ? 'firma' : `+${k}`}
        </text>
      ))}
      {cohortes.map((c, i) => {
        const pts = c.acumulado_de_cada_100
        const fuerte = pts.length >= 5
        const ultimo = pts.length - 1
        return (
          <g key={c.cohorte} opacity={fuerte ? 1 : 0.35 + (0.35 * i) / recientes}>
            <polyline
              points={pts.map((v, k) => `${x(k)},${y(v)}`).join(' ')}
              fill="none"
              stroke={COLOR_CONVENIOS}
              strokeWidth={fuerte ? 2.2 : 1.3}
              strokeLinejoin="round"
            />
            {pts.map((v, k) => (
              <circle key={k} cx={x(k)} cy={y(v)} r={fuerte ? 2.4 : 1.8} fill={COLOR_CONVENIOS} />
            ))}
            {fuerte && (
              <text x={x(ultimo) + 6} y={y(pts[ultimo]) + 4} className="resumen-valor">
                {c.cohorte}: {pts[ultimo]}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

export default function RitmoCrecimiento({ datos }: { datos: DatosRitmo }) {
  const ultimoCompleto = [...datos.anios].reverse().find((a) => !a.parcial) ?? datos.anios[datos.anios.length - 1]
  const [elegido, setElegido] = useState<number>(ultimoCompleto.anio)
  const [tabla, setTabla] = useState(false)
  const a = datos.anios.find((x) => x.anio === elegido)
  const parcial = datos.anios.find((x) => x.parcial)
  const fac = datos.anios.filter((x) => x.factibilidad_ha !== null).map((x) => x.factibilidad_ha as number)
  const facConv = datos.anios
    .filter((x) => x.factibilidad_bajo_convenio_de_cada_100_ha !== null)
    .map((x) => x.factibilidad_bajo_convenio_de_cada_100_ha as number)
  const c = datos.censo_2010_2020

  return (
    <section className="resumen px-4 py-3.5" data-testid="ritmo-crecimiento">
      <h2 className="rotulo mb-2">Ritmo de crecimiento</h2>
      <p className="frase cifra m-0">Unas {n(Math.round(datos.promedio_tomas_2021_2025 / 100) * 100)} tomas nuevas al año</p>
      <p className="resumen-pie">
        Tomas domésticas nuevas, promedio 2021-2025 ({n(datos.promedio_tomas_2021_2025)}), padrón activo a {datos.corte} por fecha de
        contrato. En 2010-2020 igualaron al censo en viviendas: {n(c.tomas_nuevas)} tomas contra {n(c.viviendas_habitadas_mas)}{' '}
        viviendas habitadas más ({c.razon.toFixed(2)}).
      </p>

      <p className="resumen-leyenda mt-2">
        <span><i style={{ background: COLOR_TOMAS }} />Tomas domésticas nuevas, miles</span>
        <span><i style={{ background: COLOR_CONVENIOS }} />Unidades convenidas</span>
      </p>
      <BarrasAnio anios={datos.anios} elegido={elegido} onElegir={setElegido} />
      {parcial && <p className="resumen-pie">* {parcial.anio}, de enero a septiembre.</p>}

      {a && (
        <div className="resumen-detalle" aria-live="polite">
          <p>
            <strong>{a.anio}{a.parcial ? ' (ene-sep)' : ''}:</strong> {n(a.tomas_domesticas)} tomas domésticas nuevas. De cada 100 tomas
            nuevas de todas las tarifas, {Math.round((a.tomas_fuera_limite / a.tomas_todas) * 100)} quedan fuera del límite urbano.
          </p>
          <p>
            {n(a.convenios)} convenios con {n(a.unidades_convenidas)} unidades en {n(a.convenios_ha)} ha. Al menos{' '}
            {a.en_convenios_desde_2020_de_cada_100} de cada 100 tomas del año caen en convenios firmados desde 2020 (cota inferior: los
            anteriores no están en la capa).
          </p>
          {a.factibilidad_ha !== null && (
            <p>
              Factibilidades con polígono: {n(a.factibilidad_ha)} ha
              {a.factibilidad_bajo_convenio_de_cada_100_ha !== null
                ? `; de cada 100 ha nuevas, ${a.factibilidad_bajo_convenio_de_cada_100_ha} quedaron bajo convenio en los años siguientes.`
                : '; su paso a convenio aún no se puede medir.'}
            </p>
          )}
        </div>
      )}

      <h3 className="resumen-titulo">Del convenio al contrato: de cada 100 unidades, acumulado</h3>
      <Cohortes cohortes={datos.cohortes} />
      <p className="resumen-pie">
        Una línea por año de firma; solo años completos. {datos.lectura.consolidacion} Por contratar a{' '}
        {datos.corte}: {n(datos.por_contratar_unidades)} unidades.
      </p>

      <h3 className="resumen-titulo">Factibilidades: oferta en trámite, no ritmo</h3>
      <p className="resumen-pie">
        De {n(Math.round(Math.min(...fac) / 100) * 100)} a {n(Math.round(Math.max(...fac) / 100) * 100)} ha al año con polígono, sin
        tendencia a la baja. De cada 100 ha nuevas, de {Math.min(...facConv)} a {Math.max(...facConv)} quedan bajo convenio en los años
        siguientes.
      </p>

      <h3 className="resumen-titulo">Satélite</h3>
      <p className="resumen-pie">
        Unos {datos.techo_m2_por_toma_2000_2020} m² de techo por toma doméstica nueva en 2000-2020 (incluye techo no habitacional). El
        autómata prevé {n(datos.automata_2025_2030.ha)} ha al horizonte 2025-2030, {datos.automata_2025_2030.fuera_limite_de_cada_100} de
        cada 100 fuera del límite urbano.
      </p>

      <h3 className="resumen-titulo">Coherencia</h3>
      <p className="resumen-pie">
        {datos.lectura.coherencia}
      </p>

      <button type="button" className="enlace text-xs" onClick={() => setTabla((t) => !t)} aria-expanded={tabla}>
        {tabla ? 'Ocultar tabla' : 'Ver tabla'}
      </button>
      {tabla && (
        <div className="resumen-tabla">
          <table>
            <caption>Por año</caption>
            <thead>
              <tr>
                <th>Año</th>
                <th>Tomas dom.</th>
                <th>Fuera del límite</th>
                <th>Convenios</th>
                <th>Unidades</th>
                <th>ha conv.</th>
                <th>En conv. desde 2020, de 100</th>
                <th>ha factib.</th>
              </tr>
            </thead>
            <tbody>
              {datos.anios.map((x) => (
                <tr key={x.anio}>
                  <td>{etiquetaAnio(x)}</td>
                  <td>{n(x.tomas_domesticas)}</td>
                  <td>{n(x.tomas_fuera_limite)}</td>
                  <td>{n(x.convenios)}</td>
                  <td>{n(x.unidades_convenidas)}</td>
                  <td>{n(x.convenios_ha)}</td>
                  <td>{x.en_convenios_desde_2020_de_cada_100}</td>
                  <td>{x.factibilidad_ha === null ? '' : n(x.factibilidad_ha)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table>
            <caption>Consolidación por cohorte, de cada 100 unidades</caption>
            <thead>
              <tr>
                <th>Firma</th>
                {Array.from({ length: Math.max(...datos.cohortes.map((x) => x.acumulado_de_cada_100.length)) }, (_, k) => (
                  <th key={k}>{k === 0 ? 'mismo año' : `+${k}`}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {datos.cohortes.map((x) => (
                <tr key={x.cohorte}>
                  <td>{x.cohorte}</td>
                  {x.acumulado_de_cada_100.map((v, k) => (
                    <td key={k}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="resumen-pie">«Fuera del límite» cuenta tomas nuevas de todas las tarifas.</p>
        </div>
      )}
      <p className="resumen-pie">
        Fuentes: Análisis de Cuentas (tomas), Balance Hídrico (convenios) y Nuevos Desarrollos (factibilidades, base oficial). Solo
        totales por año. Revisado por el juez el 18/11/2026.
      </p>
    </section>
  )
}
