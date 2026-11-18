# OBS-17 v3: temperatura de superficie por sector. Método congelado antes de medir

Escrito y versionado el 18/11/2026. **No se ha corrido nada con este método.** Responde a las condiciones (e) a (i) del
dictamen del juez del 18/11/2026 sobre la v2. La v2 y su dictamen están en la bitácora interna del MASTER, que no se
versiona. Este archivo sí se versiona: el commit que lo agrega es la prueba de que el método se fijó antes de medir.
Cualquier cambio posterior se anota al final, con fecha y motivo, en otro commit. La corrida es para el hito de enero de
2027, y el resultado vuelve al juez antes de citarse.

Nombre: «temperatura de superficie por sector». No se usa «isla de calor» en ningún rótulo.

## Datos

- **Imágenes:** Landsat 8 y 9 Collection 2 Level 2 de Planetary Computer. Banda térmica ST_B10, en grados Celsius, con
  la escala y el offset del ítem.
- **Fechas:** todas las de abril y mayo de 2014 a 2026. **Sin filtro de nubosidad por escena:** esta versión no lleva el
  `eo:cloud_cover <= 30` de la v2. Las nubes se quitan solo por píxel, con QA_PIXEL: bits 0 a 4
  (relleno, nube dilatada, cirro, nube y sombra), igual que la v2.
- **Mosaico por paso:** las dos filas WRS-2 de un mismo paso se funden en una sola fecha, y cada fecha cuenta una vez.
- **Rejilla:** la nativa de 30 m, en EPSG:32614, sin remuestreo bilineal (vecino más cercano).
- **Compuesto:** una sola mediana por píxel con todas las fechas despejadas, cada fecha con el mismo peso. NDVI y MNDWI se
  calculan con las mismas fechas, a partir de la reflectancia C2 L2.
- **Fracción construida:** GHSL R2023A de 2020, celda de 100 m, repartida a 30 m sin promediar. Es la misma de la v2.

## Unidades

- **Sectores:** la capa vigente de Balance Hídrico (copia del 05/11/2026).
- **Alcance:** sectores con 90 % o más de su área dentro del límite urbano POTE 2020, de 10 ha o más y con 100 píxeles
  válidos o más. Son las mismas reglas de la v2.
- **Condición (g):** los sectores con menos de 20 % construido no entran al indicador. Se reportan aparte, como
  «en urbanización», solo con su mediana de temperatura y su NDVI, sin anomalía ni marca.

## Indicador por sector (condición f)

- **Comparación:** cada sector se compara con sus 30 vecinos más cercanos en fracción construida (ventana móvil sobre la
  fracción, no sobre la distancia), dentro de los sectores en alcance.
- **Anomalía:** la mediana de temperatura del sector menos la mediana de esos 30 vecinos.
- **Sensibilidad declarada:** ventanas de 20 y 40 vecinos. Se reporta cuántos sectores marcados se mantienen; no se elige
  la ventana después de ver los datos.
- **NDVI:** no es control, es variable explicativa. Se reporta la correlación de Spearman entre la anomalía y el NDVI del
  sector, y la mediana de NDVI de los sectores marcados contra la de los demás.
- **Umbral:** +1.5 °C, con sensibilidad a +1.0 y +2.0 °C. Es el mismo de la v2.

## Validación, declarada de antemano

1. **Estabilidad:** el Spearman de la anomalía entre fechas impares y pares debe ser de 0.8 o más. Si no lo alcanza, no
   se publica nada por sector.
2. **Condición (h):** un sector solo se marca si supera el umbral con las fechas de 2014-2021 y también con las de
   2022-2026, cada mitad con su propio compuesto y su propia comparación.
3. **Cobertura:** la anomalía no debe seguir dependiendo de la fracción construida. Dentro del alcance, el Spearman entre
   anomalía y fracción construida debe quedar entre −0.15 y +0.15; en la v2, con terciles, fue de −0.22 a −0.30. Si
   queda fuera, se dice así y no se publica por sector.
4. **Cifra de contraste:** la mediana urbana por año debe seguir en el rango ya publicado de 40.5 a 46.2 °C, o se
   explica la diferencia. La v3 solo cambia el filtro de nubosidad y el remuestreo.

## Lado del entorno rural (descriptivo, sin valor único)

El juez mostró que la diferencia entre la ciudad y el campo depende del lado. Si se calcula, va por cuadrante del anillo
de 2 a 6 km: norte (sierra), oriente, sur y poniente. Va solo como descripción: no hay intensidad urbano-rural única ni
se cita como valor.

## Lo que no se hace

- No se usa NDVI como control.
- No se elige ventana, umbral ni filtro después de ver los resultados.
- No se publica ningún conteo, lista de sectores ni nombre de sector sin el dictamen del juez sobre esta v3.

## Cambios posteriores

(ninguno)
