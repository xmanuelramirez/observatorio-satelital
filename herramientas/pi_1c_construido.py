"""
Planeacion Integral, frente 1c: superficie urbanizada por convenio, desde las escenas de `pi-1c-escenas.ts`. Metodo
corregido con el dictamen del juez del 19/11/2026 (`ORDENES-DEL-MASTER/2026-11-19-planeacion-integral-METODO.md`,
seccion «Metodo corregido»). Solo agregados.

- Alcance: convenios habitacionales de 2 ha o mas, o el desarrollo sumado si sus convenios juntos llegan a 2 ha, con
  buffer interior de 20 m. Los verticales (mas de 150 unidades por ha) quedan fuera del cruce con tomas.
- Medida: % urbanizado = NDVI <= 0.30 y MNDWI < 0 (sin vegetacion ni agua). NDVI a 10 m; MNDWI y NDBI usan B11, a 20 m.
- Sin control de alta resolucion no hay «% construido»: la firma construida (NDBI >= T) queda solo como diagnostico.
- Por escena: guarda del observatorio (en `s2/rejilla.json`) y referencia rural: % de pixeles con NDVI <= 0.30 fuera de la
  huella GHSL 2020 y fuera de convenios; si pasa de 30 %, el urbanizado de esa escena se marca dudoso.
- Par «antes / despues»: septiembre anterior a la firma contra el 22/09/2026; 2022 no tiene escena y se usa 2021.
Rotulo: «superficie urbanizada (sin vegetacion ni agua), Sentinel-2, NDVI a 10 m, MNDWI y NDBI a 20 m; poligonos de 2 ha
o mas; no es conteo de viviendas».

Uso: python herramientas/pi_1c_construido.py
"""

import json
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from rasterio.features import rasterize, shapes
from rasterio.transform import from_origin
from shapely.geometry import shape
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parent))
import crecimiento_resumen as cr  # noqa: E402

RAIZ = Path(__file__).resolve().parents[1]
APPS = RAIZ.parent
SAL = RAIZ / "salidas" / "planeacion-integral"
S2 = SAL / "s2"
CONV = APPS / "13. NUEVOS DESARROLLOS" / "salidas" / "planeacion-integral" / ("convenios-2019-hoy.geojson" if __import__("os").environ.get("PI_V1") == "1" else "convenios-2019-hoy-v2.geojson")
HUELLA = RAIZ / "salidas" / "indicadores" / "huella_base_ghsl2020.gpkg"
NDVI_MAX = 0.30
HA_MIN = 2.0
BUFFER_M = 20.0
VERTICAL_U_HA = 150
RURAL_MAX = 0.30


def ciudad_vieja():
    mun = gpd.read_file(APPS / "0. CAPAS VARIAS" / "LIMITES_VIGENTES" / "LIMITE MUNICIPAL" / "LIMITE_MUNICIPAL.shp")
    mun = mun if mun.crs else mun.set_crs(32614)
    mun_moll = mun.to_crs(cr.MOLL).union_all()
    s00, t = cr.leer(2000, mun_moll.bounds)
    s20, _ = cr.leer(2020, mun_moll.bounds)
    m = ((s00 >= 4000) & (s20 >= 4000)).astype("uint8")
    geom = unary_union([shape(g) for g, v in shapes(m, mask=m == 1, transform=t) if v == 1])
    return gpd.GeoSeries([geom], crs=cr.MOLL).to_crs(4326).iloc[0], mun.to_crs(4326).union_all()


def unidades_de_analisis() -> gpd.GeoDataFrame:
    conv = gpd.read_file(CONV).to_crs(32614)
    conv["geometry"] = conv.geometry.make_valid().buffer(0)
    r1b = pd.read_csv(SAL / "1b-por-convenio.csv")
    conv = conv.merge(r1b[["id", "desarrollo", "habitacional", "firma", "unidades", "contratadas_con_tope", "consolidacion_actual", "clase"]],
                      on="id", how="inner", suffixes=("_nd", ""))
    conv = conv[conv.habitacional == True].copy()  # noqa: E712
    conv["ha"] = conv.area / 1e4
    grandes = conv[conv.ha >= HA_MIN].copy()
    grandes["unidad"] = grandes.id
    chicos = conv[conv.ha < HA_MIN]
    suma = chicos.groupby("desarrollo").ha.sum()
    junt = chicos[chicos.desarrollo.isin(suma[suma >= HA_MIN].index)]
    des = junt.dissolve(by="desarrollo", aggfunc={"id": "count", "firma": "min", "unidades": "sum", "contratadas_con_tope": "sum"}).reset_index()
    des["unidad"] = "DES:" + des.desarrollo
    des["consolidacion_actual"] = des.contratadas_con_tope / des.unidades
    des["clase"] = "por desarrollo"
    u = pd.concat([grandes[["unidad", "desarrollo", "firma", "unidades", "contratadas_con_tope", "consolidacion_actual", "clase", "geometry"]],
                   des[["unidad", "desarrollo", "firma", "unidades", "contratadas_con_tope", "consolidacion_actual", "clase", "geometry"]]],
                  ignore_index=True)
    u = gpd.GeoDataFrame(u, geometry="geometry", crs=32614)
    u["ha"] = u.area / 1e4
    u["unidades_por_ha"] = u.unidades / u.ha
    u["vertical"] = u.unidades_por_ha > VERTICAL_U_HA
    u["geometry"] = u.geometry.buffer(-BUFFER_M)
    return u[~u.geometry.is_empty].to_crs(4326).reset_index(drop=True), conv.to_crs(4326)


def main() -> None:
    meta = json.loads((S2 / "rejilla.json").read_text(encoding="utf-8"))
    ancho, alto = meta["ancho"], meta["alto"]
    tr = from_origin(meta["xmin"], meta["ymax"], meta["pixelAncho"], meta["pixelAlto"])
    # 2022 solo existe en sentinel-2-l2a (archivos «2022v»); 2023 se mide en las dos colecciones para compararlas.
    claves = {int(a): a for a in meta["escenas"] if a.isdigit()}
    # 2022 sale de sentinel-2-l2a sin desplazamiento (offset doble corregido en `pi-1c-escenas.ts`); el mismo dia de 2023
    # coincide con c1. Para el paquete del 25/11 esas firmas se quedan con «antes = 21/09/2021» por eleccion (MASTER,
    # 19/11), marcadas. USAR_2022V=1 usa la escena del 16/10/2022.
    import os
    if "2022v" in meta["escenas"] and os.environ.get("USAR_2022V") == "1":
        claves[2022] = "2022v"
    anios = sorted(claves)

    def capa(anio, idx, clave=None):
        return np.fromfile(S2 / f"{clave or claves[anio]}-{idx}.bin", dtype="float32").reshape(alto, ancho)

    vieja_geom, mun = ciudad_vieja()
    vieja = rasterize([(vieja_geom, 1)], out_shape=(alto, ancho), transform=tr, fill=0).astype(bool)
    u, conv_todos = unidades_de_analisis()
    huella = gpd.read_file(HUELLA).to_crs(4326).geometry.iloc[0]
    excl = rasterize([(huella, 1)] + [(g, 1) for g in conv_todos.geometry], out_shape=(alto, ancho), transform=tr, fill=0).astype(bool)
    en_mun = rasterize([(mun, 1)], out_shape=(alto, ancho), transform=tr, fill=0).astype(bool)
    rural = en_mun & ~excl
    ids = rasterize([(g, i + 1) for i, g in enumerate(u.geometry)], out_shape=(alto, ancho), transform=tr, fill=0, dtype="int32")

    escenas, filas = {}, []
    for anio in anios:
        ndvi, ndbi, mndwi = capa(anio, "ndvi"), capa(anio, "ndbi"), capa(anio, "mndwi")
        valido = np.isfinite(ndvi) & np.isfinite(ndbi) & np.isfinite(mndwi)
        T = float(np.percentile(ndbi[vieja & valido], 25))
        rural_bajo = float(np.mean(ndvi[rural & valido] <= NDVI_MAX))
        me = meta["escenas"][claves[anio]]
        escenas[anio] = {"coleccion": me.get("coleccion", "sentinel-2-c1-l2a"), "dia": me["dia"], "guarda_mil_sin_restar": me.get("trae_mil_sin_restar"),
                         "rural_ndvi_bajo_de_cada_100": round(100 * rural_bajo, 1), "urbanizado_dudoso": bool(rural_bajo > RURAL_MAX),
                         "T_ndbi_diagnostico": round(T, 4)}
        urb = valido & (ndvi <= NDVI_MAX) & (mndwi < 0)
        con = valido & (ndbi >= T)
        n = np.bincount(ids[valido], minlength=len(u) + 1)
        nu = np.bincount(ids[urb], minlength=len(u) + 1)
        nc = np.bincount(ids[con], minlength=len(u) + 1)
        for i, f in u.iterrows():
            k = i + 1
            if n[k] < 5:
                continue
            filas.append({"unidad": f.unidad, "anio": anio, "pixeles": int(n[k]), "urbanizado": round(nu[k] / n[k], 4),
                          "firma_construida_diagnostico": round(nc[k] / n[k], 4)})
    serie = pd.DataFrame(filas)

    # Comparacion de colecciones en 2023 (c1 contra sentinel-2-l2a), por unidad.
    comparacion = None
    if "2023v" in meta["escenas"]:
        def urb(clave):
            nd, mw = capa(2023, "ndvi", clave), capa(2023, "mndwi", clave)
            ok = np.isfinite(nd) & np.isfinite(mw)
            n = np.bincount(ids[ok], minlength=len(u) + 1)
            k = np.bincount(ids[ok & (nd <= NDVI_MAX) & (mw < 0)], minlength=len(u) + 1)
            return np.where(n[1:] >= 5, k[1:] / np.maximum(n[1:], 1), np.nan)
        dif = np.abs(urb("2023") - urb("2023v"))
        comparacion = {"unidades": int(np.isfinite(dif).sum()), "diferencia_absoluta_p50_p90": [round(float(x), 4) for x in np.nanpercentile(dif, [50, 90])]}
    serie.to_csv(SAL / "1c-serie-por-unidad.csv", index=False, encoding="utf-8")

    par = []
    for _, f in u.iterrows():
        firma = pd.Period(f.firma, "M")
        base_pedida = firma.year if firma.month > 9 else firma.year - 1
        s = serie[serie.unidad == f.unidad].set_index("anio")
        previos = [y for y in s.index if y <= base_pedida]
        if not previos or 2026 not in s.index:
            continue
        base = max(previos)
        par.append({"unidad": f.unidad, "desarrollo": f.desarrollo, "firma": f.firma, "ha": round(f.ha, 2), "vertical": bool(f.vertical),
                    "anio_antes": base, "anio_antes_sustituido": bool(base != base_pedida),
                    "escena_antes": escenas[base]["dia"],
                    "urbanizado_antes": s.loc[base, "urbanizado"], "urbanizado_2026": s.loc[2026, "urbanizado"],
                    "consolidacion_tomas_2026": round(float(f.consolidacion_actual), 4) if not f.vertical else None, "clase_tomas": f.clase})
    par = pd.DataFrame(par)
    par.to_csv(SAL / "1c-par-antes-despues.csv", index=False, encoding="utf-8")

    casos = par[par.desarrollo.str.match(r"^(MARROKA|ZANDA|EL MOLINO)")].sort_values(["desarrollo", "firma"])
    res = {"escenas": escenas, "comparacion_colecciones_2023": comparacion, "unidades": int(len(u)), "convenios_de_2ha_o_mas": int((~u.unidad.str.startswith("DES:")).sum()),
           "desarrollos_sumados": int(u.unidad.str.startswith("DES:").sum()), "verticales": int(u.vertical.sum()),
           "con_par": int(len(par)), "casos": casos.round(3).to_dict("records"),
           "rotulo": "suelo sin vegetación ni agua en la escena de sep-oct, Sentinel-2 (NDVI 10 m; MNDWI 20 m); 2 ha o más; no es conteo de viviendas ni separa casa de lote raspado; el suelo trabajado que se revegeta deja de contar"}
    (SAL / "1c-resumen.json").write_text(json.dumps(res, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print(json.dumps({k: v for k, v in res.items() if k != "casos"}, ensure_ascii=False, indent=1, default=str))
    print(casos[["desarrollo", "firma", "ha", "anio_antes", "urbanizado_antes", "urbanizado_2026", "consolidacion_tomas_2026"]].round(2).to_string())


if __name__ == "__main__":
    main()
