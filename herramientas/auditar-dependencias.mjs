// Puerta de dependencias de «Verificar» (regla de SEGURIDAD, 18/11/2026). Lee la salida de `npm audit --json` y falla con
// cualquier aviso high o critical que no este en `.audit-excepciones.json`, o si una excepcion ya vencio.
// Uso: npm audit --json > audit.json; node herramientas/auditar-dependencias.mjs audit.json
import { readFileSync } from 'node:fs'

const reporte = JSON.parse(readFileSync(process.argv[2], 'utf-8'))
// Falla cerrado: si npm audit no pudo correr (red, registro), no hay reporte que dar por bueno.
if (reporte.error || !reporte.vulnerabilities) {
  console.error(`npm audit no dio reporte: ${JSON.stringify(reporte.error ?? reporte).slice(0, 300)}`)
  process.exit(1)
}
const excepciones = JSON.parse(readFileSync(new URL('../.audit-excepciones.json', import.meta.url), 'utf-8'))
const hoy = new Date().toISOString().slice(0, 10)
const fallas = []
for (const e of excepciones) {
  if (!/^GHSA-[\w-]+$/.test(e.id) || !/^\d{4}-\d{2}-\d{2}$/.test(e.vence)) fallas.push(`excepcion mal escrita: ${JSON.stringify(e)}`)
  else if (e.vence < hoy) fallas.push(`excepcion vencida el ${e.vence}: ${e.id} (${e.paquete})`)
  // Ninguna excepcion a mas de 60 dias: obliga a revisarla (SEGURIDAD, 18/11/2026).
  else if (new Date(e.vence) - new Date(hoy) > 60 * 864e5) fallas.push(`excepcion a mas de 60 dias (${e.vence}): ${e.id} (${e.paquete})`)
}
// La excepcion vale para ese aviso en ese paquete, no para el mismo aviso en otro.
const vigentes = new Set(excepciones.filter((e) => e.vence >= hoy).map((e) => `${e.id} ${e.paquete}`))
const vistos = new Set()
for (const [paquete, v] of Object.entries(reporte.vulnerabilities ?? {})) {
  for (const via of v.via) {
    if (typeof via === 'string' || !['high', 'critical'].includes(via.severity)) continue
    const id = (via.url ?? '').split('/').pop()
    vistos.add(`${id} ${paquete}`)
    if (!vigentes.has(`${id} ${paquete}`)) fallas.push(`${via.severity}: ${id} en ${paquete} (${via.title})`)
  }
}
for (const id of vigentes) if (!vistos.has(id)) console.log(`Aviso: la excepcion ${id} ya no hace falta; quitala.`)
if (fallas.length) {
  console.error(fallas.join('\n'))
  process.exit(1)
}
console.log(`Dependencias: sin high ni critical fuera de las excepciones (${[...vistos].join(', ') || 'ninguna'} en excepcion).`)
