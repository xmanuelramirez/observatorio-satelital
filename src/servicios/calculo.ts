import type { ParametrosAnalisis } from './analisis'
import type { ResultadoPintado } from './pintura'
import type { ParametrosSerie, ResultadoSerie } from './serie'
import type { Pedido, Respuesta } from '../trabajador/calculo.worker'

/**
 * Cliente del worker de calculo. La interfaz pide y espera una promesa, sin
 * saber que el trabajo ocurre en otro hilo.
 */

let trabajador: Worker | null = null
let siguienteId = 1

const pendientes = new Map<
  number,
  {
    resolver: (valor: unknown) => void
    rechazar: (error: Error) => void
    onProgreso?: (hechas: number, total: number, dia: string) => void
  }
>()

function obtenerTrabajador(): Worker {
  if (trabajador) return trabajador

  // Vite empaqueta el worker como archivo propio del sitio, asi que la CSP
  // lo admite con worker-src 'self'.
  trabajador = new Worker(new URL('../trabajador/calculo.worker.ts', import.meta.url), {
    type: 'module',
  })

  trabajador.onmessage = (evento: MessageEvent<Respuesta>) => {
    const respuesta = evento.data
    const pendiente = pendientes.get(respuesta.id)
    if (!pendiente) return

    if (respuesta.tipo === 'progreso') {
      pendiente.onProgreso?.(respuesta.hechas, respuesta.total, respuesta.dia)
      return
    }

    pendientes.delete(respuesta.id)
    if (respuesta.tipo === 'hecho') pendiente.resolver(respuesta.resultado)
    else pendiente.rechazar(new Error(respuesta.mensaje))
  }

  trabajador.onerror = (evento) => {
    // Un error sin atrapar dentro del worker deja colgadas todas las promesas.
    for (const pendiente of pendientes.values()) {
      pendiente.rechazar(new Error(evento.message || 'El cálculo falló dentro del worker'))
    }
    pendientes.clear()
  }

  return trabajador
}

function pedir<T>(
  pedido: Pedido,
  onProgreso?: (hechas: number, total: number, dia: string) => void,
): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    pendientes.set(pedido.id, {
      resolver: resolver as (valor: unknown) => void,
      rechazar,
      onProgreso,
    })
    obtenerTrabajador().postMessage(pedido)
  })
}

export function pedirAnalisis(parametros: ParametrosAnalisis): Promise<ResultadoPintado> {
  return pedir<ResultadoPintado>({ id: siguienteId++, tipo: 'analisis', parametros })
}

export function pedirSerie(
  parametros: Omit<ParametrosSerie, 'onProgreso' | 'senal'>,
  onProgreso: (hechas: number, total: number, dia: string) => void,
  senal: AbortSignal,
): Promise<ResultadoSerie> {
  const id = siguienteId++
  senal.addEventListener('abort', () => obtenerTrabajador().postMessage({ id, tipo: 'cancelar' }))
  return pedir<ResultadoSerie>({ id, tipo: 'serie', parametros }, onProgreso)
}
