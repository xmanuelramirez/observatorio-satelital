import { useState } from 'react'
import type { EntradaLeyenda } from '../servicios/analisis'

interface Props {
  titulo: string
  /** Lo primero que se lee: el resultado dicho en una frase. */
  frase: string
  /** Area, fechas, separacion y fuente: lo que el dato exige llevar junto. */
  detalle: string
  /** Aviso del que depende leer bien la cifra: va junto a ella, nunca plegado. */
  aviso?: string | null
  /** Si la imagen de fondo es de otra fecha que el resultado, se dice aqui. */
  notaFondo?: string | null
  /** Que significa la escala, cuando la leyenda son solo valores. */
  sentidoLeyenda?: string | null
  leyenda: EntradaLeyenda[]
  notas: string[]
}

/** Nombre de archivo sin acentos ni espacios, con la fecha del dia. */
function nombreArchivo(titulo: string): string {
  const limpio = titulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
  return `${limpio || 'resultado'}-${new Date().toLocaleDateString('en-CA')}`
}

/**
 * Descarga lo que esta en pantalla.
 *
 * Hasta el 28 de septiembre de 2026 la plataforma no dejaba sacar nada: las
 * cifras se copiaban a mano de la simbologia. Esto entrega lo mismo que se ve,
 * sin reinterpretarlo. Para medir muchos poligonos de una vez esta la
 * herramienta `npm run medir`, que da la misma tabla desde fuera del navegador.
 */
function descargar(nombre: string, contenido: string, tipo: string) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }))
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombre
  enlace.click()
  // El objeto se libera en el siguiente turno, ya iniciada la descarga.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * La frase del resultado con su simbologia, abajo a la derecha como en un mapa
 * impreso. Las notas del calculo van plegadas en «Cómo se calculó»; el aviso del
 * que depende leer bien el dato sube a la frase, no al pliegue.
 */
export default function TarjetaResultado({ titulo, frase, detalle, aviso, notaFondo, sentidoLeyenda, leyenda, notas }: Props) {
  const [notasAbiertas, setNotasAbiertas] = useState(false)

  if (!frase && leyenda.length === 0 && notas.length === 0) return null

  const base = nombreArchivo(titulo)

  const comoCsv = () => {
    const escapar = (texto: string) => `"${texto.replace(/"/g, '""')}"`
    const filas = [
      ['resultado', 'clase', 'detalle'].join(','),
      ...leyenda.map((e) => [titulo, e.etiqueta, e.detalle ?? ''].map(escapar).join(',')),
    ]
    descargar(`${base}.csv`, `${filas.join('\n')}\n`, 'text/csv;charset=utf-8')
  }

  const comoJson = () => {
    const contenido = {
      resultado: titulo,
      descargado: new Date().toISOString(),
      leyenda: leyenda.map((e) => ({ clase: e.etiqueta, detalle: e.detalle ?? null })),
      notas,
    }
    descargar(`${base}.json`, `${JSON.stringify(contenido, null, 2)}\n`, 'application/json')
  }

  return (
    <div
      id="tarjeta-resultado"
      className="pointer-events-auto flex min-h-0 w-88 max-w-full flex-col bg-panel/95 text-xs"
      data-testid="simbologia"
    >
      <div className="shrink-0 px-4 pb-2.5 pt-3.5">
        <p className="frase cifra" aria-live="polite">{frase}</p>
        {detalle && <p className="mt-1.5 text-[13px] leading-snug text-tinta-suave">{detalle}</p>}
        {notaFondo && <p className="mt-1 text-[13px] leading-snug text-tinta-suave">{notaFondo}</p>}
        {aviso && <p className="mt-1.5 text-[13px] leading-snug text-aviso">{aviso}</p>}
      </div>

      <div className="min-h-0 overflow-y-auto">
        {(leyenda.length > 0 || sentidoLeyenda) && (
          <ul className="space-y-1.5 border-t border-filete px-4 py-2.5">
            {sentidoLeyenda && <li className="text-[13px] text-tinta-suave">{sentidoLeyenda}</li>}
            {leyenda.map((entrada) => (
              <li key={entrada.etiqueta} className="flex items-start gap-2.5 text-[13px]">
                <span className="mt-1 inline-block h-3 w-3 shrink-0" style={{ background: entrada.color }} />
                <span>
                  <span className="font-medium">{entrada.etiqueta}</span>
                  {entrada.detalle && <span className="cifra block text-xs text-tinta-suave">{entrada.detalle}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}

        {notasAbiertas && (
          <ul className="space-y-1.5 border-t border-filete px-4 py-2.5 leading-snug text-tinta-suave">
            {notas.map((nota) => (
              <li key={nota}>{nota}</li>
            ))}
          </ul>
        )}
      </div>

      {(notas.length > 0 || leyenda.length > 0) && (
        <div className="flex shrink-0 items-center gap-3 border-t border-filete px-4 py-2">
          {notas.length > 0 && (
            <button
              type="button"
              aria-expanded={notasAbiertas}
              onClick={() => setNotasAbiertas(!notasAbiertas)}
              data-testid="notas-calculo"
              className="enlace"
            >
              {notasAbiertas ? 'Ocultar cómo se calculó' : 'Cómo se calculó'}
            </button>
          )}
          {leyenda.length > 0 && (
            <span className="ml-auto flex items-center gap-2.5">
              <button type="button" onClick={comoCsv} className="enlace" data-testid="descargar-csv">
                CSV
              </button>
              <button type="button" onClick={comoJson} className="enlace" data-testid="descargar-json">
                JSON
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  )
}
