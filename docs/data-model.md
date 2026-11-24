# Modelo de datos — UrbanFix Solutions (v.2)

## Relaciones

**User y Technician:** Relación 1:1 opcional mediante User.technician y Technician.userId (@unique). Permite mantener los datos comunes en User y los específicos del técnico en Technician, evitando duplicaciones.

**Technician.specialties:** Un técnico puede ofrecer varias especialidades mediante TechnicianSpecialty. Cada categoría GAS o ELECTRICITY requiere su matrícula.

**ServiceRequest.clientId:** Relación obligatoria con User. Cada solicitud pertenece a un usuario que debe tener el rol CLIENT. Esta condición se verificará mediante las reglas de autorización de Backend.

**ServiceRequest.technicianId:** Relación opcional con Technician. La solicitud queda PENDING y sin asignación hasta que el técnico destinatario acepta su oferta.

**ServiceRequest.description:** Almacena la descripción del problema proporcionada por el cliente.

**User.createdAt y ServiceRequest.createdAt:** Registran automáticamente la fecha de creación.

**ServiceRequest.updatedAt:** Registra automáticamente la fecha de última actualización.

**Identificadores:** Las entidades User, Technician y ServiceRequest utilizan identificadores únicos UUID.

**Datos de autenticación:** User.passwordHash almacena el hash de la contraseña, evitando guardar contraseñas en texto plano.

## Entidades y propósito

**User:** identidad, rol y estado de cuenta.

**Technician:** perfil técnico y estado de aprobación.

**TechnicianSpecialty:** especialidad y matrícula cuando corresponda.

**Neighborhood:** catálogo de barrios de CABA.

**TechnicianNeighborhood:** cobertura declarada por el Técnico.

**ServiceRequest:** solicitud, titular, asignación y estado del trabajo.

**ServiceOffer:** destinatario, vigencia y resultado de cada oferta.

## Campos

phone pertenece a la cuenta CLIENT y la solicitud lo obtiene mediante su relación con User.

preferredTime es informativo y utiliza ANY por defecto.

Esquema de Prisma: [Esquema de Prisma](../prisma/schema.prisma).

## Claves y relaciones

@id o @@id identifica cada registro.

Las tablas de especialidad y cobertura usan claves compuestas para evitar duplicados.

User.email es único y Technician.userId es único.

User ↔ Technician es 1 a 0..1.

User → ServiceRequest es 1 a muchos para el titular y, por separado, para quien cancela si se guarda.

Technician → ServiceRequest es 1 a muchos con asignación opcional.

Neighborhood → ServiceRequest es 1 a muchos.

ServiceRequest y Technician tienen cada uno una relación 1 a muchos con ServiceOffer.

Technician y Neighborhood se vinculan mediante TechnicianNeighborhood.

TechnicianSpecialty vincula al Técnico con una categoría del enum.

El esquema conserva las acciones referenciales implícitas de Prisma para PostgreSQL. Al borrar un registro referenciado, las relaciones obligatorias aplican Restrict y las opcionales SetNull.

El MVP documenta suspensión de cuentas y cancelación de solicitudes; no define un flujo de borrado físico.

Las operaciones de negocio conservan el historial.

## Estados y fechas

Solicitud: PENDING → ACCEPTED → IN_PROGRESS → COMPLETED. CANCELLED se alcanza desde PENDING por el cliente titular o Admin, desde ACCEPTED por Admin y desde IN_PROGRESS solo por Admin en casos excepcionales (D-025, D-026 y RN-027). Solo el Técnico que aceptó inicia y solo el asignado completa.

Oferta: PENDING hasta que se acepte, rechace o venza. ACCEPTED, REJECTED y EXPIRED conservan el resultado.

RELEASED identifica las otras ofertas vigentes liberadas al aceptar (D-029), y CANCELLED para una oferta abierta invalidada al cancelar la solicitud.

ServiceRequest.createdAt registra la creación.

ServiceOffer.createdAt registra la emisión en la operación que confirma la elección y hace disponible la oferta al destinatario. expiresAt se calcula como ese instante más 24 horas corridas.

Distinguir duración de oferta (24 h corridas desde elección confirmada) y tiempo desde creación hasta aceptación.

Desde expiresAt se trata como EXPIRED aunque aún figure PENDING.

El servidor escribe acceptedAt, completedAt y cancelledAt una sola vez, cuando ocurre el hecho correspondiente. Quedan nulos antes del hecho y se conservan para el historial. updatedAt indica la última modificación.

Conservar acceptedAt al cancelar permite medir aceptación previa. cancelledAt registra cancelaciones autorizadas por CLIENT o ADMIN.

PENDING conserva technicianId nulo.

ServiceOffer.technicianId identifica al destinatario.

Backend asigna ServiceRequest.technicianId al aceptar y lo conserva tras finalizar o cancelar una solicitud ya aceptada.

Se almacenan instantes con timestamptz(3). El 3 indica tres decimales de segundo, la misma precisión que usa Date en JavaScript. PostgreSQL conserva el instante y la zona original queda fuera del dato almacenado.

La API devuelve cada fecha como texto ISO 8601 en UTC, por ejemplo 2026-11-06T15:00:00.000Z. La Z indica UTC. Así Backend, Frontend, QA y Datos pueden comparar el mismo instante, y Frontend puede mostrarlo en la hora local que corresponda.

preferredTime conserva MORNING, AFTERNOON o ANY; se muestra al técnico con la descripción y no determina su disponibilidad.

## Integridad y concurrencia

Backend rechaza emails con mayúsculas en registro y login mediante HTTP 400. Frontend puede convertir el valor antes de enviarlo.

La comparación de emails y la unicidad son insensibles a mayúsculas; un duplicado produce HTTP 409. Backend conserva el email aceptado en minúsculas sin convertir el valor recibido.

Para Gas y Electricidad exige matrícula por especialidad desde el registro y la verifica antes de aprobar.

Los barrios pertenecen al catálogo de CABA.

El registro de un técnico crea la cuenta, el perfil, las especialidades y las relaciones con los barrios en una única transacción. Backend verifica que todos los `neighborhoodIds` existan en el catálogo de CABA. Si un UUID válido no corresponde a un barrio existente, devuelve HTTP 404 y revierte la operación completa.

Índices de oferta: (requestId, technicianId, status) apoya la exclusión por rechazo o vencimiento; (technicianId, status, expiresAt) apoya la consulta de ofertas vigentes y su liberación.

PostgreSQL agrega los índices únicos parciales documentados en Migraciones.

Crear la solicitud y su oferta inicial forma una sola transacción.

La reoferta verifica titularidad, elegibilidad y vigencia; registra EXPIRED si la oferta anterior venció y todavía figura PENDING.

La aceptación verifica estado, vigencia y disponibilidad, asigna el trabajo y libera las demás ofertas vigentes en una transacción.

Crear y aceptar ofertas se coordinan sobre el mismo Técnico para evitar carreras.

La cancelación cambia la solicitud y deja inoperable su oferta abierta en la misma transacción.

Un Técnico tiene como máximo un trabajo en ACCEPTED o IN_PROGRESS.

El Cliente puede tener varias solicitudes activas sin un límite definido para el MVP.

## Datos sensibles

Guardar únicamente el hash de la contraseña en passwordHash. El valor no sale en respuestas.

Guardar street, streetNumber, floor, apartment y directions por separado del barrio. Compartirlos únicamente con el técnico que aceptó. Guardar phone en User, obligatorio para CLIENT y nulo para TECHNICIAN y ADMIN.

La dirección utiliza el formato estructurado del contrato. La API controla los campos que recibe cada rol.

La matrícula se guarda por especialidad.

Admin revisa perfiles manualmente y consulta todas las solicitudes; recibe el barrio y el email de moderación, excluyendo dirección exacta y teléfono (D-032 y D-033).

Aplicar permisos mínimos de base de datos y separar la cuenta de la aplicación de la cuenta de migraciones.

Excluir de logs y errores contraseñas, hashes, tokens, dirección exacta, matrícula, cuerpos y parámetros SQL.

El error público 500 utiliza RFC 9457, un mensaje genérico y traceId para correlación.

El diagnóstico interno solo conserva datos sanitizados.

## Validaciones y seguridad

Descripción obligatoria de 20 a 500 caracteres. Calle y número obligatorios; el número admite S/N. Piso, departamento e indicaciones son opcionales. Las entradas opcionales omitidas se guardan como null; enviar null, texto vacío o espacios produce HTTP 400.

El teléfono utiliza formato internacional con + y entre 2 y 15 dígitos, sin separadores y con el primer dígito distinto de cero. Solo CLIENT puede informar phone.

El JWT dura 1 hora desde el login y devuelve expiresIn 3600.

Backend comprueba el estado actual de la cuenta y los permisos en cada petición protegida.

La oferta conserva su plazo independiente de 24 horas.

D-029. Al aceptar una oferta, se liberan inmediatamente las demás ofertas pendientes y vigentes del técnico. Sus solicitudes quedan PENDING, sin técnico asignado. Las ofertas liberadas se registran como RELEASED y las ya vencidas como EXPIRED.

Los reintentos de PATCH autorizados conservan las fechas originales y evitan efectos duplicados.

Los conflictos de estado producen HTTP 409.

La recepción de dos peticiones simultáneas debe mantener una única asignación y un trabajo activo por técnico.

GET /api/tecnicos comprueba que category y neighborhoodId coincidan con requestId cuando este se informa.

El cliente debe ser titular de la solicitud PENDING.

Un perfil técnico ACTIVE puede iniciar sesión y consultar su identidad y aprobación. Para ofertas y trabajos requiere APPROVED.

## Migraciones e índices

Versionar en Git los cambios de estructura y revisar el SQL, las claves, los índices y el impacto sobre datos existentes.

Con Prisma ORM 7, usar prisma migrate dev para generar y comprobar en desarrollo, y prisma migrate deploy para aplicar migraciones aprobadas en preproducción y producción.

prisma.config.ts configura la conexión. La carga inicial de catálogos se ejecuta con prisma db seed y con el entorno confirmado.

Índices parciales previstos. Incluir estos índices parciales en una migración SQL protege las reglas cuando hay operaciones simultáneas. Solo puede haber una oferta PENDING y una ACCEPTED por solicitud, y un solo trabajo activo por técnico.

Registrar primero como EXPIRED una oferta vencida permite crear otra sin usar la hora actual como condición del índice.

Si dos operaciones simultáneas entran en conflicto, Backend devuelve el error previsto en el contrato y revierte los cambios de la transacción que falló.

```sql
CREATE UNIQUE INDEX "ServiceOffer_one_pending_per_request"
  ON "ServiceOffer" ("requestId") WHERE "status" = 'PENDING';

CREATE UNIQUE INDEX "ServiceOffer_one_accepted_per_request"
  ON "ServiceOffer" ("requestId") WHERE "status" = 'ACCEPTED';

CREATE UNIQUE INDEX "ServiceRequest_one_active_per_technician"
  ON "ServiceRequest" ("technicianId")
  WHERE "technicianId" IS NOT NULL
  AND "status" IN ('ACCEPTED', 'IN_PROGRESS');

CREATE UNIQUE INDEX "User_email_case_insensitive"
  ON "User" (lower("email"));

ALTER TABLE "User" ADD CONSTRAINT "User_phone_by_role"
  CHECK (("role" = 'CLIENT' AND "phone" IS NOT NULL
  AND length(trim("phone")) > 0)
  OR ("role" IN ('TECHNICIAN', 'ADMIN') AND "phone" IS NULL));
```

El índice de email garantiza unicidad sin distinguir mayúsculas, incluso ante registros simultáneos. Antes de implementar las restricciones se revisan posibles duplicados y registros anteriores. Este documento describe el SQL previsto; su aplicación requiere una migración autorizada.

## Correspondencia con el embudo de adquisición

El modelo conserva User.createdAt y User.role. Estos campos permiten contar los registros por fecha y por rol CLIENT o TECHNICIAN, de acuerdo con el Mapeo del Embudo de Adquisición.

Los eventos de vistas, intentos y resultados de autenticación corresponden a la definición de telemetría y a su mecanismo de captura. No se incorpora una tabla histórica de logins en el MVP.

**R1 — Último login.** `User.lastLoginAt` es un campo `DateTime?` con precisión de milisegundos y zona horaria. Permanece en `null` hasta el primer login exitoso. En cada autenticación correcta, Backend obtiene el valor anterior para la respuesta de `POST /api/auth/login` y registra la fecha y hora del login actual. Las consultas posteriores a `GET /api/usuarios/me` devuelven el último login registrado. Los intentos fallidos no modifican el campo.

**R2 — Cuentas de prueba.** `User.isTestUser` es un campo `Boolean` con valor predeterminado `false`. Permite identificar cuentas de prueba y excluirlas de las consultas de métricas correspondientes. No puede establecerse ni modificarse desde el registro público. La identificación y administración de cuentas de prueba debe realizarse mediante un mecanismo autorizado. No se requiere registrar eventos adicionales por cada login.

La fecha de creación de la cuenta es el hecho persistido que confirma el registro. El rol se conserva en User.role. Los resultados de login y los errores se comunican mediante las respuestas del contrato API.
