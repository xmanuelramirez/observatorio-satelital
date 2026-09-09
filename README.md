# Observatorio satelital, Planeacion Hidrica Leon

Lee bandas de Sentinel-2, Landsat y Sentinel-1 recortadas a los poligonos del
departamento, calcula indices y agrupa el territorio con k-means. Todo corre en
el navegador, contra catalogos abiertos y sin ninguna credencial.

```bash
npm install
npm run dev      # vite, puerto 5173
npm run build
npx tsc -b       # chequeo de tipos
```

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

El sitio es estatico y se publica solo. Cada push a `main` dispara
`.github/workflows/desplegar.yml`, que compila y sube el resultado a GitHub
Pages.

```bash
npm run build     # tsc, vite y el podado de capas
```

Dos piezas sostienen que no se publique de mas:

1. `src/datos/capas.ts` mantiene las capas internas en un arreglo aparte. Como
   `VITE_CAPAS_INTERNAS` se resuelve en tiempo de compilacion, el build publico
   las elimina del bundle; no basta con no dibujarlas, porque sus nombres y
   rutas viajarian igual.
2. `herramientas/podar-capas.mjs` borra de `dist/capas` todo lo que no este en
   su lista blanca. Es lista blanca y no lista negra a proposito: una capa
   nueva que nadie haya clasificado no se publica, y el script lo reporta.

Para un despliegue interno que si deba llevarlas:

```bash
VITE_CAPAS_INTERNAS=true npm run build
```

`base` esta en `'./'`, asi que el sitio funciona en cualquier subruta y no hay
que tocar nada si cambia el nombre del repositorio.

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
- **Sin serie de tiempo.** Cada calculo es de una fecha. Comparar dos fechas
  sigue siendo manual.
- `georaster` arrastra `worker-loader` y `webpack` 4 como dependencias de
  ejecucion, y de ahi salen las 15 alertas de `npm audit`. No entran al bundle
  del navegador, pero ahi estan.
