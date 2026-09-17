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

const ETIQUETA_FONDO: Record<IdFondo, string> = {
  ninguno: 'Ninguno',
  claro: 'Claro',
  oscuro: 'Oscuro',
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-filete px-4 py-3.5">
      <h2 className="rotulo mb-2.5">{titulo}</h2>
      {children}
    </section>
  )
}

function Muestra({ color }: { color: string }) {
  return <span className="inline-block h-0.75 w-4 shrink-0" style={{ background: color }} />
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
      <Bloque titulo="Área de interés">
        <div className="space-y-1.5">
          {CAPAS_AREA.map((capa) => (
            <label key={capa.id} className="flex cursor-pointer items-center gap-2.5">
              <input
                type="radio"
                name="area"
                checked={area === capa.id}
                onChange={() => onArea(capa.id)}
              />
              <Muestra color={capa.color} />
              {capa.etiqueta}
            </label>
          ))}
        </div>
      </Bloque>

      <Bloque titulo="Colección">
        <select
          className="campo"
          value={coleccion.id}
          onChange={(evento) => onColeccion(evento.target.value)}
        >
          {COLECCIONES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.etiqueta}
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs leading-snug text-tinta-suave">{coleccion.descripcion}</p>
        <p className="mt-1 text-xs text-rotulo">
          Catálogo: {ETIQUETA_PROVEEDOR[coleccion.proveedor]}
        </p>
      </Bloque>

      <Bloque titulo="Periodo">
        <div className="flex gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-xs text-tinta-suave">Desde</span>
            <input
              type="date"
              className="campo cifra"
              value={desde}
              onChange={(e) => onDesde(e.target.value)}
            />
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-xs text-tinta-suave">Hasta</span>
            <input
              type="date"
              className="campo cifra"
              value={hasta}
              onChange={(e) => onHasta(e.target.value)}
            />
          </label>
        </div>
        <p className="mt-1.5 text-xs text-rotulo">Días en hora de León.</p>
      </Bloque>

      <Bloque titulo="Nubosidad máxima">
        {coleccion.filtraNubes ? (
          <>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={nubesMax}
              onChange={(e) => onNubesMax(Number(e.target.value))}
              className="w-full"
            />
            <div className="cifra mt-1 text-xs text-tinta-suave">{nubesMax} %</div>
          </>
        ) : (
          <p className="text-xs leading-snug text-tinta-suave">
            {coleccion.etiqueta} es radar y atraviesa la nube. El filtro no aplica.
          </p>
        )}
      </Bloque>

      <div className="border-b border-filete px-4 py-3.5">
        <button type="button" onClick={onBuscar} disabled={buscando} className="boton-principal">
          {buscando ? 'Buscando...' : 'Buscar escenas'}
        </button>
      </div>

      <Bloque titulo="Capas en el mapa">
        <div className="space-y-1.5">
          {CAPAS.map((capa) => (
            <label key={capa.id} className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={visibles.has(capa.id)}
                onChange={() => onVisible(capa.id)}
              />
              <Muestra color={capa.color} />
              {capa.etiqueta}
            </label>
          ))}
        </div>
      </Bloque>

      <Bloque titulo="Mapa de referencia">
        <div className="flex gap-px bg-filete">
          {(Object.keys(ETIQUETA_FONDO) as IdFondo[]).map((opcion) => (
            <button
              key={opcion}
              type="button"
              onClick={() => onFondo(opcion)}
              aria-pressed={fondo === opcion}
              className={`pestana ${fondo === opcion ? 'pestana-activa' : ''}`}
            >
              {ETIQUETA_FONDO[opcion]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs leading-snug text-rotulo">
          Sin mosaico satelital de fondo: competía con la imagen analizada.
        </p>
      </Bloque>
    </div>
  )
}
