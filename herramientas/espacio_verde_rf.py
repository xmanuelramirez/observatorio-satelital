"""
Random forest para separar parques reales de lo que no lo es (idea de Carlos, 09/11/2026).

Etiquetas: la muestra revisada en imagen (`muestra-revision.csv`, solo «si» y «no»; con
`--coincidencias RUTA` se usan solo las etiquetas en que coinciden dos revisores). Variables de
Sentinel-2 (misma coleccion que el resto del observatorio), forma, acceso y contexto; la fuente no
entra, para poder aplicarlo a las candidatas fuera de OSM. Diseno y barra declarados antes de
entrenar en la seccion 7 de la respuesta a la orden del 09/11/2026.

Uso: python herramientas/espacio_verde_rf.py [--coincidencias ruta.csv]
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
from scipy.spatial import cKDTree
from shapely.geometry import box
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import balanced_accuracy_score, precision_score, recall_score
from sklearn.model_selection import RepeatedStratifiedKFold

sys.path.insert(0, str(Path(__file__).parent))
import espacio_verde as ev  # noqa: E402
from espacio_verde_muestra import estratos, fuente  # noqa: E402

RAIZ = Path(__file__).resolve().parents[1]
SALIDA = RAIZ / "salidas" / "espacio-verde"
GPKG = SALIDA / "espacio-verde.gpkg"
SEMILLA = 20261109
VARIABLES = [
    "ndvi_oct", "ndvi_oct_sd", "verde_oct", "arbol_oct", "ndvi_may", "verde_may", "delta_ndvi", "ndbi_oct",
    "ha_log", "ancho_m", "alargamiento", "compacidad", "nodos_borde", "pob_300m", "en_urbano",
]


def bandas_escena(dia: str, nombres: list[str], limites) -> tuple[dict[str, np.ndarray], object]:
    """Reflectancia de una fecha sobre la rejilla de 10 m del municipio, con la mascara SCL."""
    ruta = SALIDA / f"bandas-{dia}.tif"
    xmin, ymin, xmax, ymax = limites
    ancho, alto = int((xmax - xmin) / 10), int((ymax - ymin) / 10)
    transform = from_origin(xmin, ymax, 10, 10)
    if ruta.exists():
        with rasterio.open(ruta) as r:
            return {n: r.read(i + 1) for i, n in enumerate(nombres)}, r.transform
    cuerpo = {"collections": ["sentinel-2-c1-l2a"], "datetime": f"{dia}T00:00:00Z/{dia}T23:59:59Z",
              "bbox": list(gpd.GeoSeries([box(*limites)], crs=32614).to_crs(4326).total_bounds), "limit": 10}
    items = requests.post("https://earth-search.aws.element84.com/v1/search", json=cuerpo, timeout=60).json()["features"]
    salida = {n: np.full((alto, ancho), np.nan, np.float32) for n in nombres}
    for it in items:
        capas = {}
        for banda in nombres + ["scl"]:
            a = it["assets"][banda]
            with rasterio.open(a["href"]) as src, WarpedVRT(src, crs=32614, transform=transform, width=ancho, height=alto,
                                                            resampling=Resampling.nearest) as vrt:
                v = vrt.read(1).astype(np.float32)
            rb = (a.get("raster:bands") or [{}])[0]
            capas[banda] = v if banda == "scl" else np.where(v == 0, np.nan, v * rb.get("scale", 1e-4) + rb.get("offset", 0.0))
        ok = ~np.isin(capas["scl"], [0, 1, 3, 8, 9, 10, 11]) & np.isnan(salida[nombres[0]])
        for n in nombres:
            ok &= np.isfinite(capas[n])
        for n in nombres:
            salida[n][ok] = capas[n][ok]
        print("escena", it["id"])
    with rasterio.open(ruta, "w", driver="GTiff", width=ancho, height=alto, count=len(nombres), dtype="float32", crs=32614,
                       transform=transform, compress="deflate", nodata=np.nan) as dst:
        for i, n in enumerate(nombres):
            dst.write(salida[n], i + 1)
    return salida, transform


def por_poligono(geoms: gpd.GeoSeries, capas: dict[str, np.ndarray], transform) -> pd.DataFrame:
    forma = next(iter(capas.values())).shape
    ids = rasterize(((g, i + 1) for i, g in enumerate(geoms)), out_shape=forma, transform=transform, all_touched=True, dtype="int32")
    plano = ids.ravel()
    ok = plano > 0
    df = pd.DataFrame({k: v.ravel()[ok] for k, v in capas.items()})
    df["i"] = plano[ok] - 1
    return df


def variables(pol: gpd.GeoDataFrame, xy: np.ndarray, mz: gpd.GeoDataFrame, urbano) -> pd.DataFrame:
    zona = tuple(gpd.read_file(RAIZ / "public" / "capas" / "LIMITE.geojson").to_crs(32614).buffer(1000).union_all().bounds)
    octubre, t = bandas_escena("2026-10-20", ["red", "nir", "swir16"], zona)
    mayo, _ = bandas_escena("2026-05-05", ["red", "nir"], zona)
    capas = {
        "ndvi_oct": (octubre["nir"] - octubre["red"]) / (octubre["nir"] + octubre["red"]),
        "ndbi_oct": (octubre["swir16"] - octubre["nir"]) / (octubre["swir16"] + octubre["nir"]),
        "ndvi_may": (mayo["nir"] - mayo["red"]) / (mayo["nir"] + mayo["red"]),
    }
    px = por_poligono(pol.geometry, capas, t)
    g = px.groupby("i")
    f = pd.DataFrame(index=range(len(pol)))
    f["ndvi_oct"] = g["ndvi_oct"].median()
    f["ndvi_oct_sd"] = g["ndvi_oct"].std()
    f["verde_oct"] = g["ndvi_oct"].apply(lambda s: (s >= 0.4).mean())
    f["arbol_oct"] = g["ndvi_oct"].apply(lambda s: (s >= 0.6).mean())
    f["ndvi_may"] = g["ndvi_may"].median()
    f["verde_may"] = g["ndvi_may"].apply(lambda s: (s >= 0.4).mean())
    f["delta_ndvi"] = f["ndvi_oct"] - f["ndvi_may"]
    f["ndbi_oct"] = g["ndbi_oct"].median()
    f["ha_log"] = np.log10(pol.area.values / 1e4)
    rect = pol.geometry.minimum_rotated_rectangle()
    lados = rect.apply(lambda r: sorted(np.hypot(*np.diff(np.array(r.exterior.coords)[:3], axis=0).T)))
    f["ancho_m"] = lados.map(lambda l: l[0]).values
    f["alargamiento"] = (lados.map(lambda l: l[1]) / lados.map(lambda l: max(l[0], 1))).values
    f["compacidad"] = (4 * np.pi * pol.area / pol.length**2).values
    arbol = cKDTree(xy)
    f["nodos_borde"] = [
        int(gpd.GeoSeries.from_xy(*xy[c].T, crs=32614).within(gm.buffer(ev.ACCESO_M)).sum()) if (c := arbol.query_ball_point(
            np.array(gm.centroid.coords[0]), r=np.sqrt(gm.area) * 1.5 + 60)) else 0
        for gm in pol.geometry
    ]
    puntos = gpd.GeoDataFrame({"pob": mz["pob"].fillna(0).values}, geometry=mz.representative_point().values, crs=32614)
    cerca = gpd.sjoin(puntos, gpd.GeoDataFrame(geometry=pol.buffer(300).values, crs=32614), predicate="within")
    f["pob_300m"] = cerca.groupby("index_right")["pob"].sum().reindex(range(len(pol))).fillna(0).values
    f["en_urbano"] = pol.representative_point().within(urbano).astype(int).values
    return f.fillna(f.median(numeric_only=True))


def main() -> None:
    urbano = gpd.read_file(RAIZ / "public" / "capas" / "LIMITE_URBANO.geojson").to_crs(32614).union_all()
    municipio = gpd.read_file(RAIZ / "public" / "capas" / "LIMITE.geojson").to_crs(32614)
    verde = estratos(gpd.read_file(GPKG, layer="verde_publico"))
    cand = gpd.read_file(GPKG, layer="candidatas_ndvi_fuera_de_osm")
    cand["id"] = [f"C{i:04d}" for i in range(len(cand))]
    pol = pd.concat([verde[["id", "geometry"]].assign(tipo="inventario"), cand[["id", "geometry"]].assign(tipo="candidata")],
                    ignore_index=True)
    pol = gpd.GeoDataFrame(pol, crs=32614)
    pol["ha"] = pol.area / 1e4
    xy, _ = ev.red_peatonal(municipio.buffer(1000).union_all())
    mz = gpd.read_file(GPKG, layer="distancia_manzanas")
    f = variables(pol, xy, mz, urbano)

    rev = pd.read_csv(SALIDA / "muestra-revision.csv")
    if "--coincidencias" in sys.argv:
        otra = pd.read_csv(sys.argv[sys.argv.index("--coincidencias") + 1])
        rev = rev.merge(otra[["n", "es_parque"]].rename(columns={"es_parque": "otra"}), on="n")
        rev = rev[rev["es_parque"] == rev["otra"]]
    rev = rev[rev["es_parque"].isin(["si", "no"])]
    fila = {i: k for k, i in enumerate(pol["id"])}
    X = f.loc[[fila[i] for i in rev["id"]], VARIABLES].to_numpy()
    y = (rev["es_parque"] == "si").astype(int).to_numpy()
    regla = rev["fuente"].eq("ambas").astype(int).to_numpy()

    def modelo():
        return RandomForestClassifier(n_estimators=500, min_samples_leaf=2, class_weight="balanced", random_state=SEMILLA)

    cv = RepeatedStratifiedKFold(n_splits=5, n_repeats=20, random_state=SEMILLA)
    ba, pr, rc, ba_regla = [], [], [], []
    for entrena, prueba in cv.split(X, y):
        m = modelo().fit(X[entrena], y[entrena])
        p = m.predict(X[prueba])
        ba.append(balanced_accuracy_score(y[prueba], p))
        pr.append(precision_score(y[prueba], p, zero_division=0))
        rc.append(recall_score(y[prueba], p, zero_division=0))
        ba_regla.append(balanced_accuracy_score(y[prueba], regla[prueba]))
    m = modelo().fit(X, y)
    pol["p_parque"] = m.predict_proba(f[VARIABLES].to_numpy())[:, 1]
    pol = pol.merge(f, left_index=True, right_index=True)
    pol.merge(verde[["id", "fuente", "tamano", "cuenta"]], on="id", how="left").to_file(GPKG, layer="rf_probabilidad", driver="GPKG")
    resumen = {
        "etiquetas": {"si": int(y.sum()), "no": int((1 - y).sum())},
        "cv_exactitud_balanceada": [round(float(np.mean(ba)), 3), round(float(np.std(ba)), 3)],
        "cv_precision": round(float(np.mean(pr)), 3),
        "cv_sensibilidad": round(float(np.mean(rc)), 3),
        "regla_ambas_exactitud_balanceada": [round(float(np.mean(ba_regla)), 3), round(float(np.std(ba_regla)), 3)],
        "pasa_la_barra": bool(np.mean(ba) > np.mean(ba_regla)),
        "importancia": dict(sorted(((v, round(float(i), 3)) for v, i in zip(VARIABLES, m.feature_importances_)), key=lambda x: -x[1])),
        "inventario_05ha_p05": int(((pol["tipo"] == "inventario") & (pol["ha"] >= 0.5) & (pol["p_parque"] >= 0.5)).sum()),
        "inventario_05ha": int(((pol["tipo"] == "inventario") & (pol["ha"] >= 0.5)).sum()),
        "candidatas_p05": int(((pol["tipo"] == "candidata") & (pol["p_parque"] >= 0.5)).sum()),
        "candidatas": int((pol["tipo"] == "candidata").sum()),
    }
    (SALIDA / "rf-resumen.json").write_text(json.dumps(resumen, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(resumen, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
