import { COLECCIONES } from '../datos/colecciones'
import { ETIQUETA_PROVEEDOR } from '../servicios/proveedores'
import type { Coleccion } from '../tipos'
import { PasoPlegado, TituloPaso } from './Paso'

interface Props {
  coleccion: Coleccion
  onColeccion: (id: string) => void
  desde: string
  onDesde: (valor: string) => void
  hasta: string
  onHasta: (valor: string) => void
  nubesMax: number
  onNubesMax: (valor: number) => void
  buscando: boolean
  onBuscar: () => void
  /** Con resultados, la busqueda se pliega a una linea para dar lugar al analisis. */
  plegado: boolean
  onDesplegar: () => void
}

/**
 * Solo lo que define la busqueda: coleccion, periodo y nubosidad. El area vive
 * arriba porque la comparten todas las pestanas, y las capas del mapa flotan
 * sobre el mapa.
 */
export default function PanelBusqueda({
  coleccion,
  onColeccion,
  desde,
  onDesde,
  hasta,
  onHasta,
  nubesMax,
  onNubesMax,
  buscando,
  onBuscar,
  plegado,
  onDesplegar,
}: Props) {
  if (plegado) {
    return (
      <PasoPlegado numero={1} titulo="Búsqueda" onCambiar={onDesplegar}>
        <span className="text-tinta">{coleccion.etiqueta}</span>
        <span className="cifra">
          {' · '}
          {desde} a {hasta}
          {coleccion.filtraNubes ? ` · ≤ ${nubesMax} % nubes` : ''}
        </span>
      </PasoPlegado>
    )
  }

  return (
    <section className="border-b border-filete px-4 py-3.5">
      <div className="mb-3">
        <TituloPaso numero={1} titulo="Búsqueda" />
      </div>
      <label className="block">
        <span className="rotulo mb-1.5 block">Colección</span>
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
      </label>
      <p className="mt-1.5 text-xs leading-snug text-tinta-suave">
        {coleccion.descripcion} · {ETIQUETA_PROVEEDOR[coleccion.proveedor]}
      </p>

      <div className="mt-3 flex gap-2">
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

      {coleccion.filtraNubes ? (
        <label className="mt-3 block">
          <span className="mb-1 flex items-baseline justify-between text-xs text-tinta-suave">
            <span>Nubosidad máxima de la escena</span>
            <span className="cifra text-tinta">{nubesMax} %</span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={nubesMax}
            onChange={(e) => onNubesMax(Number(e.target.value))}
            className="w-full"
          />
        </label>
      ) : (
        <p className="mt-3 text-xs leading-snug text-tinta-suave">
          {coleccion.etiqueta} es radar y atraviesa la nube: no hay filtro de nubosidad.
        </p>
      )}

      <button
        type="button"
        onClick={onBuscar}
        disabled={buscando}
        className="boton-principal mt-3"
      >
        {buscando ? 'Buscando...' : 'Buscar escenas'}
      </button>
      <p className="mt-1.5 text-xs text-rotulo">Días en hora de León.</p>
    </section>
  )
}
