"""
Ritmo de consolidacion por poligono activo (convenio, factibilidad, sector de planeacion y colonia), regla version 2:
`docs/metodos/ritmo-consolidacion-por-poligono.md` (dictamen del juez del 23/11/2026). Base: la v5 (corte oct-2026). Solo
agregados.

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
NOMBRE = {"alta": "Ritmo alto", "media": "Ritmo medio", "baja": "Ritmo bajo"}
# Presentacion por privacidad (MASTER, 23/11): no cambia la regla dictaminada; solo no se muestra el detalle.
SIN_DETALLE = "Clase con convenio chico: sin detalle"
MIN_CONV, MIN_UNID, LIGA, PIEZA_MIN = 3, 100, 0.5, 1.0
# Convenios chicos (SEGURIDAD via Cuentas, regla R8, 23/11): menos de 5 unidades o 1 a 4 tomas posteriores a la firma. Su r
# despeja tomas, asi que no entran al r publicado ni al «convenio que mas pesa»; la clase sigue la regla dictaminada.
CHICOS = APPS / "11. ANALISIS DE CUENTAS" / "ORDENES-DEL-MASTER" / "entregas" / "2026-11-23-convenios-chicos-R8.csv"


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def es_verdad(s: pd.Series) -> pd.Series:
    return s.astype(str).str.strip().str.lower().eq("true")


def main() -> None:
    R24 = float(pd.read_csv(SAL / "1b-curva-referencia.csv", index_col=0).loc[24, "mediana"])
    corte_baja, corte_alta = (1 / 3) / R24, (2 / 3) / R24

    def clase_r(r: float) -> str:
        return "baja" if r < corte_baja else ("alta" if r >= corte_alta else "media")

    r1b = pd.read_csv(SAL / "1b-por-convenio.csv")
    conv = gpd.read_file(CONV).to_crs(UTM)[["id", "geometry"]]
    conv["geometry"] = conv.geometry.make_valid().buffer(0)
    conv = conv.merge(r1b[["id", "desarrollo", "habitacional", "unidades", "clase", "clase_base", "por_revisar", "provisional", "r",
                           "consolidacion_actual"]], on="id", how="inner")
    conv["por_revisar"] = es_verdad(conv.por_revisar)
    conv["provisional"] = es_verdad(conv.provisional)
    conv["con_clase"] = conv.habitacional & conv.clase_base.isin(CLASES)
    chicos = set(pd.read_csv(CHICOS, encoding="utf-8-sig").id)
    conv["chico"] = conv.id.isin(chicos)
    conv["a0"] = conv.area

    def marcas(g: pd.DataFrame, peso: str) -> dict:
        tot = g[peso].sum()
        return {"marca_por_revisar": bool(g.loc[g.por_revisar, peso].sum() > 0.5 * tot),
                "marca_provisional": bool(g.loc[g.provisional, peso].sum() > 0.5 * tot)}

    # 1. Convenio.
    c1 = conv.drop(columns="geometry").copy()
    def et_conv(f):
        if not f.habitacional:
            return "No habitacional"
        if f.clase_base in CLASES:
            return NOMBRE[f.clase_base]
        return "Sin clasificar: muestra chica" if "muestra chica" in str(f.clase) else "Sin clasificar: muy reciente"
    c1["clase_poligono"] = c1.apply(et_conv, axis=1)
    c1["marca_por_revisar"], c1["marca_provisional"] = c1.por_revisar & c1.con_clase, c1.provisional & c1.con_clase
    c1[["id", "desarrollo", "habitacional", "unidades", "clase_poligono", "marca_por_revisar", "marca_provisional", "r",
        "consolidacion_actual"]].to_csv(SAL / "1b-poligono-convenio.csv", index=False, encoding="utf-8")

    # 2. Factibilidad.
    et = gpd.read_file(ETAPAS).to_crs(UTM).reset_index(drop=True)
    et["id_capa"] = et.index
    fac = et[et.etapa == "factibilidad"].copy()
    fac["geometry"] = fac.geometry.make_valid().buffer(0)
    fac["af"] = fac.area
    hab = conv[conv.habitacional]
    x = gpd.overlay(fac[["id_capa", "af", "geometry"]], hab[["id", "a0", "unidades", "r", "con_clase", "chico", "por_revisar", "provisional", "geometry"]],
                    how="intersection", keep_geom_type=True)
    x = x[x.area >= LIGA * np.minimum(x.af, x.a0)]
    filas = []
    for fid, g in fac.set_index("id_capa").iterrows():
        lig = x[x.id_capa == fid]
        fila = {"factibilidad_id": fid, "anio": g.anio, "convenios_ligados": ";".join(lig.id)}
        if lig.empty:
            fila["clase_poligono"] = "Sin convenio ligado a oct-2026"
        elif not lig.con_clase.any():
            fila["clase_poligono"] = "Sin clasificar: su convenio aún no tiene clase"
        elif lig[lig.con_clase].chico.any():
            # Defensa R8, misma logica que en colonia: r sin los chicos; si no queda ninguno o la clase cambiaria, sin detalle.
            cc, pub = lig[lig.con_clase], lig[lig.con_clase & ~lig.chico]
            completa = clase_r(float(np.average(cc.r, weights=cc.unidades)))
            if len(pub) and clase_r(float(np.average(pub.r, weights=pub.unidades))) == completa:
                rpub = float(np.average(pub.r, weights=pub.unidades))
                fila |= {"r_ponderado": round(rpub, 4), "clase_poligono": NOMBRE[completa], "con_convenio_chico_fuera_del_r": True} | marcas(cc, "unidades")
            else:
                fila |= {"r_ponderado": None, "clase_poligono": SIN_DETALLE}
        else:
            cc = lig[lig.con_clase]
            rp = float(np.average(cc.r, weights=cc.unidades))
            fila |= {"r_ponderado": round(rp, 4), "clase_poligono": NOMBRE[clase_r(rp)]} | marcas(cc, "unidades")
        filas.append(fila)
    f2 = pd.DataFrame(filas)
    con_r = f2[f2.r_ponderado.notna()]
    # Ningun r publicado sale de un convenio chico con clase (un chico sin clase no entra al r).
    chicos_con_clase = set(x[x.con_clase & x.chico].id)
    solo_uno = con_r[~con_r.convenios_ligados.str.contains(";")]
    assert not any(l in chicos_con_clase for l in solo_uno.convenios_ligados), "una factibilidad publica el r de un solo convenio chico"
    f2.to_csv(SAL / "1b-poligono-factibilidad.csv", index=False, encoding="utf-8")

    # 3. Sector de planeacion y colonia.
    def piezas(capa: gpd.GeoDataFrame, llave: str) -> pd.DataFrame:
        xx = gpd.overlay(hab[["id", "desarrollo", "a0", "unidades", "r", "con_clase", "chico", "por_revisar", "provisional", "consolidacion_actual", "geometry"]],
                         capa[[llave, "geometry"]], how="intersection", keep_geom_type=True)
        xx["u"] = xx.unidades * xx.area / xx.a0
        return xx[xx.u >= PIEZA_MIN].drop(columns="geometry")

    def resumen_area(g: pd.DataFrame) -> dict:
        cc = g[g.con_clase]
        fila = {"convenios": int(g.id.nunique()), "unidades_dentro": round(float(g.u.sum()), 1), "convenios_con_clase": int(cc.id.nunique()),
                "unidades_con_clase": round(float(cc.u.sum()), 1),
                "consolidacion_actual_ponderada": round(float(np.average(g.consolidacion_actual, weights=g.u)), 4)}
        if len(cc):
            rp = float(np.average(cc.r, weights=cc.u))
            fila |= {"clase_calculada": clase_r(rp), "r_interno": rp} | marcas(cc, "u")
            pub = cc[~cc.chico]
            if len(pub):
                rpub = float(np.average(pub.r, weights=pub.u))
                mayor = pub.sort_values("u", ascending=False).iloc[0]
                fila |= {"r_ponderado": round(rpub, 4), "convenio_que_mas_pesa": mayor.id, "desarrollo_que_mas_pesa": mayor.desarrollo,
                         "unidades_del_que_mas_pesa": round(float(mayor.u), 1), "clase_cambiaria_sin_chicos": clase_r(rpub) != clase_r(rp)}
            else:
                fila |= {"r_ponderado": None, "convenio_que_mas_pesa": None, "desarrollo_que_mas_pesa": None, "clase_cambiaria_sin_chicos": None}
        return fila

    plan = gpd.read_file(PLAN).to_crs(UTM)[["SECTOR", "geometry"]]
    plan["geometry"] = plan.geometry.make_valid().buffer(0)
    ps = piezas(plan, "SECTOR")
    filas = []
    for s_, g in ps.groupby("SECTOR"):
        fila = {"SECTOR": s_} | resumen_area(g)
        cc = g[g.con_clase]
        if fila["convenios_con_clase"] < MIN_CONV or fila["unidades_con_clase"] < MIN_UNID:
            fila["clase_poligono"] = "Pocos convenios (menos de 3)"
        else:
            base = fila["clase_calculada"]
            cambia = any(clase_r(float(np.average(cc[cc.id != i].r, weights=cc[cc.id != i].u))) != base for i in cc.id.unique())
            fila["cambia_al_quitar_un_convenio"] = cambia
            fila["clase_poligono"] = "Sin clase firme: la decide un convenio" if cambia else NOMBRE[base]
        filas.append(fila)
    sp = plan[["SECTOR"]].merge(pd.DataFrame(filas), on="SECTOR", how="left")
    sp["clase_poligono"] = sp.clase_poligono.fillna("Sin convenio")
    sp.loc[sp.clase_poligono.str.startswith("Ritmo") & (sp.clase_cambiaria_sin_chicos.eq(True) | sp.r_ponderado.isna()), "clase_poligono"] = SIN_DETALLE
    sp.drop(columns=["r_interno"], errors="ignore").to_csv(SAL / "1b-poligono-sector-planeacion.csv", index=False, encoding="utf-8")

    col = gpd.read_file(COLONIAS).to_crs(UTM)[["gid", "nombre", "geometry"]]
    col["geometry"] = col.geometry.make_valid().buffer(0)
    col = col.rename(columns={"gid": "colonia_gid"})
    pc = piezas(col, "colonia_gid")
    filas = []
    for k, g in pc.groupby("colonia_gid"):
        fila = {"colonia_gid": k} | resumen_area(g)
        if fila["convenios_con_clase"] == 0:
            fila["clase_poligono"] = "Convenios aún sin clase"
        elif fila["unidades_con_clase"] < MIN_UNID:
            fila["clase_poligono"] = "Menos de 100 unidades con clase"
        else:
            fila["clase_poligono"] = NOMBRE[fila["clase_calculada"]]
        filas.append(fila)
    cl = col[["colonia_gid", "nombre"]].merge(pd.DataFrame(filas), on="colonia_gid", how="left")
    cl["clase_poligono"] = cl.clase_poligono.fillna("Sin convenio")
    cl.loc[cl.clase_poligono.str.startswith("Ritmo") & (cl.clase_cambiaria_sin_chicos.eq(True) | cl.r_ponderado.isna()), "clase_poligono"] = SIN_DETALLE
    assert not (cl.clase_poligono.str.startswith("Ritmo") & cl.r_ponderado.isna()).any(), "colonia con ritmo y sin r publicable"
    cl.drop(columns=["r_interno"], errors="ignore").to_csv(SAL / "1b-poligono-colonia.csv", index=False, encoding="utf-8")

    total_cc = float(hab[hab.con_clase].unidades.sum())
    salidas = ["1b-poligono-convenio.csv", "1b-poligono-factibilidad.csv", "1b-poligono-sector-planeacion.csv", "1b-poligono-colonia.csv"]
    resumen = {
        "regla": "docs/metodos/ritmo-consolidacion-por-poligono.md (version 2)",
        "cortes_exactos": [corte_baja, corte_alta], "R24": R24,
        "insumos_sha": {"1b-por-convenio.csv": sha(SAL / "1b-por-convenio.csv"), "convenios-2019-hoy-v2.geojson": sha(CONV),
                        "desarrollos-etapas.geojson": sha(ETAPAS), "SECTORES_DE_PLANEACION.geojson": sha(PLAN), "COLONIAS.geojson": sha(COLONIAS)},
        "convenio": c1.clase_poligono.value_counts().to_dict(),
        "factibilidad": f2.clase_poligono.value_counts().to_dict(),
        "sector_planeacion": sp.clase_poligono.value_counts().to_dict(),
        "sector_cobertura_de_cada_100_unidades_con_clase": round(100 * float(ps[ps.con_clase].u.sum()) / total_cc, 1),
        "colonia": cl.clase_poligono.value_counts().to_dict(),
        "convenios_chicos": {"lista": CHICOS.name, "sha256": sha(CHICOS), "n": len(chicos),
                             "sector_clase_cambiaria_sin_chicos": int(sp.clase_cambiaria_sin_chicos.fillna(False).astype(bool).sum()),
                             "colonia_clase_cambiaria_sin_chicos": int(cl[cl.clase_poligono.str.startswith("Ritmo")].clase_cambiaria_sin_chicos.fillna(False).astype(bool).sum()),
                             "colonia_r_null_por_chicos": int(cl[cl.convenios_con_clase.fillna(0) > 0].r_ponderado.isna().sum())},
        "colonia_unidades_con_clase_en_clasificadas": round(float(cl[cl.clase_poligono.str.startswith("Ritmo")].unidades_con_clase.sum()), 1),
        "rotulos": {
            "convenio": "Ritmo alto / medio / bajo; marcas «por revisar» y «provisional (menos de 24 meses)»; Sin clasificar: muestra chica; Sin clasificar: muy reciente; No habitacional",
            "factibilidad": "Ritmo alto / medio / bajo del convenio en el mismo terreno (traslape de 50 % o más); Sin clasificar: su convenio aún no tiene clase; Sin convenio ligado a oct-2026 (sin relleno de clase)",
            "sector_planeacion": "Ritmo alto / Ritmo medio; Sin clase firme: la decide un convenio; Pocos convenios (menos de 3); Sin convenio. Nota: r ponderado por unidades de los convenios dentro; cubre el 41 % de las unidades con clase",
            "colonia": "Ritmo alto / medio / bajo de los n convenios dentro, ponderado por unidades; Menos de 100 unidades con clase; Convenios aún sin clase; Sin convenio",
            "comun": "La clase mide el ritmo a los 24 meses o provisional, no el nivel de hoy; contratado no es construido"},
        "salidas_sha": {n: sha(SAL / n) for n in salidas},
    }
    (SAL / "1b-poligono-resumen.json").write_text(json.dumps(resumen, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print(json.dumps({k: v for k, v in resumen.items() if k not in ("rotulos", "insumos_sha")}, ensure_ascii=False, indent=1, default=str))


if __name__ == "__main__":
    main()
