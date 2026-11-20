"""
Planeacion Integral, frente 2a: tomas domesticas y mixtas contra el censo, por sector, y demanda desde las cuentas.
Metodo corregido con el dictamen del juez del 19/11/2026 (`ORDENES-DEL-MASTER/2026-11-19-planeacion-integral-METODO.md`,
seccion «Metodo corregido»). Solo agregados.

Censo 2020: viviendas por manzana (VIVPAR_HAB habitadas y TVIVPAR particulares totales), del centroide de la manzana al
sector. Donde la manzana viene suprimida («*»), el resto de su AGEB (AGEB menos manzanas conocidas) se reparte entre sus
manzanas suprimidas por superficie. Censo 2010: por AGEB urbana, repartida a sector por superficie (densidad uniforme).
Tomas: parque domestico + mixto por sector al 15/03/2020 (Cuentas, B) y al 12/06/2010 (31/12/2009 mas las altas de 2010
prorrateadas, 163 de 365). Banda de stock: razon municipal medida dentro de la cobertura de sectores, mas o menos 0.2.
Demanda: oct-2025 a sep-2026 (12 meses), facturado.

Uso: python herramientas/pi_2a_censo_sector.py
"""

import io
import json
import zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

RAIZ = Path(__file__).resolve().parents[1]
APPS = RAIZ.parent
SAL = RAIZ / "salidas" / "planeacion-integral"
INEGI = APPS / "8. CAUCE" / "inundaciones" / "insumos" / "inegi"
SECT = APPS / "2. BALANCE HÍDRICO" / "CAPAS-VIGENTES" / "2026-11-05" / "SECTORES.geojson"
PI = APPS / "11. ANALISIS DE CUENTAS" / "ORDENES-DEL-MASTER" / "entregas" / "2026-11-20-planeacion-integral-1b-v3-oct"
IND = APPS / "11. ANALISIS DE CUENTAS" / "ORDENES-DEL-MASTER" / "entregas" / "2026-11-19-indicadores-segunda-entrega"
UTM = 32614
FUERA = "fuera_de_sectores"
BANDA = 0.2


def leer_csv(zipp: Path, nombre: str, cod: str) -> pd.DataFrame:
    with zipfile.ZipFile(zipp) as z:
        d = pd.read_csv(io.TextIOWrapper(z.open(nombre), encoding=cod), dtype=str)
    d.columns = [c.strip().strip('"').strip("﻿").upper() for c in d.columns]
    return d[d.MUN == "020"]


def num(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s, errors="coerce")


def censo_2020_manzana(sec: gpd.GeoDataFrame) -> pd.DataFrame:
    d = leer_csv(INEGI / "resageburb_11csv20.zip", "RESAGEBURB_11CSV20.csv", "utf-8-sig")
    d["CVE_AGEB"] = "11020" + d.LOC + d.AGEB
    ageb = d[(d.MZA == "000") & (d.AGEB != "0000") & (d.LOC != "0000")].set_index("CVE_AGEB")
    mz = d[d.MZA != "000"].copy()
    mz["CVEGEO"] = mz.CVE_AGEB + mz.MZA
    g = gpd.read_file(f"zip://{(INEGI / '11_guanajuato.zip').as_posix()}!conjunto_de_datos/11m.shp")
    g = g[g.CVEGEO.str[2:5] == "020"][["CVEGEO", "geometry"]].to_crs(UTM)
    g = g.merge(mz[["CVEGEO", "CVE_AGEB", "VIVPAR_HAB", "TVIVPAR"]], on="CVEGEO", how="inner")
    g["area"] = g.area
    for v in ["VIVPAR_HAB", "TVIVPAR"]:
        g[v + "_n"] = num(g[v])
        conocido = g.groupby("CVE_AGEB")[v + "_n"].sum()
        resto = (num(ageb[v]).reindex(conocido.index) - conocido).clip(lower=0)
        sup = g[g[v + "_n"].isna()]
        peso = sup.area / sup.groupby("CVE_AGEB").area.transform("sum")
        g.loc[sup.index, v + "_n"] = peso * sup.CVE_AGEB.map(resto).fillna(0)
    c = gpd.GeoDataFrame(g[["VIVPAR_HAB_n", "TVIVPAR_n"]], geometry=g.geometry.centroid, crs=UTM)
    sj = gpd.sjoin(c, sec, how="left", predicate="within")
    sj = sj[~sj.index.duplicated()]
    sj["sector"] = sj.sector.fillna(FUERA)
    out = sj.groupby("sector")[["VIVPAR_HAB_n", "TVIVPAR_n"]].sum()
    out.columns = ["vph_2020", "vpart_2020"]
    return out, {"manzanas": int(len(g)), "vph_suprimida_repartida": int((num(g.VIVPAR_HAB).isna()).sum()),
                 "vph_total": int(round(out.vph_2020.sum())), "vph_ageb_tabla": int(num(ageb.VIVPAR_HAB).sum())}


def censo_2010_ageb(sec: gpd.GeoDataFrame) -> pd.Series:
    d = leer_csv(RAIZ / "salidas" / "inegi-2010" / "resageburb_11_2010_csv.zip",
                 "resultados_ageb_urbana_11_cpv2010/conjunto_de_datos/resultados_ageb_urbana_11_cpv2010.csv", "latin-1")
    d = d[(d.MZA == "000") & (d.AGEB != "0000") & (d.LOC != "0000")].copy()
    d["CVEGEO"] = "11020" + d.LOC + d.AGEB
    d["VPH"] = num(d.VIVPAR_HAB)
    z = INEGI / "702825586034_s.zip"
    with zipfile.ZipFile(z) as zf:
        shps = [n for n in zf.namelist() if n.endswith("A.shp")]
    partes = [gpd.read_file(f"zip://{z.as_posix()}!{s}") for s in shps]
    g = pd.concat(partes, ignore_index=True)
    col = next(c for c in g.columns if c.upper() == "CVEGEO")
    g = gpd.GeoDataFrame(g.rename(columns={col: "CVEGEO"})[["CVEGEO", "geometry"]], crs=partes[0].crs).to_crs(UTM)
    g = g.merge(d[["CVEGEO", "VPH"]], on="CVEGEO", how="inner")
    g["geometry"] = g.geometry.make_valid()
    g["a0"] = g.area
    x = gpd.overlay(g, sec, how="intersection", keep_geom_type=True)
    s = (x.VPH * x.area / x.a0).groupby(x.sector).sum()
    s.loc[FUERA] = g.VPH.sum() - s.sum()
    return s


def main() -> None:
    SAL.mkdir(parents=True, exist_ok=True)
    sec = gpd.read_file(SECT).to_crs(UTM).rename(columns={"Sect": "sector"})[["sector", "geometry"]]
    sec["geometry"] = sec.geometry.make_valid()

    v20, cob20 = censo_2020_manzana(sec)
    v10 = censo_2010_ageb(sec)
    b = pd.read_csv(PI / "B-parque-dom-mix-sector-15mar2020.csv").set_index("sector")["parque_15mar2020"]
    alt = pd.read_csv(IND / "2-altas-domesticas-mixtas-sector-anio.csv", dtype={"anio": str}).pivot(index="sector", columns="anio", values="tomas_domesticas_mixtas").fillna(0)
    p2010 = alt["parque_corte"] - alt[[str(a) for a in range(2010, 2027)]].sum(axis=1) + alt["2010"] * 163 / 365

    d = pd.DataFrame({"vph_2010": v10, "vph_2020": v20.vph_2020, "vpart_2020": v20.vpart_2020, "tomas_2010": p2010, "tomas_2020": b}).fillna(0)
    dentro = d.drop(index=FUERA, errors="ignore")
    razon_mun_vph = float(dentro.tomas_2020.sum() / dentro.vph_2020.sum())
    razon_mun_vpart = float(dentro.tomas_2020.sum() / dentro.vpart_2020.sum())
    anios = (pd.Timestamp("2020-03-15") - pd.Timestamp("2010-06-12")).days / 365.25
    d["razon_stock_vph"] = np.where(d.vph_2020 >= 200, d.tomas_2020 / d.vph_2020, np.nan)
    d["razon_stock_vpart"] = np.where(d.vpart_2020 >= 200, d.tomas_2020 / d.vpart_2020, np.nan)
    d["fuera_de_banda_vph"] = np.where(d.razon_stock_vph.isna(), "", np.where(d.razon_stock_vph > razon_mun_vph + BANDA, "arriba",
                                       np.where(d.razon_stock_vph < razon_mun_vph - BANDA, "abajo", "dentro")))
    d["aumento_vph"] = d.vph_2020 - d.vph_2010
    d["altas_tomas"] = d.tomas_2020 - d.tomas_2010
    d["razon_crecimiento"] = np.where(d.aumento_vph >= 100, d.altas_tomas / d.aumento_vph, np.nan)

    c = pd.read_csv(PI / "C-consumo-dom-mix-sector-mes.csv")
    c = c[c.mes >= "2025-11"]  # 12 meses, nov-2025 a oct-2026 (corte unico de octubre)
    seg = int(pd.PeriodIndex(c.mes.unique(), freq="M").days_in_month.to_numpy().sum()) * 86400
    dem = c.groupby("sector").agg(m3=("m3", "sum"), tomas_mes=("tomas_facturadas", "mean"))
    d["demanda_lps"] = (dem.m3 * 1000 / seg).reindex(d.index)
    d["litros_por_toma_dia"] = (dem.m3 * 1000 / (dem.tomas_mes * seg / 86400)).reindex(d.index)
    # El crecimiento 2010-2020 por sector queda fuera del paquete del 25/11 (dictamen del 19/11 sobre el RESULTADO, condicion 4).
    crec = ["vph_2010", "tomas_2010", "aumento_vph", "altas_tomas", "razon_crecimiento"]
    d[crec].round(4).to_csv(SAL / "2a-crecimiento-2010-2020-FUERA-DEL-PAQUETE.csv", encoding="utf-8")
    d.drop(columns=crec).round(4).to_csv(SAL / "2a-censo-tomas-demanda-por-sector.csv", encoding="utf-8")

    v = d.drop(index=FUERA, errors="ignore")
    res = {
        "censo_2020_manzanas": cob20,
        "razon_municipal_dentro_de_sectores": {"tomas_sobre_habitadas": round(razon_mun_vph, 3), "tomas_sobre_particulares_totales": round(razon_mun_vpart, 3),
                                               "banda": [round(razon_mun_vph - BANDA, 3), round(razon_mun_vph + BANDA, 3)]},
        "sectores_stock": {"n": int(v.razon_stock_vph.notna().sum()), "dentro": int((v.fuera_de_banda_vph == "dentro").sum()),
                           "arriba": int((v.fuera_de_banda_vph == "arriba").sum()), "abajo": int((v.fuera_de_banda_vph == "abajo").sum()),
                           "p10_p50_p90_habitadas": [round(float(x), 3) for x in np.nanpercentile(v.razon_stock_vph, [10, 50, 90])],
                           "p10_p50_p90_particulares": [round(float(x), 3) for x in np.nanpercentile(v.razon_stock_vpart, [10, 50, 90])]},
        "fuera_de_sectores": {k: round(float(d.loc[FUERA, k]), 1) for k in ["vph_2020", "vpart_2020", "tomas_2020"]} if FUERA in d.index else None,
        "sectores_crecimiento_2010_2020": {"n": int(v.razon_crecimiento.notna().sum()),
                                           "p10_p50_p90": [round(float(x), 3) for x in np.nanpercentile(v.razon_crecimiento, [10, 50, 90])]},
        "demanda_nov2025_oct2026": {"municipal_lps": round(float(dem.m3.sum() * 1000 / seg), 1), "m3": int(dem.m3.sum()),
                                    "litros_por_toma_dia_p10_p50_p90": [round(float(x)) for x in np.nanpercentile(v.litros_por_toma_dia.dropna(), [10, 50, 90])]},
        "supuestos": ["2020 por manzana del centroide al sector; manzana suprimida con el resto de su AGEB por superficie",
                      "2010 por AGEB con densidad uniforme", "parque 2010 por prorrateo de las altas de 2010 (163/365)",
                      "razones con base suficiente (200 viviendas para stock; 100 de aumento para crecimiento)"],
    }
    (SAL / "2a-resumen.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
