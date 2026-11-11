"""
Islas de calor por sector hidraulico: serie de estiaje 2014 a 2026 (OBS-17, Linea B, bloque 4).

Fuente: Landsat 8 y 9, Coleccion 2, Nivel 2, temperatura de superficie (`lwir11`, con la escala y el desplazamiento del
propio item; mascara `qa_pixel`), en Planetary Computer. Es la misma fuente y el mismo metodo del modo Calor de la
plataforma. Ventana: 1 de abril a 31 de mayo de cada anio. Por anio, la mediana por pixel de las observaciones
despejadas; por sector, la mediana de sus pixeles y la anomalia respecto de la mediana urbana de ese anio.

Criterio de isla de calor y cifras de contraste declarados antes de medir en
`ORDENES-DEL-MASTER/2026-11-11-lineas-A-B-R2.md`.

Uso: python herramientas/calor_sector.py [anio_inicial anio_final]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
import requests
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from scipy.stats import spearmanr

RAIZ = Path(__file__).resolve().parents[1]
SALIDA = RAIZ / "salidas" / "calor"
SECTORES = RAIZ.parent / "2. BALANCE HÍDRICO" / "CAPAS-VIGENTES" / "2026-11-05" / "SECTORES.geojson"
URBANO = RAIZ.parent / "0. CAPAS VARIAS" / "LIMITES_VIGENTES" / "LIMITE_URBANO_POTE_2020" / "Limite_Urbano_Pote_2020.shp"
ESPACIOS = RAIZ / "salidas" / "espacio-verde" / "espacio-verde.gpkg"
STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
TOKEN = "https://planetarycomputer.microsoft.com/api/sas/v1/token/landsat-c2-l2"
CRS = 32614
CELDA = 30
NUBES_ESCENA = 30
ANOMALIA_ISLA = 2.0
FRACCION_ANIOS = 2 / 3
# qa_pixel: 0 relleno, 1 nube dilatada, 2 cirro, 3 nube, 4 sombra de nube.
BITS_MALOS = (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4)


def escenas(anio: int, bbox4326) -> list[dict]:
    cuerpo = {
        "collections": ["landsat-c2-l2"],
        "bbox": bbox4326,
        "datetime": f"{anio}-04-01T00:00:00Z/{anio}-05-31T23:59:59Z",
        "query": {"eo:cloud_cover": {"lte": NUBES_ESCENA}, "platform": {"in": ["landsat-8", "landsat-9"]}},
        "limit": 100,
    }
    items = requests.post(STAC, json=cuerpo, timeout=120).json().get("features", [])
    return [i for i in items if "lwir11" in i["assets"] and "qa_pixel" in i["assets"]]


def leer(href: str, token: str, transform, forma, remuestreo):
    with rasterio.open(f"{href}?{token}") as src, WarpedVRT(src, crs=CRS, transform=transform, width=forma[1],
                                                           height=forma[0], resampling=remuestreo) as vrt:
        return vrt.read(1)


def main() -> None:
    a0, a1 = (int(sys.argv[1]), int(sys.argv[2])) if len(sys.argv) > 2 else (2014, 2026)
    sect = gpd.read_file(SECTORES).to_crs(CRS)
    urbano = gpd.read_file(URBANO)
    urbano = (urbano if urbano.crs else urbano.set_crs(CRS)).to_crs(CRS)
    x0, y0, x1, y1 = pd.concat([sect.geometry, urbano.geometry]).total_bounds
    x0, y0, x1, y1 = x0 - 600, y0 - 600, x1 + 600, y1 + 600
    ancho, alto = int((x1 - x0) / CELDA), int((y1 - y0) / CELDA)
    t = from_origin(x0, y1, CELDA, CELDA)
    forma = (alto, ancho)
    from shapely.geometry import box

    bbox4326 = [float(v) for v in gpd.GeoSeries([box(x0, y0, x1, y1)], crs=CRS).to_crs(4326).total_bounds]

    id_sector = rasterize(((g, i + 1) for i, g in enumerate(sect.geometry)), out_shape=forma, transform=t, dtype="int32")
    en_urbano = rasterize([(urbano.union_all(), 1)], out_shape=forma, transform=t, dtype="uint8").astype(bool)
    esp = gpd.read_file(ESPACIOS, layer="azul_publico").to_crs(CRS)
    palote = esp[esp["nombre"].str.contains("palote", case=False, na=False)]
    verde = gpd.read_file(ESPACIOS, layer="verde_publico").to_crs(CRS)
    metro = verde[verde["nombre"].str.contains("Metropolitano", na=False)]
    m_palote = rasterize([(g, 1) for g in palote.buffer(-60).geometry], out_shape=forma, transform=t, dtype="uint8").astype(bool) if len(palote) else None
    m_metro = rasterize([(g, 1) for g in metro.difference(palote.union_all()).buffer(-30).geometry], out_shape=forma, transform=t, dtype="uint8").astype(bool) if len(metro) else None

    SALIDA.mkdir(parents=True, exist_ok=True)
    filas, resumen = [], {}
    for anio in range(a0, a1 + 1):
        ruta = SALIDA / f"lst-mediana-{anio}.tif"
        lista = escenas(anio, bbox4326)
        if not ruta.exists():
            token = requests.get(TOKEN, timeout=60).json()["token"]
            pila = []
            for it in lista:
                a = it["assets"]["lwir11"]
                rb = (a.get("raster:bands") or [{}])[0]
                crudo = leer(a["href"], token, t, forma, Resampling.bilinear).astype("float32")
                qa = leer(it["assets"]["qa_pixel"]["href"], token, t, forma, Resampling.nearest)
                k = crudo * rb.get("scale", 0.00341802) + rb.get("offset", 149.0)
                k[(crudo == 0) | ((qa & BITS_MALOS) != 0)] = np.nan
                pila.append(k - 273.15)
                print(anio, it["id"], f"{np.isfinite(pila[-1][en_urbano]).mean():.2f} urbano despejado", flush=True)
            if not pila:
                print(anio, "sin escenas")
                continue
            med = np.nanmedian(np.stack(pila), axis=0).astype("float32")
            with rasterio.open(ruta, "w", driver="GTiff", width=ancho, height=alto, count=1, dtype="float32", crs=CRS,
                               transform=t, compress="deflate", nodata=np.nan) as dst:
                dst.write(med, 1)
        with rasterio.open(ruta) as r:
            med = r.read(1)
        urb = float(np.nanmedian(med[en_urbano]))
        resumen[anio] = {
            "escenas": len(lista),
            "mediana_urbana": round(urb, 2),
            "palote_menos_urbano": round(float(np.nanmedian(med[m_palote])) - urb, 2) if m_palote is not None and m_palote.any() else None,
            "metropolitano_menos_urbano": round(float(np.nanmedian(med[m_metro])) - urb, 2) if m_metro is not None and m_metro.any() else None,
        }
        df = pd.DataFrame({"i": id_sector.ravel(), "v": med.ravel()})
        df = df[(df.i > 0) & np.isfinite(df.v)]
        g = df.groupby("i")["v"].agg(["median", "count"])
        for i, fila in g.iterrows():
            filas.append({"sector": str(sect["Sect"].iloc[i - 1]), "anio": anio, "lst_mediana": round(fila["median"], 2),
                          "pixeles": int(fila["count"]), "anomalia": round(fila["median"] - urb, 2)})
    serie = pd.DataFrame(filas)
    serie.to_csv(SALIDA / "calor-por-sector-anio.csv", index=False, encoding="utf-8-sig")
    ancha = serie.pivot(index="sector", columns="anio", values="anomalia")
    anios = sorted(ancha.columns)
    rho = {f"{a}-{b}": round(float(spearmanr(ancha[a], ancha[b], nan_policy="omit").correlation), 3) for a, b in zip(anios[:-1], anios[1:])}
    con_dato = ancha.notna().sum(axis=1)
    sobre = (ancha >= ANOMALIA_ISLA).sum(axis=1)
    islas = ancha.index[(sobre >= np.ceil(FRACCION_ANIOS * con_dato)) & (con_dato >= 3)]
    tabla = pd.DataFrame({"anomalia_mediana": ancha.median(axis=1).round(2), "anios_con_dato": con_dato,
                          "anios_sobre_2C": sobre, "isla_de_calor": ancha.index.isin(islas)})
    tabla.sort_values("anomalia_mediana", ascending=False).to_csv(SALIDA / "calor-por-sector.csv", encoding="utf-8-sig")
    contraste = {"por_anio": resumen, "spearman_anios_consecutivos": rho, "sectores": int(len(tabla)),
                 "islas_de_calor": int(len(islas)), "criterio": f"anomalia >= {ANOMALIA_ISLA} C en al menos 2 de cada 3 anios con dato"}
    (SALIDA / "calor-contraste.json").write_text(json.dumps(contraste, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(contraste, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
