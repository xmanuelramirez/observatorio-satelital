"""
Planeacion Integral: agrupacion de los frentes 1b, 2a y 4 por los 17 sectores de planeacion y las 2 zonas de la
presentacion de referencia (oriente: HEROES DE LEON, LAS TORRES, LA LUZ, TAJO SANTA ANA, LOS LOPEZ, NORORIENTE; poniente:
LOMA DEL PICACHO, CORRAL DE PIEDRA). Solo agregados.

Capa: `12. SISPLAN/public/shapefiles/SECTORES_DE_PLANEACION.geojson` (EPSG:32614, campo SECTOR; export del 02/09/2026,
commit 61d024b de SISPLAN, sin fecha de corte declarada). Reparto:
  - convenios (1b, 4): por superficie del poligono en cada sector de planeacion;
  - factibilidad (4): union 2021-2026 por superficie;
  - tomas, viviendas y demanda (2a): del sector hidraulico al sector de planeacion por superficie (densidad uniforme
    dentro del sector hidraulico; supuesto declarado).

Uso: python herramientas/pi_zonas_planeacion.py
"""

import hashlib
import json
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

RAIZ = Path(__file__).resolve().parents[1]
APPS = RAIZ.parent
SAL = RAIZ / "salidas" / "planeacion-integral"
PLAN = APPS / "12. SISPLAN" / "public" / "shapefiles" / "SECTORES_DE_PLANEACION.geojson"
CONV = APPS / "13. NUEVOS DESARROLLOS" / "salidas" / "planeacion-integral" / ("convenios-2019-hoy.geojson" if __import__("os").environ.get("PI_V1") == "1" else "convenios-2019-hoy-v2.geojson")
SECT = APPS / "2. BALANCE HÍDRICO" / "CAPAS-VIGENTES" / "2026-11-05" / "SECTORES.geojson"
UTM = 32614
ZONAS = {"oriente": ["HEROES DE LEON", "LAS TORRES", "LA LUZ", "TAJO SANTA ANA", "LOS LOPEZ", "NORORIENTE"],
         "poniente": ["LOMA DEL PICACHO", "CORRAL DE PIEDRA"]}
FUERA = "fuera de sectores de planeacion"


def repartir(capa: gpd.GeoDataFrame, campos: list[str], plan: gpd.GeoDataFrame) -> pd.DataFrame:
    capa = capa.copy()
    capa["a0"] = capa.area
    x = gpd.overlay(capa, plan[["SECTOR", "geometry"]], how="intersection", keep_geom_type=True)
    x["f"] = x.area / x.a0
    out = pd.DataFrame({c: (x[c] * x.f).groupby(x.SECTOR).sum() for c in campos})
    out.loc[FUERA] = {c: capa[c].sum() - out[c].sum() for c in campos}
    return out


def main() -> None:
    plan = gpd.read_file(PLAN).to_crs(UTM)[["SECTOR", "geometry"]]
    plan["geometry"] = plan.geometry.make_valid()
    zona_de = {s: z for z, ss in ZONAS.items() for s in ss}
    assert set(zona_de) <= set(plan.SECTOR), "faltan sectores de la presentacion en la capa"

    # 1b y 4: convenios con su clase y por contratar por edad.
    conv = gpd.read_file(CONV).to_crs(UTM)
    conv["geometry"] = conv.geometry.make_valid()
    r1b = pd.read_csv(SAL / "1b-por-convenio.csv")
    conv = conv.merge(r1b[["id", "habitacional", "clase", "clase_base", "por_revisar", "edad_meses", "contratadas_con_tope"]], on="id", how="inner", suffixes=("_nd", ""))
    conv = conv[conv.habitacional == True].copy()  # noqa: E712
    conv["unidades"] = r1b.set_index("id").loc[conv.id, "unidades"].values
    conv["por_contratar_menos_4_anios"] = np.where(conv.edad_meses < 48, conv.unidades - conv.contratadas_con_tope, 0)
    conv["por_contratar_4_anios_o_mas"] = np.where(conv.edad_meses >= 48, conv.unidades - conv.contratadas_con_tope, 0)
    # Clase calculada (con los dudosos, que van «por revisar»; dictamen del 19/11 sobre el RESULTADO).
    por_rev = conv.por_revisar.map(lambda v: str(v).strip().lower() == "true")
    for c in ["alta", "media", "baja"]:
        conv[f"unidades_{c}"] = np.where((conv.clase_base == c) & ~por_rev, conv.unidades, 0)
    conv["unidades_por_revisar"] = np.where(por_rev, conv.unidades, 0)
    conv["unidades_sin_clasificar"] = np.where(~conv.clase_base.isin(["alta", "media", "baja"]), conv.unidades, 0)
    campos_c = ["unidades", "contratadas_con_tope", "por_contratar_menos_4_anios", "por_contratar_4_anios_o_mas",
                "unidades_alta", "unidades_media", "unidades_baja", "unidades_por_revisar", "unidades_sin_clasificar"]
    t_conv = repartir(conv[campos_c + ["geometry"]], campos_c, plan)

    # 4: union de factibilidad 2021-2026 (de la capa del frente 4).
    hx = gpd.read_file(SAL / "4-mapa-calor.gpkg", layer="hexagonos_500m").to_crs(UTM)
    t_fac = repartir(hx[["ha_factibilidad_union_2021_2026", "geometry"]], ["ha_factibilidad_union_2021_2026"], plan)

    # 2a: sector hidraulico -> sector de planeacion por superficie.
    a2 = pd.read_csv(SAL / "2a-censo-tomas-demanda-por-sector.csv", index_col=0)
    sec = gpd.read_file(SECT).to_crs(UTM).rename(columns={"Sect": "sector"})[["sector", "geometry"]]
    sec["geometry"] = sec.geometry.make_valid()
    sec = sec.join(a2[["vph_2020", "vpart_2020", "tomas_2020", "demanda_lps"]], on="sector").fillna(0)
    t_2a = repartir(sec, ["vph_2020", "vpart_2020", "tomas_2020", "demanda_lps"], plan)

    t = t_conv.join(t_fac, how="outer").join(t_2a, how="outer").fillna(0)
    t["consolidacion"] = np.where(t.unidades > 0, t.contratadas_con_tope / t.unidades, np.nan)
    # Por sector de planeacion solo absolutos de 2a (condicion 3): sin razones.
    t["zona"] = [zona_de.get(s, "otra" if s != FUERA else "") for s in t.index]
    z = t.groupby("zona")[campos_c + ["ha_factibilidad_union_2021_2026", "vph_2020", "vpart_2020", "tomas_2020", "demanda_lps"]].sum()
    z["consolidacion"] = z.contratadas_con_tope / z.unidades
    t.round(2).to_csv(SAL / "zonas-planeacion-17-sectores.csv", encoding="utf-8")
    z.round(2).to_csv(SAL / "zonas-planeacion-2-zonas.csv", encoding="utf-8")

    sha = hashlib.sha256(PLAN.read_bytes()).hexdigest()
    res = {"capa": {"ruta": str(PLAN.relative_to(APPS)), "sha256": sha, "procedencia": "export de SISPLAN del 02/09/2026, commit 61d024b; sin fecha de corte"},
           "chequeo_unidades": [round(float(t.unidades.sum()), 1), float(conv.unidades.sum())],
           "zonas": z.round(1).to_dict("index")}
    assert abs(res["chequeo_unidades"][0] - res["chequeo_unidades"][1]) < 1, "reparto de unidades no cuadra"
    cl = ["unidades_alta", "unidades_media", "unidades_baja", "unidades_por_revisar", "unidades_sin_clasificar"]
    assert np.allclose(t[cl].sum(axis=1), t.unidades, atol=1), "las clases no suman las unidades"
    (SAL / "zonas-planeacion-resumen.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
