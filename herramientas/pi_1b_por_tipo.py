"""
Ritmo de consolidacion por tipo de desarrollo (vivienda / vertical / lote). Metodo fijado antes de medir en
`docs/metodos/ritmo-consolidacion-por-tipo.md`. Base: la v5 del ritmo de consolidacion (corte oct-2026). Solo agregados.

Uso: python herramientas/pi_1b_por_tipo.py <csv de tipos de Nuevos Desarrollos>
     (columnas: id, tipo y fuente; se aceptan nombres equivalentes, ver `leer_tipos`).
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

RAIZ = Path(__file__).resolve().parents[1]
SAL = RAIZ / "salidas" / "planeacion-integral"
EDADES = [12, 24, 36]
MIN_REF = 10
UMBRAL_BRECHA = 0.15
CLASES = ["alta", "media", "baja"]


def leer_tipos(ruta: Path) -> pd.DataFrame:
    t = pd.read_csv(ruta)
    cols = {c.lower(): c for c in t.columns}
    def col(*nombres):
        for n in nombres:
            if n in cols:
                return cols[n]
        raise KeyError(f"falta una de {nombres} en {list(t.columns)}")
    t = t.rename(columns={col("id", "id_convenio"): "id", col("tipo", "tipo_desarrollo", "tipo_de_desarrollo"): "tipo",
                          col("fuente", "fuente_tipo", "origen_tipo"): "fuente"})
    t["tipo"] = t.tipo.astype(str).str.strip().str.lower().replace(
        {"vivienda horizontal": "vivienda", "vivienda vertical": "vertical", "sin dato": "sin tipo"})  # metodo v1.1
    t["fuente"] = t.fuente.astype(str).str.strip().str.lower()
    return t[["id", "tipo", "fuente"]]


def curva(piv: pd.DataFrame, ids) -> dict:
    sub = piv.loc[piv.index.intersection(list(ids))]
    if len(sub) < MIN_REF:
        return {"convenios_referencia": int(len(sub)), "nota": f"menos de {MIN_REF}: sin mediana"}
    out = {"convenios_referencia": int(len(sub))}
    for a in EDADES:
        v = sub[a].dropna()
        out[str(a)] = [round(float(v.quantile(0.25)), 3), round(float(v.median()), 3), round(float(v.quantile(0.75)), 3)]
    return out


def main() -> None:
    tipos = leer_tipos(Path(sys.argv[1]))
    r = pd.read_csv(SAL / "1b-por-convenio.csv")
    hab = r[r.habitacional].merge(tipos, on="id", how="left")
    hab["tipo"] = hab.tipo.fillna("sin tipo")
    hab["fuente"] = hab.fuente.fillna("sin dato")
    curvas = pd.read_csv(SAL / "1b-curvas-mensuales.csv")
    piv = curvas.pivot(index="id", columns="edad_meses", values="consolidacion")
    ref = hab[(hab.unidades >= 20) & (hab.edad_meses >= 36) & (hab.dudoso_motivo.fillna("") == "")]

    conteo = hab.groupby(["tipo", "fuente"]).agg(convenios=("id", "count"), unidades=("unidades", "sum")).reset_index()
    conteo_ref = ref.groupby(["tipo", "fuente"]).id.count().rename("convenios_referencia").reset_index()
    conteo = conteo.merge(conteo_ref, on=["tipo", "fuente"], how="left").fillna({"convenios_referencia": 0})

    res = {"conteo": conteo.to_dict("records"), "curvas": {}, "clases": {}, "brecha_urbanizado_contratado": {}}
    # Metodo v1.1: ningun convenio trae «dato»; se reporta vacio y se entregan las pistas, todas y sin las de densidad.
    escenarios = {"principal_dato": ["dato"],
                  "todas_las_pistas": ["dato", "pista-densidad", "pista-nombre", "pista-factibilidad"],
                  "pistas_sin_densidad": ["dato", "pista-nombre", "pista-factibilidad"]}
    for escenario, fuentes in escenarios.items():
        res["curvas"][escenario] = {t: curva(piv, ref[(ref.tipo == t) & ref.fuente.isin(fuentes)].id) for t in ["vivienda", "vertical", "lote"]}
        sel = hab[hab.fuente.isin(fuentes)]
        cl = sel.assign(clase_base=sel.clase_base.where(sel.clase_base.isin(CLASES), "sin clasificar"))
        tab = cl.pivot_table(index="tipo", columns="clase_base", values="id", aggfunc="count", fill_value=0)
        tabu = cl.pivot_table(index="tipo", columns="clase_base", values="unidades", aggfunc="sum", fill_value=0)
        res["clases"][escenario] = {"convenios": tab.to_dict("index"), "unidades": tabu.to_dict("index"),
                                     "por_revisar": cl.groupby("tipo").por_revisar.sum().astype(int).to_dict()}

        par = pd.read_csv(SAL / "1c-par-antes-despues.csv")
        par = par[~par.unidad.astype(str).str.startswith("DES:") & ~par.vertical].rename(columns={"unidad": "id"})
        par = par.merge(sel[["id", "tipo"]], on="id", how="inner")
        par["brecha"] = par.urbanizado_2026 - par.consolidacion_tomas_2026
        b = {}
        for t in ["vivienda", "vertical", "lote"]:
            x = par[par.tipo == t].brecha.dropna()
            b[t] = {"convenios_con_par": int(len(x))} | ({"brecha_mediana": round(float(x.median()), 3), "p25_p75": [round(float(x.quantile(.25)), 3), round(float(x.quantile(.75)), 3)]}
                                                       if len(x) >= MIN_REF else {"nota": f"menos de {MIN_REF}: sin mediana", "casos": x.round(3).tolist()})
        if "brecha_mediana" in b["lote"] and "brecha_mediana" in b["vivienda"]:
            dif = b["lote"]["brecha_mediana"] - b["vivienda"]["brecha_mediana"]
            b["contraste_lote_menos_vivienda"] = {"diferencia": round(dif, 3), "umbral": UMBRAL_BRECHA, "pasa": bool(dif >= UMBRAL_BRECHA)}
        else:
            b["contraste_lote_menos_vivienda"] = {"nota": "no evaluable: algún tipo con menos de 10 convenios con par"}
        res["brecha_urbanizado_contratado"][escenario] = b

    # Condiciones del dictamen del juez del 23/11 (2026-11-23-DICTAMEN-JUEZ-RITMO-POR-TIPO.md): vertical sin curva, porque
    # el filtro de dudoso selecciona sus ceros; horizontal como aproximacion; lote solo casos; sin dato como lectura posterior.
    for esc in res["curvas"].values():
        esc["vertical"] = {"convenios_referencia": esc["vertical"].get("convenios_referencia"),
                           "nota": "sin curva: el filtro de dudoso deja en la referencia solo los verticales sin tomas (dictamen del 23/11)"}
    ref_h = ref[(ref.tipo == "vivienda") & ref.fuente.str.startswith("pista")].id
    mh = piv.loc[ref_h].median()
    mg = piv.loc[ref.id].median()
    v30 = hab[(hab.tipo == "vertical") & (hab.unidades >= 20) & (hab.edad_meses >= 36)]
    sd = ref[ref.tipo == "sin tipo"].id
    lo = ref[ref.tipo == "lote"].id
    res["lamina"] = {
        "rotulo": "Tipo aproximado: ningún registro trae el tipo; Nuevos Desarrollos lo infiere por la densidad del convenio (unidades por hectárea), el nombre y la factibilidad. Contratado no es construido. Padrón a oct-2026.",
        "horizontal": {"convenios_referencia": int(len(ref_h)), "a_24_meses": round(float(mh[24]), 3), "banda_24": [round(float(piv.loc[ref_h, 24].quantile(.25)), 3), round(float(piv.loc[ref_h, 24].quantile(.75)), 3)],
                       "a_12": round(float(mh[12]), 3), "a_36": round(float(mh[36]), 3), "meses_50": int(mh[mh >= 0.5].index.min()),
                       "texto": "Vivienda horizontal: alrededor de 8 de cada 10 unidades con toma a los 24 meses (banda de 44 a 96 %); alrededor de 4 de cada 10 a los 12 meses y 9 de cada 10 a los 36. 92 convenios de referencia."},
        "ciudad_meses_50": int(mg[mg >= 0.5].index.min()),
        "vertical": {"maduros_20u_36m": int(len(v30)), "a_la_mitad_a_24_meses": int((piv.loc[v30.id, 24] >= 0.5).sum()),
                     "sin_tomas_a_24_meses": int((piv.loc[v30.id, 24] == 0).sum()), "sin_tomas_hoy": int((v30.consolidacion_actual == 0).sum()),
                     "meses_50": "sin dato suficiente",
                     "texto": "Vivienda vertical: sin curva. De 30 convenios verticales con 3 años o más, 16 ya iban a la mitad a los 24 meses y 10 no tenían tomas a esa edad (8 hoy). La toma en edificios no se mide bien todavía."},
        "lote": {"convenios_referencia": int(len(lo)), "a_24_meses_casos": [round(float(x), 3) for x in piv.loc[lo, 24]], "meses_50": "sin dato suficiente",
                 "texto": "Lote: 3 convenios con 3 años o más; no alcanza para una curva."},
        "baja_densidad_lectura_posterior": {"convenios_referencia": int(len(sd)), "a_24_mediana": round(float(piv.loc[sd, 24].median()), 3),
                                            "texto": "Baja densidad (menos de 33 unidades por ha): 14 convenios de 7 desarrollos, alrededor de 1 de cada 10 unidades con toma a los 24 meses. Lectura posterior."},
        "ayuda": "Horizontal = 33 a 256 unidades por ha. Con otros umbrales, la horizontal a 24 meses va de 74 a 84 %.",
    }
    # Curva mensual de horizontal y de la ciudad, para el deck (formato largo, como 1b-curvas-mensuales.csv).
    filas = []
    for serie, ids in (("vivienda horizontal (pista)", ref_h), ("ciudad (referencia v5)", ref.id)):
        sub = piv.loc[ids]
        for a_ in range(0, 37):
            col = sub[a_].dropna()
            filas.append({"serie": serie, "edad_meses": a_, "convenios": int(len(col)), "p25": round(float(col.quantile(.25)), 4),
                          "consolidacion": round(float(col.median()), 4), "p75": round(float(col.quantile(.75)), 4)})
    pd.DataFrame(filas).to_csv(SAL / "1b-por-tipo-curva-horizontal-y-ciudad.csv", index=False, encoding="utf-8")
    hab.groupby("tipo").agg(convenios=("id", "count"), unidades=("unidades", "sum")).to_csv(SAL / "1b-por-tipo-conteo.csv", encoding="utf-8")

    hab[["id", "desarrollo", "firma", "unidades", "tipo", "fuente", "clase", "clase_base", "por_revisar", "provisional",
         "consolidacion_actual", "consolidacion_con_consumo", "edad_meses"]].to_csv(SAL / "1b-por-tipo-por-convenio.csv", index=False, encoding="utf-8")
    (SAL / "1b-por-tipo-resumen.json").write_text(json.dumps(res, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print(json.dumps(res, ensure_ascii=False, indent=1, default=str))


if __name__ == "__main__":
    main()
