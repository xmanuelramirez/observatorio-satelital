"""
Planeacion Integral: «Zonas de crecimiento, verificacion» (orden del MASTER del 20/11/2026; pedido de Carlos de comprobar
con datos propios los 8 sectores de Rabin). Metodo declarado antes de medir en
`ORDENES-DEL-MASTER/2026-11-19-planeacion-integral-METODO.md`, seccion «Zonas de crecimiento, verificacion». Solo agregados.

Indicadores por sector de planeacion (17 + fuera): a) viviendas convenidas 2019-2026 (habitacionales, convenios v2, reparto
por superficie); b) ha de la union de factibilidad 2021-2026; c) tomas domesticas y mixtas nuevas desde 2019 (Cuentas,
punto en poligono); d) ha de zonas de cambio confirmadas sep-2025 a sep-2026 (union de celdas). d2) expansion GHSL
2015-2020, solo lectura. Ranking: rango 1 = mayor entre los 17; combinado = promedio de rangos de a, b, c y d; «arriba» =
los 8 mejores.

Uso: python herramientas/pi_zonas_verificacion.py
"""

import json
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from shapely.geometry import box

sys.path.insert(0, str(Path(__file__).resolve().parent))
import crecimiento_resumen as cr  # noqa: E402

RAIZ = Path(__file__).resolve().parents[1]
APPS = RAIZ.parent
SAL = RAIZ / "salidas" / "planeacion-integral"
PLAN = APPS / "12. SISPLAN" / "public" / "shapefiles" / "SECTORES_DE_PLANEACION.geojson"
CONV = APPS / "13. NUEVOS DESARROLLOS" / "salidas" / "planeacion-integral" / "convenios-2019-hoy-v2.geojson"
CUENTAS = APPS / "11. ANALISIS DE CUENTAS" / "ORDENES-DEL-MASTER" / "entregas" / "2026-11-20-planeacion-integral-zonas-v2" / "sectores-planeacion-17.csv"
COLONIAS = APPS / "11. ANALISIS DE CUENTAS" / "public" / "data" / "capas" / "COLONIAS.geojson"
SECT = APPS / "2. BALANCE HÍDRICO" / "CAPAS-VIGENTES" / "2026-11-05" / "SECTORES.geojson"
UTM = 32614
FUERA = "fuera de sectores de planeacion"
RABIN = ["HEROES DE LEON", "LAS TORRES", "LA LUZ", "TAJO SANTA ANA", "LOS LOPEZ", "NORORIENTE", "LOMA DEL PICACHO", "CORRAL DE PIEDRA"]
IND = {"a_viviendas_convenidas_2019_2026": "a", "b_ha_factibilidad_2021_2026": "b", "c_tomas_nuevas_desde_2019": "c", "d_ha_cambio_confirmado_2025_2026": "d"}


def por_superficie(capa: gpd.GeoDataFrame, campo: str | None, plan: gpd.GeoDataFrame) -> pd.Series:
    capa = capa.copy()
    capa["a0"] = capa.area
    x = gpd.overlay(capa, plan[["SECTOR", "geometry"]], how="intersection", keep_geom_type=True)
    v = (x[campo] * x.area / x.a0) if campo else x.area / 1e4
    s = v.groupby(x.SECTOR).sum()
    total = capa[campo].sum() if campo else capa.area.sum() / 1e4
    s.loc[FUERA] = total - s.sum()
    return s


def main() -> None:
    plan = gpd.read_file(PLAN).to_crs(UTM)[["SECTOR", "geometry"]]
    plan["geometry"] = plan.geometry.make_valid()
    km2 = plan.set_index("SECTOR").area / 1e6

    conv = gpd.read_file(CONV).to_crs(UTM)
    conv["geometry"] = conv.geometry.make_valid().buffer(0)
    hab = conv[(conv.tipo == "habitacional") & (conv.unidades.fillna(0) >= 5)].copy()
    a = por_superficie(hab[["unidades", "geometry"]], "unidades", plan)

    hx = gpd.read_file(SAL / "4-mapa-calor.gpkg", layer="hexagonos_500m").to_crs(UTM)
    b = por_superficie(hx[["ha_factibilidad_union_2021_2026", "geometry"]], "ha_factibilidad_union_2021_2026", plan)

    cu = pd.read_csv(CUENTAS).set_index("sector_planeacion")["contratadas_desde_2019"]
    c = cu.rename(index={"fuera_de_sectores_de_planeacion": FUERA})

    cand = gpd.read_file(RAIZ / "salidas" / "crecimiento" / "candidatas-2025-2026.geojson")
    rev = pd.read_csv(RAIZ / "salidas" / "crecimiento" / "revision-zonas.csv").set_index("id")
    cand["revision"] = cand["id"].map(rev["es_cambio_real"]).fillna("sin revisar")
    conf = cand[cand.revision == "si"].to_crs(UTM).copy()
    conf["geometry"] = [gpd.GeoSeries(list(g.geoms), crs=UTM).union_all() for g in conf.geometry]
    d = por_superficie(conf[["geometry"]], None, plan)

    # d2 (solo lectura): expansion GHSL 2015-2020.
    mun = gpd.read_file(APPS / "0. CAPAS VARIAS" / "LIMITES_VIGENTES" / "LIMITE MUNICIPAL" / "LIMITE_MUNICIPAL.shp")
    mun_moll = (mun if mun.crs else mun.set_crs(UTM)).to_crs(cr.MOLL).union_all()
    s15, t = cr.leer(2015, mun_moll.bounds)
    s20, _ = cr.leer(2020, mun_moll.bounds)
    f, k = np.nonzero(((s20 - s15) >= 1000) & (s15 / 1e4 < 0.2))
    celdas = gpd.GeoDataFrame(geometry=[box(*(t * (cc, ff)), *(t * (cc + 1, ff + 1))) for ff, cc in zip(f, k)], crs=cr.MOLL)
    celdas["geometry"] = celdas.geometry.map(lambda g: box(*g.bounds))
    celdas = celdas[celdas.centroid.within(mun_moll)].to_crs(UTM)
    d2 = por_superficie(celdas, None, plan)

    tabla = pd.DataFrame({"a_viviendas_convenidas_2019_2026": a, "b_ha_factibilidad_2021_2026": b, "c_tomas_nuevas_desde_2019": c,
                          "d_ha_cambio_confirmado_2025_2026": d, "d2_ha_expansion_ghsl_2015_2020_lectura": d2}).fillna(0)
    sec17 = tabla.drop(index=FUERA)
    for col, letra in IND.items():
        tabla.loc[sec17.index, f"rango_{letra}"] = sec17[col].rank(ascending=False, method="average")
    tabla["rango_combinado"] = tabla[[f"rango_{l}" for l in IND.values()]].mean(axis=1)
    tabla.loc[sec17.index, "posicion_combinada"] = tabla.loc[sec17.index, "rango_combinado"].rank(method="min")
    tabla["arriba_8"] = tabla.posicion_combinada <= 8
    tabla["en_lista_rabin"] = tabla.index.isin(RABIN)
    for col in IND:
        tabla.loc[sec17.index, col.split("_")[0] + "_por_km2"] = sec17[col] / km2.reindex(sec17.index)
    tabla["km2"] = km2.reindex(tabla.index)
    tabla.round(3).to_csv(SAL / "zonas-verificacion-por-sector.csv", encoding="utf-8")

    rho, pval = spearmanr(sec17.a_viviendas_convenidas_2019_2026, sec17.c_tomas_nuevas_desde_2019)
    arriba = tabla[tabla.arriba_8].sort_values("posicion_combinada")
    res = {
        "contraste_spearman_a_c": {"rho": round(float(rho), 3), "p": round(float(pval), 4), "umbral": 0.5, "pasa": bool(rho >= 0.5)},
        "totales": {col: round(float(tabla[col].sum()), 1) for col in tabla.columns if col[:2] in ("a_", "b_", "c_", "d_", "d2")},
        "fuera_de_sectores": {col: round(float(tabla.loc[FUERA, col]), 1) for col in IND},
        "fuera_de_cada_100": {col: round(float(100 * tabla.loc[FUERA, col] / tabla[col].sum()), 1) for col in IND},
        "ranking_combinado": tabla.loc[sec17.index].sort_values("rango_combinado")[["posicion_combinada", "rango_combinado", "rango_a", "rango_b", "rango_c", "rango_d", "en_lista_rabin"]].round(2).reset_index().to_dict("records"),
        "rabin_arriba": [s for s in RABIN if s in arriba.index],
        "rabin_abajo": [s for s in RABIN if s not in arriba.index],
        "otros_arriba": [s for s in arriba.index if s not in RABIN],
    }

    # Fuera de sectores: donde se concentra (hexagonos de 500 m fuera de los 17).
    plan_u = plan.union_all()
    hx["centro"] = hx.geometry.centroid
    fuera = hx[~hx.centro.within(plan_u)].copy()
    conv_hab = hab.copy()
    conv_hab["a0"] = conv_hab.area
    xh = gpd.overlay(conv_hab[["unidades", "a0", "geometry"]], fuera[["hex", "geometry"]], how="intersection", keep_geom_type=True)
    fuera["viviendas_convenidas"] = fuera.hex.map((xh.unidades * xh.area / xh.a0).groupby(xh.hex).sum()).fillna(0)
    xd = gpd.overlay(conf[["geometry"]], fuera[["hex", "geometry"]], how="intersection", keep_geom_type=True)
    fuera["ha_cambio_confirmado"] = fuera.hex.map(xd.area.groupby(xd.hex).sum() / 1e4).fillna(0)
    col = gpd.read_file(COLONIAS).to_crs(UTM)[["nombre", "geometry"]]
    col["geometry"] = col.geometry.make_valid()
    sec = gpd.read_file(SECT).to_crs(UTM).rename(columns={"Sect": "sector"})[["sector", "geometry"]]
    pts = gpd.GeoDataFrame(fuera[["hex"]], geometry=fuera.centro, crs=UTM)
    fuera["colonia"] = fuera.hex.map(gpd.sjoin(pts, col, how="left", predicate="within").drop_duplicates("hex").set_index("hex")["nombre"])
    fuera["sector_hidraulico"] = fuera.hex.map(gpd.sjoin(pts, sec, how="left", predicate="within").drop_duplicates("hex").set_index("hex")["sector"])
    top = fuera.sort_values("viviendas_convenidas", ascending=False).head(10)
    fuera_cols = ["hex", "colonia", "sector_hidraulico", "viviendas_convenidas", "ha_factibilidad_union_2021_2026", "ha_cambio_confirmado"]
    fuera.drop(columns=["centro"]).to_file(SAL / "zonas-verificacion-fuera.gpkg", layer="hexagonos_fuera", driver="GPKG")
    fuera[fuera_cols].sort_values("viviendas_convenidas", ascending=False).round(2).to_csv(SAL / "zonas-verificacion-fuera-hexagonos.csv", index=False, encoding="utf-8")
    res["fuera_top10_hexagonos"] = top[fuera_cols].round(1).to_dict("records")
    res["fuera_top10_de_cada_100_viviendas"] = round(float(100 * top.viviendas_convenidas.sum() / max(fuera.viviendas_convenidas.sum(), 1)), 1)
    res["fuera_hex_suma_viviendas"] = round(float(fuera.viviendas_convenidas.sum()), 1)
    (SAL / "zonas-verificacion-resumen.json").write_text(json.dumps(res, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print(json.dumps(res, ensure_ascii=False, indent=1, default=str))


if __name__ == "__main__":
    main()
