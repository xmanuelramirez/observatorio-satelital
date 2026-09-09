"""
Somete un par interferometrico a HyP3, espera el resultado y deja un GeoTIFF
listo para la app.

Por que existe este script y no vive en el navegador: la API de HyP3 exige
token de NASA Earthdata y no manda cabeceras CORS, asi que una pagina web no
puede llamarla. La busqueda de pares si es publica y esa parte si vive en la
app, en src/servicios/insar.ts.

Uso:
    python herramientas/hyp3_subsidencia.py GRANULO_REFERENCIA GRANULO_SECUNDARIO

Los nombres de granulo salen del panel Subsidencia de la app.

Requiere una cuenta gratuita de NASA Earthdata:
    https://urs.earthdata.nasa.gov/users/new

Y las dependencias:
    pip install hyp3_sdk rasterio

Credenciales: se leen de las variables de entorno EARTHDATA_USERNAME y
EARTHDATA_PASSWORD, o de ~/.netrc si ya lo tienes configurado.
"""

from __future__ import annotations

import argparse
import os
import sys
import zipfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
SALIDA = RAIZ / "public" / "insar"

# HyP3 Basic da 8,000 creditos gratis al mes. Un InSAR de escena completa
# cuesta creditos; conviene revisar el saldo antes de lanzar una tanda.
TIPO_TRABAJO = "INSAR_GAMMA"


def conectar():
    try:
        import hyp3_sdk
    except ImportError:
        sys.exit("Falta hyp3_sdk. Instala con: pip install hyp3_sdk rasterio")

    usuario = os.environ.get("EARTHDATA_USERNAME")
    clave = os.environ.get("EARTHDATA_PASSWORD")

    if usuario and clave:
        return hyp3_sdk.HyP3(username=usuario, password=clave)

    # Sin variables de entorno, el SDK intenta ~/.netrc por su cuenta.
    return hyp3_sdk.HyP3()


def someter(hyp3, referencia: str, secundario: str, nombre: str):
    print(f"Sometiendo {TIPO_TRABAJO}")
    print(f"  referencia  {referencia}")
    print(f"  secundario  {secundario}")

    trabajo = hyp3.submit_insar_job(
        referencia,
        secundario,
        name=nombre,
        # El desplazamiento vertical no viene por defecto y es justo lo que
        # queremos para subsidencia.
        include_displacement_maps=True,
        include_inc_map=True,
        include_dem=True,
        # El agua libre decorrelaciona y mete ruido; con El Palote dentro del
        # area conviene enmascararla en vez de interpretar su fase.
        apply_water_mask=True,
        looks="10x2",  # 80 m de resolucion, 40 m de pixel
    )

    print("Trabajo enviado. HyP3 tarda tipicamente entre 20 y 60 minutos.")
    return trabajo


def descargar(hyp3, trabajo) -> Path:
    print("Esperando a que termine...")
    trabajo = hyp3.watch(trabajo)

    if trabajo.failed():
        sys.exit(f"HyP3 reporto falla: {trabajo.status_code}")

    SALIDA.mkdir(parents=True, exist_ok=True)
    archivos = trabajo.download_files(SALIDA)
    if not archivos:
        sys.exit("HyP3 termino pero no entrego archivos")

    paquete = Path(archivos[0])
    print(f"Descargado: {paquete.name}")

    with zipfile.ZipFile(paquete) as z:
        z.extractall(SALIDA)

    carpeta = SALIDA / paquete.stem
    return carpeta


def a_cog(carpeta: Path) -> Path:
    """
    Deja el desplazamiento vertical como GeoTIFF en WGS84, que es lo que la
    app puede leer. HyP3 entrega en UTM y georaster prefiere grados.
    """
    try:
        import rasterio
        from rasterio.warp import calculate_default_transform, reproject, Resampling
    except ImportError:
        sys.exit("Falta rasterio. Instala con: pip install rasterio")

    candidatos = list(carpeta.glob("*_vert_disp.tif"))
    if not candidatos:
        candidatos = list(carpeta.glob("*_los_disp.tif"))
    if not candidatos:
        disponibles = "\n  ".join(p.name for p in carpeta.glob("*.tif"))
        sys.exit(f"No encontre mapa de desplazamiento. Hay:\n  {disponibles}")

    origen = candidatos[0]
    destino = SALIDA / f"{carpeta.name}_desplazamiento.tif"

    with rasterio.open(origen) as src:
        transformacion, ancho, alto = calculate_default_transform(
            src.crs, "EPSG:4326", src.width, src.height, *src.bounds
        )
        perfil = src.profile.copy()
        perfil.update(
            crs="EPSG:4326",
            transform=transformacion,
            width=ancho,
            height=alto,
            driver="GTiff",
            tiled=True,
            blockxsize=256,
            blockysize=256,
            compress="deflate",
        )

        with rasterio.open(destino, "w", **perfil) as dst:
            reproject(
                source=rasterio.band(src, 1),
                destination=rasterio.band(dst, 1),
                src_transform=src.transform,
                src_crs=src.crs,
                dst_transform=transformacion,
                dst_crs="EPSG:4326",
                resampling=Resampling.bilinear,
            )

    print(f"\nListo: {destino}")
    print(f"En la app, pega esta ruta en el panel Subsidencia:")
    print(f"  /insar/{destino.name}")
    print("\nUnidades: metros. Negativo es hundimiento respecto a la fecha de referencia.")
    return destino


def main() -> None:
    analizador = argparse.ArgumentParser(description="InSAR de subsidencia con HyP3")
    analizador.add_argument("referencia", help="Granulo SLC de la fecha anterior")
    analizador.add_argument("secundario", help="Granulo SLC de la fecha posterior")
    analizador.add_argument("--nombre", default="subsidencia-leon")
    argumentos = analizador.parse_args()

    hyp3 = conectar()

    saldo = hyp3.check_credits()
    if saldo is not None:
        print(f"Creditos disponibles: {saldo}")

    trabajo = someter(hyp3, argumentos.referencia, argumentos.secundario, argumentos.nombre)
    carpeta = descargar(hyp3, trabajo)
    a_cog(carpeta)


if __name__ == "__main__":
    main()
