# Zonas de crecimiento, verificación: regla del ranking (versión 2.1, 20/11/2026)

**Por qué existe:** Carlos pidió comprobar con datos propios los 8 sectores de la presentación de referencia.
- Versión 1: método del 20/11 en la orden del MASTER.
- Versión 2: aplica el dictamen del juez del mismo día (`DICTAMEN-JUEZ-ZONAS-CRECIMIENTO-VERIFICACION.md`, sección 4).
- Esta regla se fija aquí, en git, **antes** de volver a medir.
- Generador: `herramientas/pi_zonas_verificacion.py`.

## Unidades

Los 17 sectores de planeación de SISPLAN (`SECTORES_DE_PLANEACION.geojson`, sha 8cf0977f). «Fuera de los sectores de planeación» se reporta aparte, sin rango.

## Indicadores

| | Indicador | Entra al ranking |
|---|---|---|
| a | Viviendas convenidas 2019-2026: convenios habitacionales de la capa v2 de Nuevos Desarrollos, recorte exacto del polígono contra el sector | Sí |
| b | Hectáreas de la unión de factibilidad 2021-2026, intersecando la unión directo con el sector (una sola vez, sin pasar por hexágonos). Rótulo: «incluye giros no habitacionales» | Sí |
| c | Tomas domésticas y mixtas nuevas desde 2019 (Análisis de Cuentas, punto en polígono) | Sí |
| d | Hectáreas de cambio confirmado a ojo, sep-2025 a sep-2026. Rótulo: «muestra chica, 22 zonas» | **No: lectura aparte** |

## Regla

- **Rango por indicador:** de 1 (mayor) a 17; los empates llevan rango promedio.
- **Escenarios de robustez**, los cinco fijados ahora:
  1. promedio de rangos de a, b y c;
  2. promedio de rangos de a y c;
  3. solo a;
  4. solo c;
  5. promedio de rangos de a, b y c por km² del sector.
- **«Arriba» en un escenario:** entre los 8 primeros, el mismo número que la lista de referencia.
- **Lectura, por veces arriba en los 5 escenarios:**
  - **firme:** 5 de 5;
  - **sigue:** 3 o 4;
  - **en el límite:** 1 o 2;
  - **no se confirma:** 0.
- **Rótulos que se suman a la lectura:**
  - **«frente de 2025-2026»:** más de la mitad de sus viviendas convenidas se firmó en 2025 o 2026;
  - **«factibilidad en trámite»:** rango de b entre 1 y 3, y rango de c mayor que 8. Se presenta así y no como zona de crecimiento.

## Fuera de los sectores de planeación

- **Recorte exacto:** cada convenio habitacional se recorta contra la unión de los 17 sectores. La parte de fuera se suma por desarrollo.
- **Nombre del desarrollo:** el campo `desarrollo` de la capa v2, sin:
  - lo que va después de «_»;
  - números romanos o arábigos finales;
  - frases de sección o etapa («1RA Y 2DA.SECC», «SECCION», «ETAPA»).
  - Así Brisas del Campestre (6 convenios, 5,037 viviendas) cuenta como un solo desarrollo.
  - **Grafías unidas por orden del juez** (revisión de la v2, 20/11/2026):
    - «HACIENDA STA.FE» → «HACIENDA STA. FE»;
    - «URBI VILLA ROBLE» → «URBIVILLA DEL ROBLE».
  - Cualquier otra unión se agrega aquí antes de medir.
- **Tabla:** los 10 desarrollos con más viviendas convenidas fuera, más qué parte del total de fuera suman.
- **Frase de «la mayoría del crecimiento está fuera»:** solo con viviendas convenidas. Las tomas de fuera incluyen la ciudad consolidada y no se presentan como expansión.
