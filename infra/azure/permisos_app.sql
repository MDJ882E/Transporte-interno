-- Se ejecuta UNA vez en la base "transporte", conectado como el administrador de Entra ID del servidor SQL
-- (por ejemplo desde el editor de consultas del portal de Azure o con sqlcmd -G).
-- Reemplace <nombre-web-app> por la salida "usuarioBase" del despliegue de main.bicep.
-- La app usa su identidad administrada: no hay usuario ni contraseña de SQL guardados.
CREATE USER [<nombre-web-app>] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [<nombre-web-app>];
ALTER ROLE db_datawriter ADD MEMBER [<nombre-web-app>];
-- Las migraciones se aplican al arrancar la app: necesita crear y modificar tablas.
ALTER ROLE db_ddladmin ADD MEMBER [<nombre-web-app>];
