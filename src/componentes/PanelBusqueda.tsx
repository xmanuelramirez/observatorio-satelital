import { CAPAS, CAPAS_AREA } from '../datos/capas'
import { COLECCIONES } from '../datos/colecciones'
import { ETIQUETA_PROVEEDOR } from '../servicios/proveedores'
import type { IdFondo } from './Mapa'
import type { Coleccion, IdCapa } from '../tipos'

interface Props {
  area: IdCapa
  onArea: (id: IdCapa) => void
  coleccion: Coleccion
  onColeccion: (id: string) => void
  desde: string
  onDesde: (valor: string) => void
  hasta: string
  onHasta: (valor: string) => void
  nubesMax: number
  onNubesMax: (valor: number) => void
  visibles: Set<IdCapa>
  onVisible: (id: IdCapa) => void
  fondo: IdFondo
  onFondo: (valor: IdFondo) => void
  buscando: boolean
  onBuscar: () => void
}

const claseCampo =
  'w-full rounded border border-[--color-borde] bg-white px-2 py-1.5 text-sm text-tinta outline-none focus:border-agua'

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-[--color-borde] px-4 py-3">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-tinta-suave">
        {titulo}
      </h2>
      {children}
    </section>
  )
}

export default function PanelBusqueda({
  area,
  onArea,
  coleccion,
  onColeccion,
  desde,
  onDesde,
  hasta,
  onHasta,
  nubesMax,
  onNubesMax,
  visibles,
  onVisible,
  fondo,
  onFondo,
  buscando,
  onBuscar,
}: Props) {
  return (
    <div>
      <Bloque titulo="Area de interes">
        <div className="space-y-1">
          {CAPAS_AREA.map((capa) => (
            <label key={capa.id} className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name="area"
                checked={area === capa.id}
                onChange={() => onArea(capa.id)}
              />
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: capa.color }}
              />
              {capa.etiqueta}
            </label>
          ))}
        </div>
      </Bloque>

      <Bloque titulo="Coleccion">
        <select
          className={claseCampo}
          value={coleccion.id}
          onChange={(evento) => onColeccion(evento.target.value)}
        >
          {COLECCIONES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.etiqueta}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-xs leading-snug text-tinta-suave">{coleccion.descripcion}</p>
        <p className="mt-1 text-[11px] text-tinta-suave/80">
          Catalogo: {ETIQUETA_PROVEEDOR[coleccion.proveedor]}
        </p>
      </Bloque>

      <Bloque titulo="Periodo">
        <div className="flex gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-xs text-tinta-suave">Desde</span>
            <input
              type="date"
              className={claseCampo}
              value={desde}
              onChange={(e) => onDesde(e.target.value)}
            />
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-xs text-tinta-suave">Hasta</span>
            <input
              type="date"
              className={claseCampo}
              value={hasta}
              onChange={(e) => onHasta(e.target.value)}
            />
          </label>
        </div>
      </Bloque>

      <Bloque titulo="Nubosidad maxima">
        {coleccion.filtraNubes ? (
          <>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={nubesMax}
              onChange={(e) => onNubesMax(Number(e.target.value))}
              className="w-full accent-[#2b7fb8]"
            />
            <div className="mt-1 text-xs text-tinta-suave">{nubesMax} por ciento</div>
          </>
        ) : (
          <p className="text-xs leading-snug text-tinta-suave">
            {coleccion.etiqueta} es radar y atraviesa la nube. El filtro no aplica.
          </p>
        )}
      </Bloque>

      <div className="px-4 py-3">
        <button
          type="button"
          onClick={onBuscar}
          disabled={buscando}
          className="w-full rounded bg-tinta px-3 py-2 text-sm font-semibold text-white transition hover:bg-tinta-suave disabled:opacity-50"
        >
          {buscando ? 'Buscando...' : 'Buscar escenas'}
        </button>
      </div>

      <Bloque titulo="Capas en el mapa">
        <div className="space-y-1">
          {CAPAS.map((capa) => (
            <label key={capa.id} className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={visibles.has(capa.id)}
                onChange={() => onVisible(capa.id)}
              />
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: capa.color }}
              />
              {capa.etiqueta}
            </label>
          ))}
        </div>
      </Bloque>

      <Bloque titulo="Mapa de referencia">
        <div className="flex gap-2">
          {(['ninguno', 'claro', 'oscuro'] as const).map((opcion) => (
            <button
              key={opcion}
              type="button"
              onClick={() => onFondo(opcion)}
              className={`flex-1 rounded border px-2 py-1.5 text-xs capitalize transition ${
                fondo === opcion
                  ? 'border-tinta bg-tinta text-white'
                  : 'border-[--color-borde] bg-white text-tinta-suave'
              }`}
            >
              {opcion}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-tinta-suave">
          Sin mosaico satelital de fondo: competia con la imagen analizada.
        </p>
      </Bloque>
    </div>
  )
}
