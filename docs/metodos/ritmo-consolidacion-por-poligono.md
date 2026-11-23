# Ritmo de consolidación por polígono activo: regla de agregación (versión 1, 23/11/2026)

**Qué:** pedido de Carlos vía MASTER (23/11). El ritmo de consolidación (alto, medio, bajo) se pinta en cualquier polígono activo de la plataforma de Cuentas y del deck: convenios, factibilidades, sectores de planeación y colonias.
- Se fija aquí, en git, **antes** de medir.
- Generador: `herramientas/pi_1b_por_poligono.py`.

**Base:** la versión 5 del ritmo de consolidación, corte oct-2026, dictaminada (`salidas/planeacion-integral/1b-por-convenio.csv`, sha 497207a2…).
- Para cada convenio: r = C(a*) / R(a*), con a* = min(24, edad) y R la referencia v5 (R(24) = 60 %).
- Cortes de la v5: baja si r < 0.556; alta si r ≥ 1.111. Equivale a 1/3 y 2/3 a los 24 meses.

**Nombres:** en plataforma y deck, «alta» se dice «ritmo alto», «media», «ritmo medio» y «baja», «ritmo bajo». La paleta del deck 2 la pone MAPAS o Cuentas, no este cálculo.

## 1. Convenio

- **Clase:** la de la v5, tal cual: alto, medio o bajo, más «por revisar», «provisional» y las de «sin clasificar» (muestra chica, muy reciente).
- **No habitacionales:** «no aplica».

## 2. Factibilidad

- **Polígonos:** las factibilidades 2021-2026 de `13. NUEVOS DESARROLLOS/salidas/planeacion-integral/desarrollos-etapas.geojson` (etapa = factibilidad), con id = orden en esa capa, más el sha de la capa.
- **Liga al convenio:** la regla de Nuevos Desarrollos. Una factibilidad y un convenio de la capa v2 se ligan si su traslape es de 50 % o más del menor de los dos polígonos.
- **Una sola liga:** la clase de ese convenio.
- **Varias ligas:** r ponderado por las unidades de los convenios ligados que tienen clase, con los mismos cortes. Si alguno de ellos está «por revisar», la factibilidad también.
- **Ligada a convenios sin clase** (muestra chica, muy reciente): «sin clasificar».
- **Sin liga:** «sin convenio».

## 3. Sector de planeación y colonia

- **Convenios que cuentan:** los habitacionales con clase calculada (alta, media o baja, incluidos los «por revisar» y los provisionales).
- **Peso:** las unidades del convenio que caen dentro del polígono (recorte exacto, reparto por superficie).
- **Valor del polígono:** r ponderado = Σ(r × unidades dentro) / Σ(unidades dentro), con los mismos cortes de la v5.
- **No se usa R(24) directo:** mezclaría convenios de edades distintas. r ya pone a cada convenio contra la referencia de su edad.
- **Mínimo, fijado ahora:** 3 convenios con clase y 100 unidades con clase dentro del polígono. Debajo va «sin clasificar (menos de 3 convenios)».
  - Un polígono con unidades convenidas pero sin convenios con clase va como «sin clasificar (sin convenios con clase)».
  - Un polígono sin convenios va como «sin convenio».
- **Marca de «por revisar»:** si más de la mitad de las unidades del peso son de convenios «por revisar», la clase lleva esa marca.

## 4. Salidas (un CSV por capa)

Cada CSV trae id del polígono, clase, r ponderado, n de convenios con clase, unidades convenidas totales dentro, unidades con clase dentro, unidades «por revisar» dentro y consolidación actual ponderada.

| Capa | Archivo | Polígonos |
|---|---|---|
| Convenio | `1b-poligono-convenio.csv` | id CONV, de la capa v2 de ND |
| Factibilidad | `1b-poligono-factibilidad.csv` | id = orden en `desarrollos-etapas.geojson` |
| Sector de planeación | `1b-poligono-sector-planeacion.csv` | `SECTORES_DE_PLANEACION.geojson` de SISPLAN, sha 8cf0977f |
| Colonia | `1b-poligono-colonia.csv` | gid de `COLONIAS.geojson` de Cuentas, sha df697016 |

## 5. Contrastes (prueba de código, declarados ahora)

- Las unidades con clase repartidas en colonias más las de fuera de colonias deben dar el total de unidades con clase de la v5. Lo mismo con los sectores de planeación.
- Cada convenio en su propia capa debe repetir la clase v5 exactamente.

## 6. Rótulos

- «Ritmo de consolidación: tomas domésticas y mixtas contratadas sobre unidades del convenio, padrón a oct-2026; la clase mide el ritmo a los 24 meses (o provisional), no el nivel de hoy; contratado no es construido».
- En colonia y sector: «clase del conjunto de convenios dentro, ponderada por unidades; mínimo 3 convenios».
- En factibilidad: «clase del convenio ligado (traslape de 50 % o más); sin convenio si no llegó a convenio».

## Versión 2 (23/11/2026): dictamen del juez (`2026-11-23-DICTAMEN-JUEZ-RITMO-POR-POLIGONO.md`). Manda sobre la versión 1

- **Cortes exactos:** (1/3) / R(24) y (2/3) / R(24), con R(24) sin redondear de `1b-curva-referencia.csv`.
- **Piezas:** las de menos de 1 unidad dentro del polígono no cuentan.
- **Marcas:** «por revisar» y «provisional» van como marcas aparte de la clase, en sector, colonia y factibilidad, cuando pesan más de la mitad de las unidades con clase.
- **Sector de planeación:**
  - clase solo con 3 convenios con clase o más y 100 unidades con clase o más;
  - además, la clase no debe cambiar al quitar cualquiera de esos convenios. Si cambia, va como «Sin clase firme: la decide un convenio».
  - Debajo de 3 convenios: «Pocos convenios (menos de 3)». Sin piezas de convenio: «Sin convenio».
- **Colonia:** clase con 100 unidades con clase dentro, con cualquier número de convenios.
  - Debajo: «Menos de 100 unidades con clase».
  - Si tiene convenios pero ninguno con clase: «Convenios aún sin clase».
  - Si no tiene convenios: «Sin convenio».
- **Factibilidad:**
  - «Ritmo alto», «medio» o «bajo» del convenio en el mismo terreno (traslape de 50 % o más);
  - «Sin clasificar: su convenio aún no tiene clase»;
  - «Sin convenio ligado a oct-2026», sin relleno de clase.
- **Convenio:**
  - «Ritmo alto», «medio» o «bajo», con las marcas «por revisar» y «provisional (menos de 24 meses)»;
  - «Sin clasificar: muestra chica» y «Sin clasificar: muy reciente»;
  - «No habitacional».
- **Ningún sector ni colonia se pinta como bajo sin su r y el convenio que más pesa:** los dos van en columnas del CSV, para el «?».
- **Nota de sector:** «r ponderado por unidades de los convenios dentro; cubre el 41 % de las unidades con clase».
