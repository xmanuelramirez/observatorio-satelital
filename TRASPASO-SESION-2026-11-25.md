# Traspaso de la sesión del Observatorio, 25/11/2026

Desde el 25/11/2026 el Observatorio lo lleva el subagente `satellite` de SISPLAN. La sesión vieja se borra. Este archivo
guarda lo que solo vivía en su conversación. Las reglas de trabajo siguen en `CLAUDE.md` y el detalle técnico en
`README.md`.

**Este repositorio es público.** Aquí no van cifras del padrón, de convenios ni de factibilidades. El detalle con cifras,
SHA de salidas y nombres de sectores está en `ORDENES-DEL-MASTER/2026-11-25-TRASPASO-DETALLE.md`, que no se versiona.
Léelo antes de retomar.

## Estado al 25/11

- `main` coincide con `origin/main`. No hay trabajo a medias en código. `AGENTS.md` está sin versionar y no es de esta sesión.
- **En producción, tras Access:** el panel «Ritmo de crecimiento» y el cambio de «consolidación» a «densificación»,
  con la ayuda «?» que se abre al clic (`src/componentes/Ayuda.tsx`). Carlos pidió el cambio de nombre porque en SAPAL
  «consolidado» quiere decir construido al 100 %.
- **Planeación Integral, paquete del 25/11:** cerrado en su versión 5, con corte único a oct-2026 y dictamen del juez.
  Los generadores son `herramientas/pi_*.py` y `herramientas/pi-1c-escenas.ts`. Las salidas viven en
  `salidas/planeacion-integral/`, sin versionar.
- **Reglas de método fijadas en git antes de medir:**
  - `docs/metodos/zonas-crecimiento-verificacion.md` (v2.1);
  - `docs/metodos/ritmo-consolidacion-por-tipo.md` (v1.1);
  - `docs/metodos/ritmo-consolidacion-por-poligono.md` (v2, más R8).

## Compromisos con fecha

| Fecha | Qué | Dónde está el plan |
|---|---|---|
| 01/12/2026 | Corte de «Zonas de crecimiento»: regenerar la capa en `public/` con las dudosas aparte, anotar en `ACTUALIZACIONES.json`, visto bueno de SEGURIDAD y desplegar. La capa nueva espera en `salidas/crecimiento/corte-2026-12-01/`. | Sección 7 de `ORDENES-DEL-MASTER/2026-11-12-zonas-de-crecimiento.md` |
| 01/12/2026 | Rehacer el ritmo por tipo con el tipo como dato de Nuevos Desarrollos (Edith), en lugar de las pistas actuales. | `docs/metodos/ritmo-consolidacion-por-tipo.md` |
| Corte de diciembre | Revisar la regla de «dudoso» del ritmo de consolidación. Va al juez **antes** de medir. | `ORDENES-DEL-MASTER/2026-12-REVISION-REGLA-DUDOSO-PLAN.md` |
| 18/12/2026 | Vence la excepción de `npm audit` en «Verificar». No se toca sin la regla de SEGURIDAD. | `.audit-excepciones.json` (lo lee `herramientas/auditar-dependencias.mjs`) |
| Enero 2027 | OBS-17 versión 3. | `ORDENES-DEL-MASTER/juez-2026-11-18-obs17-v2/` |
| Sin fecha | Proyección de población: pendiente. | `ORDENES-DEL-MASTER/2026-11-19-indicadores-de-crecimiento-RESULTADO.md` |

### Revisión de «dudoso» (diciembre), en corto

Hoy un convenio es dudoso si más de 10 de cada 100 de sus tomas caen en celdas con techo en GHSL 2015. La marca solo
se dispara si hay tomas. Por eso la referencia sin dudosos deja fuera, sobre todo, el relleno urbano y la vivienda
vertical, y la R(24) global baja varios puntos. La propuesta es marcar por la fracción del polígono que ya era techo en
2015, la época anterior a la firma, con un umbral declarado antes de medir. El relleno iría como categoría propia, no
fuera de la referencia, y la referencia se reportaría con y sin relleno. El contraste declarado: la R(24) de vivienda
horizontal no debe moverse más de 3 puntos.

## Decisiones de Carlos que no están en otro archivo

- Cada indicador de crecimiento se muestra como **tasa anual comparable**, en el tiempo y en el espacio. Una cifra
  suelta de tomas al año «no sirve» (Carlos, 19/11). Los indicadores son tomas, techo de GHSL, convenios,
  factibilidades y autómatas, este último con su porcentaje de avance por horizonte.
- Aprobó la tasa del Censo (2010-2020) agregada por sector.
- Aprobó descargar la tabla INEGI por AGEB 2010 y GHSL BUILT-V. **BUILT-V no se usa:** su volumen usa la altura de 2018
  y no mide cambio de altura. Está en `salidas/construida/GHSL_BUILT_V/`.
- Las condiciones de cada indicador van en la ayuda «Cómo se calculó», no en el cuerpo del panel.

## Trampas que ya pisé

- **Offset doble en `sentinel-2-l2a`.** La colección vieja se lee con `desplazamiento: 0`. Aplicarle el offset declarado
  hizo parecer no comparable el año 2022. Guarda de escena: `traeMilSinRestar`. Memoria:
  `earth-search-s2-l2a-offset-doble`.
- **`make_valid` pierde superficie.** En zonas hechas de celdas perdió 30 % del área. Unir las celdas y comprobar el área
  con un assert.
- **Filtro de dudosos sesga la mediana.** La mediana de 0 % en vertical era un artefacto del filtro, no un dato.
- **Doble conteo en tablas por zona:** «por revisar» se sumaba también en su clase. Va fuera de las columnas de clase,
  con un assert.
- **Asignar por centroide de hexágono** pone desarrollos en el sector equivocado. Se recorta exacto por desarrollo.
- **Factibilidades heredando el r de un convenio chico (R8).** El assert del generador por polígono lo impide; no quitarlo.
- **Los sectores de planeación de SISPLAN cubren solo la periferia.** La pregunta de cómo sectorizar el interior de la
  ciudad es de Carlos.

## Comandos y variables

- `herramientas/pi_1b_consolidacion.py`: `PI_V1`, `PI_ENT`, `PI_CORTE` (por omisión `2026-10`).
- `herramientas/pi-1c-escenas.ts`: `ANIOS`, `NUBES`, `COLECCION=vieja`, `SUFIJO`.
- `herramientas/pi_1c_construido.py`: `USAR_2022V=1` fuerza la escena de 2022. Por omisión, 2022 usa la de 2021.
- `herramientas/ritmo_crecimiento_json.py` escribe `public/apertura/crecimiento/ritmo.json`, sin versionar.
  `crecimiento_capa.py` lo enlaza. En el corte del 01/12 no se borra.
- Despliegue y comprobación tras Access: ver `CLAUDE.md`. Sin push ni despliegue en este traspaso.
