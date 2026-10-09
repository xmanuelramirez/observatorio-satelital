# Observatorio satelital

Línea B del contrato SAPAL 2026-2027. Lee catálogos abiertos de satélite y mide cambios del
territorio de León: obra nueva, índices, temperatura de superficie, agua por radar, series y
capas de referencia. Publicada en https://observatorio-satelital.sapal.workers.dev, detrás de
Cloudflare Access desde el 08/10/2026.

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

**Después de cada push se confirma que «Verificar» salió en verde**, con `gh run list` o
`gh run watch`, antes de dar el cambio por hecho. Es estándar del departamento desde el
01/10/2026. El motivo: ese flujo estuvo siete corridas en rojo desde el 30/09 y quien lo vio
primero fue Carlos, en su correo. Un push sin mirar la corrida es un cambio que uno cree hecho
y no lo está.

## Toda medición nueva declara una cifra de contraste

Antes de dar por buena una medición nueva, hay que decir contra qué cifra conocida debe ser
plausible, y comprobarlo. No es revisar el código: es mirar el número y preguntarse si puede ser
cierto.

De dónde salió la regla: el 28 de septiembre de 2026 la primera versión del modo de suelo
desnudo dio 47 por ciento en plena zona urbana. El código estaba bien; lo que fallaba era el
método, porque el NDVI bajo no distingue suelo de pavimento. La cifra de contraste (una ciudad
no puede ser medio suelo desnudo) fue lo que lo detectó. Desde entonces es regla del
departamento, en `0. MASTER/2. ESTANDARES/AUDITORIA-METODOLOGIAS.md`.

También va escrito el umbral y su fuente antes de medir, no después de ver el resultado.

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

## Detrás de Access (decisión de Carlos, 30/09/2026; activo desde el 08/10/2026)

Todas las apps del portafolio van detrás de Cloudflare Access y **ninguna información queda por
fuera**. Esta lo está desde el 08/10/2026: Carlos lo activó en el panel (Domains > workers.dev >
Enable Access, scope «All traffic», equipo `sapal`), y cubre producción y vistas previas.

- **Comprobar producción ya no es abrirla.** Sin sesión, todo responde 302 al login de
  `sapal.cloudflareaccess.com`. Un script que reciba esa página no ve un error, ve una página que
  no es la suya. Tras cada despliegue se comprueban las dos cosas: sin token la raíz da 302, y con
  el token de servicio `observatorio-verificacion` (política «verification», Service Auth) da
  200 y trae el cambio. Sus cabeceras viven en `C:\Users\xmanu\.secretos\observatorio-access.headers`,
  fuera del repositorio y de OneDrive, y se usan con `curl -H @<ese archivo>`. Nunca se imprimen ni
  se copian al repositorio. Vence el 08/10/2027.
- **El repositorio pasa a privado y lo cierra el MASTER**, cuando el Vigía ya no dependa de
  leer `semanal/` desde `raw.githubusercontent.com`. Esta sesión no toca la visibilidad.
  Mientras siga público, `ENTREGABLES/` no se versiona y nada derivado de la zona federal de
  arroyos ni de la capa de recarga potencial de Daniel Murrieta entra al repositorio.
- La app no valida identidad: es estática, sin Worker con código. El Worker que verifique el JWT
  y falle cerrado sigue en el plan T-ACC y se hace solo con orden del MASTER.
- El enlace del mensaje semanal de Telegram pide login a quien no tenga cuenta de Access.

## Órdenes del MASTER

Viven en `ORDENES-DEL-MASTER/`, que no se versiona. Cada orden se responde en su propio archivo
`-RESPUESTA.md` y se cambia su estado a `cumplida` con la evidencia.
