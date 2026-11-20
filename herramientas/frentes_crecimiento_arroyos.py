"""
Frentes de crecimiento por sector para el frente 5 de Planeacion Integral (recorridos por arroyo; pedido de Arroyos 4.1
del 19/11/2026). Uso interno: no se publica ni entra al repositorio.

Deja `salidas/arroyos/frentes-crecimiento.gpkg` (EPSG:32614) con tres capas:
  - `ghsl_celdas_2000_2020`: celdas GHSL R2023A de 100 m que ganaron 1,000 m2 de techo o mas entre 2000 y 2020. Campos:
    clase (expansion: menos de 20 % de techo en 2000; densificacion: 20 % o mas), quinquenio de mayor ganancia (epocas
    interpoladas: solo indicativo), m2 ganados, sector (por el centro de la celda).
  - `zonas_cambio_2025_2026`: zonas de cambio sep-2025 a sep-2026 con su revision a ojo (si = confirmada; dudoso; sin
    revisar), union de celdas, ha y sector de mayor traslape. Las descartadas no van. La cifra de hectareas sigue retenida
    para la app hasta el corte del 01/12: aqui solo sirve para ordenar recorridos.
  - `sectores`: los 454 sectores con altas de tomas domesticas al año 2017-2025 y si son frente nuevo (menos de 500 tomas
    al 31/12/2016), de `salidas/indicadores/tomas-por-sector.csv` (dictamen del juez del 19/11). Solo conteos.

Uso: python herramientas/frentes_crecimiento_arroyos.py
"""

import hashlib
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import box

sys.path.insert(0, str(Path(__file__).resolve().parent))
import crecimiento_resumen as cr  # noqa: E402

RAIZ = Path(__file__).resolve().parents[1]
APPS = cr.APPS
SAL = RAIZ / "salidas" / "arroyos"
UTM = 32614
EPOCAS = [2000, 2005, 2010, 2015, 2020]


def main() -> None:
    SAL.mkdir(parents=True, exist_ok=True)
    sec = gpd.read_file(APPS / "2. BALANCE HÍDRICO" / "CAPAS-VIGENTES" / "2026-11-05" / "SECTORES.geojson").to_crs(UTM)
    sec = sec.rename(columns={"Sect": "sector"})[["sector", "geometry"]]
    sec["geometry"] = sec.geometry.make_valid()
    mun = gpd.read_file(APPS / "0. CAPAS VARIAS" / "LIMITES_VIGENTES" / "LIMITE MUNICIPAL" / "LIMITE_MUNICIPAL.shp")
    mun_moll = (mun if mun.crs else mun.set_crs(UTM)).to_crs(cr.MOLL).union_all()

    capas = {}
    for e in EPOCAS:
        capas[e], t = cr.leer(e, mun_moll.bounds)
    g00, g20 = capas[2000], capas[2020]
    crecio = (g20 - g00) >= 1000
    filas, cols = np.nonzero(crecio)
    ganancias = np.stack([capas[b] - capas[a] for a, b in zip(EPOCAS[:-1], EPOCAS[1:])])
    celdas = []
    for f, c in zip(filas, cols):
        x0, y0 = t * (c, f)
        x1, y1 = t * (c + 1, f + 1)
        q = int(np.argmax(ganancias[:, f, c]))
        celdas.append({
            "clase": "expansion" if g00[f, c] / 1e4 < 0.2 else "densificacion",
            "quinquenio_mayor_ganancia": f"{EPOCAS[q]}-{EPOCAS[q + 1]}",
            "m2_ganados_2000_2020": float(g20[f, c] - g00[f, c]),
            "geometry": box(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)),
        })
    cel = gpd.GeoDataFrame(celdas, crs=cr.MOLL)
    cel = cel[cel.geometry.centroid.within(mun_moll)].to_crs(UTM)
    centros = gpd.GeoDataFrame(geometry=cel.geometry.centroid, crs=UTM)
    cel["sector"] = gpd.sjoin(centros, sec, how="left", predicate="within")["sector"].groupby(level=0).first().fillna("fuera_de_sectores")
    cel.to_file(SAL / "frentes-crecimiento.gpkg", layer="ghsl_celdas_2000_2020", driver="GPKG")

    cand = gpd.read_file(RAIZ / "salidas" / "crecimiento" / "candidatas-2025-2026.geojson")
    rev = pd.read_csv(RAIZ / "salidas" / "crecimiento" / "revision-zonas.csv").set_index("id")
    cand["revision"] = cand["id"].map(rev["es_cambio_real"]).fillna("sin revisar")
    cand = cand[cand["revision"] != "no"].to_crs(UTM)
    # Union de celdas: make_valid pierde area en estas zonas (dictamen del juez del 19/11).
    cand["geometry"] = [gpd.GeoSeries(list(g.geoms), crs=UTM).union_all() for g in cand.geometry]
    cand["ha"] = cand.area / 1e4
    x = gpd.overlay(cand[["id", "geometry"]], sec, how="intersection", keep_geom_type=True)
    x["a"] = x.area
    mayor = x.sort_values("a").groupby("id")["sector"].last()
    cand["sector"] = cand["id"].map(mayor).fillna("fuera_de_sectores")
    cand["periodo"] = "2025-09-20 a 2026-09-22"
    cand[["id", "revision", "periodo", "ha", "sector", "geometry"]].to_file(SAL / "frentes-crecimiento.gpkg", layer="zonas_cambio_2025_2026", driver="GPKG")

    tom = pd.read_csv(RAIZ / "salidas" / "indicadores" / "tomas-por-sector.csv")
    s = sec.merge(tom[["sector", "altas_al_anio_2017_2025", "frente_nuevo", "tasa_compuesta_2017_2025"]], on="sector", how="left")
    s.to_file(SAL / "frentes-crecimiento.gpkg", layer="sectores", driver="GPKG")

    sha = hashlib.sha256((SAL / "frentes-crecimiento.gpkg").read_bytes()).hexdigest()
    print(f"celdas {len(cel)}, zonas {len(cand)} ({(cand.revision == 'si').sum()} confirmadas), sectores {len(s)}; sha256 {sha}")


if __name__ == "__main__":
    main()
