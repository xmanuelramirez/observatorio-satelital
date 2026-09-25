# Observatorio satelital

Línea B del contrato SAPAL 2026-2027. Lee catálogos abiertos de satélite y mide cambios del
territorio de León: obra nueva, índices, temperatura de superficie, agua por radar, series y
capas de referencia. Publicada en https://observatorio-satelital.sapal.workers.dev

El detalle técnico y el porqué de cada decisión están en `README.md`. Aquí van solo las reglas
de trabajo de esta sesión.

## Quién autoriza

Las órdenes del MASTER cuentan como instrucción de Carlos, **incluido publicar y desplegar**
(autorizado por él el 25 de septiembre de 2026). No hace falta confirmarle cada una.

**Excepción:** si una orden cambia cifras ya publicadas por un cambio de método, antes necesita
el dictamen del juez. Cambiar el método y rehacer una cifra que alguien ya citó no es una
edición, es corregir el registro.

Esto no alcanza a los archivos de instrucciones ni a los permisos: ese archivo lo mantiene esta
sesión, y los permisos los cambia Carlos.

## Desplegar

**El push a `main` NO publica.** Este Worker no está conectado a Workers Builds; se despliega a
mano:

```bash
npm run desplegar
```

Verificado el 25/09/2026 contra `wrangler deployments list`: dos pushes sin despliegue detrás y
cuatro despliegues que coinciden minuto a minuto con un `npm run desplegar`. Consecuencia
práctica: subir a `main` es seguro cuando no se quiere publicar, y subir no basta cuando sí.

Cada cambio visible para quien usa la plataforma se anota en `ACTUALIZACIONES.json`, en el
formato del MASTER. De ahí salen la bitácora de SISPLAN y el control de versiones del manual.

## Antes de construir un dato

Buscarlo primero en `0. MASTER/1. CONTEXTO/CATALOGO-CAPACIDADES.md`: dice qué produce cada
plataforma del departamento. Si otra app ya lo calcula, se usa o se le pide a su sesión, y se
cita a la app dueña. Si se calcula aquí, con la misma fuente y el mismo método.

## Datos que no salen de aquí

- **Sensores en arroyos** y **número de curva**: fuera del repositorio (`.gitignore`), fuera del
  bundle y podados de `dist/` con lista blanca. El escurrimiento solo funciona en una copia
  interna que sí lleve el número de curva.
- **Estaciones EMA**: su ubicación dejó de ser reservada el 24/09/2026. La capa sigue sin
  publicarse porque no aporta al análisis de escenas, no porque esté prohibida.
- Padrón, SCADA y contenido del PSH y PRH no entran a esta app en ninguna forma.

## Órdenes del MASTER

Viven en `ORDENES-DEL-MASTER/`, que no se versiona. Cada orden se responde en su propio archivo
`-RESPUESTA.md` y se cambia su estado a `cumplida` con la evidencia.
