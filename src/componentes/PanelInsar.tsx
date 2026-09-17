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

/** El color acompana a la palabra, que ya dice la calidad por si sola. */
const COLOR_COHERENCIA: Record<ParInsar['coherenciaProbable'], string> = {
  buena: 'text-ok',
  aceptable: 'text-aviso',
  dudosa: 'text-peligro',
}

/**
 * Solo rutas del mismo sitio. El resultado de HyP3 se deja en public/insar y
 * se sirve junto a la app; aceptar una URL arbitraria haria que el navegador
 * fuera a buscar un GeoTIFF a donde alguien pegara, y la CSP igual lo bloquearia.
 */
function rutaValida(ruta: string): boolean {
  return /^\/insar\/[\w.-]+\.tif$/i.test(ruta)
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
        setError('No hay pilas con dos o más fechas en ese periodo. Amplía el rango.')
      }

      setPilas(encontradas)
      setPilaAbierta(encontradas[0]?.clave ?? null)
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : String(fallo))
    } finally {
      setBuscando(false)
    }
  }

  const ruta = rutaTif.trim()

  return (
    <section className="border-b border-filete px-4 py-3.5">
      <h2 className="rotulo mb-2.5">Subsidencia (InSAR)</h2>

      <p className="mb-3 text-xs leading-snug text-tinta-suave">
        Busca pares interferométricos de Sentinel-1 sobre el área. El procesamiento corre en
        HyP3, que pide cuenta de NASA Earthdata y no acepta llamadas desde el navegador, así
        que se lanza con el script del repositorio.
      </p>

      <button
        type="button"
        onClick={buscar}
        disabled={!bbox || buscando}
        className="boton w-full"
      >
        {buscando ? 'Buscando pares...' : 'Buscar pares InSAR'}
      </button>

      {error && (
        <p className="mt-2 text-xs leading-snug text-peligro" role="alert">
          {error}
        </p>
      )}

      {pilas && pilas.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-tinta-suave">
            <span className="cifra text-tinta">{pilas.length}</span> pila
            {pilas.length === 1 ? '' : 's'} con geometría consistente. Solo se emparejan tomas de
            la misma ruta y cuadro.
          </p>

          {pilas.map((pila) => {
            const abierta = pilaAbierta === pila.clave
            const pares = formarPares(pila)
            const extremos = parDeExtremos(pila)

            return (
              <div key={pila.clave} className="border border-filete bg-panel-hondo">
                <button
                  type="button"
                  aria-expanded={abierta}
                  onClick={() => setPilaAbierta(abierta ? null : pila.clave)}
                  className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-[13px] hover:bg-fondo"
                >
                  <span>
                    <span className="cifra">
                      Ruta {pila.ruta} · cuadro {pila.cuadro}
                    </span>
                    <span className="ml-1.5 text-xs text-tinta-suave">
                      {pila.direccion === 'ASCENDING' ? 'ascendente' : 'descendente'}
                    </span>
                  </span>
                  <span className="cifra text-xs text-tinta-suave">
                    {pila.granulos.length} fechas
                  </span>
                </button>

                {abierta && (
                  <div className="border-t border-filete px-3 py-2.5">
                    {extremos && (
                      <div className="mb-2.5 border-l-2 border-acento bg-acento-suave px-2.5 py-2">
                        <p className="text-xs font-medium">
                          Acumulado del periodo:{' '}
                          <span className="cifra">
                            {extremos.referencia.dia} a {extremos.secundario.dia}
                          </span>{' '}
                          ({extremos.baseTemporal} días)
                        </p>
                        <code className="cifra mt-1.5 block select-all break-all text-xs leading-snug text-tinta-suave">
                          {comandoHyp3(extremos)}
                        </code>
                      </div>
                    )}

                    <p className="rotulo mb-1.5">Pares consecutivos ({pares.length})</p>
                    <ul className="space-y-1.5">
                      {pares.map((par) => (
                        <li key={`${par.referencia.nombre}-${par.secundario.nombre}`}>
                          <details>
                            <summary className="cursor-pointer text-xs">
                              <span className="cifra">
                                {par.referencia.dia} a {par.secundario.dia}
                              </span>{' '}
                              <span className={COLOR_COHERENCIA[par.coherenciaProbable]}>
                                {par.baseTemporal} días, coherencia {par.coherenciaProbable}
                              </span>
                            </summary>
                            <code className="cifra mt-1 block select-all break-all bg-fondo px-2 py-1.5 text-xs leading-snug text-tinta-suave">
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

      <div className="mt-3.5 border-t border-filete pt-3.5">
        <p className="rotulo mb-2">Cargar resultado de HyP3</p>
        <input
          value={rutaTif}
          onChange={(evento) => setRutaTif(evento.target.value)}
          placeholder="/insar/nombre_desplazamiento.tif"
          aria-label="Ruta del GeoTIFF de desplazamiento"
          className="campo cifra"
        />
        {ruta.length > 0 && !rutaValida(ruta) && (
          <p className="mt-1.5 text-xs text-peligro">
            Solo archivos servidos por la app: /insar/nombre.tif
          </p>
        )}

        <label className="mt-2.5 block">
          <span className="mb-1 block text-xs text-tinta-suave">
            Escala de color: ±<span className="cifra text-tinta">{(limite * 100).toFixed(0)}</span> cm
          </span>
          <input
            type="range"
            min={0.01}
            max={0.2}
            step={0.01}
            value={limite}
            onChange={(evento) => setLimite(Number(evento.target.value))}
            className="w-full"
          />
        </label>

        <button
          type="button"
          onClick={() => onCargarDesplazamiento(ruta, limite)}
          disabled={!rutaValida(ruta)}
          className="boton mt-1.5 w-full"
        >
          Ver desplazamiento en el mapa
        </button>

        <p className="mt-2 text-xs leading-snug text-rotulo">
          Rojo es hundimiento, azul es levantamiento. Metros respecto a la fecha de referencia.
        </p>
      </div>
    </section>
  )
}
