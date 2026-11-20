"""
Planeacion Integral, frente 2a: tomas domesticas y mixtas contra el censo, por sector, y demanda desde las cuentas.
Metodo declarado en `ORDENES-DEL-MASTER/2026-11-19-planeacion-integral-METODO.md` (seccion 2a). Solo agregados.

Censo:
  - viviendas particulares habitadas (VIVPAR_HAB) por AGEB urbana de Leon, 2010 (12/06/2010) y 2020 (15/03/2020);
  - geometria de AGEB: cartografia urbana 2010 de Leon (*A.shp) y Marco Geoestadistico 2020 (11a.shp), en `8. CAUCE`;
  - AGEB a sector por superficie de interseccion, con densidad uniforme dentro de la AGEB (supuesto declarado).
Tomas (Analisis de Cuentas, solo conteos):
  - 15/03/2020: parque domestico + mixto por sector (entrega del 19/11, B);
  - 12/06/2010: parque al 31/12/2009 mas las altas de 2010 prorrateadas por dias (163 de 365), por sector
    (segunda entrega de indicadores, archivo 2).
Demanda: consumo facturado domestico + mixto por sector, abr-2025 a sep-2026 (entrega C), en L/s y por toma.

Uso: python herramientas/pi_2a_censo_sector.py
"""

import csv
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
PI = APPS / "11. ANALISIS DE CUENTAS" / "ORDENES-DEL-MASTER" / "entregas" / "2026-11-19-planeacion-integral-satelite"
IND = APPS / "11. ANALISIS DE CUENTAS" / "ORDENES-DEL-MASTER" / "entregas" / "2026-11-19-indicadores-segunda-entrega"
UTM = 32614
FUERA = "fuera_de_sectores"


def leer_csv(zipp: Path, nombre: str, cod: str) -> pd.DataFrame:
    with zipfile.ZipFile(zipp) as z:
        txt = io.TextIOWrapper(z.open(nombre), encoding=cod)
        d = pd.read_csv(txt, dtype=str)
    d.columns = [c.strip().strip('"').strip("﻿").upper() for c in d.columns]
    return d


def ageb_tabla(d: pd.DataFrame) -> pd.DataFrame:
    d = d[(d.MUN == "020") & (d.MZA == "000") & (d.AGEB != "0000") & (d.LOC != "0000")].copy()
    d["CVEGEO"] = "11" + d.MUN + d.LOC + d.AGEB
    d["VPH"] = pd.to_numeric(d.VIVPAR_HAB, errors="coerce")
    return d[["CVEGEO", "VPH"]]


def geom_2010() -> gpd.GeoDataFrame:
    z = INEGI / "702825586034_s.zip"
    partes = []
    with zipfile.ZipFile(z) as zf:
        shps = [n for n in zf.namelist() if n.endswith("A.shp")]
    for s in shps:
        g = gpd.read_file(f"zip://{z.as_posix()}!{s}")
        partes.append(g)
    g = pd.concat(partes, ignore_index=True)
    col = next(c for c in g.columns if c.upper() == "CVEGEO")
    return gpd.GeoDataFrame(g.rename(columns={col: "CVEGEO"})[["CVEGEO", "geometry"]], crs=partes[0].crs).to_crs(UTM)


def geom_2020() -> gpd.GeoDataFrame:
    g = gpd.read_file(f"zip://{(INEGI / '11_guanajuato.zip').as_posix()}!conjunto_de_datos/11a.shp")
    g = g[g.CVEGEO.str[2:5] == "020"]
    return g[["CVEGEO", "geometry"]].to_crs(UTM)


def a_sector(ageb: gpd.GeoDataFrame, sec: gpd.GeoDataFrame) -> pd.Series:
    ageb = ageb.copy()
    ageb["geometry"] = ageb.geometry.make_valid()
    ageb["a0"] = ageb.area
    x = gpd.overlay(ageb, sec, how="intersection", keep_geom_type=True)
    x["v"] = x.VPH * x.area / x.a0
    s = x.groupby("sector").v.sum()
    s.loc[FUERA] = ageb.VPH.sum() - s.sum()
    return s


def main() -> None:
    SAL.mkdir(parents=True, exist_ok=True)
    sec = gpd.read_file(SECT).to_crs(UTM).rename(columns={"Sect": "sector"})[["sector", "geometry"]]
    sec["geometry"] = sec.geometry.make_valid()

    t10 = ageb_tabla(leer_csv(RAIZ / "salidas" / "inegi-2010" / "resageburb_11_2010_csv.zip",
                              "resultados_ageb_urbana_11_cpv2010/conjunto_de_datos/resultados_ageb_urbana_11_cpv2010.csv", "latin-1"))
    t20 = ageb_tabla(leer_csv(INEGI / "resageburb_11csv20.zip", "RESAGEBURB_11CSV20.csv", "utf-8-sig"))
    g10 = geom_2010().merge(t10, on="CVEGEO", how="inner")
    g20 = geom_2020().merge(t20, on="CVEGEO", how="inner")
    cobertura = {"2010": {"ageb_tabla": len(t10), "ageb_con_geometria": len(g10), "vph_tabla": int(t10.VPH.sum()), "vph_con_geometria": int(g10.VPH.sum())},
                 "2020": {"ageb_tabla": len(t20), "ageb_con_geometria": len(g20), "vph_tabla": int(t20.VPH.sum()), "vph_con_geometria": int(g20.VPH.sum())}}
    v10, v20 = a_sector(g10, sec), a_sector(g20, sec)

    # Tomas domesticas + mixtas por sector en las fechas del censo.
    b = pd.read_csv(PI / "B-parque-dom-mix-sector-15mar2020.csv").set_index("sector")["parque_15mar2020"]
    alt = pd.read_csv(IND / "2-altas-domesticas-mixtas-sector-anio.csv", dtype={"anio": str}).pivot(index="sector", columns="anio", values="tomas_domesticas_mixtas").fillna(0)
    despues_2009 = alt[[str(a) for a in range(2010, 2027)]].sum(axis=1)
    p2009 = alt["parque_corte"] - despues_2009
    p2010 = p2009 + alt["2010"] * 163 / 365
    d = pd.DataFrame({"vph_2010": v10, "vph_2020": v20, "tomas_2010": p2010, "tomas_2020": b}).fillna(0)
    anios = (pd.Timestamp("2020-03-15") - pd.Timestamp("2010-06-12")).days / 365.25
    d["aumento_vph"] = d.vph_2020 - d.vph_2010
    d["altas_tomas"] = d.tomas_2020 - d.tomas_2010
    d["razon_stock_2020"] = np.where(d.vph_2020 >= 200, d.tomas_2020 / d.vph_2020, np.nan)
    d["razon_crecimiento"] = np.where(d.aumento_vph >= 100, d.altas_tomas / d.aumento_vph, np.nan)
    d["tasa_tomas"] = np.where(d.tomas_2010 >= 500, (d.tomas_2020 / d.tomas_2010) ** (1 / anios) - 1, np.nan)
    d["tasa_vph"] = np.where(d.vph_2010 >= 500, (d.vph_2020 / d.vph_2010) ** (1 / anios) - 1, np.nan)

    # Demanda desde las cuentas (abr-2025 a sep-2026).
    c = pd.read_csv(PI / "C-consumo-dom-mix-sector-mes.csv")
    segundos = int(pd.PeriodIndex(c.mes.unique(), freq="M").days_in_month.to_numpy().sum()) * 86400
    dem = c.groupby("sector").agg(m3=("m3", "sum"), tomas_mes=("tomas_facturadas", "mean"))
    d["demanda_lps"] = (dem.m3 * 1000 / segundos).reindex(d.index)
    d["litros_por_toma_dia"] = (dem.m3 * 1000 / (dem.tomas_mes * segundos / 86400)).reindex(d.index)
    d.round(4).to_csv(SAL / "2a-censo-tomas-demanda-por-sector.csv", encoding="utf-8")

    valido = d.drop(index=FUERA, errors="ignore")
    res = {
        "cobertura_ageb": cobertura,
        "municipio_urbano": {"vph_2010": int(d.vph_2010.sum()), "vph_2020": int(d.vph_2020.sum()), "tomas_2010": int(d.tomas_2010.sum()),
                              "tomas_2020": int(d.tomas_2020.sum()), "razon_crecimiento": round(float(d.altas_tomas.sum() / d.aumento_vph.sum()), 3),
                              "razon_stock_2020": round(float(d.tomas_2020.sum() / d.vph_2020.sum()), 3)},
        "sectores_razon_stock_2020": {"n": int(valido.razon_stock_2020.notna().sum()),
                                      "p10_p50_p90": [round(float(x), 3) for x in np.nanpercentile(valido.razon_stock_2020, [10, 50, 90])],
                                      "dentro_0.8_1.2": int(valido.razon_stock_2020.between(0.8, 1.2).sum())},
        "sectores_razon_crecimiento": {"n": int(valido.razon_crecimiento.notna().sum()),
                                       "p10_p50_p90": [round(float(x), 3) for x in np.nanpercentile(valido.razon_crecimiento, [10, 50, 90])]},
        "demanda": {"municipal_lps": round(float(dem.m3.sum() * 1000 / segundos), 1), "meses": int(c.mes.nunique()),
                    "litros_por_toma_dia_p10_p50_p90": [round(float(x), 0) for x in np.nanpercentile(valido.litros_por_toma_dia.dropna(), [10, 50, 90])]},
        "supuestos": ["densidad uniforme de viviendas dentro de cada AGEB", "parque 2010 por prorrateo de las altas de 2010 (163/365)",
                      "AGEB urbanas: la vivienda rural queda fuera", "tasas y razones solo con base suficiente (500 tomas o viviendas; 200 para stock; 100 de aumento)"],
    }
    (SAL / "2a-resumen.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
