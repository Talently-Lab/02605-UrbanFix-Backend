# Contrato de API — UrbanFix Solutions (v.2)

Este contrato utiliza la estructura de operaciones, parámetros, cuerpos y respuestas de OpenAPI, la semántica HTTP de RFC 9110 y el formato de errores de RFC 9457. [OpenAPI](https://spec.openapis.org/oas/latest.html), [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html), [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html).

## 1. Inventario de endpoints

Auth indica quién puede acceder. «No» significa acceso público. Las condiciones específicas de cada rol se detallan en los contratos individuales.

| Método | Ruta                               | Descripción                                                                    | Auth               |
| ------ | ---------------------------------- | ------------------------------------------------------------------------------ | ------------------ |
| POST   | /api/auth/register                 | Registrar una cuenta Cliente o Técnico.                                        | No                 |
| POST   | /api/auth/login                    | Autenticar una cuenta y obtener un JWT.                                        | No                 |
| GET    | /api/usuarios/me                   | Consultar la identidad y el estado de la cuenta propia.                        | Cuenta autenticada |
| PATCH  | /api/usuarios/me                   | Editar el nombre propio y, solo para CLIENT, el teléfono propio.               | Cuenta autenticada |
| GET    | /api/especialidades                | Consultar especialidades y requisitos de matrícula.                            | No                 |
| GET    | /api/barrios                       | Consultar el catálogo de barrios de CABA.                                      | No                 |
| GET    | /api/tecnicos                      | Buscar técnicos aprobados y disponibles para el servicio y barrio.             | Cliente            |
| POST   | /api/solicitudes                   | Crear una solicitud propia y enviar la oferta al técnico elegido.              | Cliente            |
| GET    | /api/solicitudes/mias              | Consultar las solicitudes propias.                                             | Cliente            |
| GET    | /api/solicitudes                   | Consultar las ofertas vigentes dirigidas al técnico.                           | Técnico            |
| GET    | /api/solicitudes/:id               | Consultar una solicitud según titularidad, oferta o asignación.                | Cliente o Técnico  |
| POST   | /api/solicitudes/:id/ofertas       | Enviar otra oferta para una solicitud propia PENDING, sin oferta vigente.      | Cliente            |
| PATCH  | /api/solicitudes/:id/aceptar       | Aceptar una oferta vigente y asignar la solicitud al técnico.                  | Técnico            |
| PATCH  | /api/solicitudes/:id/rechazar      | Rechazar una oferta vigente dirigida al técnico.                               | Técnico            |
| GET    | /api/tecnico/trabajos              | Consultar los trabajos asignados y su historial.                               | Técnico            |
| PATCH  | /api/solicitudes/:id/iniciar       | Pasar una solicitud asignada de ACCEPTED a IN_PROGRESS.                        | Técnico            |
| PATCH  | /api/solicitudes/:id/completar     | Pasar una solicitud asignada de IN_PROGRESS a COMPLETED.                       | Técnico            |
| PATCH  | /api/solicitudes/:id/cancelar      | Cancelar según rol, titularidad y estado permitido.                            | Cliente o Admin    |
| GET    | /api/admin/usuarios                | Consultar el listado de cuentas para administración.                           | Admin              |
| GET    | /api/admin/solicitudes             | Consultar todas las solicitudes con barrio y sin dirección exacta ni teléfono. | Admin              |
| GET    | /api/admin/tecnicos                | Consultar los perfiles técnicos para revisión.                                 | Admin              |
| GET    | /api/admin/tecnicos/:id            | Consultar un perfil técnico para evaluar su aprobación.                        | Admin              |
| PATCH  | /api/admin/tecnicos/:id/aprobacion | Aprobar o rechazar un perfil técnico.                                          | Admin              |
| PATCH  | /api/admin/usuarios/:id/suspender  | Suspender una cuenta Cliente o Técnico.                                        | Admin              |
| PATCH  | /api/admin/usuarios/:id/reactivar  | Reactivar una cuenta Cliente o Técnico suspendida.                             | Admin              |

## 2. Contratos individuales

### BLOQUE 1A — CONVENCIONES DE ENTRADA Y SALIDA

Todas las rutas comienzan con /api.

Los bodies utilizan Content-Type application/json. Las respuestas exitosas con contenido utilizan el mismo formato.

Las rutas protegidas requieren Authorization con el formato `Bearer <token>`. Backend comprueba la identidad, el estado actual de la cuenta, el rol y las condiciones de cada operación.

Los campos de entrada admitidos se indican en cada contrato. Backend rechaza los campos adicionales para impedir que el cliente modifique atributos como clientId, accountStatus o estados internos.

Los UUID se transmiten como strings. Los parámetros :id son obligatorios y deben contener un UUID válido.

Los campos obligatorios de entrada no admiten null. Los campos opcionales de texto pueden omitirse. Cuando se omiten, se almacenan y devuelven como null. Si se envían explícitamente como null, vacíos o compuestos únicamente por espacios, Backend devuelve HTTP 400. Este criterio incluye floor, apartment, directions y licenseNumber cuando sea opcional.

Los ejemplos de listas muestran un elemento. Una consulta sin resultados devuelve [].

Los campos indicados en cada respuesta forman su estructura de salida. Los campos que admiten null siguen presentes aunque no tengan valor.

Los datos de los ejemplos son ficticios.

**Política de email**

- Frontend puede convertir el email a minúsculas antes de enviarlo.
- Backend rechaza con HTTP 400 cualquier email que contenga mayúsculas, tanto en el registro como en el login.
- Un registro con un email existente devuelve HTTP 409.
- La base de datos garantiza la unicidad, incluso ante registros simultáneos.

Backend valida el valor recibido y lo rechaza si contiene mayúsculas, espacios o un formato de email inválido. La respuesta utiliza /problems/validation-error e identifica email en errors. El servidor conserva el email aceptado tal como fue enviado, en minúsculas.

La comprobación de duplicados y la búsqueda de la cuenta utilizan una comparación de email sin distinguir mayúsculas y minúsculas. La restricción de unicidad de persistencia aplica el mismo criterio para evitar variantes duplicadas y condiciones de carrera. Antes de implementar esa restricción se verifican posibles duplicados en registros existentes. Cualquier corrección de esos registros requiere autorización específica.

**Prioridad de validación y errores**

En rutas protegidas, Backend comprueba el token y el estado actual de la cuenta, y después verifica el rol y la aprobación requeridos. Una autenticación ausente, inválida o vencida produce HTTP 401. Una cuenta suspendida, un rol sin permiso o una aprobación insuficiente producen HTTP 403.

Las entradas con UUID mal formado, enum inválido o campos que incumplen su validación producen HTTP 400. Las referencias con UUID válido que no existen y los recursos fuera de la visibilidad del actor producen HTTP 404.

Una vez comprobada la relación del actor con el recurso, los estados incompatibles producen HTTP 409. Los reintentos exitosos descritos en cada operación devuelven HTTP 200, conservan las fechas originales y evitan repetir efectos secundarios.

En los reintentos se comprueba primero si el efecto solicitado ya quedó aplicado por el actor autorizado y si el estado actual admite la repetición descrita. La aceptación repetida reconoce el trabajo asignado a ese mismo técnico y conserva la aceptación original.

Para aceptar o rechazar una oferta, Backend identifica al destinatario mediante el historial antes de comprobar la vigencia. Esto permite devolver HTTP 409 por una oferta vencida, liberada o cancelada, o HTTP 200 por un reintento exitoso. La lectura del detalle antes de aceptar sigue limitada a ofertas vigentes dirigidas al técnico.

### BLOQUE 1B — TIPOS Y VALORES COMUNES

UUID

String que identifica una cuenta, perfil técnico, barrio, solicitud u oferta.

Fecha

String en ISO 8601, UTC y con milisegundos. Ejemplo 2026-11-18T12:00:00.000Z.

UserRole

CLIENT, TECHNICIAN o ADMIN. El registro público admite CLIENT y TECHNICIAN.

AccountStatus

Estado de la cuenta. Admite ACTIVE o SUSPENDED. Las cuentas nuevas se crean con ACTIVE.

TechnicianApprovalStatus

PENDING, APPROVED o REJECTED.

ServiceCategory

ELECTRICITY, PLUMBING, GAS, LOCKSMITH o MASONRY.

ServiceRequestStatus

PENDING, ACCEPTED, IN_PROGRESS, COMPLETED o CANCELLED.

El flujo principal es PENDING (Pendiente) → ACCEPTED (Aceptada) → IN_PROGRESS (En curso) → COMPLETED (Completada). «Finalizada» corresponde al mismo estado COMPLETED. CANCELLED (Cancelada) se alcanza únicamente mediante las cancelaciones permitidas para cada rol.

PreferredTime

Preferencia informativa de horario. MORNING significa mañana, AFTERNOON significa tarde y ANY significa «Me da lo mismo». El valor predeterminado es ANY.

ServiceOfferStatus

PENDING, ACCEPTED, REJECTED, EXPIRED, RELEASED y CANCELLED.

RELEASED identifica las ofertas liberadas por D-029. CANCELLED identifica las ofertas pendientes y vigentes que se cierran al cancelar su solicitud. REJECTED conserva un rechazo y EXPIRED conserva el vencimiento sin respuesta.

### BLOQUE 1C — REGLAS COMUNES DE ACCESO

CLIENT consulta sus propias solicitudes y solo puede cancelarlas cuando están PENDING.

Cada cliente puede mantener varias solicitudes activas al mismo tiempo, sin límite de cantidad en el MVP.

El MVP no muestra precios ni tiempos estimados del servicio.

TECHNICIAN debe tener una cuenta activa y un perfil APPROVED para operar con ofertas y trabajos. Backend comprueba que sea destinatario de la oferta o técnico asignado, según la operación.

ADMIN consulta todas las solicitudes. Puede cancelarlas en PENDING o ACCEPTED por moderación, y en IN_PROGRESS únicamente en casos excepcionales.

ADMIN puede suspender y reactivar cuentas CLIENT y TECHNICIAN.

La dirección exacta comprende calle, número, piso, departamento e indicaciones. D-043. Se comparte con el técnico asignado únicamente durante ACCEPTED e IN_PROGRESS, junto con el teléfono del cliente. Ambos datos quedan excluidos de sus respuestas en COMPLETED y CANCELLED.

El teléfono se almacena en User.phone. Es obligatorio en el registro de CLIENT y TECHNICIAN y queda en null para ADMIN. Solo CLIENT puede editarlo; el teléfono técnico no es editable en el MVP. La solicitud accede al teléfono del cliente mediante su relación con User y al del técnico mediante Technician.user. El teléfono técnico es visible para el cliente titular después de aceptar la solicitud.

ADMIN nunca recibe la dirección exacta ni el teléfono del cliente. El barrio es su único dato de ubicación. Para moderar utiliza el email de la cuenta.

El JWT tiene una vigencia de 1 hora desde su emisión. expiresIn se expresa en segundos y vale 3600.

**Correspondencia con el embudo de adquisición**

El registro exitoso devuelve HTTP 201 e identifica la cuenta y su role. El login exitoso devuelve HTTP 200, el JWT y el rol de la cuenta. Los errores se distinguen mediante type; Frontend muestra detail y utiliza errors para los campos del formulario.

User.createdAt y User.role se conservan en el modelo de datos para contar registros por fecha y rol. La captura de eventos del embudo se define en la documentación de telemetría y no introduce campos ni permisos adicionales en estos contratos.

R1 — lastLogin. UF-S4-043 como lastLogin. Se implementa como lastLoginAt y representa explícitamente una fecha y hora. Se incorpora a las respuestas de registro, login e identidad propia, conforme a los contratos individuales.

R2 — Cuentas de prueba. Incorpora un identificador para distinguir las cuentas de prueba y excluirlas de las consultas de métricas. El modelo de datos se aplica como isTestUser, cuya denominación deberá mantenerse alineada con la implementación. La exclusión se realiza en las consultas de métricas, sin registrar datos adicionales por cada login.
La exclusión de cuentas suspendidas de las métricas y el historial de logins quedan para post-MVP. No se incorpora el período de siete días.

### BLOQUE 2 — REGISTRO DE CLIENTE

#### `POST /api/auth/register`

**Actor y respuesta HTTP**

Público. Registra una cuenta CLIENT y devuelve HTTP 201.

**Body JSON**

```json
{
  "name": "Ana Pérez",
  "email": "ana@example.com",
  "password": "EjemploSeguro123!",
  "phone": "+5491100000000",
  "role": "CLIENT"
}
```

Todos los campos son obligatorios.

name es un string no vacío.

email es un string con formato email, debe enviarse íntegramente en minúsculas y debe ser único según la política de email de las convenciones. Las mayúsculas producen HTTP 400 y un email existente produce HTTP 409.

password es un string de al menos 8 caracteres.

phone es un string obligatorio que contiene el teléfono del cliente en formato internacional, con el signo + seguido del prefijo de país y el número. Admite entre 2 y 15 dígitos en total, con el primer dígito distinto de cero. Se envía sin espacios, guiones ni paréntesis. Backend valida el formato antes de guardarlo.

role debe contener CLIENT para esta variante de registro.

**Respuesta JSON**

```json
{
  "id": "00000000-0000-4000-8000-000000000001",
  "name": "Ana Pérez",
  "email": "ana@example.com",
  "role": "CLIENT",
  "accountStatus": "ACTIVE",
  "technician": null,
  "lastLoginAt": null,
  "isTestUser": false
}
```

id es UUID. name y email son strings. role es UserRole y accountStatus es AccountStatus.

technician es null para CLIENT.

lastLoginAt es una Fecha o null. En una cuenta recién registrada es null porque todavía no inició sesión.

isTestUser es un booleano que identifica si la cuenta corresponde a una cuenta de prueba. El valor false representa una cuenta normal.

Los campos lastLoginAt e isTestUser son de solo lectura en este endpoint. No se admiten en el body del registro público.

El registro no entrega un token. La contraseña se guarda hasheada y passwordHash queda excluido de las respuestas.

Un nuevo intento con un email ya registrado devuelve conflicto y no crea otra cuenta.

### BLOQUE 3 — REGISTRO DE TÉCNICO

#### `POST /api/auth/register`

**Actor y respuesta HTTP**

Público. Registra una cuenta TECHNICIAN y su perfil. Devuelve HTTP 201.

**Body JSON**

```json
{
  "name": "Luis Gómez",
  "email": "luis@example.com",
  "password": "EjemploSeguro123!",
  "role": "TECHNICIAN",
  "phone": "+5491122222222",
  "specialties": [
    {
      "category": "ELECTRICITY",
      "licenseNumber": "MAT-0001"
    }
  ],
  "neighborhoodIds": ["00000000-0000-4000-8000-000000000004"]
}
```

name, email, password y role siguen los tipos del registro de Cliente. La política de email en minúsculas y unicidad se aplica también a TECHNICIAN. role debe ser TECHNICIAN. phone es obligatorio y utiliza el mismo formato internacional validado para CLIENT. El teléfono técnico no es editable en el MVP y se comparte con el cliente titular después de aceptar la solicitud.

specialties es un array obligatorio con al menos una especialidad. category es ServiceCategory. Las categorías no pueden repetirse.

licenseNumber es un string obligatorio y no vacío para GAS y ELECTRICITY. Para las demás especialidades puede omitirse.

neighborhoodIds es un array obligatorio con al menos un UUID del catálogo de CABA, sin duplicados.

Si un `neighborhoodId` tiene formato UUID válido, pero no existe en el catálogo de barrios de CABA, Backend devuelve HTTP 404. La operación se revierte completamente y no se crea la cuenta ni el perfil técnico.

**Respuesta JSON**

```json
{
  "id": "00000000-0000-4000-8000-000000000002",
  "name": "Luis Gómez",
  "email": "luis@example.com",
  "role": "TECHNICIAN",
  "accountStatus": "ACTIVE",
  "technician": {
    "id": "00000000-0000-4000-8000-000000000003",
    "approvalStatus": "PENDING"
  },
  "lastLoginAt": null,
  "isTestUser": false
}
```

technician es un objeto obligatorio para TECHNICIAN. Su id es UUID y approvalStatus es TechnicianApprovalStatus.

lastLoginAt es una Fecha o null. En una cuenta recién registrada es null porque todavía no inició sesión.

isTestUser es un booleano que identifica si la cuenta corresponde a una cuenta de prueba. El valor false representa una cuenta normal.

Backend registra cuenta, perfil, especialidades y barrios en una misma transacción. La aprobación es manual.

Un intento con email duplicado no crea perfiles ni relaciones adicionales.

Los campos lastLoginAt e isTestUser son de solo lectura en este endpoint. No se admiten en el body del registro público.

### BLOQUE 4 — LOGIN

#### `POST /api/auth/login`

**Actor y respuesta HTTP**

Público. Devuelve HTTP 200 cuando las credenciales son válidas y la cuenta está ACTIVE.

**Body JSON**

```json
{
  "email": "ana@example.com",
  "password": "EjemploSeguro123!"
}
```

email y password son strings obligatorios. email debe tener formato email y enviarse íntegramente en minúsculas. Backend devuelve HTTP 400 si contiene mayúsculas y HTTP 401 si las credenciales válidas en formato son incorrectas.

**Respuesta JSON**

```json
{
  "accessToken": "JWT_DE_EJEMPLO",
  "tokenType": "Bearer",
  "expiresIn": 3600,
  "user": {
    "id": "00000000-0000-4000-8000-000000000001",
    "name": "Ana Pérez",
    "email": "ana@example.com",
    "role": "CLIENT",
    "accountStatus": "ACTIVE",
    "technician": null,
    "lastLoginAt": "2026-11-20T18:00:00.000Z",
    "isTestUser": false
  }
}
```

accessToken es un string que contiene el JWT. tokenType contiene Bearer. expiresIn es un entero de segundos y vale 3600. El JWT vence 1 hora después de su emisión.

user tiene la estructura de identidad definida en el registro. Para TECHNICIAN incluye su perfil y approvalStatus.

lastLoginAt es una Fecha o null que representa el inicio de sesión exitoso anterior al login actual. En el primer login devuelve null. En este ejemplo, la cuenta había iniciado sesión previamente el 20 de noviembre de 2026.

Backend obtiene el valor anterior de lastLoginAt y lo incluye en la respuesta. Después de autenticar correctamente a la cuenta, registra la fecha y hora del login actual para futuras consultas. Un intento fallido no modifica este campo.

isTestUser es un booleano que identifica si la cuenta corresponde a una cuenta de prueba.

**Sesión y aprobación del perfil**

Los técnicos pendientes o rechazados pueden iniciar sesión para consultar su identidad y estado de aprobación. Las operaciones de ofertas y trabajos requieren APPROVED.

Después del registro, Frontend llama a este endpoint para iniciar sesión. Un fallo en el login no implica repetir el registro.

### BLOQUE 5 — IDENTIDAD PROPIA

#### `GET /api/usuarios/me`

**Actor y respuesta HTTP**

CLIENT, TECHNICIAN o ADMIN con sesión y cuenta activa. Devuelve HTTP 200.

**Body JSON**

No recibe body ni parámetros de query.

**Respuesta JSON**

```json
{
  "id": "00000000-0000-4000-8000-000000000002",
  "name": "Luis Gómez",
  "email": "luis@example.com",
  "role": "TECHNICIAN",
  "accountStatus": "ACTIVE",
  "technician": {
    "id": "00000000-0000-4000-8000-000000000003",
    "approvalStatus": "PENDING"
  },
  "lastLoginAt": "2026-11-21T18:00:00.000Z",
  "isTestUser": false
}
```

id es UUID. name y email son strings. role es UserRole y accountStatus es AccountStatus.

technician contiene id, de tipo UUID, y approvalStatus, de tipo TechnicianApprovalStatus.

Para CLIENT y ADMIN, technician es null.

lastLoginAt es una Fecha o null. Representa la fecha y hora del último login exitoso registrado en la base de datos. Si la cuenta nunca inició sesión, devuelve null.

isTestUser es un booleano que identifica si la cuenta corresponde a una cuenta de prueba.

Backend obtiene la identidad del JWT y consulta el estado actual de la cuenta. La respuesta excluye passwordHash.

### BLOQUE 5B — EDICIÓN DEL PERFIL PROPIO

#### `PATCH /api/usuarios/me`

**Actor y alcance**

D-040. CLIENT, TECHNICIAN o ADMIN con sesión y cuenta activa pueden editar su propio name. Únicamente CLIENT puede editar su propio phone. La cuenta se identifica desde la sesión.

**Body JSON**

Ejemplo para CLIENT:

```json
{
  "name": "Ana Pérez",
  "phone": "+5491100000000"
}
```

Para TECHNICIAN y ADMIN, el único campo editable es name. El teléfono del técnico se informa obligatoriamente al registrarse y no puede modificarse en el MVP.

name es un string no vacío, como en el registro. phone conserva el formato internacional del registro de CLIENT. La edición es parcial: los campos omitidos conservan su valor. No se admiten cambios de email, password, role, accountStatus, aprobación, especialidades, barrios ni otros campos mediante esta operación.

**Respuesta exitosa: HTTP 200 OK**

Devuelve los datos públicos actualizados del usuario, con la misma estructura y tipos de GET /api/usuarios/me. La respuesta excluye passwordHash.

**Errores de validación**

Un body vacío, incluido un objeto {}, o sin campos editables para el rol autenticado devuelve HTTP 400 Bad Request. También se rechaza cualquier campo no autorizado, aunque se envíe junto con campos válidos; no se aplica ninguna actualización parcial de esa petición.

Los errores utilizan Content-Type application/problem+json, RFC 9457 y las convenciones comunes de autenticación y validación. Ejemplo para un body vacío:

```json
{
  "type": "/problems/validation-error",
  "title": "Datos inválidos",
  "status": 400,
  "detail": "Revisá los campos indicados.",
  "errors": [
    {
      "field": "body",
      "detail": "Informá al menos un campo editable para tu rol."
    }
  ]
}
```

Cuando se envían campos no autorizados, errors identifica cada campo rechazado. Por ejemplo, phone no está autorizado para TECHNICIAN ni ADMIN, incluso si la petición también incluye name.

### BLOQUE 6 — CATÁLOGO DE ESPECIALIDADES

#### `GET /api/especialidades`

**Actor y respuesta HTTP**

Público. Devuelve HTTP 200.

**Body JSON**

No recibe body ni parámetros de query.

**Respuesta JSON**

```json
[
  {
    "category": "ELECTRICITY",
    "name": "Electricidad",
    "licenseRequired": true
  },
  {
    "category": "PLUMBING",
    "name": "Plomería",
    "licenseRequired": false
  },
  {
    "category": "GAS",
    "name": "Gas",
    "licenseRequired": true
  },
  {
    "category": "LOCKSMITH",
    "name": "Cerrajería",
    "licenseRequired": false
  },
  {
    "category": "MASONRY",
    "name": "Albañilería",
    "licenseRequired": false
  }
]
```

Cada elemento contiene category de tipo ServiceCategory, name de tipo string y licenseRequired de tipo boolean.

licenseRequired es true para GAS y ELECTRICITY.

### BLOQUE 7 — CATÁLOGO DE BARRIOS

#### `GET /api/barrios`

**Actor y respuesta HTTP**

Público. Devuelve HTTP 200.

**Body JSON**

No recibe body ni parámetros de query.

**Respuesta JSON**

```json
[
  {
    "id": "00000000-0000-4000-8000-000000000004",
    "name": "Caballito"
  }
]
```

Cada elemento contiene id de tipo UUID y name de tipo string.

La respuesta contiene los barrios del catálogo habilitado de CABA.

Los identificadores devueltos se utilizan en el registro técnico, la búsqueda de técnicos y la creación de solicitudes.

### BLOQUE 8 — BÚSQUEDA DE TÉCNICOS

#### `GET /api/tecnicos`

**Actor y respuesta HTTP**

CLIENT con cuenta activa. Devuelve HTTP 200.

**Body JSON**

No recibe body.

**Parámetros de query**

category es obligatorio y debe ser ServiceCategory.

neighborhoodId es obligatorio y debe ser un UUID del catálogo.

requestId es un UUID opcional. Se envía cuando la búsqueda corresponde a una solicitud existente. Backend verifica que pertenezca al cliente y esté PENDING. Además, category y neighborhoodId deben coincidir exactamente con los valores guardados en esa solicitud. Si alguno difiere, devuelve HTTP 400 con type /problems/validation-error e identifica el parámetro afectado en errors.

**Ejemplo de consulta**

/api/tecnicos?category=ELECTRICITY&neighborhoodId=00000000-0000-4000-8000-000000000004

**Respuesta JSON**

```json
[
  {
    "id": "00000000-0000-4000-8000-000000000003",
    "name": "Luis Gómez",
    "specialties": ["ELECTRICITY"],
    "neighborhoods": [
      {
        "id": "00000000-0000-4000-8000-000000000004",
        "name": "Caballito"
      }
    ]
  }
]
```

id identifica Technician. name es string. specialties es un array de ServiceCategory. neighborhoods es un array de objetos con id UUID y name string.

Solo aparecen técnicos aprobados, con cuenta activa, que coinciden con el servicio y el barrio y no tienen trabajos ACCEPTED o IN_PROGRESS.

Con requestId, también se excluyen quienes rechazaron esa solicitud o dejaron vencer su oferta. El horario preferido no interviene en la búsqueda.

### BLOQUE 9A — CREACIÓN DE SOLICITUD

#### `POST /api/solicitudes`

**Actor y respuesta HTTP**

CLIENT con cuenta activa. Devuelve HTTP 201.

**Encabezado de respuesta**

Location contiene /api/solicitudes/{id}, utilizando el UUID de la solicitud creada.

**Body JSON**

```json
{
  "category": "ELECTRICITY",
  "neighborhoodId": "00000000-0000-4000-8000-000000000004",
  "street": "Calle de ejemplo",
  "streetNumber": "123",
  "floor": "2",
  "apartment": "B",
  "directions": "Tocar el timbre del departamento.",
  "description": "Necesito revisar un enchufe que dejó de funcionar.",
  "preferredTime": "ANY",
  "technicianId": "00000000-0000-4000-8000-000000000003"
}
```

**Campos obligatorios**

category debe ser ServiceCategory.

neighborhoodId debe ser un UUID del catálogo de CABA.

street y streetNumber son strings no vacíos. streetNumber admite S/N.

description es un string de 20 a 500 caracteres.

technicianId es el UUID de un técnico aprobado y disponible que coincida con el servicio y el barrio.

**Campos opcionales**

floor, apartment y directions son strings no vacíos cuando se informan. Si se omiten, quedan en null.

preferredTime admite MORNING, AFTERNOON o ANY. Si se omite, utiliza ANY.

clientId se obtiene de la sesión. El teléfono se obtiene de la cuenta del cliente.

**Integración del formulario de Frontend**

El formulario envía street, streetNumber, floor, apartment y directions como los campos separados de este body. Sus agrupaciones visuales «Calle y número» y «Piso y depto» deben conservar los valores necesarios para preparar esa estructura. El envío unificado en addressLine corresponde al borrador anterior. Frontend debe adaptar ese payload a los campos de dirección definidos en esta versión.

### BLOQUE 9B — RESPUESTA DE CREACIÓN

#### `POST /api/solicitudes`

**Respuesta JSON**

```json
{
  "id": "00000000-0000-4000-8000-000000000005",
  "status": "PENDING",
  "createdAt": "2026-11-18T12:00:00.000Z",
  "offer": {
    "id": "00000000-0000-4000-8000-000000000006",
    "technicianId": "00000000-0000-4000-8000-000000000003",
    "status": "PENDING",
    "createdAt": "2026-11-18T12:00:00.000Z",
    "expiresAt": "2026-11-19T12:00:00.000Z"
  }
}
```

id identifica la solicitud. status es ServiceRequestStatus y createdAt es Fecha.

offer contiene id y technicianId de tipo UUID, status de tipo ServiceOfferStatus y createdAt y expiresAt de tipo Fecha.

La solicitud y la oferta se crean en una misma transacción. La solicitud queda PENDING y sin técnico asignado hasta que se acepte la oferta.

La vigencia es de 24 horas corridas desde que la oferta queda disponible para el técnico.

Cada POST exitoso crea una solicitud nueva. Repetir el mismo body puede crear otra solicitud, porque el MVP permite varias solicitudes activas por cliente, sin límite de cantidad. Esta operación no utiliza una clave de idempotencia.

### BLOQUE 10 — SOLICITUDES DEL CLIENTE

#### `GET /api/solicitudes/mias`

**Actor y respuesta HTTP**

CLIENT con cuenta activa. Devuelve HTTP 200.

**Body JSON**

No recibe body ni parámetros de query.

**Respuesta JSON**

```json
[
  {
    "id": "00000000-0000-4000-8000-000000000005",
    "category": "ELECTRICITY",
    "description": "Necesito revisar un enchufe que dejó de funcionar.",
    "neighborhoodId": "00000000-0000-4000-8000-000000000004",
    "neighborhoodName": "Caballito",
    "preferredTime": "ANY",
    "status": "ACCEPTED",
    "technicianId": "00000000-0000-4000-8000-000000000003",
    "technicianName": "Luis Gómez",
    "createdAt": "2026-11-18T12:00:00.000Z",
    "acceptedAt": "2026-11-18T13:00:00.000Z"
  }
]
```

id y neighborhoodId son UUID. category es ServiceCategory, preferredTime es PreferredTime y status es ServiceRequestStatus.

description, neighborhoodName y technicianName son strings.

technicianId, technicianName y acceptedAt admiten null mientras no haya una aceptación.

createdAt es Fecha y acceptedAt es Fecha o null.

Solo devuelve solicitudes del cliente autenticado. Los nombres de barrio y técnico se incluyen en la misma respuesta. Backend carga las relaciones necesarias para el listado sin ejecutar una consulta adicional por cada fila.

### BLOQUE 11 — OFERTAS RECIBIDAS

#### `GET /api/solicitudes`

**Actor y respuesta HTTP**

TECHNICIAN aprobado y con cuenta activa. Devuelve HTTP 200.

**Body JSON**

No recibe body ni parámetros de query.

**Respuesta JSON**

```json
[
  {
    "id": "00000000-0000-4000-8000-000000000005",
    "category": "ELECTRICITY",
    "description": "Necesito revisar un enchufe que dejó de funcionar.",
    "neighborhoodId": "00000000-0000-4000-8000-000000000004",
    "neighborhoodName": "Caballito",
    "preferredTime": "ANY",
    "status": "PENDING",
    "offer": {
      "id": "00000000-0000-4000-8000-000000000006",
      "status": "PENDING",
      "createdAt": "2026-11-18T12:00:00.000Z",
      "expiresAt": "2026-11-19T12:00:00.000Z"
    }
  }
]
```

Los identificadores son UUID. category, preferredTime y los estados utilizan sus enums. description y neighborhoodName son strings. Las fechas son Fecha.

Solo devuelve ofertas dirigidas al técnico, asociadas a solicitudes PENDING y vigentes en el momento de la consulta.

Una oferta es vigente si su estado es PENDING y la hora actual es anterior a expiresAt. Una oferta vencida queda excluida aunque todavía no se haya persistido EXPIRED.

La dirección exacta y el teléfono quedan excluidos.

### BLOQUE 12A — DETALLE GENERAL DE SOLICITUD

#### `GET /api/solicitudes/:id`

**Actor y respuesta HTTP**

CLIENT titular o TECHNICIAN aprobado, destinatario de una oferta vigente o asignado al trabajo. Requiere cuenta activa. Devuelve HTTP 200.

**Body JSON**

No recibe body. :id es el UUID de ServiceRequest.

**Respuesta JSON del cliente titular o del técnico antes de aceptar**

```json
{
  "id": "00000000-0000-4000-8000-000000000005",
  "category": "ELECTRICITY",
  "description": "Necesito revisar un enchufe que dejó de funcionar.",
  "neighborhoodId": "00000000-0000-4000-8000-000000000004",
  "neighborhoodName": "Caballito",
  "preferredTime": "ANY",
  "status": "PENDING",
  "technicianId": null,
  "technicianName": null,
  "createdAt": "2026-11-18T12:00:00.000Z",
  "acceptedAt": null,
  "completedAt": null,
  "cancelledAt": null
}
```

Los identificadores son UUID. description, neighborhoodName y technicianName son strings. Los estados y categorías utilizan sus enums.

technicianId y technicianName admiten null.

createdAt siempre es Fecha. acceptedAt, completedAt y cancelledAt son Fecha o null, según los eventos registrados.

La respuesta del técnico con oferta vigente queda limitada a la solicitud dirigida a él.

Para el CLIENT titular, el detalle incorpora technicianPhone, un string obtenido de Technician.user.phone, después de aceptar la solicitud. No se entrega antes de la aceptación. D-043 regula por separado el acceso del técnico a los datos del cliente.

### BLOQUE 12B — DETALLE PARA EL TÉCNICO QUE ACEPTÓ

#### `GET /api/solicitudes/:id`

**Respuesta JSON para el técnico asignado con solicitud ACCEPTED o IN_PROGRESS**

```json
{
  "id": "00000000-0000-4000-8000-000000000005",
  "category": "ELECTRICITY",
  "description": "Necesito revisar un enchufe que dejó de funcionar.",
  "neighborhoodId": "00000000-0000-4000-8000-000000000004",
  "neighborhoodName": "Caballito",
  "preferredTime": "ANY",
  "status": "ACCEPTED",
  "technicianId": "00000000-0000-4000-8000-000000000003",
  "technicianName": "Luis Gómez",
  "createdAt": "2026-11-18T12:00:00.000Z",
  "acceptedAt": "2026-11-18T13:00:00.000Z",
  "completedAt": null,
  "cancelledAt": null,
  "address": {
    "street": "Calle de ejemplo",
    "streetNumber": "123",
    "floor": "2",
    "apartment": "B",
    "directions": "Tocar el timbre del departamento."
  },
  "clientPhone": "+5491100000000"
}
```

Los campos generales siguen los tipos del bloque anterior.

address es un objeto. street y streetNumber son strings. floor, apartment y directions son strings o null.

clientPhone es un string obtenido de la cuenta del cliente.

La dirección exacta y el teléfono solo se entregan después de comprobar que el técnico autenticado es el asignado y que la solicitud está ACCEPTED o IN_PROGRESS (D-043).

Este ejemplo documenta la entrega de address y clientPhone durante ACCEPTED e IN_PROGRESS.

D-043. En COMPLETED y CANCELLED se excluyen address y clientPhone de las respuestas al técnico, incluido el detalle y el historial.

### BLOQUE 13 — ENVÍO DE OTRA OFERTA

#### `POST /api/solicitudes/:id/ofertas`

**Actor y respuesta HTTP**

CLIENT titular, con cuenta activa. La solicitud debe estar PENDING, sin asignación y sin otra oferta vigente. Devuelve HTTP 201.

**Body JSON**

```json
{
  "technicianId": "00000000-0000-4000-8000-000000000003"
}
```

technicianId es obligatorio y debe ser UUID. :id identifica ServiceRequest.

El técnico debe estar aprobado, tener cuenta activa, estar disponible y coincidir con el servicio y el barrio.

**Respuesta JSON**

```json
{
  "id": "00000000-0000-4000-8000-000000000006",
  "requestId": "00000000-0000-4000-8000-000000000005",
  "technicianId": "00000000-0000-4000-8000-000000000003",
  "status": "PENDING",
  "createdAt": "2026-11-18T12:00:00.000Z",
  "expiresAt": "2026-11-19T12:00:00.000Z"
}
```

id, requestId y technicianId son UUID. status es ServiceOfferStatus. createdAt y expiresAt son Fecha.

REJECTED y EXPIRED excluyen al técnico de esa solicitud según RN-008. RELEASED no representa un rechazo ni un vencimiento.

La creación se realiza bajo control de concurrencia. Dos envíos simultáneos no pueden generar dos ofertas pendientes para la misma solicitud.

Un reintento mientras ya existe una oferta vigente devuelve conflicto.

### BLOQUE 14 — ACEPTACIÓN DE OFERTA

#### `PATCH /api/solicitudes/:id/aceptar`

**Actor y respuesta HTTP**

TECHNICIAN aprobado, con cuenta activa y destinatario de una oferta vigente. Debe estar libre de trabajos ACCEPTED o IN_PROGRESS. Devuelve HTTP 200.

**Body JSON**

No recibe body. :id es el UUID de ServiceRequest.

**Respuesta JSON**

```json
{
  "id": "00000000-0000-4000-8000-000000000005",
  "status": "ACCEPTED",
  "technicianId": "00000000-0000-4000-8000-000000000003",
  "acceptedAt": "2026-11-18T13:00:00.000Z",
  "offer": {
    "id": "00000000-0000-4000-8000-000000000006",
    "status": "ACCEPTED"
  }
}
```

Los identificadores son UUID. Los estados utilizan sus enums. acceptedAt es Fecha.

D-029. La aceptación libera inmediatamente las demás ofertas pendientes y vigentes del técnico, que pasan a RELEASED. Sus solicitudes quedan PENDING y sin técnico asignado. Las ofertas que ya vencieron se registran como EXPIRED.

La aceptación, asignación y liberación forman una misma transacción.

**Reintentos**

Si la solicitud sigue ACCEPTED y ya pertenece al mismo técnico por esa oferta, devuelve HTTP 200 con la aceptación original. Conserva acceptedAt y no vuelve a liberar ofertas.

Si cambió a otro estado, el reintento devuelve conflicto.

El control de concurrencia impide asignar dos técnicos a una solicitud o dos trabajos activos al mismo técnico.

### BLOQUE 15 — RECHAZO DE OFERTA

#### `PATCH /api/solicitudes/:id/rechazar`

**Actor y respuesta HTTP**

TECHNICIAN aprobado, con cuenta activa y destinatario de una oferta vigente. RN-016 también establece la condición de no tener otro trabajo activo. Devuelve HTTP 200.

**Body JSON**

No recibe body. :id es el UUID de ServiceRequest.

**Respuesta JSON**

```json
{
  "requestId": "00000000-0000-4000-8000-000000000005",
  "offerId": "00000000-0000-4000-8000-000000000006",
  "status": "REJECTED"
}
```

requestId y offerId son UUID. status es ServiceOfferStatus.

RN-008. La solicitud queda PENDING y sin técnico asignado. El técnico queda excluido de esa solicitud y puede recibir otras.

Backend conserva el motivo mediante REJECTED. La falta de respuesta durante 24 horas se registra como EXPIRED.

**Reintentos**

Si esa oferta ya fue rechazada por el mismo técnico, devuelve HTTP 200 con el rechazo registrado. No modifica la solicitud ni las ofertas posteriores.

Si la oferta fue aceptada, venció, se liberó o se canceló, el rechazo devuelve conflicto.

### BLOQUE 16 — TRABAJOS DEL TÉCNICO

#### `GET /api/tecnico/trabajos`

**Actor y respuesta HTTP**

TECHNICIAN aprobado y con cuenta activa. Devuelve HTTP 200.

**Body JSON**

No recibe body ni parámetros de query.

**Respuesta JSON**

```json
[
  {
    "id": "00000000-0000-4000-8000-000000000005",
    "category": "ELECTRICITY",
    "description": "Necesito revisar un enchufe que dejó de funcionar.",
    "neighborhoodId": "00000000-0000-4000-8000-000000000004",
    "neighborhoodName": "Caballito",
    "preferredTime": "ANY",
    "status": "ACCEPTED",
    "acceptedAt": "2026-11-18T13:00:00.000Z",
    "completedAt": null,
    "cancelledAt": null
  }
]
```

Los identificadores son UUID. category, preferredTime y status utilizan sus enums.

description y neighborhoodName son strings.

acceptedAt es Fecha. completedAt y cancelledAt son Fecha o null.

Solo devuelve solicitudes que fueron asignadas al técnico autenticado. Incluye trabajos activos y su historial de trabajos completados o cancelados después de la aceptación.

El detalle de cada solicitud se consulta mediante GET /api/solicitudes/:id.

### BLOQUE 17 — INICIO DEL TRABAJO

#### `PATCH /api/solicitudes/:id/iniciar`

**Actor y respuesta HTTP**

TECHNICIAN asignado, aprobado y con cuenta activa. La solicitud debe estar ACCEPTED. Devuelve HTTP 200.

**Body JSON**

No recibe body. :id es el UUID de ServiceRequest.

**Respuesta JSON**

```json
{
  "id": "00000000-0000-4000-8000-000000000005",
  "status": "IN_PROGRESS",
  "technicianId": "00000000-0000-4000-8000-000000000003",
  "updatedAt": "2026-11-18T14:00:00.000Z"
}
```

id y technicianId son UUID. status es ServiceRequestStatus. updatedAt es Fecha.

RN-026. Solo el técnico que aceptó puede cambiar la solicitud de ACCEPTED a IN_PROGRESS.

**Reintentos**

Si ya está IN_PROGRESS y pertenece al mismo técnico, devuelve HTTP 200 sin repetir la transición ni modificar updatedAt.

En otros estados, la operación devuelve conflicto.

### BLOQUE 18 — FINALIZACIÓN DEL TRABAJO

#### `PATCH /api/solicitudes/:id/completar`

**Actor y respuesta HTTP**

TECHNICIAN asignado, aprobado y con cuenta activa. La solicitud debe estar IN_PROGRESS. Devuelve HTTP 200.

**Body JSON**

No recibe body. :id es el UUID de ServiceRequest.

**Respuesta JSON**

```json
{
  "id": "00000000-0000-4000-8000-000000000005",
  "status": "COMPLETED",
  "technicianId": "00000000-0000-4000-8000-000000000003",
  "completedAt": "2026-11-18T16:00:00.000Z"
}
```

id y technicianId son UUID. status es ServiceRequestStatus. completedAt es Fecha.

D-028. Solo el técnico asignado puede completar la solicitud desde IN_PROGRESS.

La finalización y su fecha se registran en una misma operación. El trabajo deja de contar como activo para la disponibilidad del técnico.

**Reintentos**

Si la solicitud ya está COMPLETED y corresponde al mismo técnico, devuelve HTTP 200 con completedAt original. No repite la finalización.

### BLOQUE 19 — CANCELACIÓN DE SOLICITUD

#### `PATCH /api/solicitudes/:id/cancelar`

**Actor y respuesta HTTP**

CLIENT titular, únicamente desde PENDING, según D-025.

ADMIN desde PENDING o ACCEPTED por moderación. Desde IN_PROGRESS, únicamente en casos excepcionales, según D-026.

Requiere cuenta activa. Devuelve HTTP 200.

**Body JSON**

No recibe body. :id es el UUID de ServiceRequest.

**Respuesta JSON**

```json
{
  "id": "00000000-0000-4000-8000-000000000005",
  "status": "CANCELLED",
  "cancelledAt": "2026-11-18T12:30:00.000Z",
  "cancelledById": "00000000-0000-4000-8000-000000000001"
}
```

id y cancelledById son UUID. status es ServiceRequestStatus. cancelledAt es Fecha.

Backend obtiene cancelledById de la sesión.

**Cierre de ofertas por cancelación**

Las ofertas pendientes que ya vencieron pasan a EXPIRED. Las pendientes todavía vigentes pasan a CANCELLED. Las aceptaciones anteriores se conservan como historial.

La cancelación y el cierre de ofertas forman una misma transacción.

**Reintentos**

Si ya fue cancelada por la misma cuenta, devuelve HTTP 200 con la cancelación original.

Las solicitudes COMPLETED no admiten cancelación. Una carrera entre aceptar y cancelar se resuelve comprobando el estado bajo control de concurrencia.

### BLOQUE 20 — LISTADO ADMINISTRATIVO DE USUARIOS

#### `GET /api/admin/usuarios`

**Actor y respuesta HTTP**

ADMIN con cuenta activa. Devuelve HTTP 200.

**Body JSON**

No recibe body ni parámetros de query.

**Respuesta JSON**

```json
[
  {
    "id": "00000000-0000-4000-8000-000000000001",
    "name": "Ana Pérez",
    "email": "ana@example.com",
    "role": "CLIENT",
    "accountStatus": "ACTIVE",
    "createdAt": "2026-11-18T10:00:00.000Z"
  }
]
```

id es UUID. name y email son strings. role es UserRole. accountStatus es AccountStatus. createdAt es Fecha.

El permiso de listado general de usuarios corresponde expresamente a ADMIN y debe figurar en la matriz RBAC.

D-033. Admin utiliza el email de la cuenta para moderación. La respuesta excluye phone y passwordHash.

Backend selecciona expresamente los campos de salida.

### BLOQUE 21 — LISTADO ADMINISTRATIVO DE SOLICITUDES

#### `GET /api/admin/solicitudes`

**Actor y respuesta HTTP**

ADMIN con cuenta activa. Consulta todas las solicitudes según D-032. Devuelve HTTP 200.

**Body JSON**

No recibe body ni parámetros de query.

**Respuesta JSON propuesta**

```json
[
  {
    "id": "00000000-0000-4000-8000-000000000005",
    "category": "ELECTRICITY",
    "neighborhoodId": "00000000-0000-4000-8000-000000000004",
    "neighborhoodName": "Caballito",
    "preferredTime": "ANY",
    "status": "ACCEPTED",
    "clientId": "00000000-0000-4000-8000-000000000001",
    "clientName": "Ana Pérez",
    "clientEmail": "ana@example.com",
    "technicianId": "00000000-0000-4000-8000-000000000003",
    "technicianName": "Luis Gómez",
    "createdAt": "2026-11-18T12:00:00.000Z",
    "acceptedAt": "2026-11-18T13:00:00.000Z",
    "completedAt": null,
    "cancelledAt": null
  }
]
```

Los identificadores son UUID. Los nombres y clientEmail son strings. category, preferredTime y status utilizan sus enums.

technicianId y technicianName admiten null. createdAt es Fecha. Las demás fechas admiten null.

D-032 y D-033. La respuesta excluye dirección exacta y teléfono. El barrio es el único dato de ubicación.

Regla funcional pendiente del PM: confirmar si Admin recibe description y cómo se garantiza que el texto libre respete D-032 y D-033. El ejemplo omite ese campo; este contrato no define ni habilita su acceso hasta contar con esa decisión. Admin conserva el barrio como único dato de ubicación y nunca recibe la dirección exacta ni el teléfono del cliente.

### BLOQUE 22 — LISTADO DE PERFILES TÉCNICOS

#### `GET /api/admin/tecnicos`

**Actor y respuesta HTTP**

ADMIN con cuenta activa. Devuelve HTTP 200.

**Body JSON**

No recibe body ni parámetros de query.

**Respuesta JSON**

```json
[
  {
    "id": "00000000-0000-4000-8000-000000000003",
    "userId": "00000000-0000-4000-8000-000000000002",
    "name": "Luis Gómez",
    "email": "luis@example.com",
    "accountStatus": "ACTIVE",
    "approvalStatus": "PENDING",
    "specialties": [
      {
        "category": "ELECTRICITY",
        "licenseNumber": "MAT-0001"
      }
    ],
    "neighborhoods": [
      {
        "id": "00000000-0000-4000-8000-000000000004",
        "name": "Caballito"
      }
    ]
  }
]
```

id y userId son UUID. name y email son strings. accountStatus y approvalStatus utilizan sus enums.

specialties es un array de objetos con category de tipo ServiceCategory y licenseNumber de tipo string o null.

neighborhoods es un array de objetos con id UUID y name string.

La respuesta contiene los datos necesarios para identificar y revisar los perfiles técnicos.

### BLOQUE 23 — DETALLE DE PERFIL TÉCNICO

#### `GET /api/admin/tecnicos/:id`

**Actor y respuesta HTTP**

ADMIN con cuenta activa. Devuelve HTTP 200.

**Body JSON**

No recibe body. :id es el UUID de Technician.

**Respuesta JSON**

```json
{
  "id": "00000000-0000-4000-8000-000000000003",
  "userId": "00000000-0000-4000-8000-000000000002",
  "name": "Luis Gómez",
  "email": "luis@example.com",
  "accountStatus": "ACTIVE",
  "approvalStatus": "PENDING",
  "specialties": [
    {
      "category": "ELECTRICITY",
      "licenseNumber": "MAT-0001"
    }
  ],
  "neighborhoods": [
    {
      "id": "00000000-0000-4000-8000-000000000004",
      "name": "Caballito"
    }
  ]
}
```

Los campos siguen los tipos definidos para cada elemento del listado administrativo de técnicos.

La matrícula corresponde a la especialidad informada. GAS y ELECTRICITY requieren matrícula para aprobar el perfil.

El estado de aprobación del perfil se mantiene separado del estado de la cuenta.

### BLOQUE 24 — APROBACIÓN O RECHAZO DE PERFIL

#### `PATCH /api/admin/tecnicos/:id/aprobacion`

**Actor y respuesta HTTP**

ADMIN con cuenta activa. Realiza la revisión manual del perfil técnico. Devuelve HTTP 200.

**Body JSON para aprobar**

```json
{
  "approvalStatus": "APPROVED"
}
```

**Body JSON para rechazar**

```json
{
  "approvalStatus": "REJECTED"
}
```

approvalStatus es obligatorio y solo admite APPROVED o REJECTED. :id es el UUID de Technician.

**Respuesta JSON de aprobación**

```json
{
  "id": "00000000-0000-4000-8000-000000000003",
  "approvalStatus": "APPROVED"
}
```

id es UUID y approvalStatus es TechnicianApprovalStatus.

La respuesta de rechazo utiliza la misma estructura y devuelve REJECTED.

La aprobación requiere los datos y las matrículas exigidas para las especialidades seleccionadas.

**Reintentos**

Repetir el mismo valor devuelve HTTP 200 sin repetir efectos. La evaluación inicial de un perfil PENDING permite registrar APPROVED o REJECTED.

D-042. La reevaluación de perfiles técnicos y el cambio de una decisión de aprobación o rechazo ya emitida quedan fuera del MVP. Solo se permite la evaluación inicial desde PENDING y el reintento del mismo resultado ya registrado. Una decisión diferente sobre un perfil ya evaluado constituye un conflicto de estado; la regla de reintentos no autoriza reevaluarlo.

### BLOQUE 25 — SUSPENSIÓN DE CUENTA

#### `PATCH /api/admin/usuarios/:id/suspender`

**Actor y respuesta HTTP**

ADMIN con cuenta activa. Puede suspender cuentas CLIENT y TECHNICIAN, según D-027. Devuelve HTTP 200.

**Body JSON**

:id es el UUID de User. D-041 requiere confirmación de Admin para cancelar una solicitud IN_PROGRESS del técnico que se suspende. El mecanismo de confirmación y su representación en la petición quedan pendientes de definición; no se fija un body para ese caso. En los demás casos se conserva la operación sin body.

**Respuesta JSON**

```json
{
  "id": "00000000-0000-4000-8000-000000000001",
  "role": "CLIENT",
  "accountStatus": "SUSPENDED"
}
```

id es UUID. role es UserRole. accountStatus es AccountStatus.

La suspensión bloquea el acceso a las rutas protegidas mediante la comprobación del estado actual de la cuenta. La aprobación del perfil técnico se conserva por separado.

**Reintentos**

Si la cuenta ya está SUSPENDED, devuelve HTTP 200 sin repetir efectos.

D-041. Si el técnico tiene una solicitud ACCEPTED, esta vuelve a PENDING y queda sin técnico asignado. Si está IN_PROGRESS, Admin debe confirmar la cancelación, respetando D-026 y RN-027. Esta regla corresponde a la suspensión; no es la liberación de otras ofertas por aceptación de D-029.

Quedan pendientes el tratamiento de la oferta aceptada y de acceptedAt al volver a PENDING, y el mecanismo de confirmación de cancelación para IN_PROGRESS. No se define el resultado de una confirmación ausente o rechazada. Los efectos sobre solicitudes activas de cuentas CLIENT suspendidas siguen pendientes de definición funcional.

### BLOQUE 26 — REACTIVACIÓN DE CUENTA

#### `PATCH /api/admin/usuarios/:id/reactivar`

**Actor y respuesta HTTP**

ADMIN con cuenta activa. Puede reactivar cuentas CLIENT y TECHNICIAN, según D-027. Devuelve HTTP 200.

**Body JSON**

No recibe body. :id es el UUID de User.

**Respuesta JSON**

```json
{
  "id": "00000000-0000-4000-8000-000000000001",
  "role": "CLIENT",
  "accountStatus": "ACTIVE"
}
```

id es UUID. role es UserRole. accountStatus es AccountStatus.

La reactivación restablece el estado ACTIVE de la cuenta.

Un técnico también necesita approvalStatus APPROVED y cumplir las condiciones de disponibilidad para aceptar ofertas.

**Reintentos**

Si la cuenta ya está ACTIVE, devuelve HTTP 200 sin repetir efectos.

La reactivación no modifica automáticamente el estado de solicitudes u ofertas anteriores.

### Manejo de errores

Los mensajes de errores siguen el formato RFC 9457 y los errores de autenticación incorporan el encabezado WWW-Authenticate. RFC 9457, RFC 6750.

#### BLOQUE 1 — FORMATO GENERAL

Los errores utilizan RFC 9457 y el encabezado Content-Type application/problem+json.

Cada respuesta incluye estos campos obligatorios.

type es un string con una URI que identifica el problema. Su valor es estable y permite a Frontend distinguir los errores.

title es un string con un resumen del problema.

status es un entero que coincide con el código HTTP de la respuesta.

detail es un string con una explicación comprensible para la persona.

En errores de validación se incorpora errors, un array con los campos afectados. Cada elemento contiene field y detail, ambos strings.

En errores HTTP 500 se incorpora traceId, un string UUID generado por el servidor para correlacionar la respuesta con el registro interno de diagnóstico.

Frontend muestra detail y utiliza type para decidir el comportamiento correspondiente. Los errores de campos se muestran junto al campo indicado en errors. Los textos de los mensajes pueden ajustarse sin cambiar el identificador type.

Las respuestas excluyen contraseñas, hashes, tokens, consultas SQL y detalles internos del servidor.

Los errores de recursos privados tampoco incluyen dirección exacta, teléfono ni información que permita consultar datos fuera de los permisos del actor.

#### BLOQUE 2 — DATOS DE ENTRADA INVÁLIDOS

##### HTTP 400

Se utiliza cuando faltan campos obligatorios, hay tipos incorrectos, valores fuera del catálogo, campos adicionales o datos que incumplen una validación.

Ejemplo

```json
{
  "type": "/problems/validation-error",
  "title": "Datos inválidos",
  "status": 400,
  "detail": "Revisá los campos indicados.",
  "errors": [
    {
      "field": "description",
      "detail": "La descripción debe tener entre 20 y 500 caracteres."
    },
    {
      "field": "neighborhoodId",
      "detail": "Seleccioná un barrio del catálogo de CABA."
    }
  ]
}
```

field identifica el campo de entrada afectado, ya sea del body, de los parámetros de query o de la ruta. Para campos anidados se utiliza una ruta como specialties[0].licenseNumber.

Backend devuelve los errores de validación detectados sin incluir los valores rechazados.

Si el body contiene JSON mal formado, devuelve HTTP 400 con type /problems/invalid-json y detail «El cuerpo de la petición debe contener JSON válido». En ese caso, errors se omite.

**Email con mayúsculas en registro o login**

```json
{
  "type": "/problems/validation-error",
  "title": "Datos inválidos",
  "status": 400,
  "detail": "Revisá el campo email.",
  "errors": [
    {
      "field": "email",
      "detail": "El email debe enviarse únicamente en minúsculas."
    }
  ]
}
```

Frontend muestra errors en el campo correspondiente. Puede convertir el email a minúsculas antes de enviarlo. Un registro con un email existente conserva HTTP 409 y /problems/email-already-registered.

#### BLOQUE 3 — AUTENTICACIÓN

##### HTTP 401

Se utiliza cuando falta autenticación válida.

Toda respuesta HTTP 401 incluye el encabezado WWW-Authenticate con el valor Bearer realm="urbanfix".

- Credenciales incorrectas en el login

```json
{
  "type": "/problems/invalid-credentials",
  "title": "Credenciales incorrectas",
  "status": 401,
  "detail": "El email o la contraseña son incorrectos."
}
```

El mismo mensaje se utiliza tanto para un email inexistente como para una contraseña incorrecta.

- Token ausente en una ruta protegida

```json
{
  "type": "/problems/authentication-required",
  "title": "Autenticación requerida",
  "status": 401,
  "detail": "Iniciá sesión para continuar."
}
```

- Token inválido

```json
{
  "type": "/problems/invalid-token",
  "title": "Sesión inválida",
  "status": 401,
  "detail": "La sesión no es válida. Iniciá sesión nuevamente."
}
```

Para tokens inválidos o vencidos, WWW-Authenticate incluye además error="invalid_token".

#### BLOQUE 4 — VENCIMIENTO DEL JWT

El JWT tiene una vigencia de 1 hora desde su emisión. El login devuelve expiresIn con el valor 3600, expresado en segundos.

Backend comprueba la firma, las condiciones de validez y la fecha de expiración en cada petición protegida.

Si un JWT válido ha vencido, devuelve HTTP 401.

```json
{
  "type": "/problems/token-expired",
  "title": "Sesión vencida",
  "status": 401,
  "detail": "Tu sesión venció. Iniciá sesión nuevamente para continuar."
}
```

El encabezado de respuesta es WWW-Authenticate con el valor Bearer realm="urbanfix", error="invalid_token".

Frontend elimina el token vencido y solicita un nuevo login. Se conserva temporalmente el contenido del formulario para que la persona pueda continuar después de autenticarse. La contraseña no se conserva.

La recuperación del formulario debe respetar la identidad de la cuenta que vuelve a iniciar sesión.

El servidor rechaza la operación protegida antes de ejecutarla cuando el token está vencido.

Frontend evita reenviar automáticamente operaciones de escritura después del login. Primero verifica si la operación anterior llegó a completarse, especialmente cuando hubo una pérdida de conexión.

Las 24 horas de vigencia de las ofertas se calculan de forma independiente de la duración del JWT.

#### BLOQUE 5 — ACCESO PROHIBIDO

##### HTTP 403

Se utiliza cuando la cuenta está autenticada, pero su estado, rol o aprobación impiden la acción.

- Cuenta suspendida

```json
{
  "type": "/problems/account-suspended",
  "title": "Cuenta suspendida",
  "status": 403,
  "detail": "Tu cuenta está suspendida. Contactá al equipo de UrbanFix."
}
```

En el login, este error se devuelve después de comprobar que las credenciales son correctas.

En las rutas protegidas, Backend consulta el estado actual de la cuenta. Una cuenta suspendida queda bloqueada aunque su JWT todavía no haya vencido.

- Rol sin permiso

```json
{
  "type": "/problems/forbidden",
  "title": "Acceso prohibido",
  "status": 403,
  "detail": "Tu rol no tiene permiso para realizar esta acción."
}
```

- Perfil técnico sin aprobación

```json
{
  "type": "/problems/technician-not-approved",
  "title": "Aprobación requerida",
  "status": 403,
  "detail": "Tu perfil técnico debe estar aprobado para realizar esta acción."
}
```

Un HTTP 403 no provoca un nuevo login automático. Frontend muestra el mensaje correspondiente.

#### BLOQUE 6 — RECURSO NO ENCONTRADO

##### HTTP 404

Se utiliza cuando el recurso no existe o está fuera de la visibilidad de la cuenta autenticada.

```json
{
  "type": "/problems/not-found",
  "title": "Recurso no encontrado",
  "status": 404,
  "detail": "El recurso solicitado no está disponible."
}
```

Se utiliza el mismo formato para evitar revelar la existencia de solicitudes o perfiles privados.

Ejemplos de aplicación

Un cliente intenta consultar una solicitud ajena.

Un técnico intenta consultar una solicitud para la que no tiene una oferta vigente ni está asignado.

Un identificador válido no corresponde a ningún recurso existente.

Un identificador con formato UUID incorrecto devuelve HTTP 400.

#### BLOQUE 7 — CONFLICTOS DE LA OPERACIÓN

##### HTTP 409

Se utiliza cuando los datos tienen un formato válido, pero el estado actual impide ejecutar la operación.

Email duplicado

```json
{
  "type": "/problems/email-already-registered",
  "title": "Email registrado",
  "status": 409,
  "detail": "Ya existe una cuenta registrada con ese email."
}
```

Oferta fuera de vigencia

```json
{
  "type": "/problems/offer-not-available",
  "title": "Oferta no disponible",
  "status": 409,
  "detail": "La oferta ya no está disponible para esta operación."
}
```

Este error aplica cuando una oferta venció, se liberó o se canceló, o cuando ya recibió una decisión incompatible con la acción solicitada.

Técnico sin disponibilidad

```json
{
  "type": "/problems/technician-unavailable",
  "title": "Técnico no disponible",
  "status": 409,
  "detail": "El técnico ya tiene un trabajo activo."
}
```

Estado de solicitud incompatible

```json
{
  "type": "/problems/invalid-state",
  "title": "Estado incompatible",
  "status": 409,
  "detail": "El estado actual de la solicitud no permite realizar esta acción."
}
```

Un reintento que cumple las condiciones de repetición exitosa definidas en su contrato devuelve HTTP 200 y conserva las fechas originales.

Los conflictos por operaciones simultáneas no deben dejar asignaciones u ofertas parcialmente actualizadas.

#### BLOQUE 8 — OTROS CONFLICTOS DE OFERTAS

##### HTTP 409

Oferta ya vigente para la solicitud

```json
{
  "type": "/problems/active-offer-exists",
  "title": "Oferta vigente",
  "status": 409,
  "detail": "La solicitud ya tiene una oferta vigente."
}
```

Técnico excluido de esa solicitud

```json
{
  "type": "/problems/technician-excluded",
  "title": "Selección no permitida",
  "status": 409,
  "detail": "Ese técnico ya rechazó esta solicitud o dejó vencer su oferta. Elegí otro técnico."
}
```

Selección que dejó de cumplir los requisitos

```json
{
  "type": "/problems/technician-not-eligible",
  "title": "Técnico no elegible",
  "status": 409,
  "detail": "El técnico seleccionado ya no cumple los requisitos para recibir esta solicitud."
}
```

Backend vuelve a comprobar la aprobación, el estado de la cuenta, la especialidad, el barrio y la disponibilidad al crear o enviar una oferta.

La consulta previa de técnicos no garantiza que su situación se mantenga hasta el envío.

#### BLOQUE 9 — ERROR INTERNO

##### HTTP 500

Se utiliza cuando una falla inesperada impide completar la operación.

```json
{
  "type": "/problems/internal-error",
  "title": "Error interno",
  "status": 500,
  "detail": "No pudimos completar la operación. Intentá nuevamente más tarde.",
  "traceId": "00000000-0000-4000-8000-000000000007"
}
```

traceId es un UUID generado por el servidor y compartido con el registro interno de esa petición. Permite identificar el incidente al investigar una falla o recibir un reporte.

**Diagnóstico interno de Backend**

Backend registra el incidente como JSON estructurado mediante una lista explícita de campos permitidos.

- timestamp, fecha y hora UTC del incidente.
- level, con el valor ERROR, y event, con una clasificación controlada como API_INTERNAL_ERROR.
- traceId, con el mismo identificador de la respuesta.
- method y route, usando el método HTTP y la plantilla de ruta, por ejemplo /api/solicitudes/:id. Se excluyen los valores de parámetros y query.
- status, con el valor 500, y durationMs, con la duración de la petición.
- errorName, con una categoría de error controlada por la aplicación.
- stackFrames, con los marcos de stack sanitizados cuando estén disponibles. Cada marco contiene función, archivo relativo al proyecto o al paquete, línea y columna. Se excluyen rutas absolutas, argumentos y la primera línea del stack cuando contiene el mensaje original.
- prismaCode, cuando Prisma proporciona un código estructurado reconocido para la versión instalada. Se utiliza null cuando no está disponible.
- modelName y operation, cuando se conocen desde el código de la aplicación y forman parte de una lista permitida.

Los mensajes originales de error, error.stack, causas anidadas y objetos meta o details de Prisma requieren extracción selectiva de los campos permitidos antes de cualquier registro. Los errores esperados, como un email duplicado, se traducen al HTTP y al tipo de problema definidos por el contrato. Un error de Prisma no implica por sí mismo HTTP 500.

**Sanitización y acceso a los logs**

La sanitización elimina secretos y datos personales, controla caracteres de salto de línea y delimitadores, y limita la longitud y profundidad de los datos registrados. El logger serializa los campos como JSON.

Los registros excluyen contraseñas, hashes, JWT, cookies, encabezados de autenticación, cadenas de conexión, SQL, valores de consultas, direcciones exactas, teléfonos, emails, bodies completos y rutas absolutas del sistema. El contexto útil se obtiene mediante categorías controladas y traceId.

Los logs de diagnóstico se consultan mediante acceso restringido al profesional autorizado. La respuesta al cliente conserva el mensaje genérico y traceId en todos los entornos. Las fallas del logger se manejan sin exponer información interna ni provocar un ciclo de errores.

Estas recomendaciones siguen el registro por campos, la sanitización y la protección de datos de [OWASP Logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html). Los códigos se interpretan conforme a la [referencia de errores de Prisma](https://www.prisma.io/docs/orm/reference/error-reference) correspondiente a la versión utilizada.

Frontend conserva el formulario cuando corresponde y permite que la persona vuelva a intentarlo.

Antes de repetir una creación, comprueba el resultado de la operación anterior para evitar duplicados.

Las operaciones que afectan varios registros deben conservar su consistencia mediante transacciones.

#### BLOQUE 10 — APLICACIÓN POR OPERACIÓN

##### Registro

400 por datos inválidos y 409 por email duplicado.

##### Login

400 por datos inválidos, 401 por credenciales incorrectas y 403 por cuenta suspendida con credenciales válidas.

##### Rutas protegidas

401 por token ausente, inválido o vencido. 403 por cuenta suspendida o por permisos insuficientes.

##### Consulta de recursos individuales

404 cuando el recurso no existe o queda fuera de la visibilidad del actor.

##### Creación de solicitudes y ofertas

400 por datos inválidos, 404 por referencias inexistentes y 409 por conflictos de selección, disponibilidad, exclusión o estado.

##### Aceptación y rechazo de ofertas

404 cuando la solicitud no existe o el técnico carece de relación con ella. Backend reconoce al destinatario de una oferta previa mediante su historial. Devuelve 409 cuando esa oferta o el estado ya no permiten la operación, y 200 cuando corresponde un reintento exitoso. La lectura del detalle antes de aceptar requiere una oferta vigente.

##### Inicio, finalización y cancelación

404 por recurso inexistente o fuera de la visibilidad del actor. 403 por rol sin permiso. 409 por estado incompatible.

##### Administración de perfiles y cuentas

400 por datos inválidos, 403 por rol sin permiso y 404 por recurso inexistente.

Todas las operaciones pueden devolver HTTP 500 ante una falla inesperada.

## Puntos pendientes para cerrar el contrato

Las decisiones aprobadas están incorporadas en los contratos y en el manejo de errores. Los siguientes puntos funcionales o de contrato requieren definición y están señalados también en la operación correspondiente.

1. El PM debe confirmar si Admin recibe description y qué tratamiento permite mostrarlo respetando D-032 y D-033, dado que el texto libre puede contener datos restringidos. Este checkpoint no define ni habilita ese acceso.

2. D-041: precisar el mecanismo de confirmación de cancelación para IN_PROGRESS, el resultado cuando Admin no confirma y el tratamiento de la oferta aceptada y de acceptedAt al devolver una solicitud ACCEPTED a PENDING.

3. Definir los efectos sobre solicitudes activas de cuentas CLIENT suspendidas. D-041 establece los casos ACCEPTED e IN_PROGRESS del técnico suspendido.
