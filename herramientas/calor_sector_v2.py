"""
Islas de calor, segunda version (OBS-17): urbano contra rural y anomalia por sector controlada por cobertura.

Metodo congelado antes de medir el 11/11/2026 a las 12:17, en la seccion 5 de
`ORDENES-DEL-MASTER/2026-11-11-lineas-A-B-R2.md`; responde a las condiciones (a) a (d) del dictamen del juez del
11/11/2026. Resumen:
  - Landsat 8 y 9, C2 L2 (Planetary Computer): temperatura de superficie (`lwir11`) y reflectancia para NDVI y MNDWI,
    abril y mayo de 2014 a 2026, mascara `qa_pixel`. Las dos filas WRS-2 de un mismo paso se funden: cada fecha cuenta
    una vez. Compuesto: una sola mediana por pixel de todas las fechas despejadas.
  - Indicador 1: mediana urbana (dentro del limite urbano, fraccion construida GHSL 2020 >= 0.3) menos mediana rural
    (anillo de 2 a 6 km fuera del limite, dentro del municipio, sin agua y con fraccion construida <= 0.05).
  - Indicador 2: por sector en alcance (>= 90 % dentro del limite urbano, >= 10 ha, >= 100 pixeles), su mediana menos la
    de los sectores de su mismo tercil de fraccion construida GHSL 2020. Umbral +1.5 C, con sensibilidad a 1.0 y 2.0.
  - Validacion: fechas impares contra pares (Spearman >= 0.8) y repeticion del indicador 1 en 2014-2021 y 2022-2026.
  - El Palote y el Metropolitano: fraccion con agua y NDVI por anio, con las mismas fechas.

Uso: python herramientas/calor_sector_v2.py
"""

from __future__ import annotations

import json
import zipfile
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
import requests
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from rasterio.warp import reproject
from scipy.stats import spearmanr
from shapely.geometry import box

RAIZ = Path(__file__).resolve().parents[1]
SALIDA = RAIZ / "salidas" / "calor-v2"
# La pila por fecha pesa unos 2 GB: va fuera de OneDrive.
PILA = Path(__import__("tempfile").gettempdir()) / "observatorio-calor-v2"
SECTORES = RAIZ.parent / "2. BALANCE HÍDRICO" / "CAPAS-VIGENTES" / "2026-11-05" / "SECTORES.geojson"
URBANO = RAIZ.parent / "0. CAPAS VARIAS" / "LIMITES_VIGENTES" / "LIMITE_URBANO_POTE_2020" / "Limite_Urbano_Pote_2020.shp"
MUNICIPIO = RAIZ.parent / "0. CAPAS VARIAS" / "LIMITES_VIGENTES" / "LIMITE MUNICIPAL" / "LIMITE_MUNICIPAL.shp"
GHSL_2020 = RAIZ / "salidas" / "construida" / "ghsl" / "GHS_BUILT_S_E2020_GLOBE_R2023A_54009_100_V1_0_R7_C9.zip"
CONSTRUIDA = RAIZ / "salidas" / "construida" / "construida-por-sector.csv"
ESPACIOS = RAIZ / "salidas" / "espacio-verde" / "espacio-verde.gpkg"
STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
TOKEN = "https://planetarycomputer.microsoft.com/api/sas/v1/token/landsat-c2-l2"
CRS = 32614
CELDA = 30
ANILLO = (2000, 6000)
UMBRALES = (1.0, 1.5, 2.0)
UMBRAL = 1.5
BITS_MALOS = (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4)
BANDAS = {"lst": "lwir11", "verde": "green", "rojo": "red", "nir": "nir08", "swir": "swir16"}


def leer(href, token, t, forma, remuestreo):
    with rasterio.open(f"{href}?{token}") as src, WarpedVRT(src, crs=CRS, transform=t, width=forma[1], height=forma[0],
                                                           resampling=remuestreo) as vrt:
        return vrt.read(1)


def escala(item, asset):
    rb = (item["assets"][asset].get("raster:bands") or [{}])[0]
    return rb.get("scale", 1.0), rb.get("offset", 0.0)


def main() -> None:
    SALIDA.mkdir(parents=True, exist_ok=True)
    sect = gpd.read_file(SECTORES).to_crs(CRS)
    urbano = gpd.read_file(URBANO)
    urbano = (urbano if urbano.crs else urbano.set_crs(CRS)).to_crs(CRS)
    muni = gpd.read_file(MUNICIPIO)
    muni = (muni if muni.crs else muni.set_crs(CRS)).to_crs(CRS)
    u = urbano.union_all()
    x0, y0, x1, y1 = u.buffer(ANILLO[1] + 300).bounds
    ancho, alto = int((x1 - x0) / CELDA), int((y1 - y0) / CELDA)
    t = from_origin(x0, y1, CELDA, CELDA)
    forma = (alto, ancho)
    bbox4326 = [float(v) for v in gpd.GeoSeries([box(x0, y0, x1, y1)], crs=CRS).to_crs(4326).total_bounds]

    # Fraccion construida GHSL 2020 en la rejilla de 30 m (la celda de 100 m se reparte sin promediar).
    with zipfile.ZipFile(GHSL_2020) as zf:
        datos = zf.read([n for n in zf.namelist() if n.endswith(".tif")][0])
    construida = np.zeros(forma, "float32")
    with MemoryFile(datos) as mem, mem.open() as r:
        reproject(rasterio.band(r, 1), construida, dst_transform=t, dst_crs=CRS, resampling=Resampling.nearest)
    construida = np.clip(construida / 1e4, 0, 1)

    en_urbano = rasterize([(u, 1)], out_shape=forma, transform=t, dtype="uint8").astype(bool)
    anillo = u.buffer(ANILLO[1]).difference(u.buffer(ANILLO[0])).intersection(muni.union_all())
    en_anillo = rasterize([(anillo, 1)], out_shape=forma, transform=t, dtype="uint8").astype(bool)

    # Escenas, agrupadas por fecha.
    por_fecha = defaultdict(list)
    for anio in range(2014, 2027):
        cuerpo = {"collections": ["landsat-c2-l2"], "bbox": bbox4326,
                  "datetime": f"{anio}-04-01T00:00:00Z/{anio}-05-31T23:59:59Z",
                  "query": {"eo:cloud_cover": {"lte": 30}, "platform": {"in": ["landsat-8", "landsat-9"]}}, "limit": 100}
        for it in requests.post(STAC, json=cuerpo, timeout=120).json().get("features", []):
            if all(BANDAS[b] in it["assets"] for b in BANDAS) and "qa_pixel" in it["assets"]:
                por_fecha[it["properties"]["datetime"][:10]].append(it)
    fechas = sorted(por_fecha)
    print(len(fechas), "fechas distintas", flush=True)

    n = len(fechas)
    PILA.mkdir(parents=True, exist_ok=True)
    mm = {v: np.lib.format.open_memmap(PILA / f"pila-{v}.npy", mode="w+", dtype="float32", shape=(n, *forma))
          for v in ("lst", "ndvi", "mndwi")}
    for k, fecha in enumerate(fechas):
        token = requests.get(TOKEN, timeout=60).json()["token"]
        acum = {v: np.full(forma, np.nan, "float32") for v in ("lst", "ndvi", "mndwi")}
        for it in por_fecha[fecha]:
            qa = leer(it["assets"]["qa_pixel"]["href"], token, t, forma, Resampling.nearest)
            malo = (qa == 0) | ((qa & BITS_MALOS) != 0)
            c = {}
            for b, asset in BANDAS.items():
                crudo = leer(it["assets"][asset]["href"], token, t, forma, Resampling.bilinear).astype("float32")
                s, o = escala(it, asset)
                v = crudo * s + o
                v[(crudo == 0) | malo] = np.nan
                c[b] = v
            lst = c["lst"] - 273.15
            ndvi = (c["nir"] - c["rojo"]) / (c["nir"] + c["rojo"])
            mndwi = (c["verde"] - c["swir"]) / (c["verde"] + c["swir"])
            for v, arr in (("lst", lst), ("ndvi", ndvi), ("mndwi", mndwi)):
                hueco = np.isnan(acum[v]) & np.isfinite(arr)
                acum[v][hueco] = arr[hueco]
        for v in acum:
            mm[v][k] = acum[v]
        print(fecha, f"{np.isfinite(acum['lst'][en_urbano]).mean():.2f} urbano despejado", flush=True)
    for v in mm:
        mm[v].flush()

    anios = np.array([int(f[:4]) for f in fechas])
    subconjuntos = {
        "todas": np.ones(n, bool),
        "impares": np.arange(n) % 2 == 1,
        "pares": np.arange(n) % 2 == 0,
        "2014_2021": anios <= 2021,
        "2022_2026": anios >= 2022,
    }

    def mediana(var, sel):
        return np.nanmedian(np.asarray(mm[var][sel]), axis=0)

    lst = {k: mediana("lst", sel) for k, sel in subconjuntos.items()}
    ndvi_todas = mediana("ndvi", subconjuntos["todas"])
    mndwi_todas = mediana("mndwi", subconjuntos["todas"])
    for nombre, arr in (("lst-todas", lst["todas"]), ("ndvi-todas", ndvi_todas), ("mndwi-todas", mndwi_todas)):
        with rasterio.open(SALIDA / f"{nombre}.tif", "w", driver="GTiff", width=ancho, height=alto, count=1, dtype="float32",
                           crs=CRS, transform=t, compress="deflate", nodata=np.nan) as dst:
            dst.write(arr.astype("float32"), 1)

    # Indicador 1.
    m_urb = en_urbano & (construida >= 0.3)
    m_rur = en_anillo & (construida <= 0.05) & (mndwi_todas <= 0)

    def intensidad(arr):
        return round(float(np.nanmedian(arr[m_urb]) - np.nanmedian(arr[m_rur])), 2)

    ind1 = {k: intensidad(v) for k, v in lst.items()}
    por_anio = {}
    for a in sorted(set(anios)):
        arr = mediana("lst", anios == a)
        por_anio[int(a)] = {"fechas": int((anios == a).sum()), "intensidad": intensidad(arr),
                            "mediana_urbana": round(float(np.nanmedian(arr[m_urb])), 2),
                            "mediana_rural": round(float(np.nanmedian(arr[m_rur])), 2)}

    # Indicador 2.
    area_dentro = []
    for g in sect.geometry:
        area_dentro.append(g.intersection(u).area / g.area if g.area > 0 else 0)
    sect = sect.assign(dentro=area_dentro, area_ha=sect.area / 1e4)
    ids = rasterize(((g, i + 1) for i, g in enumerate(sect.geometry)), out_shape=forma, transform=t, dtype="int32")
    frac = pd.read_csv(CONSTRUIDA, dtype={"unidad": str}).set_index("unidad")["fraccion_2020"]

    def por_sector(arr):
        df = pd.DataFrame({"i": ids.ravel(), "v": arr.ravel()})
        df = df[(df.i > 0) & np.isfinite(df.v)]
        g = df.groupby("i")["v"].agg(["median", "count"])
        g.index = sect["Sect"].astype(str).iloc[g.index - 1].values
        return g

    base = por_sector(lst["todas"])
    tabla = pd.DataFrame({"sector": sect["Sect"].astype(str).values, "dentro": sect["dentro"].values,
                          "area_ha": sect["area_ha"].values}).set_index("sector")
    tabla["pixeles"] = base["count"]
    tabla["lst_mediana"] = base["median"]
    tabla["fraccion_construida_2020"] = frac.reindex(tabla.index)
    alcance = (tabla.dentro >= 0.9) & (tabla.area_ha >= 10) & (tabla.pixeles >= 100)
    tabla["en_alcance"] = alcance
    t2 = tabla[alcance].copy()
    t2["tercil"] = pd.qcut(t2["fraccion_construida_2020"], 3, labels=["baja", "media", "alta"])

    def anomalia(serie):
        x = t2.assign(v=serie.reindex(t2.index))
        return x["v"] - x.groupby("tercil", observed=True)["v"].transform("median")

    t2["anomalia"] = anomalia(t2["lst_mediana"])
    an_impar = anomalia(por_sector(lst["impares"])["median"])
    an_par = anomalia(por_sector(lst["pares"])["median"])
    rho = float(spearmanr(an_impar, an_par, nan_policy="omit").correlation)
    sens = {str(u_): int((t2["anomalia"] >= u_).sum()) for u_ in UMBRALES}
    t2["mas_caliente_que_su_tipo"] = t2["anomalia"] >= UMBRAL
    t2.sort_values("anomalia", ascending=False).round(3).to_csv(SALIDA / "calor-v2-por-sector.csv", encoding="utf-8-sig")

    # El Palote y el Metropolitano, por anio, con las mismas fechas.
    esp = gpd.read_file(ESPACIOS, layer="azul_publico").to_crs(CRS)
    palote = esp[esp["nombre"].str.contains("palote", case=False, na=False)]
    verde = gpd.read_file(ESPACIOS, layer="verde_publico").to_crs(CRS)
    metro = verde[verde["nombre"].str.contains("Metropolitano", na=False)]
    m_pal = rasterize([(g, 1) for g in palote.geometry], out_shape=forma, transform=t, dtype="uint8").astype(bool)
    m_met = rasterize([(g, 1) for g in metro.difference(palote.union_all()).buffer(-30).geometry], out_shape=forma,
                      transform=t, dtype="uint8").astype(bool)
    control = {}
    for a in sorted(set(anios)):
        sel = anios == a
        mnd = mediana("mndwi", sel)
        ndv = mediana("ndvi", sel)
        lsa = mediana("lst", sel)
        control[int(a)] = {
            "palote_fraccion_agua": round(float(np.nanmean(mnd[m_pal] > 0)), 3),
            "metropolitano_ndvi": round(float(np.nanmedian(ndv[m_met])), 3),
            "palote_menos_urbano": round(float(np.nanmedian(lsa[m_pal]) - np.nanmedian(lsa[en_urbano])), 2),
            "metropolitano_menos_urbano": round(float(np.nanmedian(lsa[m_met]) - np.nanmedian(lsa[en_urbano])), 2),
        }

    resumen = {
        "fechas": n,
        "fechas_por_anio": {int(a): int((anios == a).sum()) for a in sorted(set(anios))},
        "indicador_1_intensidad_urbano_menos_rural": ind1,
        "indicador_1_por_anio": por_anio,
        "pixeles_urbanos": int(m_urb.sum()),
        "pixeles_rurales": int(m_rur.sum()),
        "indicador_2": {"sectores_en_alcance": int(alcance.sum()), "spearman_impares_pares": round(rho, 3),
                        "pasa_validacion": rho >= 0.8, "sectores_por_umbral": sens,
                        "terciles_fraccion": t2.groupby("tercil", observed=True)["fraccion_construida_2020"].agg(["min", "max"]).round(3).to_dict()},
        "control_palote_metropolitano": control,
    }
    (SALIDA / "calor-v2-resumen.json").write_text(json.dumps(resumen, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print(json.dumps(resumen, ensure_ascii=False, indent=1, default=str))


if __name__ == "__main__":
    main()
