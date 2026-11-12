"""
Resumen por quinquenio de «Zonas de crecimiento»: expansion y consolidacion observadas (GHSL 2000-2020) y previstas por el
automata (horizontes 2025-2050), contra la tasa de crecimiento de la poblacion.

Metodo y cifras de contraste declarados antes de medir en la seccion 5 de
`ORDENES-DEL-MASTER/2026-11-12-zonas-de-crecimiento.md` (12/11/2026). Las cifras van al juez antes de publicarse.

Rejilla: la nativa de GHSL (Mollweide, ESRI:54009, igual area), celdas de 100 m subdivididas a 10 m para pesar cada celda
por la fraccion que cae en el ambito, como `construida_sector.py`.

Deja `salidas/crecimiento/resumen-quinquenios.json`. Con `--publicar` lo copia a `public/apertura/crecimiento/resumen.json`
(solo con dictamen del juez).

Uso: python herramientas/crecimiento_resumen.py [--publicar]
"""

from __future__ import annotations

import json
import shutil
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.io import MemoryFile
from rasterio.windows import from_bounds

RAIZ = Path(__file__).resolve().parents[1]
APPS = RAIZ.parent
GHSL = RAIZ / "salidas" / "construida" / "ghsl"
SALIDA = RAIZ / "salidas" / "crecimiento"
PUBLICO = RAIZ / "public" / "apertura" / "crecimiento" / "resumen.json"
MOLL = "ESRI:54009"
CORTES = [2000, 2005, 2010, 2015, 2020]
HORIZONTES = [2025, 2030, 2035, 2040, 2045, 2050]
SUB = 10
CONSOLIDADO = 0.2
# INEGI: Censo 2000 (14/02), Conteo 2005 (17/10), Censo 2010 (31/05), Encuesta Intercensal 2015, Censo 2020 (15/03).
# Verificado el 12/11/2026 en citypopulation.de (INEGI) y en el Diagnostico Municipal 2020 de IMPLAN Leon.
CENSOS = {2000: 1_134_842, 2005: 1_278_087, 2010: 1_436_480, 2015: 1_578_626, 2020: 1_721_215}
PROYECCION = APPS / "11. ANALISIS DE CUENTAS" / "public" / "data" / "proyeccion-municipal.json"


def leer(corte: int, bounds):
    z = GHSL / f"GHS_BUILT_S_E{corte}_GLOBE_R2023A_54009_100_V1_0_R7_C9.zip"
    with zipfile.ZipFile(z) as zf:
        datos = zf.read([n for n in zf.namelist() if n.endswith(".tif")][0])
    with MemoryFile(datos) as mem, mem.open() as r:
        w = from_bounds(*bounds, r.transform).round_offsets().round_lengths()
        arr = r.read(1, window=w).astype("float64")
        t = r.window_transform(w)
        if r.nodata is not None:
            arr[arr == r.nodata] = np.nan
    return np.nan_to_num(arr), t


def tasa(p0: float, p1: float, anios: float = 5) -> float:
    return (p1 / p0) ** (1 / anios) - 1


def main() -> None:
    mun = gpd.read_file(APPS / "0. CAPAS VARIAS" / "LIMITES_VIGENTES" / "LIMITE MUNICIPAL" / "LIMITE_MUNICIPAL.shp")
    mun = (mun if mun.crs else mun.set_crs(32614)).to_crs(MOLL).union_all()
    urb = gpd.read_file(APPS / "0. CAPAS VARIAS" / "LIMITES_VIGENTES" / "LIMITE_URBANO_POTE_2020" / "Limite_Urbano_Pote_2020.shp")
    urb = (urb if urb.crs else urb.set_crs(32614)).to_crs(MOLL).union_all()
    auto = gpd.read_file(APPS / "0. CAPAS VARIAS" / "AUTOMATAS_CELULARES" / "COMBINADO.shp").to_crs(MOLL)
    auto["geometry"] = auto.make_valid()
    assert set(auto["layer"]) == {f"crecimiento_{h}" for h in HORIZONTES}, "COMBINADO trae otra cosa que los seis horizontes"

    b = mun.bounds
    bounds = (b[0] - 300, b[1] - 300, b[2] + 300, b[3] + 300)
    capas = {c: leer(c, bounds) for c in CORTES}
    t = capas[2020][1]
    alto, ancho = capas[2020][0].shape
    fino = rasterio.Affine(t.a / SUB, 0, t.c, 0, t.e / SUB, t.f)
    forma_fina = (alto * SUB, ancho * SUB)
    ha_fino = abs(fino.a * fino.e) / 1e4

    en_mun = rasterize([(mun, 1)], out_shape=forma_fina, transform=fino, dtype="uint8").astype(bool)
    en_urb = rasterize([(urb, 1)], out_shape=forma_fina, transform=fino, dtype="uint8").astype(bool) & en_mun
    ambitos = {"municipio": en_mun, "dentro_limite_urbano": en_urb, "fuera_limite_urbano": en_mun & ~en_urb}
    # Fraccion de cada celda de 100 m en cada ambito.
    frac = {k: m.reshape(alto, SUB, ancho, SUB).mean(axis=(1, 3)) for k, m in ambitos.items()}

    observado = []
    for a, z in zip(CORTES[:-1], CORTES[1:]):
        b0, b1 = capas[a][0], capas[z][0]
        delta = b1 - b0
        exp = b0 / 1e4 < CONSOLIDADO
        fila = {"periodo": f"{a}-{z}", "inicio": a, "fin": z}
        for k, f in frac.items():
            fila[k] = {
                "expansion_ha": round(float((delta * f * exp).sum()) / 1e4, 1),
                "consolidacion_ha": round(float((delta * f * ~exp).sum()) / 1e4, 1),
            }
            fila[k]["total_ha"] = round(fila[k]["expansion_ha"] + fila[k]["consolidacion_ha"], 1)
        p0, p1 = CENSOS[a], CENSOS[z]
        fila["poblacion"] = {"inicio": p0, "fin": p1, "aumento": p1 - p0, "tasa_anual": round(tasa(p0, p1), 4),
                             "fuente": "INEGI"}
        fila["ha_por_1000_hab_nuevos"] = round(fila["municipio"]["total_ha"] / ((p1 - p0) / 1000), 2)
        observado.append(fila)

    # Automata: cada celda fina va al primer horizonte que la toca; clase por GHSL 2020 de su celda de 100 m.
    horizonte = np.zeros(forma_fina, np.int16)
    for h in HORIZONTES:
        g = auto[auto["year"] == h]
        m = rasterize(g.geometry, out_shape=forma_fina, transform=fino, dtype="uint8").astype(bool)
        horizonte[m & (horizonte == 0)] = h
    clase_fina = np.repeat(np.repeat(capas[2020][0] / 1e4 < CONSOLIDADO, SUB, axis=0), SUB, axis=1)
    proy = json.loads(PROYECCION.read_text(encoding="utf-8"))
    pob = {int(k): v for k, v in proy["poblacion"].items()}
    previsto = []
    for h in HORIZONTES:
        en_h = horizonte == h
        g = auto[auto["year"] == h]
        fila = {"horizonte": h}
        for k, m in ambitos.items():
            sel = en_h & m
            fila[k] = {"expansion_ha": round(float((sel & clase_fina).sum()) * ha_fino, 1),
                       "consolidacion_ha": round(float((sel & ~clase_fina).sum()) * ha_fino, 1)}
            fila[k]["total_ha"] = round(fila[k]["expansion_ha"] + fila[k]["consolidacion_ha"], 1)
        fila["automata"] = {"poligonos": int(len(g)), "pob": int(round(float(g["pob"].sum()))), "viv": int(round(float(g["viv"].sum())))}
        tot = fila["municipio"]["total_ha"]
        fila["automata"]["hab_por_ha"] = round(fila["automata"]["pob"] / tot, 1) if tot else None
        # Supuesto declarado: el horizonte h cubre (h-5, h], con ano base 2025. El de 2025 no tiene par de una sola fuente.
        if h - 5 in pob and h in pob:
            p0, p1 = pob[h - 5], pob[h]
            fila["poblacion"] = {"inicio": p0, "fin": p1, "aumento": p1 - p0, "tasa_anual": round(tasa(p0, p1), 4),
                                 "fuente": proy["fuente"]}
            fila["ha_por_1000_hab_nuevos"] = round(tot / ((p1 - p0) / 1000), 2)
            fila["pob_automata_entre_aumento"] = round(fila["automata"]["pob"] / (p1 - p0), 2)
        else:
            fila["poblacion"] = None
            fila["ha_por_1000_hab_nuevos"] = None
        previsto.append(fila)

    dentro = sum(f["dentro_limite_urbano"]["total_ha"] for f in observado)
    union = sum(f["municipio"]["total_ha"] for f in previsto)
    fuera = sum(f["fuera_limite_urbano"]["total_ha"] for f in previsto)
    contrastes = {
        "1_observado_dentro_limite_ha": {"medido": round(dentro, 1), "esperado": 2303.8,
                                         "dif_pct": round(100 * (dentro / 2303.8 - 1), 2)},
        "2_automata_union_municipio_ha": {"medido": round(union, 1), "esperado": 4914.9,
                                          "dif_pct": round(100 * (union / 4914.9 - 1), 2)},
        "2b_automata_fuera_limite_pct": {"medido": round(100 * fuera / union, 1), "esperado": 89},
        "3_tasa_2010_2020": {"medido": round(100 * tasa(CENSOS[2010], CENSOS[2020], 10), 2), "esperado": 1.8},
        "4_pob_automata_entre_aumento": {f["horizonte"]: f.get("pob_automata_entre_aumento") for f in previsto},
    }
    salida = {
        "producto": "zonas-crecimiento",
        "generado": datetime.now(timezone.utc).isoformat(),
        "metodo": "Sección 5 de la orden del 12/11/2026",
        "unidades": {"observado": "superficie construida añadida (techos), ha", "previsto": "suelo que el autómata prevé urbanizar, ha"},
        "regla_consolidacion": f"celda de 100 m con {int(CONSOLIDADO * 100)} % o más construido al inicio del periodo (GHSL 2020 para el autómata)",
        "observado": observado,
        "previsto": previsto,
        "contrastes": contrastes,
    }
    SALIDA.mkdir(parents=True, exist_ok=True)
    (SALIDA / "resumen-quinquenios.json").write_text(json.dumps(salida, ensure_ascii=False, indent=1), encoding="utf-8")
    if "--publicar" in sys.argv:
        shutil.copyfile(SALIDA / "resumen-quinquenios.json", PUBLICO)
        # La capa avisa a la plataforma que trae tablero (`crecimiento_capa.py` lo conserva si el archivo existe).
        capa = PUBLICO.parent / "capa.json"
        datos = json.loads(capa.read_text(encoding="utf-8"))
        datos["resumen"] = PUBLICO.name
        capa.write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(contrastes, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
