"""
Planeacion Integral, frente 4: datos del mapa de calor factibilidad -> convenio con el ritmo de consolidacion encima.
Metodo declarado en `ORDENES-DEL-MASTER/2026-11-19-planeacion-integral-METODO.md` (seccion 4). Solo agregados; el mapa
final lo arma MAPAS.

- Rejilla de hexagonos de 500 m (lado) sobre el municipio, EPSG:32614.
- Factibilidad: union anual 2021-2026 del KMZ de Nuevos Desarrollos (la misma lectura que reviso el juez), ha por hexagono.
- Convenio: `convenios-2019-hoy.geojson` (ND), ha y unidades por hexagono repartidas por superficie; contratadas con tope y
  por contratar (= unidades - contratadas) de la salida de 1b, con el mismo reparto.
- Encima: un punto por convenio habitacional con su clase de ritmo de consolidacion (1b).
- Tabla por sector (454 + fuera de sectores).

Uso: python herramientas/pi_4_mapa_calor.py
"""

import json
import math
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import Polygon

sys.path.insert(0, str(Path(__file__).resolve().parent))
import indicadores_medir as im  # noqa: E402  (lector del KMZ de factibilidades y sectores)

RAIZ = Path(__file__).resolve().parents[1]
APPS = RAIZ.parent
SAL = RAIZ / "salidas" / "planeacion-integral"
CONV = APPS / "13. NUEVOS DESARROLLOS" / "salidas" / "planeacion-integral" / "convenios-2019-hoy.geojson"
UTM = 32614
LADO = 500.0
FUERA = "fuera_de_sectores"


def hexagonos(limite) -> gpd.GeoDataFrame:
    x0, y0, x1, y1 = limite.bounds
    w = math.sqrt(3) * LADO
    h = 1.5 * LADO
    hexs, fila, y = [], 0, y0 - LADO
    while y < y1 + LADO:
        x = x0 - w + (w / 2 if fila % 2 else 0)
        while x < x1 + w:
            pts = [(x + LADO * math.cos(math.radians(60 * k + 30)), y + LADO * math.sin(math.radians(60 * k + 30))) for k in range(6)]
            hexs.append(Polygon(pts))
            x += w
        y += h
        fila += 1
    g = gpd.GeoDataFrame(geometry=hexs, crs=UTM)
    g = g[g.intersects(limite)].reset_index(drop=True)
    g["hex"] = g.index
    return g


def repartir(capa: gpd.GeoDataFrame, campos: list[str], hexs: gpd.GeoDataFrame, sufijo: str) -> pd.DataFrame:
    capa = capa.copy()
    capa["a0"] = capa.area
    x = gpd.overlay(capa, hexs[["hex", "geometry"]], how="intersection", keep_geom_type=True)
    x["f"] = x.area / x.a0
    out = {"ha_" + sufijo: x.groupby("hex").apply(lambda d: d.area.sum() / 1e4)}
    for c in campos:
        x[c] = x[c] * x.f
        out[c] = x.groupby("hex")[c].sum()
    return pd.DataFrame(out)


def main() -> None:
    SAL.mkdir(parents=True, exist_ok=True)
    mun = gpd.read_file(APPS / "0. CAPAS VARIAS" / "LIMITES_VIGENTES" / "LIMITE MUNICIPAL" / "LIMITE_MUNICIPAL.shp")
    limite = (mun if mun.crs else mun.set_crs(UTM)).to_crs(UTM).union_all()
    hexs = hexagonos(limite)
    sec = im.sectores_utm()

    # Factibilidades: union anual, reusando la lectura del KMZ del juez.
    import xml.etree.ElementTree as ET, zipfile, re
    from shapely.ops import unary_union
    from shapely.validation import make_valid
    K = "{http://www.opengis.net/kml/2.2}"
    raiz = ET.fromstring(zipfile.ZipFile(APPS / "13. NUEVOS DESARROLLOS" / "insumos" / "FACTIBILIDADES.kmz").read("doc.kml"))
    recs = []

    def recorrer(el, ruta):
        for ch in el:
            tag = ch.tag.replace(K, "")
            if tag in ("Folder", "Document"):
                n = ch.find(K + "name")
                recorrer(ch, ruta + [n.text if n is not None and n.text else ""])
            elif tag == "Placemark":
                anio = next((int(p) for p in ruta if p and re.fullmatch(r"20\d\d", p.strip())), None)
                if anio is None:
                    continue
                pols = []
                for pg in ch.iter(K + "Polygon"):
                    co = pg.find(f".//{K}outerBoundaryIs//{K}coordinates")
                    pts = [tuple(map(float, p.split(",")[:2])) for p in co.text.split()]
                    if len(pts) >= 4:
                        pols.append(make_valid(Polygon(pts)))
                if pols:
                    recs.append({"anio": anio, "geometry": unary_union(pols)})

    recorrer(raiz, [])
    f = gpd.GeoDataFrame(recs, crs=4326).to_crs(UTM)
    f["geometry"] = f.geometry.make_valid().buffer(0)
    union = f.dissolve(by="anio").reset_index()[["anio", "geometry"]]
    tabla = hexs[["hex"]].set_index("hex")
    for _, u in union.iterrows():
        d = repartir(gpd.GeoDataFrame([u], crs=UTM), [], hexs, f"factibilidad_{int(u.anio)}")
        tabla = tabla.join(d)
    # Una sola union 2021-2026 (dictamen del 19/11, condicion 9): nunca la suma de uniones anuales.
    union_total = gpd.GeoDataFrame(geometry=[union.union_all()], crs=UTM)
    tabla = tabla.join(repartir(union_total, [], hexs, "factibilidad_union_2021_2026"))

    # Convenios con su consolidacion (1b).
    conv = gpd.read_file(CONV).to_crs(UTM)
    conv["geometry"] = conv.geometry.make_valid()
    r1b = pd.read_csv(SAL / "1b-por-convenio.csv")
    conv = conv.merge(r1b[["id", "desarrollo", "habitacional", "contratadas_con_tope", "consolidacion_actual", "clase", "provisional", "edad_meses"]], on="id", how="left")
    conv = conv[conv.unidades.notna()].copy()
    conv["por_contratar"] = conv.unidades - conv.contratadas_con_tope.fillna(0)
    # Por contratar separado por edad del convenio a sep-2026 (condicion 9).
    conv["por_contratar_menos_4_anios"] = np.where(conv.edad_meses < 48, conv.por_contratar, 0)
    conv["por_contratar_4_anios_o_mas"] = np.where(conv.edad_meses >= 48, conv.por_contratar, 0)
    campos = ["unidades", "contratadas_con_tope", "por_contratar", "por_contratar_menos_4_anios", "por_contratar_4_anios_o_mas"]
    d = repartir(conv[campos + ["geometry"]], campos, hexs, "convenio")
    tabla = tabla.join(d).fillna(0)
    tabla["consolidacion_hex"] = np.where(tabla.unidades > 0, tabla.contratadas_con_tope / tabla.unidades, np.nan)
    hx = hexs.join(tabla, on="hex")
    hx = hx[(hx.ha_factibilidad_union_2021_2026 > 0) | (hx.unidades > 0)]

    puntos = conv[conv.habitacional == True].copy()  # noqa: E712
    puntos["geometry"] = puntos.geometry.representative_point()
    puntos = puntos[["id", "desarrollo", "anio", "edad_meses", "unidades", "contratadas_con_tope", "por_contratar", "consolidacion_actual", "clase", "provisional", "geometry"]]

    # Por sector.
    por_sec = {}
    campos_sec = ["unidades", "por_contratar", "por_contratar_menos_4_anios", "por_contratar_4_anios_o_mas"]
    for nombre, capa, campos in [("convenio", conv[campos_sec + ["geometry"]], campos_sec),
                                 ("factibilidad", union_total.assign(uno=1.0)[["uno", "geometry"]], [])]:
        capa = capa.copy()
        capa["a0"] = capa.area
        x = gpd.overlay(capa, sec, how="intersection", keep_geom_type=True)
        x["f"] = x.area / x.a0
        g = {"ha_" + nombre: x.groupby("sector").apply(lambda q: q.area.sum() / 1e4)}
        for c in campos:
            g[c] = (x[c] * x.f).groupby(x.sector).sum()
        por_sec[nombre] = pd.DataFrame(g)
    ts = por_sec["convenio"].join(por_sec["factibilidad"], how="outer").fillna(0)
    fuera = {c: conv[c].sum() - ts[c].sum() for c in campos_sec}
    fuera.update({"ha_convenio": conv.area.sum() / 1e4 - ts.ha_convenio.sum(), "ha_factibilidad": union_total.area.sum() / 1e4 - ts.ha_factibilidad.sum()})
    ts.loc[FUERA] = fuera

    # Contrastes declarados: sumas exactas.
    fac_ha = union.set_index("anio").area / 1e4
    con_u = conv.groupby("anio").unidades.sum()
    chequeo = {
        "factibilidad_ha_por_anio": {int(a): [round(float(hx[f"ha_factibilidad_{a}"].sum()), 1), round(float(fac_ha[a]), 1)] for a in fac_ha.index},
        "unidades_convenidas_total": [round(float(hx.unidades.sum()), 1), float(con_u.sum())],
        "por_contratar_total": [round(float(hx.por_contratar.sum()), 1), float(conv.por_contratar.sum())],
        "factibilidad_union_2021_2026_ha": [round(float(hx.ha_factibilidad_union_2021_2026.sum()), 1), round(float(union_total.area.sum() / 1e4), 1)],
        "nota": "sumas exactas: prueba de codigo, no de metodo",
    }
    for a, (h, t) in chequeo["factibilidad_ha_por_anio"].items():
        assert abs(h - t) <= 0.5, f"factibilidad {a} no cuadra"
    assert abs(chequeo["unidades_convenidas_total"][0] - chequeo["unidades_convenidas_total"][1]) <= 1, "unidades no cuadran"

    gp = SAL / "4-mapa-calor.gpkg"
    if gp.exists():
        gp.unlink()
    hx.to_file(gp, layer="hexagonos_500m", driver="GPKG")
    puntos.to_file(gp, layer="desarrollos_ritmo", driver="GPKG")
    ts.round(2).to_csv(SAL / "4-por-sector.csv", encoding="utf-8")
    res = {
        "hexagonos_con_dato": int(len(hx)),
        "chequeo": chequeo,
        "fuera_de_sectores": {k: round(float(v), 1) for k, v in ts.loc[FUERA].items()},
        "por_contratar_habitacional": int(conv[conv.habitacional == True].por_contratar.sum()),  # noqa: E712
        "por_contratar_por_edad": {"menos_de_4_anios": int(conv.por_contratar_menos_4_anios.sum()), "4_anios_o_mas": int(conv.por_contratar_4_anios_o_mas.sum())},
        "top_hex_por_contratar": hx.sort_values("por_contratar", ascending=False).head(5)[["hex", "unidades", "por_contratar", "por_contratar_menos_4_anios", "ha_factibilidad_union_2021_2026"]].round(1).to_dict("records"),
        "clases_puntos": puntos.clase.value_counts().to_dict(),
    }
    (SAL / "4-resumen.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
