# Ritmo de consolidación por tipo de desarrollo: método (versión 1, 23/11/2026)

**Qué:** pedido del jefe vía MASTER (23/11): «análisis del ritmo de consolidación por tipo de desarrollo».
- Se fija aquí, en git, **antes** de medir.
- Generador: `herramientas/pi_1b_por_tipo.py`.

**Base:** la versión 5 del ritmo de consolidación, corte único a oct-2026, con la regla de clase dictaminada (`herramientas/pi_1b_consolidacion.py`).

## Tipos

Nuevos Desarrollos clasifica cada uno de los 374 convenios habitacionales como **vivienda**, **vertical** o **lote**. Cada tipo trae su fuente: **dato**, **pista** o **sin dato**.
- **Principal:** solo los de fuente «dato».
- **Sensibilidad:** «dato» más «pista», reportada aparte.
- **«Sin dato»:** se cuenta, pero no entra a ninguna curva por tipo.

## Curva típica por tipo

- **Conjunto de referencia:** el mismo de la v5. Habitacionales de 20 unidades o más, 36 meses o más a oct-2026 y sin marca de dudoso.
- **Por tipo:** mediana, p25 y p75 de la consolidación a los 12, 24 y 36 meses, sin ponderar.
- **Si un tipo tiene menos de 10 convenios de referencia:** se dice y **no se saca mediana**. Se reporta solo el número de convenios.
- **Conteo:** cuántos convenios y unidades hay por tipo y fuente, en total y en la referencia.

## Clases por tipo

- **Regla:** la misma de la v5, con R(a) de todos los convenios, no una R por tipo. Así los tipos se comparan en la misma escala.
- **Qué se cuenta:** convenios y unidades por clase (alta, media, baja, por revisar, provisional y sin clasificar) dentro de cada tipo.

## Contraste «urbanizado contra contratado» (1c)

- **Unidades:** convenios de 2 ha o más con par Sentinel-2 «antes y después» (v5), sin verticales, que quedan fuera del cruce por regla del juez. No entran los desarrollos sumados.
- **Brecha:** % urbanizado en sep-2026 menos consolidación por tomas a oct-2026, por convenio.
- **Hipótesis y umbral, declarados antes de medir:**
  - el lote contrata tarde, así que su mediana de brecha debe superar a la de vivienda por **0.15 o más** (15 puntos);
  - fuente de la hipótesis: Carlos, plan del 19/11: «hay desarrollos que venden por lotes: aunque se vendan, si no se construye no se consolida»;
  - si no se cumple, se dice así y no se ajusta el umbral.
- **Si un tipo tiene menos de 10 convenios con par:** se reportan los casos, sin mediana.

## Rótulos

- «Tipo de desarrollo según Nuevos Desarrollos (fuente: dato; pista aparte)».
- «Ritmo de consolidación por tomas domésticas y mixtas, padrón a oct-2026; contratado no es construido».
- «Urbanizado: Sentinel-2, no es conteo de viviendas».
