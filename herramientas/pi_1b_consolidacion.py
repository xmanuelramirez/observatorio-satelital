"""
Planeacion Integral, frente 1b: ritmo de consolidacion mensual por convenio y por desarrollo. Metodo corregido con el
dictamen del juez del 19/11/2026 (`ORDENES-DEL-MASTER/2026-11-19-planeacion-integral-METODO.md`, seccion «Metodo
corregido»; `DICTAMEN-JUEZ-METODO-PLANEACION-INTEGRAL.md`). Solo agregados.

Insumos (fuera del repositorio):
  - poligonos: `13. NUEVOS DESARROLLOS/salidas/planeacion-integral/convenios-2019-hoy.geojson` (id CONV-AAAA-NNN);
  - nombres: `0. CAPAS VARIAS/FACTIBILIDADES_CONVENIOS.geojson`, regla del id de Nuevos Desarrollos (dentro de cada año,
    orden por nombre y numeracion desde 001), comprobada con unidades y area;
  - conteos y marcas: Analisis de Cuentas, `entregas/2026-11-19-planeacion-integral-satelite/` (tomas por convenio y mes;
    consumo abr-sep 2026, traslapes, sin coordenada, huella GHSL 2020; prueba de codigo con la regla de Balance).

Regla de clase (una sola para todas las edades): a* = min(24, edad); r = C(a*) / R(a*), con R la mediana por convenio,
sin ponderar, de los habitacionales de 20 unidades o mas con 36 meses o mas. Baja si r < (1/3)/R(24); alta si
r >= (2/3)/R(24).

Uso: python herramientas/pi_1b_consolidacion.py
"""

import json
import re
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

RAIZ = Path(__file__).resolve().parents[1]
APPS = RAIZ.parent
SAL = RAIZ / "salidas" / "planeacion-integral"
# Version 2 de los convenios (ND, 20/11/2026: 2019 de Edith y 2026 a octubre), con nombre de desarrollo y firma propios.
# PI_V1=1 vuelve a la version 1 (con la liga de nombres por la regla del id).
import os  # noqa: E402
V1 = os.environ.get("PI_V1") == "1"
CONV = APPS / "13. NUEVOS DESARROLLOS" / "salidas" / "planeacion-integral" / ("convenios-2019-hoy.geojson" if V1 else "convenios-2019-hoy-v2.geojson")
NOMBRES = APPS / "0. CAPAS VARIAS" / "FACTIBILIDADES_CONVENIOS.geojson"
ENT = Path(os.environ["PI_ENT"]) if os.environ.get("PI_ENT") else APPS / "11. ANALISIS DE CUENTAS" / "ORDENES-DEL-MASTER" / "entregas" / "2026-11-19-planeacion-integral-satelite"
SECTORES = APPS / "2. BALANCE HÍDRICO" / "CAPAS-VIGENTES" / "2026-11-05" / "SECTORES.geojson"
CORTE = pd.Period("2026-09", "M")
EDAD_CLASE = 24
CASOS = {"MARROKA": r"^MARROKA", "ZANDA": r"^ZANDA", "EL MOLINO": r"^EL MOLINO"}
CLASES = ["baja", "media", "alta"]


def desarrollo(nombre: str) -> str:
    return re.sub(r"\s+", " ", str(nombre).split("_")[0]).strip().upper()


def main() -> None:
    SAL.mkdir(parents=True, exist_ok=True)
    conv = gpd.read_file(CONV)
    if V1:
        nom = gpd.read_file(NOMBRES).sort_values(["anio", "nombre"], kind="stable")
        nom["id"] = nom.groupby("anio").cumcount().add(1).map("{:03d}".format).radd("CONV-" + nom["anio"].astype(str) + "-")
        m = conv.merge(nom[["id", "nombre", "unidades", "area_m2"]], on="id", how="left", suffixes=("", "_n"))
        ok_u = m.unidades.fillna(-1) == m.unidades_n.fillna(-1)
        ok_a = np.isclose(m.area_ha * 1e4, m.area_m2, rtol=0.02)
        assert ok_u.all() and ok_a.mean() > 0.97, f"la liga de nombres no cuadra: unidades {ok_u.mean():.3f}, area {ok_a.mean():.3f}"
        m["desarrollo"] = m.nombre.map(desarrollo)
        m["firma"] = pd.PeriodIndex(m.fecha.fillna(m.anio.astype(str) + "-01"), freq="M")
    else:
        m = conv.copy()
        m["desarrollo"] = m.desarrollo.map(lambda x: re.sub(r"\s+", " ", str(x)).strip().upper())
        m["firma"] = pd.PeriodIndex(m.firma, freq="M")
    m["habitacional"] = (m.tipo == "habitacional") & (m.unidades.fillna(0) >= 5)

    t = pd.read_csv(ENT / "A-tomas-dom-mix-convenio-mes.csv")
    previas = t[t.mes == "previas"].groupby("id").tomas_dom_mix.sum()
    t = t[t.mes.str.match(r"^\d{4}-\d{2}$")].copy()
    t["mes"] = pd.PeriodIndex(t.mes, freq="M")
    marcas = pd.read_csv(ENT / "1b-juez-consumo-y-marcas-por-convenio.csv").set_index("id")
    ruta_prueba = ENT / "1b-juez-prueba-codigo-regla-balance.csv"
    prueba = pd.read_csv(ruta_prueba) if ruta_prueba.exists() else pd.DataFrame()

    filas, resumen = [], []
    for _, c in m.iterrows():
        if not c.unidades or np.isnan(c.unidades):
            continue
        meses = pd.period_range(c.firma, CORTE, freq="M")
        serie = t[t.id == c.id].set_index("mes").tomas_dom_mix.reindex(meses, fill_value=0).cumsum()
        cons = np.minimum(serie / c.unidades, 1.0)
        for edad, (mes, acum, v) in enumerate(zip(meses, serie, cons)):
            filas.append({"id": c.id, "mes": str(mes), "edad_meses": edad, "tomas_acumuladas": int(acum), "consolidacion": round(float(v), 4)})
        total = int(serie.iloc[-1]) if len(serie) else 0
        resumen.append({"id": c.id, "desarrollo": c.desarrollo, "anio": int(c.anio), "firma": str(c.firma), "habitacional": bool(c.habitacional),
                        "unidades_tipo": c.unidades_tipo, "unidades": int(c.unidades), "tomas_contratadas": total,
                        "contratadas_con_tope": int(min(total, c.unidades)), "exceso_sobre_unidades": int(max(0, total - c.unidades)),
                        "previas": int(previas.get(c.id, 0)), "edad_meses": len(meses) - 1,
                        "consolidacion_actual": round(float(cons.iloc[-1]), 4) if len(cons) else 0.0})
    curvas = pd.DataFrame(filas)
    res = pd.DataFrame(resumen)
    piv = curvas.pivot(index="id", columns="edad_meses", values="consolidacion")

    # Marcas de Cuentas. Huella previa: GHSL 2015 (dictamen del 19/11 sobre el RESULTADO, condicion 1), si ya llego.
    huella_col = "en_huella_base_ghsl2015" if "en_huella_base_ghsl2015" in marcas.columns else "en_huella_base_ghsl2020"
    res = res.join(marcas[["tomas_post_firma", "consumen_por_100", "con_algun_consumo_por_100", "en_traslape", "sin_coordenada_propia",
                           huella_col]], on="id")
    post = res.tomas_post_firma.replace(0, np.nan)
    res["huella_usada"] = huella_col.replace("en_huella_base_", "")
    res["huella_previa_de_cada_100"] = (100 * res[huella_col] / post).round(1)
    res["sin_coordenada_de_cada_100"] = (100 * res.sin_coordenada_propia / post).round(1)
    res["dudoso_motivo"] = np.select(
        [res.exceso_sobre_unidades > 0.10 * res.unidades, res.sin_coordenada_de_cada_100 > 10, res.huella_previa_de_cada_100 > 10],
        ["exceso sobre unidades", "sin coordenada propia", "tomas en techo " + huella_col.replace("en_huella_base_", "").upper()], default="")
    res["contratado_sin_ocupar"] = res.consumen_por_100 < 70
    res["consolidacion_con_consumo"] = (res.contratadas_con_tope * res.consumen_por_100.fillna(0) / 100 / res.unidades).round(4)

    # Referencia R(a), sin los dudosos (condicion 1).
    base_ref = res[res.habitacional & (res.unidades >= 20) & (res.edad_meses >= 36) & (res.dudoso_motivo == "")].id
    rb = piv.loc[base_ref]
    ref, ref25, ref75 = rb.median(), rb.quantile(0.25), rb.quantile(0.75)
    R24 = float(ref[EDAD_CLASE])
    corte_baja, corte_alta = (1 / 3) / R24, (2 / 3) / R24

    def clase_r(r: float) -> str:
        return "baja" if r < corte_baja else ("alta" if r >= corte_alta else "media")

    clase, r_col, a_col, c_col = [], [], [], []
    for _, f in res.iterrows():
        a = min(EDAD_CLASE, f.edad_meses)
        cval = piv.loc[f.id, a] if a in piv.columns else np.nan
        r = cval / ref[a] if a in ref.index and ref[a] > 0 else np.nan
        if not f.habitacional:
            et = "no habitacional"
        elif f.unidades < 20:
            et = "sin clasificar, muestra chica"
        elif f.edad_meses < 12:
            et = "sin clasificar, muy reciente"
        elif f.dudoso_motivo:
            et = f"{clase_r(r)} (por revisar)"
        else:
            et = clase_r(r)
        clase.append(et)
        r_col.append(round(float(r), 4) if pd.notna(r) else None)
        a_col.append(a)
        c_col.append(round(float(cval), 4) if pd.notna(cval) else None)
    res["edad_eval"], res["c_eval"], res["r"], res["clase"] = a_col, c_col, r_col, clase
    res["clase_base"] = res.clase.str.replace(" (por revisar)", "", regex=False)
    res["por_revisar"] = res.clase.str.endswith("(por revisar)")
    res["provisional"] = res.clase_base.isin(CLASES) & (res.edad_meses < EDAD_CLASE)

    # Prueba de estabilidad declarada: a* = 24 contra a* = 36.
    mad = res[res.clase.isin(CLASES) & (res.edad_meses >= 36)]
    c36 = [clase_r(piv.loc[i, 36] / ref[36]) for i in mad.id]
    coincide = float(np.mean([a == b for a, b in zip(mad.clase, c36)])) if len(mad) else float("nan")
    distrib = res[res.clase.isin(CLASES)].clase.value_counts(normalize=True).round(3).to_dict()

    # Desarrollo: r ponderado por unidades de sus secciones clasificadas.
    hab = res[res.habitacional]
    elig = hab[hab.clase_base.isin(CLASES)]
    hab = hab.assign(con_consumo_u=hab.consolidacion_con_consumo * hab.unidades)
    des = hab.groupby("desarrollo").agg(convenios=("id", "count"), primera_firma=("firma", "min"), ultima_firma=("firma", "max"),
                                        unidades=("unidades", "sum"), contratadas_con_tope=("contratadas_con_tope", "sum"),
                                        con_consumo_u=("con_consumo_u", "sum"), secciones_por_revisar=("por_revisar", "sum")).reset_index()
    rp = elig.groupby("desarrollo").apply(lambda d: np.average(d.r, weights=d.unidades), include_groups=False)
    des["r_ponderado"] = des.desarrollo.map(rp).round(4)
    des["clase"] = des.r_ponderado.map(lambda r: clase_r(r) if pd.notna(r) else "sin clasificar")
    des.loc[(des.secciones_por_revisar > 0) & des.clase.isin(CLASES), "clase"] += " (por revisar)"
    des["consolidacion_actual"] = (des.contratadas_con_tope / des.unidades).round(4)
    des["consolidacion_con_consumo"] = (des.con_consumo_u / des.unidades).round(4)
    des = des.drop(columns="con_consumo_u")

    # Sector de cada convenio (punto representativo).
    sec = gpd.read_file(SECTORES).to_crs(4326).rename(columns={"Sect": "sector"})[["sector", "geometry"]]
    pts = gpd.GeoDataFrame(m[["id"]], geometry=m.to_crs(32614).geometry.representative_point().to_crs(4326), crs=4326)
    sj = gpd.sjoin(pts, sec, how="left", predicate="within").drop_duplicates("id").set_index("id").sector
    res["sector"] = res.id.map(sj).fillna("fuera_de_sectores")
    por_sector = res[res.habitacional].pivot_table(index="sector", columns="clase", values="unidades", aggfunc="sum", fill_value=0)

    curvas.to_csv(SAL / "1b-curvas-mensuales.csv", index=False, encoding="utf-8")
    res.to_csv(SAL / "1b-por-convenio.csv", index=False, encoding="utf-8")
    des.to_csv(SAL / "1b-por-desarrollo.csv", index=False, encoding="utf-8")
    pd.DataFrame({"p25": ref25, "mediana": ref, "p75": ref75}).round(4).to_csv(SAL / "1b-curva-referencia.csv", encoding="utf-8")
    por_sector.to_csv(SAL / "1b-unidades-por-sector-y-clase.csv", encoding="utf-8")

    casos = {k: hab[hab.desarrollo.str.match(p)][["id", "desarrollo", "firma", "unidades", "tomas_contratadas", "consolidacion_actual", "edad_eval",
                                                    "c_eval", "r", "clase", "consumen_por_100", "consolidacion_con_consumo", "dudoso_motivo"]].to_dict("records")
             for k, p in CASOS.items()}
    salida = {
        "convenios": int(len(res)), "habitacionales": int(res.habitacional.sum()),
        "referencia": {"convenios": int(len(base_ref)),
                       "p25_mediana_p75": {int(a): [round(float(ref25[a]), 3), round(float(ref[a]), 3), round(float(ref75[a]), 3)] for a in (6, 12, 18, 24, 36)}},
        "cortes_r": [round(corte_baja, 4), round(corte_alta, 4)],
        "clases_habitacionales": hab.clase.value_counts().to_dict(),
        "huella_previa_usada": res.huella_usada.iloc[0],
        "por_revisar": hab[hab.por_revisar].clase.value_counts().to_dict(),
        "a_24_meses": hab[hab.clase.isin(CLASES) & ~hab.provisional].clase.value_counts().to_dict(),
        "provisionales": hab[hab.provisional].clase.value_counts().to_dict(),
        "dudosos_por_motivo": hab[hab.dudoso_motivo != ""].dudoso_motivo.value_counts().to_dict(),
        "contratado_sin_ocupar": int(hab.contratado_sin_ocupar.sum()),
        "estabilidad_24_contra_36": {"convenios": int(len(mad)), "coinciden": round(coincide, 3), "pasa": bool(coincide >= 0.60)},
        "distribucion_clases": distrib, "clases_bajo_10_de_cada_100": [k for k, v in distrib.items() if v < 0.10],
        "desarrollos_por_clase": des.clase.value_counts().to_dict(),
        "prueba_codigo_regla_balance": prueba.to_dict("records"),
        "por_contratar_por_edad": {
            "menos_de_4_anios": int((res.unidades - res.contratadas_con_tope)[res.edad_meses < 48].sum()),
            "4_anios_o_mas": int((res.unidades - res.contratadas_con_tope)[res.edad_meses >= 48].sum())},
        "casos": casos,
    }
    (SAL / "1b-resumen.json").write_text(json.dumps(salida, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    grafica(curvas, hab, ref, ref25, ref75)
    print(json.dumps({k: v for k, v in salida.items() if k not in ("casos", "prueba_codigo_regla_balance")}, ensure_ascii=False, indent=1))


def grafica(curvas, hab, ref, ref25, ref75) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ejes = plt.subplots(1, 3, figsize=(15, 4.2), sharey=True)
    for ax, (k, pat) in zip(ejes, CASOS.items()):
        ax.fill_between(ref.index, 100 * ref25, 100 * ref75, color="#999999", alpha=0.18, lw=0, label="referencia p25-p75")
        ax.plot(ref.index, 100 * ref, color="#666666", lw=1, ls="--", label="referencia (mediana)")
        for _, c in hab[hab.desarrollo.str.match(pat)].iterrows():
            s = curvas[curvas.id == c.id]
            ax.plot(s.edad_meses, 100 * s.consolidacion, lw=1.6, label=f"{c.desarrollo} ({c.firma}): {c.clase.replace('sin clasificar, ', '')}")
        ax.set_title(k)
        ax.set_xlabel("Meses desde la firma")
        ax.set_ylim(0, 105)
        ax.grid(alpha=0.25)
        ax.legend(fontsize=6.5, loc="upper left")
    ejes[0].set_ylabel("Consolidación, % de unidades con toma")
    fig.suptitle("Ritmo de consolidación por convenio: tomas domésticas y mixtas contratadas desde la firma (corte sep-2026)")
    fig.tight_layout()
    fig.savefig(SAL / "1b-casos-del-jefe.png", dpi=150)


if __name__ == "__main__":
    main()
