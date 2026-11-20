"""
Planeacion Integral, apoyo al frente 3: redensificacion vertical en zonas consolidadas, desde GHSL R2023A (volumen y
superficie construida, 2000 y 2020, 100 m). Metodo declarado en `ORDENES-DEL-MASTER/2026-11-19-planeacion-integral-METODO.md`.

- Celda consolidada: techo de 40 % o mas en 2000 (4,000 m2 de 10,000).
- Altura media = volumen / techo (m). Se compara 2000 contra 2020; 2020 es extrapolado desde 2018 en GHSL.
- Salidas: celdas consolidadas con su cambio de volumen, techo y altura; agregado por colonia (capa de colonias de
  Analisis de Cuentas, por el centro de la celda). Contraste: Leon Moderno, el caso que dio Carlos.

Uso: python herramientas/pi_3_redensificacion.py
"""

import json
import sys
import zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from rasterio.io import MemoryFile
from rasterio.windows import from_bounds
from shapely.geometry import box

sys.path.insert(0, str(Path(__file__).resolve().parent))
import crecimiento_resumen as cr  # noqa: E402

RAIZ = Path(__file__).resolve().parents[1]
APPS = cr.APPS
SAL = RAIZ / "salidas" / "planeacion-integral"
VOL = RAIZ / "salidas" / "construida" / "GHSL_BUILT_V"
COLONIAS = APPS / "11. ANALISIS DE CUENTAS" / "public" / "data" / "capas" / "COLONIAS.geojson"
UTM = 32614
CONSOLIDADA = 4000


def leer_v(epoca: int, bounds):
    z = VOL / f"GHS_BUILT_V_E{epoca}_GLOBE_R2023A_54009_100_V1_0_R7_C9.zip"
    with zipfile.ZipFile(z) as zf:
        datos = zf.read([n for n in zf.namelist() if n.endswith(".tif")][0])
    with MemoryFile(datos) as mem, mem.open() as r:
        w = from_bounds(*bounds, r.transform).round_offsets().round_lengths()
        a = r.read(1, window=w).astype("float64")
        if r.nodata is not None:
            a[a == r.nodata] = np.nan
        return np.nan_to_num(a), r.window_transform(w)


def main() -> None:
    SAL.mkdir(parents=True, exist_ok=True)
    mun = gpd.read_file(APPS / "0. CAPAS VARIAS" / "LIMITES_VIGENTES" / "LIMITE MUNICIPAL" / "LIMITE_MUNICIPAL.shp")
    mun_moll = (mun if mun.crs else mun.set_crs(UTM)).to_crs(cr.MOLL).union_all()
    s00, t = cr.leer(2000, mun_moll.bounds)
    s20, _ = cr.leer(2020, mun_moll.bounds)
    v00, tv = leer_v(2000, mun_moll.bounds)
    v20, _ = leer_v(2020, mun_moll.bounds)
    assert s00.shape == v00.shape and tuple(t)[:6] == tuple(tv)[:6], "rejillas de superficie y volumen no coinciden"

    filas, cols = np.nonzero(s00 >= CONSOLIDADA)
    celdas = []
    for f, c in zip(filas, cols):
        x0, y0 = t * (c, f)
        x1, y1 = t * (c + 1, f + 1)
        celdas.append({"techo_2000": s00[f, c], "techo_2020": s20[f, c], "vol_2000": v00[f, c], "vol_2020": v20[f, c],
                       "geometry": box(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))})
    g = gpd.GeoDataFrame(celdas, crs=cr.MOLL)
    g = g[g.geometry.centroid.within(mun_moll)].copy()
    g["altura_2000"] = g.vol_2000 / g.techo_2000
    g["altura_2020"] = np.where(g.techo_2020 > 0, g.vol_2020 / g.techo_2020, np.nan)
    g["delta_altura_m"] = g.altura_2020 - g.altura_2000
    g["delta_vol_m3"] = g.vol_2020 - g.vol_2000
    g["delta_techo_m2"] = g.techo_2020 - g.techo_2000
    g = g.to_crs(UTM)

    col = gpd.read_file(COLONIAS).to_crs(UTM)[["nombre", "geometry"]]
    col["geometry"] = col.geometry.make_valid()
    centros = gpd.GeoDataFrame(geometry=g.geometry.centroid, crs=UTM)
    g["colonia"] = gpd.sjoin(centros, col, how="left", predicate="within")["nombre"].groupby(level=0).first()
    g.to_file(SAL / "3-redensificacion-celdas.gpkg", layer="celdas_consolidadas", driver="GPKG")

    por = g.groupby("colonia").agg(celdas=("vol_2000", "size"), vol_2000=("vol_2000", "sum"), vol_2020=("vol_2020", "sum"),
                                   techo_2000=("techo_2000", "sum"), techo_2020=("techo_2020", "sum")).reset_index()
    por["altura_2000"] = por.vol_2000 / por.techo_2000
    por["altura_2020"] = por.vol_2020 / por.techo_2020
    por["delta_altura_m"] = por.altura_2020 - por.altura_2000
    por["delta_vol_m3_por_ha_al_anio"] = (por.vol_2020 - por.vol_2000) / por.celdas / 20
    por = por.sort_values("delta_vol_m3_por_ha_al_anio", ascending=False)
    por.round(3).to_csv(SAL / "3-redensificacion-por-colonia.csv", index=False, encoding="utf-8")

    lm = por[por.colonia == "LEON MODERNO"]
    res = {
        "celdas_consolidadas": int(len(g)),
        "altura_media_2000_2020_m": [round(float(g.vol_2000.sum() / g.techo_2000.sum()), 2), round(float(g.vol_2020.sum() / g.techo_2020.sum()), 2)],
        "celdas_que_suben_1m_o_mas": int((g.delta_altura_m >= 1).sum()),
        "leon_moderno": lm.round(3).to_dict("records"),
        "contraste_leon_moderno_sube": bool(len(lm) and lm.delta_altura_m.iloc[0] > 0),
        "top10_colonias_por_volumen_nuevo": por.head(10)[["colonia", "celdas", "delta_altura_m", "delta_vol_m3_por_ha_al_anio"]].round(2).to_dict("records"),
        "nota": "GHSL 2020 es extrapolado desde 2018; altura media = volumen / techo; celdas de 100 m",
    }
    (SAL / "3-resumen.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
