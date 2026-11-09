"""
Muestra para revisar en imagen los espacios verdes que cuentan (orden del MASTER, 09/11/2026).

Al azar, estratificada por tamano (menos de 0.5 ha, 0.5 a 2, 2 a 4, 4 o mas) y por fuente (solo
capa municipal, solo OSM, ambas): hasta 11 por estrato, unos 100 en total, semilla fija. Deja:
  - `muestra-revision.csv`: una fila por poligono, con la evidencia que hay sin imagen de alta
    resolucion y las columnas que llena quien revisa (es_parque: si / no / dudoso; que_es).
  - `muestra-revision.kml`: los mismos poligonos, para abrirlos en un visor de imagen.

Despues, `espacio_verde_muestra.py --corregir` toma el CSV revisado, calcula la tasa de falsos
positivos por estrato y corrige el A-1 base (0.5 ha a 400 m por calles) como rango.
"""

from __future__ import annotations

import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

RAIZ = Path(__file__).resolve().parents[1]
SALIDA = RAIZ / "salidas" / "espacio-verde"
GPKG = SALIDA / "espacio-verde.gpkg"
POR_ESTRATO = 11
SEMILLA = 20261109
TAMANOS = [(0, 0.5, "menos de 0.5 ha"), (0.5, 2, "0.5 a 2 ha"), (2, 4, "2 a 4 ha"), (4, 1e9, "4 ha o mas")]


def fuente(etiquetas: str) -> str:
    partes = set(etiquetas.split(";"))
    muni = any(p.startswith("pmduoet") for p in partes)
    osm = any(not p.startswith("pmduoet") for p in partes if p)
    return "ambas" if muni and osm else ("solo municipal" if muni else "solo OSM")


def estratos(verde: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    v = verde[verde["cuenta"].astype(bool)].copy()
    v["fuente"] = v["etiquetas"].fillna("").map(fuente)
    v["tamano"] = pd.cut(v["ha"], [t[0] for t in TAMANOS] + [1e9], right=False, labels=[t[2] for t in TAMANOS]).astype(str)
    return v


def evidencia(m: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Lo que se sabe sin imagen: forma (un camellon es largo y angosto) y lo que dice OSM alrededor."""
    rect = m.geometry.minimum_rotated_rectangle()
    lados = rect.apply(lambda r: sorted(np.hypot(*np.diff(np.array(r.exterior.coords)[:3], axis=0).T)))
    m["ancho_m"] = lados.map(lambda l: round(l[0], 1))
    m["largo_m"] = lados.map(lambda l: round(l[1], 1))
    m["alargamiento"] = (m["largo_m"] / m["ancho_m"].clip(lower=1)).round(1)
    m["camellon_probable"] = (m["ancho_m"] < 25) & (m["alargamiento"] > 6)
    otros = gpd.read_file(GPKG, layer="privado_y_por_confirmar")
    m["toca_privado_o_dudoso"] = m.geometry.buffer(5).intersects(otros.union_all())
    c = m.geometry.representative_point().to_crs(4326)
    m["lon"], m["lat"] = c.x.round(6), c.y.round(6)
    return m


def preparar() -> None:
    verde = gpd.read_file(GPKG, layer="verde_publico")
    v = estratos(verde)
    rng = np.random.default_rng(SEMILLA)
    partes = []
    for (t, f), grupo in v.groupby(["tamano", "fuente"]):
        n = min(POR_ESTRATO, len(grupo))
        partes.append(grupo.iloc[rng.choice(len(grupo), size=n, replace=False)])
    m = evidencia(gpd.GeoDataFrame(pd.concat(partes), crs=v.crs))
    m = m.sort_values(["tamano", "fuente", "id"]).reset_index(drop=True)
    m["n"] = range(1, len(m) + 1)
    m["es_parque"] = ""  # si / no / dudoso: parque o jardin de acceso libre
    m["que_es"] = ""  # si no: camellon, baldio, cultivo, coto, otro
    m["nota"] = ""
    cols = ["n", "id", "tamano", "fuente", "ha", "ndvi", "control", "nombre", "etiquetas", "ancho_m", "largo_m",
            "alargamiento", "camellon_probable", "toca_privado_o_dudoso", "lon", "lat", "es_parque", "que_es", "nota"]
    m["ha"] = m["ha"].round(2)
    m["ndvi"] = m["ndvi"].round(2)
    m[cols].to_csv(SALIDA / "muestra-revision.csv", index=False, encoding="utf-8-sig")
    m[["n", "id", "tamano", "fuente", "ha", "geometry"]].assign(Name=m["n"].astype(str)).to_crs(4326).to_file(
        SALIDA / "muestra-revision.kml", driver="KML")
    tabla = v.groupby(["tamano", "fuente"]).size().rename("poblacion").to_frame().join(m.groupby(["tamano", "fuente"]).size().rename("muestra"))
    print(tabla.to_string())
    print("muestra", len(m))


def corregir(sorteos: int = 2000) -> None:
    """A-1 base corregido por los falsos positivos de la muestra, como rango.

    Por estrato, la proporcion de parques reales sigue una Beta(si + 0.5, no + 0.5) (Jeffreys). En cada
    sorteo se toma una proporcion por estrato, se conserva al azar esa fraccion de espacios y se vuelve a
    contar la poblacion a 400 m por calles. Dos escenarios: lo dudoso como «no» y lo dudoso como «si».
    """
    import json
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import dijkstra
    from scipy.spatial import cKDTree

    sys.path.insert(0, str(Path(__file__).parent))
    import espacio_verde as ev

    revision = pd.read_csv(SALIDA / "muestra-revision.csv")
    verde = estratos(gpd.read_file(GPKG, layer="verde_publico"))
    base = verde[verde["ha"] >= 0.5].reset_index(drop=True)
    mz = gpd.read_file(GPKG, layer="distancia_manzanas")
    mz = mz[mz["urbano"].astype(bool) & mz["pob"].notna()].reset_index(drop=True)
    puntos = mz.representative_point()
    pob = mz["pob"].to_numpy(float)

    municipio = gpd.read_file(RAIZ / "public" / "capas" / "LIMITE.geojson").to_crs(32614)
    xy, grafo = ev.red_peatonal(municipio.buffer(1000).union_all())
    arbol = cKDTree(xy)
    acceso, k = arbol.query(np.column_stack([puntos.x, puntos.y]))
    n = len(xy)
    g2 = grafo.tocoo()

    # Cobertura de cada espacio: manzanas a 400 m o menos por calles (o dentro del espacio). Se guarda:
    # tarda unos 10 minutos y no cambia mientras no cambie el inventario.
    cache = SALIDA / "cobertura-a1.npz"
    if cache.exists() and list(np.load(cache, allow_pickle=True)["ids"]) == list(base["id"]):
        cubre = np.load(cache)["cubre"]
    else:
        cubre = np.zeros((len(base), len(mz)), bool)
        for i, g in enumerate(base.geometry):
            d = ev.distancias(xy, grafo, gpd.GeoDataFrame(geometry=[g], crs=32614))
            cubre[i] = (d[k] + acceso <= 400) | puntos.within(g).to_numpy()
        np.savez_compressed(cache, cubre=cubre, ids=np.array(base["id"]))
    total = pob.sum()
    sin_correccion = 100 * pob[cubre.any(0)].sum() / total

    # Condiciones del juez (dictamen de la revision ciega, 09/11/2026):
    #  1. deportivos abiertos sin vegetacion: dos variantes, con y sin ellos;
    #  2. #63 Canada Arroyo Hondo: ANP municipal con horario y reglas de acceso; fuera de la cota baja;
    #  3. A-1 solo como rango.
    # Los poligonos revisados usan su propia etiqueta; los demas, la proporcion de su estrato.
    deportivos, canada = {5, 82, 62, 11, 59}, 63
    claves = list(zip(base["tamano"], base["fuente"]))
    rng = np.random.default_rng(SEMILLA)
    salida = {"sin_correccion_pct": round(float(sin_correccion), 1), "espacios_05ha": int(len(base)), "variantes": {}}
    for variante, deporte_es in (("sin_deportivos_sin_vegetacion", "no"), ("con_deportivos_sin_vegetacion", "si")):
        for cota, dudoso_es, canada_es in (("baja", "no", "no"), ("alta", "si", "si")):
            r = revision.assign(etiqueta=revision["es_parque"].replace({"dudoso": dudoso_es}))
            r.loc[r["n"].isin(deportivos), "etiqueta"] = deporte_es
            r.loc[r["n"] == canada, "etiqueta"] = canada_es
            conteo = r.groupby(["tamano", "fuente"])["etiqueta"].agg(si=lambda x: (x == "si").sum(), no=lambda x: (x == "no").sum())
            fija = dict(zip(r["id"], r["etiqueta"] == "si"))
            resultados = []
            for _ in range(sorteos):
                prop = {c: rng.beta(conteo.loc[c, "si"] + 0.5, conteo.loc[c, "no"] + 0.5) for c in conteo.index}
                queda = np.array([fija[i] if i in fija else rng.random() < prop[c] for i, c in zip(base["id"], claves)])
                resultados.append(100 * pob[cubre[queda].any(0)].sum() / total if queda.any() else 0.0)
            resultados = np.array(resultados)
            salida["variantes"].setdefault(variante, {})[cota] = {
                "mediana": round(float(np.median(resultados)), 1),
                "p05": round(float(np.percentile(resultados, 5)), 1),
                "p95": round(float(np.percentile(resultados, 95)), 1),
            }
        v = salida["variantes"][variante]
        v["rango"] = [v["baja"]["p05"], v["alta"]["p95"]]
    (SALIDA / "correccion-a1.json").write_text(json.dumps(salida, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(salida, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    corregir() if "--corregir" in sys.argv else preparar()
