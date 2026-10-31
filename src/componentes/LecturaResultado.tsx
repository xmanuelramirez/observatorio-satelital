import { useState } from 'react'
import type { EntradaLeyenda } from '../servicios/analisis'
import { CONTRASTE_COLECCIONES, PIE_CONTRASTE } from '../lib/lineaTiempo'

interface Props {
  titulo: string
  leyenda: EntradaLeyenda[]
  /** Dos extremos de una gama: la leyenda se lee como degradado, no como lista de numeros. */
  extremos: [string, string] | null
  /** Que significa la escala, cuando no basta con la leyenda. */
  sentido: string | null
  /** Nombres que se muestran en lugar de la etiqueta: los grupos de k-means no tienen nombre. */
  grupos: boolean
  aviso: string | null
  notas: string[]
  /** La tabla del contraste entre colecciones, en la linea de tiempo. */
  contraste: boolean
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

/** La leyenda, el aviso y lo que se calculo, sobre el mapa. El aviso va a la vista, nunca plegado. */
export default function LecturaResultado({ titulo, leyenda, extremos, sentido, grupos, aviso, notas, contraste }: Props) {
  const [notasAbiertas, setNotasAbiertas] = useState(false)
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
      <div id="lectura" data-testid="simbologia">
        {sentido && <p className="lectura-sentido">{sentido}</p>}

        {leyenda.length > 0 && extremos && (
          <div className="leyenda">
            <span>{extremos[0]}</span>
            <i className="gama" style={{ background: `linear-gradient(90deg, ${leyenda.map((e) => e.color).join(', ')})` }} />
            <span>{extremos[1]}</span>
            <span className="tenue cifra">
              {leyenda[0].etiqueta} a {leyenda[leyenda.length - 1].etiqueta}
            </span>
          </div>
        )}

        {leyenda.length > 0 && !extremos && (
          <div className="leyenda">
            {leyenda.map((entrada, i) => (
              <span key={entrada.etiqueta}>
                <i
                  style={{
                    background: entrada.entramado
                      ? `repeating-linear-gradient(135deg, ${entrada.color} 0 2px, transparent 2px 4px)`
                      : entrada.color,
                  }}
                />
                {grupos ? `Grupo ${i + 1}` : entrada.etiqueta}
                {entrada.detalle && <span className="tenue cifra"> {entrada.detalle.split(' (')[0].split(' - ')[0]}</span>}
              </span>
            ))}
          </div>
        )}

        {aviso && <p className="lectura-aviso">{aviso}</p>}

        {notasAbiertas && (
          <div className="lectura-notas">
            {notas.map((nota) => (
              <p key={nota}>{nota}</p>
            ))}
            {contraste && (
              <table data-testid="contraste-colecciones">
                <caption>{PIE_CONTRASTE}</caption>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Rojo</th>
                    <th>NDVI</th>
                  </tr>
                </thead>
                <tbody>
                  {CONTRASTE_COLECCIONES.map((fila) => (
                    <tr key={fila.fecha}>
                      <td>{fila.fecha}</td>
                      <td>{fila.rojo}</td>
                      <td>{fila.ndvi}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {(notas.length > 0 || leyenda.length > 0) && (
          <div className="lectura-pie">
            {notas.length > 0 && (
              <button type="button" aria-expanded={notasAbiertas} onClick={() => setNotasAbiertas(!notasAbiertas)} data-testid="notas-calculo">
                {notasAbiertas ? 'Ocultar cómo se calculó' : 'Cómo se calculó'}
              </button>
            )}
            {leyenda.length > 0 && (
              <>
                <button type="button" onClick={comoCsv} data-testid="descargar-csv">
                  CSV
                </button>
                <button type="button" onClick={comoJson} data-testid="descargar-json">
                  JSON
                </button>
              </>
            )}
          </div>
        )}
      </div>
  )
}
