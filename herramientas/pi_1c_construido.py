"""
Planeacion Integral, frente 1c: sin construir contra construido por convenio, desde las escenas de `pi-1c-escenas.ts`.
Metodo declarado en `ORDENES-DEL-MASTER/2026-11-19-planeacion-integral-METODO.md` (seccion 1c). Solo agregados.

Por convenio habitacional y año (septiembre 2019-2026):
  - % urbanizado: NDVI <= 0.30 y MNDWI < 0 (sin vegetacion ni agua);
  - % con firma construida: NDBI >= T del año, con T = percentil 25 del NDBI en pixeles de ciudad vieja de la misma
    escena (celdas GHSL con 40 % de techo o mas en 2000 y en 2020).
Par «antes / despues»: septiembre anterior a la firma contra el 22/09/2026.
Contrastes declarados: (1) en poligonos con 70 % o mas de vegetacion «antes», construido «antes» < 10 %; (2) en
convenios con 80 % o mas de consolidacion por tomas, construido 2026 >= 50 %.

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
CONV = APPS / "13. NUEVOS DESARROLLOS" / "salidas" / "planeacion-integral" / "convenios-2019-hoy.geojson"
NDVI_MAX = 0.30
VEGETADO_BASE = 0.70


def ciudad_vieja():
    mun = gpd.read_file(APPS / "0. CAPAS VARIAS" / "LIMITES_VIGENTES" / "LIMITE MUNICIPAL" / "LIMITE_MUNICIPAL.shp")
    mun_moll = (mun if mun.crs else mun.set_crs(32614)).to_crs(cr.MOLL).union_all()
    s00, t = cr.leer(2000, mun_moll.bounds)
    s20, _ = cr.leer(2020, mun_moll.bounds)
    m = ((s00 >= 4000) & (s20 >= 4000)).astype("uint8")
    geom = unary_union([shape(g) for g, v in shapes(m, mask=m == 1, transform=t) if v == 1])
    return gpd.GeoSeries([geom], crs=cr.MOLL).to_crs(4326).iloc[0]


def main() -> None:
    meta = json.loads((S2 / "rejilla.json").read_text(encoding="utf-8"))
    ancho, alto = meta["ancho"], meta["alto"]
    tr = from_origin(meta["xmin"], meta["ymax"], meta["pixelAncho"], meta["pixelAlto"])
    anios = sorted(int(a) for a in meta["escenas"])

    def capa(anio, idx):
        return np.fromfile(S2 / f"{anio}-{idx}.bin", dtype="float32").reshape(alto, ancho)

    vieja = rasterize([(ciudad_vieja(), 1)], out_shape=(alto, ancho), transform=tr, fill=0).astype(bool)

    conv = gpd.read_file(CONV).to_crs(4326)
    r1b = pd.read_csv(SAL / "1b-por-convenio.csv")
    conv = conv.merge(r1b[["id", "desarrollo", "habitacional", "firma", "consolidacion_actual", "clase"]], on="id", how="inner")
    conv = conv[conv.habitacional == True].reset_index(drop=True)  # noqa: E712
    ids = rasterize([(g, i + 1) for i, g in enumerate(conv.geometry)], out_shape=(alto, ancho), transform=tr, fill=0, dtype="int32")
    curvas = pd.read_csv(SAL / "1b-curvas-mensuales.csv")

    umbrales, filas = {}, []
    for anio in anios:
        ndvi, ndbi, mndwi = capa(anio, "ndvi"), capa(anio, "ndbi"), capa(anio, "mndwi")
        ref = ndbi[vieja & np.isfinite(ndbi)]
        T = float(np.percentile(ref, 25))
        umbrales[anio] = {"T_ndbi": round(T, 4), "pixeles_ciudad_vieja": int(ref.size), "dia": meta["escenas"][str(anio)]["dia"]}
        valido = np.isfinite(ndvi) & np.isfinite(ndbi) & np.isfinite(mndwi)
        urb = valido & (ndvi <= NDVI_MAX) & (mndwi < 0)
        con = valido & (ndbi >= T)
        veg = valido & (ndvi > NDVI_MAX)
        n = np.bincount(ids[valido], minlength=len(conv) + 1)
        nu = np.bincount(ids[urb], minlength=len(conv) + 1)
        nc = np.bincount(ids[con], minlength=len(conv) + 1)
        nv = np.bincount(ids[veg], minlength=len(conv) + 1)
        for i, c in conv.iterrows():
            k = i + 1
            if n[k] < 5:
                continue
            filas.append({"id": c.id, "anio": anio, "pixeles": int(n[k]), "urbanizado": round(nu[k] / n[k], 4),
                          "construido": round(nc[k] / n[k], 4), "vegetado": round(nv[k] / n[k], 4)})
    serie = pd.DataFrame(filas)

    # Consolidacion por tomas en septiembre de cada año (1b), para cruzar.
    curvas["anio"] = curvas.mes.str[:4].astype(int)
    sep = curvas[curvas.mes.str.endswith("-09")][["id", "anio", "consolidacion"]]
    serie = serie.merge(sep, on=["id", "anio"], how="left")
    serie.to_csv(SAL / "1c-serie-por-convenio.csv", index=False, encoding="utf-8")

    # Par antes / despues.
    par = []
    for _, c in conv.iterrows():
        f = pd.Period(c.firma, "M")
        base = f.year if f.month > 9 else f.year - 1
        s = serie[serie.id == c.id].set_index("anio")
        # 2022 no tiene escena despejada de ago-oct en el catalogo: se usa el año disponible anterior y se marca.
        previos = [y for y in s.index if y <= base]
        if not previos or 2026 not in s.index:
            continue
        base_pedida, base = base, max(previos)
        a, d = s.loc[base], s.loc[2026]
        par.append({"id": c.id, "desarrollo": c.desarrollo, "firma": c.firma, "anio_antes": base, "anio_antes_sustituido": bool(base != base_pedida),
                    "urbanizado_antes": a.urbanizado, "construido_antes": a.construido, "vegetado_antes": a.vegetado,
                    "urbanizado_2026": d.urbanizado, "construido_2026": d.construido,
                    "consolidacion_tomas_2026": c.consolidacion_actual, "clase_tomas": c.clase,
                    "brecha_construido_menos_tomas": round(d.construido - c.consolidacion_actual, 4)})
    par = pd.DataFrame(par)
    par.to_csv(SAL / "1c-par-antes-despues.csv", index=False, encoding="utf-8")

    v = par[par.vegetado_antes >= VEGETADO_BASE]
    k1 = {"n": int(len(v)), "construido_antes_p50_p90": [round(float(x), 3) for x in np.percentile(v.construido_antes, [50, 90])] if len(v) else None,
          "de_cada_100_bajo_10": int(round(100 * (v.construido_antes < 0.10).mean())) if len(v) else None}
    k1["pasa"] = bool(len(v) and np.median(v.construido_antes) < 0.10)
    s80 = par[par.consolidacion_tomas_2026 >= 0.80]
    k2 = {"n": int(len(s80)), "construido_2026_p10_p50": [round(float(x), 3) for x in np.percentile(s80.construido_2026, [10, 50])] if len(s80) else None,
          "de_cada_100_con_50_o_mas": int(round(100 * (s80.construido_2026 >= 0.5).mean())) if len(s80) else None}
    k2["pasa"] = bool(len(s80) and np.median(s80.construido_2026) >= 0.5)

    casos = par[par.desarrollo.str.match(r"^(MARROKA|ZANDA|EL MOLINO)")].sort_values(["desarrollo", "firma"])
    res = {"escenas_y_umbral": umbrales, "convenios_con_par": int(len(par)), "contraste_1_suelo_vegetado": k1, "contraste_2_consolidados": k2,
           "casos": casos.round(3).to_dict("records")}
    (SAL / "1c-resumen.json").write_text(json.dumps(res, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print(json.dumps(res, ensure_ascii=False, indent=1, default=str)[:7000])


if __name__ == "__main__":
    main()
