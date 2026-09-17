import { CONDICIONES, type CondicionCn, type ResultadoEscurrimiento } from '../servicios/escurrimiento'

interface Props {
  disponible: boolean
  lluviaMm: number
  onLluviaMm: (valor: number) => void
  condicion: CondicionCn
  onCondicion: (valor: CondicionCn) => void
  zonasObra: number
  calculando: boolean
  resultado: ResultadoEscurrimiento | null
  error: string | null
  onCalcular: () => void
}

function miles(valor: number): string {
  return valor.toLocaleString('es-MX', { maximumFractionDigits: 0 })
}

export default function PanelEscurrimiento({
  disponible,
  lluviaMm,
  onLluviaMm,
  condicion,
  onCondicion,
  zonasObra,
  calculando,
  resultado,
  error,
  onCalcular,
}: Props) {
  return (
    <section className="border-b border-filete px-4 py-3.5">
      <h2 className="rotulo mb-2.5">Escurrimiento</h2>

      {!disponible ? (
        <p className="text-xs leading-snug text-tinta-suave">
          Necesita la capa de número de curva del departamento, que no viaja al sitio público.
          Corre en la copia interna.
        </p>
      ) : (
        <>
          <p className="mb-2.5 text-xs leading-snug text-tinta-suave">
            Método del número de curva sobre las subcuencas del departamento. El satélite aporta
            la superficie que se impermeabilizó: las zonas del modo Obra suben el número de curva
            donde caen.
          </p>

          <label className="mb-2.5 block">
            <span className="mb-1 block text-xs text-tinta-suave">
              Lluvia de diseño: <span className="cifra text-tinta">{lluviaMm}</span> mm
            </span>
            <input
              type="range"
              min={10}
              max={120}
              step={5}
              value={lluviaMm}
              onChange={(evento) => onLluviaMm(Number(evento.target.value))}
              className="w-full"
            />
          </label>

          <label className="mb-2.5 block">
            <span className="mb-1 block text-xs text-tinta-suave">Condición de humedad previa</span>
            <select
              className="campo"
              value={condicion}
              onChange={(evento) => onCondicion(evento.target.value as CondicionCn)}
            >
              {CONDICIONES.map((opcion) => (
                <option key={opcion.id} value={opcion.id}>
                  {opcion.etiqueta} · {opcion.descripcion}
                </option>
              ))}
            </select>
          </label>

          <p className="mb-2.5 text-xs leading-snug text-rotulo">
            {zonasObra > 0
              ? `Se usarán las ${zonasObra} zonas de obra nueva del último cálculo.`
              : 'Sin zonas de obra cargadas: corre el modo Obra primero para ver cuánto agregó el crecimiento.'}
          </p>

          <button
            type="button"
            onClick={onCalcular}
            disabled={calculando}
            className="boton-principal"
          >
            {calculando ? 'Calculando...' : 'Calcular escurrimiento'}
          </button>

          {error && (
            <p className="mt-2 text-xs leading-snug text-peligro" role="alert">
              {error}
            </p>
          )}

          {resultado && (
            <div className="mt-3">
              <div className="border border-filete bg-panel-hondo p-3">
                <p className="rotulo">Volumen escurrido</p>
                <p className="cifra mt-1 text-[17px] font-semibold text-tinta">
                  {miles(resultado.totalVolumenNuevoM3)} m³
                </p>
                <p className="mt-1 text-xs leading-snug text-tinta-suave">
                  Con una lluvia de {resultado.lluviaMm} mm sobre{' '}
                  {miles(resultado.filas.reduce((s, f) => s + f.areaKm2, 0))} km² de subcuencas.
                </p>
                {resultado.hectareasNuevas > 0 && (
                  <p className="mt-1.5 text-xs leading-snug text-aviso">
                    De ese total, {miles(resultado.totalVolumenNuevoM3 - resultado.totalVolumenM3)}{' '}
                    m³ los agrega la obra nueva ({resultado.hectareasNuevas.toFixed(0)} ha
                    impermeabilizadas).
                  </p>
                )}
              </div>

              <ul className="mt-2.5 max-h-52 overflow-y-auto">
                {resultado.filas.slice(0, 15).map((fila) => (
                  <li key={fila.nombre} className="border-b border-filete py-1.5 text-xs">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-tinta">{fila.nombre}</span>
                      <span className="cifra text-tinta-suave">
                        {miles(fila.volumenNuevoM3)} m³
                      </span>
                    </div>
                    <div className="cifra mt-0.5 flex items-baseline justify-between gap-2 text-rotulo">
                      <span>
                        CN {fila.cn.toFixed(1)}
                        {fila.hectareasNuevas > 0 && ` → ${fila.cnNuevo.toFixed(1)}`}
                      </span>
                      <span>
                        {fila.laminaNuevaMm.toFixed(1)} mm · {fila.areaKm2.toFixed(1)} km²
                      </span>
                    </div>
                  </li>
                ))}
              </ul>

              {resultado.zonasFuera > 0 && (
                <p className="mt-2 text-xs leading-snug text-rotulo">
                  {resultado.zonasFuera} zonas de obra cayeron fuera de las subcuencas y no se
                  contaron.
                </p>
              )}

              <p className="mt-2 text-xs leading-snug text-rotulo">
                Lámina por el método SCS con el número de curva de la capa del departamento. La
                obra nueva se trata como superficie impermeable y mueve el número de curva en
                proporción al área que ocupa dentro de cada subcuenca.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  )
}
