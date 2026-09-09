import type { EntradaLeyenda } from '../servicios/analisis'
import type { DefinicionIndice } from '../servicios/indices'
import type { Coleccion, Escena, GrupoDia, ModoVista, NombreBanda } from '../tipos'

interface Props {
  /** Escenas activas del dia elegido, ya en orden de prioridad del mosaico. */
  escenas: Escena[]
  coleccion: Coleccion
  modo: ModoVista
  onModo: (modo: ModoVista) => void
  indices: DefinicionIndice[]
  indice: DefinicionIndice | null
  onIndice: (id: string) => void
  bandasDisponibles: NombreBanda[]
  bandasKmeans: NombreBanda[]
  onBandaKmeans: (banda: NombreBanda) => void
  k: number
  onK: (k: number) => void
  tamano: number
  onTamano: (tamano: number) => void
  calculando: boolean
  onCalcular: () => void
  error: string | null
  leyenda: EntradaLeyenda[]
  notas: string[]
  /** Dias distintos al elegido, que pueden servir de base en modo cambio. */
  diasReferencia: GrupoDia[]
  referencia: Escena[]
  onDiaReferencia: (dia: string) => void
  umbralCambio: number
  onUmbralCambio: (valor: number) => void
}

const MODOS: { id: ModoVista; etiqueta: string }[] = [
  { id: 'indice', etiqueta: 'Indice' },
  { id: 'cambio', etiqueta: 'Cambio' },
  { id: 'clases', etiqueta: 'Clases' },
  { id: 'color', etiqueta: 'Color' },
]

export default function PanelAnalisis({
  escenas,
  coleccion,
  modo,
  onModo,
  indices,
  indice,
  onIndice,
  bandasDisponibles,
  bandasKmeans,
  onBandaKmeans,
  k,
  onK,
  tamano,
  onTamano,
  calculando,
  onCalcular,
  error,
  leyenda,
  notas,
  diasReferencia,
  referencia,
  onDiaReferencia,
  umbralCambio,
  onUmbralCambio,
}: Props) {
  if (escenas.length === 0) {
    return (
      <p className="border-t border-[--color-borde] px-4 py-4 text-xs leading-snug text-tinta-suave">
        Elige una escena de la lista para analizarla.
      </p>
    )
  }

  const mallas = escenas.map((e) => e.malla || e.plataforma).join(' y ')
  const sinIndices = indices.length === 0
  const usaIndice = modo === 'indice' || modo === 'cambio'
  const puedeCalcular =
    !calculando &&
    (modo !== 'clases' || bandasKmeans.length >= 2) &&
    (!usaIndice || indice !== null) &&
    (modo !== 'cambio' || referencia.length > 0)

  return (
    <div className="border-t-2 border-tinta">
      <div className="px-4 py-3">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-tinta-suave">
          Analisis de la escena
        </h2>

        <div className="mb-3 flex gap-1">
          {MODOS.map((opcion) => (
            <button
              key={opcion.id}
              type="button"
              onClick={() => onModo(opcion.id)}
              disabled={(opcion.id === 'indice' || opcion.id === 'cambio') && sinIndices}
              className={`flex-1 rounded border px-2 py-1.5 text-xs transition disabled:opacity-40 ${
                modo === opcion.id
                  ? 'border-tinta bg-tinta text-white'
                  : 'border-[--color-borde] bg-white text-tinta-suave'
              }`}
            >
              {opcion.etiqueta}
            </button>
          ))}
        </div>

        {usaIndice && (
          <label className="mb-3 block">
            <span className="mb-1 block text-xs text-tinta-suave">Indice</span>
            <select
              className="w-full rounded border border-[--color-borde] bg-white px-2 py-1.5 text-sm"
              value={indice?.id ?? ''}
              onChange={(evento) => onIndice(evento.target.value)}
            >
              {indices.map((opcion) => (
                <option key={opcion.id} value={opcion.id}>
                  {opcion.etiqueta} - {opcion.descripcion}
                </option>
              ))}
            </select>
            {indice && (
              <p className="mt-1 text-[11px] text-tinta-suave">
                ({indice.a} menos {indice.b}) entre ({indice.a} mas {indice.b})
              </p>
            )}
          </label>
        )}

        {modo === 'cambio' && (
          <div className="mb-3 space-y-2 rounded border border-[--color-borde] bg-white/60 p-2">
            <p className="text-[11px] leading-snug text-tinta-suave">
              Fecha actual: <span className="font-medium text-tinta">{escenas[0].dia}</span> ({mallas})
            </p>

            <label className="block">
              <span className="mb-1 block text-xs text-tinta-suave">Comparar contra</span>
              <select
                className="w-full rounded border border-[--color-borde] bg-white px-2 py-1.5 text-sm"
                value={referencia[0]?.dia ?? ''}
                onChange={(evento) => onDiaReferencia(evento.target.value)}
              >
                <option value="">Elige la fecha base</option>
                {diasReferencia.map((grupo) => (
                  <option key={grupo.dia} value={grupo.dia}>
                    {grupo.dia} - {grupo.escenas.length} malla
                    {grupo.escenas.length === 1 ? '' : 's'}
                    {grupo.nubes !== null ? ` - ${grupo.nubes.toFixed(0)} por ciento nubes` : ''}
                  </option>
                ))}
              </select>
              {diasReferencia.length === 0 && (
                <p className="mt-1 text-[11px] text-rose-700">
                  No hay otra fecha en los resultados. Amplia el periodo y vuelve a buscar.
                </p>
              )}
              <span className="mt-1 block text-[11px] leading-snug text-tinta-suave">
                La fecha base entra con todas sus mallas unidas, para que las dos
                fechas se comparen sobre el mismo terreno.
              </span>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-tinta-suave">
                Umbral de cambio: {umbralCambio.toFixed(2)}
              </span>
              <input
                type="range"
                min={0.02}
                max={0.4}
                step={0.02}
                value={umbralCambio}
                onChange={(evento) => onUmbralCambio(Number(evento.target.value))}
                className="w-full accent-[#2b7fb8]"
              />
              <span className="text-[11px] leading-snug text-tinta-suave">
                Debajo de este valor la diferencia se considera ruido y no se pinta.
              </span>
            </label>
          </div>
        )}

        {modo === 'clases' && (
          <div className="mb-3 space-y-2">
            <div>
              <span className="mb-1 block text-xs text-tinta-suave">
                Bandas de entrada ({bandasKmeans.length} elegidas)
              </span>
              <div className="flex flex-wrap gap-1">
                {bandasDisponibles.map((banda) => {
                  const activa = bandasKmeans.includes(banda)
                  return (
                    <button
                      key={banda}
                      type="button"
                      onClick={() => onBandaKmeans(banda)}
                      className={`rounded border px-2 py-1 text-[11px] transition ${
                        activa
                          ? 'border-agua bg-sky-50 text-tinta'
                          : 'border-[--color-borde] bg-white text-tinta-suave'
                      }`}
                    >
                      {banda}
                    </button>
                  )
                })}
              </div>
              {bandasKmeans.length < 2 && (
                <p className="mt-1 text-[11px] text-rose-700">Elige al menos dos bandas.</p>
              )}
            </div>

            <label className="block">
              <span className="mb-1 block text-xs text-tinta-suave">Numero de clases: {k}</span>
              <input
                type="range"
                min={2}
                max={8}
                step={1}
                value={k}
                onChange={(evento) => onK(Number(evento.target.value))}
                className="w-full accent-[#2b7fb8]"
              />
            </label>
          </div>
        )}

        <label className="mb-3 block">
          <span className="mb-1 block text-xs text-tinta-suave">
            Rejilla de analisis: {tamano} por {tamano}
          </span>
          <select
            className="w-full rounded border border-[--color-borde] bg-white px-2 py-1.5 text-sm"
            value={tamano}
            onChange={(evento) => onTamano(Number(evento.target.value))}
          >
            <option value={256}>256 (rapido)</option>
            <option value={512}>512</option>
            <option value={1024}>1024 (lento, mas detalle)</option>
          </select>
        </label>

        <button
          type="button"
          onClick={onCalcular}
          disabled={!puedeCalcular}
          className="w-full rounded bg-agua px-3 py-2 text-sm font-semibold text-white transition hover:bg-tinta-suave disabled:opacity-50"
        >
          {calculando ? 'Leyendo bandas y calculando...' : 'Calcular sobre el area'}
        </button>

        <p className="mt-2 text-[11px] leading-snug text-tinta-suave">
          Se leen las bandas de {coleccion.etiqueta} recortadas al area, no la miniatura.
          {escenas.length > 1 && ` Se unen ${escenas.length} mallas: ${mallas}.`}
        </p>
      </div>

      {error && (
        <p className="border-t border-[--color-borde] px-4 py-3 text-xs leading-snug text-rose-700">
          {error}
        </p>
      )}

      {leyenda.length > 0 && (
        <div className="border-t border-[--color-borde] px-4 py-3">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-tinta-suave">
            Leyenda
          </h3>
          <ul className="space-y-1">
            {leyenda.map((entrada) => (
              <li key={entrada.etiqueta} className="flex items-start gap-2 text-[11px]">
                <span
                  className="mt-0.5 inline-block h-3 w-3 shrink-0 rounded-sm"
                  style={{ background: entrada.color }}
                />
                <span>
                  <span className="font-medium">{entrada.etiqueta}</span>
                  {entrada.detalle && (
                    <span className="block text-tinta-suave">{entrada.detalle}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {notas.length > 0 && (
        <div className="border-t border-[--color-borde] px-4 py-3">
          <ul className="space-y-1 text-[11px] leading-snug text-tinta-suave">
            {notas.map((nota) => (
              <li key={nota}>{nota}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
