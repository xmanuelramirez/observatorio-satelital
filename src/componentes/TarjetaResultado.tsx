import { useState } from 'react'
import type { EntradaLeyenda } from '../servicios/analisis'

interface Props {
  titulo: string
  leyenda: EntradaLeyenda[]
  notas: string[]
}

/**
 * Simbologia del resultado que esta en el mapa, en tarjeta flotante propia en
 * la esquina inferior derecha, como en un mapa impreso, arriba de la
 * atribucion de Leaflet. Las notas del calculo son la letra chica: van
 * plegadas al pie, porque el margen izquierdo es del menu.
 */
/** Nombre de archivo sin acentos ni espacios, con la fecha del dia. */
function nombreArchivo(titulo: string): string {
  const limpio = titulo
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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

export default function TarjetaResultado({ titulo, leyenda, notas }: Props) {
  const [notasAbiertas, setNotasAbiertas] = useState(false)

  if (leyenda.length === 0 && notas.length === 0) return null

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
    <div className="absolute bottom-7 right-3 z-1000 flex max-h-[calc(100vh-15rem)] w-72 flex-col border border-filete-fuerte bg-panel/95 text-xs shadow-lg shadow-black/40">
      <div className="shrink-0 border-b border-filete px-3.5 py-2.5">
        <p className="rotulo">Simbología</p>
        <p className="mt-1 text-[13px] font-semibold text-tinta">{titulo}</p>

        {leyenda.length > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-rotulo">Descargar</span>
            <button type="button" onClick={comoCsv} className="boton py-1">
              CSV
            </button>
            <button type="button" onClick={comoJson} className="boton py-1">
              JSON
            </button>
          </div>
        )}
      </div>

      <div className="min-h-0 overflow-y-auto">
        {leyenda.length > 0 && (
          <ul className="space-y-2 px-3.5 py-3">
            {leyenda.map((entrada) => (
              <li key={entrada.etiqueta} className="flex items-start gap-2.5 text-[13px]">
                <span
                  className="mt-1 inline-block h-3 w-3 shrink-0"
                  style={{ background: entrada.color }}
                />
                <span>
                  <span className="font-medium">{entrada.etiqueta}</span>
                  {entrada.detalle && (
                    <span className="cifra block text-xs text-tinta-suave">{entrada.detalle}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}

        {notas.length > 0 && (
          <div className="border-t border-filete">
            <button
              type="button"
              aria-expanded={notasAbiertas}
              onClick={() => setNotasAbiertas(!notasAbiertas)}
              className="flex w-full cursor-pointer items-center justify-between px-3.5 py-2 text-left hover:bg-fondo"
            >
              <span className="rotulo">Notas del cálculo ({notas.length})</span>
              <span className="cifra text-rotulo">{notasAbiertas ? '−' : '+'}</span>
            </button>

            {notasAbiertas && (
              <ul className="space-y-1.5 px-3.5 pb-3 leading-snug text-tinta-suave">
                {notas.map((nota) => (
                  <li key={nota}>{nota}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
