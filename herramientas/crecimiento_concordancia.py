"""
Concordancia de la vista «Zonas de crecimiento» (metricas declaradas en la seccion 0 bis de
`ORDENES-DEL-MASTER/2026-11-12-zonas-de-crecimiento.md`, antes de cruzar).

Fracciones de superficie en EPSG:32614:
  1. Superficie candidata confirmada a ojo (y, aparte, confirmada o dudosa) dentro del automata (corto plazo 2025-2030 y
     cualquier horizonte), de convenios y de factibilidades nuevas de ND.
  2. Factibilidades nuevas de ND y convenios 2025-2026 dentro del automata (contexto: convenios 2019-2024).
  3. Zonas candidatas confirmadas fuera de todo, por sector.

Uso: python herramientas/crecimiento_concordancia.py
"""

from __future__ import annotations

import json
from pathlib import Path

import geopandas as gpd
import pandas as pd

RAIZ = Path(__file__).resolve().parents[1]
APPS = RAIZ.parent
SALIDA = RAIZ / "salidas" / "crecimiento"
CRS = 32614


def fraccion(a: gpd.GeoDataFrame, b, nombre: str) -> dict:
    if len(a) == 0:
        return {"superficie_ha": 0.0, f"dentro_de_{nombre}_ha": 0.0, "fraccion": None}
    total = float(a.union_all().area)
    dentro = float(a.union_all().intersection(b).area)
    return {"superficie_ha": round(total / 1e4, 2), f"dentro_de_{nombre}_ha": round(dentro / 1e4, 2),
            "fraccion": round(dentro / total, 3) if total else None}


def main() -> None:
    auto = gpd.read_file(APPS / "0. CAPAS VARIAS" / "AUTOMATAS_CELULARES" / "COMBINADO.shp").to_crs(CRS)
    auto["geometry"] = auto.make_valid()
    auto_todo = auto.union_all()
    auto_corto = auto[auto["year"].isin([2025, 2030])].union_all()
    conv = gpd.read_file(APPS / "0. CAPAS VARIAS" / "FACTIBILIDADES_CONVENIOS.geojson")[["anio", "geometry"]].to_crs(CRS)
    conv["geometry"] = conv.buffer(0)
    nd = gpd.read_file(APPS / "13. NUEVOS DESARROLLOS" / "salidas" / "observatorio" / "factibilidades.geojson")[["fecha_lote", "geometry"]].to_crs(CRS)
    nd["geometry"] = nd.buffer(0)
    sect = gpd.read_file(APPS / "2. BALANCE HÍDRICO" / "CAPAS-VIGENTES" / "2026-11-05" / "SECTORES.geojson").to_crs(CRS)

    cand = gpd.read_file(SALIDA / "candidatas-2025-2026.geojson").to_crs(CRS)
    cand["geometry"] = cand.buffer(0)
    rev = pd.read_csv(SALIDA / "revision-zonas.csv").set_index("id")
    cand["revision"] = cand["id"].map(rev["es_cambio_real"]).fillna("sin revisar")
    conf = cand[cand["revision"] == "si"]
    conf_dud = cand[cand["revision"].isin(["si", "dudoso"])]
    conv_todo = conv.union_all()

    r = {"metrica_1": {}, "metrica_2": {}, "metrica_3": []}
    for nombre, g in (("confirmadas", conf), ("confirmadas_o_dudosas", conf_dud)):
        r["metrica_1"][nombre] = {
            "zonas": int(len(g)),
            "automata_cualquier_horizonte": fraccion(g, auto_todo, "automata"),
            "automata_corto_plazo": fraccion(g, auto_corto, "automata_corto"),
            "convenios": fraccion(g, conv_todo, "convenios"),
            "factibilidades_nd": fraccion(g, nd.union_all(), "factibilidades"),
        }
    r["metrica_2"]["factibilidades_nd"] = {"poligonos": int(len(nd)), "automata": fraccion(nd, auto_todo, "automata"),
                                          "automata_corto": fraccion(nd, auto_corto, "automata_corto")}
    for etiqueta, sel in (("convenios_2025_2026", conv["anio"] >= 2025), ("convenios_2019_2024", conv["anio"] <= 2024)):
        g = conv[sel]
        r["metrica_2"][etiqueta] = {"poligonos": int(len(g)), "automata": fraccion(g, auto_todo, "automata"),
                                   "automata_corto": fraccion(g, auto_corto, "automata_corto")}
    previsto = auto_todo.union(conv_todo).union(nd.union_all())
    fuera = conf_dud[~conf_dud.intersects(previsto)]
    if len(fuera):
        j = gpd.sjoin(fuera.assign(geometry=fuera.representative_point()), sect[["Sect", "geometry"]], how="left", predicate="within")
        for _, f in j.iterrows():
            r["metrica_3"].append({"zona": f["id"], "revision": f["revision"], "hectareas": f["hectareas"],
                                   "sector": None if pd.isna(f.get("Sect")) else str(f["Sect"])})
    r["automata"] = {"poligonos": int(len(auto)), "ha": round(float(auto.area.sum()) / 1e4, 1),
                     "ha_corto_plazo": round(float(auto_corto.area) / 1e4, 1)}
    (SALIDA / "concordancia.json").write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(r, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
