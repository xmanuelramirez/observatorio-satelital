import type { Escena, GrupoDia } from '../tipos'
import { PasoPlegado, TituloPaso } from './Paso'

interface Props {
  grupos: GrupoDia[]
  totalCoincidencias: number | null
  /** Escenas activas. Siempre del mismo dia: un mosaico de dos fechas no es una fecha. */
  seleccion: Escena[]
  /** Elegir una malla o el dia completo pliega la lista a su resumen. */
  onElegir: (escenas: Escena[]) => void
  plegado: boolean
  onDesplegar: () => void
  onPantallaCompleta: () => void
  buscando: boolean
  error: string | null
  yaBusco: boolean
}

/** El dia ya viene en hora de Leon; aqui solo se formatea, sin volver a convertir. */
function fechaLarga(dia: string): string {
  const [ano, mes, d] = dia.split('-').map(Number)
  return new Date(Date.UTC(ano, mes - 1, d)).toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** El color acompana a la cifra, nunca la sustituye. */
function colorNubes(nubes: number | null): string {
  if (nubes === null) return 'text-tinta-suave border-filete-fuerte'
  if (nubes < 10) return 'text-ok border-ok/40'
  if (nubes < 35) return 'text-aviso border-aviso/40'
  return 'text-peligro border-peligro/40'
}

function Aviso({ children, tono = 'normal' }: { children: React.ReactNode; tono?: 'normal' | 'error' }) {
  return (
    <div
      className={`px-4 py-5 text-[13px] leading-snug ${tono === 'error' ? 'text-peligro' : 'text-tinta-suave'}`}
    >
      {children}
    </div>
  )
}

export default function ListaEscenas({
  grupos,
  totalCoincidencias,
  seleccion,
  onElegir,
  plegado,
  onDesplegar,
  onPantallaCompleta,
  buscando,
  error,
  yaBusco,
}: Props) {
  if (buscando) return <Aviso>Consultando el catálogo...</Aviso>

  if (error) {
    return (
      <Aviso tono="error">
        <p className="font-semibold">No se pudo consultar el catálogo</p>
        <p className="mt-1 text-xs">{error}</p>
      </Aviso>
    )
  }

  if (!yaBusco) return <Aviso>Elige área, colección y periodo, y presiona Buscar escenas.</Aviso>

  if (grupos.length === 0) {
    return <Aviso>Sin escenas para esos criterios. Amplía el periodo o sube el límite de nubosidad.</Aviso>
  }

  if (plegado && seleccion.length > 0) {
    const nubes = grupos.find((grupo) => grupo.dia === seleccion[0].dia)?.nubes
    return (
      <PasoPlegado numero={2} titulo="Escena" onCambiar={onDesplegar}>
        <span className="text-tinta">{fechaLarga(seleccion[0].dia)}</span>
        <span className="cifra">
          {' · '}
          {seleccion.map((e) => e.malla || e.plataforma).join(' + ')}
          {nubes !== null && nubes !== undefined ? ` · ${nubes.toFixed(1)} % nubes` : ''}
        </span>
      </PasoPlegado>
    )
  }

  const totalEscenas = grupos.reduce((suma, g) => suma + g.escenas.length, 0)

  const diaCompleto = (grupo: GrupoDia) =>
    grupo.escenas.length > 1 &&
    grupo.escenas.every((escena) => seleccion.some((otra) => otra.id === escena.id))

  return (
    <div>
      <div className="border-b border-filete px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <TituloPaso numero={2} titulo="Escena" />
          <button type="button" onClick={onPantallaCompleta} className="boton py-1">
            Ver en pantalla completa
          </button>
        </div>
        <p className="mt-1.5 text-xs leading-snug text-tinta-suave">
          <span className="cifra text-tinta">{grupos.length}</span> fechas,{' '}
          <span className="cifra text-tinta">{totalEscenas}</span> escenas
          {totalCoincidencias !== null && totalCoincidencias > totalEscenas
            ? ` de ${totalCoincidencias} en el periodo`
            : ''}
          . León cae en el borde de dos mallas: usa el mosaico para cubrir el municipio completo.
        </p>
      </div>

      <ul>
        {grupos.map((grupo) => (
          <li key={grupo.dia} className="border-b border-filete">
            <div className="flex items-baseline justify-between gap-2 px-4 pt-3">
              <span className="text-[13px] font-semibold">{fechaLarga(grupo.dia)}</span>
              {grupo.nubes !== null && (
                <span className={`cifra border px-1.5 py-0.5 text-xs ${colorNubes(grupo.nubes)}`}>
                  {grupo.nubes.toFixed(1)} % nubes
                </span>
              )}
            </div>

            {/*
              Una rejilla pareja: el mosaico del dia primero, porque es lo que
              cubre el municipio, y despues cada malla sola.
            */}
            <div className="grid grid-cols-2 gap-1.5 px-4 pb-3 pt-2">
              {grupo.escenas.length > 1 && (
                <button
                  type="button"
                  onClick={() => onElegir(grupo.escenas)}
                  aria-pressed={diaCompleto(grupo)}
                  className={`boton col-span-2 text-left ${diaCompleto(grupo) ? 'boton-activo' : ''}`}
                >
                  <span className="block text-[13px] font-medium">
                    Mosaico de {grupo.escenas.length} mallas
                  </span>
                  <span className="cifra block text-xs text-tinta-suave">
                    {grupo.escenas.map((e) => e.malla || e.plataforma).join(' + ')}
                  </span>
                </button>
              )}

              {grupo.escenas.map((escena) => {
                const activa = seleccion.length === 1 && seleccion[0].id === escena.id

                return (
                  <button
                    key={escena.id}
                    type="button"
                    onClick={() => onElegir([escena])}
                    title={escena.id}
                    aria-pressed={activa}
                    className={`boton flex items-center gap-2 text-left ${activa ? 'boton-activo' : ''}`}
                  >
                    {escena.thumbnail && (
                      <img
                        src={escena.thumbnail}
                        alt=""
                        decoding="async"
                        onError={(evento) => {
                          evento.currentTarget.style.visibility = 'hidden'
                        }}
                        className="h-9 w-9 shrink-0 bg-panel-hondo object-cover"
                      />
                    )}
                    <span className="min-w-0 leading-tight">
                      <span className="cifra block text-[13px] font-medium text-tinta">
                        {escena.malla || escena.plataforma}
                      </span>
                      <span className="cifra block text-xs text-tinta-suave">
                        {escena.nubes !== null ? `${escena.nubes.toFixed(1)} % nubes` : escena.plataforma}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
