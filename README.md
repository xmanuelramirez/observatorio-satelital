# Observatorio satelital, Planeacion Hidrica Leon

Lee bandas de Sentinel-2, Landsat y Sentinel-1 recortadas a los poligonos del
departamento, calcula indices, compara dos fechas, agrupa el territorio con
k-means y arma pares InSAR para subsidencia. Todo corre en el navegador,
contra catalogos abiertos y sin ninguna credencial.

Publicado en https://observatorio-satelital.sapal.workers.dev

```bash
npm install
npm run dev        # vite, puerto 5173
npm run tipos      # tsc; vite build no revisa tipos
npm run build      # tsc, vite y el podado de capas
npm run local      # build servido con las cabeceras reales, puerto 8787
npm run desplegar  # build y publicacion en Cloudflare
```

## Por que esta armada asi

| Pregunta | Respuesta |
|---|---|
| Quien la usa | Publico general. Sin autenticacion: todo lo que muestra puede ser publico, y lo que no, no entra al build |
| Trata datos personales | No. Ni captura, ni cuentas, ni coordenadas de tomas |
| El navegador escribe algo | No. Sin base de datos |
| Necesita calculo periodico | No. No hay precomputo: cada calculo depende de la escena y el area que se elijan en el momento |

### Clasificacion de los datos

| Conjunto | Nivel | Tratamiento |
|---|---|---|
| Limite municipal, limite urbano, cuenca Palote | Publico | Se publican en `capas/` |
| Estaciones EMA, sensores en arroyos | Reservado | Ubicacion de instrumentacion. Fuera del repositorio (`.gitignore`), fuera del bundle y podadas de `dist/` |
| Escenas Sentinel-2, Landsat, Sentinel-1 | Publico | No se guardan: se leen al vuelo del catalogo |
| Resultados de HyP3 en `public/insar/` | Interno | Fuera del repositorio (`.gitignore`); solo se ven en local |

### Calculo en el navegador

La regla del departamento es que el calculo pesado no corra en el navegador.
Aqui es una excepcion consciente: el calculo depende de escena, fecha, area,
indice y rejilla elegidos al momento, y precalcular todas las combinaciones no
es viable. Lo pesado se acota leyendo solo la ventana del area por rangos HTTP,
con rejillas de 256 a 1024 celdas, y guardando en memoria las bandas ya
leidas. InSAR, que si es calculo de horas, corre fuera, en HyP3.

## De donde salen los datos

| Coleccion | Catalogo | Resolucion | Revisita |
|---|---|---|---|
| Sentinel-2 L2A | Earth Search (AWS Open Data) | 10 m | 5 dias nominal |
| Landsat 8/9 C2 L2 | Microsoft Planetary Computer | 30 m | 16 dias por satelite |
| Sentinel-1 RTC | Microsoft Planetary Computer | 10 m | 6 dias con 1C y 1D |

Los dos catalogos se eligieron por lo que dejan leer desde una pagina web.
Earth Search publica Sentinel-2 como COG abiertos, sin firma ni token. Sus
assets de Landsat y Sentinel-1, en cambio, son URIs `s3://` de cubetas
requester-pays: el navegador no puede tocarlos. Planetary Computer guarda esos
mismos COG en blobs privados pero entrega un SAS anonimo y gratuito con una
llamada a su firmador, asi que sirve para las dos misiones que faltaban.

Google Earth Engine quedo descartado a proposito. Su nivel gratuito excluye de
forma explicita los entregables de tipo fee-for-service, y el uso operativo de
gobierno exige licencia comercial de pago.

## Como funciona el analisis

1. Se busca en el catalogo STAC por poligono, rango de fechas y nubosidad.
2. La rejilla de analisis se define desde el area, en grados, y no desde la
   escena. Es la pieza que sostiene todo lo demas: la misma celda significa el
   mismo lugar en cualquier escena y cualquier fecha.
3. Al elegir una o varias escenas, se leen sus bandas por rangos HTTP, ya
   recortadas al area y remuestreadas a esa rejilla. Asi B11 a 20 m y B04 a
   10 m quedan alineadas pixel a pixel sin trabajo manual.
4. La escala y el desplazamiento de cada banda salen del propio item STAC, no
   de constantes escritas a mano. Importa: el offset no se cancela en una
   diferencia normalizada, y sin aplicarlo el NDVI sale mal.
5. Cada escena se recorta a su propia huella y las escenas del dia se funden en
   un mosaico: gana la primera que tenga validas todas sus bandas en la celda.
6. La rejilla se recorta al poligono real por barrido de lineas, no al
   rectangulo envolvente.
7. Sobre eso se calcula el indice o se corre k-means.

El recorte se valido contra el dato oficial: sobre `LIMITE.geojson` la mascara
da 1,281.2 km2 y el `Shape_Area` del shapefile dice 1,282.19 km2, una
diferencia de 0.08 por ciento estable entre las rejillas de 256 y 2048.

### Por que la rejilla esta en grados

Leon queda pegado al meridiano 102, que es el borde entre las zonas UTM 13 y
14. Sus dos mallas de Sentinel-2 caen cada una de un lado: 13QHD publica en
EPSG:32613 y 14QKJ en EPSG:32614. No hay rejilla nativa comun entre ellas.

Eso no era solo un estorbo para mosaicar. Antes, cada escena imponia su propia
rejilla en su propio CRS, asi que comparar dos fechas cuyas escenas venian de
mallas distintas restaba celdas que no eran el mismo lugar. La rejilla comun
en 4326 elimina el problema de raiz.

Se paga con la escala: un grado de longitud mide distinto que uno de latitud, y
ambos cambian con la latitud. Las hectareas usan la serie elipsoidal WGS84
evaluada en el centro del area, no el atajo esferico, que dejaba la superficie
del municipio 0.2 por ciento corta.

### Mosaico del dia

Cada escena de la lista se puede activar o desactivar; el boton del dia une
todas sus mallas de una vez. La leyenda reporta que porcentaje del area aporto
cada escena y cuanto quedo sin dato. La seleccion siempre es de un solo dia.

### Indices

NDVI, NDWI, MNDWI, NDBI y NBR. La rampa se estira entre los percentiles 2 y 98
de los pixeles validos del area, no entre -1 y 1, para que el contraste sirva.

### k-means

Bandas de entrada a eleccion, de 2 a 8 clases. Los valores se estandarizan
antes de agrupar para que una banda con rango mas amplio no domine. La siembra
es tipo k-means++ y el generador aleatorio lleva semilla fija, asi que la misma
escena con los mismos ajustes da exactamente las mismas clases. La leyenda
reporta hectareas y porcentaje por clase, y el centroide en reflectancia.

## Capas

Las cinco capas de `public/capas` vienen de
`3. PLANEACION INTEGRAL/extracted/public`, que es la copia en WGS84. La copia
de `extracted/shapefiles` esta en EPSG:32614 y no sirve ni para Leaflet ni para
STAC. Sirven como area de interes las tres de poligono: limite municipal,
limite urbano y cuenca Palote.

Las otras dos, estaciones EMA y sensores en arroyos, estan marcadas
`publica: false` en `src/datos/capas.ts`. Son ubicaciones de instrumentacion
del organismo, no hacen falta para analizar una escena, y no salen en un build
publico.

## Despliegue

Cloudflare Workers con assets estaticos y sin codigo, igual que Indicadores
Climaticos, en la cuenta personal de Carlos por decision del 17 de septiembre
de 2026 mientras no exista la institucional. No es Pages porque ese dia
Cloudflare rechazo crear cualquier proyecto Pages nuevo en la cuenta. Los
assets de Workers aplican `public/_headers` igual. El despliegue es a mano:

```bash
npm run desplegar
```

`.github/workflows/verificar.yml` revisa cada push: tipos, build publico, que
no haya capas internas en `dist/` y `npm audit` con umbral alto. No despliega
y no usa ninguna credencial.

Dos piezas sostienen que no se publique de mas:

1. `src/datos/capas.ts` mantiene las capas internas en un arreglo aparte. Como
   `VITE_CAPAS_INTERNAS` se resuelve en tiempo de compilacion, el build publico
   las elimina del bundle; no basta con no dibujarlas, porque sus nombres y
   rutas viajarian igual.
2. `herramientas/podar-capas.mjs` borra de `dist/capas` todo lo que no este en
   su lista blanca. Es lista blanca y no lista negra a proposito: una capa
   nueva que nadie haya clasificado no se publica, y el script lo reporta.

Para un build interno que si deba llevarlas, que no se despliega:

```bash
VITE_CAPAS_INTERNAS=true npm run build
```

## Seguridad

- **Cabeceras** en `public/_headers`: CSP, HSTS, `X-Frame-Options: DENY`,
  `nosniff`, `Referrer-Policy` y `Permissions-Policy`. La CSP no lleva
  comodines y cada excepcion esta explicada en el propio archivo. Se probo con
  `npm run local`, que aplica las mismas cabeceras que produccion, recorriendo
  las tres colecciones y los cuatro modos sin una sola violacion.
- **Sin secretos.** La app no usa ninguno. El script de HyP3 lee las
  credenciales de Earthdata de variables de entorno o de `~/.netrc`, nunca de
  un archivo del repositorio.
- **Dependencias.** `npm audit` en cero. `georaster` pide `worker-loader`, que
  pide `webpack` 4 como peer, y npm instalaba sola esa cadena con 17
  vulnerabilidades aunque nada de ella corre: georaster publica sus bundles ya
  compilados. `.npmrc` activa `legacy-peer-deps` para no instalar peers que
  nadie pidio. Dependabot propone menores y parches cada semana; las mayores
  las decide una persona.

## Identidad visual

Paleta y tipografia de la familia de plataformas del departamento, tomadas de
SICLAR y Subcuencas: carbon profundo, acento azul `#2596be`, Inter y JetBrains
Mono auto-alojadas en `public/fonts`. Los tokens viven en `src/index.css`. Dos
ajustes por contraste WCAG AA: el color de rotulo sube a `#8c7f73` (5.05:1
contra 3.47:1 del original) y ningun texto que se lee baja de 12 px.

## Fechas

Todo dia se maneja en hora de Leon con `src/lib/fecha.ts`. Recortar la cadena
ISO daba el dia UTC, y las pasadas ascendentes de Sentinel-1, cerca de las
00:49 UTC, aparecian con la fecha del dia siguiente. El periodo que se captura
tambien se convierte a su frontera UTC antes de consultar los catalogos.

## Limitaciones conocidas

- **La rejilla no es nativa.** El analisis corre a 256, 512 o 1024 pixeles
  sobre el area, no a 10 m. Sobre el municipio, 512 significa celdas de unos
  97 por 101 m. Las cifras de superficie por clase heredan esa resolucion.
- **El mosaico es de un solo dia.** Unir dos fechas en una capa mezclaria
  terreno visto en momentos distintos, asi que la seleccion se reinicia al
  tocar una escena de otra fecha. Un mosaico que rellene huecos de nubes con
  la fecha mas cercana sigue pendiente.
- **El mosaico rinde menos de lo que sugiere el nombre.** En Leon las dos
  mallas de Sentinel-2 se traslapan casi por completo y, en la mayoria de las
  fechas, cualquiera de las dos cubre el municipio entero por si sola. El
  mosaico solo cambia el resultado cuando la fecha trae dos orbitas y cada
  toma queda incompleta: ahi pasa de 98.5 a 100 por ciento del area. En
  Landsat, la escena 028/045 cubre todo y 028/046 aporta un tercio, asi que
  unirlas no agrega nada. En Sentinel-1 cada fecha trae una sola toma, y
  cuando esa toma cubre el 40 por ciento del municipio no hay con que
  completarla.
- **Sin mascara de nubes.** El filtro de nubosidad es por escena completa; no
  se usa todavia la banda SCL para descartar pixel por pixel.
- **Sin serie de tiempo.** El modo cambio compara dos fechas; una serie con
  mas de dos sigue pendiente.
- **InSAR no se procesa en la app.** La app arma los pares y el comando; el
  procesamiento corre con `herramientas/hyp3_subsidencia.py` y necesita cuenta
  de NASA Earthdata. Esa ruta no se ha corrido de extremo a extremo.
