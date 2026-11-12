"""
Capa «Zonas de crecimiento» para la plataforma (orden del MASTER del 12/11/2026, pedido de Carlos para el 20/11).

Junta, en una imagen en grados con su leyenda, en `public/apertura/crecimiento/` (no versionado; tras Access):
  1. Crecimiento de largo plazo 2000-2020 de GHSL R2023A por celda de 100 m: expansion (menos de 20 % construido en
     2000) o consolidacion (20 % o mas), si la superficie construida subio 1 000 m2 o mas.
  2. Zonas candidatas de cambio de cobertura 20/09/2025 a 22/09/2026 (`herramientas/crecimiento-reciente.ts`), con su
     revision a ojo si ya existe (`salidas/crecimiento/revision-zonas.csv`).
  3. Factibilidades nuevas de Nuevos Desarrollos, solo contorno (ubicacion de predios: no sale de Access).
  4. Autómatas celulares, cuando lleguen.
Metodo declarado antes de medir en la seccion 0 de `ORDENES-DEL-MASTER/2026-11-12-zonas-de-crecimiento.md`.

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

RAIZ = Path(__file__).resolve().parents[1]
SALIDA = RAIZ / "salidas" / "crecimiento"
DESTINO = RAIZ / "public" / "apertura" / "crecimiento"
GHSL = RAIZ / "salidas" / "construida" / "ghsl"
FACTIBILIDADES = RAIZ.parent / "13. NUEVOS DESARROLLOS" / "salidas" / "observatorio" / "factibilidades.geojson"
MARGEN = 0.03
ANCHO = 2000
UMBRAL_M2 = 1000
CONSOLIDADO = 0.2

EXPANSION = (232, 140, 60, 210)
CONSOLIDACION = (176, 88, 52, 120)
CANDIDATA = (255, 214, 10, 255)
DESCARTADA = (150, 150, 150, 200)
FACTIBILIDAD = (255, 255, 255, 255)
AUTOMATA_CORTO = (90, 160, 230, 150)
AUTOMATA_LARGO = (90, 160, 230, 70)
CONVENIO = (120, 220, 220, 255)
APPS = RAIZ.parent


def ghsl(corte: int, t, forma) -> np.ndarray:
    z = GHSL / f"GHS_BUILT_S_E{corte}_GLOBE_R2023A_54009_100_V1_0_R7_C9.zip"
    with zipfile.ZipFile(z) as zf:
        datos = zf.read([n for n in zf.namelist() if n.endswith(".tif")][0])
    destino = np.zeros(forma, "float32")
    with MemoryFile(datos) as mem, mem.open() as r:
        reproject(rasterio.band(r, 1), destino, dst_transform=t, dst_crs=4326, resampling=Resampling.nearest)
    return destino


def main() -> None:
    urbano = gpd.read_file(RAIZ / "public" / "capas" / "LIMITE_URBANO.geojson").to_crs(4326)
    municipio = gpd.read_file(RAIZ / "public" / "capas" / "LIMITE.geojson").to_crs(4326)
    x0, y0, x1, y1 = urbano.total_bounds
    x0, y0, x1, y1 = x0 - MARGEN, y0 - MARGEN, x1 + MARGEN, y1 + MARGEN
    alto = int(ANCHO * (y1 - y0) / (x1 - x0) / np.cos(np.radians((y0 + y1) / 2)))
    t = from_bounds(x0, y0, x1, y1, ANCHO, alto)
    forma = (alto, ANCHO)
    dentro = rasterize([(municipio.union_all(), 1)], out_shape=forma, transform=t, dtype="uint8").astype(bool)

    g00, g20 = ghsl(2000, t, forma), ghsl(2020, t, forma)
    crecio = (g20 - g00 >= UMBRAL_M2) & dentro
    expansion = crecio & (g00 / 1e4 < CONSOLIDADO)
    consolidacion = crecio & ~expansion

    rgba = np.zeros((alto, ANCHO, 4), np.uint8)
    rgba[consolidacion] = CONSOLIDACION
    rgba[expansion] = EXPANSION

    auto = gpd.read_file(APPS / "0. CAPAS VARIAS" / "AUTOMATAS_CELULARES" / "COMBINADO.shp").to_crs(4326)
    auto["geometry"] = auto.make_valid()
    for sel, color in ((auto["year"] >= 2035, AUTOMATA_LARGO), (auto["year"] <= 2030, AUTOMATA_CORTO)):
        g = auto[sel]
        if len(g):
            m = rasterize(g.geometry, out_shape=forma, transform=t, all_touched=True).astype(bool)
            fondo = rgba[..., 3] == 0
            rgba[m & fondo] = color
    conv = gpd.read_file(APPS / "0. CAPAS VARIAS" / "FACTIBILIDADES_CONVENIOS.geojson")[["anio", "geometry"]]
    conv = conv[conv["anio"] >= 2025].to_crs(4326)
    if len(conv):
        m = rasterize(conv.boundary.buffer(0.00008), out_shape=forma, transform=t, all_touched=True).astype(bool)
        rgba[m] = CONVENIO
    cand = gpd.read_file(SALIDA / "candidatas-2025-2026.geojson")
    rev = SALIDA / "revision-zonas.csv"
    if rev.exists():
        r = pd.read_csv(rev).set_index("id")
        cand["revision"] = cand["id"].map(r["es_cambio_real"]).fillna("sin revisar")
    else:
        cand["revision"] = "sin revisar"
    descartadas = cand[cand["revision"] == "no"]
    vigentes = cand[cand["revision"] != "no"]
    for capa, color in ((descartadas, DESCARTADA), (vigentes, CANDIDATA)):
        if len(capa):
            m = rasterize(capa.geometry, out_shape=forma, transform=t, all_touched=True).astype(bool)
            rgba[m] = color

    fact = gpd.read_file(FACTIBILIDADES).to_crs(4326) if FACTIBILIDADES.exists() else None
    if fact is not None and len(fact):
        bordes = fact.boundary.buffer(0.00012)
        m = rasterize(bordes, out_shape=forma, transform=t, all_touched=True).astype(bool)
        rgba[m] = FACTIBILIDAD
    DESTINO.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(DESTINO / "capa.png", optimize=True)

    hex_ = lambda c: "#%02x%02x%02x" % c[:3]  # noqa: E731
    n_rev = int((cand["revision"] != "sin revisar").sum())
    n_conf = int((cand["revision"] == "si").sum())
    n_desc = int((cand["revision"] == "no").sum())
    leyenda = [
        {"color": hex_(CANDIDATA), "etiqueta": "Zona candidata de cambio, sep-2025 a sep-2026"},
        {"color": hex_(EXPANSION), "etiqueta": "Crecimiento 2000-2020: expansión"},
        {"color": hex_(CONSOLIDACION), "etiqueta": "Crecimiento 2000-2020: consolidación"},
        {"color": hex_(FACTIBILIDAD), "etiqueta": f"Factibilidad nueva ({len(fact) if fact is not None else 0}, contorno)"},
        {"color": hex_(CONVENIO), "etiqueta": f"Convenio 2025-2026 ({len(conv)}, contorno)"},
        {"color": hex_(AUTOMATA_CORTO), "etiqueta": "Autómata celular: crecimiento previsto 2025-2030"},
        {"color": "#a9c9ec", "etiqueta": "Autómata celular: 2035-2050"},
    ]
    if n_desc:
        leyenda.insert(1, {"color": hex_(DESCARTADA), "etiqueta": "Candidata descartada en la revisión"})
    proy = json.loads((RAIZ.parent / "11. ANALISIS DE CUENTAS" / "public" / "data" / "proyeccion-municipal.json").read_text(encoding="utf-8"))
    p = proy["poblacion"]
    tasa_25_30 = (p["2030"] / p["2025"]) ** (1 / 5) - 1
    tasa_30_50 = (p["2050"] / p["2030"]) ** (1 / 20) - 1
    notas = [
        "Zonas candidatas de cambio de cobertura (pérdida de vegetación o aumento de firma construida) entre 20/09/2025 y 22/09/2026, misma fase de lluvias. No es obra confirmada ni superficie urbanizada.",
        f"Revisión a ojo en imagen de alta resolución: {n_rev} de {len(cand)} zonas revisadas, {n_conf} confirmadas y {n_desc} descartadas." if n_rev else f"{len(cand)} zonas candidatas, en revisión a ojo en imagen de alta resolución.",
        "Crecimiento 2000-2020: superficie construida (techos, sin calles), modelo GHSL R2023A (Centro Común de Investigación de la CE, CC BY 4.0). 2000 es época observada con Landsat; 2020 es modelada a partir de Sentinel-2 2018. Una celda de 100 m creció si subió 1 000 m² o más; es expansión si en 2000 tenía menos de 20 % construido.",
        f"Factibilidades nuevas: {len(fact) if fact is not None else 0} lotes del 30/09 al 21/10/2026 (Nuevos Desarrollos), solo contorno. Son solicitudes posteriores a las imágenes: todavía no se ven construidas.",
        f"Referencia, sin recalcular: Análisis de Cuentas proyecta para el municipio {tasa_25_30 * 100:.1f} % de crecimiento de población al año de 2025 a 2030 y {tasa_30_50 * 100:.1f} % de 2030 a 2050 ({proy['fuente']}).",
        "Autómatas celulares: modelo de crecimiento de SAPAL (2025), horizontes de 2025 a 2050; año base supuesto 2025. Convenios: desarrollos con factibilidad convenida de 2025 y 2026, solo contorno.",
        "La concordancia entre el crecimiento observado, las factibilidades, los convenios y el autómata está en revisión del juez; sus cifras no se muestran todavía.",
    ]
    datos = {"producto": "zonas-crecimiento", "limites": [[float(y0), float(x0)], [float(y1), float(x1)]], "leyenda": leyenda,
             "notas": notas, "generado": datetime.now(timezone.utc).isoformat()}
    (DESTINO / "capa.json").write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({"celdas_expansion": int(expansion.sum()), "celdas_consolidacion": int(consolidacion.sum()),
                      "candidatas": len(cand), "factibilidades": 0 if fact is None else len(fact),
                      "tasa_25_30": round(tasa_25_30 * 100, 2), "tasa_30_50": round(tasa_30_50 * 100, 2)}, indent=1))


if __name__ == "__main__":
    main()
