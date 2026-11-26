# Catálogo oficial de barrios — S4-05 CP2 y CP2.1

El modo `catalog` carga datos oficiales de referencia. Es independiente de los datasets ficticios golden y volumen. Ningún seed se ejecuta al importar sus módulos, iniciar la API o ejecutar migraciones.

## Fuente y validación

El CSV es un archivo de referencia proporcionado por el DA. Está versionado en `prisma/data/Barrios.csv`, conservando su nombre y contenido originales. Contiene datos oficiales de referencia, separados de los datasets ficticios.

SHA-256 de los bytes originales: `6c482b90dd3e81f6fb2b13b43f845b661291e9911ee888202167ed8d9f5bfa0e`.

Antes de construir el cliente Prisma se comprueban las columnas `id_barrio, Barrio, id_comuna`, los 48 registros, IDs únicos del 1 al 48, nombres únicos, campos completos y comunas entre 1 y 15. Una huella SHA-256 del contenido canónico verifica también los nombres y sus correspondencias con el archivo aprobado; no alcanza con tener 48 nombres distintos. La huella admite LF o CRLF y los espacios alrededor de los campos. El lector está limitado al formato simple del archivo original, sin campos entrecomillados ni comas internas.

`Barrio` se mapea a `Neighborhood.name` e `id_comuna` a `Neighborhood.comuna` como entero obligatorio. `id_barrio` se valida como parte de la fuente, pero no se persiste. Los UUID nuevos los genera Prisma. Una modificación del catálogo requiere revisar la fuente y su huella; no se actualizan automáticamente.

## Destino y ejecución

El runner exige exactamente `--mode=catalog`. Rechaza argumentos adicionales y los modos golden, volume y all. No lee `.env`, no importa `src/lib/prisma.js` y no usa `DATABASE_URL` como alternativa.

La variable dedicada `URBANFIX_SEED_DATABASE_URL` debe identificar exactamente uno de estos destinos PostgreSQL. La lista explícita está en `prisma/seed/target.js`; no se permiten combinaciones cruzadas de sus puertos y bases.

| Host        | Puerto  | Base                                  | Uso                                                                                                 |
| ----------- | ------- | ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `127.0.0.1` | `55432` | `urbanfix_s3_test`                    | Destino previo del runner; contiene fixtures de autenticación y queda excluido de esta integración. |
| `127.0.0.1` | `55433` | `urbanfix_seed_test`                  | Integración CP2: integridad, rollback y persistencia.                                               |
| `127.0.0.1` | `55433` | `urbanfix_seed_concurrency_test`      | Integración CP2: cargas concurrentes.                                                               |
| `127.0.0.1` | `55434` | `urbanfix_seed_cp21_test`             | Integración CP2.1: integridad, discrepancias, rollback y persistencia.                              |
| `127.0.0.1` | `55434` | `urbanfix_seed_cp21_concurrency_test` | Integración CP2.1: cargas concurrentes.                                                             |

Se permiten los protocolos `postgresql` y `postgres` y credenciales locales de prueba. No se admiten otros hosts, puertos, bases, parámetros de conexión, fragmentos, rutas alternativas ni espacios. `NODE_ENV=production` también se rechaza, pero no es la única protección. Mantener un destino en esta lista no autoriza ejecutar comandos sobre él.

La validación del modo, destino y CSV ocurre antes de cargar Prisma y construir el cliente. Dentro de la transacción, antes de consultar el catálogo, se verifican la pertenencia de `current_database()` a esa lista y `current_schema() = public`.

La base debe estar preparada previamente con las migraciones existentes. El runner no crea bases, contenedores ni tablas y no aplica migraciones. No hay destinos de preproducción o producción habilitados en CP2 ni CP2.1. No se deben configurar túneles o redirecciones hacia servicios externos en el puerto permitido: las guardas validan la dirección y la identidad declarada de la base, no la infraestructura detrás del puerto.

Solo después de autorizar la ejecución sobre esa base aislada, configurar `URBANFIX_SEED_DATABASE_URL` mediante el mecanismo local autorizado, sin registrar su valor ni agregar credenciales a Git. Para ejecutar desde la raíz del repositorio:

```powershell
npm.cmd run seed -- --mode=catalog
```

Este comando escribe exclusivamente los barrios faltantes en la base local autorizada. No debe ejecutarse durante una investigación de solo lectura. Durante la implementación de CP2.1 no se ejecutó este comando del runner.

## Preservación, transacción y discrepancias

La carga utiliza una transacción `Serializable`, con espera máxima de 5 segundos y duración máxima de 10 segundos. Ejecuta una comprobación de identidad, una lectura de todos los barrios existentes con selección de `id`, `name` y `comuna` y, solo si faltan barrios, un único `createMany` con sus nombres y comunas. No hay consultas por fila ni operaciones de actualización o borrado.

Los nombres y las comunas existentes deben coincidir exactamente con el catálogo oficial. Si hay nombres ajenos, variantes o comunas incorrectas, se aborta antes de insertar; no se renombra, normaliza, corrige, fusiona ni elimina nada. La salida informa `CATALOG_DISCREPANCY` y `unexpectedCount`, sin volcar valores de la base. Su análisis y cualquier corrección requieren una investigación y autorización separadas.

La carga completa y la carga parcial conservan los UUID y las relaciones existentes. La segunda ejecución no inserta ni modifica registros. No se usa `skipDuplicates` para ocultar conflictos. Si una ejecución concurrente o un error de base hace fallar la transacción, esta se revierte y el proceso termina con código 1; no hay reintentos automáticos.

La salida de éxito contiene únicamente `mode`, `existing`, `inserted` y `total`. Los errores públicos utilizan `SEED_FAILED`, una razón fija y, para discrepancias, su cantidad. No se imprimen conexiones, credenciales, errores internos, SQL ni stacks. El cliente se desconecta al terminar la operación, incluso cuando falla la transacción.

## Pruebas sin conexión a bases

Los tests nuevos usan `node:test`, mocks del cliente y ejecución del entrypoint en un contexto aislado con Prisma y filesystem simulados. Cubren validación del CSV, correspondencias barrio-comuna, destinos, orden de inicialización, lotes, identidad, relaciones, idempotencia, detección de discrepancias, rollback simulado y sanitización de errores.

Para ejecutar la suite completa segura en PowerShell, deshabilitar expresamente ambas familias de integración en ese proceso:

```powershell
$env:URBANFIX_RUN_DB_TESTS = '0'
$env:URBANFIX_RUN_SEED_DB_TESTS = '0'
npm.cmd test
```

Estos comandos no habilitan conexiones a bases; los casos PostgreSQL quedan omitidos. La suite existente también verifica HTTP en loopback con dependencias simuladas. No inicia el servidor de la aplicación contra una base.

## Integración PostgreSQL

`test/seed.integration.test.js` está deshabilitado por defecto y solo se habilita con `URBANFIX_RUN_SEED_DB_TESTS=1`. Antes de cargar Prisma o construir clientes, `validateSeedIntegrationOptions` exige ambas conexiones dedicadas y admite exclusivamente las siguientes parejas:

| Entorno | `URBANFIX_SEED_DATABASE_URL`              | `URBANFIX_SEED_CONCURRENCY_DATABASE_URL`              |
| ------- | ----------------------------------------- | ----------------------------------------------------- |
| CP2     | `127.0.0.1:55433/urbanfix_seed_test`      | `127.0.0.1:55433/urbanfix_seed_concurrency_test`      |
| CP2.1   | `127.0.0.1:55434/urbanfix_seed_cp21_test` | `127.0.0.1:55434/urbanfix_seed_cp21_concurrency_test` |

La integración rechaza `urbanfix_s3_test`, las combinaciones cruzadas entre entornos, el intercambio de bases y el uso de una misma base para ambos propósitos. No utiliza `DATABASE_URL` ni carga `.env`.

Requiere las cinco migraciones aplicadas y Prisma Client sincronizado con el esquema vigente. Ambas bases deben estar inicialmente vacías de registros de negocio. La suite comprueba explícitamente la ausencia de barrios y usuarios; durante la preparación del entorno se verifica además que las siete tablas de negocio estén vacías.

Si encuentra fixtures, falla sin limpiarlos. No ejecutar otras cargas o suites en paralelo sobre estas bases.

Las bases utilizadas en CP2 y en la verificación de la migración de CP2.1 deben conservarse intactas. Para ejecutar las pruebas actualizadas de CP2.1 se requiere un segundo contenedor aislado en el puerto `55434`, previa autorización.

Los casos preparados son:

1. Integridad referencial, discrepancias de nombres y comunas, y rollback después de un INSERT: mantienen las comprobaciones complementarias con transacciones revertidas.

2. Concurrencia: dos clientes ejecutan `seedCatalog` simultáneamente, con transacciones independientes. Debe confirmarse al menos una carga y el catálogo final debe contener exactamente las 48 correspondencias oficiales barrio-comuna con UUID únicos. Puede que ambas cargas confirmen; también se admite un conflicto `P2034` o un `P2002` que identifique específicamente la unicidad de `Neighborhood.name`. Cualquier otro error se propaga. No se reintenta ninguna carga ni se exige que el scheduler produzca un conflicto en todas las ejecuciones.

3. Persistencia: se confirman primero un barrio y sus fixtures relacionados. La primera carga confirma los 47 barrios restantes. Otro cliente lee los registros ya confirmados. La segunda carga usa otra transacción efectiva y debe insertar cero filas. Se comparan todos los registros de usuarios, perfiles, especialidades, coberturas, solicitudes, ofertas y barrios, incluidos UUID y fechas.

Los dos últimos casos conservan sus commits para inspección. Por eso usan bases distintas: la prueba concurrente necesita comenzar vacía sin borrar lo confirmado por persistencia. Para repetir la suite se requiere un entorno desechable nuevo; no hay `deleteMany`, `TRUNCATE`, reset ni limpieza automática de filas.

Las pruebas de integración PostgreSQL de CP2 se ejecutaron satisfactoriamente en un entorno aislado.

En CP2.1 se verificó la migración de `Neighborhood.comuna` sobre las dos bases existentes de CP2, conservando los registros, UUID, relaciones y fechas. Se comprobaron las 48 correspondencias oficiales barrio-comuna, las restricciones `NOT NULL` y `CHECK`, y el rollback de la migración ante un barrio desconocido en una tercera base aislada.

Las guardas de conexión se ampliaron mediante TDD para admitir exclusivamente los nuevos destinos de CP2.1, manteniendo las restricciones anteriores. Los 13 tests específicos de destinos fueron aprobados. La suite completa segura obtuvo 245 tests aprobados, cero fallidos y cuatro omitidos intencionalmente.

La integración PostgreSQL de CP2.1 se ejecutó satisfactoriamente en `urbanfix_seed_cp21_test` y `urbanfix_seed_cp21_concurrency_test`, dentro del contenedor aislado `urbanfix-cp21-seed-integration-postgres`, publicado exclusivamente en `127.0.0.1:55434`. Ambas bases comenzaron sin registros de negocio y con las cinco migraciones aplicadas e historial y checksums verificados. El runner informó siete tests aprobados —seis subtests y su test contenedor—, cero fallidos y cero omitidos. Se verificaron las 48 correspondencias oficiales barrio–comuna, las 15 comunas, la preservación de UUID y relaciones, la idempotencia, la concurrencia, el rechazo de discrepancias y el rollback. Los snapshots de datos, estructura e historial de las tres bases anteriores coincidieron exactamente antes y después de la integración. Ambos contenedores y sus bases se conservaron.

### Procedimiento de preparación de un entorno desechable

Todos los pasos siguientes requieren autorización específica para preparar el entorno y ejecutar las pruebas reales. No están incluidos en la ejecución de tests seguros.

La receta corresponde a un entorno nuevo y vacío. No debe repetirse sobre los contenedores y las bases conservados. La ejecución aprobada utilizó un proceso coordinador Node aislado, iniciado desde PowerShell, que mantuvo en memoria la contraseña y los snapshots durante los tres bloques consecutivos. Los fragmentos siguientes describen sus operaciones; no constituyen un nuevo lanzador completo.

El `try/finally` del coordinador abarcó todo el procedimiento, desde la captura de snapshots y la generación de la contraseña hasta las verificaciones finales, incluidos los fallos anteriores al runner. Al finalizar se descartaron los snapshots y las referencias a credenciales en memoria, se eliminaron las variables temporales de contraseña y conexión y se dejaron ambas guardas de integración en `0`. La limpieza no detuvo contenedores ni eliminó bases.

El contenedor `urbanfix-cp2-seed-postgres`, publicado en `127.0.0.1:55433`, conserva las tres bases utilizadas durante CP2 y la verificación de la migración de CP2.1. No debe detenerse, reiniciarse, eliminarse ni reutilizarse para las nuevas pruebas.

Para CP2.1 se prepara un segundo contenedor Linux `urbanfix-cp21-seed-integration-postgres`, con imagen local `postgres:18`, publicación exclusiva en loopback `127.0.0.1:55434`, límite de 1 CPU y 512 MiB de RAM, y almacenamiento temporal `tmpfs` de 256 MiB. No monta directorios del host ni volúmenes persistentes.

Registrar el ID/digest de la imagen utilizada. Docker, la imagen local, los recursos y la disponibilidad del nuevo puerto deben comprobarse antes de crear el entorno. No se añaden dependencias al proyecto.

Para PostgreSQL 18 se monta `tmpfs` en `/var/lib/postgresql` y se fija explícitamente `PGDATA=/var/lib/postgresql/18/docker`. El montaje anterior en `/var/lib/postgresql/data` no corresponde al layout de la imagen 18. Montar el directorio padre cubre el directorio de datos versionado y evita depender de un volumen anónimo para los datos. Esta configuración se verificó durante CP2 y debe comprobarse nuevamente si se prepara otro contenedor.

Primero comprobar Docker en modo Linux, la imagen local y que no se reutilice un contenedor o puerto existente:

```powershell
docker version
if ($LASTEXITCODE -ne 0) { throw 'Docker no está disponible' }
if ($env:DOCKER_HOST -or $env:DOCKER_CONTEXT) {
  throw 'Revisar overrides de Docker en una terminal dedicada antes de continuar'
}
$cp21DockerEndpoint = docker context inspect --format '{{.Endpoints.docker.Host}}'
if ($LASTEXITCODE -ne 0 -or $cp21DockerEndpoint -notmatch '^(npipe://|unix://)') {
  throw 'Se requiere un endpoint local de Docker, sin daemon TCP remoto'
}
$cp21DockerOs = docker info --format '{{.OSType}}'
if ($LASTEXITCODE -ne 0 -or $cp21DockerOs -ne 'linux') {
  throw 'Se requiere Docker en modo Linux'
}
docker image inspect postgres:18 --format '{{.Id}}'
if ($LASTEXITCODE -ne 0) {
  throw 'Falta la imagen local; autorizar su descarga por separado'
}
if (Get-NetTCPConnection -LocalPort 55434 -State Listen -ErrorAction SilentlyContinue) {
  throw 'El puerto 55434 ya está ocupado; no reutilizarlo'
}
$cp21ExistingContainers = @(docker ps -a --filter 'name=^/urbanfix-cp21-seed-integration-postgres$' --format '{{.Names}}')
if ($LASTEXITCODE -ne 0 -or $cp21ExistingContainers.Count -ne 0) {
  throw 'No se pudo confirmar un nombre de contenedor libre'
}
```

Estos comandos consultan estado; no crean infraestructura. Si Docker no informa `linux`, detenerse. No cambiar el contexto de Docker automáticamente. La publicación en loopback no verifica la infraestructura detrás del puerto; no configurar túneles o redirecciones a otras bases.

Antes de crear el contenedor, confirmar también los recursos disponibles y registrar los snapshots de solo lectura de las tres bases anteriores según el procedimiento de verificación indicado más abajo.

Crear únicamente después de aprobar esos resultados. La contraseña se genera para este entorno local y no se imprime ni se guarda en archivos. Docker puede mostrarla a quien tenga acceso administrativo al contenedor; nunca reutilizar credenciales reales.

La contraseña se generó dentro del coordinador mediante `crypto.randomBytes(16).toString('hex')` y se validó como hexadecimal de 32 caracteres. Docker recibió el valor exclusivamente en `POSTGRES_PASSWORD` del entorno de su proceso hijo, con una lista mínima de variables del sistema. El argumento fue literalmente `--env POSTGRES_PASSWORD`, sin expandir el secreto en la línea de comandos. El coordinador mantuvo la contraseña en una variable interna de Node y construyó las conexiones dedicadas en memoria, sin establecer la contraseña en el entorno de la terminal. Las salidas de los procesos hijos se filtraron para no revelar la contraseña.

Los argumentos de creación utilizados fueron:

```text
docker run --detach --rm --pull=never --name urbanfix-cp21-seed-integration-postgres
  --publish 127.0.0.1:55434:5432 --memory=512m --cpus=1
  --tmpfs /var/lib/postgresql:rw,size=256m
  --env PGDATA=/var/lib/postgresql/18/docker
  --env POSTGRES_USER=urbanfix_cp21 --env POSTGRES_DB=urbanfix_seed_cp21_test
  --env POSTGRES_PASSWORD postgres:18
```

Después de crear el contenedor se verificaron la configuración de aislamiento y el montaje efectivo, antes de las escrituras posteriores. Se realizó una espera inicial de cinco segundos y una única consulta de disponibilidad:

```powershell
docker exec urbanfix-cp21-seed-integration-postgres pg_isready --username=urbanfix_cp21 --dbname=urbanfix_seed_cp21_test
docker inspect urbanfix-cp21-seed-integration-postgres --format '{{json .HostConfig.Tmpfs}}'
docker exec urbanfix-cp21-seed-integration-postgres sh -c 'if command -v findmnt >/dev/null 2>&1; then findmnt --mountpoint /var/lib/postgresql --output TARGET,FSTYPE,OPTIONS --noheadings; else cat /proc/self/mountinfo; fi'
docker exec urbanfix-cp21-seed-integration-postgres printenv PGDATA
docker exec urbanfix-cp21-seed-integration-postgres psql -X --username=urbanfix_cp21 --dbname=urbanfix_seed_cp21_test --tuples-only --no-align --command='SHOW data_directory;'
```

La creación arranca PostgreSQL con la primera base. `--pull=never` impide descargas implícitas. Continuar únicamente cuando `pg_isready` confirme disponibilidad; ante un fallo, detenerse sin reintentos automáticos ni preparación adicional. `.HostConfig.Tmpfs` acredita la configuración esperada para `/var/lib/postgresql`; la ausencia de entradas en `.Mounts` no constituye un fallo por sí sola. Exigir como evidencia del montaje efectivo que `findmnt` indique exactamente `/var/lib/postgresql` con tipo `tmpfs`. Si `findmnt` no está disponible, localizar en `/proc/self/mountinfo` la entrada cuyo quinto campo sea `/var/lib/postgresql` y cuyo tipo de sistema de archivos, después del separador `-`, sea `tmpfs`. Mantener la comprobación de que tanto `PGDATA` como `SHOW data_directory` indiquen `/var/lib/postgresql/18/docker`. Cualquier diferencia requiere detenerse e investigar, sin adaptar rutas automáticamente.

Crear la segunda base, todavía sin ejecutar migraciones:

```powershell
docker exec urbanfix-cp21-seed-integration-postgres createdb --username=urbanfix_cp21 --owner=urbanfix_cp21 urbanfix_seed_cp21_concurrency_test
if ($LASTEXITCODE -ne 0) { throw 'No se creó la segunda base aislada' }
```

### Migraciones con Prisma y entorno de proceso aislado

Usar `prisma migrate deploy --config=prisma7.config.ts`, seguido de `prisma migrate status --config=prisma7.config.ts`, de forma independiente para cada base. No aplicar archivos SQL directamente. Los comandos escriben el esquema y el historial `_prisma_migrations`; no generan migraciones, no ejecutan seeds y no requieren una shadow database.

El config existente importa `dotenv/config`. Establecer únicamente `DATABASE_URL` no evitaría leer `.env`. La versión instalada de dotenv admite `DOTENV_CONFIG_PATH`: se dirige al dispositivo nulo de Node (`os.devNull`, en Windows `\\.\nul`) y se desactiva su salida informativa. No se crea un archivo alternativo ni se lee o modifica `.env`. No se cambia `prisma7.config.ts`.

El lanzador usa dos niveles de procesos: PowerShell inicia Node con una lista mínima de variables del sistema y la contraseña temporal; ese Node pasa `DATABASE_URL` solo a cada proceso Prisma. No modifica `$env:DATABASE_URL` de la terminal ni utiliza su valor existente. No hereda `NODE_OPTIONS`, `NODE_PATH`, overrides de dotenv, proxies, variables `PG*`, conexiones de Prisma ni otras URLs del entorno. Construye las dos URLs desde nombres fijos y valida cada una con las guardas existentes antes de iniciar Prisma, de modo que no toma una conexión de Neon o de autenticación por accidente. Se mantienen las precondiciones de Docker local y ausencia de túneles.

El bloque siguiente es un ejemplo alternativo de lanzador aislado de migraciones, que requiere proporcionar previamente URBANFIX_CP21_TEST_PASSWORD mediante un mecanismo autorizado. No corresponde al coordinador utilizado durante la ejecución de CP2.1. No debe ejecutarse sobre las bases conservadas.

```powershell
$cp21MigrationLauncher = @'
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
  '20261126_add_neighborhood_commune',
];
const actual = fs.readdirSync('prisma/migrations', { withFileTypes: true })
  .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error('La lista de migraciones difiere de las cinco revisadas');
}
const password = process.env.URBANFIX_CP21_TEST_PASSWORD;
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
for (const database of ['urbanfix_seed_cp21_test', 'urbanfix_seed_cp21_concurrency_test']) {
  const connectionString = `postgresql://urbanfix_cp21:${password}@127.0.0.1:55434/${database}`;
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
$cp21Start = New-Object System.Diagnostics.ProcessStartInfo
$cp21Start.FileName = (Get-Command node.exe -ErrorAction Stop).Source
$cp21Start.Arguments = '--input-type=commonjs'
$cp21Start.WorkingDirectory = (Get-Location).Path
$cp21Start.UseShellExecute = $false
$cp21Start.CreateNoWindow = $true
$cp21Start.RedirectStandardInput = $true
$cp21Start.EnvironmentVariables.Clear()
foreach ($cp21Key in @('SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP')) {
  $cp21Value = [Environment]::GetEnvironmentVariable($cp21Key, 'Process')
  if ($cp21Value) { $cp21Start.EnvironmentVariables[$cp21Key] = $cp21Value }
}
$cp21Start.EnvironmentVariables['URBANFIX_CP21_TEST_PASSWORD'] = $env:URBANFIX_CP21_TEST_PASSWORD
$cp21Process = [System.Diagnostics.Process]::Start($cp21Start)
try {
  $cp21ScriptBytes = [Text.Encoding]::UTF8.GetBytes($cp21MigrationLauncher)
  $cp21Process.StandardInput.BaseStream.Write($cp21ScriptBytes, 0, $cp21ScriptBytes.Length)
  $cp21Process.StandardInput.Close()
  $cp21Process.WaitForExit()
  if ($cp21Process.ExitCode -ne 0) {
    throw 'La preparación con Prisma no terminó correctamente'
  }
} finally {
  $cp21Process.Dispose()
}
```

Se utiliza directamente el CLI instalado, sin `npx`, instalaciones ni descargas implícitas. El motor local se comprueba y se indica explícitamente; se deshabilita el chequeo de actualizaciones. Las variables de conexión desaparecen con los procesos Prisma. El entorno principal conserva su `DATABASE_URL` sin leerlo ni sobrescribirlo. Un cambio de versión de Node, Prisma, dotenv o del config exige revisar este procedimiento antes de usarlo.

El script no ejecuta `prisma generate`. Las pruebas de integración requieren un cliente Prisma previamente generado y sincronizado con la versión actual de `schema.prisma`, incluido el atributo `Neighborhood.comuna`.

El despliegue no es atómico entre bases ni entre todas las migraciones: si falla, conservar el entorno para investigar, sin `migrate reset`, `migrate resolve` ni reintentos automáticos. Solo si ambas ejecuciones y sus `migrate status` terminan con código 0, verificar además las cinco filas exitosas del historial en cada base:

```powershell
$cp21ExpectedMigrations = @(
  '20261112203952_init',
  '20261120_align_data_model_v2',
  '20261122_add_user_login_and_test_fields',
  '20261125_require_technician_phone',
  '20261126_add_neighborhood_commune'
)
$cp21ExpectedRows = $cp21ExpectedMigrations | ForEach-Object { '{0}|true' -f $_ }
$cp21AuditSql = @'
SELECT migration_name || '|' ||
  (finished_at IS NOT NULL AND rolled_back_at IS NULL AND applied_steps_count > 0)::text
FROM "_prisma_migrations"
ORDER BY migration_name;
'@
foreach ($cp21Database in @('urbanfix_seed_cp21_test', 'urbanfix_seed_cp21_concurrency_test')) {
  $cp21ActualRows = @(docker exec urbanfix-cp21-seed-integration-postgres psql -X --username=urbanfix_cp21 `
    --dbname=$cp21Database --set=ON_ERROR_STOP=1 --tuples-only --no-align --command=$cp21AuditSql)
  if ($LASTEXITCODE -ne 0 -or ($cp21ActualRows -join "`n") -cne ($cp21ExpectedRows -join "`n")) {
    throw 'El historial no contiene exactamente las cinco migraciones aplicadas correctamente'
  }
  Write-Output "$cp21Database`: cinco migraciones verificadas en _prisma_migrations"
}
```

Esta comprobación es de solo lectura y exige exactamente cinco nombres, todos con finalización, sin rollback y con pasos aplicados; también detecta filas adicionales o fallidas. Se realiza dentro del contenedor conocido por su socket local, sin usar conexiones del host. No sustituye una auditoría de drift del esquema. No ejecutar los tests de integración si esta comprobación o `migrate status` fallan.

Antes de habilitar la integración, verificar que los checksums de las cinco migraciones coincidan con los archivos de migración del repositorio y que las siete tablas de negocio estén vacías en ambas bases nuevas: `User`, `Technician`, `TechnicianSpecialty`, `Neighborhood`, `TechnicianNeighborhood`, `ServiceRequest` y `ServiceOffer`.

Registrar snapshots de solo lectura de los datos, estructura e historial de migraciones de las tres bases anteriores antes de preparar el nuevo entorno y compararlos después de la integración. Mantener los snapshots en memoria, sin exponer datos ni credenciales.

No ejecutar un seed previo ni limpiar registros para satisfacer las precondiciones de la suite.

La integración se ejecutó mediante un proceso hijo `cmd.exe` con entorno mínimo, sin heredar conexiones, variables `PG*`, `NODE_OPTIONS`, `NODE_PATH` ni overrides de dotenv. El coordinador construyó en memoria las dos conexiones locales y validó la pareja completa mediante `validateSeedIntegrationOptions` antes de iniciar el proceso. Solo se proporcionaron las variables del sistema necesarias y estas opciones:

- `URBANFIX_SEED_DATABASE_URL`: conexión dedicada a `127.0.0.1:55434/urbanfix_seed_cp21_test`.
- `URBANFIX_SEED_CONCURRENCY_DATABASE_URL`: conexión dedicada a `127.0.0.1:55434/urbanfix_seed_cp21_concurrency_test`.
- `URBANFIX_RUN_DB_TESTS=0` y `URBANFIX_RUN_SEED_DB_TESTS=1`.
- npm en modo offline, con update notifier deshabilitado, `logs_max=0`, `audit=false` y `fund=false`.

El único comando de tests ejecutado en ese proceso fue:

```text
npm.cmd run test:seed:integration
```

Este comando conecta y realiza escrituras, incluidos commits efectivos. Se mantuvo deshabilitada la integración de autenticación y no se utilizó `DATABASE_URL` como fallback. La limpieza global mediante `finally` también cubrió cualquier fallo de creación, migraciones, verificación o tests, sin reintentos ni correcciones automáticas.

Después de revisar los resultados, el descarte requiere autorización porque destruye solo los datos de este contenedor temporal:

**Descarte no ejecutado. Ambos contenedores y todas sus bases deben conservarse.** El bloque siguiente queda fuera del cierre aprobado y requiere una autorización específica posterior.

```powershell
docker stop urbanfix-cp21-seed-integration-postgres
if ($LASTEXITCODE -ne 0) {
  throw 'No se confirmó el descarte del contenedor'
}
Remove-Item Env:URBANFIX_CP21_TEST_PASSWORD -ErrorAction SilentlyContinue
Remove-Item Env:URBANFIX_SEED_DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:URBANFIX_SEED_CONCURRENCY_DATABASE_URL -ErrorAction SilentlyContinue
```

`--rm` y `tmpfs` descartan el contenedor CP2.1 y sus dos bases al detenerlo. Esta operación requiere autorización específica después de revisar los resultados. No debe afectar al contenedor CP2 anterior ni a sus tres bases. No ejecutar el descarte si hace falta conservar los resultados o investigar una ejecución fallida.

En Windows se usa `npm.cmd` para ejecutar el launcher disponible sin depender de la política de ejecución de `npm.ps1`. No es necesario modificar esa política.

No se añadieron dependencias. El proyecto no define comandos de lint, type checking ni build. La comprobación de sintaxis de JavaScript se realiza con `node --check`; la revisión de espacios y cambios, con `git diff --check` y `git status`.
