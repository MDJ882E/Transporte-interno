# Piloto e indicadores

## Flujo del piloto (Olas)

1. El anotador elige los bloques en que trabaja ese día.
2. Cuando la garrucha va al 90 %, toca **Garrucha al 90 %**. Se guarda la hora del llamado. El aviso por radio sigue igual.
3. Cuando llega el transportador, toca **Llegó el transportador** y elige quién es. Si el bloque puede ir a dos poscosechas, elige el destino; por defecto se sugiere la de menor ciclo estándar.
4. Cuando sale, toca **Salió con carga** e indica los baldes por cuenta.
5. En poscosecha se lee el código de barras como hoy.
6. El jefe de sede o el recibidor exporta el **informe de detalle** del sistema de poscosecha (doble clic en el total de la tabla dinámica → guardar como CSV) y lo carga en **Lecturas poscosecha**.

El importador reconoce el informe actual: salta el título, toma `empleado` como código del transportador, `ramos` como baldes, `registro` como fecha y hora y `nomcausa` como novedad. Las filas del mismo transportador separadas por 5 minutos o menos se unen en una sola llegada (el sistema escribe una fila por grupo de ramos). Volver a cargar el mismo archivo no duplica datos.

## Indicadores

| Indicador | Fórmula | Fuente de las horas |
| --- | --- | --- |
| Espera en bloque | máx(0, salida − llegada al bloque − 5 min de cargue estándar), promedio por viaje | Anotador |
| Respuesta al llamado | llegada al bloque − hora del llamado | Anotador |
| Ciclo por viaje | regreso − llegada al bloque; sin regreso: llegada siguiente del mismo transportador − llegada actual (máximo 3 h) | Anotador o transportador |
| Ciclo estándar | (ida + vuelta) / 55 m/min + 10 min, de la matriz de distancias | Matriz OD |
| Viajes entregados | viajes con llegada a poscosecha (lectura) o regreso | Lecturas |
| Viajes por transportador | entregados ÷ transportadores activos | Lecturas y anotador |
| Baldes anotados frente a recibidos | Σ baldes de la salida frente a Σ baldes de la lectura emparejada | Anotador y lecturas |
| % espera en bloque sobre el turno | Σ espera ÷ minutos de turno (solo si el transportador registra turno) | Transportador |
| Disponibilidad de equipos | 1 − minutos en falla ÷ (equipos × 7 h) | Fallas reportadas |

Línea base del estudio (bloques 27 y 47): espera en bloque 44 % del tiempo, ciclo real 50,3 min, 7 garruchas/día por transportador. Meta: espera ≤ 15 %, ciclo ≈ 31 min.

## Supuestos y riesgos de calidad del dato

- **La hora de lectura en poscosecha debe ser la de llegada.** En el informe de muestra (7 nov.) hay lecturas de varios transportadores en el mismo minuto (por ejemplo, cuatro a las 9:17 con 1 ramo cada una). Eso sugiere lecturas en lote o ajustes. En la primera semana conviene contrastar 2 días con observación directa antes de usar el tiempo de ida.
- Cargue y descargue estándar de 5 min y velocidad de 55 m/min vienen de Olas; en Manantiales están por confirmar y en Caribe faltan (tractor).
- Si el anotador olvida marcar una llegada, ese viaje no tendrá espera ni ciclo. El tablero muestra los viajes sin llegada a poscosecha y las lecturas sin emparejar para detectarlo.
- La ventana de emparejamiento (salida a lectura ≤ 2 h) y la de agrupación de filas (5 min) son parámetros iniciales que se ajustarán con los datos del piloto.

## Criterios de aceptación del piloto (4 semanas)

| Criterio | Meta |
| --- | --- |
| Garruchas con llegada y salida marcadas por el anotador | ≥ 90 % de las lecturas de poscosecha |
| Lecturas emparejadas con una salida | ≥ 85 % |
| Diferencia de baldes anotados frente a recibidos | ≤ 5 % |
| Espera en bloque (semanas 2 a 4 frente a la semana 1) | Reducción sostenida, sin cambiar la dotación |

Si en la semana 2 el emparejamiento es menor al 70 %, se revisa el flujo de captura antes de continuar.
