# UrbanFix Solutions — Backend

API de UrbanFix para conectar clientes y técnicos. Backend en Node.js, Express (CommonJS), Prisma 7 y PostgreSQL.

## Operaciones disponibles en Sprint 4

| Método | Ruta | Acceso |
| --- | --- | --- |
| GET | `/` | Público; Health Check HTTP básico, sin consulta a PostgreSQL |
| POST | `/api/auth/register` | Público; CLIENT y TECHNICIAN |
| POST | `/api/auth/login` | Público; cuenta activa |
| GET | `/api/usuarios/me` | Cuenta activa de cualquier rol |
| PATCH | `/api/usuarios/me` | Nombre: todos los roles; teléfono: solo CLIENT |
| GET | `/api/especialidades` | Público |
| GET | `/api/barrios` | Público |

Swagger: `/docs/`. Especificación: `/openapi.json`. Solicitudes, ofertas, búsqueda de técnicos, moderación y métricas figuran en el contrato funcional para sprints posteriores; todavía no están implementadas.

## Desarrollo local

Usar Node.js compatible con las versiones fijadas en `pnpm-lock.yaml` y pnpm (entorno verificado: Node 24 y pnpm 11). Instalar con `pnpm install --frozen-lockfile --ignore-scripts`; no se ejecutan scripts de instalación. Generar Prisma Client explícitamente con `pnpm exec prisma generate --config=prisma7.config.ts` sobre la configuración autorizada. Este comando genera código local, no aplica migraciones ni carga datos.

Configurar `DATABASE_URL`, `JWT_SECRET` y `FRONTEND_URL` mediante el entorno local protegido. No versionar secretos. `FRONTEND_URL` acepta orígenes HTTP/HTTPS exactos separados por comas, sin rutas ni comodines. `PORT` es opcional en local (3000); en Render se utiliza el valor suministrado por la plataforma. Ejecutar `pnpm start` solo después de confirmar el destino de la conexión.

La API utiliza JWT Bearer HS256 con expiración de una hora y no utiliza cookies de autenticación. El registro no devuelve token. Los errores usan `application/problem+json`; los detalles internos se sanitizan.

CLIENT y TECHNICIAN registran teléfono argentino internacional completo, sin normalización: fijo `+541143216543` o móvil `+5491164004700`. Se validan los códigos de área de ENACOM; Frontend incorpora el prefijo correspondiente en su presentación. ADMIN mantiene teléfono nulo. El nombre propio es editable por todos los roles; solo CLIENT edita su teléfono.

## Pruebas

`pnpm test` ejecuta `node --test`. Las integraciones PostgreSQL están deshabilitadas por defecto, pero variables heredadas pueden habilitarlas. Para una suite segura, ejecutar un proceso hijo con entorno mínimo, `URBANFIX_RUN_DB_TESTS=0`, `URBANFIX_RUN_SEED_DB_TESTS=0`, sin URLs de conexión ni variables de autorización Neon. No reutilizar una terminal preparada para migraciones o seeds. Ver [deployment y entrega](docs/deployment.md).

No hay scripts de lint, type checking o build configurados. No ejecutar integraciones sobre bases pobladas sin revisar sus efectos y obtener autorización.

## Datos y entornos

El seed siempre requiere modo y destino explícitos; nunca se ejecuta en startup, build o migraciones. `pnpm run seed --mode=catalog` y `pnpm exec prisma db seed --config=prisma7.config.ts -- --mode=catalog` utilizan el mismo runner. Estos comandos escriben datos y requieren autorización y destino verificado; no son parte del arranque normal.

La arquitectura prevista es Neon `golden` para catálogos + Golden y `preproduction` para catálogos + Volume. Render utilizará `develop` y únicamente `preproduction`. `production` queda excluida. La implementación local no acredita que esos entornos ya estén preparados o desplegados.

Los teléfonos sintéticos fueron adecuados en S4-07. Las bases locales conservadas de S4-05 contienen la versión anterior: no ejecutar los nuevos seeds sobre ellas ni corregirlas automáticamente. Los resultados históricos siguen documentados.

## Documentación

- [Contrato de API y operaciones planificadas](docs/api-contract.md)
- [OpenAPI de operaciones implementadas](docs/openapi.json)
- [Modelo de datos](docs/data-model.md)
- [Matriz RBAC](docs/rbac-matrix.md)
- [Seed y evidencias históricas](docs/seed.md)
- [Deployment, Postman y entrega](docs/deployment.md)
- [Guía de contribución](docs/CONTRIBUTING.md)

La Matriz de Reglas de Negocio vigente del equipo prevalece sobre el antiguo catálogo y sobre casos QA contradictorios. Su publicación o enlace compartido actualizado queda pendiente de coordinación; no se sustituye por un enlace obsoleto.
