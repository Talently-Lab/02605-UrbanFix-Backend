# Sprint 4 — Deployment y entrega

## Estado y límites

La preparación de S4-07 es local. La integración en `develop`, las operaciones Neon, la creación de accesos SQL y el deployment en Render requieren las acciones y autorizaciones posteriores acordadas. Ninguna URL de conexión privada ni credencial se almacena en esta guía, OpenAPI o Postman.

El usuario realiza commits, push y PR. No se cambia de rama automáticamente. Después de integrar, verificar el commit de `develop` y usar ese código para ambos seeds y Render. No intervenir en `production` ni en las bases, contenedores o volúmenes locales conservados.

## Destinos autorizables

| Rama Neon | Contenido | Acceso y uso |
| --- | --- | --- |
| `golden` | Catálogo oficial + Golden: 17 usuarios, 18 solicitudes | Control QA/DA; consultas SQL de solo lectura tras la carga |
| `preproduction` | Catálogo oficial + Volume: 62 usuarios, 200 solicitudes | Backend Render, Frontend y pruebas QA/DA |
| `production` | Fuera del alcance | Ninguna operación |

Antes de cualquier escritura, comprobar desde el plano de control de Neon el proyecto `02605-urbanfix`, la rama y su endpoint. Una consulta `current_database()` por sí sola no distingue ramas Neon que comparten nombre de base. Confirmar después mediante SQL de solo lectura base, esquema, usuario efectivo, tablas, registros e historial/checksums de migraciones. No asumir que una rama es nueva o está vacía; Neon puede contener datos heredados del punto de creación. Detenerse ante datos inesperados, conflictos o migraciones divergentes.

Preparar una autorización efímera por destino con los campos `project`, `branch`, `host`, `database` y `user`. `host` debe ser el endpoint exacto verificado, sin protocolo ni puerto; no se publica en Git. Esta autorización expresa la selección revisada por la persona operadora; no consulta ni autentica contra el plano de control de Neon por sí misma.

## Migraciones y seeds explícitos

Solo después de autorización específica y del preflight anterior, ejecutar el CLI local instalado, sin `npx` que pueda descargar otra versión. Los comandos siguientes son instrucciones para esa operación futura; no se ejecutan durante la verificación local:

```powershell
pnpm exec prisma migrate status --config=prisma7.config.ts
pnpm exec prisma migrate deploy --config=prisma7.config.ts
pnpm exec prisma migrate status --config=prisma7.config.ts
pnpm exec prisma db seed --config=prisma7.config.ts -- --mode=catalog
# Elegir exclusivamente uno, según la rama verificada:
pnpm exec prisma db seed --config=prisma7.config.ts -- --mode=golden
pnpm exec prisma db seed --config=prisma7.config.ts -- --mode=volume
```

`migrate deploy` escribe el esquema y `_prisma_migrations`. Ejecutarlo en un proceso hijo separado que reciba únicamente `DATABASE_URL` del destino autorizado y `DOTENV_CONFIG_PATH` apuntando a `os.devNull`. La configuración Prisma lee `DATABASE_URL`; las guardas del seed no protegen el CLI de migraciones. Por ello se debe verificar su URL efectiva de manera independiente antes de invocarlo. Aplicar solamente las cinco migraciones existentes y comprobar nombres, finalización y SHA-256 contra los archivos locales.

Para el proceso hijo del seed, proporcionar exclusivamente el entorno mínimo necesario del sistema y:

| Variable | Uso |
| --- | --- |
| `URBANFIX_SEED_DATABASE_URL` | Conexión dedicada del destino exacto, con TLS `sslmode=verify-full` |
| `DATABASE_URL` | Solo si se usa el CLI Prisma; debe ser idéntica a la conexión dedicada |
| `URBANFIX_SEED_ALLOW_NEON=1` | Opt-in de ejecución remota |
| `URBANFIX_SEED_NEON_AUTHORIZATION` | JSON efímero de autorización del destino, sin contraseña |
| `URBANFIX_SEED_REFERENCE_TIME=2026-12-07T03:00:00.000Z` | Obligatoria para Volume; no sustituir por el reloj actual |
| `DOTENV_CONFIG_PATH` | `os.devNull`, para impedir lectura accidental de `.env` por el CLI |
| `URBANFIX_RUN_DB_TESTS=0`, `URBANFIX_RUN_SEED_DB_TESTS=0` | Mantener deshabilitadas las campañas de integración locales |

Golden utiliza su referencia fija `2026-12-07T15:00:00.000Z`. Las referencias sirven para reproducir los indicadores aprobados; no representan datos actuales. El seed rechaza `NODE_ENV=production`: usar un proceso de mantenimiento separado del proceso Render. Las URLs solo admiten parámetros TLS enumerados; no parámetros que cambien host, esquema u opciones de sesión. `channel_binding=require` es opcional si la conexión y el driver lo soportan. No desactivar la validación del certificado.

Mantener credenciales y autorización en memoria; no pegarlas en comandos, logs, historial, archivos temporales ni documentación. Un coordinador debe crear entornos mínimos de hijos y descartar las referencias en `finally`; si se usan variables temporales de proceso, retirarlas también en `finally`. No cargar conexiones mediante parámetros de línea de comandos. No reutilizar el entorno de mantenimiento para iniciar la API o ejecutar la suite.

El runner no aplica migraciones ni prepara catálogos automáticamente en modos ficticios. Primero `catalog`, después el dataset correspondiente. La identidad de base, esquema y usuario se comprueba dentro de cada transacción antes de leer/escribir datos. Se conservan lotes, transacciones Serializable, rechazo de discrepancias, ausencia de actualizaciones/borrados y ausencia de reintentos automáticos.

Comprobar persistencia con una conexión independiente de solo lectura: catálogo exacto de 48 barrios/15 comunas; Golden 17 usuarios, 9 perfiles, 18 solicitudes y 20 ofertas; Volume 62 usuarios, 15 perfiles, 200 solicitudes y 240 ofertas. Verificar métricas con las referencias aprobadas de [seed](seed.md), integridad de relaciones y ausencia de IDs/emails del otro dataset. Repetir inmediatamente el runner correspondiente debe insertar cero registros. No repetir las campañas de rollback/concurrencia de S4-05 sobre estas bases pobladas.

Realizar la comprobación de idempotencia antes de entregar acceso a la API. Login modifica `lastLoginAt`; registro y PATCH también cambian el contenido. Después de esas interacciones, los seeds deterministas pueden rechazar discrepancias: no utilizarlos como sincronización ni corregir registros automáticamente.

## Accesos individuales QA y Data Analytics

Crear, previa autorización, un rol SQL de lectura por persona y rama necesaria, sin membresía `neon_superuser`, propiedad, `CREATEDB`, `CREATEROLE` ni privilegios de escritura. Utilizar roles creados mediante SQL con concesiones explícitas; revisar privilegios heredados y de `PUBLIC` antes de afirmar que el acceso es de solo lectura.

Conceder `CONNECT` a la base, `USAGE` al esquema y `SELECT` únicamente a las tablas/columnas aprobadas. Para `User`, excluir `passwordHash` mediante permisos por columna o una vista restringida; no conceder a ese rol `SELECT ON ALL TABLES`. No entregar el usuario propietario ni credenciales de Render. `default_transaction_read_only=on` es una defensa adicional y no sustituye los permisos.

Verificar permisos con funciones de privilegios y catálogos PostgreSQL de solo lectura, incluyendo membresías, permisos de columna, creación en esquemas y funciones ejecutables. No ensayar escrituras destructivas para demostrar restricciones. DBeaver utilizará conexión individual TLS a la rama exacta, preferentemente directa para trabajo SQL interactivo. Entregar credenciales por un canal privado, nunca por esta guía, Postman exportado o Git.

## Render

Configurar un Web Service Node desde el repositorio Backend y la rama `develop`, solo después de integrar y autorizar el deployment. Fijar versiones compatibles de Node/pnpm con el lockfile. Comando de preparación propuesto:

```text
pnpm install --frozen-lockfile --ignore-scripts && pnpm exec prisma generate --config=prisma7.config.ts
```

Este paso instala las dependencias fijadas y genera Prisma Client; no migra ni carga seeds. Startup: `pnpm start`. Configurar por secreto `DATABASE_URL` exclusivamente de `preproduction`, `JWT_SECRET` aleatorio y `FRONTEND_URL` con los orígenes reales autorizados. No incorporar las variables de autorización del seed al servicio Render. Usar un rol de aplicación con permisos necesarios, separado del rol de mantenimiento y de los roles SQL de lectura.

El proceso escucha en `0.0.0.0` y utiliza `PORT` de Render; en local conserva 3000 por defecto. Health Check path: `/`. Un HTTP 200 en esa ruta comprueba disponibilidad HTTP, no conexión PostgreSQL. Verificar también `/api/barrios` y un perfil autenticado para comprobar el acceso real a datos. No exponer secretos mediante logs ni respuestas.

Swagger estará en `/docs/` y la especificación en `/openapi.json`. Los recursos de Swagger se sirven desde la dependencia local; el validador externo está deshabilitado y no se persiste la autorización en el navegador. Los ejemplos no contienen credenciales reales. Cerrar la sesión/pestaña y retirar tokens después de probar.

## Postman y CORS

Importar [colección](postman/UrbanFix.postman_collection.json) y [plantilla de entorno](postman/UrbanFix.postman_environment.json). No fueron ejecutadas contra un deployment durante esta preparación local.

Completar localmente `baseUrl` y `approvedBaseUrl` con la misma URL HTTPS verificada de Render, sin barra final; conservar `target=preproduction`. No usar Golden. La guarda omite requests sin destino aprobado y omite POST/PATCH mientras `allowWrites` no sea `true`. Requiere una versión de Postman compatible con `pm.execution.skipRequest()`; comprobar esa compatibilidad antes de usarla. Las guardas no reemplazan la comprobación de que el deployment apunta a la rama correcta.

Seleccionar conscientemente las requests: consultas públicas primero; luego login y perfil de cada rol con `expectedRole` correcto. Login escribe `lastLoginAt`, incluso si solo se pretende consultar el perfil. Los registros requieren además `allowRegistration=true`, emails ficticios nuevos y un UUID de barrio real del catálogo para TECHNICIAN. Las altas no se limpian automáticamente. Las pruebas PATCH usan exclusivamente cuentas designadas de preproduction y dejan los cambios de nombre/teléfono documentados. Tras el payload mixto inválido, consultar el perfil para confirmar conservación de valores. No ejecutar toda la colección como si fuera una suite con rollback.

Mantener email/password/token en valores locales privados; los secretos de la plantilla están vacíos. El login captura el Bearer únicamente tras una respuesta correcta. No exportar el entorno rellenado ni compartir tokens. Para probar los tres roles, cambiar cuenta y token conscientemente; ADMIN no se registra mediante la API pública.

Comprobar CORS con `Origin` permitido y rechazado y preflight `OPTIONS` con `Access-Control-Request-Method: PATCH` y `Access-Control-Request-Headers: authorization,content-type`. El permitido debe recibir su origen exacto y el preflight 204; el rechazado no recibe autorización CORS. No se usan cookies ni `Access-Control-Allow-Credentials`. Un cliente Postman no aplica las restricciones del navegador: completar la verificación desde Frontend cuando esté disponible o documentar esa limitación.

## Evidencias y entrega pendiente

Registrar, sin secretos: commit desplegado de `develop`, versión de runtime, identidad verificada de cada rama, migraciones/checksums, resultados de carga y segunda ejecución, métricas, permisos SQL, HTTP/errores/privacidad y CORS. Entregar URL base, URL Swagger, colección Postman, cuentas ficticias designadas e instrucciones privadas de acceso SQL. Marcar pendiente cualquier verificación no ejecutada.

Los teléfonos sintéticos no acreditan líneas existentes o reservadas: no usarlos para llamadas/SMS. Las cuentas de prueba conocidas y los datos ficticios pertenecen exclusivamente a estos entornos. La integración con Frontend y la revisión de su campo telefónico/origen siguen pendientes hasta disponer del entorno.

Los recursos locales `urbanfix-cp5-seed-postgres` y `urbanfix-cp5-seed-pgdata` se conservan. Su evaluación y eventual eliminación al cierre del Sprint 4 requiere autorización específica; esta guía no ordena eliminarlos.

Fuentes operativas: [Prisma 7 seed explícito](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/seeding), [Render Web Services](https://render.com/docs/web-services), [Neon roles](https://neon.com/docs/manage/roles), [Postman skipRequest](https://learning.postman.com/docs/tests-and-scripts/write-scripts/postman-sandbox-reference/pm-execution/).

## Verificación local de esta entrega

Se ejecutó una única suite completa mediante `pnpm test` (`node --test`) en un proceso hijo con entorno mínimo, sin URLs de conexión, dotenv dirigido a `os.devNull` y ambas guardas de integración en `0`: **309 tests, 302 aprobados, 0 fallidos y 7 omitidos**. Las omisiones corresponden a dos integraciones de autenticación, una de catálogos, una de perfil y tres de seed; se mantienen deshabilitadas deliberadamente para preservar los entornos existentes.

La revisión final amplió los casos del test de guardas Neon para rechazar propiedades heredadas como nombre de rama, ramas de tipo incorrecto y bases omitidas. Se verificó RED y se corrigió la guarda; después pasaron los **63 tests específicos** de guardas, runner, catálogo, Golden, Volume y entrypoint. No se repitió la suite completa. Los resultados anteriores no representan conexiones ni validación remota de Neon.

También se comprobaron sintaxis de los 26 archivos JavaScript/configuración afectados, parseo de los cinco JSON nuevos/modificados y referencias internas OpenAPI. No hay scripts configurados de lint, type checking o build; el Backend JavaScript se ejecuta directamente. No se instalaron herramientas adicionales para esas comprobaciones.

**Preparación local lista para revisión. S4-07 pendiente de entrega remota.** Quedan integración Git por el usuario, preflight y autorización de Neon, migraciones/cargas/verificaciones, roles individuales, deployment Render, Postman remoto, CORS e integración con Frontend. No se realizaron migraciones, seeds, operaciones Docker, accesos a bases reales ni cambios de Git durante esta preparación.
