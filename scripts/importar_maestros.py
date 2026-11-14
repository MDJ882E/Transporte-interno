#!/usr/bin/env python3
"""Convierte una matriz de distancias origen-destino (Excel) en SQL de datos maestros.

Uso:
    python3 scripts/importar_maestros.py --sede OL --archivo datos/matriz_olas.xlsx --hoja Matriz > datos/maestros_OL.sql
    psql "$DATABASE_URL" -f datos/maestros_OL.sql

La matriz debe tener los nombres de los puntos en la primera fila y en la primera columna.
Las filas cuyo primer valor no es un nombre de la cabecera se ignoran (por ejemplo, la fila de tipos).

El ciclo estándar de cada par se calcula igual que en el estudio de capacidad de Olas:
    ciclo = (metros ida + metros vuelta) / velocidad + minutos de cargue + minutos de descargue
Si la sede no tiene velocidad medida (Caribe, tractor), el ciclo queda vacío y solo se guardan los metros.

Los datos reales de la empresa NO se guardan en el repositorio: deje los Excel y el SQL generado en datos/
(está en .gitignore).
"""
from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass

import openpyxl


@dataclass(frozen=True)
class Punto:
    codigo: str
    nombre: str
    tipo: str


def normalizar(nombre: str) -> Punto:
    """Traduce el nombre de la matriz a código, nombre y tipo de punto."""
    texto = " ".join(str(nombre).split())
    bajo = texto.lower()
    m = re.fullmatch(r"(?:bloque\s*|b)(\d+[a-z]?)", bajo)
    if m:
        numero = m.group(1).upper()
        return Punto(f"B{numero}", f"Bloque {numero}", "bloque")
    if bajo.startswith(("poscosecha", "postcosecha")):
        sufijo = re.search(r"(\d+)\s*$", texto)
        codigo = f"POS{sufijo.group(1)}" if sufijo else "POS"
        return Punto(codigo, texto.replace("Postcosecha", "Poscosecha"), "poscosecha")
    if bajo.startswith("compostera"):
        return Punto("COMP", "Compostera", "compostera")
    if bajo.startswith(("germinaci", "banco")):
        return Punto("GERM" if bajo.startswith("germinaci") else "BANCO", texto, "banco")
    raise ValueError(f"No sé clasificar el punto '{texto}'. Agregue la regla en normalizar().")


def leer_matriz(archivo: str, hoja: str | None) -> tuple[list[str], dict[tuple[str, str], float]]:
    libro = openpyxl.load_workbook(archivo, data_only=True, read_only=True)
    hoja_xl = libro[hoja] if hoja else libro.worksheets[0]
    filas = list(hoja_xl.iter_rows(values_only=True))
    cabecera = [c for c in filas[0][1:]]
    # La cabecera termina en la primera celda vacía (a la derecha puede haber notas o parámetros).
    if None in cabecera:
        cabecera = cabecera[: cabecera.index(None)]
    nombres = [str(c).strip() for c in cabecera]
    conjunto = set(nombres)
    metros: dict[tuple[str, str], float] = {}
    for fila in filas[1:]:
        origen = str(fila[0]).strip() if fila[0] is not None else ""
        if origen not in conjunto:
            continue
        for j, destino in enumerate(nombres, start=1):
            valor = fila[j] if j < len(fila) else None
            if origen == destino or valor in (None, ""):
                continue
            metros[(origen, destino)] = float(valor)
    return nombres, metros


def sql_texto(valor: str) -> str:
    return "'" + valor.replace("'", "''") + "'"


def generar_sql(sede: str, nombres: list[str], metros: dict[tuple[str, str], float],
                velocidad: float | None, cargue: float, descargue: float) -> str:
    puntos = {n: normalizar(n) for n in nombres}
    codigos = [p.codigo for p in puntos.values()]
    repetidos = {c for c in codigos if codigos.count(c) > 1}
    if repetidos:
        raise ValueError(f"Códigos repetidos tras normalizar: {sorted(repetidos)}")

    lineas = [
        f"-- Datos maestros de la sede {sede}, generados por scripts/importar_maestros.py",
        "BEGIN;",
        "INSERT INTO punto (sede_id, codigo, nombre, tipo) VALUES",
        ",\n".join(f"  ({sql_texto(sede)}, {sql_texto(p.codigo)}, {sql_texto(p.nombre)}, {sql_texto(p.tipo)})"
                   for p in puntos.values()),
        "ON CONFLICT (sede_id, codigo) DO UPDATE SET nombre = EXCLUDED.nombre, tipo = EXCLUDED.tipo;",
        "",
        "CREATE TEMP TABLE _dist (origen text, destino text, metros numeric, ciclo numeric) ON COMMIT DROP;",
        "INSERT INTO _dist VALUES",
    ]
    filas = []
    for (o, d), m in sorted(metros.items()):
        vuelta = metros.get((d, o))
        if velocidad and vuelta is not None:
            ciclo = f"{(m + vuelta) / velocidad + cargue + descargue:.2f}"
        else:
            ciclo = "NULL"
        filas.append(f"  ({sql_texto(puntos[o].codigo)}, {sql_texto(puntos[d].codigo)}, {m:.1f}, {ciclo})")
    lineas.append(",\n".join(filas) + ";")
    lineas += [
        "INSERT INTO distancia (origen_id, destino_id, metros, ciclo_estandar_min)",
        "SELECT po.id, pd.id, t.metros, t.ciclo",
        "FROM _dist t",
        f"JOIN punto po ON po.sede_id = {sql_texto(sede)} AND po.codigo = t.origen",
        f"JOIN punto pd ON pd.sede_id = {sql_texto(sede)} AND pd.codigo = t.destino",
        "ON CONFLICT (origen_id, destino_id) DO UPDATE",
        "  SET metros = EXCLUDED.metros, ciclo_estandar_min = EXCLUDED.ciclo_estandar_min;",
        "COMMIT;",
        "",
    ]
    return "\n".join(lineas)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sede", required=True, choices=["OL", "MT", "FE"])
    ap.add_argument("--archivo", required=True)
    ap.add_argument("--hoja", help="Hoja con la matriz en metros (por defecto, la primera)")
    ap.add_argument("--velocidad", type=float, help="m/min; si se omite, el ciclo queda vacío")
    ap.add_argument("--cargue", type=float, default=5.0, help="min de cargue en origen (defecto 5)")
    ap.add_argument("--descargue", type=float, default=5.0, help="min de descargue en destino (defecto 5)")
    args = ap.parse_args(argv)

    nombres, metros = leer_matriz(args.archivo, args.hoja)
    sys.stdout.write(generar_sql(args.sede, nombres, metros, args.velocidad, args.cargue, args.descargue))
    print(f"{len(nombres)} puntos y {len(metros)} pares leídos.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
