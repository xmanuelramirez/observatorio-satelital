"""
Medicion unica de los indicadores de crecimiento, con el metodo corregido del 19/11/2026
(`ORDENES-DEL-MASTER/2026-11-19-indicadores-de-crecimiento-METODO.md`, seccion «Metodo corregido») y las condiciones del
dictamen del juez (`ORDENES-DEL-MASTER/DICTAMEN-JUEZ-METODO-INDICADORES.md`).

Insumos (todos fuera del repositorio):
  - segunda entrega de Analisis de Cuentas (solo conteos): `11. ANALISIS DE CUENTAS/ORDENES-DEL-MASTER/entregas/
    2026-11-19-indicadores-segunda-entrega/`;
  - sectores vigentes (`2. BALANCE HIDRICO/CAPAS-VIGENTES/2026-11-05/SECTORES.geojson`, sha fe14da11);
  - GHSL R2023A 2000 y 2020; convenios (`0. CAPAS VARIAS/FACTIBILIDADES_CONVENIOS.geojson`); factibilidades
    (`13. NUEVOS DESARROLLOS/insumos/FACTIBILIDADES.kmz`, leido como el juez del 18/11);
  - `salidas/indicadores/` (huella base y automata excluyente) y las zonas de cambio confirmadas de `salidas/crecimiento/`.

Deja `salidas/indicadores/resultado.json` y CSV por sector. No publica nada: el RESULTADO va al juez.

Uso: python herramientas/indicadores_medir.py
"""

import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from datetime import date
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from rasterio.features import rasterize
from shapely.geometry import Polygon
from shapely.ops import unary_union
from shapely.validation import make_valid

sys.path.insert(0, str(Path(__file__).resolve().parent))
import crecimiento_resumen as cr  # noqa: E402

RAIZ = Path(__file__).resolve().parents[1]
APPS = cr.APPS
ENT = APPS / "11. ANALISIS DE CUENTAS" / "ORDENES-DEL-MASTER" / "entregas" / "2026-11-19-indicadores-segunda-entrega"
SECTORES = APPS / "2. BALANCE HÍDRICO" / "CAPAS-VIGENTES" / "2026-11-05" / "SECTORES.geojson"
SAL = RAIZ / "salidas" / "indicadores"
UTM = 32614
FUERA = "fuera_de_sectores"
PARQUE_MINIMO = 500           # tomas al 31/12/2016 para dar % (condicion 5)
TECHO_MINIMO_M2 = 72_000      # 7.2 ha = 500 tomas x 144 m2 (metodo corregido, B)
ANIOS = list(range(2017, 2026))
CENSO = {"2010": (date(2010, 6, 12), 329_952), "2020": (date(2020, 3, 15), 440_662)}  # VPH, INEGI ITER (juez 18/11)
POB = {"2010": (date(2010, 6, 12), 1_436_480), "2015": (date(2015, 3, 15), 1_578_626), "2020": (date(2020, 3, 15), 1_721_215)}
VIV_POR_HA_MODELO = 184 / 4.2  # supuesto del automata (LEEME de AUTOMATAS_CELULARES)


def tasa(p0: float, p1: float, anios: float) -> float:
    return (p1 / p0) ** (1 / anios) - 1


def r(x: float, n: int = 4) -> float:
    return round(float(x), n)


def parque_fin(alt: pd.DataFrame) -> pd.DataFrame:
    """Parque al 31/12 de cada año 2008-2025 por fila: parque al corte menos las altas posteriores (sin fecha dentro)."""
    anios = [a for a in range(2009, 2027)]
    out = {}
    for t in range(2008, 2026):
        posteriores = [str(a) for a in anios if a > t]
        out[t] = alt["parque_corte"] - alt[posteriores].sum(axis=1)
    return pd.DataFrame(out)


def leer_altas(archivo: str, columna: str) -> pd.DataFrame:
    d = pd.read_csv(ENT / archivo, dtype={"anio": str})
    return d.pivot(index="sector", columns="anio", values=columna).fillna(0)


def tomas() -> dict:
    alt = leer_altas("1-altas-domesticas-sector-anio.csv", "tomas_domesticas")
    P = parque_fin(alt)
    mun_alt = alt.sum()
    mun_P = P.sum()
    tot = pd.read_csv(ENT / "totales-municipales.csv", dtype={"anio": str}).set_index("anio")["tomas_domesticas"]
    assert all(int(mun_alt[str(a)]) == int(tot[str(a)]) for a in range(2009, 2027)), "sectores + fuera != municipio"

    municipio = {
        "anual": [{"anio": t, "altas": int(mun_alt[str(t)]), "parque_inicio": int(mun_P[t - 1]),
                   "tasa": r(mun_alt[str(t)] / mun_P[t - 1])} for t in ANIOS],
        "compuesta_2017_2025": r(tasa(mun_P[2016], mun_P[2025], 9)),
        "ene_sep": {"2025": {"altas": int(mun_alt["2025_ene_sep"]), "parque_inicio": int(mun_P[2024]),
                             "tasa_sin_anualizar": r(mun_alt["2025_ene_sep"] / mun_P[2024])},
                    "2026": {"altas": int(mun_alt["2026_ene_sep"]), "parque_inicio": int(mun_P[2025]),
                             "tasa_sin_anualizar": r(mun_alt["2026_ene_sep"] / mun_P[2025])}},
        "parque_corte": int(mun_alt["parque_corte"]),
        "sin_fecha": int(mun_alt["sin_fecha"]),
    }

    filas = []
    for s in alt.index:
        p0 = float(P.loc[s, 2016])
        altas_17_25 = float(sum(alt.loc[s, str(t)] for t in ANIOS))
        contrib = np.mean([alt.loc[s, str(t)] / mun_P[t - 1] for t in ANIOS])
        fila = {
            "sector": s,
            "parque_2016": int(p0),
            "parque_2025": int(P.loc[s, 2025]),
            "altas_al_anio_2017_2025": r(altas_17_25 / 9, 1),
            "tasa_compuesta_2017_2025": r(tasa(p0, P.loc[s, 2025], 9)) if p0 >= PARQUE_MINIMO else None,
            "frente_nuevo": bool(p0 < PARQUE_MINIMO),
            "contribucion_tasa_municipal": r(contrib, 6),
            "altas_2025_ene_sep": int(alt.loc[s, "2025_ene_sep"]),
            "altas_2026_ene_sep": int(alt.loc[s, "2026_ene_sep"]),
        }
        filas.append(fila)
    sec = pd.DataFrame(filas)
    sec.to_csv(SAL / "tomas-por-sector.csv", index=False, encoding="utf-8")
    suma_contrib = float(sec["contribucion_tasa_municipal"].sum())
    media_mun = float(np.mean([mun_alt[str(t)] / mun_P[t - 1] for t in ANIOS]))
    assert abs(suma_contrib - media_mun) < 1e-4, "la contribucion no suma a la tasa municipal"
    con_tasa = sec[~sec["frente_nuevo"]]
    sectores = {
        "sectores_con_tasa": int((~sec["frente_nuevo"] & (sec["sector"] != FUERA)).sum()),
        "frente_nuevo": int((sec["frente_nuevo"] & (sec["sector"] != FUERA)).sum()),
        "frente_nuevo_altas_2017_2025": int(round(sec.loc[sec["frente_nuevo"] & (sec["sector"] != FUERA), "altas_al_anio_2017_2025"].sum() * 9)),
        "tasa_sector_p10_p50_p90": [r(x) for x in np.percentile(con_tasa["tasa_compuesta_2017_2025"].dropna(), [10, 50, 90])],
        "fuera_de_sectores": sec.loc[sec["sector"] == FUERA].iloc[0].to_dict(),
        "contribucion_suma": r(suma_contrib, 6),
        "contribucion_rotulo": "promedio anual 2017-2025; suma el promedio de la tasa municipal",
        "tasa_municipal_media_simple": r(media_mun, 6),
        "mayor_contribucion": sec.sort_values("contribucion_tasa_municipal", ascending=False).head(10)[
            ["sector", "altas_al_anio_2017_2025", "tasa_compuesta_2017_2025", "frente_nuevo", "contribucion_tasa_municipal"]].to_dict("records"),
    }
    return {"municipio": municipio, "sectores": sectores, "P": P, "alt": alt}


def contraste_censo(alt: pd.DataFrame) -> dict:
    m = pd.read_csv(ENT / "3-altas-domesticas-mes.csv")
    m["ini"] = pd.to_datetime(m["mes"] + "-01")
    m["dias"] = m["ini"].dt.days_in_month
    assert int(m["tomas_domesticas"].sum()) == int(sum(alt.sum()[str(a)] for a in range(2009, 2027))), "meses != años"

    def altas_desde(d: date) -> float:
        """Altas posteriores al dia d (prorrateo por dias dentro del mes de d)."""
        total = 0.0
        for _, f in m.iterrows():
            ini = f["ini"].date()
            fin_mes = date(ini.year, ini.month, int(f["dias"]))
            if ini > d:
                total += f["tomas_domesticas"]
            elif ini <= d <= fin_mes:
                total += f["tomas_domesticas"] * (fin_mes.day - d.day) / f["dias"]
        return total

    parque = float(alt.sum()["parque_corte"])
    d0, v0 = CENSO["2010"]
    d1, v1 = CENSO["2020"]
    p0, p1 = parque - altas_desde(d0), parque - altas_desde(d1)
    anios = (d1 - d0).days / 365.25
    altas = p1 - p0
    return {
        "periodo": f"{d0.isoformat()} a {d1.isoformat()}",
        "anios": r(anios, 2),
        "altas_tomas": round(altas),
        "aumento_vph": v1 - v0,
        "razon_altas_entre_aumento_vph": r(altas / (v1 - v0), 3),
        "umbral_declarado": [0.9, 1.1],
        "pasa": bool(0.9 <= altas / (v1 - v0) <= 1.1),
        "tasa_tomas": r(tasa(p0, p1, anios)),
        "tasa_vph": r(tasa(v0, v1, anios)),
        "nota": "bases distintas: tomas activas reconstruidas contra viviendas particulares habitadas",
        "poblacion": {k: r(tasa(POB[a][1], POB[b][1], (POB[b][0] - POB[a][0]).days / 365.25))
                      for k, (a, b) in {"2010_2020": ("2010", "2020"), "2015_2020": ("2015", "2020")}.items()},
    }


def sectores_utm() -> gpd.GeoDataFrame:
    s = gpd.read_file(SECTORES).to_crs(UTM)
    s["geometry"] = s.geometry.make_valid()
    return s.rename(columns={"Sect": "sector"})[["sector", "geometry"]]


def techo(sec: gpd.GeoDataFrame, mun_moll) -> dict:
    g00, t = cr.leer(2000, mun_moll.bounds)
    g20, _ = cr.leer(2020, mun_moll.bounds)
    forma = g00.shape
    en_mun = rasterize([(mun_moll, 1)], out_shape=forma, transform=t, fill=0).astype(bool)
    sm = sec.to_crs(cr.MOLL).reset_index(drop=True)
    ids = rasterize([(g, i + 1) for i, g in enumerate(sm.geometry)], out_shape=forma, transform=t, fill=0)
    filas = []
    for i, s in enumerate(sm["sector"]):
        k = (ids == i + 1) & en_mun
        filas.append({"sector": s, "techo_2000_m2": float(g00[k].sum()), "techo_2020_m2": float(g20[k].sum())})
    k = en_mun & (ids == 0)
    filas.append({"sector": FUERA, "techo_2000_m2": float(g00[k].sum()), "techo_2020_m2": float(g20[k].sum())})
    d = pd.DataFrame(filas)
    d["tasa_compuesta_2000_2020"] = [r(tasa(a, b, 20)) if a >= TECHO_MINIMO_M2 else None for a, b in zip(d.techo_2000_m2, d.techo_2020_m2)]
    d["frente_nuevo"] = d.techo_2000_m2 < TECHO_MINIMO_M2
    d["ha_nuevas_al_anio"] = ((d.techo_2020_m2 - d.techo_2000_m2) / 1e4 / 20).round(2)
    d.to_csv(SAL / "techo-por-sector.csv", index=False, encoding="utf-8")
    m00, m20 = float(g00[en_mun].sum()), float(g20[en_mun].sum())
    assert abs(d.techo_2000_m2.sum() - m00) < 1 and abs(d.techo_2020_m2.sum() - m20) < 1, "reparto de techo no cuadra"
    con = d[(~d.frente_nuevo) & (d.sector != FUERA)]
    return {
        "municipio": {"techo_2000_ha": r(m00 / 1e4, 1), "techo_2020_ha": r(m20 / 1e4, 1), "tasa_compuesta_2000_2020": r(tasa(m00, m20, 20))},
        "sectores_con_tasa": int(len(con)),
        "frente_nuevo": int(((d.frente_nuevo) & (d.sector != FUERA)).sum()),
        "tasa_sector_p10_p50_p90": [r(x) for x in np.percentile(con.tasa_compuesta_2000_2020, [10, 50, 90])],
        "fuera_de_sectores": d.loc[d.sector == FUERA].iloc[0].to_dict(),
        "nota": "celda de 100 m asignada al sector por su centro; solo celdas dentro del municipio",
    }


def convenios(sec: gpd.GeoDataFrame, Pdm: pd.DataFrame) -> dict:
    c = gpd.read_file(APPS / "0. CAPAS VARIAS" / "FACTIBILIDADES_CONVENIOS.geojson")
    c = c[(c.anio >= 2020) & c.unidades.notna()].to_crs(UTM).reset_index(drop=True)
    c["geometry"] = c.geometry.make_valid()
    c["id"] = c.index
    c["area"] = c.area
    x = gpd.overlay(c[["id", "anio", "unidades", "area", "geometry"]], sec, how="intersection", keep_geom_type=True)
    x["u"] = x.unidades * x.area_1 if "area_1" in x else x.unidades * (x.geometry.area / x["area"])
    x["u"] = x.unidades * (x.geometry.area / x["area"])
    por = x.groupby(["sector", "anio"])["u"].sum().unstack(fill_value=0)
    dentro = x.groupby("id")["u"].sum()
    c["fuera"] = c.unidades - c["id"].map(dentro).fillna(0)
    fuera = c.groupby("anio")["fuera"].sum()
    por.loc[FUERA] = fuera
    por = por.fillna(0)
    tot = c.groupby("anio")["unidades"].sum()
    assert np.allclose(por.sum().values, tot.reindex(por.columns).values, atol=0.5), "reparto de convenios no cuadra"
    filas = []
    for s in por.index:
        for a in por.columns:
            den = float(Pdm.loc[s, a - 1]) if s in Pdm.index else 0.0
            u = float(por.loc[s, a])
            if u <= 0:
                continue
            filas.append({"sector": s, "anio": int(a), "unidades": r(u, 1), "parque_dom_mix_inicio": int(den),
                          "unidades_por_cada_100_tomas": r(100 * u / den, 1) if den >= PARQUE_MINIMO else None})
    pd.DataFrame(filas).to_csv(SAL / "convenios-por-sector.csv", index=False, encoding="utf-8")
    mun = {int(a): {"unidades": int(tot[a]), "parque_dom_mix_inicio": int(Pdm[a - 1].sum()),
                    "unidades_por_cada_100_tomas": r(100 * tot[a] / Pdm[a - 1].sum(), 2)} for a in tot.index}
    return {"municipio": mun, "unidades_fuera_de_sectores": {int(a): r(v, 1) for a, v in fuera.items()},
            "nota": "unidades repartidas por superficie del poligono en cada sector; 2026 parcial"}


def factibilidades(sec: gpd.GeoDataFrame) -> dict:
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
    u = f.dissolve(by="anio").reset_index()[["anio", "geometry"]]
    u["ha"] = u.area / 1e4
    x = gpd.overlay(u, sec, how="intersection", keep_geom_type=True)
    x["ha_s"] = x.area / 1e4
    por = x.groupby(["sector", "anio"])["ha_s"].sum().unstack(fill_value=0)
    por.loc[FUERA] = u.set_index("anio")["ha"] - por.sum()
    por.round(2).to_csv(SAL / "factibilidades-por-sector.csv", encoding="utf-8")
    return {"union_ha_por_anio": {int(a): r(h, 1) for a, h in zip(u.anio, u.ha)},
            "fuera_de_sectores_ha": {int(a): r(v, 1) for a, v in por.loc[FUERA].items()},
            "sectores_con_factibilidad_2025": int((por.drop(index=FUERA).get(2025, pd.Series(dtype=float)) > 0).sum()),
            "nota": "incluye giros no habitacionales; 2021 arrastra trámites anteriores; sin denominador",
            "rotulo_fuera": "unas 6 de cada 10 ha fuera de la cobertura de sectores"}


def automata(mun_moll) -> dict:
    ex = gpd.read_file(SAL / "automata_excluyente.gpkg").to_crs(UTM)
    huella = gpd.read_file(SAL / "huella_base_ghsl2020.gpkg").to_crs(UTM).geometry.iloc[0]
    cand = gpd.read_file(RAIZ / "salidas" / "crecimiento" / "candidatas-2025-2026.geojson")
    rev = pd.read_csv(RAIZ / "salidas" / "crecimiento" / "revision-zonas.csv").set_index("id")
    cand["revision"] = cand["id"].map(rev["es_cambio_real"]).fillna("sin revisar")
    conf = cand[cand["revision"] == "si"].to_crs(UTM)
    # Las candidatas son celdas que se tocan en un MultiPolygon: make_valid pierde area (dictamen del juez del 19/11 sobre el
    # RESULTADO, hallazgo 1). Se usa la union de sus celdas, como `crecimiento_concordancia.py`, y se comprueba contra la
    # suma de las celdas.
    celdas = [c for g in conf.geometry for c in g.geoms]
    zonas = unary_union(celdas)
    suma_celdas = sum(c.area for c in celdas)
    assert abs(zonas.area - suma_celdas) <= 0.005 * suma_celdas, "el area de las zonas confirmadas no cuadra con sus celdas"
    urb = gpd.read_file(APPS / "0. CAPAS VARIAS" / "LIMITES_VIGENTES" / "LIMITE_URBANO_POTE_2020" / "Limite_Urbano_Pote_2020.shp")
    urb = (urb if urb.crs else urb.set_crs(UTM)).to_crs(UTM).geometry.make_valid().union_all()

    # (a) diagnostico: techo GHSL 2020 dentro de cada horizonte (celda por su centro).
    g20, t = cr.leer(2020, mun_moll.bounds)
    em = ex.to_crs(cr.MOLL)
    ids = rasterize([(g, i + 1) for i, g in enumerate(em.geometry) if not g.is_empty], out_shape=g20.shape, transform=t, fill=0)

    clases = pd.read_csv(ENT / "4-tomas-domesticas-clase-anio.csv", dtype={"anio": str}).pivot(index="clase", columns="anio", values="tomas_domesticas")
    horizontes, restante = [], zonas
    for i, f in ex.iterrows():
        h = int(f.horizonte)
        ha_h = f.geometry.area / 1e4
        b = f.geometry.intersection(zonas).area / 1e4
        restante = restante.difference(f.geometry)
        k = f"horizonte_{h}"
        desde_2025 = int(clases.loc[k, "2025"] + clases.loc[k, "2026"])
        horizontes.append({
            "horizonte": h,
            "lectura_year_fin": f"{h - 5}-{h}",
            "lectura_year_inicio": f"{h}-{h + 5}",
            "ha": r(ha_h, 1),
            "b_ha_cambio_confirmado": r(b, 1),
            "b_de_cada_100_ha": r(100 * b / ha_h, 2),
            "c_tomas_2020_2024_ya_en_desarrollo": int(sum(clases.loc[k, str(a)] for a in range(2020, 2025))),
            "c_tomas_2025": int(clases.loc[k, "2025"]),
            "c_tomas_2025_ene_sep": int(clases.loc[k, "2025_ene_sep"]),
            "c_tomas_2026_ene_sep": int(clases.loc[k, "2026"]),
            "c_tomas_ene_2025_a_sep_2026_por_ha": r(desde_2025 / ha_h, 3),
            "supuesto_modelo_viviendas_por_ha": r(VIV_POR_HA_MODELO, 1),
            "a_techo_2020_ha_diagnostico": r(float(g20[ids == i + 1].sum()) / 1e4, 1),
        })
    # Fuera del automata: hectareas solo de (b). Lo firme es dentro o fuera de todo horizonte; relleno contra expansion no
    # prevista depende de la huella y va como rango con dos huellas (condicion 3 del dictamen del RESULTADO).
    en_horizonte = sum(f.geometry.intersection(zonas).area for _, f in ex.iterrows()) / 1e4
    fuera_todo = restante.area / 1e4
    huellas = {"ghsl_2020": huella, "ghsl_2020_con_pote": huella.union(urb)}
    por_huella = {k: {"relleno": r(restante.intersection(h).area / 1e4, 1), "expansion_no_prevista": r(restante.difference(h).area / 1e4, 1)}
                  for k, h in huellas.items()}
    no_prev = [v["expansion_no_prevista"] for v in por_huella.values()]
    fuera = {
        "ha_b": {"zonas_confirmadas": int(len(conf)), "total_confirmado": r(zonas.area / 1e4, 1),
                 "en_algun_horizonte": r(en_horizonte, 1), "fuera_de_todo_horizonte": r(fuera_todo, 1),
                 "por_huella": por_huella, "expansion_no_prevista_rango": [min(no_prev), max(no_prev)]},
        # Tomas: solo «en algun horizonte» por año. La serie relleno / expansion no prevista se retira (condicion 2).
        "tomas_en_algun_horizonte": {a: int(clases.loc[[f"horizonte_{h['horizonte']}" for h in horizontes], a].sum())
                                     for a in ["2020", "2021", "2022", "2023", "2024", "2025", "2025_ene_sep", "2026"]},
        "rotulo": "22 zonas confirmadas a ojo en un año; muestra chica",
    }
    assert abs(en_horizonte + fuera_todo - zonas.area / 1e4) < 0.05, "dentro + fuera de horizontes no cuadra"
    for v in por_huella.values():
        assert abs(v["relleno"] + v["expansion_no_prevista"] - fuera_todo) < 0.2, "clases de (b) no cuadran"
    return {"horizontes": horizontes, "fuera_del_automata": fuera}


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:8]


def main() -> None:
    SAL.mkdir(parents=True, exist_ok=True)
    assert sha(SECTORES) == "fe14da11", "la capa de sectores cambio"
    mun = gpd.read_file(APPS / "0. CAPAS VARIAS" / "LIMITES_VIGENTES" / "LIMITE MUNICIPAL" / "LIMITE_MUNICIPAL.shp")
    mun = mun if mun.crs else mun.set_crs(UTM)
    mun_moll = mun.to_crs(cr.MOLL).union_all()
    sec = sectores_utm()

    T = tomas()
    Pdm = parque_fin(leer_altas("2-altas-domesticas-mixtas-sector-anio.csv", "tomas_domesticas_mixtas"))
    res = {
        "generado": date.today().isoformat(),
        "insumos": {"entrega_cuentas": ENT.name, "sectores_sha": sha(SECTORES)},
        "tomas": {"municipio": T["municipio"], "sectores": T["sectores"]},
        "contraste_censo": contraste_censo(T["alt"]),
        "techo_ghsl": techo(sec, mun_moll),
        "oferta_convenios": convenios(sec, Pdm),
        "oferta_factibilidades": factibilidades(sec),
        "automata": automata(mun_moll),
    }
    (SAL / "resultado.json").write_text(json.dumps(res, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print(json.dumps({k: res[k] for k in ["tomas", "contraste_censo"]}, ensure_ascii=False, indent=1, default=str)[:6000])


if __name__ == "__main__":
    main()
