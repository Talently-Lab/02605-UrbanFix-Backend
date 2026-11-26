# Catálogo oficial de barrios — S4-05 CP2

El modo `catalog` carga datos oficiales de referencia. Es independiente de los datasets ficticios golden y volumen, que no están implementados. Ningún seed se ejecuta al importar sus módulos, iniciar la API o ejecutar migraciones.

## Fuente y validación

El CSV es un archivo de referencia proporcionado por el DA. Está versionado en `prisma/data/Barrios.csv`, conservando su nombre y contenido originales. Contiene datos oficiales de referencia, separados de los datasets ficticios.

SHA-256 de los bytes originales: `6c482b90dd3e81f6fb2b13b43f845b661291e9911ee888202167ed8d9f5bfa0e`.

Antes de construir el cliente Prisma se comprueban las columnas `id_barrio, Barrio, id_comuna`, los 48 registros, IDs únicos del 1 al 48, nombres únicos, campos completos y comunas entre 1 y 15. Una huella SHA-256 del contenido canónico verifica también los nombres y sus correspondencias con el archivo aprobado; no alcanza con tener 48 nombres distintos. La huella admite LF o CRLF y los espacios alrededor de los campos. El lector está limitado al formato simple del archivo original, sin campos entrecomillados ni comas internas.

Solo `Barrio` se mapea a `Neighborhood.name`. `id_barrio` e `id_comuna` se validan como parte de la fuente, pero no se persisten. Los UUID nuevos los genera Prisma. Una modificación del catálogo requiere revisar la fuente y su huella; no se actualizan automáticamente.

## Destino y ejecución

El runner exige exactamente `--mode=catalog`. Rechaza argumentos adicionales y los modos golden, volume y all. No lee `.env`, no importa `src/lib/prisma.js` y no usa `DATABASE_URL` como alternativa.

La variable dedicada `URBANFIX_SEED_DATABASE_URL` debe identificar exactamente uno de estos destinos PostgreSQL. La lista explícita está en `prisma/seed/target.js`; no se permiten combinaciones cruzadas de sus puertos y bases.

| Host | Puerto | Base | Uso |
| --- | --- | --- | --- |
| `127.0.0.1` | `55432` | `urbanfix_s3_test` | Destino previo del runner; contiene fixtures de autenticación y queda excluido de esta integración. |
| `127.0.0.1` | `55433` | `urbanfix_seed_test` | Integridad, rollback y persistencia con commits independientes. |
| `127.0.0.1` | `55433` | `urbanfix_seed_concurrency_test` | Dos cargas concurrentes desde un catálogo vacío. |

Se permiten los protocolos `postgresql` y `postgres` y credenciales locales de prueba. No se admiten otros hosts, puertos, bases, parámetros de conexión, fragmentos, rutas alternativas ni espacios. `NODE_ENV=production` también se rechaza, pero no es la única protección. Mantener un destino en esta lista no autoriza ejecutar comandos sobre él.

La validación del modo, destino y CSV ocurre antes de cargar Prisma y construir el cliente. Dentro de la transacción, antes de consultar el catálogo, se verifican la pertenencia de `current_database()` a esa lista y `current_schema() = public`.

La base debe estar preparada previamente con las migraciones existentes. El runner no crea bases, contenedores ni tablas y no aplica migraciones. No hay destinos de preproducción o producción habilitados en CP2. No se deben configurar túneles o redirecciones hacia servicios externos en el puerto permitido: las guardas validan la dirección y la identidad declarada de la base, no la infraestructura detrás del puerto.

Solo después de autorizar la ejecución sobre esa base aislada, configurar `URBANFIX_SEED_DATABASE_URL` mediante el mecanismo local autorizado, sin registrar su valor ni agregar credenciales a Git. Para ejecutar desde la raíz del repositorio:

```powershell
npm.cmd run seed -- --mode=catalog
```

Este comando escribe exclusivamente los barrios faltantes en la base local autorizada. No debe ejecutarse durante una investigación de solo lectura. En este checkpoint de implementación no se ejecutó.

## Preservación, transacción y discrepancias

La carga utiliza una transacción `Serializable`, con espera máxima de 5 segundos y duración máxima de 10 segundos. Ejecuta una comprobación de identidad, una lectura de todos los barrios existentes con selección de `id` y `name` y, solo si faltan barrios, un único `createMany` con sus nombres. No hay consultas por fila ni operaciones de actualización o borrado.

Los nombres existentes deben coincidir exactamente con el catálogo. Si hay nombres ajenos o variantes, se aborta antes de insertar; no se renombra, normaliza, fusiona ni elimina nada. La salida informa `CATALOG_DISCREPANCY` y `unexpectedCount`, sin volcar valores de la base. Su análisis y cualquier corrección requieren una investigación y autorización separadas.

La carga completa y la carga parcial conservan los UUID y las relaciones existentes. La segunda ejecución no inserta ni modifica registros. No se usa `skipDuplicates` para ocultar conflictos. Si una ejecución concurrente o un error de base hace fallar la transacción, esta se revierte y el proceso termina con código 1; no hay reintentos automáticos.

La salida de éxito contiene únicamente `mode`, `existing`, `inserted` y `total`. Los errores públicos utilizan `SEED_FAILED`, una razón fija y, para discrepancias, su cantidad. No se imprimen conexiones, credenciales, errores internos, SQL ni stacks. El cliente se desconecta al terminar la operación, incluso cuando falla la transacción.

## Pruebas sin conexión a bases

Los tests nuevos usan `node:test`, mocks del cliente y ejecución del entrypoint en un contexto aislado con Prisma y filesystem simulados. Cubren validación del CSV, destinos, orden de inicialización, lotes, identidad, relaciones, idempotencia, rollback simulado y sanitización de errores.

Para ejecutar la suite completa segura en PowerShell, deshabilitar expresamente ambas familias de integración en ese proceso:

```powershell
$env:URBANFIX_RUN_DB_TESTS = '0'
$env:URBANFIX_RUN_SEED_DB_TESTS = '0'
npm.cmd test
```

Estos comandos no habilitan conexiones a bases; los casos PostgreSQL quedan omitidos. La suite existente también verifica HTTP en loopback con dependencias simuladas. No inicia el servidor de la aplicación contra una base.

## Integración PostgreSQL preparada, pendiente de autorización

`test/seed.integration.test.js` está deshabilitado por defecto y solo se habilita con `URBANFIX_RUN_SEED_DB_TESTS=1`. Antes de cargar Prisma o construir clientes, `validateSeedIntegrationOptions` exige ambas conexiones dedicadas:

- `URBANFIX_SEED_DATABASE_URL`: `127.0.0.1:55433/urbanfix_seed_test`.
- `URBANFIX_SEED_CONCURRENCY_DATABASE_URL`: `127.0.0.1:55433/urbanfix_seed_concurrency_test`.

La integración rechaza `urbanfix_s3_test`, intercambiar las bases y usar una misma base para ambos propósitos. No utiliza `DATABASE_URL` ni carga `.env`. Requiere las tablas existentes y ambas bases sin barrios ni usuarios. Si encuentra fixtures, falla sin limpiarlos. No ejecutar otras cargas o suites en paralelo sobre estas bases.

Los casos preparados son:

1. Integridad referencial, discrepancias y rollback después de un INSERT: mantienen las comprobaciones complementarias con transacciones revertidas.
2. Concurrencia: dos clientes ejecutan `seedCatalog` simultáneamente, con transacciones independientes. Debe confirmarse al menos una carga y el catálogo final debe contener exactamente los 48 nombres oficiales con UUID únicos. Puede que ambas cargas confirmen; también se admite un conflicto `P2034` o un `P2002` que identifique específicamente la unicidad de `Neighborhood.name`. Cualquier otro error se propaga. No se reintenta ninguna carga ni se exige que el scheduler produzca un conflicto en todas las ejecuciones.
3. Persistencia: se confirman primero un barrio y sus fixtures relacionados. La primera carga confirma los 47 barrios restantes. Otro cliente lee los registros ya confirmados. La segunda carga usa otra transacción efectiva y debe insertar cero filas. Se comparan todos los registros de usuarios, perfiles, especialidades, coberturas, solicitudes, ofertas y barrios, incluidos UUID y fechas.

Los dos últimos casos conservan sus commits para inspección. Por eso usan bases distintas: la prueba concurrente necesita comenzar vacía sin borrar lo confirmado por persistencia. Para repetir la suite se requiere un entorno desechable nuevo; no hay `deleteMany`, `TRUNCATE`, reset ni limpieza automática de filas.

Estas pruebas PostgreSQL no se ejecutaron durante los ajustes de Code Review. Solo las guardas se verificaron mediante RED → GREEN con mocks; no se afirma ese ciclo para las pruebas PostgreSQL pendientes.

### Propuesta de entorno desechable — comandos no ejecutados

Todos los pasos siguientes requieren autorización específica para preparar el entorno y ejecutar las pruebas reales. No están incluidos en la ejecución de tests seguros. No modifican `urbanfix_s3_test` ni sus fixtures.

Propuesta: un contenedor Linux `urbanfix-cp2-seed-postgres`, imagen `postgres:18`, publicación exclusiva en loopback `127.0.0.1:55433`, límite de 1 CPU y 512 MiB de RAM, y almacenamiento temporal `tmpfs` de 256 MiB. No monta directorios del host ni volúmenes persistentes. Registrar el ID/digest de la imagen usada para repetir el entorno; el tag de versión mayor puede cambiar. Docker, la imagen local, los recursos y la disponibilidad del puerto todavía no se verificaron. Los comandos usan Docker y PostgreSQL existentes, sin añadir dependencias al proyecto.

Para PostgreSQL 18 se monta `tmpfs` en `/var/lib/postgresql` y se fija explícitamente `PGDATA=/var/lib/postgresql/18/docker`. El montaje anterior en `/var/lib/postgresql/data` no corresponde al layout de la imagen 18. Montar el directorio padre cubre el directorio de datos versionado y evita depender de un volumen anónimo para los datos. La compatibilidad de esta configuración queda pendiente de verificar con el contenedor real mediante los comandos de inspección siguientes; no se arrancó PostgreSQL en esta revisión.

Primero comprobar Docker en modo Linux, la imagen local y que no se reutilice un contenedor o puerto existente:

```powershell
docker version
if ($LASTEXITCODE -ne 0) { throw 'Docker no está disponible' }
if ($env:DOCKER_HOST -or $env:DOCKER_CONTEXT) {
  throw 'Revisar overrides de Docker en una terminal dedicada antes de continuar'
}
$cp2DockerEndpoint = docker context inspect --format '{{.Endpoints.docker.Host}}'
if ($LASTEXITCODE -ne 0 -or $cp2DockerEndpoint -notmatch '^(npipe://|unix://)') {
  throw 'Se requiere un endpoint local de Docker, sin daemon TCP remoto'
}
$cp2DockerOs = docker info --format '{{.OSType}}'
if ($LASTEXITCODE -ne 0 -or $cp2DockerOs -ne 'linux') { throw 'Se requiere Docker en modo Linux' }
docker image inspect postgres:18 --format '{{.Id}}'
if ($LASTEXITCODE -ne 0) { throw 'Falta la imagen local; autorizar su descarga por separado' }
if (Get-NetTCPConnection -LocalPort 55433 -State Listen -ErrorAction SilentlyContinue) {
  throw 'El puerto 55433 ya está ocupado; no reutilizarlo'
}
$cp2ExistingContainers = @(docker ps -a --filter 'name=^/urbanfix-cp2-seed-postgres$' --format '{{.Names}}')
if ($LASTEXITCODE -ne 0 -or $cp2ExistingContainers.Count -ne 0) {
  throw 'No se pudo confirmar un nombre de contenedor libre'
}
```

Estos comandos consultan estado; no crean infraestructura. Si Docker no informa `linux`, detenerse. No cambiar el contexto de Docker automáticamente. La publicación en loopback no verifica la infraestructura detrás del puerto; no configurar túneles o redirecciones a otras bases.

Crear únicamente después de aprobar esos resultados. La contraseña se genera para este entorno local y no se imprime ni se guarda en archivos. Docker puede mostrarla a quien tenga acceso administrativo al contenedor; nunca reutilizar credenciales reales.

```powershell
$env:URBANFIX_CP2_TEST_PASSWORD = [guid]::NewGuid().ToString('N')
docker run --detach --rm --pull=never --name urbanfix-cp2-seed-postgres `
  --publish 127.0.0.1:55433:5432 --memory=512m --cpus=1 `
  --tmpfs /var/lib/postgresql:rw,size=256m `
  --env PGDATA=/var/lib/postgresql/18/docker `
  --env POSTGRES_USER=urbanfix_cp2 --env POSTGRES_DB=urbanfix_seed_test `
  --env "POSTGRES_PASSWORD=$env:URBANFIX_CP2_TEST_PASSWORD" postgres:18
if ($LASTEXITCODE -ne 0) { throw 'No se creó el contenedor aislado' }
docker exec urbanfix-cp2-seed-postgres pg_isready --username=urbanfix_cp2 --dbname=urbanfix_seed_test
docker inspect urbanfix-cp2-seed-postgres --format '{{json .HostConfig.Tmpfs}}'
docker exec urbanfix-cp2-seed-postgres sh -c 'if command -v findmnt >/dev/null 2>&1; then findmnt --mountpoint /var/lib/postgresql --output TARGET,FSTYPE,OPTIONS --noheadings; else cat /proc/self/mountinfo; fi'
docker exec urbanfix-cp2-seed-postgres printenv PGDATA
docker exec urbanfix-cp2-seed-postgres psql -X --username=urbanfix_cp2 --dbname=urbanfix_seed_test --tuples-only --no-align --command='SHOW data_directory;'
```

Este bloque crea y arranca PostgreSQL con la primera base. `--pull=never` impide descargas implícitas. Continuar únicamente cuando `pg_isready` confirme disponibilidad; si aún está iniciando, volver a comprobarlo sin ejecutar la preparación siguiente. `.HostConfig.Tmpfs` acredita la configuración esperada para `/var/lib/postgresql`; la ausencia de entradas en `.Mounts` no constituye un fallo por sí sola. Exigir como evidencia del montaje efectivo que `findmnt` indique exactamente `/var/lib/postgresql` con tipo `tmpfs`. Si `findmnt` no está disponible, localizar en `/proc/self/mountinfo` la entrada cuyo quinto campo sea `/var/lib/postgresql` y cuyo tipo de sistema de archivos, después del separador ` - `, sea `tmpfs`. Mantener la comprobación de que tanto `PGDATA` como `SHOW data_directory` indiquen `/var/lib/postgresql/18/docker`. Cualquier diferencia requiere detenerse e investigar, sin adaptar rutas automáticamente.

Crear la segunda base, todavía sin ejecutar migraciones:

```powershell
docker exec urbanfix-cp2-seed-postgres createdb --username=urbanfix_cp2 --owner=urbanfix_cp2 urbanfix_seed_concurrency_test
if ($LASTEXITCODE -ne 0) { throw 'No se creó la segunda base aislada' }
```

### Migraciones con Prisma y entorno de proceso aislado

Usar `prisma migrate deploy --config=prisma7.config.ts`, seguido de `prisma migrate status --config=prisma7.config.ts`, de forma independiente para cada base. No aplicar archivos SQL directamente. Los comandos escriben el esquema y el historial `_prisma_migrations`; no generan migraciones, no ejecutan seeds y no requieren una shadow database.

El config existente importa `dotenv/config`. Establecer únicamente `DATABASE_URL` no evitaría leer `.env`. La versión instalada de dotenv admite `DOTENV_CONFIG_PATH`: se dirige al dispositivo nulo de Node (`os.devNull`, en Windows `\\.\nul`) y se desactiva su salida informativa. No se crea un archivo alternativo ni se lee o modifica `.env`. No se cambia `prisma7.config.ts`.

El lanzador propuesto usa dos niveles de procesos: PowerShell inicia Node con una lista mínima de variables del sistema y la contraseña temporal; ese Node pasa `DATABASE_URL` solo a cada proceso Prisma. No modifica `$env:DATABASE_URL` de la terminal ni utiliza su valor existente. No hereda `NODE_OPTIONS`, `NODE_PATH`, overrides de dotenv, proxies, variables `PG*`, conexiones de Prisma ni otras URLs del entorno. Construye las dos URLs desde nombres fijos y valida cada una con las guardas existentes antes de iniciar Prisma, de modo que no toma una conexión de Neon o de autenticación por accidente. Se mantienen las precondiciones de Docker local y ausencia de túneles.

Ejecutar el bloque siguiente únicamente desde la raíz del repositorio, en la misma terminal dedicada de la creación, después de autorizar las migraciones. Es un comando documentado, no un archivo nuevo del proyecto:

```powershell
$cp2MigrationLauncher = @'
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { devNull } = require('node:os');
const { validateSeedOptions } = require('./prisma/seed/target');

const expected = [
  '20261112203952_init',
  '20261120_align_data_model_v2',
  '20261122_add_user_login_and_test_fields',
  '20261125_require_technician_phone',
];
const actual = fs.readdirSync('prisma/migrations', { withFileTypes: true })
  .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error('La lista de migraciones difiere de las cuatro revisadas');
}
const password = process.env.URBANFIX_CP2_TEST_PASSWORD;
if (!/^[0-9a-f]{32}$/.test(password || '')) {
  throw new Error('Falta la contraseña temporal generada para este contenedor');
}
const packageFile = require.resolve('prisma/package.json');
if (JSON.parse(fs.readFileSync(packageFile, 'utf8')).version !== '7.10.1') {
  throw new Error('La versión local de Prisma no coincide con la revisada');
}
const cli = path.join(path.dirname(packageFile), 'build', 'index.js');
const prismaRequire = createRequire(packageFile);
const engine = path.join(path.dirname(prismaRequire.resolve('@prisma/engines/package.json')),
  'schema-engine-windows.exe');
if (process.platform !== 'win32' || !fs.existsSync(cli) ||
    !fs.existsSync(engine) || fs.statSync(engine).size === 0) {
  throw new Error('Se requiere el CLI y motor Windows ya instalados; no descargar dependencias');
}
const baseEnv = {
  DOTENV_CONFIG_PATH: devNull,
  DOTENV_CONFIG_QUIET: 'true',
  CHECKPOINT_DISABLE: '1',
  PRISMA_HIDE_UPDATE_MESSAGE: '1',
  PRISMA_SCHEMA_ENGINE_BINARY: engine,
};
for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP']) {
  if (process.env[key]) baseEnv[key] = process.env[key];
}
for (const database of ['urbanfix_seed_test', 'urbanfix_seed_concurrency_test']) {
  const connectionString = `postgresql://urbanfix_cp2:${password}@127.0.0.1:55433/${database}`;
  validateSeedOptions({ args: ['--mode=catalog'], env: {
    NODE_ENV: 'test', URBANFIX_SEED_DATABASE_URL: connectionString,
  } });
  const migrationEnv = { ...baseEnv, DATABASE_URL: connectionString };
  for (const action of ['deploy', 'status']) {
    const result = spawnSync(process.execPath,
      [cli, 'migrate', action, '--config=prisma7.config.ts'], {
        cwd: process.cwd(), env: migrationEnv, stdio: 'inherit', windowsHide: true,
      });
    if (result.error || result.status !== 0) {
      throw new Error(`Falló migrate ${action} en ${database}; detenerse sin reset ni reintentos`);
    }
  }
}
'@
$cp2Start = New-Object System.Diagnostics.ProcessStartInfo
$cp2Start.FileName = (Get-Command node.exe -ErrorAction Stop).Source
$cp2Start.Arguments = '--input-type=commonjs'
$cp2Start.WorkingDirectory = (Get-Location).Path
$cp2Start.UseShellExecute = $false
$cp2Start.CreateNoWindow = $true
$cp2Start.RedirectStandardInput = $true
$cp2Start.EnvironmentVariables.Clear()
foreach ($cp2Key in @('SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP')) {
  $cp2Value = [Environment]::GetEnvironmentVariable($cp2Key, 'Process')
  if ($cp2Value) { $cp2Start.EnvironmentVariables[$cp2Key] = $cp2Value }
}
$cp2Start.EnvironmentVariables['URBANFIX_CP2_TEST_PASSWORD'] = $env:URBANFIX_CP2_TEST_PASSWORD
$cp2Process = [System.Diagnostics.Process]::Start($cp2Start)
try {
  $cp2ScriptBytes = [Text.Encoding]::UTF8.GetBytes($cp2MigrationLauncher)
  $cp2Process.StandardInput.BaseStream.Write($cp2ScriptBytes, 0, $cp2ScriptBytes.Length)
  $cp2Process.StandardInput.Close()
  $cp2Process.WaitForExit()
  if ($cp2Process.ExitCode -ne 0) { throw 'La preparación con Prisma no terminó correctamente' }
} finally {
  $cp2Process.Dispose()
}
```

Se utiliza directamente el CLI instalado, sin `npx`, instalaciones ni descargas implícitas. El motor local se comprueba y se indica explícitamente; se deshabilita el chequeo de actualizaciones. Las variables de conexión desaparecen con los procesos Prisma. El entorno principal conserva su `DATABASE_URL` sin leerlo ni sobrescribirlo. Un cambio de versión de Node, Prisma, dotenv o del config exige revisar este procedimiento antes de usarlo. El script no ejecuta `prisma generate`; requiere el cliente ya generado de la suite actual.

El despliegue no es atómico entre bases ni entre todas las migraciones: si falla, conservar el entorno para investigar, sin `migrate reset`, `migrate resolve` ni reintentos automáticos. Solo si ambas ejecuciones y sus `migrate status` terminan con código 0, verificar además las cuatro filas exitosas del historial en cada base:

```powershell
$cp2ExpectedMigrations = @(
  '20261112203952_init',
  '20261120_align_data_model_v2',
  '20261122_add_user_login_and_test_fields',
  '20261125_require_technician_phone'
)
$cp2ExpectedRows = $cp2ExpectedMigrations | ForEach-Object { '{0}|true' -f $_ }
$cp2AuditSql = @'
SELECT migration_name || '|' ||
  (finished_at IS NOT NULL AND rolled_back_at IS NULL AND applied_steps_count > 0)::text
FROM "_prisma_migrations"
ORDER BY migration_name;
'@
foreach ($cp2Database in @('urbanfix_seed_test', 'urbanfix_seed_concurrency_test')) {
  $cp2ActualRows = @(docker exec urbanfix-cp2-seed-postgres psql -X --username=urbanfix_cp2 `
    --dbname=$cp2Database --set=ON_ERROR_STOP=1 --tuples-only --no-align --command=$cp2AuditSql)
  if ($LASTEXITCODE -ne 0 -or ($cp2ActualRows -join "`n") -cne ($cp2ExpectedRows -join "`n")) {
    throw 'El historial no contiene exactamente las cuatro migraciones aplicadas correctamente'
  }
  Write-Output "$cp2Database`: cuatro migraciones verificadas en _prisma_migrations"
}
```

Esta comprobación es de solo lectura y exige exactamente cuatro nombres, todos con finalización, sin rollback y con pasos aplicados; también detecta filas adicionales o fallidas. Se realiza dentro del contenedor conocido por su socket local, sin usar conexiones del host. No sustituye una auditoría de drift del esquema. No ejecutar los tests de integración si esta comprobación o `migrate status` fallan.

Configurar las conexiones locales temporales y ejecutar solo esta integración:

```powershell
$env:URBANFIX_SEED_DATABASE_URL = 'postgresql://urbanfix_cp2:{0}@127.0.0.1:55433/urbanfix_seed_test' -f $env:URBANFIX_CP2_TEST_PASSWORD
$env:URBANFIX_SEED_CONCURRENCY_DATABASE_URL = 'postgresql://urbanfix_cp2:{0}@127.0.0.1:55433/urbanfix_seed_concurrency_test' -f $env:URBANFIX_CP2_TEST_PASSWORD
$env:URBANFIX_RUN_DB_TESTS = '0'
$env:URBANFIX_RUN_SEED_DB_TESTS = '1'
try {
  npm.cmd run test:seed:integration
  if ($LASTEXITCODE -ne 0) { throw 'La integración falló; conservar el entorno para investigar' }
} finally {
  $env:URBANFIX_RUN_SEED_DB_TESTS = '0'
}
```

Este bloque conecta y realiza escrituras, incluidos commits efectivos. Mantiene deshabilitada la integración de autenticación y vuelve a deshabilitar la del seed al terminar. No muestra valores de conexiones ni modifica `DATABASE_URL`. Debe usarse una terminal dedicada sin variables de estas pruebas previamente configuradas.

Después de revisar los resultados, el descarte requiere autorización porque destruye solo los datos de este contenedor temporal:

```powershell
docker stop urbanfix-cp2-seed-postgres
if ($LASTEXITCODE -ne 0) { throw 'No se confirmó el descarte del contenedor' }
Remove-Item Env:URBANFIX_CP2_TEST_PASSWORD -ErrorAction SilentlyContinue
Remove-Item Env:URBANFIX_SEED_DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:URBANFIX_SEED_CONCURRENCY_DATABASE_URL -ErrorAction SilentlyContinue
```

`--rm` y `tmpfs` descartan el contenedor y sus dos bases al detenerlo. No se elimina ningún contenedor o volumen existente ni se borran filas en otras bases. No ejecutar el descarte si hace falta conservar una ejecución fallida para investigar.

En Windows se usa `npm.cmd` para ejecutar el launcher disponible sin depender de la política de ejecución de `npm.ps1`. No es necesario modificar esa política.

No se añadieron dependencias. El proyecto no define comandos de lint, type checking ni build. La comprobación de sintaxis de JavaScript se realiza con `node --check`; la revisión de espacios y cambios, con `git diff --check` y `git status`.
