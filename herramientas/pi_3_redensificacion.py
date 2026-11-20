"""
Planeacion Integral, apoyo al frente 3: relleno de huella en zonas consolidadas, desde GHSL R2023A (superficie
construida, 2000 y 2020, 100 m). Metodo corregido con el dictamen del juez del 19/11/2026: GHSL no mide cambio de altura
(su volumen usa la altura fija de 2018), asi que aqui no se usa BUILT-V. La redensificacion la mide Analisis de Cuentas.

- Celda consolidada: techo de 40 % o mas en 2000 (4,000 m2 de 10,000).
- Relleno de huella: techo 2020 menos techo 2000 en esas celdas (2020 extrapolado desde 2018).
- Agregado por colonia (capa de colonias de Analisis de Cuentas, por el centro de la celda).
Rotulo: «relleno de huella GHSL 2000-2020, interpolado; GHSL no mide cambio de altura».

Uso: python herramientas/pi_3_redensificacion.py
"""

import json
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
from shapely.geometry import box

sys.path.insert(0, str(Path(__file__).resolve().parent))
import crecimiento_resumen as cr  # noqa: E402

RAIZ = Path(__file__).resolve().parents[1]
APPS = cr.APPS
SAL = RAIZ / "salidas" / "planeacion-integral"
COLONIAS = APPS / "11. ANALISIS DE CUENTAS" / "public" / "data" / "capas" / "COLONIAS.geojson"
UTM = 32614
CONSOLIDADA = 4000


def main() -> None:
    SAL.mkdir(parents=True, exist_ok=True)
    mun = gpd.read_file(APPS / "0. CAPAS VARIAS" / "LIMITES_VIGENTES" / "LIMITE MUNICIPAL" / "LIMITE_MUNICIPAL.shp")
    mun_moll = (mun if mun.crs else mun.set_crs(UTM)).to_crs(cr.MOLL).union_all()
    s00, t = cr.leer(2000, mun_moll.bounds)
    s20, _ = cr.leer(2020, mun_moll.bounds)
    filas, cols = np.nonzero(s00 >= CONSOLIDADA)
    celdas = []
    for f, c in zip(filas, cols):
        x0, y0 = t * (c, f)
        x1, y1 = t * (c + 1, f + 1)
        celdas.append({"techo_2000_m2": s00[f, c], "techo_2020_m2": s20[f, c], "geometry": box(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))})
    g = gpd.GeoDataFrame(celdas, crs=cr.MOLL)
    g = g[g.geometry.centroid.within(mun_moll)].to_crs(UTM).copy()
    g["relleno_m2"] = g.techo_2020_m2 - g.techo_2000_m2

    col = gpd.read_file(COLONIAS).to_crs(UTM)[["nombre", "geometry"]]
    col["geometry"] = col.geometry.make_valid()
    centros = gpd.GeoDataFrame(geometry=g.geometry.centroid, crs=UTM)
    g["colonia"] = gpd.sjoin(centros, col, how="left", predicate="within")["nombre"].groupby(level=0).first()
    ruta = SAL / "3-redensificacion-celdas.gpkg"
    if ruta.exists():
        ruta.unlink()
    g.to_file(ruta, layer="celdas_consolidadas", driver="GPKG")

    por = g.groupby("colonia").agg(celdas=("relleno_m2", "size"), techo_2000_m2=("techo_2000_m2", "sum"), relleno_m2=("relleno_m2", "sum")).reset_index()
    por["relleno_m2_por_ha_al_anio"] = (por.relleno_m2 / por.celdas / 20).round(1)
    por = por.sort_values("relleno_m2_por_ha_al_anio", ascending=False)
    por.to_csv(SAL / "3-redensificacion-por-colonia.csv", index=False, encoding="utf-8")
    lm = por[por.colonia == "LEON MODERNO"]
    res = {
        "celdas_consolidadas": int(len(g)),
        "relleno_total_ha": round(float(g.relleno_m2.sum() / 1e4), 1),
        "celdas_con_relleno_1000m2_o_mas": int((g.relleno_m2 >= 1000).sum()),
        "leon_moderno": lm.round(1).to_dict("records"),
        "colonias_con_5_celdas_o_mas_top10": por[por.celdas >= 5].head(10)[["colonia", "celdas", "relleno_m2_por_ha_al_anio"]].to_dict("records"),
        "rotulo": "relleno de huella GHSL 2000-2020, interpolado; GHSL no mide cambio de altura (volumen con altura fija de 2018)",
    }
    (SAL / "3-resumen.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
