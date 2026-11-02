/**
 * Lo que la linea de tiempo mensual tiene que decir de si misma. Condiciones del dictamen
 * del 30/10/2026: la serie se presta a leerse como tendencia, y mezcla temporada, dia de
 * la toma y procesado. El criterio va escrito tambien en `herramientas/historia.ts`.
 */

export const COLECCION_ANTERIOR = 'sentinel-2-l2a'

/** Va a la vista, nunca plegado. */
export const ROTULO_LINEA_TIEMPO =
  'Una imagen por mes, la más despejada. El verdor sube y baja con las lluvias y con el día de la toma; de un año a otro no indica tendencia.'

export const NOTA_PROCESADO_ANTERIOR =
  'Procesado anterior de Sentinel-2. En fechas despejadas difiere 0.002 o menos del reprocesado; con nubes, hasta 0.03 de NDVI.'

export const NOTA_MES_APARTADO =
  'Este mes se aparta de los demás del mismo mes (lluvias adelantadas o tardías, u otro procesado). No indica cambio del terreno.'

export const NOTA_CRITERIO =
  'Criterio para todos los meses. Se excluye una fecha solo con causa física que el filtro de nubes no ve: eclipse (el 08/04/2024 salió limpia y oscura, con dos tercios del rojo de la fecha vecina), +1000 sin restar o bruma (percentil 1 del rojo mayor de 0.06). Se rotula, sin excluir, todo mes a más de 0.02 de rojo o 0.05 de NDVI de la mediana de su mismo mes, sobre la zona urbana.'

/** Corte del rotulo: distancia a la mediana del mismo mes de todos los anios. */
const CORTE_ROJO = 0.02
const CORTE_NDVI = 0.05

export const PIE_CONTRASTE =
  'Misma fecha en las dos colecciones, mediana sobre la zona urbana: procesado anterior menos reprocesado. Escenas con hasta 5 % de nubes, no todas del todo despejadas: de ahí los 0.004 de rojo y 0.003 de NDVI. En 10 fechas del todo despejadas, la revisión independiente midió 0.002 o menos.'

/**
 * Medido con `herramientas/contraste-colecciones.ts` el 30/10/2026. Con nubes la mascara
 * cambia: el juez midio hasta 0.016 de rojo y 0.028 de NDVI en una misma fecha (18/07/2021).
 */
export const CONTRASTE_COLECCIONES: { fecha: string; rojo: string; ndvi: string }[] = [
  { fecha: '04/06/2018', rojo: '+0.0001', ndvi: '0.0000' },
  { fecha: '30/04/2019', rojo: '-0.0034', ndvi: '-0.0022' },
  { fecha: '29/04/2020', rojo: '0.0000', ndvi: '0.0000' },
  { fecha: '29/04/2021', rojo: '-0.0037', ndvi: '-0.0030' },
  { fecha: '20/12/2022', rojo: '+0.0001', ndvi: '-0.0001' },
  { fecha: '09/05/2023', rojo: '0.0000', ndvi: '0.0000' },
  { fecha: '10/04/2025', rojo: '0.0000', ndvi: '0.0000' },
]

export function mediana(valores: number[]): number {
  const orden = [...valores].sort((a, b) => a - b)
  const mitad = orden.length >> 1
  return orden.length % 2 ? orden[mitad] : (orden[mitad - 1] + orden[mitad]) / 2
}

/** Los meses a rotular, de los datos y no de una lista: cada mes nuevo pasa por el mismo corte. */
export function mesesApartados(meses: Record<string, { urbana: { rojo: number; ndvi: number } } | null>): Set<string> {
  const conImagen = Object.entries(meses).flatMap(([mes, dato]) => (dato ? [{ mes, urbana: dato.urbana }] : []))
  const delMismoMes = (mes: string) => conImagen.filter((otro) => otro.mes.slice(5) === mes.slice(5))
  return new Set(
    conImagen
      .filter(({ mes, urbana }) => {
        const pares = delMismoMes(mes)
        return (
          Math.abs(urbana.rojo - mediana(pares.map((p) => p.urbana.rojo))) > CORTE_ROJO ||
          Math.abs(urbana.ndvi - mediana(pares.map((p) => p.urbana.ndvi))) > CORTE_NDVI
        )
      })
      .map(({ mes }) => mes),
  )
}
