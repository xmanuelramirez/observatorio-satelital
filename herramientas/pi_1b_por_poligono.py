"""
Ritmo de consolidacion por poligono activo (convenio, factibilidad, sector de planeacion y colonia). Regla fijada en git antes
de medir: `docs/metodos/ritmo-consolidacion-por-poligono.md`. Base: la v5 (corte oct-2026). Solo agregados.

Uso: python herramientas/pi_1b_por_poligono.py
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
ND = APPS / "13. NUEVOS DESARROLLOS" / "salidas" / "planeacion-integral"
CONV = ND / "convenios-2019-hoy-v2.geojson"
ETAPAS = ND / "desarrollos-etapas.geojson"
PLAN = APPS / "12. SISPLAN" / "public" / "shapefiles" / "SECTORES_DE_PLANEACION.geojson"
COLONIAS = APPS / "11. ANALISIS DE CUENTAS" / "public" / "data" / "capas" / "COLONIAS.geojson"
UTM = 32614
CLASES = ["alta", "media", "baja"]
MIN_CONV, MIN_UNID = 3, 100
LIGA = 0.5


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main() -> None:
    res = json.loads((SAL / "1b-resumen.json").read_text(encoding="utf-8"))
    corte_baja, corte_alta = res["cortes_r"]

    def clase_r(r):
        return "baja" if r < corte_baja else ("alta" if r >= corte_alta else "media")

    r1b = pd.read_csv(SAL / "1b-por-convenio.csv")
    conv = gpd.read_file(CONV).to_crs(UTM)[["id", "geometry"]]
    conv["geometry"] = conv.geometry.make_valid().buffer(0)
    conv = conv.merge(r1b[["id", "habitacional", "unidades", "clase", "clase_base", "por_revisar", "provisional", "r", "consolidacion_actual",
                           "contratadas_con_tope"]], on="id", how="inner")
    conv["con_clase"] = conv.habitacional & conv.clase_base.isin(CLASES)
    conv["a0"] = conv.area

    # 1. Convenio: su clase v5.
    c1 = conv.drop(columns="geometry").copy()
    c1["clase_poligono"] = np.where(c1.habitacional, c1.clase, "no aplica")
    c1[["id", "habitacional", "unidades", "clase_poligono", "clase_base", "por_revisar", "provisional", "r", "consolidacion_actual"]].to_csv(
        SAL / "1b-poligono-convenio.csv", index=False, encoding="utf-8")
    assert (c1[c1.habitacional].clase_poligono == r1b[r1b.habitacional].set_index("id").loc[c1[c1.habitacional].id, "clase"].values).all()

    # 2. Factibilidad: liga por traslape >= 50 % del menor.
    et = gpd.read_file(ETAPAS).to_crs(UTM).reset_index(drop=True)
    et["id_capa"] = et.index
    fac = et[et.etapa == "factibilidad"].copy()
    fac["geometry"] = fac.geometry.make_valid().buffer(0)
    fac["af"] = fac.area
    x = gpd.overlay(fac[["id_capa", "af", "geometry"]], conv[conv.habitacional][["id", "a0", "unidades", "r", "con_clase", "por_revisar", "geometry"]],
                    how="intersection", keep_geom_type=True)
    x = x[x.area >= LIGA * np.minimum(x.af, x.a0)]
    filas = []
    for fid, g in fac.set_index("id_capa").iterrows():
        lig = x[x.id_capa == fid]
        if lig.empty:
            filas.append({"factibilidad_id": fid, "anio": g.anio, "convenios_ligados": "", "clase_poligono": "sin convenio"})
            continue
        cc = lig[lig.con_clase]
        if cc.empty:
            et_ = "sin clasificar"
            rp = np.nan
        else:
            rp = float(np.average(cc.r, weights=cc.unidades))
            et_ = clase_r(rp) + (" (por revisar)" if cc.por_revisar.astype(str).str.lower().eq("true").any() else "")
        filas.append({"factibilidad_id": fid, "anio": g.anio, "convenios_ligados": ";".join(lig.id), "r_ponderado": round(rp, 4) if pd.notna(rp) else None,
                      "clase_poligono": et_})
    f2 = pd.DataFrame(filas)
    f2.to_csv(SAL / "1b-poligono-factibilidad.csv", index=False, encoding="utf-8")

    # 3. Sector de planeacion y colonia: r ponderado por unidades dentro.
    def por_area(capa: gpd.GeoDataFrame, llave: str, nombre: str) -> pd.DataFrame:
        hab = conv[conv.habitacional]
        xx = gpd.overlay(hab[["id", "a0", "unidades", "r", "con_clase", "por_revisar", "consolidacion_actual", "geometry"]],
                         capa[[llave, "geometry"]], how="intersection", keep_geom_type=True)
        xx["u"] = xx.unidades * xx.area / xx.a0
        xx["rev"] = xx.por_revisar.astype(str).str.lower().eq("true")
        out = []
        for k, g in xx.groupby(llave):
            cc = g[g.con_clase]
            n, uc = int(cc.id.nunique()), float(cc.u.sum())
            fila = {llave: k, "convenios": int(g.id.nunique()), "unidades_dentro": round(float(g.u.sum()), 1), "convenios_con_clase": n,
                    "unidades_con_clase": round(uc, 1), "unidades_por_revisar": round(float(cc[cc.rev].u.sum()), 1),
                    "consolidacion_actual_ponderada": round(float(np.average(g.consolidacion_actual, weights=g.u)), 4) if g.u.sum() > 0 else None}
            if n == 0:
                fila["clase_poligono"] = "sin clasificar (sin convenios con clase)"
            elif n < MIN_CONV or uc < MIN_UNID:
                fila["clase_poligono"] = "sin clasificar (menos de 3 convenios)"
            else:
                rp = float(np.average(cc.r, weights=cc.u))
                fila["r_ponderado"] = round(rp, 4)
                fila["clase_poligono"] = clase_r(rp) + (" (por revisar)" if fila["unidades_por_revisar"] > 0.5 * uc else "")
            out.append(fila)
        d = pd.DataFrame(out)
        todos = capa[[llave]].merge(d, on=llave, how="left")
        todos["clase_poligono"] = todos.clase_poligono.fillna("sin convenio")
        # Contraste de codigo: unidades con clase dentro + fuera = total con clase.
        total_cc = float(hab[hab.con_clase].unidades.sum())
        dentro_cc = float(xx[xx.con_clase].u.sum())
        fuera_cc = total_cc - dentro_cc
        todos.to_csv(SAL / f"1b-poligono-{nombre}.csv", index=False, encoding="utf-8")
        return todos, {"unidades_con_clase_dentro": round(dentro_cc, 1), "fuera": round(fuera_cc, 1), "total_v5": round(total_cc, 1)}

    plan = gpd.read_file(PLAN).to_crs(UTM)[["SECTOR", "geometry"]]
    plan["geometry"] = plan.geometry.make_valid().buffer(0)
    sp, ck_sp = por_area(plan, "SECTOR", "sector-planeacion")
    col = gpd.read_file(COLONIAS).to_crs(UTM)[["gid", "nombre", "geometry"]]
    col["geometry"] = col.geometry.make_valid().buffer(0)
    cl, ck_cl = por_area(col.rename(columns={"gid": "colonia_gid"}), "colonia_gid", "colonia")
    cl.insert(1, "nombre", cl.colonia_gid.map(col.set_index("gid").nombre))
    cl.to_csv(SAL / "1b-poligono-colonia.csv", index=False, encoding="utf-8")

    resumen = {
        "regla": "docs/metodos/ritmo-consolidacion-por-poligono.md (version 1)",
        "insumos_sha": {"1b-por-convenio.csv": sha(SAL / "1b-por-convenio.csv"), "convenios-2019-hoy-v2.geojson": sha(CONV),
                        "desarrollos-etapas.geojson": sha(ETAPAS), "SECTORES_DE_PLANEACION.geojson": sha(PLAN), "COLONIAS.geojson": sha(COLONIAS)},
        "convenio": c1.clase_poligono.value_counts().to_dict(),
        "factibilidad": {"poligonos": int(len(f2)), "clases": f2.clase_poligono.value_counts().to_dict()},
        "sector_planeacion": {"clases": sp.clase_poligono.value_counts().to_dict(), "chequeo": ck_sp},
        "colonia": {"clases": cl.clase_poligono.value_counts().to_dict(), "chequeo": ck_cl},
        "salidas_sha": {n: sha(SAL / n) for n in ["1b-poligono-convenio.csv", "1b-poligono-factibilidad.csv", "1b-poligono-sector-planeacion.csv", "1b-poligono-colonia.csv"]},
    }
    (SAL / "1b-poligono-resumen.json").write_text(json.dumps(resumen, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print(json.dumps(resumen, ensure_ascii=False, indent=1, default=str))


if __name__ == "__main__":
    main()
