"""
Compuestos anuales de estiaje (NDVI y NDBI) y uso de suelo anual sobre la zona urbana.

Paquete para compartir la evolucion de la vegetacion fuera del departamento. Sale de
catalogos abiertos y de la capa publica LIMITE_URBANO; no lee ninguna capa interna.
El metodo, los umbrales y las cifras de contraste se declararon antes de medir en
`salidas/paquete-vegetacion-zona-urbana-2026-10/METODO-DECLARADO.md`.

Uso:
    python herramientas/paquete_vegetacion.py [carpeta_salida]

Mismas reglas que la app: escala y desplazamiento de cada escena segun su metadato, y
mascara SCL con las clases 0, 1, 3, 8, 9, 10 y 11 descartadas (src/servicios/nubes.ts).
"""

from __future__ import annotations

import json
import os
import sys
import warnings
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pystac_client
import rasterio
import requests
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from shapely import transform as transformar
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

warnings.filterwarnings("ignore")

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("AWS_NO_SIGN_REQUEST", "YES")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif,.TIF,.tiff")
os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "5")
os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "2")

RAIZ = Path(__file__).resolve().parent.parent
SALIDA = Path(sys.argv[1]) if len(sys.argv) > 1 else RAIZ / "salidas" / "paquete-vegetacion-zona-urbana-2026-10"
CACHE = SALIDA / "rasters"

EPSG = 32614
CELDA = 10.0
ANIOS = range(2019, 2026)
ESTIAJE = ("03-01", "05-31")
NUBES_MAX = 20
SCL_DESCARTADAS = {0, 1, 3, 8, 9, 10, 11}

EARTH_SEARCH = "https://earth-search.aws.element84.com/v1"
PLANETARY = "https://planetarycomputer.microsoft.com/api/stac/v1"
LULC = "io-lulc-annual-v02"


def malla():
    capa = json.loads((RAIZ / "public" / "capas" / "LIMITE_URBANO.geojson").read_text(encoding="utf-8"))
    geo = unary_union([shape(f["geometry"]) for f in capa["features"]])
    a_utm = Transformer.from_crs(4326, EPSG, always_xy=True)
    utm = transformar(geo, lambda xy: np.column_stack(a_utm.transform(xy[:, 0], xy[:, 1])))
    x0, y0, x1, y1 = utm.bounds
    x0, y1 = np.floor(x0 / CELDA) * CELDA, np.ceil(y1 / CELDA) * CELDA
    ancho = int(np.ceil((x1 - x0) / CELDA))
    alto = int(np.ceil((y1 - y0) / CELDA))
    transform = from_origin(x0, y1, CELDA, CELDA)
    dentro = rasterize([mapping(utm)], out_shape=(alto, ancho), transform=transform, fill=0, default_value=1).astype(bool)
    return geo.bounds, transform, ancho, alto, dentro


BBOX, TRANSFORM, ANCHO, ALTO, DENTRO = malla()


def leer(href: str, remuestreo=Resampling.nearest) -> np.ndarray:
    with rasterio.open(href) as src:
        with WarpedVRT(src, crs=f"EPSG:{EPSG}", transform=TRANSFORM, width=ANCHO, height=ALTO, resampling=remuestreo) as vrt:
            return vrt.read(1)


def reflectancia(item, banda: str) -> np.ndarray:
    asset = item.assets[banda]
    meta = (asset.extra_fields.get("raster:bands") or [{}])[0]
    crudo = leer(asset.href).astype(np.float32)
    crudo[crudo == meta.get("nodata", 0)] = np.nan
    desplazamiento = meta.get("offset", 0.0)
    # La coleccion vieja de Earth Search ya resto los 1,000 de la linea base 04.00 en sus
    # valores, pero su metadato sigue declarando offset -0.1: aplicarlo lo resta dos veces.
    # Comprobado el 09/10/2026 con la misma escena (S2A 14QKJ 2023-04-19) en las dos
    # colecciones: el rojo da 2,704 en c1 y 1,704 en la vieja, exactamente 1,000 menos; y
    # 2022 en la vieja (1,632) va en la misma escala que 2021 en la vieja, que declara 0.
    if item.collection_id == "sentinel-2-l2a":
        desplazamiento = 0.0
    return crudo * meta.get("scale", 1.0) + desplazamiento


def indices_de(item):
    scl = leer(item.assets["scl"].href)
    valido = ~np.isin(scl, list(SCL_DESCARTADAS))
    rojo = reflectancia(item, "red")
    nir = reflectancia(item, "nir")
    swir = reflectancia(item, "swir16")
    with np.errstate(invalid="ignore", divide="ignore"):
        ndvi = (nir - rojo) / (nir + rojo)
        ndbi = (swir - nir) / (swir + nir)
    for arr in (ndvi, ndbi):
        arr[~valido] = np.nan
    return ndvi.astype(np.float32), ndbi.astype(np.float32)


def guardar(ruta: Path, datos: np.ndarray, nodata):
    perfil = dict(driver="GTiff", width=ANCHO, height=ALTO, count=1, dtype=datos.dtype, crs=f"EPSG:{EPSG}",
                  transform=TRANSFORM, nodata=nodata, compress="deflate", tiled=True)
    with rasterio.open(ruta, "w", **perfil) as dst:
        dst.write(datos, 1)


def compuesto(anio: int, coleccion: str, sufijo: str = ""):
    destino_ndvi = CACHE / f"ndvi_estiaje_{anio}{sufijo}.tif"
    destino_ndbi = CACHE / f"ndbi_estiaje_{anio}{sufijo}.tif"
    resumen = CACHE / f"escenas_{anio}{sufijo}.json"
    if destino_ndvi.exists() and destino_ndbi.exists() and resumen.exists():
        print(f"{anio}{sufijo}: ya estaba")
        return
    cliente = pystac_client.Client.open(EARTH_SEARCH)
    items = list(cliente.search(collections=[coleccion], bbox=BBOX,
                                datetime=f"{anio}-{ESTIAJE[0]}/{anio}-{ESTIAJE[1]}",
                                query={"eo:cloud_cover": {"lt": NUBES_MAX}}).items())
    print(f"{anio}{sufijo}: {len(items)} escenas de {coleccion}", flush=True)
    with ThreadPoolExecutor(6) as pool:
        pares = list(pool.map(indices_de, items))
    ndvi = np.stack([p[0] for p in pares])
    ndbi = np.stack([p[1] for p in pares])
    n_obs = np.sum(~np.isnan(ndvi), axis=0).astype(np.uint8)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        med_ndvi = np.nanmedian(ndvi, axis=0).astype(np.float32)
        med_ndbi = np.nanmedian(ndbi, axis=0).astype(np.float32)
    for arr in (med_ndvi, med_ndbi):
        arr[~DENTRO] = np.nan
    guardar(destino_ndvi, med_ndvi, np.nan)
    guardar(destino_ndbi, med_ndbi, np.nan)
    guardar(CACHE / f"observaciones_{anio}{sufijo}.tif", np.where(DENTRO, n_obs, 0).astype(np.uint8), 0)
    resumen.write_text(json.dumps({
        "anio": anio, "coleccion": coleccion, "escenas": sorted(i.id for i in items),
        "nubes_max": NUBES_MAX, "periodo": [f"{anio}-{ESTIAJE[0]}", f"{anio}-{ESTIAJE[1]}"],
        "observaciones_mediana_en_zona": float(np.median(n_obs[DENTRO])),
        "pixeles_sin_observacion": int(np.sum((n_obs == 0) & DENTRO)),
    }, ensure_ascii=False, indent=1), encoding="utf-8")


def uso_de_suelo():
    cliente = pystac_client.Client.open(PLANETARY)
    token = requests.get(f"https://planetarycomputer.microsoft.com/api/sas/v1/token/{LULC}", timeout=60).json()["token"]
    items = list(cliente.search(collections=[LULC], bbox=BBOX).items())
    for anio in sorted({i.properties["start_datetime"][:4] for i in items}):
        destino = CACHE / f"uso_suelo_{anio}.tif"
        if destino.exists():
            continue
        del_anio = [i for i in items if i.properties["start_datetime"][:4] == anio]
        capa = np.zeros((ALTO, ANCHO), dtype=np.uint8)
        for item in del_anio:
            datos = leer(item.assets["data"].href + "?" + token)
            capa = np.where(capa == 0, datos, capa)
        capa[~DENTRO] = 0
        guardar(destino, capa.astype(np.uint8), 0)
        print(f"uso de suelo {anio}: {[i.id for i in del_anio]}", flush=True)


if __name__ == "__main__":
    CACHE.mkdir(parents=True, exist_ok=True)
    print(f"malla {ANCHO} x {ALTO} a {CELDA:.0f} m, {DENTRO.sum() * CELDA * CELDA / 1e4:,.0f} ha dentro", flush=True)
    uso_de_suelo()
    for anio in ANIOS:
        compuesto(anio, "sentinel-2-l2a" if anio == 2022 else "sentinel-2-c1-l2a")
    compuesto(2023, "sentinel-2-l2a", sufijo="_coleccion_anterior")
