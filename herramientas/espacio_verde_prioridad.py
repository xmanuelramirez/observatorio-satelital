"""
Zonas prioritarias robustas y mapa de prueba (orden del MASTER, 09/11/2026).

Tres inventarios de espacios de 0.5 ha o mas (los que cuentan para el A-1 base):
  - baja:   revisados, solo si los dos revisores dijeron «si»; no revisados, solo si coinciden OSM y
            municipio y el modelo da p >= 0.5. Sin deportivos sin vegetacion ni el #63.
  - modelo: revisados, la etiqueta en que coinciden los dos revisores; los demas, p >= 0.5.
  - alta:   revisados, «si» de cualquiera de los dos (incluye dudosos, deportivos y el #63); no
            revisados, p >= 0.4 o coinciden OSM y municipio.
Una manzana queda «fuera» si no tiene a 400 m por calles un espacio de 0.5 ha, ni a 600 m uno de 4 ha,
ni a 800 m uno de 7.5 ha (NOM-001-SEDATU-2021, criterios de NBS). Las AGEB se ordenan por habitantes
fuera; prioritaria robusta = entre las primeras 20 en los tres inventarios.

Uso: python herramientas/espacio_verde_prioridad.py <carpeta scripts de la skill de mapas>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

sys.path.insert(1, str(Path(__file__).parent))
import espacio_verde as ev  # noqa: E402
from espacio_verde_muestra import estratos  # noqa: E402

RAIZ = Path(__file__).resolve().parents[1]
SALIDA = RAIZ / "salidas" / "espacio-verde"
GPKG = SALIDA / "espacio-verde.gpkg"
TOP = 20
DEPORTIVOS, CANADA = {5, 82, 62, 11, 59}, 63
LAGUNAS_A_CONFIRMAR = ["C0314", "C0401"]


def distancias_por_espacio(base, puntos_mz, centros):
    """Distancia por calles de cada manzana y cada celda a cada espacio. Se guarda: tarda."""
    cache = SALIDA / "distancias-por-espacio.npz"
    if cache.exists():
        z = np.load(cache, allow_pickle=True)
        if list(z["ids"]) == list(base["id"]):
            return z["mz"], z["celdas"]
    municipio = gpd.read_file(RAIZ / "public" / "capas" / "LIMITE.geojson").to_crs(32614)
    xy, grafo = ev.red_peatonal(municipio.buffer(1000).union_all())
    arbol = cKDTree(xy)
    am, km = arbol.query(np.column_stack([puntos_mz.x, puntos_mz.y]))
    ac, kc = arbol.query(np.column_stack([centros.x, centros.y]))
    dm = np.zeros((len(base), len(puntos_mz)), np.float32)
    dc = np.zeros((len(base), len(centros)), np.float32)
    for i, g in enumerate(base.geometry):
        d = ev.distancias(xy, grafo, gpd.GeoDataFrame(geometry=[g], crs=32614))
        dm[i] = np.where(puntos_mz.within(g), 0, d[km] + am)
        dc[i] = np.where(centros.within(g), 0, d[kc] + ac)
    np.savez_compressed(cache, mz=dm, celdas=dc, ids=np.array(base["id"]))
    return dm, dc


def inventarios(base: pd.DataFrame) -> dict[str, np.ndarray]:
    mia = pd.read_csv(SALIDA / "muestra-revision.csv")
    juez = pd.read_csv(RAIZ / "ORDENES-DEL-MASTER" / "2026-11-09-REVISION-CIEGA-JUEZ-espacio-verde.csv")
    rev = mia.merge(juez[["n", "es_parque"]].rename(columns={"es_parque": "juez"}), on="n")
    rev = rev[rev["id"].isin(base["id"])].set_index("id")
    p = base["p_parque"].to_numpy()
    ambas = base["fuente"].eq("ambas").to_numpy()
    salida = {"baja": (p >= 0.5) & ambas, "modelo": p >= 0.5, "alta": (p >= 0.4) | ambas}
    for i, ident in enumerate(base["id"]):
        if ident not in rev.index:
            continue
        r = rev.loc[ident]
        ambos_si = r["es_parque"] == "si" and r["juez"] == "si"
        alguno_si = "si" in (r["es_parque"], r["juez"]) or "dudoso" in (r["es_parque"], r["juez"])
        acuerdo = r["es_parque"] == r["juez"] and r["es_parque"] in ("si", "no")
        especial = int(r["n"]) in DEPORTIVOS or int(r["n"]) == CANADA
        salida["baja"][i] = ambos_si and not especial
        salida["alta"][i] = alguno_si or especial
        if acuerdo:
            salida["modelo"][i] = r["es_parque"] == "si"
    return salida


def fuera(d: np.ndarray, ha: np.ndarray, incluye: np.ndarray) -> np.ndarray:
    """Distancias (espacios x origenes) -> origen fuera de las tres distancias de la NOM."""
    def cerca(min_ha, corte):
        sel = incluye & (ha >= min_ha)
        return (d[sel] <= corte).any(0) if sel.any() else np.zeros(d.shape[1], bool)
    return ~(cerca(0.5, 400) | cerca(4, 600) | cerca(7.5, 800))


def main() -> None:
    verde = estratos(gpd.read_file(GPKG, layer="verde_publico"))
    rf = gpd.read_file(GPKG, layer="rf_probabilidad")[["id", "p_parque"]]
    base = verde[verde["ha"] >= 0.5].merge(rf, on="id", how="left").reset_index(drop=True)
    mz = gpd.read_file(GPKG, layer="distancia_manzanas")
    mz = mz[mz["urbano"].astype(bool) & mz["pob"].notna()].reset_index(drop=True)
    celdas = gpd.read_file(GPKG, layer="distancia_celdas_100m")
    dm, dc = distancias_por_espacio(base, mz.representative_point(), celdas.geometry.centroid)
    ha = base["ha"].to_numpy()
    inv = inventarios(base)

    ageb_geom = gpd.read_file(f"zip://{ev.RUTA_INEGI / '11_guanajuato.zip'}!conjunto_de_datos/11a.shp",
                              where="CVE_MUN = '020'").to_crs(32614).set_index("CVEGEO")[["geometry"]]
    mz["ageb"] = mz["CVEGEO"].str[:13]
    cifras, rangos = {}, {}
    pob = mz["pob"].to_numpy(float)
    for nombre, incluye in inv.items():
        f = fuera(dm, ha, incluye)
        a1 = (dm[incluye] <= 400).any(0)
        cifras[nombre] = {"espacios": int(incluye.sum()), "a1_pct": round(100 * pob[a1].sum() / pob.sum(), 1),
                          "fuera_de_las_tres_pct": round(100 * pob[f].sum() / pob.sum(), 1)}
        orden = mz.assign(f=pob * f).groupby("ageb")["f"].sum().sort_values(ascending=False)
        rangos[nombre] = {a: i + 1 for i, a in enumerate(orden.index)}
        mz[f"fuera_{nombre}"] = f
    top = {n: {a for a, r in rangos[n].items() if r <= TOP} for n in inv}
    robustas = top["baja"] & top["modelo"] & top["alta"]
    dependen = (top["baja"] | top["modelo"] | top["alta"]) - robustas
    hab = mz.groupby("ageb")["pob"].sum()
    tabla = pd.DataFrame({
        "ageb": sorted(robustas | dependen, key=lambda a: rangos["modelo"][a]),
    })
    for n in inv:
        tabla[f"rango_{n}"] = tabla["ageb"].map(rangos[n])
        tabla[f"fuera_{n}"] = tabla["ageb"].map(mz.groupby("ageb").apply(lambda g: int(g.loc[g[f"fuera_{n}"], "pob"].sum())))
    tabla["habitantes"] = tabla["ageb"].map(hab).astype(int)
    tabla["robusta"] = tabla["ageb"].isin(robustas)
    c = ageb_geom.loc[tabla["ageb"]].geometry.representative_point().to_crs(4326)
    tabla["lon"], tabla["lat"] = c.x.round(4).values, c.y.round(4).values
    tabla.to_csv(SALIDA / "zonas-prioritarias.csv", index=False, encoding="utf-8-sig")
    gpd.GeoDataFrame(tabla, geometry=ageb_geom.loc[tabla["ageb"]].geometry.values, crs=32614).to_file(
        GPKG, layer="zonas_prioritarias_robustas", driver="GPKG")
    resumen = {"inventarios": cifras, "top": TOP, "robustas": len(robustas), "dependen_del_escenario": len(dependen)}
    (SALIDA / "zonas-prioritarias.json").write_text(json.dumps(resumen, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(resumen, ensure_ascii=False, indent=1))
    print(tabla.drop(columns=["lon", "lat"]).to_string())

    # Distancia de cada celda en el escenario del modelo, para el mapa.
    celdas["d_modelo"] = np.where(inv["modelo"].any(), dc[inv["modelo"]].min(0), np.inf)
    celdas[["d_modelo", "geometry"]].to_file(GPKG, layer="celdas_modelo", driver="GPKG")
    base.assign(en_modelo=inv["modelo"])[["id", "nombre", "ha", "p_parque", "en_modelo", "geometry"]].to_file(
        GPKG, layer="espacios_modelo", driver="GPKG")
    mapa(sys.argv[1], base[inv["modelo"]], tabla, ageb_geom, cifras)


def mapa(skill: str, parques, tabla, ageb_geom, cifras) -> None:
    sys.path.insert(0, skill)
    import comun
    from comun import C, barra_escala, figura, leyenda_vertical, recortar, rosa_vientos
    import rasterio
    from matplotlib import patheffects as pe
    from rasterio.enums import Resampling
    from rasterio.windows import from_bounds

    comun.estilo()
    urbano = gpd.read_file(RAIZ / "public" / "capas" / "LIMITE_URBANO.geojson").to_crs(32614)
    municipio = gpd.read_file(RAIZ / "public" / "capas" / "LIMITE.geojson").to_crs(32614)
    celdas = gpd.read_file(GPKG, layer="celdas_modelo")
    azul = gpd.read_file(GPKG, layer="azul_publico")
    cand = gpd.read_file(GPKG, layer="rf_probabilidad")
    lagunas = cand[cand["id"].isin(LAGUNAS_A_CONFIRMAR)].copy()
    # Son poligonos de pixeles: se suavizan para que el contorno se lea.
    lagunas["geometry"] = lagunas.buffer(30).buffer(-30).simplify(15)
    fig, ax = figura(alto_cm=15.0)
    x0, y0, x1, y1 = urbano.total_bounds
    mx, my, abajo = (x1 - x0) * 0.09, (y1 - y0) * 0.09, (y1 - y0) * 0.40
    ax.set_xlim(x0 - mx, x1 + mx)
    ax.set_ylim(y0 - abajo, y1 + my)
    with rasterio.open(RAIZ.parent / "0. CAPAS VARIAS" / "HILLSHADE_LEON.tif") as r:
        v = from_bounds(x0 - mx, y0 - abajo, x1 + mx, y1 + my, r.transform)
        alto = int(1700 * (y1 - y0 + my + abajo) / (x1 - x0 + 2 * mx))
        sombra = r.read(1, window=v, out_shape=(alto, 1700), boundless=True, fill_value=0,
                        resampling=Resampling.bilinear).astype("float32") / 255.0
    img = ax.imshow(sombra, extent=(x0 - mx, x1 + mx, y0 - abajo, y1 + my), cmap="gray", vmin=-0.55, vmax=1.55,
                    alpha=0.5, zorder=1, interpolation="bilinear")
    recortar(ax, img, municipio.union_all())
    d = celdas["d_modelo"]
    for lo, hi, alfa in [(400, 600, 0.22), (600, 800, 0.42), (800, 1e12, 0.66)]:
        sel = celdas[(d > lo) & (d <= hi)]
        if len(sel):
            sel.plot(ax=ax, color=C["navy"], alpha=alfa, linewidth=0, zorder=3)
    parques.plot(ax=ax, color=C["regenerada"], linewidth=0, zorder=5)
    azul[azul.intersects(urbano.buffer(2000).union_all())].plot(ax=ax, color=C["superficial"], linewidth=0, zorder=5)
    lagunas.boundary.plot(ax=ax, color=C["superficial"], linewidth=1.0, linestyle=(0, (3, 2)), zorder=6)
    urbano.boundary.plot(ax=ax, color=C["navy"], linewidth=0.8, zorder=6)
    rob = tabla[tabla["robusta"]].reset_index(drop=True)
    dep = tabla[~tabla["robusta"]]
    gpd.GeoSeries(ageb_geom.loc[dep["ageb"]].geometry.values, crs=32614).boundary.plot(
        ax=ax, color=C["navy"], linewidth=0.6, linestyle=(0, (2, 2)), zorder=7)
    geo_rob = ageb_geom.loc[rob["ageb"]].geometry.values
    gpd.GeoSeries(geo_rob, crs=32614).boundary.plot(ax=ax, color=C["navy"], linewidth=1.4, zorder=8)
    puestos = []
    for k, g in enumerate(geo_rob, start=1):
        p = g.representative_point()
        while any(p.distance(q) < 700 for q in puestos):
            p = type(p)(p.x + 750, p.y)
        puestos.append(p)
        ax.text(p.x, p.y, str(k), fontsize=7, color=C["navy"], weight="bold", ha="center", va="center", zorder=9,
                path_effects=[pe.withStroke(linewidth=2.4, foreground="white", alpha=0.9)])
    # El rango que se publica es el de la muestra corregida (dos variantes de deportivos), no el determinista.
    var = json.loads((SALIDA / "correccion-a1.json").read_text(encoding="utf-8"))["variantes"]
    b = min(v["rango"][0] for v in var.values())
    a = max(v["rango"][1] for v in var.values())
    m = cifras["modelo"]["a1_pct"]
    leyenda_vertical(ax, [
        ("area", dict(color=C["regenerada"]), "Espacio verde público de 0.5 ha o más (modelo)"),
        ("area", dict(color=C["superficial"]), "Cuerpo de agua"),
        ("linea", dict(color=C["superficial"], ls=(0, (3, 2)), lw=1.0), "Laguna con arbolado, a confirmar"),
        ("area", dict(color="white", ec=C["navy"], lw=0.5), f"Hasta 400 m caminando: {m:.0f} % (rango {b:.0f}–{a:.0f} %)"),
        ("area", dict(color=C["navy"], alpha=0.22), "A 400–600 m"),
        ("area", dict(color=C["navy"], alpha=0.42), "A 600–800 m"),
        ("area", dict(color=C["navy"], alpha=0.66), "A más de 800 m"),
        ("linea", dict(color=C["navy"], lw=1.4), "AGEB prioritaria en los tres escenarios"),
        ("linea", dict(color=C["navy"], lw=0.6, ls=(0, (2, 2))), "AGEB prioritaria solo en algún escenario"),
    ], x=0.035, y=0.030, tam=6.4, salto=0.034, anclaje="izquierda")
    barra_escala(ax, 5000, "5 km", x=0.968, y=0.045, anclaje="derecha")
    rosa_vientos(ax, x=0.93, y=0.89, radio=0.045)
    ruta = SALIDA / "mapa-prueba-distancia-espacio-verde.png"
    fig.savefig(ruta, dpi=300, facecolor="white")
    from PIL import Image
    im = Image.open(ruta)
    fondo = Image.new("RGB", im.size, "white")
    fondo.paste(im.convert("RGBA"), mask=im.convert("RGBA").split()[-1])
    fondo.save(ruta, dpi=(300, 300))
    print("mapa", ruta)


if __name__ == "__main__":
    main()
