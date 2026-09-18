/**
 * Todo el calculo pesado, fuera del hilo de la interfaz.
 *
 * Leer las bandas descomprime cada tile del COG, proyectar la rejilla llama a
 * proj4 un cuarto de millon de veces, y recortar, mosaicar y calcular el
 * indice recorren otros tantos pixeles. En el hilo principal eso congelaba la
 * pantalla mas de un segundo seguido. Aqui corre sin que la interfaz se entere.
 *
 * El worker vive toda la sesion: asi el cache de bandas de pilas.ts se
 * conserva entre calculos, igual que antes.
 */

import { ejecutarAnalisis, type ParametrosAnalisis } from '../servicios/analisis'
import { pintarResultado } from '../servicios/pintura'
import { calcularSerie, type ParametrosSerie } from '../servicios/serie'

export type Pedido =
  | { id: number; tipo: 'analisis'; parametros: ParametrosAnalisis }
  | { id: number; tipo: 'serie'; parametros: Omit<ParametrosSerie, 'onProgreso' | 'senal'> }
  | { id: number; tipo: 'cancelar' }

export type Respuesta =
  | { id: number; tipo: 'hecho'; resultado: unknown }
  | { id: number; tipo: 'error'; mensaje: string }
  | { id: number; tipo: 'progreso'; hechas: number; total: number; dia: string }

const cancelados = new Set<number>()

function responder(respuesta: Respuesta, transferir: Transferable[] = []) {
  ;(self as unknown as Worker).postMessage(respuesta, transferir)
}

self.onmessage = async (evento: MessageEvent<Pedido>) => {
  const pedido = evento.data

  if (pedido.tipo === 'cancelar') {
    cancelados.add(pedido.id)
    return
  }

  try {
    if (pedido.tipo === 'analisis') {
      const pintado = pintarResultado(await ejecutarAnalisis(pedido.parametros))
      // Los pixeles se transfieren, no se copian: son un megabyte a 512.
      responder({ id: pedido.id, tipo: 'hecho', resultado: pintado }, [pintado.rgba.buffer])
      return
    }

    const control = new AbortController()
    const vigilante = setInterval(() => {
      if (cancelados.has(pedido.id)) control.abort()
    }, 100)

    try {
      const serie = await calcularSerie({
        ...pedido.parametros,
        senal: control.signal,
        onProgreso: (hechas, total, dia) =>
          responder({ id: pedido.id, tipo: 'progreso', hechas, total, dia }),
      })
      responder({ id: pedido.id, tipo: 'hecho', resultado: serie })
    } finally {
      clearInterval(vigilante)
      cancelados.delete(pedido.id)
    }
  } catch (error) {
    responder({
      id: pedido.id,
      tipo: 'error',
      mensaje: error instanceof Error ? error.message : String(error),
    })
  }
}
