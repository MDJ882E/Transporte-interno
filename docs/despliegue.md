# Despliegue en Azure

## Arquitectura

| Componente | Servicio de Azure | Detalle |
| --- | --- | --- |
| Web service (API + app) | App Service Linux, Node.js 22 | Una sola aplicación publica `/api/*` y la app instalable. HTTPS obligatorio, certificado administrado por Azure |
| Base de datos | Azure SQL Database | Esquema en `db/migrations` (T-SQL). Las migraciones pendientes se aplican al arrancar la app |
| Acceso a la base | Identidad administrada de la app | Autenticación solo con Entra ID: no hay usuario ni contraseña de SQL guardados |
| Respaldo | Copias automáticas de Azure SQL | Restauración a un punto en el tiempo; retención configurable (14 días por defecto en la plantilla) |
| Publicación | GitHub Actions (`.github/workflows/azure.yml`) | Manual, con credencial federada (OIDC), sin secretos de larga duración |

Los teléfonos usan datos celulares: la app debe ser alcanzable desde internet. Si TI prefiere no exponerla, la alternativa es una VPN en cada teléfono con App Service en una red privada; eso cambia la plantilla y conviene decidirlo antes del piloto.

## Lo que necesita TI

| Requisito | Detalle |
| --- | --- |
| Suscripción y grupo de recursos | Permiso para crear App Service, Azure SQL y asignar identidades |
| Administrador de la base | Un grupo (recomendado) o usuario de Entra ID; se necesita su nombre y su Object ID |
| Clave de sesiones | `openssl rand -hex 32`. Va como parámetro seguro; puede moverse luego a Key Vault |
| Publicación desde GitHub | Una aplicación de Entra ID con credencial federada para este repositorio y rol *Website Contributor* sobre la web app |
| Dominio propio (opcional) | Si se quiere `transporte.empresa.com` en lugar de `*.azurewebsites.net`, se agrega como dominio personalizado con certificado administrado |

## Primera instalación

### 1. Crear los recursos

```bash
az group create --name rg-transporte --location eastus2
az deployment group create --resource-group rg-transporte \
  --template-file infra/azure/main.bicep \
  --parameters adminSqlNombre="Grupo-DBA-Transporte" adminSqlObjectId="<object-id>" jwtSecret="$(openssl rand -hex 32)"
```

La región, el plan (`skuPlan`, B1 por defecto) y el nivel de la base (`skuBase`, S0 por defecto) son parámetros: TI los ajusta según su política y presupuesto. Las salidas del despliegue dan el nombre de la web app, su URL y el servidor SQL.

### 2. Dar acceso a la app sobre la base

Conectado como el administrador de Entra ID (editor de consultas del portal o `sqlcmd -G`), ejecute `infra/azure/permisos_app.sql` en la base `transporte`, reemplazando `<nombre-web-app>` por la salida `usuarioBase`. Crea el usuario de la identidad administrada con permisos de lectura, escritura y cambios de esquema (para las migraciones).

### 3. Publicar la app

En el repositorio de GitHub, *Settings → Secrets and variables → Actions*:

- Secretos: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`.
- Variable: `AZURE_WEBAPP_NAME` (salida `nombreWebApp`).
- Entorno `produccion` (puede exigir aprobación antes de publicar).

Luego, en *Actions → Publicar en Azure → Run workflow*. El flujo compila, prueba tipos, arma el paquete (`scripts/empaquetar.sh`), lo publica y espera a que `/api/salud` responda. Al arrancar, la app crea las tablas.

### 4. Crear el primer administrador

Desde la consola SSH del App Service (portal → la web app → *SSH*):

```bash
cd /home/site/wwwroot
node api/dist/cli/usuario.js --documento 1000 --nombre "Nombre" --rol admin --pin 4821
```

## Cargar los datos maestros reales

Las matrices de distancias se convierten a T-SQL en un equipo con Python y `openpyxl`, y se aplican a la base con una cuenta de Entra ID con permisos de escritura. El ciclo estándar se calcula como `(ida + vuelta) / velocidad + cargue + descargue`, igual que en el estudio de capacidad. Cada archivo se aplica en una sola transacción y puede volver a ejecutarse: actualiza lo existente sin duplicar.

```bash
mkdir -p datos   # excluida de git
python3 scripts/importar_maestros.py --sede OL --archivo datos/matriz_olas.xlsx --hoja Matriz --velocidad 55 > datos/maestros_OL.sql
python3 scripts/importar_maestros.py --sede MT --archivo datos/matriz_mt.xlsx --hoja "Matriz OD (m)" --velocidad 55 > datos/maestros_MT.sql
python3 scripts/importar_maestros.py --sede FE --archivo datos/matriz_fe.xlsx > datos/maestros_FE.sql   # sin velocidad del tractor: solo metros
sqlcmd -S <servidor>.database.windows.net -d transporte -G -i datos/maestros_OL.sql
```

Verificado con las matrices actuales: Olas (54 puntos, 2.862 pares), Manantiales (23 puntos, 506 pares), Caribe (82 puntos, 6.642 pares). El ciclo Bloque 27 → Poscosecha Olas1 da 24,87 min, igual a la hoja "Tiempo Ciclo".

Después, desde la app (rol jefe de sede o administrador), pantalla **Usuarios**:

1. Crear anotadores, recibidores y transportadores con su PIN.
2. A cada transportador, asignar su **código en poscosecha**: el valor de la columna `empleado` del informe, con los ceros a la izquierda (por ejemplo `00001234`).
3. Cargar las **cuentas o clientes** de los baldes.

Las garruchas o tractores (tabla `recurso`) se cargan por SQL mientras no haya pantalla para ellos.

## Actualizar

Ejecutar de nuevo *Publicar en Azure*. Las migraciones nuevas se aplican al arrancar; si hay varias instancias, solo una las aplica (bloqueo `sp_getapplock`).

## Pendiente de validar en el primer despliegue

- La conexión con identidad administrada (`Authentication=Active Directory Integrated` en `DATABASE_URL`) no se puede probar fuera de Azure. Las pruebas automáticas corren contra SQL Server 2022 con usuario y clave. Si TI prefiere un usuario de SQL, basta con cambiar `DATABASE_URL` en la configuración del App Service.
- La plantilla Bicep se valida en cada cambio (`az bicep build` en CI), pero el primer despliegue real lo hace TI en su suscripción.
