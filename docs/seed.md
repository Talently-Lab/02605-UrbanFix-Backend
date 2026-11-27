# Catálogo oficial de barrios, Golden y Volumen — S4-05 CP2 a CP5

Estado vigente: CP5 completado, **LISTO PARA REVISIÓN**. Golden y Volumen están persistidos en el entorno local exclusivo de CP5. La infraestructura temporal de CP2/CP2.1 ya no está disponible; sus resultados se conservan como evidencias históricas. Ver el registro de CP5 al final de este documento antes de utilizar instrucciones de infraestructura.

El modo `catalog` carga datos oficiales de referencia. Es independiente de los datasets ficticios golden y volumen. Ningún seed se ejecuta al importar sus módulos, iniciar la API o ejecutar migraciones.

## Fuente y validación

El CSV es un archivo de referencia proporcionado por el DA. Está versionado en `prisma/data/Barrios.csv`, conservando su nombre y contenido originales. Contiene datos oficiales de referencia, separados de los datasets ficticios.

SHA-256 de los bytes originales: `6c482b90dd3e81f6fb2b13b43f845b661291e9911ee888202167ed8d9f5bfa0e`.

Antes de construir el cliente Prisma se comprueban las columnas `id_barrio, Barrio, id_comuna`, los 48 registros, IDs únicos del 1 al 48, nombres únicos, campos completos y comunas entre 1 y 15. Una huella SHA-256 del contenido canónico verifica también los nombres y sus correspondencias con el archivo aprobado; no alcanza con tener 48 nombres distintos. La huella admite LF o CRLF y los espacios alrededor de los campos. El lector está limitado al formato simple del archivo original, sin campos entrecomillados ni comas internas.

`Barrio` se mapea a `Neighborhood.name` e `id_comuna` a `Neighborhood.comuna` como entero obligatorio. `id_barrio` se valida como parte de la fuente, pero no se persiste. Los UUID nuevos los genera Prisma. Una modificación del catálogo requiere revisar la fuente y su huella; no se actualizan automáticamente.

## Destino y ejecución

El runner exige exactamente `--mode=catalog`, `--mode=golden` o `--mode=volume`. Rechaza argumentos adicionales y el modo all. No lee `.env`, no importa `src/lib/prisma.js` y no usa `DATABASE_URL` como alternativa. Golden y Volumen solo admiten sus respectivas bases exclusivas, sin cruces entre datasets ni escrituras ficticias sobre los destinos conservados del catálogo.

La variable dedicada `URBANFIX_SEED_DATABASE_URL` debe identificar exactamente uno de estos destinos PostgreSQL. La lista explícita está en `prisma/seed/target.js`; no se permiten combinaciones cruzadas de sus puertos y bases.

| Host        | Puerto  | Base                                  | Uso                                                                                                 |
| ----------- | ------- | ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `127.0.0.1` | `55432` | `urbanfix_s3_test`                    | Destino previo del runner; contiene fixtures de autenticación y queda excluido de esta integración. |
| `127.0.0.1` | `55433` | `urbanfix_seed_test`                  | Integración CP2: integridad, rollback y persistencia.                                               |
| `127.0.0.1` | `55433` | `urbanfix_seed_concurrency_test`      | Integración CP2: cargas concurrentes.                                                               |
| `127.0.0.1` | `55434` | `urbanfix_seed_cp21_test`             | Integración CP2.1: integridad, discrepancias, rollback y persistencia.                              |
| `127.0.0.1` | `55434` | `urbanfix_seed_cp21_concurrency_test` | Integración CP2.1: cargas concurrentes.                                                             |
| `127.0.0.1` | `55434` | `urbanfix_seed_cp3_golden_test`       | Golden persistido y verificado en CP5; conservar, no repetir integración sobre esta base poblada.     |
| `127.0.0.1` | `55434` | `urbanfix_seed_cp4_volume_test`       | Volumen persistido y verificado en CP5; conservar, no repetir integración sobre esta base poblada.    |

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

## CP3 — Golden

### Contrato y datos

Fuente funcional: `UrbanFix_-_Escenarios_de_datos_ficticios_para_mtricas_y_Data_QA_Seed_v1.md` del DA, contrastada con la matriz de reglas aprobadas, el catálogo v0.5, las decisiones posteriores y QA V3. La matriz y las decisiones confirmadas tienen prioridad sobre propuestas o texto desactualizado de los demás documentos.

`prisma/data/golden.js` define 17 usuarios (A1, C1–C7 y T1–T9), 9 perfiles técnicos, 13 especialidades, 19 coberturas, 18 solicitudes (G01–G18) y 20 ofertas (O01–O20). Los UUID son explícitos y estables. Los sufijos numéricos de los UUID de solicitudes y ofertas corresponden a sus códigos G/O. El total insertable es 96 registros en seis tablas; el catálogo de 48 barrios permanece independiente.

La referencia fija es `R = 2026-12-07T15:00:00.000Z`. Golden usa fechas absolutas UTC con milisegundos, incluido `updatedAt`, sin depender del reloj de ejecución. Las fechas futuras respecto de R están prohibidas para hechos ocurridos; `expiresAt` es un plazo y puede ser posterior: O14 vence el 08/12 a las 10:00 UTC. Las consultas de comprobación usan R en lugar de NOW(); no se modifica el reloj de la aplicación. Volumen no está implementado en CP3 y utilizará fechas relativas por separado.

C7 y T9 tienen `isTestUser=true`; los otros 15 usuarios simulan tráfico real y tienen `false`. G18/O20 se persisten, pero se excluyen de los resultados analíticos de datos limpios, que conservan las 17 solicitudes y 19 ofertas originales. ADMIN mantiene teléfono nulo; CLIENT y TECHNICIAN tienen teléfono obligatorio. La indicación antigua de teléfono nulo para TECHNICIAN en Seed v1 y QA V3 no se aplica.

Los emails ficticios usan exclusivamente `urbanfix.golden.<código>@example.com`, sin ocupar los emails reservados en los casos QA. Las contraseñas son únicamente de prueba local: `UrbanFixGolden2026!`, almacenada como hash bcrypt de costo 10 reproducible, sin contraseñas en claro en las tablas ni en las salidas. `lastLoginAt` queda nulo. Las direcciones, teléfonos y matrículas son ficticios. T6–T8 reciben una cobertura auxiliar en Palermo para completar sus perfiles; sus estados no operativos se conservan, sin cambiar los resultados DA.

### Resultados de referencia y diferencias documentales

Se conservan las dos variantes explícitas de moderación de Seed v1, sin aprobar una definición de indicador por implementar el seed:

| Comprobación   | Con exclusión de moderación | Sin exclusión |
| -------------- | --------------------------- | ------------- |
| Cohorte madura | 13                          | 14            |
| KPI 1          | 76,92 %                     | 71,43 %       |
| Liquidez 2 h   | 30,77 %                     | 28,57 %       |
| Liquidez 24 h  | 69,23 %                     | 64,29 %       |

La mediana es 150,5 minutos y el P90, 1451,1 minutos. La demanda reciente es 15, los técnicos activos del resultado DA son 5 y el ratio es 3,00. La tabla DA de respuesta de ofertas se conserva como 10 ACCEPTED de 13 ofertas elegibles, 76,92 %. Los tests verifican también los desgloses de demanda por categoría, barrio, horario y estado de Semana 5, sin agregar consultas productivas ni modificar indicadores.

Seed v1 presenta una contradicción en KPI 3: su tabla de resultados cuenta a T4 por el rechazo O06 y espera cinco técnicos; una nota final indica contar solo aceptaciones. Los documentos aportados de Métricas Core y Arquitectura son v2, aunque Seed v1 referencia v3. Se preserva expresamente el resultado Golden de cinco técnicos y no se adopta la consulta antigua ni se resuelve la definición productiva. G16 permanece en el dataset para verificar ambas variantes de moderación.

F01–F12 de Semana 5 son una propuesta de telemetría con captura pendiente, fuera de este seed transaccional. No se agregan AnalyticsEvent, respondedAt, startedAt ni escenarios de suspensión con trabajos activos.

### Carga y seguridad

El único destino Golden es `127.0.0.1:55434/urbanfix_seed_cp3_golden_test`, con protocolos `postgresql` o `postgres` y conexión dedicada en `URBANFIX_SEED_DATABASE_URL`. También se admite allí `--mode=catalog` exclusivamente para preparar el catálogo independiente. Las parejas de integración CP2 y CP2.1 conservan sus restricciones anteriores. Golden rechaza las bases conservadas, producción, destinos remotos, puertos cruzados, parámetros y el fallback a `DATABASE_URL`.

Antes de construir Prisma se validan modo, destino, CSV y dataset. La validación Golden comprueba cantidades, identidades, referencias, roles, teléfonos, matrículas, cobertura, estados y coherencia temporal. Comprueba que no haya trabajos superpuestos ni ofertas emitidas durante un trabajo activo y conserva el caso PENDING ya vencido O11. La ausencia de startedAt impide reconstruir el instante de inicio de trabajos; no se inventa ese hecho.

`prisma/seed/golden.js` utiliza una transacción `Serializable` con espera máxima de 5 segundos y duración máxima de 10 segundos. Verifica la identidad exacta de la base y el esquema public, lee y verifica los 48 barrios oficiales, y resuelve sus UUID existentes. Después realiza una lectura por cada una de las seis tablas y prepara todos los lotes antes de escribir. Inserta usuarios, técnicos, especialidades, coberturas, solicitudes y ofertas, en ese orden, con hasta un `createMany` por tabla. No hay consultas por registro, actualizaciones, borrados, `skipDuplicates` ni reintentos automáticos.

Una carga parcial compatible inserta solo los faltantes. Los registros ya presentes deben coincidir en todos los campos persistidos; una colisión de UUID, email sin distinguir mayúsculas, perfil técnico o clave compuesta aborta sin modificar datos. No se adopta una identidad diferente por coincidir el email. Los registros ajenos se conservan. Una segunda carga informa `existing=96`, `inserted=0`, `total=96`, sin ejecutar INSERT. La salida contiene solo modo y cantidades; los fallos usan el error público sanitizado del runner.

Solo después de autorizar y verificar el entorno aislado correspondiente:

```text
npm.cmd run seed -- --mode=golden
```

Este comando no fue ejecutado durante CP3. No crea infraestructura, aplica migraciones ni carga el catálogo automáticamente. No ejecutar datasets ficticios en producción.

### Pruebas ejecutadas y pendientes

Se aplicó TDD por bloques de contrato/seguridad, validación del dataset y carga transaccional. Los tests con `node:test` y mocks cubren el contrato DA, sus resultados con R fijo, las guardas, lotes, cargas parciales, colisiones, preservación de identidades y datos ajenos, idempotencia y rollback simulado ante fallos en cada tabla o en el commit. Los 35 tests específicos quedaron aprobados. La suite segura, ejecutada con `URBANFIX_RUN_DB_TESTS=0` y `URBANFIX_RUN_SEED_DB_TESTS=0`, obtuvo 264 tests: 259 aprobados, cero fallidos y cinco omitidos intencionalmente. Las pruebas PostgreSQL permanecen pendientes de CP5; no se afirma RED/GREEN sobre PostgreSQL real. La sintaxis de los ocho archivos JavaScript creados o modificados y `git diff --check` también se verificaron satisfactoriamente.

`test/seed.golden.integration.test.js` queda preparado para CP5 y no fue ejecutado. Su comando específico es:

```text
npm.cmd run test:seed:golden:integration
```

Requiere `URBANFIX_RUN_SEED_DB_TESTS=1`, la conexión dedicada al destino Golden, las cinco migraciones aplicadas, Prisma Client sincronizado, catálogo oficial completo y las seis tablas ficticias inicialmente vacías. Valida la guarda antes de construir clientes. Prepara rollback real, conservación de un usuario ajeno, rechazo de colisiones, concurrencia, persistencia con commits independientes, comparación completa de registros y comprobaciones SQL de cohortes y percentiles. Solo admite P2034 como conflicto de serialización esperado en concurrencia; otros errores se informan, sin reintentos.

La preparación y ejecución reales de Golden y Volumen se agrupan en CP5, previa autorización. La propuesta es crear una nueva base exclusiva dentro del contenedor CP2.1 existente, sin otro contenedor. Antes de escribir se verificarán destino, recursos y aislamiento, y se capturarán snapshots de solo lectura de todas las bases conservadas para compararlos al finalizar. La creación de la base y su utilización no están autorizadas por la implementación de CP3. No se ejecutaron operaciones PostgreSQL, Docker, Neon ni Render.

### Criterio obligatorio de cierre S4-06 — QA V3

Durante S4-06 se revisarán los 64 casos completos del Plan de Pruebas QA V3 contra código, restricciones de base de datos, aserciones efectivas de los tests y reglas de negocio aprobadas. Esta revisión no se ejecuta en CP3. La existencia de tests generales no acredita cobertura de un caso y no se duplicarán pruebas que ya cubran efectivamente el requisito.

Se prestará especial atención a REG-002/012 (unicidad entre roles), REG-004/015/016 (contraseñas y límites), REG-013/014/026 (roles y campos internos), REG-017/033 y LOG-011 (email), REG-018/032 (matrícula), REG-019/021/022 (especialidades, barrios y duplicados), REG-020 (datos sensibles), LOG-010/014 (credenciales y orden de validación), ACC-003/004/007/008 (JWT, expiración, suspensión y HTTP) y CAT-001/002 (catálogos públicos y contenido).

Cada caso se clasificará como: implementado y probado; implementado con cobertura insuficiente; no implementado, pero aprobado y perteneciente al Sprint 4; correspondiente a un sprint posterior; o contradictorio/pendiente de definición funcional. Los requisitos aprobados que realmente falten deberán incorporarse al cierre del Sprint 4, previa autorización y mediante TDD cuando corresponda. No se modifica ahora el Plan QA externo ni se amplía CP3.

## CP4 — Dataset Volumen

### Referencia y contrato reproducible

La fuente es la sección Dataset 2 de Seed v1 del DA, con las reglas aprobadas y las decisiones posteriores. La coherencia referencial y temporal, disponibilidad histórica, especialidades, matrículas, cobertura y autorizaciones son obligatorias. Los porcentajes del DA son objetivos orientativos; no se alteran reglas ni definiciones de indicadores para alcanzarlos.

`prisma/data/volume.js` genera 62 usuarios (45 CLIENT, 15 TECHNICIAN y 2 ADMIN), 15 perfiles, 43 especialidades, 135 coberturas, 200 solicitudes y 240 ofertas. Son 695 registros persistibles en seis tablas; los 48 barrios oficiales son una precondición independiente. Los técnicos incluyen 11 APPROVED/ACTIVE, 2 PENDING/ACTIVE, 1 REJECTED/ACTIVE y 1 APPROVED/SUSPENDED sin ofertas ni trabajos. Hay siete clientes sin solicitudes y 38 con actividad, incluidos los dos clientes de prueba.

La variable dedicada `URBANFIX_SEED_REFERENCE_TIME` es obligatoria para Volumen. Debe ser un instante ISO UTC canónico con milisegundos que corresponda a lunes 00:00 de Buenos Aires (03:00 UTC), por ejemplo `2026-12-07T03:00:00.000Z`. No se toma NOW(), Date.now() ni una referencia implícita. Esta alineación permite cinco semanas completas: 25, 35, 45, 55 y 40 solicitudes, desde D−35 días hasta D−1 hora, con cortes de lunes en Argentina. Los usuarios se crean entre D−42 y D−1 días.

La misma D produce exactamente los mismos UUID, relaciones, fechas, hashes y distribuciones. Cambiar D una semana desplaza las fechas siete días y conserva las identidades; no autoriza reanclar filas existentes: la carga detecta las diferencias y aborta. Una nueva referencia necesita una base nueva autorizada. Se usa un mezclado determinista con semilla fija y una agenda conservadora por técnico. Si no hay capacidad, se desplaza la creación dentro del horario permitido y de la misma semana; las ofertas abiertas reservan capacidad hasta su resolución o vencimiento. T10 participa en los ocho escenarios controlados de liberación por D-029 y luego vuelve al conjunto de asignación general. No hay reintentos de transacciones.

Una calibración final determinista adelanta exactamente nueve aceptaciones de solicitudes maduras limpias COMPLETED, con una sola oferta inicial, a createdAt + 2 h. Se contabiliza el límite mediante <= 2 h, conforme a DA. Conserva las finalizaciones y updatedAt. También define diez rechazos en solicitudes PENDING sin reoferta que antes representaban vencimientos. Las fechas de creación y expiresAt permanecen intactas, con vigencia de 24 h; el ajuste se realiza sobre el fixture antes de persistir, sin modificar ofertas vencidas en la base. El modelo no tiene respondedAt: los tests comprueban un instante posible de rechazo un minuto después de crear la oferta, anterior a su vencimiento y sin trabajo activo. La agenda conservadora original se mantiene, sin introducir dispensas de disponibilidad. Una huella de regresión verifica que el resto de los campos no cambie.

Las tres cuentas de prueba son C44, C45 y T11 de Volumen. Están incluidas en las cantidades anteriores y tienen `isTestUser=true`; las demás tienen `false`. Las diez solicitudes de C44/C45 se dirigen exclusivamente a T11 y están incluidas en las 200. Al excluirlas quedan 190 solicitudes y 230 ofertas. Los emails usan `urbanfix.volume.<código>@example.com`, separados de Golden y de los emails QA reservados. Todos los clientes y técnicos tienen teléfono; ADMIN conserva null. La contraseña pública de prueba local es `UrbanFixVolume2026!`, persistida únicamente como hash bcrypt reproducible de costo 10. No reutilizar estas credenciales fuera del entorno ficticio aislado.

### Distribuciones obtenidas y denominadores

Estos resultados describen el fixture para cualquier D admitida, no crean consultas productivas ni resuelven indicadores pendientes. Para las tasas de madurez se usan las solicitudes de los 35 días con createdAt < D−24 h, excluyendo clientes de prueba, sin excluir moderaciones: n = 188. No es la cohorte de ocho días de los KPIs de Golden. Si se aplica además la variante de exclusión de moderación, la población baja a 183; se conservan ambos tratamientos sin elegir una definición productiva.

| Distribución                                   | Resultado y denominador         | Objetivo DA y desviación                                      |
| ---------------------------------------------- | ------------------------------- | ------------------------------------------------------------- |
| Solicitudes por semana                         | 25/35/45/55/40; total 200       | Coincide con la propuesta                                     |
| Aceptadas alguna vez, maduras limpias          | 137/188 = 72,87 %               | 70–75 %; dentro del rango                                     |
| Aceptadas en hasta 2 h, maduras limpias        | 57/188 = 30,32 %                | 30–40 %; dentro del rango                                     |
| Aceptadas en hasta 24 h, maduras limpias       | 121/188 = 64,36 %               | 60–70 %; dentro del rango                                     |
| Mediana de espera de aceptadas maduras limpias | 150 minutos; n = 137 aceptadas  | Cerca de 2,5 h; coincide                                      |
| Canceladas antes de aceptar, maduras limpias   | 25/188 = 13,30 %                | Cerca de 10 %; +3,30 puntos                                   |
| Autor de esas 25 cancelaciones                 | 20 CLIENT y 5 ADMIN: 80/20 %    | Coincide; cumple al menos cinco de Admin                      |
| Canceladas tras aceptar, maduras limpias       | 6/188 = 3,19 %, todas por Admin | Cerca de 3 %; +0,19 puntos                                    |
| PENDING sin asignación y con más de 24 h       | 26/188 = 13,83 %                | Cerca de 15 %; −1,17 puntos                                   |
| Solicitudes maduras limpias con reoferta       | 40/188 = 21,28 %                | Cerca de 20 %; +1,28 puntos; sobre total bruto: 40/200 = 20 % |
| Ofertas rechazadas limpias                     | 35/230 = 15,22 %                | Cerca de 15 %; +0,22 puntos                                   |
| Ofertas efectivamente vencidas limpias         | 23/230 = 10,00 %                | Cerca de 10 %; coincide                                       |
| PENDING guardadas pero ya vencidas             | 4 ofertas                       | Objetivo 3–5; dentro del rango                                |
| Creaciones de lunes a viernes                  | 171/200 = 85,50 %               | Mayor carga en días hábiles; sin porcentaje obligatorio       |

Categorías sobre 200 solicitudes brutas: PLUMBING 70 (35 %), ELECTRICITY 50 (25 %), LOCKSMITH 30 (15 %), GAS 30 (15 %) y MASONRY 20 (10 %), sin desviación. Sobre 190 solicitudes limpias son 69, 46, 28, 28 y 19 respectivamente: 36,32 %, 24,21 %, 14,74 %, 14,74 % y 10,00 %. Horarios preferidos brutos: ANY 100/200 (50 %), MORNING 60/200 (30 %), AFTERNOON 40/200 (20 %), sin desviación; limpios: 97/190 (51,05 %), 56/190 (29,47 %) y 37/190 (19,47 %).

Se usan nueve barrios de nueve comunas. Palermo/Caballito/Almagro concentran 100/200 solicitudes (50 %). Todas las creaciones ocurren entre 08:00 y antes de 22:00 de Buenos Aires. Los trabajos completados duran entre 2 h y 25 h 59 min desde acceptedAt, dentro del rango orientativo de 2–48 h; no se fuerza una distribución log-normal exacta.

Estados finales brutos: 138 COMPLETED, 31 CANCELLED, 28 PENDING, 1 ACCEPTED y 2 IN_PROGRESS. En datos limpios: 129 COMPLETED, 31 CANCELLED, 28 PENDING, 1 ACCEPTED y 1 IN_PROGRESS. Las 240 ofertas guardadas son 147 ACCEPTED, 35 REJECTED, 19 EXPIRED, 25 CANCELLED, 8 RELEASED y 6 PENDING. Al excluir prueba, solo cambia ACCEPTED a 137 y el total a 230. Cuatro de las seis PENDING están vencidas en D: el estado efectivo es 23 EXPIRED y dos PENDING vigentes. Sobre las 240 ofertas brutas, los rechazos son 14,58 % y los vencimientos efectivos 9,58 %. Hay 40 reofertas, siempre a un técnico diferente.

`cancellationOrigins` documenta 25 cancelaciones desde PENDING, cuatro desde ACCEPTED y dos excepcionales desde IN_PROGRESS por Admin. Es metadato del escenario y no se persiste: el modelo no registra startedAt ni el estado anterior a la cancelación. No se agrega ese campo ni se afirma poder reconstruir el inicio desde PostgreSQL. Las fechas de aceptación y la asignación se conservan al cancelar después de aceptar.

### Carga, seguridad y ejecución futura

El modo es `--mode=volume`; su único destino es `127.0.0.1:55434/urbanfix_seed_cp4_volume_test`. Admite preparar allí el catálogo mediante `--mode=catalog`. Rechaza Golden y todas las bases conservadas, destinos remotos, puertos cruzados, producción y fallback a DATABASE_URL. Las parejas del catálogo permanecen intactas.

El runner valida referencia, destino, CSV y dataset antes de construir Prisma. `prisma/seed/volume.js` verifica de nuevo la identidad exacta y el esquema public dentro de una transacción Serializable (maxWait 5 s, timeout 10 s). Lee el catálogo y las seis tablas por lotes, verifica todos los registros presentes antes de insertar y resuelve los UUID de barrio existentes. Ejecuta hasta seis createMany en orden referencial. No hay N+1, actualizaciones, borrados, skipDuplicates, adopción de UUID ajenos ni reintentos. Las colisiones se comprueban por UUID, email insensible a mayúsculas, usuario del perfil y claves compuestas. Cargas parciales compatibles insertan solo faltantes; una segunda carga conserva todos los campos y devuelve existing=695, inserted=0, total=695. El runner desconecta también ante fallos y conserva la salida pública sanitizada.

Solo tras autorizar y verificar el entorno en CP5, configurar la conexión dedicada sin imprimirla y proporcionar D explícitamente:

```powershell
$env:URBANFIX_SEED_REFERENCE_TIME = '2026-12-07T03:00:00.000Z'
npm.cmd run seed -- --mode=volume
```

Este comando no se ejecutó en CP4. No crea bases ni tablas, no aplica migraciones y no carga el catálogo automáticamente. Golden no se modifica ni se mezcla con Volumen. No se incorporan F01–F12, telemetría ni funcionalidades de Sprints 5/6. No ejecutar datasets ficticios en producción.

### Verificación CP4 y pendiente CP5

TDD por bloques: guardas, generación/validación y carga transaccional. Las pruebas específicas con mocks comprueban referencia explícita, reproducción/desplazamiento, cantidades y flags, resultados descriptivos, integridad referencial/temporal, disponibilidad histórica, liberaciones, colisiones, cargas parciales, preservación, rollback por cada tabla o commit, idempotencia y ausencia de N+1.

Resultados locales tras la calibración de CP4: 12 tests específicos de Volumen aprobados. La suite segura, con `URBANFIX_RUN_DB_TESTS=0` y `URBANFIX_RUN_SEED_DB_TESTS=0`, obtuvo 279 tests: 273 aprobados, cero fallidos y seis omitidos exclusivamente por sus guardas PostgreSQL. Se comprobaron la sintaxis de los dos archivos JavaScript ajustados, `git diff --check` y el diff del ajuste. En la implementación inicial también se habían verificado los otros archivos afectados por CP4. La calibración solo modifica el generador, sus tests y esta documentación. Golden, esquema, migraciones y código de la API permanecen sin cambios. No hay comandos de lint, type checking ni build definidos en el proyecto.

`test/seed.volume.integration.test.js` está preparado, no ejecutado. Requiere guarda de integración activa, conexión exclusiva, D explícita, cinco migraciones aplicadas, Prisma Client sincronizado, catálogo oficial completo y seis tablas ficticias vacías. Prepara rollback real, preservación de un usuario ajeno, colisiones, primera carga con commit, segunda transacción independiente, rechazo de otra D y verificaciones SQL de flags, elegibilidad, solapamientos y vigencias. Conserva los commits para inspección; no borra ni limpia registros.

```text
npm.cmd run test:seed:volume:integration
```

La creación y utilización de la nueva base, snapshots de las bases conservadas y la ejecución conjunta de Golden/Volumen quedan para CP5 con autorización específica. No se ejecutaron operaciones sobre PostgreSQL, Docker, Neon o Render, ni migraciones o seeds. Las pruebas seguras deshabilitan ambas guardas de integración; las comprobaciones reales de PostgreSQL permanecen pendientes y no se afirma RED/GREEN sobre ellas.

## CP5 — Infraestructura persistente e integración real

### Pérdida de infraestructura temporal

El 27/11/2026 la usuaria informó que la computadora se apagó durante la noche. Los contenedores históricos `urbanfix-cp2-seed-postgres` y `urbanfix-cp21-seed-integration-postgres`, configurados con `--rm` y tmpfs, ya no aparecen en Docker. Los contextos `default` y `desktop-linux` apuntan al mismo daemon Linux; tampoco hay volúmenes de CP2/CP2.1. La situación es consistente con la eliminación de los contenedores y la pérdida del almacenamiento temporal tras el apagado, aunque el inventario no reconstruye el evento exacto.

Las cinco bases históricas no se reconstruyeron. Ya no es posible capturar ni comparar sus snapshots de datos, estructura e historial de migraciones. La usuaria aceptó expresamente esta limitación al autorizar el plan ajustado de CP5. Los resultados de CP2 y CP2.1 documentados arriba se conservan como evidencia histórica, no como validación de su disponibilidad actual.

### Primer bloque: recursos creados y comprobaciones reales

Se creó exclusivamente el contenedor `urbanfix-cp5-seed-postgres`, ID `338d693d0106029ddd276b9bedb1ce9a9a4d78db0062751a733bd62b1aac6a0e`, y el volumen `urbanfix-cp5-seed-pgdata`, dentro del contexto `desktop-linux`. Se utilizó la imagen local fijada por ID `sha256:edb0c08dc33befd0262ab3b5cf1c4f3f8cfd8b09e88c05b45adee29d6761ddb6`, sin descargas ni instalaciones.

Se verificaron publicación exclusiva en `127.0.0.1:55434`, usuario `urbanfix_cp21`, límite de 1 CPU y 512 MiB, `AutoRemove=false`, un único montaje de volumen en `/var/lib/postgresql` y política `--restart=no`. PostgreSQL acepta conexiones y reporta `18.6 (Debian 18.6-1.pgdg13+2)`, con data_directory `/var/lib/postgresql/18/docker`. El filesystem reportó 963419 MiB disponibles en ese momento; es capacidad del filesystem de Docker, no una reserva exclusiva. El contenedor quedó en ejecución, con cero reinicios y sin OOM registrado.

La credencial aleatoria hexadecimal de 32 caracteres se generó en memoria y se suministró mediante el entorno mínimo del proceso hijo, sin incluirla en argumentos, archivos ni salidas. Su recuperación desde la configuración del contenedor se validó sin imprimirla. Docker conserva la variable de inicialización en su configuración; las referencias temporales del coordinador se limpiaron y las conexiones se cerraron mediante `finally`.

La preparación se interrumpió antes de crear las bases funcionales: el coordinador introdujo una comparación excesivamente estricta con el sufijo Debian `+1`, mientras la imagen disponible reporta `+2`. PostgreSQL sí corresponde a 18.6; el fallo pertenece a esa comprobación del coordinador, no al seed. Conforme a la condición de interrupción, no se corrigió ni reintentó la operación automáticamente.

Una transacción `REPEATABLE READ READ ONLY`, con `default_transaction_read_only=on`, confirmó que solo existe `postgres` como base no-template y que no hay otros clientes conectados. `urbanfix_seed_cp3_golden_test` y `urbanfix_seed_cp4_volume_test` todavía no existen. No se ejecutaron migraciones, catálogos, integraciones reales ni runners Golden/Volumen; por tanto, no hay evidencias de persistencia de datasets ni métricas SQL de CP5.

Se compararon exactamente ID, nombre, estado, montajes, HostConfig e imagen de los seis contenedores preexistentes antes y después de este bloque, sin diferencias. Los volúmenes anteriores `urbanfix-pgdata` y `vscode` permanecen presentes; solo se añadió el volumen exclusivo de CP5. No se accedió a las bases de esos contenedores ni se modificaron sus recursos. Esta comprobación de infraestructura no acredita snapshots de sus datos.

### Ajuste Golden y verificaciones de código

En `test/seed.golden.integration.test.js` se incorporó un clasificador local al test: admite P2034 y P2002 únicamente cuando los metadatos identifican User.id/User.email o las restricciones `User_pkey`/`User_email_key`. Rechaza modelos distintos, restricciones desconocidas, metadatos ausentes o contradictorios y otros códigos. El diagnóstico solo emite código y restricción normalizados; no imprime mensajes, stack ni datos recibidos. Se conservan las aserciones de contenido exacto y suma de 96 inserciones, sin reintentos ni cambios del seed.

TDD: tras corregir un error de sintaxis del test nuevo, la prueba específica falló por ausencia del clasificador (RED) y luego aprobó con la implementación mínima (GREEN). Comando: `node --test --test-name-pattern='Golden: clasifica' test/seed.golden.integration.test.js`. La suite estándar `npm.cmd test`, en un proceso hijo aislado con ambas guardas de integración en `0` y dotenv dirigido a `os.devNull`, obtuvo 280 tests: 274 aprobados, cero fallidos y seis integraciones omitidas. `node --check test/seed.golden.integration.test.js` también aprobó. El proyecto no define scripts de lint, type checking ni build. Las integraciones reales y sus métricas siguen pendientes; no se repitieron las campañas PostgreSQL anteriores.

### Conservación hasta el cierre de Sprint 4

El contenedor y el volumen deben conservarse hasta finalizar Sprint 4. Para detener y volver a iniciar el mismo contenedor, cuando corresponda, sin eliminarlo ni modificar el volumen:

```powershell
docker --context desktop-linux stop urbanfix-cp5-seed-postgres
docker --context desktop-linux start urbanfix-cp5-seed-postgres
docker --context desktop-linux exec urbanfix-cp5-seed-postgres pg_isready --username=urbanfix_cp21 --dbname=postgres
```

Estos comandos de mantenimiento no se ejecutaron durante este bloque. `stop` detiene PostgreSQL; `start` reutiliza el contenedor y su volumen, conservando los datos. Con `--restart=no`, después de un apagado se requiere iniciarlo explícitamente. El volumen persistente no sustituye un backup. No utilizar instrucciones históricas de CP2/CP2.1 para recrear recursos ni ejecutar integraciones que requieren bases vacías sobre bases pobladas.

Pendiente del cierre de Sprint 4: evaluar la necesidad de respaldo y conservación, y solicitar autorización específica antes de eliminar el contenedor o su volumen. No hay eliminación automática autorizada.

Estado al interrumpir el primer bloque: **PENDIENTE**. Quedaban por resolver la comprobación del sufijo de distribución del coordinador y la creación exclusiva de las dos bases nuevas, sin recrear infraestructura ni las cinco bases históricas. El cierre definitivo se registra a continuación.

### Reanudación y cierre definitivo

La usuaria autorizó aceptar PostgreSQL `18.6 (Debian 18.6-1.pgdg13+2)` para la misma imagen local. El coordinador mantuvo la comparación exacta de imagen y contenedor, versión, puerto, usuario, volumen, límites y estado, sin modificar archivos de código adicionales. La lectura del schema generado utilizó la ruta real resuelta por pnpm: coincidió con el schema vigente salvo formato, sin regenerar Prisma Client ni instalar dependencias.

Se reutilizaron el contenedor y el volumen existentes. Se crearon únicamente `urbanfix_seed_cp3_golden_test` y `urbanfix_seed_cp4_volume_test`, con `createdb --username=urbanfix_cp21 --owner=urbanfix_cp21 --template=template0` dentro de `urbanfix-cp5-seed-postgres`. No se reconstruyeron las bases anteriores.

En cada base se ejecutaron `prisma migrate deploy --config=prisma7.config.ts` y `prisma migrate status --config=prisma7.config.ts`, mediante Node y el CLI local resuelto con `require.resolve('prisma/build/index.js')`. Se verificaron los cinco nombres de migración aprobados, finalización, ausencia de rollback, un paso aplicado por migración y checksums SHA-256 coincidentes con los bytes de cada archivo local. Cada CLI recibió exclusivamente su DATABASE_URL local en un entorno mínimo, con dotenv dirigido a `os.devNull`.

Después se ejecutó `npm.cmd run seed -- --mode=catalog` en ambas bases: cada ejecución informó `existing=0, inserted=48, total=48`. SQL de solo lectura verificó los 48 nombres y correspondencias oficiales exactas, 15 comunas y las seis tablas ficticias vacías antes de comenzar cada integración.

| Ejecución real, en orden | Resultado |
| --- | --- |
| `npm.cmd run test:seed:golden:integration` | 8 tests aprobados, 0 fallidos, 0 omitidos; incluye el clasificador y la integración con sus subtests |
| `npm.cmd run seed -- --mode=golden` | `existing=96, inserted=0, total=96` |
| `npm.cmd run test:seed:volume:integration` | 6 tests aprobados, 0 fallidos, 0 omitidos |
| `npm.cmd run seed -- --mode=volume` | `existing=695, inserted=0, total=695` |

Las integraciones realizaron la primera carga y conservaron sus commits. Cada runner posterior se ejecutó en un proceso independiente con la conexión dedicada `URBANFIX_SEED_DATABASE_URL`. La guarda `URBANFIX_RUN_SEED_DB_TESTS=1` se proporcionó solo al archivo de integración correspondiente; las integraciones ajenas permanecieron deshabilitadas. Volumen recibió `URBANFIX_SEED_REFERENCE_TIME=2026-12-07T03:00:00.000Z`; Golden utilizó `R=2026-12-07T15:00:00.000Z`. No se extrajeron comandos desde Markdown ni se utilizaron conexiones externas.

Golden verificó preservación de un registro ajeno, colisiones, rollback real tras el último INSERT, concurrencia, contenido exacto y segunda carga idempotente. La concurrencia produjo P2034 y se diagnosticó únicamente como `{"code":"P2034","constraint":"serialization"}`; no necesitó reintentos. P2002 quedó cubierto mediante los errores simulados del clasificador, no observado en esta ejecución real. Volumen verificó preservación, colisiones, rollback real, contenido exacto, idempotencia y rechazo de una referencia temporal diferente sin modificar datos. Sus consultas SQL verificaron elegibilidad, disponibilidad histórica sin solapamientos y vigencia de ofertas.

### Persistencia y métricas comprobadas

Las comprobaciones adicionales usaron conexiones nuevas, `default_transaction_read_only=on` y transacciones `REPEATABLE READ READ ONLY`. Los conteos persistidos coincidieron exactamente con los datasets aprobados:

| Tabla o población | Golden | Volumen |
| --- | ---: | ---: |
| User | 17: 7 CLIENT, 9 TECHNICIAN, 1 ADMIN | 62: 45 CLIENT, 15 TECHNICIAN, 2 ADMIN |
| Technician | 9 | 15 |
| TechnicianSpecialty | 13 | 43 |
| TechnicianNeighborhood | 19 | 135 |
| ServiceRequest | 18 | 200 |
| ServiceOffer | 20 | 240 |
| Neighborhood, independiente del total ficticio | 48 | 48 |
| Solicitudes / ofertas limpias | 17 / 19 | 190 / 230 |

Los filtros SQL identificaron exactamente Golden C7/T9 y Volume C44/C45/T11 como cuentas de prueba. También se compararon contra el fixture aprobado las distribuciones SQL brutas y limpias por categoría, barrio, horario preferido, estado de solicitud y estado almacenado de oferta, sin diferencias.

| Métrica Golden | SQL obtenido, igual al esperado |
| --- | --- |
| Cohorte madura, excluyendo moderación previa a aceptar | n=13; 10 aceptadas: 76,92 % |
| Misma variante: liquidez 2 h / 24 h | 4/13=30,77 % / 9/13=69,23 % |
| Cohorte madura, incluyendo moderación | n=14; 10 aceptadas: 71,43 % |
| Misma variante: liquidez 2 h / 24 h | 4/14=28,57 % / 9/14=64,29 % |
| Mediana / P90 | 150,5 / 1451,1 minutos |
| Demanda reciente / técnicos activos según resultado DA | 15 / 5; ratio 3,00 |
| Respuesta de ofertas elegibles | 10 ACCEPTED / 13 = 76,92 % |

Se conserva la discrepancia funcional documentada sobre técnicos activos: estos cinco corresponden al resultado DA que incluye rechazos; no se eligió ni implementó una definición productiva diferente.

| Métrica Volumen | SQL obtenido, igual al esperado |
| --- | --- |
| Solicitudes maduras limpias | 188; 183 al excluir además moderación previa a aceptar |
| Liquidez hasta 2 h | 57/188 = 30,32 % |
| Liquidez hasta 24 h | 121/188 = 64,36 % |
| Aceptación madura limpia | 137/188 = 72,87 % |
| Mediana de aceptadas maduras limpias | 150 minutos |
| Rechazos limpios | 35/230 = 15,22 % |
| Vencimientos efectivos limpios | 23/230 = 10,00 %; incluyen 4 PENDING almacenadas ya vencidas |
| Canceladas antes / después de aceptar, maduras limpias | 25 / 6; PENDING maduras limpias: 26 |
| Solicitudes por semana | 25 / 35 / 45 / 55 / 40 |
| Creaciones en días hábiles | 171/200; cero creaciones fuera de 08:00–22:00 Buenos Aires o posteriores a D−1 h |

Se capturaron en memoria snapshots completos de las siete tablas y `_prisma_migrations` de cada base nueva. Coincidieron exactamente antes/después del runner independiente y nuevamente al cierre. Huellas SHA-256 de la serialización de esos snapshots, incluyendo historial de migraciones:

- Golden: `ced1bc2ab8ea8dacb6cc68eb7cf0a53c57dd2fbaf405a6d2bea8783fb60b4b69f`.
- Volumen: `e0603e2260a80688af0753aa2cacd473262363ff4dda5da39a8848c688e3d2e7`.

### Preservación y alcance de la entrega

Al cierre, los seis contenedores ajenos conservaron exactamente ID, nombre, estado, montajes, HostConfig e imagen. El inventario de volúmenes no cambió durante la reanudación. No se inició, detuvo ni eliminó ningún contenedor. CP5 mantiene su mismo ID e imagen, está en ejecución, con cero reinicios y sin OOM registrado; la muestra final reportó 101,8 MiB de 512 MiB y CPU 0,00 %. El volumen y ambas bases quedan conservados hasta el cierre de Sprint 4. La consulta final detectó solo `postgres` y las dos bases autorizadas, sin sesiones cliente ajenas.

No se repitieron el TDD ni la suite segura ya aprobados: el hash del test Golden permaneció idéntico durante la reanudación y solo se actualizó esta documentación. Se mantienen como evidencia los 274 tests aprobados y seis integraciones omitidas de la suite segura del primer bloque. Las integraciones reales descritas arriba complementan esa verificación. No hay scripts de lint, type checking ni build definidos. Se revisaron `git --no-pager diff`, `git --no-pager diff --check` y `git status`; el cambio documental local previo permanece preservado.

Los criterios de aceptación de CP5 se cumplen: el seed creó usuarios de cada rol y ambos datasets se ejecutaron y persistieron correctamente en PostgreSQL. La imposibilidad de comparar snapshots de las cinco bases históricas permanece documentada y expresamente aceptada; no se presenta como una prueba aprobada. Los resultados corresponden únicamente al entorno local aislado, sin deployment, operaciones sobre Neon/Render, cambios de negocio, esquema, migraciones, datasets, endpoints ni Frontend. No se realizaron staging, commits, push ni PRs.

El coordinador terminó con cero conexiones abiertas y limpió las referencias temporales a credenciales mediante `finally`. Tiempo medido de la reanudación hasta esa limpieza: 27,3 minutos; sumado al primer coordinador de 16 minutos, 43,3 minutos instrumentados. Esta suma no incluye el TDD previo ni todos los intercambios de revisión, y no representa tiempo de CPU de PostgreSQL.

Estado definitivo: **LISTO PARA REVISIÓN**. Quedan S4-06 y S4-07, sin iniciar. La evaluación y eventual eliminación de contenedor/volumen sigue pendiente del cierre de Sprint 4 y requiere autorización específica.
