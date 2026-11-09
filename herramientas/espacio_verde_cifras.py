"""
Cifras, zonas prioritarias y mapa de prueba de la distancia al espacio verde publico.

Lee lo que deja `espacio_verde.py` en `salidas/espacio-verde/espacio-verde.gpkg`. Criterios de NBS
(09/11/2026): por calles al borde del espacio, 400 m a uno de 0.5 ha o mas (A-1; 0.15 ha y 1 ha
como sensibilidad), 600 m a uno de 4 ha (B-2) y 800 m a uno de 7.5 ha (C-3), NOM-001-SEDATU-2021;
como comparacion, 300 m en linea recta a 0.5 ha y a 1 ha (OMS 2016).

El mapa sigue la skill de mapas del departamento: paleta cerrada, EPSG:32614, 300 dpi, relieve
propio recortado al municipio. La distancia va en pasos de opacidad de `navy`, no en colores nuevos.

Uso: python herramientas/espacio_verde_cifras.py <carpeta scripts de la skill de mapas>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, sys.argv[1])
import comun  # noqa: E402  (antes de rasterio: arregla PROJ_LIB)
from comun import C  # noqa: E402

import geopandas as gpd  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

RAIZ = Path(__file__).resolve().parents[1]
SALIDA = RAIZ / "salidas" / "espacio-verde"
GPKG = SALIDA / "espacio-verde.gpkg"
RELIEVE = RAIZ.parent / "0. CAPAS VARIAS" / "HILLSHADE_LEON.tif"
POB_MUNICIPIO = 1_721_215
POB_AGEB_URBANAS = 1_631_014

# (clave del conjunto, corte en m, columna de distancia, nombre)
CRITERIOS = [
    ("base_05ha", 400, "red", "A-1: 0.5 ha o mas a 400 m por calles (base)"),
    ("base_a1", 400, "red", "A-1 sensibilidad: 0.15 ha o mas a 400 m por calles"),
    ("base_1ha", 400, "red", "A-1 alternativa: 1 ha o mas a 400 m por calles"),
    ("base_b2", 600, "red", "B-2: 4 ha o mas a 600 m por calles"),
    ("base_c3", 800, "red", "C-3: 7.5 ha o mas a 800 m por calles"),
    ("base_05ha", 300, "linea", "OMS: 0.5 ha o mas a 300 m en linea recta"),
    ("base_1ha", 300, "linea", "OMS: 1 ha o mas a 300 m en linea recta"),
    ("base_a1", 500, "red", "Cotejo IMPLAN 2023: 0.15 ha o mas a 500 m por calles"),
    ("azul_05ha", 400, "red", "Variante con cuerpos de agua: 0.5 ha a 400 m"),
    ("osm_05ha", 400, "red", "Variante OSM sin filtros (NDVI ni cotos): 0.5 ha a 400 m"),
]


def pct(mz: pd.DataFrame, col: str, corte: float) -> float:
    ok = mz["pob"].notna()
    return float(100 * mz.loc[ok & (mz[col] <= corte), "pob"].sum() / mz.loc[ok, "pob"].sum())


def main() -> None:
    mz = gpd.read_file(GPKG, layer="distancia_manzanas")
    verde = gpd.read_file(GPKG, layer="verde_publico")
    azul = gpd.read_file(GPKG, layer="azul_publico")
    urbano = gpd.read_file(RAIZ / "public" / "capas" / "LIMITE_URBANO.geojson").to_crs(32614)
    municipio = gpd.read_file(RAIZ / "public" / "capas" / "LIMITE.geojson").to_crs(32614)
    cifras: dict = {}

    # --- Contrastes declarados
    cifras["poblacion_manzanas_municipio"] = int(mz["pob"].sum())
    cifras["poblacion_manzanas_urbano"] = int(mz.loc[mz["urbano"].astype(bool), "pob"].sum())
    cifras["contraste_poblacion"] = {
        "municipio_inegi": POB_MUNICIPIO,
        "ageb_urbanas_inegi": POB_AGEB_URBANAS,
        "diferencia_contra_ageb_pct": round(100 * (mz["pob"].sum() - POB_AGEB_URBANAS) / POB_AGEB_URBANAS, 2),
        "manzanas_sin_poblacion": int(mz["pob"].isna().sum()),
    }
    par = mz[np.isfinite(mz["base_05ha_red"]) & (mz["base_05ha_linea"] > 0)]
    cociente = par["base_05ha_red"] / par["base_05ha_linea"]
    cifras["contraste_red_contra_linea"] = {
        "manzanas": int(len(par)),
        "mediana_cociente": round(float(cociente.median()), 2),
        "p10_p90": [round(float(cociente.quantile(0.1)), 2), round(float(cociente.quantile(0.9)), 2)],
        "red_menor_que_linea_menos_acceso": int((par["base_05ha_red"] < par["base_05ha_linea"] - par["acceso_red_m"] - 1).sum()),
    }
    cifras["inventario"] = {
        "verde_espacios": int(len(verde)),
        "verde_ha": round(float(verde["ha"].sum()), 1),
        "sin_vegetacion": int((verde["control"] == "sin vegetacion").sum()),
        "escasa": int((verde["control"] == "escasa").sum()),
        "coto_probable": int(verde["coto"].astype(bool).sum()),
        "cuentan": int(verde["cuenta"].astype(bool).sum()),
        "cuentan_05ha": int((verde["cuenta"].astype(bool) & (verde["ha"] >= 0.5)).sum()),
        "azul_espacios": int(len(azul)),
        "azul_ha": round(float(azul["ha"].sum()), 1),
        "mayores": verde.sort_values("ha", ascending=False).head(8)[["nombre", "ha", "ndvi", "control", "coto"]]
        .assign(ha=lambda d: d["ha"].round(1), ndvi=lambda d: d["ndvi"].round(2)).to_dict("records"),
    }
    cuenta_ha = verde.loc[verde["cuenta"].astype(bool), "ha"]
    cifras["inventario"]["cuentan_por_tamano"] = {
        "0.15 a 2 ha": int(((cuenta_ha >= 0.15) & (cuenta_ha < 2)).sum()),
        "2 a 4 ha": int(((cuenta_ha >= 2) & (cuenta_ha < 4)).sum()),
        "4 a 7.5 ha": int(((cuenta_ha >= 4) & (cuenta_ha < 7.5)).sum()),
        "7.5 ha o mas": int((cuenta_ha >= 7.5).sum()),
        "menos de 0.15 ha": int((cuenta_ha < 0.15).sum()),
    }
    # IMPLAN 2023, sec. IX: 632 espacios (181 libres, 451 en fraccionamientos cerrados); 612 A-1 menores
    # de 2 ha, 1 B-2 y 5 D-4; poblacion beneficiada 529 882, 30.7 % del municipio (AGEB, Censo 2020).
    cifras["cotejo_implan_2023"] = {"espacios": 632, "libres": 181, "en_cotos": 451, "a1_menores_2ha": 612, "b2": 1, "d4": 5,
                                    "poblacion_beneficiada_pct_municipio": 30.7}
    try:
        cand = gpd.read_file(GPKG, layer="candidatas_ndvi_fuera_de_osm")
        cifras["inventario"]["candidatas_fuera_de_osm"] = {"n": int(len(cand)), "ha": round(float(cand["ha"].sum()), 1)}
    except Exception:  # capa vacia
        cifras["inventario"]["candidatas_fuera_de_osm"] = {"n": 0, "ha": 0}

    # --- Acceso por criterio: zona urbana y municipio
    urb = mz[mz["urbano"].astype(bool)]
    cifras["acceso_pct_poblacion"] = [
        {"criterio": nombre, "zona_urbana": round(pct(urb, f"{clave}_{col}", corte), 1), "municipio": round(pct(mz, f"{clave}_{col}", corte), 1)}
        for clave, corte, col, nombre in CRITERIOS
    ]
    cumple_alguno = (urb["base_05ha_red"] <= 400) | (urb["base_b2_red"] <= 600) | (urb["base_c3_red"] <= 800)
    cifras["zona_urbana_fuera_de_las_tres"] = {
        "habitantes": int(urb.loc[~cumple_alguno, "pob"].sum()),
        "pct": round(float(100 * urb.loc[~cumple_alguno, "pob"].sum() / urb["pob"].sum()), 1),
    }
    # Curva continua, para aplicar cualquier otro corte despues.
    cifras["curva_base_05ha_red_zona_urbana"] = {str(d): round(pct(urb, "base_05ha_red", d), 1) for d in range(100, 2100, 100)}

    # --- m2 por habitante (espacio que cuenta, dentro del limite urbano)
    lim = urbano.union_all()
    cuenta = verde[verde["cuenta"].astype(bool)]
    area = lambda g: float(g.intersection(lim).area.sum())  # noqa: E731
    pob_urb = float(urb["pob"].sum())
    cifras["m2_por_habitante_zona_urbana"] = {
        "cuenta_05ha": round(area(cuenta[cuenta["ha"] >= 0.5]) / pob_urb, 2),
        "cuenta_015ha": round(area(cuenta[cuenta["ha"] >= 0.15]) / pob_urb, 2),
        "cuenta_todo": round(area(cuenta) / pob_urb, 2),
        "con_azul_05ha": round((area(cuenta[cuenta["ha"] >= 0.5]) + area(azul[(azul["ha"] >= 0.5) & ~azul["coto"].astype(bool)])) / pob_urb, 2),
        "osm_sin_filtros": round(area(verde) / pob_urb, 2),
    }

    # --- Zonas prioritarias: AGEB urbanas con mas gente fuera de las tres distancias de la NOM
    urb = urb.assign(fuera=~cumple_alguno, ageb=urb["CVEGEO"].str[:13])
    por_ageb = urb.groupby("ageb").agg(pob=("pob", "sum"), fuera=("pob", lambda s: s[urb.loc[s.index, "fuera"]].sum()))
    por_ageb["pct_fuera"] = (100 * por_ageb["fuera"] / por_ageb["pob"]).round(1)
    # Poligonos de AGEB urbana del Marco Geoestadistico 2020 (los mismos insumos publicos que la poblacion).
    ruta_inegi = RAIZ.parent / "8. CAUCE" / "inundaciones" / "insumos" / "inegi" / "11_guanajuato.zip"
    geom = gpd.read_file(f"zip://{ruta_inegi}!conjunto_de_datos/11a.shp", where="CVE_MUN = '020'").to_crs(32614)
    geom = geom.rename(columns={"CVEGEO": "ageb"}).set_index("ageb")[["geometry"]]
    por_ageb = gpd.GeoDataFrame(por_ageb.join(geom), crs=32614)
    por_ageb["dist_mediana_m"] = urb.groupby("ageb")["base_05ha_red"].median().round(0)
    prior = por_ageb[por_ageb["fuera"] > 0].sort_values("fuera", ascending=False)
    prior["rango"] = range(1, len(prior) + 1)
    prior.to_file(GPKG, layer="ageb_prioritarias", driver="GPKG")
    c = prior.geometry.representative_point().to_crs(4326)
    cifras["ageb_prioritarias_top15"] = [
        {"rango": int(r.rango), "ageb": idx, "habitantes_fuera": int(r.fuera), "pob_ageb": int(r.pob), "pct_fuera": float(r.pct_fuera),
         "dist_mediana_m": float(r.dist_mediana_m), "lon": round(p.x, 4), "lat": round(p.y, 4)}
        for (idx, r), p in zip(prior.head(15).iterrows(), c.head(15))
    ]
    cifras["ageb_con_gente_fuera"] = int(len(prior))
    (SALIDA / "cifras.json").write_text(json.dumps(cifras, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in cifras.items() if k != "curva_base_05ha_red_zona_urbana"}, ensure_ascii=False, indent=1))

    mapa(verde, azul, urbano, municipio, prior.head(10))


def mapa(verde, azul, urbano, municipio, prior) -> None:
    from comun import barra_escala, esquina_mas_libre, figura, leyenda_vertical, recortar, rosa_vientos

    comun.estilo()
    celdas = gpd.read_file(GPKG, layer="distancia_celdas_100m")
    fig, ax = figura(alto_cm=15.0)
    x0, y0, x1, y1 = urbano.total_bounds
    mx, my = (x1 - x0) * 0.09, (y1 - y0) * 0.09
    # Abajo, aire de sobra: la simbologia vive sobre el relieve, no sobre la mancha.
    abajo = (y1 - y0) * 0.36
    ax.set_xlim(x0 - mx, x1 + mx)
    ax.set_ylim(y0 - abajo, y1 + my)
    y0 = y0 - abajo + my

    import rasterio
    from rasterio.enums import Resampling
    from rasterio.windows import from_bounds

    # Mismo relieve que `relieve.desde_geotiff`, leido con rasterio: aqui no esta el gdal_translate de QGIS.
    with rasterio.open(RELIEVE) as r:
        ventana = from_bounds(x0 - mx, y0 - my, x1 + mx, y1 + my, r.transform)
        sombra = r.read(1, window=ventana, out_shape=(1700, int(1700 * (y1 - y0 + 2 * my) / (x1 - x0 + 2 * mx))), boundless=True,
                        fill_value=0, resampling=Resampling.bilinear).astype("float32") / 255.0
    ext = (x0 - mx, x1 + mx, y0 - my, y1 + my)
    img = ax.imshow(sombra, extent=ext, cmap="gray", vmin=-0.55, vmax=1.55, alpha=0.50, zorder=1, interpolation="bilinear")
    recortar(ax, img, municipio.union_all())

    d = celdas["base_05ha_red"]
    pasos = [(400, 600, 0.22, "400 a 600 m"), (600, 800, 0.42, "600 a 800 m"), (800, 1e12, 0.66, "Más de 800 m")]
    for lo, hi, alfa, _ in pasos:
        sel = celdas[(d > lo) & (d <= hi)]
        if len(sel):
            sel.plot(ax=ax, color=C["navy"], alpha=alfa, linewidth=0, zorder=3)
    cuenta = verde[verde["cuenta"].astype(bool) & (verde["ha"] >= 0.5)]
    no_cuenta = verde[~verde["cuenta"].astype(bool) | (verde["ha"] < 0.5)]
    no_cuenta.plot(ax=ax, facecolor="none", edgecolor=C["regenerada"], linewidth=0.35, zorder=4)
    cuenta.plot(ax=ax, color=C["regenerada"], linewidth=0, zorder=5)
    azul[azul.intersects(urbano.buffer(2000).union_all())].plot(ax=ax, color=C["superficial"], linewidth=0, zorder=5)
    urbano.boundary.plot(ax=ax, color=C["navy"], linewidth=0.8, zorder=6)
    prior.boundary.plot(ax=ax, color=C["navy"], linewidth=1.3, zorder=7)
    from matplotlib import patheffects as pe

    puestos = []
    for _, r in prior.iterrows():
        p = r.geometry.representative_point()
        # Dos AGEB vecinas no comparten rotulo encimado: el segundo se corre a un lado.
        while any(p.distance(q) < 700 for q in puestos):
            p = type(p)(p.x + 750, p.y)
        puestos.append(p)
        ax.text(p.x, p.y, str(int(r.rango)), fontsize=7, color=C["navy"], weight="bold", ha="center", va="center", zorder=8,
                path_effects=[pe.withStroke(linewidth=2.4, foreground="white", alpha=0.9)])

    ocupado = celdas.union_all()
    lado, xa = "izquierda", 0.035
    leyenda_vertical(ax, [
        ("area", dict(color=C["regenerada"]), "Espacio verde público de 0.5 ha o más"),
        ("area", dict(color="white", ec=C["regenerada"], lw=0.6), "Menor, sin vegetación o en coto (no cuenta)"),
        ("area", dict(color=C["superficial"]), "Cuerpo de agua"),
        ("area", dict(color="white", ec=C["navy"], lw=0.5), "Hasta 400 m caminando"),
        ("area", dict(color=C["navy"], alpha=0.22), "A 400–600 m"),
        ("area", dict(color=C["navy"], alpha=0.42), "A 600–800 m"),
        ("area", dict(color=C["navy"], alpha=0.66), "A más de 800 m"),
        ("linea", dict(color=C["navy"], lw=1.3), "AGEB con más gente lejos (1 = la que más)"),
    ], x=xa, y=0.030, tam=6.6, salto=0.036, anclaje=lado)
    otro = "derecha" if lado == "izquierda" else "izquierda"
    barra_escala(ax, 5000, "5 km", x=0.968 if otro == "derecha" else 0.035, y=0.045, anclaje=otro)
    rosa_vientos(ax, x=0.93, y=0.89, radio=0.045)
    fig.savefig(SALIDA / "mapa-prueba-distancia-espacio-verde.png", dpi=300, facecolor="white")
    print("mapa", SALIDA / "mapa-prueba-distancia-espacio-verde.png")


if __name__ == "__main__":
    main()
