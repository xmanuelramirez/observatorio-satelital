"""
Capa «Zonas de crecimiento» para la plataforma (orden del MASTER del 12/11/2026, pedido de Carlos para el 20/11).

Deja en `public/apertura/crecimiento/` (no versionado; tras Access) una imagen en grados por grupo de capas, que la
plataforma prende y apaga y encima en el navegador:
  1. `observado.png`: crecimiento 2000-2020 de GHSL R2023A por celda de 100 m: expansion (menos de 20 % construido en
     2000) o consolidacion (20 % o mas), si la superficie construida subio 1 000 m2 o mas; limpio y con borde suavizado.
  2. `automata-<año>.png`: autómatas celulares de SAPAL hasta cada horizonte (2025 a 2050), un color por horizonte.
  3. `reciente.png`: zonas candidatas de cambio de cobertura 20/09/2025 a 22/09/2026 (`herramientas/crecimiento-reciente.ts`)
     que no se descartaron en la revision a ojo (`salidas/crecimiento/revision-zonas.csv`).
  4. `tramites.png`: factibilidades nuevas de Nuevos Desarrollos y convenios 2025-2026, solo contorno (ubicacion de
     predios: no sale de Access).
`capa.png` junta todo a 2050, de respaldo. Metodo declarado antes de medir en las secciones 0 y 5 de
`ORDENES-DEL-MASTER/2026-11-12-zonas-de-crecimiento.md`.

Uso: python herramientas/crecimiento_capa.py
"""

from __future__ import annotations

import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.io import MemoryFile
from rasterio.transform import from_bounds
from rasterio.warp import reproject
from scipy import ndimage

RAIZ = Path(__file__).resolve().parents[1]
SALIDA = RAIZ / "salidas" / "crecimiento"
DESTINO = RAIZ / "public" / "apertura" / "crecimiento"
GHSL = RAIZ / "salidas" / "construida" / "ghsl"
FACTIBILIDADES = RAIZ.parent / "13. NUEVOS DESARROLLOS" / "salidas" / "observatorio" / "factibilidades.geojson"
APPS = RAIZ.parent
MARGEN = 0.03
# Unos 10 m por pixel: el borde suavizado de GHSL y los poligonos del automata se ven limpios, sin escalones de 100 m.
ANCHO = 3000
UMBRAL_M2 = 1000
CONSOLIDADO = 0.2
# Limpieza de GHSL (seccion 5 de la orden): manchas de menos de 3 ha fuera, huecos de menos de 2 ha rellenos, y borde
# suavizado con una gaussiana de 45 m y umbral 0.5. No agrega resolucion de origen: GHSL es de 100 m.
MANCHA_MINIMA_HA = 3
# La consolidacion es por naturaleza celdas sueltas dentro de la ciudad: con 3 ha se perdia el 80 %. Se queda toda celda.
MANCHA_MINIMA_CONSOLIDACION_HA = 0.9
HUECO_MAXIMO_HA = 2
SIGMA_M = 45
# Una celda suelta de consolidacion con 45 m se encoge a la mitad; con 30 m conserva cerca del 80 % de su area.
SIGMA_CONSOLIDACION_M = 30

# Lo observado, en tonos palidos (ya paso); el automata, en colores vivos (lo previsto).
EXPANSION = (241, 220, 176, 175)
CONSOLIDACION = (166, 118, 82, 200)
CANDIDATA = (255, 214, 10, 255)
FACTIBILIDAD = (255, 255, 255, 255)
CONVENIO = (120, 220, 220, 255)
# Un color contrastante por horizonte, validado contra daltonismo sobre fondo oscuro (dataviz, 12/11/2026).
HORIZONTES = {2025: (213, 81, 129), 2030: (57, 135, 229), 2035: (201, 133, 0), 2040: (25, 158, 112), 2045: (144, 133, 233),
              2050: (230, 103, 103)}
ALFA_AUTOMATA = 225


def ghsl(corte: int, t, forma) -> np.ndarray:
    z = GHSL / f"GHS_BUILT_S_E{corte}_GLOBE_R2023A_54009_100_V1_0_R7_C9.zip"
    with zipfile.ZipFile(z) as zf:
        datos = zf.read([n for n in zf.namelist() if n.endswith(".tif")][0])
    destino = np.zeros(forma, "float32")
    with MemoryFile(datos) as mem, mem.open() as r:
        reproject(rasterio.band(r, 1), destino, dst_transform=t, dst_crs=4326, resampling=Resampling.nearest)
    return destino


def limpiar(mascara: np.ndarray, ha_pixel: float, sigma_px: float, minima_ha: float) -> np.ndarray:
    """Quita manchas chicas, rellena huecos chicos y suaviza el borde."""
    etiquetas, n = ndimage.label(mascara, structure=np.ones((3, 3)))
    if n:
        tam = ndimage.sum(mascara, etiquetas, index=np.arange(1, n + 1)) * ha_pixel
        mascara = np.isin(etiquetas, np.flatnonzero(tam >= minima_ha) + 1)
    huecos, n = ndimage.label(~mascara)
    if n:
        tam = ndimage.sum(~mascara, huecos, index=np.arange(1, n + 1)) * ha_pixel
        mascara = mascara | np.isin(huecos, np.flatnonzero(tam < HUECO_MAXIMO_HA) + 1)
    return ndimage.gaussian_filter(mascara.astype("float32"), sigma_px) >= 0.5


def guardar(rgba: np.ndarray, nombre: str) -> None:
    Image.fromarray(rgba, "RGBA").save(DESTINO / nombre, optimize=True)


def main() -> None:
    urbano = gpd.read_file(RAIZ / "public" / "capas" / "LIMITE_URBANO.geojson").to_crs(4326)
    municipio = gpd.read_file(RAIZ / "public" / "capas" / "LIMITE.geojson").to_crs(4326)
    x0, y0, x1, y1 = urbano.total_bounds
    x0, y0, x1, y1 = x0 - MARGEN, y0 - MARGEN, x1 + MARGEN, y1 + MARGEN
    alto = int(ANCHO * (y1 - y0) / (x1 - x0) / np.cos(np.radians((y0 + y1) / 2)))
    t = from_bounds(x0, y0, x1, y1, ANCHO, alto)
    forma = (alto, ANCHO)
    m_px = (x1 - x0) / ANCHO * 111_320 * np.cos(np.radians((y0 + y1) / 2))
    ha_pixel = m_px * m_px / 1e4
    dentro = rasterize([(municipio.union_all(), 1)], out_shape=forma, transform=t, dtype="uint8").astype(bool)

    # 1. Crecimiento observado 2000-2020, limpio.
    g00, g20 = ghsl(2000, t, forma), ghsl(2020, t, forma)
    crecio = (g20 - g00 >= UMBRAL_M2) & dentro
    consolidacion = limpiar(crecio & (g00 / 1e4 >= CONSOLIDADO), ha_pixel, SIGMA_CONSOLIDACION_M / m_px, MANCHA_MINIMA_CONSOLIDACION_HA) & dentro
    expansion = limpiar(crecio & (g00 / 1e4 < CONSOLIDADO), ha_pixel, SIGMA_M / m_px, MANCHA_MINIMA_HA) & dentro & ~consolidacion
    observado = np.zeros((alto, ANCHO, 4), np.uint8)
    observado[expansion] = EXPANSION
    observado[consolidacion] = CONSOLIDACION

    # 2. Automata por horizonte.
    auto = gpd.read_file(APPS / "0. CAPAS VARIAS" / "AUTOMATAS_CELULARES" / "COMBINADO.shp").to_crs(4326)
    auto["geometry"] = auto.make_valid()
    # COMBINADO trae las seis capas crecimiento_2025 a crecimiento_2050 tal cual (campo `layer`); crecimiento_2030a no entra:
    # no es horizonte, es subconjunto de 2030 (dictamen del juez, 12/11/2026). El campo `year` no dice si es inicio o fin
    # del periodo: en pantalla va como «horizonte del modelo», con el ano base supuesto.
    # Cada poligono es lo que el automata suma en su horizonte (los horizontes casi no se traslapan: 16 ha de 4 915). Una
    # celda queda con el primer horizonte que la toca.
    assert set(auto["layer"]) == {f"crecimiento_{h}" for h in HORIZONTES}
    horizonte = np.zeros(forma, np.int32)
    for anio in sorted(HORIZONTES):
        g = auto[auto["year"] == anio]
        if len(g):
            m = rasterize(g.geometry, out_shape=forma, transform=t).astype(bool)
            horizonte[m & (horizonte == 0)] = anio

    # 3. Cambio reciente: solo las zonas candidatas vigentes (las descartadas en la revision ya no se pintan).
    cand = gpd.read_file(SALIDA / "candidatas-2025-2026.geojson")
    rev = SALIDA / "revision-zonas.csv"
    if rev.exists():
        r = pd.read_csv(rev).set_index("id")
        cand["revision"] = cand["id"].map(r["es_cambio_real"]).fillna("sin revisar")
    else:
        cand["revision"] = "sin revisar"
    vigentes = cand[cand["revision"] != "no"]
    reciente = np.zeros((alto, ANCHO, 4), np.uint8)
    if len(vigentes):
        reciente[rasterize(vigentes.geometry, out_shape=forma, transform=t, all_touched=True).astype(bool)] = CANDIDATA

    # 4. Factibilidades nuevas y convenios 2025-2026, solo contorno (ancho en metros, en EPSG:32614).
    conv = gpd.read_file(APPS / "0. CAPAS VARIAS" / "FACTIBILIDADES_CONVENIOS.geojson")[["anio", "geometry"]]
    conv = conv[conv["anio"] >= 2025].to_crs(32614)
    fact = gpd.read_file(FACTIBILIDADES).to_crs(32614) if FACTIBILIDADES.exists() else None
    tramites = np.zeros((alto, ANCHO, 4), np.uint8)
    if len(conv):
        bordes = conv.boundary.buffer(9).to_crs(4326)
        tramites[rasterize(bordes, out_shape=forma, transform=t, all_touched=True).astype(bool)] = CONVENIO
    if fact is not None and len(fact):
        bordes = fact.boundary.buffer(12).to_crs(4326)
        tramites[rasterize(bordes, out_shape=forma, transform=t, all_touched=True).astype(bool)] = FACTIBILIDAD

    DESTINO.mkdir(parents=True, exist_ok=True)
    for viejo in [*DESTINO.glob("capa-*.png"), *DESTINO.glob("automata-*.png")]:
        viejo.unlink()
    guardar(observado, "observado.png")
    guardar(reciente, "reciente.png")
    guardar(tramites, "tramites.png")
    pasos = sorted(HORIZONTES)
    for anio in pasos:
        rgba = np.zeros((alto, ANCHO, 4), np.uint8)
        for h in pasos:
            if h <= anio:
                rgba[horizonte == h] = (*HORIZONTES[h], ALFA_AUTOMATA)
        guardar(rgba, f"automata-{anio}.png")
    # Imagen completa de respaldo (todo prendido, a 2050), para quien lea solo `capa.png`.
    todo = observado.copy()
    for capa in (np.array(Image.open(DESTINO / f"automata-{max(pasos)}.png")), reciente, tramites):
        tapa = capa[..., 3] > 0
        todo[tapa] = capa[tapa]
    guardar(todo, "capa.png")

    hex_ = lambda c: "#%02x%02x%02x" % c[:3]  # noqa: E731
    n_rev = int((cand["revision"] != "sin revisar").sum())
    n_conf = int((cand["revision"] == "si").sum())
    n_desc = int((cand["revision"] == "no").sum())
    n_fact = 0 if fact is None else len(fact)
    grupos = [
        {"id": "observado", "etiqueta": "Observado 2000-2020", "visible": True, "imagen": "observado.png",
         "leyenda": [{"color": hex_(EXPANSION), "etiqueta": "Observado 2000-2020: expansión"},
                     {"color": hex_(CONSOLIDACION), "etiqueta": "Observado 2000-2020: consolidación"}]},
        {"id": "automata", "etiqueta": "Autómata", "visible": True, "pasos": True, "leyenda": []},
        {"id": "reciente", "etiqueta": "Cambio reciente", "visible": False, "imagen": "reciente.png",
         "leyenda": [{"color": hex_(CANDIDATA), "etiqueta": "Zona candidata de cambio, sep-2025 a sep-2026"}]},
        {"id": "tramites", "etiqueta": "Factibilidades y convenios", "visible": False, "imagen": "tramites.png",
         "leyenda": [{"color": hex_(FACTIBILIDAD), "etiqueta": f"Factibilidad nueva ({n_fact}, contorno)"},
                     {"color": hex_(CONVENIO), "etiqueta": f"Convenio 2025-2026 ({len(conv)}, contorno)"}]},
    ]
    proy = json.loads((APPS / "11. ANALISIS DE CUENTAS" / "public" / "data" / "proyeccion-municipal.json").read_text(encoding="utf-8"))
    p = proy["poblacion"]
    tasa_25_30 = (p["2030"] / p["2025"]) ** (1 / 5) - 1
    tasa_30_50 = (p["2050"] / p["2030"]) ** (1 / 20) - 1
    revision = (f"Revisión a ojo: {n_rev} de {len(cand)} zonas revisadas ({n_conf} confirmadas y {n_desc} descartadas, que ya "
                "no se pintan); se muestran solo como mapa, sin superficie.") if n_rev else f"{len(cand)} zonas candidatas, en revisión a ojo."
    notas = [
        "Los botones de arriba prenden y apagan cada grupo de capas; de inicio se ven lo observado 2000-2020 y el autómata.",
        "Observado 2000-2020: superficie construida (techos, sin calles), modelo GHSL R2023A (Centro Común de Investigación de la CE, CC BY 4.0). 2000 es época observada con Landsat; 2020 es modelada a partir de Sentinel-2 2018. Una celda de 100 m creció si subió 1 000 m² o más; es expansión si en 2000 tenía menos de 20 % construido. Para leerla limpia se quitan manchas de expansión de menos de 3 ha y huecos de menos de 2 ha, y el borde se suaviza; la resolución de origen sigue siendo de 100 m.",
        "Autómatas celulares: modelo de crecimiento de SAPAL (2025), horizontes de 2025 a 2050; año base supuesto 2025. Los años son horizontes del modelo, no fechas ciertas. Cada horizonte tiene su color y se suma a los anteriores.",
        "Cambio reciente: zonas candidatas de cambio de cobertura (pérdida de vegetación o aumento de firma construida) entre 20/09/2025 y 22/09/2026, misma fase de lluvias. No es obra confirmada ni superficie urbanizada. " + revision,
        f"Factibilidades nuevas: {n_fact} lotes del 30/09 al 21/10/2026 (Nuevos Desarrollos), solo contorno; son solicitudes posteriores a las imágenes. Convenios: desarrollos con factibilidad convenida de 2025 y 2026, solo contorno.",
        f"Referencia, sin recalcular: Análisis de Cuentas proyecta para el municipio {tasa_25_30 * 100:.1f} % de crecimiento de población al año de 2025 a 2030 y {tasa_30_50 * 100:.1f} % de 2030 a 2050 ({proy['fuente']}).",
        "La concordancia entre el crecimiento observado, las factibilidades, los convenios y el autómata está en revisión del juez; sus cifras no se muestran todavía.",
    ]

    def leyenda_automata(anio: int) -> list[dict]:
        return [{"color": hex_(HORIZONTES[h]), "etiqueta": f"Autómata, horizonte {h}"} for h in pasos if h <= anio]

    leyenda_todo = [e for g in grupos for e in g["leyenda"]] + leyenda_automata(max(pasos))
    datos = {"producto": "zonas-crecimiento", "limites": [[float(y0), float(x0)], [float(y1), float(x1)]],
             "leyenda": leyenda_todo, "notas": notas, "generado": datetime.now(timezone.utc).isoformat(),
             "grupos": grupos,
             "pasos": {"rotulo": "Horizonte del autómata", "nota": "Horizontes del modelo; año base supuesto 2025",
                       "inicial": max(pasos),
                       "lista": [{"etiqueta": str(a), "imagen": f"automata-{a}.png", "leyenda": leyenda_automata(a)} for a in pasos]}}
    # El tablero por quinquenio (`crecimiento_resumen.py --publicar`) solo se enlaza si ya se publico con dictamen.
    if (DESTINO / "resumen.json").exists():
        datos["resumen"] = "resumen.json"
    (DESTINO / "capa.json").write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({"pixel_m": round(m_px, 1), "ha_expansion": round(float(expansion.sum()) * ha_pixel),
                      "ha_consolidacion": round(float(consolidacion.sum()) * ha_pixel),
                      "candidatas_vigentes": len(vigentes), "factibilidades": n_fact}, indent=1))


if __name__ == "__main__":
    main()
