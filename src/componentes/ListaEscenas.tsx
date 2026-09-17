import type { Escena, GrupoDia } from '../tipos'

interface Props {
  grupos: GrupoDia[]
  totalCoincidencias: number | null
  /** Escenas activas. Siempre del mismo dia: un mosaico de dos fechas no es una fecha. */
  seleccion: Escena[]
  onAlternar: (escena: Escena) => void
  onDiaCompleto: (escenas: Escena[]) => void
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
  onAlternar,
  onDiaCompleto,
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

  const totalEscenas = grupos.reduce((suma, g) => suma + g.escenas.length, 0)

  const diaCompleto = (grupo: GrupoDia) =>
    grupo.escenas.length > 1 &&
    grupo.escenas.every((escena) => seleccion.some((otra) => otra.id === escena.id))

  return (
    <div>
      <div className="border-b border-filete px-4 py-3">
        <h2 className="rotulo">Escenas</h2>
        <p className="mt-1.5 text-xs leading-snug text-tinta-suave">
          <span className="cifra text-tinta">{grupos.length}</span> fechas,{' '}
          <span className="cifra text-tinta">{totalEscenas}</span> escenas
          {totalCoincidencias !== null && totalCoincidencias > totalEscenas
            ? ` de ${totalCoincidencias} en el periodo`
            : ''}
          . León cae en el borde de dos mallas: únelas para analizar el municipio completo.
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

            {grupo.escenas.length > 1 && (
              <div className="px-4 pt-2">
                <button
                  type="button"
                  onClick={() => onDiaCompleto(grupo.escenas)}
                  aria-pressed={diaCompleto(grupo)}
                  className={`boton w-full ${diaCompleto(grupo) ? 'boton-activo' : 'border-dashed'}`}
                >
                  {diaCompleto(grupo)
                    ? `Mosaico de las ${grupo.escenas.length} mallas`
                    : `Unir las ${grupo.escenas.length} mallas en un mosaico`}
                </button>
              </div>
            )}

            <div className="flex flex-wrap gap-2 px-4 pb-3 pt-2">
              {grupo.escenas.map((escena) => {
                const activa = seleccion.some((otra) => otra.id === escena.id)

                return (
                  <button
                    key={escena.id}
                    type="button"
                    onClick={() => onAlternar(escena)}
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
                        className="h-10 w-10 bg-panel-hondo object-cover"
                      />
                    )}
                    <span className="leading-tight">
                      <span className="cifra block text-[13px] font-medium text-tinta">
                        {escena.malla || escena.plataforma}
                      </span>
                      <span className="block text-xs text-tinta-suave">
                        {escena.plataforma}
                        {escena.nubes !== null ? ` · ${escena.nubes.toFixed(1)} %` : ''}
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
