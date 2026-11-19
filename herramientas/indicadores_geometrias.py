"""
Geometrias fijas para los indicadores de crecimiento (dictamen del juez del 19/11/2026 sobre el metodo, condiciones 8 y 9;
metodo corregido en `ORDENES-DEL-MASTER/2026-11-19-indicadores-de-crecimiento-METODO.md`, seccion «Metodo corregido»).

Deja en `salidas/indicadores/` (no versionado; lleva geometria del automata, que es interna):
  - `huella_base_ghsl2020.gpkg`: huella base fija, celdas GHSL R2023A de 100 m con techo de 20 % o mas (2,000 m2) en la
    epoca 2020, dentro del municipio, disueltas. Mismo corte que separa expansion de densificacion en la capa.
  - `automata_excluyente.gpkg`: los seis horizontes de `COMBINADO.shp` (sin 2030a) sin traslape: cada punto queda en el
    horizonte mas temprano que lo cubre.
Ambas en EPSG:32614. Se las usa Analisis de Cuentas para clasificar tomas (solo conteos de regreso).

Uso: python herramientas/indicadores_geometrias.py
"""

import json
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
from rasterio.features import shapes
from shapely.geometry import shape
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parent))
import crecimiento_resumen as cr  # noqa: E402  (lector de GHSL y rutas compartidas)

RAIZ = Path(__file__).resolve().parents[1]
SALIDA = RAIZ / "salidas" / "indicadores"
UTM = 32614
CORTE_HUELLA = 0.2


def main() -> None:
    SALIDA.mkdir(parents=True, exist_ok=True)
    mun = gpd.read_file(cr.APPS / "0. CAPAS VARIAS" / "LIMITES_VIGENTES" / "LIMITE MUNICIPAL" / "LIMITE_MUNICIPAL.shp")
    mun = mun if mun.crs else mun.set_crs(UTM)
    mun_moll = mun.to_crs(cr.MOLL).union_all()

    g20, t = cr.leer(2020, mun_moll.bounds)
    marca = (g20 / 1e4 >= CORTE_HUELLA).astype("uint8")
    piezas = [shape(geom) for geom, v in shapes(marca, mask=marca == 1, transform=t) if v == 1]
    huella = gpd.GeoDataFrame(geometry=[unary_union(piezas).intersection(mun_moll)], crs=cr.MOLL).to_crs(UTM)
    huella["ha"] = huella.area / 1e4
    huella.to_file(SALIDA / "huella_base_ghsl2020.gpkg", driver="GPKG")

    auto = gpd.read_file(cr.APPS / "0. CAPAS VARIAS" / "AUTOMATAS_CELULARES" / "COMBINADO.shp")
    auto = auto[auto["layer"].str.match(r"^crecimiento_\d{4}$") & ~auto.geometry.is_empty].to_crs(UTM)
    filas, previo = [], None
    for capa in sorted(auto["layer"].unique()):
        geom = unary_union(auto.loc[auto["layer"] == capa].geometry.buffer(0))
        propia = geom if previo is None else geom.difference(previo)
        previo = geom if previo is None else previo.union(geom)
        filas.append({"horizonte": int(capa[-4:]), "ha_vector": float(geom.area / 1e4), "ha": float(propia.area / 1e4), "geometry": propia})
    excl = gpd.GeoDataFrame(filas, crs=UTM)
    excl.to_file(SALIDA / "automata_excluyente.gpkg", driver="GPKG")

    resumen = {
        "huella_ha": round(float(huella["ha"].iloc[0]), 1),
        "automata": [{"horizonte": f["horizonte"], "ha_vector": round(f["ha_vector"], 1), "ha_excluyente": round(f["ha"], 1)} for f in filas],
        "automata_union_ha": round(float(excl.area.sum() / 1e4), 1),
        "automata_dentro_huella_ha": round(float(excl.intersection(huella.geometry.iloc[0]).area.sum() / 1e4), 1),
    }
    (SALIDA / "geometrias.json").write_text(json.dumps(resumen, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(resumen, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
