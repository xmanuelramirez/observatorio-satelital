"""
Tomas por vivienda habitada (frente 2a, «1.11») por colonia: pedido de Carlos vía MASTER (23/11/2026), para que el deck 1
use un solo poligono. Mismo metodo que `pi_2a_censo_sector.py`: tomas domesticas y mixtas reconstruidas al 15/03/2020
(Analisis de Cuentas) entre viviendas particulares habitadas del Censo 2020 por manzana; la manzana va a la colonia por su
centroide; manzana suprimida con el resto de su AGEB por superficie. Mismos cortes que por sector (1.108 ± 0.2: 0.91 y 1.31).
Colonias con menos de N_MIN viviendas habitadas: «Menos de N_MIN viviendas», sin razon. Solo agregados.

Uso: python herramientas/pi_2a_por_colonia.py <csv de Cuentas con colonia_gid y parque_15mar2020>
"""

import hashlib
import json
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pi_2a_censo_sector as s2a  # noqa: E402  (lectura del Censo por manzana)

RAIZ = Path(__file__).resolve().parents[1]
APPS = RAIZ.parent
SAL = RAIZ / "salidas" / "planeacion-integral"
COLONIAS = APPS / "11. ANALISIS DE CUENTAS" / "public" / "data" / "capas" / "COLONIAS.geojson"
UTM = 32614
N_MIN = 30           # 30 viviendas habitadas (dictamen del juez del 23/11, condicion 2)
BANDA = (0.908, 1.308)  # razon municipal dentro de sectores, 1.108 ± 0.2 (dictaminada)
FUERA = "fuera_de_colonias"


def main() -> None:
    col = gpd.read_file(COLONIAS).to_crs(UTM)[["gid", "nombre", "geometry"]]
    col["geometry"] = col.geometry.make_valid()
    col = col.rename(columns={"gid": "colonia_gid"})
    vph, cob = s2a.censo_2020_manzana(col.rename(columns={"colonia_gid": "sector"})[["sector", "geometry"]])
    vph.index = vph.index.map(lambda x: x if x == s2a.FUERA else str(int(float(x))))
    vph = vph.rename(index={s2a.FUERA: FUERA})
    t = pd.read_csv(sys.argv[1])
    t["colonia_gid"] = t.colonia_gid.map(lambda x: x if str(x) == FUERA else str(int(float(x))))
    tomas = t.set_index("colonia_gid")["parque_15mar2020"]
    d = pd.DataFrame({"vph_2020": vph.vph_2020, "vpart_2020": vph.vpart_2020, "tomas_15mar2020": tomas}).fillna(0)
    d["razon_tomas_vph"] = np.where(d.vph_2020 >= N_MIN, d.tomas_15mar2020 / d.vph_2020.replace(0, np.nan), np.nan)
    # Clases del dictamen del 23/11 (condicion 4): cero tomas va aparte de «menos tomas».
    d["categoria"] = np.select(
        [d.vph_2020 < N_MIN, d.tomas_15mar2020 == 0, d.razon_tomas_vph > BANDA[1], d.razon_tomas_vph < BANDA[0]],
        [f"Menos de {N_MIN} viviendas habitadas (Censo 2020)", "Sin tomas domésticas en el padrón",
         "Más de 1.31: más tomas que viviendas habitadas", "Menos de 0.91: menos tomas que viviendas"],
        default="0.91 a 1.31: dentro del rango")
    d.loc[FUERA, "categoria"] = "fuera de colonias"
    nombres = col.assign(colonia_gid=col.colonia_gid.astype(int).astype(str)).set_index("colonia_gid").nombre
    d.insert(0, "nombre", d.index.map(lambda g: nombres.get(g, "")))
    d.index.name = "colonia_gid"
    ruta = SAL / "2a-tomas-por-vivienda-por-colonia.csv"
    d.round(4).to_csv(ruta, encoding="utf-8")
    dentro = d.drop(index=FUERA, errors="ignore")
    vph_cat = dentro.groupby("categoria").vph_2020.sum()
    de100 = (100 * vph_cat / vph_cat.sum()).round(1).to_dict()
    res = {"colonias": int(len(dentro)), "categorias": dentro.categoria.value_counts().to_dict(),
           "viviendas_habitadas_de_cada_100": de100,
           "cifra_global": {"valor": 1.10, "texto": "1.10 tomas domésticas y mixtas por vivienda habitada, en las colonias de León",
                            "nota": "tomas activas reconstruidas al 15/03/2020 contra viviendas habitadas del Censo 2020 por manzana; sin bajas anteriores al padrón; en los sectores hidráulicos da 1.11 y en toda el área urbana 1.08"},
           "rotulo_arriba_abajo": "candidatas; la causa la estudia 2b",
           "entrega_cuentas": {"archivo": Path(sys.argv[1]).name, "sha256": hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest()},
           "razon_global_colonias": round(float(dentro.tomas_15mar2020.sum() / dentro.vph_2020.sum()), 3),
           "suma_tomas": int(d.tomas_15mar2020.sum()), "suma_vph": int(round(d.vph_2020.sum())), "censo": cob,
           "cortes": {"arriba": BANDA[1], "abajo": BANDA[0], "n_min_viviendas": N_MIN}}
    (SAL / "2a-por-colonia-resumen.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
