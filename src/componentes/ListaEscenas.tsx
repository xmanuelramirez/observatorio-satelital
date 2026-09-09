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

function fechaLarga(dia: string): string {
  const [ano, mes, d] = dia.split('-').map(Number)
  return new Date(Date.UTC(ano, mes - 1, d)).toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function colorNubes(nubes: number | null): string {
  if (nubes === null) return 'bg-slate-200 text-slate-700'
  if (nubes < 10) return 'bg-emerald-100 text-emerald-800'
  if (nubes < 35) return 'bg-amber-100 text-amber-800'
  return 'bg-rose-100 text-rose-800'
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
  if (buscando) {
    return <p className="px-4 py-6 text-sm text-tinta-suave">Consultando el catalogo...</p>
  }

  if (error) {
    return (
      <div className="px-4 py-6 text-sm text-rose-700">
        <p className="font-semibold">No se pudo consultar el catalogo</p>
        <p className="mt-1 text-xs leading-snug">{error}</p>
      </div>
    )
  }

  if (!yaBusco) {
    return (
      <p className="px-4 py-6 text-sm leading-snug text-tinta-suave">
        Elige area, coleccion y periodo, y presiona Buscar escenas.
      </p>
    )
  }

  if (grupos.length === 0) {
    return (
      <p className="px-4 py-6 text-sm leading-snug text-tinta-suave">
        Sin escenas para esos criterios. Amplia el periodo o sube el limite de nubosidad.
      </p>
    )
  }

  const totalEscenas = grupos.reduce((suma, g) => suma + g.escenas.length, 0)

  const diaCompleto = (grupo: GrupoDia) =>
    grupo.escenas.length > 1 &&
    grupo.escenas.every((escena) => seleccion.some((otra) => otra.id === escena.id))

  return (
    <div>
      <p className="border-b border-[--color-borde] px-4 py-2 text-xs text-tinta-suave">
        {grupos.length} fechas, {totalEscenas} escenas
        {totalCoincidencias !== null && totalCoincidencias > totalEscenas
          ? ` de ${totalCoincidencias} en el periodo`
          : ''}
        . Leon cae en el borde de dos mallas y ninguna lo cubre sola: unelas para
        analizar el municipio completo.
      </p>

      <ul>
        {grupos.map((grupo) => (
          <li key={grupo.dia} className="border-b border-[--color-borde]">
            <div className="flex items-baseline justify-between px-4 pt-3">
              <span className="text-sm font-semibold">{fechaLarga(grupo.dia)}</span>
              {grupo.nubes !== null && (
                <span
                  className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${colorNubes(grupo.nubes)}`}
                >
                  {grupo.nubes.toFixed(1)} por ciento nubes
                </span>
              )}
            </div>

            {grupo.escenas.length > 1 && (
              <div className="px-4 pt-1.5">
                <button
                  type="button"
                  onClick={() => onDiaCompleto(grupo.escenas)}
                  className={`w-full rounded border px-2 py-1 text-[11px] transition ${
                    diaCompleto(grupo)
                      ? 'border-agua bg-sky-50 font-medium text-tinta'
                      : 'border-dashed border-[--color-borde] bg-white text-tinta-suave hover:border-agua'
                  }`}
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
                    className={`flex items-center gap-2 rounded border px-2 py-1.5 text-left transition ${
                      activa
                        ? 'border-agua bg-sky-50'
                        : 'border-[--color-borde] bg-white hover:border-agua'
                    }`}
                  >
                    {escena.thumbnail && (
                      <img
                        src={escena.thumbnail}
                        alt=""
                        decoding="async"
                        onError={(evento) => {
                          evento.currentTarget.style.visibility = 'hidden'
                        }}
                        className="h-10 w-10 rounded-sm bg-slate-200 object-cover"
                      />
                    )}
                    <span className="text-xs leading-tight">
                      <span className="block font-medium">{escena.malla || escena.plataforma}</span>
                      <span className="block text-tinta-suave">
                        {escena.plataforma}
                        {escena.nubes !== null ? ` - ${escena.nubes.toFixed(1)} por ciento` : ''}
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
