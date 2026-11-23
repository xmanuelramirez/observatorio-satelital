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

    hab[["id", "desarrollo", "firma", "unidades", "tipo", "fuente", "clase", "clase_base", "por_revisar", "provisional",
         "consolidacion_actual", "consolidacion_con_consumo", "edad_meses"]].to_csv(SAL / "1b-por-tipo-por-convenio.csv", index=False, encoding="utf-8")
    (SAL / "1b-por-tipo-resumen.json").write_text(json.dumps(res, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print(json.dumps(res, ensure_ascii=False, indent=1, default=str))


if __name__ == "__main__":
    main()
