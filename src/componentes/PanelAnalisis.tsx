import type { DefinicionIndice } from '../servicios/indices'
import type { Coleccion, Escena, GrupoDia, ModoVista, NombreBanda } from '../tipos'
import { diasEntre } from '../servicios/obranueva'

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
  /** Dias distintos al elegido, que pueden servir de base en modo cambio. */
  diasReferencia: GrupoDia[]
  referencia: Escena[]
  onDiaReferencia: (dia: string) => void
  umbralCambio: number
  onUmbralCambio: (valor: number) => void
  umbralObra: number
  onUmbralObra: (valor: number) => void
  umbralAguaDb: number
  onUmbralAguaDb: (valor: number) => void
  areaMinimaObra: number
  onAreaMinimaObra: (valor: number) => void
  quitarNubes: boolean
  onQuitarNubes: (valor: boolean) => void
  soloAgua: boolean
  onSoloAgua: (valor: boolean) => void
}

const MODOS: { id: ModoVista; etiqueta: string }[] = [
  { id: 'indice', etiqueta: 'Índice' },
  { id: 'cambio', etiqueta: 'Cambio' },
  { id: 'obra', etiqueta: 'Obra' },
  { id: 'calor', etiqueta: 'Calor' },
  { id: 'agua', etiqueta: 'Agua' },
  { id: 'clases', etiqueta: 'Clases' },
  { id: 'color', etiqueta: 'Color' },
]

/** Obra nueva cruza NDBI, NDVI y MNDWI: sin estas cuatro no hay modo. */
const bandasDeObra: NombreBanda[] = ['swir1', 'nir', 'rojo', 'verde']

function Etiqueta({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block text-xs text-tinta-suave">{children}</span>
}

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
  diasReferencia,
  referencia,
  onDiaReferencia,
  umbralCambio,
  onUmbralCambio,
  umbralObra,
  onUmbralObra,
  umbralAguaDb,
  onUmbralAguaDb,
  areaMinimaObra,
  onAreaMinimaObra,
  quitarNubes,
  onQuitarNubes,
  soloAgua,
  onSoloAgua,
}: Props) {
  if (escenas.length === 0) {
    return (
      <p className="px-4 py-4 text-[13px] leading-snug text-tinta-suave">
        Elige una escena de la lista para analizarla.
      </p>
    )
  }

  const mallas = escenas.map((e) => e.malla || e.plataforma).join(' y ')
  const sinIndices = indices.length === 0
  const usaIndice = modo === 'indice' || modo === 'cambio'
  const comparaFechas = modo === 'cambio' || modo === 'obra' || modo === 'agua'
  const separacion =
    comparaFechas && referencia.length > 0 ? diasEntre(referencia[0].dia, escenas[0].dia) : null
  const puedeCalcular =
    !calculando &&
    (modo !== 'clases' || bandasKmeans.length >= 2) &&
    (!usaIndice || indice !== null) &&
    (!comparaFechas || modo === 'agua' || referencia.length > 0)

  return (
    <div className="border-t-2 border-acento">
      <div className="px-4 py-3.5">
        <h2 className="rotulo mb-2.5">Análisis de la escena</h2>

        <div className="mb-3.5 grid grid-cols-4 gap-px border border-filete bg-filete" role="tablist">
          {MODOS.map((opcion) => (
            <button
              key={opcion.id}
              type="button"
              role="tab"
              aria-selected={modo === opcion.id}
              onClick={() => onModo(opcion.id)}
              disabled={
                ((opcion.id === 'indice' || opcion.id === 'cambio') && sinIndices) ||
                (opcion.id === 'calor' && !coleccion.bandas.termica) ||
                (opcion.id === 'agua' && !coleccion.bandas.vv) ||
                (opcion.id === 'obra' && !bandasDeObra.every((banda) => coleccion.bandas[banda]))
              }
              title={
                opcion.id === 'calor' && !coleccion.bandas.termica
                  ? 'La temperatura de superficie viene de la banda térmica de Landsat'
                  : undefined
              }
              className={`pestana ${modo === opcion.id ? 'pestana-activa' : ''}`}
            >
              {opcion.etiqueta}
            </button>
          ))}
        </div>

        {usaIndice && (
          <label className="mb-3.5 block">
            <Etiqueta>Índice</Etiqueta>
            <select
              className="campo"
              value={indice?.id ?? ''}
              onChange={(evento) => onIndice(evento.target.value)}
            >
              {indices.map((opcion) => (
                <option key={opcion.id} value={opcion.id}>
                  {opcion.etiqueta} · {opcion.descripcion}
                </option>
              ))}
            </select>
            {indice && (
              <p className="cifra mt-1.5 text-xs text-rotulo">
                ({indice.a} − {indice.b}) / ({indice.a} + {indice.b})
              </p>
            )}
          </label>
        )}

        {comparaFechas && (
          <div className="mb-3.5 space-y-3 border border-filete bg-panel-hondo p-3">
            <p className="text-xs leading-snug text-tinta-suave">
              Fecha actual: <span className="cifra text-tinta">{escenas[0].dia}</span> ({mallas})
            </p>

            {separacion !== null && (
              <p className="border-l-2 border-acento bg-acento-suave px-2.5 py-2 text-xs leading-snug">
                <span className="rotulo block">Separación temporal</span>
                <span className="cifra mt-1 block text-[15px] font-semibold text-tinta">
                  {separacion} días
                </span>
                <span className="cifra block text-tinta-suave">
                  {referencia[0].dia} a {escenas[0].dia}
                </span>
                <span className="mt-1 block text-rotulo">
                  {coleccion.etiqueta} revisita cada {coleccion.revisitaDias} días: ese es el paso
                  mínimo entre dos imágenes.
                </span>
              </p>
            )}

            <label className="block">
              <Etiqueta>Comparar contra</Etiqueta>
              <select
                className="campo"
                value={referencia[0]?.dia ?? ''}
                onChange={(evento) => onDiaReferencia(evento.target.value)}
              >
                <option value="">Elige la fecha base</option>
                {diasReferencia.map((grupo) => (
                  <option key={grupo.dia} value={grupo.dia}>
                    {grupo.dia} · {grupo.escenas.length} malla
                    {grupo.escenas.length === 1 ? '' : 's'}
                    {grupo.nubes !== null ? ` · ${grupo.nubes.toFixed(0)} % nubes` : ''}
                  </option>
                ))}
              </select>
              {diasReferencia.length === 0 && (
                <p className="mt-1.5 text-xs text-peligro">
                  No hay otra fecha en los resultados. Amplía el periodo y vuelve a buscar.
                </p>
              )}
              <span className="mt-1.5 block text-xs leading-snug text-rotulo">
                La fecha base entra con todas sus mallas unidas, para que las dos fechas se
                comparen sobre el mismo terreno.
              </span>
            </label>

            {modo === 'cambio' && (
            <label className="block">
              <Etiqueta>
                Umbral de cambio: <span className="cifra text-tinta">{umbralCambio.toFixed(2)}</span>
              </Etiqueta>
              <input
                type="range"
                min={0.02}
                max={0.4}
                step={0.02}
                value={umbralCambio}
                onChange={(evento) => onUmbralCambio(Number(evento.target.value))}
                className="w-full"
              />
              <span className="block text-xs leading-snug text-rotulo">
                Debajo de este valor la diferencia se considera ruido y no se pinta.
              </span>
            </label>
            )}

            {modo === 'agua' && (
              <label className="block">
                <Etiqueta>
                  Umbral de agua:{' '}
                  <span className="cifra text-tinta">{umbralAguaDb.toFixed(1)}</span> dB
                </Etiqueta>
                <input
                  type="range"
                  min={-24}
                  max={-10}
                  step={0.5}
                  value={umbralAguaDb}
                  onChange={(evento) => onUmbralAguaDb(Number(evento.target.value))}
                  className="w-full"
                />
                <span className="block text-xs leading-snug text-rotulo">
                  Más bajo detecta menos agua. La fecha base es opcional: sin ella se dibuja la
                  lámina, con ella se separa agua permanente de crecida.
                </span>
              </label>
            )}

            {modo === 'obra' && (
              <div className="space-y-3">
                <label className="block">
                  <Etiqueta>
                    Cuánto debe subir el NDBI:{' '}
                    <span className="cifra text-tinta">{umbralObra.toFixed(2)}</span>
                  </Etiqueta>
                  <input
                    type="range"
                    min={0.03}
                    max={0.25}
                    step={0.01}
                    value={umbralObra}
                    onChange={(evento) => onUmbralObra(Number(evento.target.value))}
                    className="w-full"
                  />
                  <span className="block text-xs leading-snug text-rotulo">
                    Más bajo detecta más obra y más ruido. El NDBI sube cuando aparece superficie
                    impermeable.
                  </span>
                </label>

                <label className="block">
                  <Etiqueta>
                    Área mínima de la zona:{' '}
                    <span className="cifra text-tinta">{areaMinimaObra.toFixed(1)}</span> ha
                  </Etiqueta>
                  <input
                    type="range"
                    min={0.5}
                    max={20}
                    step={0.5}
                    value={areaMinimaObra}
                    onChange={(evento) => onAreaMinimaObra(Number(evento.target.value))}
                    className="w-full"
                  />
                  <span className="block text-xs leading-snug text-rotulo">
                    Las manchas sueltas más chicas que esto se descartan: a 10 m una casa sola no
                    se distingue, un fraccionamiento sí.
                  </span>
                </label>
              </div>
            )}
          </div>
        )}

        {modo === 'clases' && (
          <div className="mb-3.5 space-y-3">
            <div>
              <Etiqueta>Bandas de entrada ({bandasKmeans.length} elegidas)</Etiqueta>
              <div className="flex flex-wrap gap-1.5">
                {bandasDisponibles.map((banda) => {
                  const activa = bandasKmeans.includes(banda)
                  return (
                    <button
                      key={banda}
                      type="button"
                      aria-pressed={activa}
                      onClick={() => onBandaKmeans(banda)}
                      className={`boton cifra ${activa ? 'boton-activo' : ''}`}
                    >
                      {banda}
                    </button>
                  )
                })}
              </div>
              {bandasKmeans.length < 2 && (
                <p className="mt-1.5 text-xs text-peligro">Elige al menos dos bandas.</p>
              )}
            </div>

            <label className="block">
              <Etiqueta>
                Número de clases: <span className="cifra text-tinta">{k}</span>
              </Etiqueta>
              <input
                type="range"
                min={2}
                max={8}
                step={1}
                value={k}
                onChange={(evento) => onK(Number(evento.target.value))}
                className="w-full"
              />
            </label>
          </div>
        )}

        {usaIndice && (
          <label className="mb-3 flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={soloAgua || indice?.soloAgua === true}
              disabled={indice?.soloAgua === true}
              onChange={(evento) => onSoloAgua(evento.target.checked)}
              className="mt-0.5"
            />
            <span className="text-xs leading-snug">
              <span className="text-tinta">Calcular solo sobre la lámina de agua</span>
              <span className="mt-0.5 block text-rotulo">
                {indice?.soloAgua === true
                  ? `${indice.etiqueta} solo significa algo sobre agua: sobre tierra sería vegetación, no clorofila. Por eso queda fijo.`
                  : 'Dibuja el agua con MNDWI y descarta todo lo demás. Útil para medir el vaso de una presa sin que la orilla ensucie la media.'}
              </span>
            </span>
          </label>
        )}

        <label className="mb-3 flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={quitarNubes && coleccion.mascaraNubes !== null}
            disabled={coleccion.mascaraNubes === null}
            onChange={(evento) => onQuitarNubes(evento.target.checked)}
            className="mt-0.5"
          />
          <span className="text-xs leading-snug">
            <span className="text-tinta">Descartar nubes píxel por píxel</span>
            <span className="mt-0.5 block text-rotulo">
              {coleccion.mascaraNubes === null
                ? `${coleccion.etiqueta} es radar: atraviesa la nube y no hay nada que descartar.`
                : `Usa la banda ${coleccion.mascaraNubes.asset.toUpperCase()} de la escena. El filtro de la búsqueda es por escena completa: una escena con poca nube puede tenerla justo encima de León.`}
            </span>
          </span>
        </label>

        <label className="mb-3.5 block">
          <Etiqueta>Rejilla de análisis</Etiqueta>
          <select
            className="campo cifra"
            value={tamano}
            onChange={(evento) => onTamano(Number(evento.target.value))}
          >
            <option value={256}>256 × 256 · rápido</option>
            <option value={512}>512 × 512</option>
            <option value={1024}>1024 × 1024 · lento, más detalle</option>
          </select>
        </label>

        <p className="mb-2 text-xs leading-snug text-rotulo">
          Se leen las bandas de {coleccion.etiqueta} recortadas al área, no la miniatura.
          {escenas.length > 1 && ` Se unen ${escenas.length} mallas: ${mallas}.`}
        </p>

        {/*
          Pegado al pie del panel: con los controles de un modo abiertos, el
          boton quedaba debajo del borde y habia que bajar a buscarlo.
        */}
        <div className="sticky bottom-0 -mx-4 border-t border-filete bg-panel px-4 py-3">
          <button
            type="button"
            onClick={onCalcular}
            disabled={!puedeCalcular}
            className="boton-principal"
          >
            {calculando ? 'Leyendo bandas y calculando...' : 'Calcular sobre el área'}
          </button>
        </div>
      </div>

      {error && (
        <p className="border-t border-filete px-4 py-3 text-xs leading-snug text-peligro" role="alert">
          {error}
        </p>
      )}

    </div>
  )
}
