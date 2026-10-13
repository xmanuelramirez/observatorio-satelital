"""
Superficie urbanizada por periodo, 2017 a 2023, sobre el municipio de Leon.

Sale del uso de suelo anual de Esri e Impact Observatory (io-lulc-annual-v02, 10 m,
CC BY 4.0, Planetary Computer). Se pidio para cruzar el crecimiento urbano con los
tramos de arroyo, que corren sobre todo en la orilla de la ciudad: por eso cubre el
municipio entero y no solo la zona urbana.

Regla, escrita antes de medir (13/10/2026):
- Un pixel cuenta como urbanizado en el ano A si la clase «Built area» (7) aparece en A
  **y en todos los anos siguientes hasta 2023**. Asi un pixel que parpadea entre clases
  no se cuenta dos veces ni se adelanta. El valor del raster es ese primer ano.
- Periodos: hasta 2017 (lo que ya era ciudad), 2018 a 2020 y 2021 a 2023.

Cifras de contraste, escritas antes de medir:
1. Dentro de la zona urbana, lo urbanizado hasta 2023 con esta regla debe quedar a 2 % o
   menos de las 20,320 ha que el paquete de vegetacion midio con la clase 7 de 2023.
2. Lo urbanizado hasta 2017 dentro de la zona urbana debe ser 18,909 ha o menos (la regla de
   persistencia solo puede quitar, nunca agregar).
3. En el municipio, lo urbanizado nuevo de 2018 a 2023 debe ser mayor que lo de la zona
   urbana (1,503 ha brutas), porque la ciudad crece hacia afuera de su limite.

Uso:
    python herramientas/urbanizado_por_periodo.py <carpeta_salida>
"""

from __future__ import annotations

import json
import os
import sys
import warnings
from pathlib import Path

import numpy as np
import pystac_client
import rasterio
import requests
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.features import rasterize, shapes
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from shapely import transform as transformar
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

warnings.filterwarnings("ignore")

RAIZ = Path(__file__).resolve().parent.parent
SALIDA = Path(sys.argv[1]) if len(sys.argv) > 1 else RAIZ / "salidas" / "urbanizado-por-periodo"
EPSG = 32614
CELDA = 10.0
LULC = "io-lulc-annual-v02"
CONSTRUIDO = 7
ANIOS = list(range(2017, 2024))
PERIODOS = [("hasta 2017", 2017, 2017), ("2018 a 2020", 2018, 2020), ("2021 a 2023", 2021, 2023)]


def poligono_utm(nombre):
    capa = json.loads((RAIZ / "public" / "capas" / nombre).read_text(encoding="utf-8"))
    geo = unary_union([shape(f["geometry"]) for f in capa["features"]])
    a = Transformer.from_crs(4326, EPSG, always_xy=True)
    return geo, transformar(geo, lambda xy: np.column_stack(a.transform(xy[:, 0], xy[:, 1])))


def main():
    SALIDA.mkdir(parents=True, exist_ok=True)
    geo, mun = poligono_utm("LIMITE.geojson")
    _, urb = poligono_utm("LIMITE_URBANO.geojson")
    x0, y0, x1, y1 = mun.bounds
    x0, y1 = np.floor(x0 / CELDA) * CELDA, np.ceil(y1 / CELDA) * CELDA
    ancho, alto = int(np.ceil((x1 - x0) / CELDA)), int(np.ceil((y1 - y0) / CELDA))
    tr = from_origin(x0, y1, CELDA, CELDA)
    en_mun = rasterize([mapping(mun)], out_shape=(alto, ancho), transform=tr, fill=0, default_value=1).astype(bool)
    en_urb = rasterize([mapping(urb)], out_shape=(alto, ancho), transform=tr, fill=0, default_value=1).astype(bool)

    token = requests.get(f"https://planetarycomputer.microsoft.com/api/sas/v1/token/{LULC}", timeout=60).json()["token"]
    items = list(pystac_client.Client.open("https://planetarycomputer.microsoft.com/api/stac/v1")
                 .search(collections=[LULC], bbox=geo.bounds).items())
    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    construido = {}
    for anio in ANIOS:
        capa = np.zeros((alto, ancho), np.uint8)
        for item in [i for i in items if i.properties["start_datetime"][:4] == str(anio)]:
            with rasterio.open(item.assets["data"].href + "?" + token) as src, \
                    WarpedVRT(src, crs=f"EPSG:{EPSG}", transform=tr, width=ancho, height=alto,
                              resampling=Resampling.nearest) as vrt:
                datos = vrt.read(1)
            capa = np.where(capa == 0, datos, capa)
        if not (capa[en_mun] > 0).all():
            raise SystemExit(f"{anio}: el producto no cubre todo el municipio")
        construido[anio] = capa == CONSTRUIDO
        print(f"{anio}: {construido[anio][en_mun].sum() * 0.01:,.0f} ha de clase construido en el municipio", flush=True)

    # Primer ano a partir del cual el pixel es construido sin interrupcion hasta 2023.
    persistente = np.ones((alto, ancho), bool)
    primero = np.zeros((alto, ancho), np.uint16)
    for anio in reversed(ANIOS):
        persistente &= construido[anio]
        primero[persistente] = anio
    salida = np.where(en_mun, np.where(primero > 0, primero, 1), 0).astype(np.uint16)

    perfil = dict(driver="GTiff", width=ancho, height=alto, count=1, dtype="uint16", crs=f"EPSG:{EPSG}",
                  transform=tr, nodata=0, compress="deflate", tiled=True)
    ruta_tif = SALIDA / "urbanizado_primer_anio_2017_2023.tif"
    with rasterio.open(ruta_tif, "w", **perfil) as dst:
        dst.write(salida, 1)
        dst.update_tags(1, valores="0 fuera del municipio; 1 no urbanizado a 2023; 2017 a 2023 primer ano urbanizado sin interrupcion",
                        fuente="Esri / Impact Observatory, 10m Annual LULC 9-class V2 (io-lulc-annual-v02), CC BY 4.0")

    periodo = np.zeros((alto, ancho), np.uint8)
    for k, (_, a, b) in enumerate(PERIODOS, start=1):
        periodo[(salida >= a) & (salida <= b)] = k
    a_geo = Transformer.from_crs(EPSG, 4326, always_xy=True)
    rasgos, filas = [], []
    for k, (nombre, a, b) in enumerate(PERIODOS, start=1):
        for g, v in shapes(periodo, mask=periodo == k, transform=tr, connectivity=8):
            if v != k:
                continue
            pol = shape(g)
            ll = transformar(pol, lambda xy: np.column_stack(a_geo.transform(xy[:, 0], xy[:, 1])))
            rasgos.append({"type": "Feature", "properties": {"periodo": nombre, "desde": a, "hasta": b,
                                                             "ha": round(pol.area / 1e4, 2)},
                           "geometry": mapping(ll)})
        filas.append({"periodo": nombre,
                      "ha_municipio": round(float((periodo == k)[en_mun].sum()) * 0.01),
                      "ha_zona_urbana": round(float((periodo == k)[en_urb].sum()) * 0.01),
                      "ha_fuera_zona_urbana": round(float((periodo == k)[en_mun & ~en_urb].sum()) * 0.01)})
    (SALIDA / "urbanizado_por_periodo_2017_2023.geojson").write_text(json.dumps({
        "type": "FeatureCollection",
        "name": "urbanizado_por_periodo_2017_2023",
        "fuente": "Esri / Impact Observatory, 10m Annual Land Use Land Cover (9-class) V2, CC BY 4.0, via Microsoft Planetary Computer",
        "regla": "Primer ano de la clase Built area (7) sin interrupcion hasta 2023",
        "crs_nota": "CRS84 (longitud, latitud WGS 84); el raster va en EPSG:32614",
        "features": rasgos}, ensure_ascii=False), encoding="utf-8")

    import csv
    with open(SALIDA / "urbanizado_por_periodo_2017_2023.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(filas[0].keys()))
        w.writeheader()
        w.writerows(filas)

    hasta_2023_urb = float(((salida >= 2017) & en_urb).sum()) * 0.01
    hasta_2017_urb = float(((salida == 2017) & en_urb).sum()) * 0.01
    nuevo_mun = float(((salida >= 2018) & en_mun).sum()) * 0.01
    print(f"contraste 1: {hasta_2023_urb:,.0f} ha contra 20,320 ({100 * (hasta_2023_urb - 20320) / 20320:+.1f} %)"
          f" -> {'pasa' if abs(hasta_2023_urb - 20320) / 20320 <= 0.02 else 'NO PASA'}")
    print(f"contraste 2: {hasta_2017_urb:,.0f} ha contra 18,909 -> {'pasa' if hasta_2017_urb <= 18909 else 'NO PASA'}")
    print(f"contraste 3: nuevo en el municipio {nuevo_mun:,.0f} ha contra 1,503 -> {'pasa' if nuevo_mun > 1503 else 'NO PASA'}")
    for fila in filas:
        print(fila)
    print(f"rasgos {len(rasgos)}, geojson {os.path.getsize(SALIDA / 'urbanizado_por_periodo_2017_2023.geojson'):,} bytes")


if __name__ == "__main__":
    main()
