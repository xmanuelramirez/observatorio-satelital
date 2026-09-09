import { useState } from 'react'
import {
  agruparEnPilas,
  buscarGranulos,
  comandoHyp3,
  formarPares,
  parDeExtremos,
  type ParInsar,
  type PilaInsar,
} from '../servicios/insar'
import type { Bbox } from '../tipos'

interface Props {
  bbox: Bbox | null
  desde: string
  hasta: string
  onCargarDesplazamiento: (href: string, limite: number) => void
}

const COLOR_COHERENCIA: Record<ParInsar['coherenciaProbable'], string> = {
  buena: 'text-emerald-700',
  aceptable: 'text-amber-700',
  dudosa: 'text-rose-700',
}

export default function PanelInsar({ bbox, desde, hasta, onCargarDesplazamiento }: Props) {
  const [pilas, setPilas] = useState<PilaInsar[] | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pilaAbierta, setPilaAbierta] = useState<string | null>(null)
  const [rutaTif, setRutaTif] = useState('')
  const [limite, setLimite] = useState(0.05)

  const buscar = async () => {
    if (!bbox) return

    setBuscando(true)
    setError(null)
    setPilas(null)

    try {
      const granulos = await buscarGranulos(bbox, desde, hasta)
      const encontradas = agruparEnPilas(granulos)

      if (encontradas.length === 0) {
        setError('No hay pilas con dos o mas fechas en ese periodo. Amplia el rango.')
      }

      setPilas(encontradas)
      setPilaAbierta(encontradas[0]?.clave ?? null)
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : String(fallo))
    } finally {
      setBuscando(false)
    }
  }

  return (
    <section className="border-t border-[--color-borde] px-3 py-3">
      <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-tinta-suave">
        SUBSIDENCIA (InSAR)
      </h2>

      <p className="mb-2 text-[11px] leading-snug text-tinta-suave">
        Busca pares interferometricos de Sentinel-1 sobre el area. El procesamiento
        corre en HyP3, que pide cuenta de NASA Earthdata y no acepta llamadas desde
        el navegador, asi que se lanza con el script del repositorio.
      </p>

      <button
        onClick={buscar}
        disabled={!bbox || buscando}
        className="w-full rounded bg-tinta px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        {buscando ? 'Buscando pares...' : 'Buscar pares InSAR'}
      </button>

      {error && <p className="mt-2 text-[11px] leading-snug text-rose-700">{error}</p>}

      {pilas && pilas.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] text-tinta-suave">
            {pilas.length} pila{pilas.length === 1 ? '' : 's'} con geometria consistente.
            Solo se pueden emparejar tomas de la misma ruta y cuadro.
          </p>

          {pilas.map((pila) => {
            const abierta = pilaAbierta === pila.clave
            const pares = formarPares(pila)
            const extremos = parDeExtremos(pila)

            return (
              <div key={pila.clave} className="rounded border border-[--color-borde] bg-white/60">
                <button
                  onClick={() => setPilaAbierta(abierta ? null : pila.clave)}
                  className="flex w-full items-center justify-between px-2 py-1.5 text-left text-xs"
                >
                  <span>
                    Ruta {pila.ruta}, cuadro {pila.cuadro}
                    <span className="ml-1 text-tinta-suave">
                      {pila.direccion === 'ASCENDING' ? 'ascendente' : 'descendente'}
                    </span>
                  </span>
                  <span className="text-tinta-suave">{pila.granulos.length} fechas</span>
                </button>

                {abierta && (
                  <div className="border-t border-[--color-borde] px-2 py-2">
                    {extremos && (
                      <div className="mb-2 rounded bg-arena px-2 py-1.5">
                        <p className="text-[11px] font-medium">
                          Acumulado del periodo: {extremos.referencia.dia} a{' '}
                          {extremos.secundario.dia} ({extremos.baseTemporal} dias)
                        </p>
                        <code className="mt-1 block break-all text-[10px] leading-tight text-tinta-suave">
                          {comandoHyp3(extremos)}
                        </code>
                      </div>
                    )}

                    <p className="mb-1 text-[11px] text-tinta-suave">
                      Pares consecutivos ({pares.length}):
                    </p>
                    <ul className="space-y-1">
                      {pares.map((par) => (
                        <li key={`${par.referencia.nombre}-${par.secundario.nombre}`}>
                          <details>
                            <summary className="cursor-pointer text-[11px]">
                              {par.referencia.dia} a {par.secundario.dia}{' '}
                              <span className={COLOR_COHERENCIA[par.coherenciaProbable]}>
                                {par.baseTemporal} dias, coherencia {par.coherenciaProbable}
                              </span>
                            </summary>
                            <code className="mt-1 block break-all rounded bg-arena px-1.5 py-1 text-[10px] leading-tight text-tinta-suave">
                              {comandoHyp3(par)}
                            </code>
                          </details>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-3 border-t border-[--color-borde] pt-3">
        <p className="mb-1.5 text-[11px] font-medium">Cargar resultado de HyP3</p>
        <input
          value={rutaTif}
          onChange={(evento) => setRutaTif(evento.target.value)}
          placeholder="/insar/S1_..._desplazamiento.tif"
          className="w-full rounded border border-[--color-borde] bg-white px-2 py-1.5 text-xs"
        />

        <label className="mt-2 block">
          <span className="text-[11px] text-tinta-suave">
            Escala de color: mas menos {(limite * 100).toFixed(0)} cm
          </span>
          <input
            type="range"
            min={0.01}
            max={0.2}
            step={0.01}
            value={limite}
            onChange={(evento) => setLimite(Number(evento.target.value))}
            className="w-full accent-[#2b7fb8]"
          />
        </label>

        <button
          onClick={() => onCargarDesplazamiento(rutaTif.trim(), limite)}
          disabled={rutaTif.trim().length === 0}
          className="mt-1 w-full rounded border border-[--color-borde] px-3 py-1.5 text-xs disabled:opacity-40"
        >
          Ver desplazamiento en el mapa
        </button>

        <p className="mt-1.5 text-[11px] leading-snug text-tinta-suave">
          Rojo es hundimiento, azul es levantamiento. Unidades en metros respecto a
          la fecha de referencia.
        </p>
      </div>
    </section>
  )
}
