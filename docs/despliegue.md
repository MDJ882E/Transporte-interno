# Despliegue en el servidor de la empresa

## Lo que necesita TI

| Requisito | Detalle |
| --- | --- |
| Servidor | Linux con Docker y Docker Compose (2 vCPU, 4 GB de RAM y 20 GB de disco son suficientes para el piloto) |
| Acceso desde el celular | Los teléfonos usan datos celulares, así que el servidor debe ser alcanzable desde internet con un dominio y HTTPS, o mediante una VPN instalada en cada teléfono |
| HTTPS | Obligatorio: sin HTTPS la app no se instala ni funciona sin señal. Con un dominio público, Caddy obtiene el certificado automáticamente (puertos 80 y 443 abiertos) |
| Respaldo | El servicio `respaldo` deja un archivo diario en `./respaldos` (se conservan 14). TI debe copiarlo a otro equipo |

Si TI provee su propio certificado, reemplace la primera línea de `infra/Caddyfile` por el dominio y agregue `tls /ruta/cert.pem /ruta/llave.pem`, montando esos archivos en el servicio `web`.

## Primera instalación

```bash
git clone https://github.com/MDJ882E/transporte-interno.git && cd transporte-interno
cp .env.example .env            # completar DB_PASSWORD, JWT_SECRET (openssl rand -hex 32) y DOMINIO
docker compose up -d --build    # crea la base, aplica migraciones y publica la app
```

Crear el primer administrador:

```bash
docker compose exec api node api/dist/cli/usuario.js --documento 1000 --nombre "Nombre" --rol admin --pin 4821
```

## Cargar los datos maestros reales

Las matrices de distancias se convierten a SQL en un equipo con Python y `openpyxl`, y se cargan en el servidor. El ciclo estándar se calcula como `(ida + vuelta) / velocidad + cargue + descargue`, igual que en el estudio de capacidad.

```bash
mkdir -p datos   # excluida de git
python3 scripts/importar_maestros.py --sede OL --archivo datos/matriz_olas.xlsx --hoja Matriz --velocidad 55 > datos/maestros_OL.sql
python3 scripts/importar_maestros.py --sede MT --archivo datos/matriz_mt.xlsx --hoja "Matriz OD (m)" --velocidad 55 > datos/maestros_MT.sql
python3 scripts/importar_maestros.py --sede FE --archivo datos/matriz_fe.xlsx > datos/maestros_FE.sql   # sin velocidad del tractor: solo metros
docker compose exec -T db psql -U transporte transporte < datos/maestros_OL.sql
```

Verificado con las matrices actuales: Olas (54 puntos, 2.862 pares), Manantiales (23 puntos, 506 pares), Caribe (82 puntos, 6.642 pares). El ciclo Bloque 27 → Poscosecha Olas1 da 24,87 min, igual a la hoja "Tiempo Ciclo".

Después, desde la app (rol jefe de sede o administrador), pantalla **Usuarios**:

1. Crear anotadores, recibidores y transportadores con su PIN.
2. A cada transportador, asignar su **código en poscosecha**: el valor de la columna `empleado` del informe, con los ceros a la izquierda (por ejemplo `00001234`).
3. Cargar las **cuentas o clientes** de los baldes.

Las garruchas o tractores (tabla `recurso`) se cargan por SQL mientras no haya pantalla para ellos.

## Actualizar

```bash
git pull && docker compose up -d --build   # las migraciones nuevas se aplican al arrancar la API
```
