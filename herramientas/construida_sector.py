"""
Superficie construida por sector hidraulico, cortes 2000 a 2020 (OBS-08, Linea B, bloque 2).

Fuente: GHSL GHS-BUILT-S R2023A (CC BY 4.0, Centro Comun de Investigacion de la Comision Europea), superficie construida
en m2 por celda de 100 m en Mollweide (ESRI:54009), tesela R7_C9. Los cortes 2025 y 2030 son proyecciones y no entran.
Unidades: los 454 sectores vigentes de Balance (copia del 05/11/2026) y el limite urbano vigente (POTE 2020).

Se suma en la rejilla nativa: cada celda pesa por la fraccion de su area que cae dentro del sector (rasterizado fino a
10 m dentro de la celda), sin remuestrear la superficie. Metodo y cifras de contraste declarados antes de medir en
`ORDENES-DEL-MASTER/2026-11-11-lineas-A-B-R2.md`.

Uso: python herramientas/construida_sector.py
"""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
from rasterio.features import rasterize
from rasterio.io import MemoryFile
from rasterio.windows import from_bounds

RAIZ = Path(__file__).resolve().parents[1]
SALIDA = RAIZ / "salidas" / "construida"
GHSL = SALIDA / "ghsl"
SECTORES = RAIZ.parent / "2. BALANCE HÍDRICO" / "CAPAS-VIGENTES" / "2026-11-05" / "SECTORES.geojson"
URBANO = RAIZ.parent / "0. CAPAS VARIAS" / "LIMITES_VIGENTES" / "LIMITE_URBANO_POTE_2020" / "Limite_Urbano_Pote_2020.shp"
CORTES = [2000, 2005, 2010, 2015, 2020]
MOLL = "ESRI:54009"
SUB = 10  # subdivisiones por lado para la fraccion de celda (10 m)


def leer(corte: int, bounds):
    z = GHSL / f"GHS_BUILT_S_E{corte}_GLOBE_R2023A_54009_100_V1_0_R7_C9.zip"
    with zipfile.ZipFile(z) as zf:
        nombre = [n for n in zf.namelist() if n.endswith(".tif")][0]
        datos = zf.read(nombre)
    with MemoryFile(datos) as mem, mem.open() as r:
        w = from_bounds(*bounds, r.transform).round_offsets().round_lengths()
        arr = r.read(1, window=w).astype("float64")
        t = r.window_transform(w)
        nodata = r.nodata
    if nodata is not None:
        arr[arr == nodata] = np.nan
    return arr, t


def fracciones(geoms: gpd.GeoSeries, forma, transform) -> np.ndarray:
    """Para cada poligono, la fraccion de cada celda de 100 m que cae dentro (rasterizado a 10 m y agregado)."""
    alto, ancho = forma
    fino = rasterio.Affine(transform.a / SUB, 0, transform.c, 0, transform.e / SUB, transform.f)
    ids = rasterize(((g, i + 1) for i, g in enumerate(geoms)), out_shape=(alto * SUB, ancho * SUB), transform=fino,
                    dtype="int32", all_touched=False)
    return ids.reshape(alto, SUB, ancho, SUB)


def main() -> None:
    sect = gpd.read_file(SECTORES).to_crs(MOLL)
    urbano = gpd.read_file(URBANO)
    urbano = (urbano if urbano.crs else urbano.set_crs(32614)).to_crs(MOLL)
    zona = pd.concat([sect.geometry, urbano.geometry]).total_bounds
    pad = 300
    bounds = (zona[0] - pad, zona[1] - pad, zona[2] + pad, zona[3] + pad)

    unidades = list(sect["Sect"].astype(str)) + ["LIMITE_URBANO"]
    geoms = pd.concat([sect.geometry, gpd.GeoSeries([urbano.union_all()], crs=MOLL)], ignore_index=True)
    filas = {u: {"unidad": u} for u in unidades}
    # Sectores (no se traslapan) en un rasterizado, y el limite urbano en otro.
    ref, t = leer(CORTES[-1], bounds)
    finos_sect = fracciones(sect.geometry.reset_index(drop=True), ref.shape, t)
    finos_urb = fracciones(gpd.GeoSeries([urbano.union_all()], crs=MOLL), ref.shape, t)
    area_celda = abs(t.a * t.e)
    for corte in CORTES:
        arr, t2 = leer(corte, bounds)
        assert arr.shape == ref.shape and t2 == t
        arr = np.nan_to_num(arr)
        for finos, nombres in ((finos_sect, list(sect["Sect"].astype(str))), (finos_urb, ["LIMITE_URBANO"])):
            for k, nombre in enumerate(nombres, start=1):
                frac = (finos == k).mean(axis=(1, 3))
                filas[nombre][f"construido_ha_{corte}"] = round(float((arr * frac).sum()) / 1e4, 2)
                if corte == CORTES[-1]:
                    filas[nombre]["area_ha"] = round(float(frac.sum()) * area_celda / 1e4, 2)
                    filas[nombre]["celdas_equivalentes"] = round(float(frac.sum()), 1)
    tabla = pd.DataFrame(filas.values())
    for corte in CORTES:
        tabla[f"fraccion_{corte}"] = (tabla[f"construido_ha_{corte}"] / tabla["area_ha"]).round(4)
    tabla["cambio_ha_2015_2020"] = (tabla["construido_ha_2020"] - tabla["construido_ha_2015"]).round(2)
    tabla["cambio_ha_2000_2020"] = (tabla["construido_ha_2020"] - tabla["construido_ha_2000"]).round(2)
    tabla["sector_chico"] = tabla["area_ha"] < 10
    SALIDA.mkdir(parents=True, exist_ok=True)
    tabla.to_csv(SALIDA / "construida-por-sector.csv", index=False, encoding="utf-8-sig")

    # Contrastes declarados.
    urb = tabla[tabla["unidad"] == "LIMITE_URBANO"].iloc[0]
    sec = tabla[tabla["unidad"] != "LIMITE_URBANO"]
    worldcover_ha = 15924
    bajas = {}
    for a, b in zip(CORTES[:-1], CORTES[1:]):
        d = sec[f"construido_ha_{b}"] - sec[f"construido_ha_{a}"]
        bajas[f"{a}-{b}"] = {"sectores_que_bajan": int((d < 0).sum()), "de_cada_100": round(100 * float((d < 0).mean()), 1),
                             "mayor_baja_ha": round(float(d.min()), 2)}
    contraste = {
        "urbano_ha_por_corte": {c: urb[f"construido_ha_{c}"] for c in CORTES},
        "urbano_area_ha": urb["area_ha"],
        "cociente_ghsl_worldcover_2020": round(urb["construido_ha_2020"] / worldcover_ha, 3),
        "crecimiento_2000_2020_pct": round(100 * (urb["construido_ha_2020"] / urb["construido_ha_2000"] - 1), 1),
        "urbano_monotono": bool(all(urb[f"construido_ha_{b}"] >= urb[f"construido_ha_{a}"] for a, b in zip(CORTES[:-1], CORTES[1:]))),
        "bajas_por_sector": bajas,
        "sectores": int(len(sec)),
        "sectores_chicos": int(sec["sector_chico"].sum()),
        "suma_sectores_2020_ha": round(float(sec["construido_ha_2020"].sum()), 1),
        "area_sectores_ha": round(float(sec["area_ha"].sum()), 1),
    }
    (SALIDA / "construida-contraste.json").write_text(json.dumps(contraste, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(contraste, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
