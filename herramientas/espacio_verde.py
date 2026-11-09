"""
Distancia caminando al espacio verde o azul publico mas cercano, en todo Leon.

Orden del MASTER del 09/11/2026 (idea de Carlos). Prueba: no se publica en la plataforma.
Solo datos publicos: OpenStreetMap (inventario y calles), Sentinel-2 (NDVI de control) e
INEGI, Censo 2020 por manzana (poblacion). Todo en EPSG:32614.

Pasos:
  1. Inventario desde OSM: publico, privado y por confirmar. Los poligonos publicos que se
     tocan se funden en un solo espacio, para que el tamano sea el del parque entero.
  2. NDVI de control con la escena del 20/10/2026 (la de la apertura del observatorio):
     marca los espacios sin vegetacion real y busca zonas verdes grandes que OSM no tiene.
  3. Red peatonal: calles de OSM sin autopistas, partidas cada 25 m. La entrada a un espacio
     es cualquier punto de la red a 20 m o menos de su borde, o dentro.
  4. Distancia por la red desde cada celda de 100 m del limite urbano y desde cada manzana
     del censo, por clase de tamano. Es continua: los umbrales de NBS se aplican despues.

Las cifras de contraste y los umbrales de control se fijaron antes de medir, en
`ORDENES-DEL-MASTER/2026-11-09-distancia-a-espacio-verde-publico-RESPUESTA.md`.

Uso (desde la raiz del repo, con el python que tenga geopandas y rasterio):
  python herramientas/espacio_verde.py
Necesita `salidas/espacio-verde/osm/{espacios,relaciones,calles}.json` (Overpass, 09/11/2026)
y el censo de INEGI (ver RUTA_INEGI).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
import requests
from rasterio.features import shapes
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from rasterio.enums import Resampling
from scipy.ndimage import label
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree
from shapely import STRtree
from shapely.geometry import LineString, Point, Polygon, box, shape
from shapely.ops import polygonize, unary_union

RAIZ = Path(__file__).resolve().parents[1]
SALIDA = RAIZ / "salidas" / "espacio-verde"
OSM = SALIDA / "osm"
# Insumos publicos de INEGI que ya bajo CAUCE, con su hash en FUENTE.json. Se leen, no se copian.
RUTA_INEGI = RAIZ.parent / "8. CAUCE" / "inundaciones" / "insumos" / "inegi"
CRS = 32614

ESCENA_DIA = "2026-10-20"
NDVI_SIN_VEGETACION = 0.20
NDVI_ESCASA = 0.30
NDVI_CANDIDATA = 0.40
HA_CANDIDATA = 1.0
ACCESO_M = 20.0
ACCESO_MAXIMO_M = 150.0
PASO_RED_M = 25.0
CELDA_M = 100.0
# Criterios de NBS (14. NBS/ORDENES-DEL-MASTER/2026-11-09-criterios-espacio-verde-publico-RESPUESTA.md):
# minimo 0.5 ha (1 ha alternativa, OMS 2016); A-1 desde 0.15 ha como sensibilidad; B-2 y C-3 con los
# ejemplos de 4 y 7.5 ha de la NOM-001-SEDATU-2021, sec. 4.4.3.6. El tamano es sustituto de la escala.
CLASES_HA = {"a1": 0.15, "05ha": 0.5, "1ha": 1.0, "b2": 4.0, "c3": 7.5}
# Cortes: por calles 400 m (A-1), 600 m (B-2), 800 m (C-3); comparacion OMS 300 m en linea recta.
CORTES = {"a1": 400, "05ha": 400, "1ha": 400, "b2": 600, "c3": 800}

PRIVADO_ACCESO = {"private", "no", "customers", "members", "permit"}
# Nombres de instituciones o predios que OSM marca como parque pero no son espacio publico abierto.
NOMBRE_POR_CONFIRMAR = re.compile(
    r"(baldio|bald[ií]o|donaci[oó]n|sapal|\butl\b|icateg|experimental|upb|escuela|universidad|club|golf|country|"
    r"colegio|instituto|la salle|empresa|privad)",
    re.I,
)
NOMBRE_DEPORTIVA_PUBLICA = re.compile(r"(unidad depo|deportiva|polideportivo|comude|complejo municipal|campo deportivo)", re.I)


# ---------------------------------------------------------------- OSM a geometrias


def _anillo(geom: list[dict]) -> list[tuple[float, float]]:
    return [(p["lon"], p["lat"]) for p in geom]


def geometria_osm(el: dict):
    if el["type"] == "node":
        return Point(el["lon"], el["lat"])
    if el["type"] == "way":
        pts = _anillo(el["geometry"])
        if len(pts) >= 4 and pts[0] == pts[-1]:
            return Polygon(pts).buffer(0)
        return LineString(pts) if len(pts) >= 2 else None
    # Relacion multipoligono: se arma con sus miembros externos e internos.
    externos, internos = [], []
    for m in el.get("members", []):
        if m.get("type") != "way" or "geometry" not in m:
            continue
        linea = LineString(_anillo(m["geometry"]))
        (internos if m.get("role") == "inner" else externos).append(linea)
    poli_ext = unary_union(list(polygonize(externos))) if externos else None
    if poli_ext is None or poli_ext.is_empty:
        return None
    if internos:
        poli_ext = poli_ext.difference(unary_union(list(polygonize(internos))))
    return poli_ext.buffer(0)


def clasificar(t: dict) -> str:
    """publico_verde, publico_azul, privado, por_confirmar o contexto (no es espacio publico)."""
    leisure, landuse, natural = t.get("leisure"), t.get("landuse"), t.get("natural")
    nombre = t.get("name", "")
    if t.get("access") in PRIVADO_ACCESO or t.get("club") or leisure in {"golf_course", "water_park"}:
        return "privado"
    if natural == "water" or landuse == "reservoir":
        if t.get("water") in {"lake", "reservoir", "pond", None} and landuse != "basin":
            return "publico_azul"
        return "contexto"
    if leisure == "nature_reserve":
        return "area_natural"  # Sierra de Lobos y similares: no es parque urbano, va aparte
    if leisure in {"park", "garden", "recreation_ground", "common", "dog_park", "playground"} or landuse in {
        "recreation_ground",
        "village_green",
    } or t.get("place") == "square":
        return "por_confirmar" if NOMBRE_POR_CONFIRMAR.search(nombre) else "publico_verde"
    if leisure in {"sports_centre", "stadium"}:
        return "publico_verde" if NOMBRE_DEPORTIVA_PUBLICA.search(nombre) and not NOMBRE_POR_CONFIRMAR.search(nombre) else "por_confirmar"
    if leisure == "pitch":
        return "cancha"  # cuenta solo si queda dentro o pegada a un espacio publico
    return "contexto"  # pasto, panteones, bosque, matorral: tapan el NDVI pero no son parque


def inventario(municipio, urbano) -> gpd.GeoDataFrame:
    elementos = []
    for archivo in ("espacios.json", "relaciones.json"):
        datos = json.loads((OSM / archivo).read_text(encoding="utf-8"))["elements"]
        elementos += [e for e in datos if not (archivo == "espacios.json" and e["type"] == "relation")]
    filas = []
    for el in elementos:
        g = geometria_osm(el)
        if g is None or g.is_empty:
            continue
        t = el.get("tags", {})
        filas.append(
            {
                "osm": f"{el['type']}/{el['id']}",
                "nombre": t.get("name", ""),
                "etiqueta": next((f"{k}={t[k]}" for k in ("leisure", "landuse", "natural", "place", "amenity", "club") if k in t), ""),
                "acceso": t.get("access", ""),
                "clase": clasificar(t),
                "geometry": g,
            }
        )
    for fila in filas:
        fila["fuente"] = "osm"
    filas += areas_verdes_municipales()
    gdf = gpd.GeoDataFrame(filas, crs=4326).to_crs(CRS)
    zona = municipio.buffer(1000).union_all()
    gdf = gdf[gdf.intersects(zona)].copy()
    gdf["es_punto"] = gdf.geom_type == "Point"
    return gdf


def areas_verdes_municipales() -> list[dict]:
    """Capa «Areas Verdes» de la Plataforma de Informacion Estadistica y Geografica de Leon
    (plataformaleon.gob.mx/descarga.php, bajada el 09/11/2026): Jardin Publico (JP) y Parque Urbano (PU)
    del PMDUOET 2020. Es zonificacion, no inventario de campo: el NDVI y el filtro de cotos deciden
    si cuenta. Al fundir con OSM, lo que se encima queda como un solo espacio."""
    ruta = SALIDA / "descargas" / "Areas_verdes" / "doc.kml"
    if not ruta.exists():
        return []
    capa = gpd.read_file(ruta)
    uso = capa["description"].str.extract(r"<td>USOS</td>\s*<td>(\w+)</td>")[0]
    filas = []
    for g, u in zip(capa.geometry, uso):
        if g is None or g.is_empty:
            continue
        filas.append({"osm": f"pmduoet/{u}", "nombre": "", "etiqueta": f"pmduoet={u}", "acceso": "", "clase": "publico_verde",
                      "fuente": "municipal", "geometry": g.buffer(0)})
    return filas


def fundir(gdf: gpd.GeoDataFrame, clases: set[str]) -> gpd.GeoDataFrame:
    """Polignos que se tocan (3 m) forman un solo espacio. Conserva el nombre mas grande."""
    partes = gdf[gdf["clase"].isin(clases) & gdf.geom_type.isin(["Polygon", "MultiPolygon"])].copy()
    if partes.empty:
        return gpd.GeoDataFrame(columns=["geometry"], crs=CRS)
    unidos = unary_union(list(partes.buffer(3))).buffer(-3)
    piezas = [p for p in getattr(unidos, "geoms", [unidos]) if p.area > 1]
    esp = gpd.GeoDataFrame({"geometry": piezas}, crs=CRS)
    esp["id"] = [f"E{i:04d}" for i in range(len(esp))]
    union = gpd.sjoin(partes, esp, predicate="intersects")
    union["a"] = union.area
    union = union.sort_values("a", ascending=False)
    esp["nombre"] = esp["id"].map(union[union["nombre"] != ""].groupby("id")["nombre"].first()).fillna("")
    esp["osm"] = esp["id"].map(union.groupby("id")["osm"].apply(lambda s: ";".join(s[:8])))
    esp["etiquetas"] = esp["id"].map(union.groupby("id")["etiqueta"].apply(lambda s: ";".join(sorted(set(s)))))
    esp["ha"] = esp.area / 1e4
    return esp


# ---------------------------------------------------------------- NDVI de control


def ndvi_escena(limites: tuple[float, float, float, float]) -> tuple[np.ndarray, rasterio.Affine]:
    ruta = SALIDA / f"ndvi-{ESCENA_DIA}.tif"
    if ruta.exists():
        with rasterio.open(ruta) as r:
            return r.read(1), r.transform
    xmin, ymin, xmax, ymax = limites
    ancho, alto = int((xmax - xmin) / 10), int((ymax - ymin) / 10)
    transform = from_origin(xmin, ymax, 10, 10)
    cuerpo = {
        "collections": ["sentinel-2-c1-l2a"],
        "datetime": f"{ESCENA_DIA}T00:00:00Z/{ESCENA_DIA}T23:59:59Z",
        "bbox": list(gpd.GeoSeries([box(*limites)], crs=CRS).to_crs(4326).total_bounds),
        "limit": 10,
    }
    items = requests.post("https://earth-search.aws.element84.com/v1/search", json=cuerpo, timeout=60).json()["features"]
    rojo = np.full((alto, ancho), np.nan, np.float32)
    nir = np.full((alto, ancho), np.nan, np.float32)
    for it in items:
        print("escena", it["id"], it["properties"].get("s2:processing_baseline"))
        capas = {}
        for banda in ("red", "nir", "scl"):
            a = it["assets"][banda]
            with rasterio.open(a["href"]) as src, WarpedVRT(
                src, crs=CRS, transform=transform, width=ancho, height=alto, resampling=Resampling.nearest
            ) as vrt:
                v = vrt.read(1).astype(np.float32)
                rb = (a.get("raster:bands") or [{}])[0]
                if banda != "scl":
                    v = np.where(v == 0, np.nan, v * rb.get("scale", 1e-4) + rb.get("offset", 0.0))
                capas[banda] = v
        nubes = np.isin(capas["scl"], [0, 1, 3, 8, 9, 10, 11])
        ok = ~nubes & np.isfinite(capas["red"]) & np.isfinite(capas["nir"]) & np.isnan(rojo)
        rojo[ok], nir[ok] = capas["red"][ok], capas["nir"][ok]
    ndvi = np.where(rojo + nir > 0, (nir - rojo) / (nir + rojo), np.nan).astype(np.float32)
    with rasterio.open(ruta, "w", driver="GTiff", width=ancho, height=alto, count=1, dtype="float32", crs=CRS,
                       transform=transform, compress="deflate", nodata=np.nan) as dst:
        dst.write(ndvi, 1)
    return ndvi, transform


def ndvi_por_poligono(esp: gpd.GeoDataFrame, ndvi: np.ndarray, transform) -> pd.Series:
    from rasterio.features import rasterize

    ids = rasterize(((g, i + 1) for i, g in enumerate(esp.geometry)), out_shape=ndvi.shape, transform=transform, all_touched=False, dtype="int32")
    plano, valores = ids.ravel(), ndvi.ravel()
    # Solo tierra: el agua tiene NDVI negativo y, en un parque con lago como el Metropolitano, hunde la
    # mediana. Ajuste hecho al ver ese caso (09/11/2026), despues de fijar los umbrales; los umbrales no cambian.
    ok = (plano > 0) & np.isfinite(valores) & (valores > 0)
    df = pd.DataFrame({"i": plano[ok] - 1, "v": valores[ok]})
    med = df.groupby("i")["v"].median()
    # Espacios menores a un pixel: el pixel de su centro.
    salida = pd.Series(np.nan, index=range(len(esp)))
    salida.loc[med.index] = med.values
    faltan = salida.isna()
    for i in np.where(faltan)[0]:
        c = esp.geometry.iloc[i].representative_point()
        fila, col = rasterio.transform.rowcol(transform, c.x, c.y)
        if 0 <= fila < ndvi.shape[0] and 0 <= col < ndvi.shape[1]:
            salida.iloc[i] = ndvi[fila, col]
    return salida.values


def candidatas_fuera_de_osm(ndvi, transform, urbano, todo_osm) -> gpd.GeoDataFrame:
    from rasterio.features import rasterize

    dentro = rasterize([(g, 1) for g in urbano.geometry], out_shape=ndvi.shape, transform=transform, dtype="uint8")
    tapado = rasterize([(g, 1) for g in todo_osm.geometry if g.geom_type in ("Polygon", "MultiPolygon")], out_shape=ndvi.shape,
                       transform=transform, dtype="uint8", all_touched=True)
    verde = (np.nan_to_num(ndvi) >= NDVI_CANDIDATA) & (dentro == 1) & (tapado == 0)
    etiquetas, n = label(verde)
    tam = np.bincount(etiquetas.ravel())
    grandes = np.where(tam * 100 / 1e4 >= HA_CANDIDATA)[0]
    grandes = grandes[grandes > 0]
    mascara = np.isin(etiquetas, grandes)
    polis = [shape(g) for g, v in shapes(etiquetas.astype("int32"), mask=mascara, transform=transform)]
    cand = gpd.GeoDataFrame({"geometry": polis}, crs=CRS)
    cand = cand.dissolve().explode(index_parts=False).reset_index(drop=True) if len(cand) else cand
    cand["ha"] = cand.area / 1e4
    return cand[cand["ha"] >= HA_CANDIDATA].reset_index(drop=True)


# ---------------------------------------------------------------- red peatonal


def calles_privadas() -> gpd.GeoSeries:
    """Calles de acceso privado: casi siempre el interior de un fraccionamiento cerrado (coto)."""
    datos = json.loads((OSM / "calles.json").read_text(encoding="utf-8"))["elements"]
    lineas = [
        LineString([(p["lon"], p["lat"]) for p in el["geometry"]])
        for el in datos
        if el.get("tags", {}).get("access") in {"private", "no"} and el.get("tags", {}).get("foot") not in {"yes", "designated", "permissive"}
    ]
    return gpd.GeoSeries(lineas, crs=4326).to_crs(CRS)


def en_coto(esp: gpd.GeoDataFrame, xy: np.ndarray, privadas: gpd.GeoSeries) -> np.ndarray:
    """Probable area verde de coto: ninguna calle publica a 20 m del borde y si una privada."""
    arbol = cKDTree(xy)
    arbol_priv = STRtree(list(privadas.values))
    salida = np.zeros(len(esp), bool)
    for i, g in enumerate(esp.geometry):
        cerca = g.buffer(ACCESO_M)
        xa, ya, xb, yb = cerca.bounds
        cand = arbol.query_ball_point(((xa + xb) / 2, (ya + yb) / 2), r=np.hypot(xb - xa, yb - ya) / 2)
        publicas = gpd.GeoSeries.from_xy(xy[cand, 0], xy[cand, 1], crs=CRS).within(cerca).any() if cand else False
        salida[i] = (not publicas) and len(arbol_priv.query(cerca, predicate="intersects")) > 0
    return salida


def red_peatonal(zona) -> tuple[np.ndarray, coo_matrix]:
    datos = json.loads((OSM / "calles.json").read_text(encoding="utf-8"))["elements"]
    from pyproj import Transformer

    tr = Transformer.from_crs(4326, CRS, always_xy=True)
    indice: dict[tuple[int, int], int] = {}
    coords: list[tuple[float, float]] = []
    a_, b_, w_ = [], [], []

    def nodo(x: float, y: float) -> int:
        clave = (round(x * 10), round(y * 10))  # decimetro: los cruces de OSM comparten vertice exacto
        if clave not in indice:
            indice[clave] = len(coords)
            coords.append((x, y))
        return indice[clave]

    for el in datos:
        t = el.get("tags", {})
        if t.get("foot") in {"no", "private"} or (t.get("access") in {"private", "no"} and t.get("foot") not in {"yes", "designated", "permissive"}):
            continue
        lon = [p["lon"] for p in el["geometry"]]
        lat = [p["lat"] for p in el["geometry"]]
        xs, ys = tr.transform(lon, lat)
        previo = None
        for x0, y0, x1, y1 in zip(xs[:-1], ys[:-1], xs[1:], ys[1:]):
            largo = float(np.hypot(x1 - x0, y1 - y0))
            partes = max(1, int(np.ceil(largo / PASO_RED_M)))
            puntos = [(x0 + (x1 - x0) * k / partes, y0 + (y1 - y0) * k / partes) for k in range(partes + 1)]
            ids = [nodo(*p) for p in puntos]
            if previo is not None and previo != ids[0]:
                ids[0] = previo
            for u, v in zip(ids[:-1], ids[1:]):
                if u != v:
                    a_.append(u), b_.append(v), w_.append(largo / partes)
            previo = ids[-1]
    xy = np.array(coords)
    n = len(xy)
    m = coo_matrix((w_ + w_, (a_ + b_, b_ + a_)), shape=(n, n)).tocsr()
    return xy, m


def distancias(xy, grafo, espacios: gpd.GeoDataFrame) -> np.ndarray:
    """Distancia por la red desde cada nodo al espacio mas cercano del conjunto (nodo super-fuente)."""
    n = len(xy)
    arbol = cKDTree(xy)
    fuentes: dict[int, float] = {}
    for g in espacios.geometry:
        xa, ya, xb, yb = g.bounds
        cerca = arbol.query_ball_point(np.array(g.centroid.coords[0]), r=np.hypot(xb - xa, yb - ya) / 2 + ACCESO_MAXIMO_M)
        cerca = np.array(cerca, dtype=int)
        if len(cerca) == 0:
            continue
        borde = g.boundary
        pts = gpd.GeoSeries.from_xy(xy[cerca, 0], xy[cerca, 1], crs=CRS)
        dentro = pts.within(g).values
        d = np.array(pts.distance(borde).values, dtype=float)
        d[dentro] = 0.0
        ok = d <= ACCESO_M
        if not ok.any():
            k = int(np.argmin(d))
            ok = np.zeros(len(d), bool)
            ok[k] = d[k] <= ACCESO_MAXIMO_M
        for i, di in zip(cerca[ok], d[ok]):
            fuentes[int(i)] = min(fuentes.get(int(i), np.inf), float(di))
    filas = [n] * len(fuentes)
    cols = list(fuentes.keys())
    pesos = [max(v, 1e-6) for v in fuentes.values()]
    g2 = grafo.tocoo()
    total = coo_matrix(
        (np.concatenate([g2.data, pesos]), (np.concatenate([g2.row, filas]), np.concatenate([g2.col, cols]))), shape=(n + 1, n + 1)
    ).tocsr()
    return dijkstra(total, directed=True, indices=n)[:n]


def a_origenes(puntos: gpd.GeoSeries, xy, dist_nodo, espacios) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Distancia de cada origen: tramo recto hasta la red + red. Cero si el origen esta dentro."""
    arbol = cKDTree(xy)
    p = np.column_stack([puntos.x.values, puntos.y.values])
    d_acceso, k = arbol.query(p)
    red = dist_nodo[k] + d_acceso
    arbol_esp = STRtree(list(espacios.geometry))
    idx, recta = arbol_esp.query_nearest(list(puntos.values), return_distance=True, all_matches=False)
    linea = np.full(len(p), np.inf)
    linea[idx[0]] = recta
    red[linea == 0] = 0
    return red, linea, d_acceso


# ---------------------------------------------------------------- poblacion


def manzanas_con_poblacion(municipio) -> gpd.GeoDataFrame:
    mz = gpd.read_file(f"zip://{RUTA_INEGI / '11_guanajuato.zip'}!conjunto_de_datos/11m.shp", where="CVE_MUN = '020'")
    import zipfile

    with zipfile.ZipFile(RUTA_INEGI / "resageburb_11csv20.zip") as z:
        censo = pd.read_csv(z.open("RESAGEBURB_11CSV20.csv"), dtype=str, encoding="utf-8-sig")
    censo = censo[(censo["MUN"] == "020") & (censo["MZA"] != "000")].copy()
    censo["CVEGEO"] = censo["ENTIDAD"].str.zfill(2) + censo["MUN"] + censo["LOC"] + censo["AGEB"] + censo["MZA"]
    censo["pob"] = pd.to_numeric(censo["POBTOT"], errors="coerce")
    mz = mz.merge(censo[["CVEGEO", "pob"]], on="CVEGEO", how="left").to_crs(CRS)
    return mz


# ---------------------------------------------------------------- principal


def main() -> None:
    municipio = gpd.read_file(RAIZ / "public" / "capas" / "LIMITE.geojson").to_crs(CRS)
    urbano = gpd.read_file(RAIZ / "public" / "capas" / "LIMITE_URBANO.geojson").to_crs(CRS)
    zona = municipio.buffer(1000).union_all()

    inv = inventario(municipio, urbano)
    publico = fundir(inv, {"publico_verde"})
    # Canchas sueltas: cuentan solo si quedan dentro o pegadas a un espacio publico.
    canchas = inv[inv["clase"] == "cancha"]
    pegadas = canchas[canchas.buffer(3).intersects(publico.union_all())] if len(publico) else canchas.iloc[0:0]
    inv.loc[pegadas.index, "clase"] = "publico_verde"
    inv.loc[(inv["clase"] == "cancha"), "clase"] = "por_confirmar"
    verde = fundir(inv, {"publico_verde"})
    azul = fundir(inv, {"publico_azul"})
    verde["tipo"], azul["tipo"] = "verde", "azul"

    ndvi, transform = ndvi_escena(tuple(zona.bounds))
    verde["ndvi"] = ndvi_por_poligono(verde, ndvi, transform)
    n = verde["ndvi"].fillna(-1)
    verde["control"] = np.select([n < NDVI_SIN_VEGETACION, n < NDVI_ESCASA], ["sin vegetacion", "escasa"], "verde")
    candidatas = candidatas_fuera_de_osm(ndvi, transform, urbano, inv)

    xy, grafo = red_peatonal(zona)
    print("red", len(xy), "nodos", grafo.nnz // 2, "tramos")
    verde["coto"] = en_coto(verde, xy, calles_privadas())
    # Base de NBS: con vegetacion (fuera plazas duras) y fuera de cotos.
    verde["cuenta"] = (verde["control"] != "sin vegetacion") & ~verde["coto"]
    azul["coto"] = en_coto(azul, xy, calles_privadas())

    # Celdas de 100 m cuyo centro cae en el limite urbano.
    x0, y0, x1, y1 = urbano.total_bounds
    gx, gy = np.meshgrid(np.arange(x0 + CELDA_M / 2, x1, CELDA_M), np.arange(y0 + CELDA_M / 2, y1, CELDA_M))
    centros = gpd.GeoSeries.from_xy(gx.ravel(), gy.ravel(), crs=CRS)
    centros = centros[centros.within(urbano.union_all())].reset_index(drop=True)

    mz = manzanas_con_poblacion(municipio)
    puntos_mz = mz.representative_point()
    mz["urbano"] = puntos_mz.within(urbano.union_all())

    conjuntos = {}
    base = verde[verde["cuenta"]]
    azul_ok = azul[~azul["coto"]]
    for nombre, ha in CLASES_HA.items():
        conjuntos[f"base_{nombre}"] = base[base["ha"] >= ha]
        conjuntos[f"azul_{nombre}"] = pd.concat([base[base["ha"] >= ha], azul_ok[azul_ok["ha"] >= ha]], ignore_index=True)
    # Sensibilidad: el inventario de OSM tal cual, sin el filtro de NDVI ni el de cotos.
    conjuntos["osm_05ha"] = verde[verde["ha"] >= 0.5]

    celdas = gpd.GeoDataFrame(geometry=centros.buffer(CELDA_M / 2, cap_style="square"), crs=CRS)
    for clave, conj in conjuntos.items():
        conj = gpd.GeoDataFrame(conj, crs=CRS)
        dn = distancias(xy, grafo, conj)
        red, linea, acceso = a_origenes(centros, xy, dn, conj)
        celdas[f"{clave}_red"], celdas[f"{clave}_linea"] = np.round(red), np.round(linea)
        red, linea, acceso_mz = a_origenes(puntos_mz, xy, dn, conj)
        mz[f"{clave}_red"], mz[f"{clave}_linea"] = np.round(red), np.round(linea)
        print(clave, len(conj), "espacios; mediana celdas", np.nanmedian(celdas[f"{clave}_red"][np.isfinite(celdas[f"{clave}_red"])]))
    celdas["acceso_red_m"] = np.round(acceso)
    mz["acceso_red_m"] = np.round(acceso_mz)

    verde.to_file(SALIDA / "espacio-verde.gpkg", layer="verde_publico", driver="GPKG")
    azul.to_file(SALIDA / "espacio-verde.gpkg", layer="azul_publico", driver="GPKG")
    otros = inv[inv["clase"].isin(["privado", "por_confirmar", "area_natural"])].copy()
    otros = otros[otros.geom_type.isin(["Polygon", "MultiPolygon"])]
    otros["ha"] = otros.area / 1e4
    otros.to_file(SALIDA / "espacio-verde.gpkg", layer="privado_y_por_confirmar", driver="GPKG")
    candidatas.to_file(SALIDA / "espacio-verde.gpkg", layer="candidatas_ndvi_fuera_de_osm", driver="GPKG")
    celdas.to_file(SALIDA / "espacio-verde.gpkg", layer="distancia_celdas_100m", driver="GPKG")
    mz[[c for c in mz.columns if c != "geometry"] + ["geometry"]].to_file(SALIDA / "espacio-verde.gpkg", layer="distancia_manzanas", driver="GPKG")
    inv[inv["es_punto"]].to_file(SALIDA / "espacio-verde.gpkg", layer="osm_solo_punto", driver="GPKG")
    print("listo", SALIDA / "espacio-verde.gpkg")


if __name__ == "__main__":
    main()
