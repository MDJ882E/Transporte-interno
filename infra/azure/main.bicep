// Infraestructura en Azure para el transporte interno: un solo web service (API + app) y Azure SQL Database.
// La app web entra a la base con su identidad administrada (sin contraseñas guardadas).
// Uso (lo ejecuta TI): ver docs/despliegue.md.

@description('Prefijo de los nombres de los recursos (minúsculas, sin espacios).')
@minLength(3)
@maxLength(16)
param prefijo string = 'transporte'

@description('Región de Azure.')
param ubicacion string = resourceGroup().location

@description('Plan del App Service. B1 alcanza para el piloto; P0v3 o superior si se necesita más de una instancia.')
param skuPlan string = 'B1'

@description('Nivel de Azure SQL Database (por ejemplo Basic, S0, S1). Se cambia después sin perder datos.')
param skuBase string = 'S0'

@description('Días de retención de las copias de seguridad automáticas (restauración a un punto en el tiempo).')
@minValue(1)
@maxValue(35)
param diasRespaldo int = 14

@description('Nombre (login) del usuario o grupo de Entra ID que administra el servidor SQL.')
param adminSqlNombre string

@description('Object ID en Entra ID de ese usuario o grupo.')
param adminSqlObjectId string

@description('Tipo del administrador de Entra ID.')
@allowed(['User', 'Group', 'Application'])
param adminSqlTipo string = 'Group'

@secure()
@description('Clave para firmar las sesiones (openssl rand -hex 32).')
param jwtSecret string

var sufijo = uniqueString(resourceGroup().id)
var nombreWeb = '${prefijo}-${sufijo}'
var nombreSql = '${prefijo}-sql-${sufijo}'
var nombreBase = 'transporte'

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${prefijo}-plan'
  location: ubicacion
  kind: 'linux'
  sku: { name: skuPlan }
  properties: { reserved: true }
}

resource sqlServidor 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: nombreSql
  location: ubicacion
  properties: {
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    administrators: {
      administratorType: 'ActiveDirectory'
      azureADOnlyAuthentication: true
      login: adminSqlNombre
      sid: adminSqlObjectId
      principalType: adminSqlTipo
      tenantId: subscription().tenantId
    }
  }
}

// Permite conexiones desde servicios de Azure (el App Service). Para una red privada, reemplazar por
// integración con VNet y Private Endpoint.
resource reglaAzure 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = {
  parent: sqlServidor
  name: 'AllowAllWindowsAzureIps'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

resource base 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: sqlServidor
  name: nombreBase
  location: ubicacion
  sku: { name: skuBase }
  properties: {
    collation: 'SQL_Latin1_General_CP1_CI_AS'
    requestedBackupStorageRedundancy: 'Local'
  }
}

resource retencion 'Microsoft.Sql/servers/databases/backupShortTermRetentionPolicies@2023-08-01-preview' = {
  parent: base
  name: 'default'
  properties: { retentionDays: diasRespaldo }
}

resource web 'Microsoft.Web/sites@2023-12-01' = {
  name: nombreWeb
  location: ubicacion
  kind: 'app,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      appCommandLine: 'node api/dist/servidor.js'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      healthCheckPath: '/api/salud'
      appSettings: [
        {
          name: 'DATABASE_URL'
          value: 'Server=tcp:${sqlServidor.properties.fullyQualifiedDomainName},1433;Database=${nombreBase};Authentication=Active Directory Integrated;Encrypt=true'
        }
        { name: 'JWT_SECRET', value: jwtSecret }
        { name: 'NODE_ENV', value: 'production' }
        { name: 'OFFSET_ZONA', value: '-05:00' }
        // El paquete ya trae node_modules: no se compila en el servidor.
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
        { name: 'WEBSITE_RUN_FROM_PACKAGE', value: '1' }
      ]
    }
  }
}

output nombreWebApp string = web.name
output urlApp string = 'https://${web.properties.defaultHostName}'
output servidorSql string = sqlServidor.properties.fullyQualifiedDomainName
output baseDatos string = nombreBase
@description('Nombre con el que se crea el usuario de la app en la base (CREATE USER [...] FROM EXTERNAL PROVIDER).')
output usuarioBase string = web.name
