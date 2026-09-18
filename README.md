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

Lo que si se calcula aqui corre en un Web Worker (`src/trabajador/calculo.worker.ts`),
no en el hilo de la interfaz. El worker lee las bandas, calcula y pinta los
pixeles; a la pagina solo le llega un arreglo RGBA transferido, que se vuelve
PNG y se pone como `ImageOverlay`. Antes el pintado con georaster congelaba la
pagina hasta 1.4 s por calculo; ahora ninguna tarea del hilo principal pasa de
50 ms. georaster queda solo para el color verdadero de la escena y el TIF de
InSAR.

En `npm run dev` el worker fallaba con "buffer error" al descomprimir: Vite
descubria geotiff y pako a media sesion y el worker terminaba con copias
distintas. `optimizeDeps.include` en `vite.config.ts` los empaqueta desde el
arranque. El build nunca tuvo el problema.

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

1. Se busca en el catalogo STAC por poligono, rango de fechas y nubosidad. La
   busqueda pagina: con una sola pagina, un periodo de dos anios devolvia solo
   lo mas reciente y la fecha vieja contra la que comparar nunca aparecia.
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

### Mascara de nubes por pixel

El filtro de nubosidad de la busqueda es por escena completa: una escena con
15 por ciento de nubes pasa aunque esas nubes caigan justo sobre Leon. La
mascara por pixel usa la banda que publica cada mision, SCL en Sentinel-2 y
QA_PIXEL en Landsat, y descarta nube, sombra, cirro y nieve antes de calcular
nada. Sentinel-1 es radar y no la necesita.

Los tres estados se distinguen a proposito: despejado, nube y sin dato. Una
escena de Landsat que solo cubre un tercio del municipio deja el resto sin
dato, y contarlo como nube reportaba 99 por ciento de nubosidad en una escena
que declaraba 59. La nota dice el porcentaje nublado de lo que cada escena
alcanza a ver, y cuanto del area cubre.

Que cambia en la practica, sobre el mismo par del limite urbano
(26/08/2024 contra 05/09/2026): sin mascara salen 102 zonas de obra y 266.9
ha; con mascara, 91 zonas y 238.9 ha. Once zonas eran nube de la fecha base,
que a 1.2 por ciento de nubosidad declarada ya bastaba para inventarlas.

Como efecto util, el mosaico del dia rinde mas: donde una malla queda
nublada, la otra aporta.

### Obra nueva

Detecta desarrollos entre dos fechas. No basta con que suba el NDBI: un
terreno que se seco entre las dos tomas lo sube igual, y en un municipio con
media superficie agricola eso llenaria el mapa de falsos positivos. Se piden
tres condiciones a la vez: el NDBI sube al menos el umbral, el NDVI final
queda por debajo de 0.30, y el MNDWI final es negativo para descartar agua.

Las celdas que cumplen se agrupan en zonas conexas por vecindad de 8 y se
descartan las menores al area minima, porque celdas sueltas no son un
desarrollo. Cada zona se reporta con su superficie y su centro en grados, y se
marca en el mapa con un circulo cuyo radio va con la raiz del area.

El resultado son candidatos, no un dictamen: un despalme sin construir cumple
la misma regla y a 10 m una casa sola no se distingue. La app avisa cuando las
dos fechas caen en temporadas distintas, porque comparar seca contra lluvias
infla el cambio; para obra nueva conviene el mismo mes de dos anios.

Corrida de ejemplo sobre el limite urbano, 26/08/2024 contra 05/09/2026:
102 zonas, 266.9 ha, la mayor de 11.0 ha.

### Separacion temporal

Al comparar dos fechas, el panel muestra cuantos dias las separan y cada
cuanto revisita la coleccion. Es lo primero que hay que saber para interpretar
un cambio: no es lo mismo un mes que dos anios.

### k-means

Bandas de entrada a eleccion, de 2 a 8 clases. Los valores se estandarizan
antes de agrupar para que una banda con rango mas amplio no domine. La siembra
es tipo k-means++ y el generador aleatorio lleva semilla fija, asi que la misma
escena con los mismos ajustes da exactamente las mismas clases. La leyenda
reporta hectareas y porcentaje por clase, y el centroide en reflectancia.

### Calor

Temperatura de superficie con la banda termica de Landsat, que el item
declara en Kelvin con su escala. Es temperatura de la superficie, no del
aire: el asfalto a mediodia pasa de 50 grados mientras el termometro marca
30, asi que sirve para comparar zonas entre si.

Corrida sobre el limite urbano el 26/08/2026: media 39.7 grados, entre 32.9
y 44.9.

### Agua y crecida con radar

Sentinel-1 no ve color, ve rugosidad: el agua en calma devuelve poca senal y
sale oscura. Con un umbral sobre VV se dibuja la lamina; con fecha base se
separa agua permanente, agua nueva y agua que desaparecio.

Solo compara celdas con dato en las dos fechas. Cada pasada cubre una franja
distinta, y sin ese cuidado una toma incompleta reportaba como "agua que
desaparecio" lo que era falta de imagen.

### Serie de tiempo

Media de un indice sobre el area, fecha por fecha, con las fechas repartidas
a lo largo del periodo. Corre sobre rejilla de 128 porque la media de miles
de hectareas no cambia por afinar la celda. Se puede cancelar y copiar como
CSV.

Corrida sobre la cuenca Palote, 12 fechas de dos anios: NDVI de 0.64 en
septiembre a 0.21 en enero.

### Calidad de agua

NDCI para clorofila, con el borde rojo B05, y NDTI para turbidez relativa.
Los dos fuerzan el recorte a la lamina de agua: sobre tierra un NDCI alto es
vegetacion, no clorofila. La lamina se dibuja con MNDWI y no con NDWI porque
el concreto tambien tiene NDWI alto.

## Organizacion de la interfaz

El area de interes va arriba y la comparten cuatro pestanas: Escenas, Serie,
Referencia e Hidrologia (escurrimiento e InSAR). Escenas es un flujo de tres
pasos numerados (busqueda, escena y analisis); cada paso cumplido se pliega a
una linea con su resumen y un boton Cambiar. Los modos de analisis van en dos
filas segun cuantas fechas piden. Sobre el mapa flotan cuatro tarjetas: capas
arriba a la izquierda, escena arriba a la derecha, simbologia abajo a la
derecha y notas del calculo abajo a la izquierda, plegadas. Antes todo
iba en una columna de 1,780 px, 2.2 pantallas de alto; ahora cada pestana
cabe en una.

## Capas de referencia

Productos globales ya calculados que se recortan al area y se miden. No son
escenas: no hay fecha que elegir ni nubosidad que filtrar.

| Producto | Fuente | Resolucion |
|---|---|---|
| Agua historica | JRC Global Surface Water | 30 m, 1984 a 2021 |
| Cobertura del suelo | ESA WorldCover v200 | 10 m, 2021 |
| Evapotranspiracion anual | MODIS MOD16A3GF v061 | 500 m, anual |

MODIS obligo a leer la proyeccion desde las geo keys del archivo: su rejilla
sinusoidal no tiene codigo EPSG, asi que declara 32767 y hay que armar la
proyeccion por partes. ECOSTRESS, que seria la opcion fina para
evapotranspiracion, no esta en Planetary Computer y necesitaria tuberia
aparte con cuenta de Earthdata.

Las tres se precalculan antes de desplegar, para las tres areas, y viajan en
`public/precalculado/<area>/<producto>.png` con su `.json` de leyenda y notas.
En el navegador solo se descarga la imagen: la cobertura del municipio pasa de
8.8 s de lectura y calculo a unos 0.1 s. Si falta el archivo, la app cae al
calculo en vivo. Los productos cambian cada ano o nunca, asi que se regeneran a
mano cuando sale una version nueva:

```bash
npm run precalcular
```

Tarda un par de minutos por las pausas entre peticiones (Planetary Computer
responde 429 si se le pide seguido).

## Escurrimiento

Metodo del numero de curva del SCS sobre las 63 subcuencas del departamento.
Lo que aporta el satelite no es el numero de curva, que ya existe, sino
cuanta superficie se impermeabilizo: las zonas del modo Obra se reparten por
subcuenca y suben el numero de curva en proporcion al area que ocupan.

Corrida con 50 mm de lluvia y condicion media: 45.6 millones de m3 sobre
2,290 km2, y de esos, 37,669 m3 los agregan las 239 ha de obra nueva
detectadas entre 2024 y 2026.

La capa `NUMERO_DE_CURVA.geojson` es interna y no viaja al sitio publico; el
podado la excluye y el panel avisa cuando falta.

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
