# Matriz RBAC — UrbanFix Solutions (v.2)

## Matriz de roles y permisos

Permisos mínimos del MVP según RN-016. Cada Sí requiere cuenta activa y las condiciones indicadas. Los catálogos y el registro tienen el acceso público documentado.

| Acción o recurso                         | Cliente | Técnico | Admin | Condición                                                                        |
| ---------------------------------------- | :-----: | :-----: | :---: | -------------------------------------------------------------------------------- |
| Registrarse públicamente (C)             |   Sí    |   Sí    |  No   | Alta pública CLIENT o TECHNICIAN; Admin se crea fuera del registro.              |
| Iniciar sesión y consultar identidad (R) |   Sí    |   Sí    |  Sí   | Cuenta ACTIVE. Perfil técnico pendiente puede consultar su aprobación.           |
| Consultar catálogos (R)                  |   Sí    |   Sí    |  Sí   | Especialidades y barrios de CABA. Acceso público.                                |
| Crear solicitud y oferta inicial (C)     |   Sí    |   No    |  No   | Solicitud propia; técnico aprobado y disponible; servicio y barrio coinciden.    |
| Consultar solicitudes propias (R)        |   Sí    |   No    |  No   | Solo el cliente titular.                                                         |
| Buscar y elegir técnico (R/C)            |   Sí    |   No    |  No   | Aprobado y disponible. Con requestId, filtros coinciden con la solicitud propia. |
| Elegir otro técnico (C)                  |   Sí    |   No    |  No   | Solicitud propia PENDING, sin asignación ni oferta vigente. Aplicar RN-008.      |
| Consultar oferta o trabajo (R)           |   No    |   Sí    |  No   | Aprobado; destinatario de oferta vigente o técnico asignado.                     |
| Aceptar oferta (U)                       |   No    |   Sí    |  No   | Destinatario aprobado; oferta vigente y sin otro trabajo activo. D-029.          |
| Rechazar oferta (U)                      |   No    |   Sí    |  No   | Destinatario aprobado; oferta vigente y sin trabajo activo, según RN-016.        |
| Ver dirección exacta y teléfono (R)      |   No    |   Sí    |  No   | Solo quien aceptó. Acceso después del cierre pendiente de definición.            |
| Iniciar trabajo (U)                      |   No    |   Sí    |  No   | Solo asignado; ACCEPTED → IN_PROGRESS (RN-026).                                  |
| Completar trabajo (U)                    |   No    |   Sí    |  No   | Solo asignado; IN_PROGRESS → COMPLETED (D-028).                                  |
| Cancelar solicitud propia (U)            |   Sí    |   No    |  No   | Cliente titular; únicamente PENDING (D-025).                                     |
| Cancelar por moderación (U)              |   No    |   No    |  Sí   | PENDING o ACCEPTED (D-026).                                                      |
| Cancelar solicitud en curso (U)          |   No    |   No    |  Sí   | IN_PROGRESS, solo en casos excepcionales (D-026 y RN-027).                       |
| Consultar todas las solicitudes (R)      |   No    |   No    |  Sí   | Barrio como única ubicación; sin dirección exacta ni teléfono (D-032/033).       |
| Listar usuarios (R)                      |   No    |   No    |  Sí   | Email para moderación. Excluir teléfono del cliente y passwordHash.              |
| Revisar y aprobar perfiles (R/U)         |   No    |   No    |  Sí   | Revisión manual. Cambio de una decisión anterior pendiente de definición.        |
| Suspender cuentas (U)                    |   No    |   No    |  Sí   | Cuentas CLIENT y TECHNICIAN (D-027). Efecto sobre trabajos pendiente.            |
| Reactivar cuentas (U)                    |   No    |   No    |  Sí   | Cuentas CLIENT y TECHNICIAN suspendidas (D-027).                                 |

C = Crear · R = Leer · U = Actualizar · D = Eliminar D-029.

Al aceptar una oferta, se liberan inmediatamente las demás ofertas pendientes y vigentes del técnico. Sus solicitudes quedan PENDING, sin técnico asignado. Las ofertas liberadas se registran como RELEASED y las ya vencidas como EXPIRED.

RN-008. Si el técnico rechaza una solicitud o pasan 24 horas sin respuesta, queda excluido de esa solicitud, pero puede recibir otras. La solicitud vuelve a estar disponible sin técnico asignado. El motivo se conserva por separado mediante REJECTED o EXPIRED.

## Controles y correspondencia con el contrato

El servidor comprueba rol, cuenta activa, titularidad, destinatario, asignación, aprobación y estado en cada operación.
User.role mantiene el rol y User.accountStatus permite aplicar suspensiones. Los permisos se definen en una configuración versionada y se prueban con casos concedidos y denegados.

El contrato conserva 24 rutas. Las filas de esta matriz agrupan operaciones con condiciones equivalentes.

Los datos visibles son una proyección explícita por rol, incluida la exclusión de dirección exacta y teléfono para Admin. Registro de técnico incluye especialidades, matrículas y barrios en una operación.

El teléfono pertenece únicamente a la cuenta CLIENT. El login entrega JWT de 1 hora; un email con mayúsculas devuelve 400 y uno duplicado en registro devuelve 409. Justificación y contexto. La titularidad protege las solicitudes del cliente. La asignación protege los datos de coordinación del trabajo. La aprobación manual y la disponibilidad protegen la selección y aceptación. Los permisos administrativos permiten la moderación aprobada y limitan los datos visibles.

**Reglas funcionales pendientes:**
Definir hasta cuándo el técnico conserva acceso a dirección y teléfono después de COMPLETED o CANCELLED.
Confirmar si Admin recibe description y cómo se evita divulgar datos restringidos dentro de ese texto.
Definir cómo se resuelven los trabajos activos de cuentas suspendidas.
Definir la reevaluación de perfiles rechazados y los cambios de una aprobación ya emitida.

## Correspondencia con el embudo de adquisición

El embudo utiliza los permisos de registro público de CLIENT y TECHNICIAN, login de cuentas activas y consulta de la identidad y del estado de aprobación propios. Estas acciones ya están reflejadas en la matriz.

Una cuenta técnica activa puede iniciar sesión y consultar su estado de aprobación.

El acceso a ofertas y trabajos requiere perfil APPROVED y las demás condiciones indicadas para cada acción.

R1 — Último login. Identifica explícitamente una fecha y hora. Este dato no introduce permisos nuevos ni modifica las acciones permitidas a cada rol.

R2 — Cuentas de prueba. Identifica las cuentas de prueba para excluirlas de las consultas de métricas. Esta decisión no incorpora permisos nuevos a la matriz RBAC ni amplía la visibilidad de los datos por rol.
La identificación y el tratamiento de las cuentas de prueba se documentan en el modelo de datos y en las consultas de métricas.

La exclusión de cuentas suspendidas de las métricas y el registro histórico de logins quedan fuera del MVP. No se incorpora el período de siete días.
