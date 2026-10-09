"""
Tablas, contrastes y mapas del paquete de vegetacion de la zona urbana.

Lee los rasters que deja `paquete_vegetacion.py` y no descarga nada. Los mapas usan el
estilo del departamento (skill mapas-planeacion-hidrica: `comun.py`), cuya ruta se toma de
la variable MAPAS_PH o del lugar donde el skill vive en esta laptop.

Uso:
    python herramientas/paquete_vegetacion_figuras.py [carpeta_del_paquete]
"""

from __future__ import annotations

import csv
import json
import os
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PAQUETE = Path(sys.argv[1]) if len(sys.argv) > 1 else RAIZ / "salidas" / "paquete-vegetacion-zona-urbana-2026-10"
RASTERS = PAQUETE / "rasters"
MAPAS = PAQUETE / "mapas"
TABLAS = PAQUETE / "tablas"

SKILL = Path(os.environ.get("MAPAS_PH", r"C:\Users\xmanu\AppData\Roaming\Claude\local-agent-mode-sessions\skills-plugin\221690b3-86e3-4639-8af0-46233604d444\bf12e336-2e7e-421d-b65a-a349f615fde7\skills\mapas-planeacion-hidrica\scripts"))
sys.path.insert(0, str(SKILL))
import comun  # noqa: E402  (antes que rasterio: corrige PROJ_LIB)
from comun import C  # noqa: E402

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import rasterio  # noqa: E402
from matplotlib.colors import to_rgb  # noqa: E402
from rasterio.windows import from_bounds  # noqa: E402
from shapely.geometry import shape  # noqa: E402
from shapely.ops import unary_union  # noqa: E402
from shapely import transform as transformar  # noqa: E402
from pyproj import Transformer  # noqa: E402

HA = 0.01  # una celda de 10 m es 0.01 ha
ANIOS = list(range(2019, 2026))
ANIOS_USO = list(range(2017, 2024))
CORTES_NDVI = [0.2, 0.4, 0.6]
NOMBRES_NDVI = ["Sin vegetación o muy escasa", "Escasa", "Moderada", "Densa"]
UMBRAL_CAMBIO = 0.10
CLASES_USO = {1: "Agua", 2: "Arbolado", 4: "Vegetación inundada", 5: "Cultivos", 7: "Construido",
              8: "Suelo desnudo", 9: "Nieve o hielo", 10: "Nubes", 11: "Pastizal y matorral"}
HILLSHADE = RAIZ.parent / "0. CAPAS VARIAS" / "HILLSHADE_LEON.tif"


def leer(nombre):
    with rasterio.open(RASTERS / nombre) as src:
        return src.read(1), src.transform, src.bounds


def capa_utm(nombre):
    capa = json.loads((RAIZ / "public" / "capas" / nombre).read_text(encoding="utf-8"))
    geo = unary_union([shape(f["geometry"]) for f in capa["features"]])
    a = Transformer.from_crs(4326, 32614, always_xy=True)
    return transformar(geo, lambda xy: np.column_stack(a.transform(xy[:, 0], xy[:, 1])))


def clases_ndvi(ndvi):
    c = np.digitize(ndvi, CORTES_NDVI).astype(np.uint8) + 1  # 1..4
    c[np.isnan(ndvi)] = 0
    return c


def escribir_csv(nombre, filas):
    TABLAS.mkdir(parents=True, exist_ok=True)
    with open(TABLAS / nombre, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(filas[0].keys()))
        w.writeheader()
        w.writerows(filas)


def guardar_tif(nombre, datos, plantilla, nodata):
    with rasterio.open(RASTERS / plantilla) as src:
        perfil = src.profile
    perfil.update(dtype=datos.dtype, nodata=nodata, compress="deflate")
    with rasterio.open(RASTERS / nombre, "w", **perfil) as dst:
        dst.write(datos, 1)


# ---------------------------------------------------------------- tablas

def tablas():
    dentro = None
    filas_ndvi, filas_ndbi, medias = [], [], {}
    for anio in ANIOS:
        ndvi, _, _ = leer(f"ndvi_estiaje_{anio}.tif")
        ndbi, _, _ = leer(f"ndbi_estiaje_{anio}.tif")
        uso = leer("uso_suelo_2017.tif")[0]
        dentro = uso > 0
        meta = json.loads((RASTERS / f"escenas_{anio}.json").read_text(encoding="utf-8"))
        cl = clases_ndvi(ndvi)
        guardar_tif(f"ndvi_clases_{anio}.tif", cl, f"ndvi_estiaje_{anio}.tif", 0)
        con_dato = dentro & ~np.isnan(ndvi)
        fila = {"anio": anio, "coleccion": meta["coleccion"], "escenas": len(meta["escenas"]),
                "observaciones_mediana": meta["observaciones_mediana_en_zona"],
                "ha_con_dato": round(con_dato.sum() * HA), "ha_sin_dato": round((dentro & np.isnan(ndvi)).sum() * HA),
                "ndvi_medio": round(float(np.nanmean(ndvi[dentro])), 3)}
        for k, nombre in enumerate(NOMBRES_NDVI, start=1):
            ha = (cl == k).sum() * HA
            fila[f"ha_{nombre}"] = round(ha)
            fila[f"pct_{nombre}"] = round(100 * ha / (con_dato.sum() * HA), 1)
        filas_ndvi.append(fila)
        medias[anio] = fila["ndvi_medio"]
        positivo = dentro & (ndbi >= 0)
        filas_ndbi.append({"anio": anio, "ndbi_medio": round(float(np.nanmean(ndbi[dentro])), 3),
                           "ha_ndbi_positivo": round(positivo.sum() * HA),
                           "pct_ndbi_positivo": round(100 * positivo.sum() / (dentro & ~np.isnan(ndbi)).sum(), 1)})
    escribir_csv("ndvi_clases_por_anio.csv", filas_ndvi)
    escribir_csv("ndbi_por_anio.csv", filas_ndbi)

    a, _, _ = leer("ndvi_estiaje_2019.tif")
    b, _, _ = leer("ndvi_estiaje_2025.tif")
    d = b - a
    cambio = np.zeros(d.shape, np.uint8)
    cambio[d <= -UMBRAL_CAMBIO] = 1
    cambio[(d > -UMBRAL_CAMBIO) & (d < UMBRAL_CAMBIO)] = 2
    cambio[d >= UMBRAL_CAMBIO] = 3
    cambio[~dentro] = 0
    guardar_tif("ndvi_cambio_2019_2025.tif", cambio, "ndvi_estiaje_2019.tif", 0)
    guardar_tif("ndvi_diferencia_2019_2025.tif", np.where(dentro, d, np.nan).astype(np.float32), "ndvi_estiaje_2019.tif", np.nan)
    total = (cambio > 0).sum()
    escribir_csv("ndvi_cambio_2019_2025.csv", [
        {"cambio": n, "ha": round((cambio == k).sum() * HA), "pct": round(100 * (cambio == k).sum() / total, 1)}
        for k, n in [(1, "Baja el NDVI 0.10 o más"), (2, "Sin cambio relevante"), (3, "Sube el NDVI 0.10 o más")]])

    filas_uso = []
    for anio in ANIOS_USO:
        u, _, _ = leer(f"uso_suelo_{anio}.tif")
        fila = {"anio": anio}
        for k, n in CLASES_USO.items():
            fila[f"ha_{n}"] = round((u == k).sum() * HA)
        filas_uso.append(fila)
    escribir_csv("uso_suelo_por_anio.csv", filas_uso)
    u0, _, _ = leer("uso_suelo_2017.tif")
    u1, _, _ = leer("uso_suelo_2023.tif")
    trans = []
    for k0, n0 in CLASES_USO.items():
        fila = {"en_2017": n0}
        for k1, n1 in CLASES_USO.items():
            fila[f"a_{n1}_2023"] = round(((u0 == k0) & (u1 == k1)).sum() * HA)
        if any(v for kk, v in fila.items() if kk != "en_2017"):
            trans.append(fila)
    escribir_csv("uso_suelo_transiciones_2017_2023.csv", trans)
    return filas_ndvi, filas_ndbi, filas_uso, medias


# ---------------------------------------------------------------- contrastes

def contrastes(filas_ndvi, filas_ndbi, filas_uso):
    res = []
    medias = [f["ndvi_medio"] for f in filas_ndvi]
    res.append(("1", "NDVI medio de estiaje entre 0.10 y 0.35",
                f"de {min(medias):.3f} a {max(medias):.3f}", all(0.10 <= m <= 0.35 for m in medias)))
    densa = [f["pct_Densa"] for f in filas_ndvi]
    res.append(("2", "Clase densa por debajo del 10 %", f"máximo {max(densa):.1f} %", max(densa) < 10))
    wc = json.loads((RAIZ / "public" / "precalculado" / "LIMITE_URBANO" / "cobertura.json").read_text(encoding="utf-8"))
    pct_wc = float(next(e["detalle"] for e in wc["leyenda"] if e["etiqueta"] == "Construido").split("(")[1].split(" ")[0])
    f21 = next(f for f in filas_uso if f["anio"] == 2021)
    tot21 = sum(v for k, v in f21.items() if k.startswith("ha_"))
    pct_esri = 100 * f21["ha_Construido"] / tot21
    res.append(("3", "Construido 2021: Esri contra ESA WorldCover, 10 puntos o menos",
                f"Esri {pct_esri:.1f} %, WorldCover {pct_wc:.1f} %, diferencia {pct_esri - pct_wc:.1f} puntos",
                abs(pct_esri - pct_wc) <= 10))
    cons = [f["ha_Construido"] for f in filas_uso]
    bajas = [100 * (cons[i] - cons[i + 1]) / cons[i] for i in range(len(cons) - 1) if cons[i + 1] < cons[i]]
    res.append(("4", "Lo construido no baja más de 2 % de un año a otro",
                f"{cons[0]:,} ha en 2017 a {cons[-1]:,} ha en 2023; bajas: {', '.join(f'{b:.1f} %' for b in bajas) or 'ninguna'}",
                all(b <= 2 for b in bajas)))
    pares = [(f["anio"], f["ha_ndbi_positivo"], next(u["ha_Construido"] for u in filas_uso if u["anio"] == f["anio"]))
             for f in filas_ndbi if f["anio"] in ANIOS_USO]
    res.append(("5", "NDBI positivo mayor o igual que lo construido del uso de suelo",
                "; ".join(f"{a}: {n:,} contra {c:,} ha" for a, n, c in pares), all(n >= c for _, n, c in pares)))
    a, _, _ = leer("ndvi_estiaje_2023.tif")
    b, _, _ = leer("ndvi_estiaje_2023_coleccion_anterior.tif")
    ma, mb = float(np.nanmean(a)), float(np.nanmean(b))
    res.append(("6", "2023 con las dos versiones del catálogo: NDVI medio difiere 0.02 o menos",
                f"{ma:.3f} contra {mb:.3f}, diferencia {abs(ma - mb):.3f}", abs(ma - mb) <= 0.02))
    escribir_csv("contrastes.csv", [{"numero": n, "criterio": c, "resultado": r, "pasa": "sí" if p else "NO"}
                                     for n, c, r, p in res])
    for n, c, r, p in res:
        print(f"contraste {n}: {'pasa' if p else 'NO PASA'} | {c} | {r}")
    return res


# ---------------------------------------------------------------- mapas

def base(ax, urbano, municipio, bounds):
    x0, y0, x1, y1 = bounds
    if HILLSHADE.exists():
        with rasterio.open(HILLSHADE) as src:
            v = from_bounds(x0, y0, x1, y1, src.transform)
            som = src.read(1, window=v, boundless=True, fill_value=0).astype(np.float32)
            som = som / max(1.0, float(np.nanmax(som)))
        img = ax.imshow(som, extent=(x0, x1, y0, y1), cmap="gray", vmin=-0.55, vmax=1.55,
                        alpha=0.50, zorder=1, interpolation="bilinear")
        comun.recortar(ax, img, municipio)
    for g in getattr(urbano, "geoms", [urbano]):
        ax.plot(*g.exterior.xy, color=C["navy"], lw=0.7, zorder=6)


def rgb_de(clases, colores):
    """Cada clase a un RGB mezclado sobre blanco: la paleta es cerrada y los grados salen por opacidad."""
    out = np.ones(clases.shape + (4,), np.float32)
    out[..., 3] = 0
    for k, (color, alfa) in colores.items():
        r, g, b = to_rgb(C[color])
        m = clases == k
        out[m, 0] = 1 - alfa + alfa * r
        out[m, 1] = 1 - alfa + alfa * g
        out[m, 2] = 1 - alfa + alfa * b
        out[m, 3] = 1
    return out


def mapa(nombre, clases, colores, entradas, extent, urbano, municipio, titulo=None):
    comun.estilo()
    fig, ax = comun.figura(alto_cm=14.2)
    x0, x1, y0, y1 = extent
    mx, my = 0.09 * (x1 - x0), 0.09 * (y1 - y0)
    ax.set_xlim(x0 - mx, x1 + mx)
    ax.set_ylim(y0 - my, y1 + my)
    base(ax, urbano, municipio, (x0 - mx, y0 - my, x1 + mx, y1 + my))
    ax.imshow(rgb_de(clases, colores), extent=extent, zorder=4, interpolation="nearest")
    lado, xa = comun.esquina_mas_libre(ax, urbano)
    comun.leyenda_vertical(ax, entradas, x=xa, y=0.032, tam=7.5, anclaje=lado)
    comun.barra_escala(ax, 5000, "5 km", x=0.968 if lado == "izquierda" else 0.035, y=0.05,
                       anclaje="derecha" if lado == "izquierda" else "izquierda")
    comun.rosa_vientos(ax, x=0.93, y=0.88, radio=0.05)
    if titulo:
        ax.text(0.03, 0.965, titulo, transform=ax.transAxes, fontsize=10, color=C["navy"],
                weight="bold", va="top")
    comun.SALIDA = MAPAS
    comun.guardar(fig, nombre)
    plt.close(fig)


def mapas(filas_ndvi, filas_uso):
    urbano = capa_utm("LIMITE_URBANO.geojson")
    municipio = capa_utm("LIMITE.geojson")
    _, tr, bd = leer("ndvi_estiaje_2019.tif")
    extent = (bd.left, bd.right, bd.bottom, bd.top)
    col_ndvi = {1: ("filete", 0.9), 2: ("regenerada", 0.30), 3: ("regenerada", 0.62), 4: ("regenerada", 1.0)}
    for anio, fila in zip(ANIOS, filas_ndvi):
        cl, _, _ = leer(f"ndvi_clases_{anio}.tif")
        entradas = [("area", dict(color=C[c], alpha=a), f"{rotulo} ({fila['pct_' + n]:.0f} %)")
                    for (c, a), n, rotulo in zip(col_ndvi.values(), NOMBRES_NDVI,
                                                 ["NDVI menor de 0.2", "0.2 a 0.4", "0.4 a 0.6", "0.6 o más"])]
        mapa(f"ndvi-estiaje-{anio}.png", cl, col_ndvi, entradas, extent, urbano, municipio,
             titulo=f"Vegetación en estiaje, {anio} (NDVI, marzo a mayo)")
    cambio, _, _ = leer("ndvi_cambio_2019_2025.tif")
    filas = list(csv.DictReader(open(TABLAS / "ndvi_cambio_2019_2025.csv", encoding="utf-8-sig")))
    col = {1: ("navy", 0.85), 2: ("filete", 0.6), 3: ("regenerada", 1.0)}
    entradas = [("area", dict(color=C[c], alpha=a), f"{f['cambio']} ({float(f['pct']):.1f} %)")
                for (c, a), f in zip(col.values(), filas)]
    mapa("ndvi-cambio-2019-2025.png", cambio, col, entradas, extent, urbano, municipio,
         titulo="Cambio de la vegetación en estiaje, 2019 a 2025 (NDVI)")
    a, _, _ = leer("ndbi_estiaje_2019.tif")
    b, _, _ = leer("ndbi_estiaje_2025.tif")
    nd = np.zeros(a.shape, np.uint8)
    nd[(a >= 0) & (b >= 0)] = 1
    nd[(a < 0) & (b >= 0)] = 2
    nd[(a >= 0) & (b < 0)] = 3
    col = {1: ("gris", 0.45), 2: ("navy", 1.0), 3: ("regenerada", 0.8)}
    pct = {k: 100 * (nd == k).sum() / (~np.isnan(a) & ~np.isnan(b)).sum() for k in col}
    entradas = [("area", dict(color=C["gris"], alpha=0.45), f"NDBI positivo en 2019 y 2025 ({pct[1]:.0f} %)"),
                ("area", dict(color=C["navy"]), f"Pasa a positivo ({pct[2]:.1f} %)"),
                ("area", dict(color=C["regenerada"], alpha=0.8), f"Deja de ser positivo ({pct[3]:.1f} %)")]
    mapa("ndbi-2019-2025.png", nd, col, entradas, extent, urbano, municipio,
         titulo="Superficie con NDBI positivo (construido o suelo desnudo), 2019 y 2025")
    u0, _, _ = leer("uso_suelo_2017.tif")
    u1, _, _ = leer("uso_suelo_2023.tif")
    us = np.zeros(u0.shape, np.uint8)
    us[(u0 == 7)] = 1
    us[(u0 != 7) & (u0 > 0) & (u1 == 7)] = 2
    nuevo = (us == 2).sum() * HA
    col = {1: ("gris", 0.35), 2: ("navy", 1.0)}
    entradas = [("area", dict(color=C["gris"], alpha=0.35), "Construido en 2017"),
                ("area", dict(color=C["navy"]), f"Construido nuevo, 2017 a 2023 ({nuevo:,.0f} ha)")]
    mapa("uso-suelo-construido-nuevo-2017-2023.png", us, col, entradas, extent, urbano, municipio,
         titulo="Avance de lo construido, 2017 a 2023 (uso de suelo Esri)")

    comun.estilo()
    fig, ax = plt.subplots(figsize=(16.6 / 2.54, 8 / 2.54))
    for nombre, (c, a) in zip(NOMBRES_NDVI[1:], list(col_ndvi.values())[1:]):
        ax.plot(ANIOS, [f["pct_" + nombre] for f in filas_ndvi], color=C[c], alpha=max(a, 0.45), lw=2,
                marker="o", ms=3.5, label=f"{nombre}")
    ax.set_ylabel("Por ciento de la zona urbana", color=C["navy"], fontsize=8)
    ax.tick_params(colors=C["gris"], labelsize=7.5)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(C["filete"])
        ax.spines[s].set_linewidth(0.8)
    ax.set_xticks(ANIOS)
    ax.legend(frameon=False, fontsize=7.5, labelcolor=C["navy"])
    ax.set_title("Vegetación en estiaje por clase de NDVI, zona urbana de León", fontsize=9, color=C["navy"], loc="left")
    fig.tight_layout()
    fig.savefig(MAPAS / "ndvi-clases-por-anio.png", dpi=300, facecolor="white")
    plt.close(fig)


if __name__ == "__main__":
    MAPAS.mkdir(parents=True, exist_ok=True)
    fn, fb, fu, _ = tablas()
    contrastes(fn, fb, fu)
    mapas(fn, fu)
