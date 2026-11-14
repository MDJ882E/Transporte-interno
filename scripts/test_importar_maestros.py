"""Prueba del importador de matrices con un libro ficticio. Ejecutar: python3 -m pytest scripts"""
import openpyxl

from importar_maestros import generar_sql, leer_matriz, normalizar


def test_normalizar():
    assert normalizar("Bloque 27").codigo == "B27"
    assert normalizar("B5").nombre == "Bloque 5"
    assert normalizar("Poscosecha Olas2").codigo == "POS2"
    assert normalizar("Postcosecha").tipo == "poscosecha"
    assert normalizar("Germinación").tipo == "banco"


def test_matriz_y_ciclo(tmp_path):
    libro = openpyxl.Workbook()
    hoja = libro.active
    hoja.title = "Matriz"
    hoja.append(["Distancia en m", "Poscosecha Olas1", "Bloque 1", None, "Parámetros"])
    hoja.append(["", "Poscosecha", "Bloque"])  # fila de tipos: se ignora
    hoja.append(["Poscosecha Olas1", 0, 220])
    hoja.append(["Bloque 1", 330, 0])
    archivo = tmp_path / "matriz.xlsx"
    libro.save(archivo)

    nombres, metros = leer_matriz(str(archivo), "Matriz")
    assert nombres == ["Poscosecha Olas1", "Bloque 1"]
    assert metros == {("Poscosecha Olas1", "Bloque 1"): 220.0, ("Bloque 1", "Poscosecha Olas1"): 330.0}

    sql = generar_sql("OL", nombres, metros, velocidad=55, cargue=5, descargue=5)
    # (330 + 220) / 55 + 10 = 20 min
    assert "('B1', 'POS1', 330.0, 20.00)" in sql
    assert "ON CONFLICT (origen_id, destino_id) DO UPDATE" in sql
