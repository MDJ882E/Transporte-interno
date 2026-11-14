# Transporte interno

Aplicación para registrar y medir el transporte interno de flor en las sedes **Olas (OL)** y **Manantiales (MT)**, que usan cable vía, y **Caribe (FE)**, que usa tractor.

El estudio de capacidad de Olas (noviembre de 2025) encontró que el 44 % del tiempo del transportador es espera en el bloque. La app sirve para medir esa espera todos los días y para avisar cuándo una garrucha está lista. No acelera el cable vía ni el tractor.

## Cómo funciona en el piloto

```
Bloque (anotador, celular)            Poscosecha (sistema actual)       Jefe de sede (computador)
1. Garrucha al 90 %   ─┐              Lectura de código de barras        Importa el archivo de lecturas
2. Llegó el transportador ├─► servidor ◄── al llegar: empleado,      ──►  y ve el tablero del día
3. Salió con N baldes por cuenta ─┘     ramos/baldes, hora
```

- El **anotador del bloque** (rol líder de corte) marca tres momentos por garrucha. Funciona sin señal: lo registrado queda en el teléfono y se envía al volver la cobertura.
- La **llegada a poscosecha** se toma del informe de detalle del sistema de código de barras. La app une cada lectura con la última salida del mismo transportador (máximo 2 horas antes).
- El **tablero** calcula los indicadores a partir de esas horas. Ningún tiempo se digita.

El transportador no necesita teléfono en el piloto. Si más adelante lo lleva, la pantalla "Mi turno" le permite registrar sus propios eventos.

## Roles

| Rol | Qué hace | Qué ve |
| --- | --- | --- |
| Transportador | Turno, viajes, esperas y fallas (opcional en el piloto) | Sus llamados y su viaje en curso |
| Líder de corte (anotador) | Llamados, llegada del transportador, salida con contenido, fallas | Sus bloques y el tablero de la sede |
| Recibidor de poscosecha | Importa lecturas | Resultado de la importación |
| Jefe de sede | Todo lo anterior en su sede; usuarios operativos y cuentas | Tablero, exportación a Excel |
| Gerencia | Solo lectura | Tablero de cualquier sede y comparativo |
| Administrador | Usuarios de todas las sedes | Todo |

Los permisos se verifican en el servidor en cada consulta, no solo en la pantalla.

## Estructura

| Carpeta | Contenido |
| --- | --- |
| `web/` | App instalable (PWA) en React y TypeScript |
| `api/` | API en Node.js (Fastify) con PostgreSQL |
| `shared/` | Contratos compartidos (operaciones, roles, indicadores) |
| `db/migrations/` | Esquema de la base, versionado |
| `db/demo/` | Datos **ficticios** para desarrollo |
| `scripts/` | Importador de matrices de distancias desde Excel |
| `infra/`, `docker-compose.yml` | Despliegue en el servidor de la empresa |
| `docs/` | [Despliegue](docs/despliegue.md) y [piloto e indicadores](docs/piloto.md) |

## Desarrollo local

Requisitos: Node.js 22 y PostgreSQL 16.

```bash
npm install
export DATABASE_URL=postgres://usuario:clave@localhost/transporte_dev
npm run db:demo          # migraciones + datos ficticios (PIN 1234)
npm run dev:api          # API en :3000
npm run dev:web          # app en :5173
```

Usuarios de demostración (PIN `1234`): `111` anotador, `110` jefe de Olas, `113` transportador, `101` gerencia, `100` administrador.

Pruebas:

```bash
TEST_DATABASE_URL=postgres://usuario:clave@localhost/transporte_test npm test   # ¡borra esa base!
python3 -m pytest scripts
```

## Datos de la empresa

Este repositorio no guarda datos reales: ni nombres, ni códigos de empleados, ni matrices de distancias, ni archivos de poscosecha. La carpeta `datos/` está excluida de git. Los maestros reales se cargan en el servidor (ver [despliegue](docs/despliegue.md)).
