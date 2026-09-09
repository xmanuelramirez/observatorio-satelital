export type IdProveedor = 'earth-search' | 'planetary-computer'

const BASES: Record<IdProveedor, string> = {
  'earth-search': 'https://earth-search.aws.element84.com/v1',
  'planetary-computer': 'https://planetarycomputer.microsoft.com/api/stac/v1',
}

const FIRMADOR_MPC = 'https://planetarycomputer.microsoft.com/api/sas/v1/sign'

export const ETIQUETA_PROVEEDOR: Record<IdProveedor, string> = {
  'earth-search': 'Earth Search (AWS Open Data)',
  'planetary-computer': 'Microsoft Planetary Computer',
}

export function baseStac(proveedor: IdProveedor): string {
  return BASES[proveedor]
}

/** Los SAS de Planetary Computer duran cerca de una hora; se reusan mientras sirvan. */
const cacheFirmas = new Map<string, { href: string; expira: number }>()

/**
 * Earth Search sirve los COG publicos y no necesita nada. Planetary Computer
 * guarda los suyos en blobs privados y entrega un SAS anonimo y gratuito.
 */
export async function firmarHref(proveedor: IdProveedor, href: string): Promise<string> {
  if (proveedor !== 'planetary-computer') return href

  const enCache = cacheFirmas.get(href)
  if (enCache && enCache.expira > Date.now() + 60_000) return enCache.href

  const respuesta = await fetch(`${FIRMADOR_MPC}?href=${encodeURIComponent(href)}`)
  if (!respuesta.ok) {
    throw new Error(`El firmador de Planetary Computer respondio ${respuesta.status}`)
  }

  const datos = (await respuesta.json()) as { href: string; 'msft:expiry'?: string }
  const expiraIso = datos['msft:expiry']
  cacheFirmas.set(href, {
    href: datos.href,
    expira: expiraIso ? Date.parse(expiraIso) : Date.now() + 30 * 60_000,
  })

  return datos.href
}

export function firmarVarios(proveedor: IdProveedor, hrefs: string[]): Promise<string[]> {
  return Promise.all(hrefs.map((href) => firmarHref(proveedor, href)))
}
