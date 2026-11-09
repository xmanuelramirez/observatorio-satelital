"""
Capa «Distancia a espacio verde» para la plataforma: una imagen y su leyenda en
`public/apertura/espacio-verde/` (no versionado; viaja con el despliegue, detras de Access).

Escenario del modelo (random forest con p >= 0.5 y las etiquetas en que coinciden los dos revisores),
con el A-1 base solo como rango, como pide el dictamen del juez del 09/11/2026. La imagen va en una
rejilla regular en grados, como el resto de lo precalculado, para que el mapa la ponga sin reproyectar.

Uso: python herramientas/espacio_verde_capa.py (despues de espacio_verde_prioridad.py)
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd
import numpy as np
from PIL import Image
from rasterio.features import rasterize
from rasterio.transform import from_bounds

RAIZ = Path(__file__).resolve().parents[1]
SALIDA = RAIZ / "salidas" / "espacio-verde"
GPKG = SALIDA / "espacio-verde.gpkg"
DESTINO = RAIZ / "public" / "apertura" / "espacio-verde"
ANCHO = 2000

# Distancia en pasos de calido a oscuro sobre el fondo de la plataforma; el verde es solo para parques.
CLASES = [
    (0, 400, (214, 230, 196, 150), "Hasta 400 m caminando"),
    (400, 600, (240, 214, 160, 170), "400 a 600 m"),
    (600, 800, (226, 160, 90, 185), "600 a 800 m"),
    (800, 1e12, (176, 88, 52, 200), "Más de 800 m"),
]
PARQUE = (106, 153, 78, 255)
AGUA = (42, 157, 143, 255)
BORDE = (255, 255, 255, 255)


def hex_de(c) -> str:
    return "#%02x%02x%02x" % c[:3]


def main() -> None:
    urbano = gpd.read_file(RAIZ / "public" / "capas" / "LIMITE_URBANO.geojson").to_crs(4326)
    xmin, ymin, xmax, ymax = urbano.total_bounds
    alto = int(ANCHO * (ymax - ymin) / (xmax - xmin) / np.cos(np.radians((ymin + ymax) / 2)))
    t = from_bounds(xmin, ymin, xmax, ymax, ANCHO, alto)

    celdas = gpd.read_file(GPKG, layer="celdas_modelo").to_crs(4326)
    espacios = gpd.read_file(GPKG, layer="espacios_modelo")
    parques = espacios[espacios["en_modelo"].astype(bool)].to_crs(4326)
    azul = gpd.read_file(GPKG, layer="azul_publico").to_crs(4326)
    azul = azul[azul.intersects(urbano.union_all())]
    zonas = gpd.read_file(GPKG, layer="zonas_prioritarias_robustas").to_crs(4326)
    robustas = zonas[zonas["robusta"].astype(bool)]

    rgba = np.zeros((alto, ANCHO, 4), np.uint8)
    for k, (lo, hi, color, _) in enumerate(CLASES):
        sel = celdas[(celdas["d_modelo"] > lo) & (celdas["d_modelo"] <= hi)] if lo else celdas[celdas["d_modelo"] <= hi]
        if len(sel):
            m = rasterize(sel.geometry, out_shape=(alto, ANCHO), transform=t, all_touched=True).astype(bool)
            rgba[m] = color
    for capa, color in ((azul, AGUA), (parques, PARQUE)):
        if len(capa):
            m = rasterize(capa.geometry, out_shape=(alto, ANCHO), transform=t, all_touched=True).astype(bool)
            rgba[m] = color
    if len(robustas):
        bordes = robustas.boundary.buffer(0.00012)
        m = rasterize(bordes, out_shape=(alto, ANCHO), transform=t, all_touched=True).astype(bool)
        rgba[m] = BORDE
    DESTINO.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(DESTINO / "capa.png", optimize=True)

    # Poblacion por clase, escenario del modelo, y el rango publicado.
    z = np.load(SALIDA / "distancias-por-espacio.npz", allow_pickle=True)
    base_ids = list(z["ids"])
    en_modelo = espacios.set_index("id").loc[base_ids, "en_modelo"].astype(bool).to_numpy()
    mz = gpd.read_file(GPKG, layer="distancia_manzanas")
    mz = mz[mz["urbano"].astype(bool) & mz["pob"].notna()].reset_index(drop=True)
    pob = mz["pob"].to_numpy(float)
    dmin = z["mz"][en_modelo].min(0)
    variantes = json.loads((SALIDA / "correccion-a1.json").read_text(encoding="utf-8"))["variantes"]
    sin = variantes["sin_deportivos_sin_vegetacion"]["rango"]
    con = variantes["con_deportivos_sin_vegetacion"]["rango"]
    prior = json.loads((SALIDA / "zonas-prioritarias.json").read_text(encoding="utf-8"))

    leyenda = [{"color": hex_de(PARQUE), "etiqueta": "Espacio verde público de 0.5 ha o más"},
               {"color": hex_de(AGUA), "etiqueta": "Cuerpo de agua (acceso a su orilla sin verificar)"}]
    for lo, hi, color, nombre in CLASES:
        sel = (dmin > lo) & (dmin <= hi) if lo else dmin <= hi
        pct = 100 * pob[sel].sum() / pob.sum()
        detalle = f"rango {min(sin[0], con[0]):.0f} a {max(sin[1], con[1]):.0f} %" if not lo else f"modelo: {pct:.0f} %"
        leyenda.append({"color": hex_de(color), "etiqueta": nombre, "detalle": detalle})
    leyenda.append({"color": "#ffffff", "etiqueta": f"Zona prioritaria ({prior['robustas']} AGEB)"})

    notas = [
        "Distancia caminando por calles hasta el borde del espacio verde público de 0.5 ha o más más cercano, desde cada celda de 100 m del límite urbano.",
        f"Población a 400 m o menos (criterio A-1 de la NOM-001-SEDATU-2021): solo se da como rango. Sin contar deportivos sin vegetación, {sin[0]:.1f} a {sin[1]:.1f} %; contándolos, {con[0]:.1f} a {con[1]:.1f} %. Si cuentan o no lo fija NBS.",
        "El inventario junta OpenStreetMap y las áreas verdes del PMDUOET 2020. No cuentan plazas sin vegetación, áreas dentro de cotos, camellones, baldíos ni monte. Una muestra de 101 polígonos se revisó en imagen de alta resolución por dos revisores independientes (kappa 0.91 en sí o no); el resto lo clasificó un modelo entrenado con esas etiquetas (exactitud balanceada 0.86).",
        "El mapa muestra el escenario del modelo. Las zonas prioritarias son las AGEB con más habitantes lejos de las tres distancias de la NOM (400 m a 0.5 ha, 600 m a 4 ha y 800 m a 7.5 ha) en los tres escenarios: cota baja, modelo y cota alta. Las que dependen del escenario no se marcan.",
        "Dos lagunas con arbolado al norte siguen a confirmar y no se suman. Los parques que no están en ninguna de las dos fuentes no se cuentan: la cifra real puede ser algo mayor.",
        "Fuentes: © colaboradores de OpenStreetMap (ODbL), Plataforma de Información Estadística y Geográfica de León (PMDUOET 2020), INEGI Censo 2020 por manzana, Sentinel-2 L2A (Copernicus).",
    ]
    datos = {
        "producto": "espacio-verde",
        "limites": [[float(ymin), float(xmin)], [float(ymax), float(xmax)]],
        "leyenda": leyenda,
        "notas": notas,
        "generado": datetime.now(timezone.utc).isoformat(),
    }
    (DESTINO / "capa.json").write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(leyenda, ensure_ascii=False, indent=1))
    print("capa", (DESTINO / "capa.png").stat().st_size, "bytes")


if __name__ == "__main__":
    main()
