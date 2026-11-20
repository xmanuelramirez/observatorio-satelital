"""
Planeacion Integral, frente 1b: ritmo de consolidacion mensual por convenio y por desarrollo (metodo declarado en
`ORDENES-DEL-MASTER/2026-11-19-planeacion-integral-METODO.md`). Solo agregados.

Insumos (fuera del repositorio):
  - poligonos: `13. NUEVOS DESARROLLOS/salidas/planeacion-integral/convenios-2019-hoy.geojson` (id CONV-AAAA-NNN);
  - nombres: `0. CAPAS VARIAS/FACTIBILIDADES_CONVENIOS.geojson`, con la regla del id de Nuevos Desarrollos (dentro de cada
    año, orden por nombre y numeracion desde 001), comprobada con unidades y area;
  - conteos: Analisis de Cuentas, `entregas/2026-11-19-planeacion-integral-satelite/A-tomas-dom-mix-convenio-mes.csv`.

Deja en `salidas/planeacion-integral/`: curvas mensuales, tabla por convenio, por desarrollo y la grafica de los tres
casos del jefe.

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
CONV = APPS / "13. NUEVOS DESARROLLOS" / "salidas" / "planeacion-integral" / "convenios-2019-hoy.geojson"
NOMBRES = APPS / "0. CAPAS VARIAS" / "FACTIBILIDADES_CONVENIOS.geojson"
CONTEOS = APPS / "11. ANALISIS DE CUENTAS" / "ORDENES-DEL-MASTER" / "entregas" / "2026-11-19-planeacion-integral-satelite" / "A-tomas-dom-mix-convenio-mes.csv"
COHORTES = APPS / "2. BALANCE HÍDRICO" / "entregas" / "2026-11-18-convenios-cohortes-satelital" / "cohortes.csv"
CORTE = pd.Period("2026-09", "M")
EDAD_CLASE = 24
CASOS = {"MARROKA": r"^MARROKA", "ZANDA": r"^ZANDA", "EL MOLINO": r"^EL MOLINO"}


def desarrollo(nombre: str) -> str:
    base = str(nombre).split("_")[0]
    return re.sub(r"\s+", " ", base).strip().upper()


def clase_24(c: float) -> str:
    return "alta" if c >= 2 / 3 else ("media" if c >= 1 / 3 else "baja")


def clase_rel(r: float) -> str:
    return "alta" if r >= 1.25 else ("media" if r >= 0.75 else "baja")


def main() -> None:
    SAL.mkdir(parents=True, exist_ok=True)
    conv = gpd.read_file(CONV)
    nom = gpd.read_file(NOMBRES)
    nom = nom.sort_values(["anio", "nombre"], kind="stable")
    nom["id"] = nom.groupby("anio").cumcount().add(1).map("{:03d}".format).radd("CONV-" + nom["anio"].astype(str) + "-")
    m = conv.merge(nom[["id", "nombre", "unidades", "area_m2"]], on="id", how="left", suffixes=("", "_n"))
    ok_u = (m.unidades.fillna(-1) == m.unidades_n.fillna(-1))
    ok_a = np.isclose(m.area_ha * 1e4, m.area_m2, rtol=0.02)
    assert ok_u.all() and ok_a.mean() > 0.97, f"la liga de nombres no cuadra: unidades {ok_u.mean():.3f}, area {ok_a.mean():.3f}"
    m["desarrollo"] = m.nombre.map(desarrollo)
    m["firma"] = pd.PeriodIndex(m.fecha.fillna(m.anio.astype(str) + "-01"), freq="M")
    m["habitacional"] = (m.tipo == "habitacional") & (m.unidades.fillna(0) >= 5)

    t = pd.read_csv(CONTEOS)
    previas = t[t.mes == "previas"].groupby("id").tomas_dom_mix.sum()
    t = t[t.mes.str.match(r"^\d{4}-\d{2}$")].copy()
    t["mes"] = pd.PeriodIndex(t.mes, freq="M")

    # Curvas mensuales por convenio, desde el mes de firma hasta el corte.
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
        resumen.append({
            "id": c.id, "desarrollo": c.desarrollo, "anio": int(c.anio), "firma": str(c.firma), "habitacional": bool(c.habitacional),
            "unidades": int(c.unidades), "tomas_contratadas": total, "contratadas_con_tope": int(min(total, c.unidades)),
            "exceso_sobre_unidades": int(max(0, total - c.unidades)), "previas": int(previas.get(c.id, 0)),
            "edad_meses": len(meses) - 1, "consolidacion_actual": round(float(cons.iloc[-1]), 4) if len(cons) else 0.0,
            "consolidacion_24m": round(float(cons.iloc[EDAD_CLASE]), 4) if len(cons) > EDAD_CLASE else None,
        })
    curvas = pd.DataFrame(filas)
    res = pd.DataFrame(resumen)

    # Referencia por edad: mediana de los convenios habitacionales con 24 meses o mas de exposicion.
    viejos = res[res.habitacional & (res.edad_meses >= EDAD_CLASE)].id
    ref = curvas[curvas.id.isin(viejos) & (curvas.edad_meses <= EDAD_CLASE)].groupby("edad_meses").consolidacion.median()
    def clasificar(f):
        if f.consolidacion_24m is not None and not pd.isna(f.consolidacion_24m):
            return clase_24(f.consolidacion_24m), False, None
        r = ref.get(f.edad_meses, np.nan)
        if not r or np.isnan(r):
            return "sin referencia", True, None
        return clase_rel(f.consolidacion_actual / r), True, round(float(f.consolidacion_actual / r), 3)
    cl = res.apply(clasificar, axis=1, result_type="expand")
    res["clase"], res["provisional"], res["razon_contra_referencia"] = cl[0], cl[1], cl[2]

    # Contraste declarado: suma con tope por año de firma contra Balance (a 10 % o menos).
    bal = pd.read_csv(COHORTES).set_index("anio")["contratadas_con_tope"]
    mio = res.groupby("anio").contratadas_con_tope.sum()
    contraste = {int(a): {"satelite": int(mio.get(a, 0)), "balance": int(bal[a]), "diferencia": round(float(mio.get(a, 0) / bal[a] - 1), 4)}
                 for a in bal.index if a <= 2025}
    contraste_pasa = all(abs(v["diferencia"]) <= 0.10 for v in contraste.values())

    # Por desarrollo (habitacionales): suma de unidades y tomas; clase por la consolidacion de unidades con 24 meses.
    hab = res[res.habitacional]
    des = hab.groupby("desarrollo").agg(convenios=("id", "count"), primera_firma=("firma", "min"), ultima_firma=("firma", "max"),
                                        unidades=("unidades", "sum"), contratadas_con_tope=("contratadas_con_tope", "sum")).reset_index()
    des["consolidacion_actual"] = (des.contratadas_con_tope / des.unidades).round(4)
    clases = hab.groupby("desarrollo").clase.agg(lambda s: s.value_counts().idxmax())
    des["clase_mayoritaria_de_sus_convenios"] = des.desarrollo.map(clases)

    curvas.to_csv(SAL / "1b-curvas-mensuales.csv", index=False, encoding="utf-8")
    res.to_csv(SAL / "1b-por-convenio.csv", index=False, encoding="utf-8")
    des.to_csv(SAL / "1b-por-desarrollo.csv", index=False, encoding="utf-8")
    ref.rename("referencia_mediana").to_csv(SAL / "1b-curva-referencia.csv", encoding="utf-8")

    casos = {}
    for k, pat in CASOS.items():
        sel = hab[hab.desarrollo.str.match(pat)]
        casos[k] = sel[["id", "desarrollo", "firma", "unidades", "tomas_contratadas", "consolidacion_actual", "consolidacion_24m", "clase", "provisional"]].to_dict("records")

    salida = {
        "convenios": int(len(res)), "habitacionales": int(res.habitacional.sum()),
        "clases_habitacionales": hab.clase.value_counts().to_dict(),
        "clases_firmes": hab[~hab.provisional].clase.value_counts().to_dict(),
        "referencia_edades": {int(k): round(float(v), 3) for k, v in ref.items() if k in (0, 6, 12, 18, 24)},
        "contraste_balance": contraste, "contraste_pasa": contraste_pasa,
        "casos": casos,
    }
    (SAL / "1b-resumen.json").write_text(json.dumps(salida, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    grafica(curvas, hab)
    print(json.dumps({k: salida[k] for k in ["convenios", "habitacionales", "clases_habitacionales", "clases_firmes", "referencia_edades", "contraste_pasa"]}, ensure_ascii=False))
    print(json.dumps(salida["contraste_balance"]))


def grafica(curvas: pd.DataFrame, hab: pd.DataFrame) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ejes = plt.subplots(1, 3, figsize=(15, 4.2), sharey=True)
    for ax, (k, pat) in zip(ejes, CASOS.items()):
        for _, c in hab[hab.desarrollo.str.match(pat)].iterrows():
            s = curvas[curvas.id == c.id]
            ax.plot(pd.PeriodIndex(s.mes, freq="M").to_timestamp(), 100 * s.consolidacion, lw=1.6,
                    label=f"{c.desarrollo} ({c.firma}, {c.unidades} u)")
        ax.set_title(k)
        ax.set_ylim(0, 105)
        ax.grid(alpha=0.25)
        ax.legend(fontsize=7, loc="lower right")
    ejes[0].set_ylabel("Consolidación, % de unidades con toma")
    fig.suptitle("Ritmo de consolidación por convenio: tomas domésticas y mixtas contratadas desde la firma (corte sep-2026)")
    fig.tight_layout()
    fig.savefig(SAL / "1b-casos-del-jefe.png", dpi=150)


if __name__ == "__main__":
    main()
