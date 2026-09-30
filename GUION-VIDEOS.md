# Guion de videos cortos del Observatorio satelital

Para la grabación automatizada que piden las órdenes `2026-09-24-guion-videos` y
`2026-09-26-guion-videos-con-fecha`. Cada video dura de 30 a 90 s, sin audio y con rótulos.
Resolución: 1600×900.

**Entregado el 30/09/2026, un día tarde y después de la hora de grabación.** La fecha pedida era
el 29/09 y la grabación estaba puesta para hoy a las 12:00. Sirve para la regrabación; el retraso
está anotado en la respuesta de la orden.

---

## Entorno de grabación

**URL: <https://observatorio-satelital.sapal.workers.dev>. No hay Access ni sesión: es pública y
se graba directo contra producción.** No hay datos reservados en pantalla; las tres capas
internas (estaciones EMA, sensores en arroyos y número de curva) no viajan al sitio público, y el
podado del build lo garantiza con lista blanca.

Dos consecuencias para quien grabe:

1. **El modo de escurrimiento, dentro de «Hidrología», no se puede grabar en producción**: la
   capa de número de curva no está ahí y el panel muestra el aviso de que falta. Si se quiere en
   video, hay que grabar contra una copia interna (`VITE_CAPAS_INTERNAS=true npm run build` y
   `npx wrangler dev`). Por eso no aparece en este guion.
2. **Todo lo demás depende de la red**: la app lee catálogos abiertos en vivo. Un cálculo tarda
   entre 6 y 15 s según el modo. Los tiempos de abajo ya lo consideran, pero conviene grabar con
   holgura y cortar después.

**Selectores.** Hoy ningún control tiene `data-testid`. En cada paso va el **texto visible
exacto**, que funciona pero se rompe si cambia un rótulo, y entre corchetes el `data-testid`
propuesto. Agregarlos es un cambio menor en `SeccionFlotante.tsx`, `PanelBusqueda.tsx`,
`PanelAnalisis.tsx` y `ListaEscenas.tsx`; lo hago en cuanto el MASTER lo pida, y entra en
cualquier corte porque no mueve ninguna cifra.

**Un aviso de encuadre.** El menú es una columna de tarjetas flotantes sobre el mapa, en el
margen izquierdo, y abrir una pliega las demás. Los resultados se pintan sobre el mapa y la
simbología es otra tarjeta flotante, abajo a la derecha. Conviene que el video muestre las dos
cosas a la vez: el clic a la izquierda y el resultado a la derecha.

---

## 1. Buscar imágenes disponibles y verlas a pantalla completa

**Para qué:** es el primer paso de todo lo demás, y responde la pregunta que más se repite: qué
imágenes hay de León y de cuándo.

| # | Acción | Texto visible exacto | `data-testid` propuesto |
|---|---|---|---|
| 1 | Clic en el área | `Zona urbana` | `area-LIMITE_URBANO` |
| 2 | Abrir la tarjeta | `Escenas` | `seccion-escenas` |
| 3 | Dejar la colección como está | `Sentinel-2 L2A` | `coleccion-sentinel-2-c1-l2a` |
| 4 | Escribir el periodo | `Desde` = `2026-07-01`, `Hasta` = `2026-09-28` | `fecha-desde`, `fecha-hasta` |
| 5 | Dejar la nubosidad en 20 % | `Nubosidad máxima de la escena` | `nubosidad-max` |
| 6 | Clic | `Buscar escenas` | `buscar-escenas` |
| 7 | Esperar la lista y hacer clic | `Ver en pantalla completa` | `galeria-abrir` |
| 8 | Dejar 3 s la galería, clic en una vista previa, y cerrar con `Esc` | — | `galeria-cerrar` |

**Dato de ejemplo:** zona urbana, Sentinel-2, del 1 de julio al 28 de septiembre de 2026.
**Resultado esperado:** la lista muestra alrededor de 14 fechas; cada día indica su nubosidad y,
cuando hace falta, «Mosaico de 2 mallas», porque León cae en el borde de dos mallas de Sentinel-2.
La galería llena la pantalla con las vistas previas ordenadas por fecha.
**Duración:** 45 a 60 s.

---

## 2. Detectar obra nueva entre dos fechas

**Para qué:** es la función que pidió la dirección y la que alimenta el reporte semanal. Mide
cuánta superficie se construyó entre dos imágenes.

| # | Acción | Texto visible exacto | `data-testid` propuesto |
|---|---|---|---|
| 1 | Con la búsqueda del video 1 hecha, elegir el día más reciente de la lista | La fecha, en la lista de escenas | `escena-dia` |
| 2 | En el grupo `Dos fechas`, clic | `Obra nueva` | `modo-obra` |
| 3 | Elegir la fecha base | `Comparar contra` | `comparar-contra` |
| 4 | Clic | `Calcular sobre el área` | `calcular` |
| 5 | Esperar el resultado y mostrar la tarjeta de abajo a la derecha | `Simbología` | `simbologia` |
| 6 | Abrir las notas del cálculo | `Notas del cálculo` | `notas-calculo` |
| 7 | Clic para descargar | `CSV` | `descargar-csv` |

**Dato de ejemplo:** zona urbana, 22/09/2026 contra 26/08/2026.
**Resultado esperado:** manchas sobre el mapa donde apareció construcción nueva, con su total en
hectáreas y el número de zonas. Con ese par salieron 15 zonas y 25.9 ha. **Rotular en el video
que la separación entre las dos fechas es de 27 días**, porque el resultado no significa lo mismo
con 27 días que con dos años.
**Duración:** 60 a 75 s.

---

## 3. Ver la isla de calor con la térmica de Landsat

**Para qué:** es la variable que más se entiende de un vistazo y la que más se pide para mostrar
en una reunión.

| # | Acción | Texto visible exacto | `data-testid` propuesto |
|---|---|---|---|
| 1 | Abrir la tarjeta | `Escenas` | `seccion-escenas` |
| 2 | Cambiar la colección | `Landsat 8/9 C2 L2` | `coleccion-landsat-c2-l2a` |
| 3 | Periodo | `Desde` = `2026-04-01`, `Hasta` = `2026-06-30` | `fecha-desde`, `fecha-hasta` |
| 4 | Clic | `Buscar escenas` | `buscar-escenas` |
| 5 | Elegir un día despejado de la lista | La fecha | `escena-dia` |
| 6 | En el grupo `Una fecha`, clic | `Calor` | `modo-calor` |
| 7 | Clic | `Calcular sobre el área` | `calcular` |

**Dato de ejemplo:** zona urbana, una escena de Landsat de mayo de 2026, que es el final de la
temporada seca y cuando más contrasta la ciudad contra el campo.
**Resultado esperado:** el mapa se pinta con la temperatura de superficie y la simbología da el
rango en grados. Se ve el centro urbano más caliente que el entorno agrícola.
**Duración:** 45 a 60 s.

---

## 4. Consultar una capa de referencia, que aparece al instante

**Para qué:** muestra la diferencia entre lo que se calcula y lo que ya está calculado, y de paso
explica por qué la plataforma es rápida.

| # | Acción | Texto visible exacto | `data-testid` propuesto |
|---|---|---|---|
| 1 | Elegir el área | `Municipio` | `area-LIMITE` |
| 2 | Abrir la tarjeta | `Capas de referencia` | `seccion-referencia` |
| 3 | Clic | `Cobertura del suelo` | `producto-cobertura` |
| 4 | Mostrar la simbología con las clases y sus hectáreas | `Simbología` | `simbologia` |
| 5 | Clic | `Evapotranspiración anual` | `producto-evapotranspiracion` |
| 6 | Abrir las notas y detenerse en la que explica la escala | `Notas del cálculo` | `notas-calculo` |

**Dato de ejemplo:** municipio completo, cobertura del suelo de ESA WorldCover 2021.
**Resultado esperado:** la capa aparece **en una décima de segundo**, contra los casi nueve
segundos que tardaba cuando se calculaba en el navegador. Es el contraste que vale la pena
rotular: lo que no depende de la escena elegida se precalcula y viaja como imagen.
**Duración:** 30 a 45 s.

---

## 5. Sacar los datos de la plataforma

**Para qué:** responde la objeción más común, que una plataforma bonita de la que no se puede
sacar nada no sirve para trabajar.

| # | Acción | Texto visible exacto | `data-testid` propuesto |
|---|---|---|---|
| 1 | Con cualquier resultado en pantalla, ir a la tarjeta de abajo a la derecha | `Simbología` | `simbologia` |
| 2 | Clic | `CSV` | `descargar-csv` |
| 3 | Mostrar el archivo descargado | — | — |
| 4 | Clic | `JSON` | `descargar-json` |

**Resultado esperado:** se descarga lo mismo que está en pantalla, con el nombre del resultado y
la fecha del día. **Rotular que para medir muchos polígonos de una vez existe `npm run medir`**,
que entrega una fila por polígono con el identificador de la capa de origen, y que eso no se
graba porque es de línea de comandos.
**Duración:** 30 s.

---

## Lo que a propósito no está en el guion

- **Escurrimiento por número de curva:** no corre en el sitio público (ver arriba).
- **Subsidencia InSAR:** el visor necesita un archivo procesado por HyP3 que todavía no se tiene,
  y la búsqueda de pares sola no se entiende en video.
- **Resumen semanal por Telegram:** ya hay captura (`ORDENES-DEL-MASTER/capturas/15`) y grabarlo
  exigiría esperar al lunes.
