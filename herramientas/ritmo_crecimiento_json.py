"""
Panel «Ritmo de crecimiento» de la capa «Zonas de crecimiento» (pedido de Carlos del 18/11/2026, vía MASTER; publicado
por decisión de Carlos del 19/11/2026).

Junta los agregados anuales que revisó el juez (`ORDENES-DEL-MASTER/2026-11-18-DICTAMEN-JUEZ-RITMO-CRECIMIENTO.md`) y
deja `public/apertura/crecimiento/ritmo.json` (no versionado; tras Access). Solo totales por año: ninguna cuenta,
coordenada ni polígono sale de aquí.

Insumos (fuera del repositorio):
  - `salidas/ritmo-crecimiento/tabla-por-anio.csv` (tomas de Análisis de Cuentas, convenios de Balance Hídrico,
    factibilidades de Nuevos Desarrollos);
  - la matriz de consolidación de Balance Hídrico (`entregas/2026-11-18-convenios-cohortes-satelital/`);
  - `salidas/ritmo-crecimiento/cifras-fijas.json`: cifras del dictamen que no salen de la tabla y las frases de lectura.

Condiciones del juez que se cumplen aquí:
  - sin habitantes (el 3.6 es de stock; la población solo si se pide);
  - la parte de tomas en convenios desde 2020 es cota inferior;
  - de la consolidación, solo celdas de año completo (cohorte + k <= 2025);
  - factibilidad a convenio, por superficie;
  - techo solo como agregado 2000-2020; el autómata con su horizonte 2025-2030.

Uso: python herramientas/ritmo_crecimiento_json.py
"""

import csv
import json
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
TABLA = RAIZ / "salidas" / "ritmo-crecimiento" / "tabla-por-anio.csv"
# Cifras del dictamen y frases de lectura: fuera del repositorio mientras sea publico.
FIJAS = RAIZ / "salidas" / "ritmo-crecimiento" / "cifras-fijas.json"
MATRIZ = RAIZ.parent / "2. BALANCE HÍDRICO" / "entregas" / "2026-11-18-convenios-cohortes-satelital" / "matriz-consolidacion-acumulada-pct.csv"
DESTINO = RAIZ / "public" / "apertura" / "crecimiento" / "ritmo.json"

ULTIMO_ANIO_COMPLETO = 2025
CORTE = "sep-2026"


def num(valor: str) -> float | None:
    valor = valor.strip()
    return float(valor) if valor else None


def entero(valor: str) -> int | None:
    v = num(valor)
    return None if v is None else int(round(v))


def main() -> None:
    with TABLA.open(encoding="utf-8-sig", newline="") as f:
        filas = list(csv.DictReader(f))
    anios = []
    for r in filas:
        anio = int(r["anio"])
        anios.append({
            "anio": anio,
            "parcial": anio > ULTIMO_ANIO_COMPLETO,
            "tomas_domesticas": entero(r["tomas_dom"]),
            "tomas_todas": entero(r["tomas_todas"]),
            "tomas_fuera_limite": entero(r["tomas_fuera_limite"]),
            "convenios": entero(r["conv_n"]),
            "unidades_convenidas": entero(r["conv_unidades"]),
            "convenios_ha": num(r["conv_ha"]),
            "en_convenios_desde_2020_de_cada_100": entero(r["de_cada_100_tomas_en_convenios_2020_o_despues_cota_inferior"]),
            "factibilidad_ha": num(r["fac_ha_union_del_anio"]),
            "factibilidad_bajo_convenio_de_cada_100_ha": entero(r["fac_ha_nuevas_bajo_convenio_de_cada_100"]),
        })

    with MATRIZ.open(encoding="utf-8-sig", newline="") as f:
        lector = csv.DictReader(f)
        cohortes = []
        for r in lector:
            cohorte = int(r["anio"])
            puntos = [int(float(r[str(k)]) + 0.5) for k in range(0, 7)
                      if str(k) in r and r[str(k)].strip() and cohorte + k <= ULTIMO_ANIO_COMPLETO]
            if puntos:
                cohortes.append({"cohorte": cohorte, "acumulado_de_cada_100": puntos})

    fijas = json.loads(FIJAS.read_text(encoding="utf-8"))
    completos = [a for a in anios if 2021 <= a["anio"] <= ULTIMO_ANIO_COMPLETO]
    promedio = sum(a["tomas_domesticas"] for a in completos) / len(completos)
    bajo, alto = fijas["promedio_esperado_2021_2025"]
    assert bajo <= promedio <= alto, f"El promedio 2021-2025 cambió ({promedio:.0f}); revisar con el juez antes de publicar"

    datos = {
        "generado": datetime.now(timezone.utc).isoformat(),
        "corte": CORTE,
        "promedio_tomas_2021_2025": round(promedio),
        "censo_2010_2020": fijas["censo_2010_2020"],
        "anios": anios,
        "cohortes": cohortes,
        "por_contratar_unidades": fijas["por_contratar_unidades"],
        "techo_m2_por_toma_2000_2020": fijas["techo_m2_por_toma_2000_2020"],
        "automata_2025_2030": fijas["automata_2025_2030"],
        "lectura": fijas["lectura"],
    }
    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    DESTINO.write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"ritmo: {DESTINO.relative_to(RAIZ)}; promedio {promedio:.0f}; {len(cohortes)} cohortes")


if __name__ == "__main__":
    main()
