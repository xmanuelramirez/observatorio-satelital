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
import sys
import zipfile
from datetime import date, datetime, timezone
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
# INEGI: Censo 2000, Conteo 2005, Censo 2010, Encuesta Intercensal 2015 y Censo 2020. Verificado el 12/11/2026 en
# citypopulation.de (INEGI) y en el Diagnostico Municipal 2020 de IMPLAN Leon. Las tasas usan las fechas censales reales
# (condicion 7 del juez, 12/11/2026), las mismas del juez.
CENSOS = {2000: 1_134_842, 2005: 1_278_087, 2010: 1_436_480, 2015: 1_578_626, 2020: 1_721_215}
FECHAS_CENSO = {2000: date(2000, 2, 14), 2005: date(2005, 10, 17), 2010: date(2010, 6, 12), 2015: date(2015, 3, 15),
                2020: date(2020, 3, 15)}
# Solo para el contraste interno 4 (no se publica): serie anterior de SAPAL, en revision (condicion 1 del juez).
PROYECCION = APPS / "11. ANALISIS DE CUENTAS" / "public" / "data" / "proyeccion-municipal.json"
UMBRALES_SENSIBILIDAD = [0.1, 0.2, 0.3]
# Supuesto del automata (dictamen del juez): 85 % de superficie util, una vivienda por 194 m2 utiles, 4.2 hab/vivienda
# (4.0 en 2025). viv de 2030 viene rota (las 416 partes de 2030a traen el area_eff del conjunto): se anula.
HAB_POR_VIVIENDA = {2025: 4.0}


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


def anios_entre(a: int, z: int) -> float:
    return (FECHAS_CENSO[z] - FECHAS_CENSO[a]).days / 365.25


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
        # Condicion 5: de cada 100 ha de techo nuevo, cuantas son expansion segun el umbral (municipio).
        fm = frac["municipio"]
        total = float((delta * fm).sum())
        fila["expansion_de_cada_100_por_umbral"] = {
            str(int(u * 100)): round(100 * float((delta * fm * (b0 / 1e4 < u)).sum()) / total) for u in UMBRALES_SENSIBILIDAD}
        p0, p1 = CENSOS[a], CENSOS[z]
        fila["poblacion"] = {"inicio": p0, "fin": p1, "aumento": p1 - p0, "anios": round(anios_entre(a, z), 2),
                             "tasa_anual": round(tasa(p0, p1, anios_entre(a, z)), 4), "fuente": "INEGI"}
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
    interno_4 = {}
    for h in HORIZONTES:
        en_h = horizonte == h
        g = auto[auto["year"] == h]
        fila = {"horizonte": h}
        for k, m in ambitos.items():
            sel = en_h & m
            fila[k] = {"expansion_ha": round(float((sel & clase_fina).sum()) * ha_fino, 1),
                       "consolidacion_ha": round(float((sel & ~clase_fina).sum()) * ha_fino, 1)}
            fila[k]["total_ha"] = round(fila[k]["expansion_ha"] + fila[k]["consolidacion_ha"], 1)
        fila["automata"] = {"poligonos": int(len(g)), "pob": int(round(float(g["pob"].sum()))),
                            "viv": None if h == 2030 else int(round(float(g["viv"].sum())))}
        if h == 2030:
            fila["automata"]["viv_nota"] = "anulada: las 416 partes de crecimiento_2030a traen el area_eff del conjunto"
        tot = fila["municipio"]["total_ha"]
        # Condicion 4: la densidad es un insumo del modelo, no un resultado.
        fila["automata"]["hab_por_ha_supuesto"] = round(fila["automata"]["pob"] / tot) if tot else None
        fila["automata"]["hab_por_vivienda_supuesto"] = HAB_POR_VIVIENDA.get(h, 4.2)
        # Contraste 4, solo interno: con la serie anterior de SAPAL (en revision).
        if h - 5 in pob and h in pob:
            interno_4[h] = round(fila["automata"]["pob"] / (pob[h] - pob[h - 5]), 2)
        previsto.append(fila)
    # Condicion 6: el automata se cita con la union del vector (EPSG:32614); el raster solo reparte.
    union_vector = round(float(auto.to_crs(32614).union_all().area) / 1e4, 1)

    dentro = sum(f["dentro_limite_urbano"]["total_ha"] for f in observado)
    union = sum(f["municipio"]["total_ha"] for f in previsto)
    fuera = sum(f["fuera_limite_urbano"]["total_ha"] for f in previsto)
    contrastes = {
        "1_observado_dentro_limite_ha": {"medido": round(dentro, 1), "esperado": 2303.8,
                                         "dif_pct": round(100 * (dentro / 2303.8 - 1), 2)},
        "2_automata_union_municipio_ha": {"medido": round(union, 1), "esperado": 4914.9,
                                          "dif_pct": round(100 * (union / 4914.9 - 1), 2)},
        "2b_automata_fuera_limite_pct": {"medido": round(100 * fuera / union, 1), "esperado": 89},
        "2c_automata_union_vector_ha": union_vector,
        "3_tasa_2010_2020_nominal": {"medido": round(100 * tasa(CENSOS[2010], CENSOS[2020], 10), 2), "esperado": 1.8},
        "4_pob_automata_entre_aumento_serie_anterior": interno_4,
    }
    salida = {
        "producto": "zonas-crecimiento",
        "generado": datetime.now(timezone.utc).isoformat(),
        "metodo": "Sección 5 de la orden del 12/11/2026",
        "unidades": {"observado": "superficie construida añadida (techos), ha", "previsto": "suelo que el autómata prevé urbanizar, ha"},
        "regla_consolidacion": f"celda de 100 m con {int(CONSOLIDADO * 100)} % o más construido al inicio del periodo (GHSL 2020 para el autómata)",
        "observado_rotulo": "Estimación GHSL a 100 m, interpolada entre 2000, 2014 y 2018 (2020 extrapolado)",
        "automata_ha_union": union_vector,
        "fechas_censo": {str(k): v.isoformat() for k, v in FECHAS_CENSO.items()},
        "dictamen": "ORDENES-DEL-MASTER/juez-2026-11-12-quinquenios/DICTAMEN.md",
        "observado": observado,
        "previsto": previsto,
    }
    SALIDA.mkdir(parents=True, exist_ok=True)
    # Lo publicado no lleva contrastes internos ni la serie anterior de poblacion (condicion 1).
    interno = {**salida, "contrastes": contrastes}
    (SALIDA / "resumen-quinquenios.json").write_text(json.dumps(interno, ensure_ascii=False, indent=1), encoding="utf-8")
    if "--publicar" in sys.argv:
        PUBLICO.write_text(json.dumps(salida, ensure_ascii=False, indent=1), encoding="utf-8")
        # La capa avisa a la plataforma que trae tablero (`crecimiento_capa.py` lo conserva si el archivo existe).
        capa = PUBLICO.parent / "capa.json"
        datos = json.loads(capa.read_text(encoding="utf-8"))
        datos["resumen"] = PUBLICO.name
        capa.write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(contrastes, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
