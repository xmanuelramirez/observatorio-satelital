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
    conv["geometry"] = conv.make_valid()
    nd_full = gpd.read_file(APPS / "13. NUEVOS DESARROLLOS" / "salidas" / "observatorio" / "factibilidades.geojson").to_crs(CRS)
    # ND corrige las geometrias en origen desde el 12/11/2026 (campo `geometria`); aqui no se reparan. Las que ND marca
    # «invalida» quedan fuera y se cuentan.
    if "geometria" in nd_full.columns:
        nd_invalidas = int((nd_full["geometria"] == "invalida").sum())
        nd_full = nd_full[nd_full["geometria"] != "invalida"]
    else:
        nd_invalidas = None
    nd_full = nd_full[["folio", "fecha_lote", "geometry"]]
    nd = nd_full[["fecha_lote", "geometry"]]
    sect = gpd.read_file(APPS / "2. BALANCE HÍDRICO" / "CAPAS-VIGENTES" / "2026-11-05" / "SECTORES.geojson").to_crs(CRS)

    cand = gpd.read_file(SALIDA / "candidatas-2025-2026.geojson").to_crs(CRS)
    # Las candidatas son celdas que se tocan en un MultiPolygon: make_valid pierde area; la union de sus celdas no (61.1 ha
    # por conteo de celdas, 61.2 por union).
    cand["geometry"] = [gpd.GeoSeries(list(g.geoms), crs=CRS).union_all() for g in cand.geometry]
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
    r["metrica_2"]["factibilidades_nd"] = {"poligonos": int(len(nd)), "invalidas_excluidas": nd_invalidas, "automata": fraccion(nd, auto_todo, "automata"),
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
    r["automata"] = {"poligonos": int(len(auto)), "ha_suma_horizontes": round(float(auto.area.sum()) / 1e4, 1),
                     "ha_union": round(float(auto_todo.area) / 1e4, 1), "ha_union_2025_2030": round(float(auto_corto.area) / 1e4, 1),
                     "ha_union_solo_2025": round(float(auto[auto["year"] == 2025].union_all().area) / 1e4, 1)}

    # Condicion 1 del juez (12/11/2026): dentro y fuera del limite urbano POTE 2020, con la base al azar (fraccion de la
    # zona cubierta por el automata) junto a cada cifra. Zona de trabajo: limite urbano + 3 km, recortado al municipio.
    urb = gpd.read_file(APPS / "0. CAPAS VARIAS" / "LIMITES_VIGENTES" / "LIMITE_URBANO_POTE_2020" / "Limite_Urbano_Pote_2020.shp")
    urb = (urb if urb.crs else urb.set_crs(CRS)).to_crs(CRS).union_all()
    mun = gpd.read_file(APPS / "0. CAPAS VARIAS" / "LIMITES_VIGENTES" / "LIMITE MUNICIPAL" / "LIMITE_MUNICIPAL.shp")
    mun = (mun if mun.crs else mun.set_crs(CRS)).to_crs(CRS).union_all()
    zona = urb.buffer(3000).intersection(mun)
    anillo = zona.difference(urb)
    solo_2025 = auto[auto["year"] == 2025].union_all()

    def base(area, a):
        return round(float(a.intersection(area).area) / float(area.area), 3)

    r["por_ambito"] = {"base_al_azar": {
        "zona_de_trabajo": {"2050": base(zona, auto_todo), "2030": base(zona, auto_corto)},
        "dentro_limite_urbano": {"2050": base(urb, auto_todo), "2030": base(urb, auto_corto)},
        "fuera_anillo_periurbano": {"2050": base(anillo, auto_todo), "2030": base(anillo, auto_corto)},
    }}
    for etiqueta, g in (("factibilidades_nd", nd), ("convenios_2025_2026", conv[conv["anio"] >= 2025])):
        u = g.union_all()
        fila = {}
        for ambito, area in (("total", zona.union(u)), ("dentro_limite_urbano", urb), ("fuera", mun.difference(urb))):
            parte = u.intersection(area)
            fila[ambito] = {
                "ha": round(float(parte.area) / 1e4, 2),
                "a_2050": round(float(parte.intersection(auto_todo).area) / float(parte.area), 3) if parte.area else None,
                "a_2030_rango": [round(float(parte.intersection(solo_2025).area) / float(parte.area), 3),
                                 round(float(parte.intersection(auto_corto).area) / float(parte.area), 3)] if parte.area else None,
            }
        fila["poligonos"] = int(len(g))
        fila["poligonos_que_tocan_automata"] = int(g.intersects(auto_todo).sum())
        r["por_ambito"][etiqueta] = fila
    # Sensibilidad de la condicion 3: sin FAC 938 (ya convenida) y sin FAC 892 y 893.
    if "folio" in nd_full.columns:
        sens = {}
        for nombre, quitar in (("sin_FAC_938", ["FAC 938"]), ("sin_FAC_892_893", ["FAC 892", "FAC 893"])):
            g = nd_full[~nd_full["folio"].isin(quitar)]
            u = g.union_all()
            sens[nombre] = round(float(u.intersection(auto_todo).area) / float(u.area), 3)
        r["por_ambito"]["factibilidades_nd"]["sensibilidad_a_2050"] = sens
    (SALIDA / "concordancia.json").write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(r, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
