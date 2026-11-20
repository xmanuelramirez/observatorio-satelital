"""
Planeacion Integral: «Zonas de crecimiento, verificacion», version 2. Regla fijada en git antes de medir:
`docs/metodos/zonas-crecimiento-verificacion.md` (dictamen del juez del 20/11/2026). Solo agregados.

Indicadores por sector de planeacion: a) viviendas convenidas 2019-2026, recorte exacto; b) ha de la union de factibilidad
2021-2026, intersecada directo con el sector; c) tomas dom+mix nuevas desde 2019 (Cuentas); d) ha de cambio confirmado
sep-2025 a sep-2026, solo lectura aparte. Robustez en cinco escenarios; fuera de los sectores, por desarrollo con recorte
exacto.

Uso: python herramientas/pi_zonas_verificacion.py
"""

import json
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from shapely.geometry import Polygon
from shapely.ops import unary_union
from shapely.validation import make_valid

RAIZ = Path(__file__).resolve().parents[1]
APPS = RAIZ.parent
SAL = RAIZ / "salidas" / "planeacion-integral"
PLAN = APPS / "12. SISPLAN" / "public" / "shapefiles" / "SECTORES_DE_PLANEACION.geojson"
CONV = APPS / "13. NUEVOS DESARROLLOS" / "salidas" / "planeacion-integral" / "convenios-2019-hoy-v2.geojson"
KMZ = APPS / "13. NUEVOS DESARROLLOS" / "insumos" / "FACTIBILIDADES.kmz"
CUENTAS = APPS / "11. ANALISIS DE CUENTAS" / "ORDENES-DEL-MASTER" / "entregas" / "2026-11-20-planeacion-integral-zonas-v2" / "sectores-planeacion-17.csv"
UTM = 32614
FUERA = "fuera de sectores de planeacion"
RABIN = ["HEROES DE LEON", "LAS TORRES", "LA LUZ", "TAJO SANTA ANA", "LOS LOPEZ", "NORORIENTE", "LOMA DEL PICACHO", "CORRAL DE PIEDRA"]
ARRIBA = 8


def union_factibilidad() -> gpd.GeoSeries:
    K = "{http://www.opengis.net/kml/2.2}"
    raiz = ET.fromstring(zipfile.ZipFile(KMZ).read("doc.kml"))
    pols = []

    def recorrer(el, ruta):
        for ch in el:
            tag = ch.tag.replace(K, "")
            if tag in ("Folder", "Document"):
                n = ch.find(K + "name")
                recorrer(ch, ruta + [n.text if n is not None and n.text else ""])
            elif tag == "Placemark":
                if next((p for p in ruta if p and re.fullmatch(r"20\d\d", p.strip())), None) is None:
                    continue
                for pg in ch.iter(K + "Polygon"):
                    co = pg.find(f".//{K}outerBoundaryIs//{K}coordinates")
                    pts = [tuple(map(float, p.split(",")[:2])) for p in co.text.split()]
                    if len(pts) >= 4:
                        pols.append(make_valid(Polygon(pts)))

    recorrer(raiz, [])
    g = gpd.GeoSeries(pols, crs=4326).to_crs(UTM).make_valid().buffer(0)
    return gpd.GeoSeries([unary_union(list(g))], crs=UTM)


def nombre_base(d: str) -> str:
    d = str(d).split("_")[0].upper()
    d = re.sub(r"\b\d+\s*(RA|DA|A)?\s*Y\s*\d+\s*(RA|DA|A)?\.?\s*SECC?\.?\w*", "", d)
    d = re.sub(r"\b(SECCION|SECC|ETAPA)\b.*$", "", d)
    d = re.sub(r"(\s+([IVXL]+|\d+))+\s*$", "", d.strip())
    return re.sub(r"\s+", " ", d).strip()


def main() -> None:
    plan = gpd.read_file(PLAN).to_crs(UTM)[["SECTOR", "geometry"]]
    plan["geometry"] = plan.geometry.make_valid()
    km2 = plan.set_index("SECTOR").area / 1e6
    plan_u = plan.union_all()

    conv = gpd.read_file(CONV).to_crs(UTM)
    conv["geometry"] = conv.geometry.make_valid().buffer(0)
    hab = conv[(conv.tipo == "habitacional") & (conv.unidades.fillna(0) >= 5)].copy()
    hab["a0"] = hab.area
    x = gpd.overlay(hab[["id", "unidades", "firma", "a0", "geometry"]], plan, how="intersection", keep_geom_type=True)
    x["u"] = x.unidades * x.area / x.a0
    a = x.groupby("SECTOR").u.sum()
    a.loc[FUERA] = hab.unidades.sum() - a.sum()
    x["reciente"] = x.firma.str[:4].astype(int) >= 2025
    reciente = x[x.reciente].groupby("SECTOR").u.sum() / a.drop(index=FUERA)

    uf = union_factibilidad()
    xb = gpd.overlay(gpd.GeoDataFrame(geometry=uf), plan, how="intersection", keep_geom_type=True)
    b = (xb.area / 1e4).groupby(xb.SECTOR).sum()
    b.loc[FUERA] = float(uf.area.sum() / 1e4) - b.sum()

    c = pd.read_csv(CUENTAS).set_index("sector_planeacion")["contratadas_desde_2019"].rename(index={"fuera_de_sectores_de_planeacion": FUERA})

    cand = gpd.read_file(RAIZ / "salidas" / "crecimiento" / "candidatas-2025-2026.geojson")
    rev = pd.read_csv(RAIZ / "salidas" / "crecimiento" / "revision-zonas.csv").set_index("id")
    cand["revision"] = cand["id"].map(rev["es_cambio_real"]).fillna("sin revisar")
    conf = cand[cand.revision == "si"].to_crs(UTM).copy()
    conf["geometry"] = [gpd.GeoSeries(list(g.geoms), crs=UTM).union_all() for g in conf.geometry]
    xd = gpd.overlay(conf[["geometry"]], plan, how="intersection", keep_geom_type=True)
    d = (xd.area / 1e4).groupby(xd.SECTOR).sum()
    d.loc[FUERA] = float(conf.area.sum() / 1e4) - d.sum()

    t = pd.DataFrame({"a_viviendas_convenidas_2019_2026": a, "b_ha_factibilidad_2021_2026": b, "c_tomas_nuevas_desde_2019": c,
                      "d_ha_cambio_confirmado_2025_2026_lectura": d}).fillna(0)
    s = t.drop(index=FUERA).copy()
    s["km2"] = km2.reindex(s.index)
    ra = s.a_viviendas_convenidas_2019_2026.rank(ascending=False)
    rb = s.b_ha_factibilidad_2021_2026.rank(ascending=False)
    rc = s.c_tomas_nuevas_desde_2019.rank(ascending=False)
    rd = s.d_ha_cambio_confirmado_2025_2026_lectura.rank(ascending=False)
    rk = {c_: (s[c_] / s.km2).rank(ascending=False) for c_ in ["a_viviendas_convenidas_2019_2026", "b_ha_factibilidad_2021_2026", "c_tomas_nuevas_desde_2019"]}
    esc = {
        "1_abc": (ra + rb + rc) / 3,
        "2_ac": (ra + rc) / 2,
        "3_a": ra,
        "4_c": rc,
        "5_abc_por_km2": sum(rk.values()) / 3,
    }
    for k, v in esc.items():
        s[f"pos_{k}"] = v.rank(method="min")
        s[f"arriba_{k}"] = s[f"pos_{k}"] <= ARRIBA
    s["veces_arriba"] = s[[f"arriba_{k}" for k in esc]].sum(axis=1)
    s["lectura"] = s.veces_arriba.map(lambda v: "firme" if v == 5 else ("sigue" if v >= 3 else ("en el limite" if v >= 1 else "no se confirma")))
    s["rango_a"], s["rango_b"], s["rango_c"], s["rango_d_lectura"] = ra, rb, rc, rd
    s["de_cada_100_convenidas_2025_2026"] = (100 * reciente.reindex(s.index)).round(1)
    s["frente_2025_2026"] = s.de_cada_100_convenidas_2025_2026 > 50
    s["factibilidad_en_tramite"] = (rb <= 3) & (rc > 8)
    s["en_lista_rabin"] = s.index.isin(RABIN)
    salida = pd.concat([s, t.loc[[FUERA]]])
    salida.round(3).to_csv(SAL / "zonas-verificacion-por-sector.csv", encoding="utf-8")

    rho, _ = spearmanr(s.a_viviendas_convenidas_2019_2026, s.c_tomas_nuevas_desde_2019)
    rho_d, _ = spearmanr(s.d_ha_cambio_confirmado_2025_2026_lectura, s.c_tomas_nuevas_desde_2019)

    # Fuera de los sectores: recorte exacto por desarrollo.
    hab["desarrollo_base"] = hab.desarrollo.map(nombre_base)
    hab["geom_fuera"] = hab.geometry.difference(plan_u)
    hab["u_fuera"] = hab.unidades * hab.geom_fuera.area / hab.a0
    des = hab.groupby("desarrollo_base").agg(convenios=("id", "count"), viviendas_convenidas_total=("unidades", "sum"),
                                             viviendas_convenidas_fuera=("u_fuera", "sum"), primera_firma=("firma", "min"), ultima_firma=("firma", "max"))
    des = des[des.viviendas_convenidas_fuera > 0.5].sort_values("viviendas_convenidas_fuera", ascending=False)
    des.round(1).to_csv(SAL / "zonas-verificacion-fuera-por-desarrollo.csv", encoding="utf-8")
    gf = gpd.GeoDataFrame(hab[["id", "desarrollo_base", "firma", "u_fuera"]], geometry=hab.geom_fuera, crs=UTM)
    gf = gf[~gf.geometry.is_empty & (gf.u_fuera > 0.5)]
    ruta = SAL / "zonas-verificacion-fuera.gpkg"
    if ruta.exists():
        ruta.unlink()
    gf.to_file(ruta, layer="convenios_fuera_por_desarrollo", driver="GPKG")
    plan.assign(lectura=plan.SECTOR.map(s.lectura)).to_file(ruta, layer="sectores_planeacion_lectura", driver="GPKG")

    tot_fuera = float(a.loc[FUERA])
    res = {
        "regla": "docs/metodos/zonas-crecimiento-verificacion.md (version 2)",
        "contraste_spearman_a_c": round(float(rho), 3), "spearman_d_c_lectura": round(float(rho_d), 3),
        "totales": {k: round(float(t[k].sum()), 1) for k in t.columns},
        "fuera_de_cada_100": {k: round(float(100 * t.loc[FUERA, k] / t[k].sum()), 1) for k in t.columns},
        "lectura": s.sort_values(["veces_arriba", "pos_1_abc"], ascending=[False, True])[
            ["veces_arriba", "lectura", "pos_1_abc", "rango_a", "rango_b", "rango_c", "rango_d_lectura", "de_cada_100_convenidas_2025_2026",
             "frente_2025_2026", "factibilidad_en_tramite", "en_lista_rabin", "a_viviendas_convenidas_2019_2026", "b_ha_factibilidad_2021_2026",
             "c_tomas_nuevas_desde_2019"]].round(1).reset_index().to_dict("records"),
        "fuera_top10": des.head(10).round(0).reset_index().to_dict("records"),
        "fuera_top10_de_cada_100": round(float(100 * des.head(10).viviendas_convenidas_fuera.sum() / tot_fuera), 1),
        "fuera_total_viviendas": round(tot_fuera, 1),
    }
    (SAL / "zonas-verificacion-resumen.json").write_text(json.dumps(res, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print(json.dumps(res, ensure_ascii=False, indent=1, default=str))


if __name__ == "__main__":
    main()
