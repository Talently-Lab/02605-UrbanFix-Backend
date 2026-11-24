# Guía de contribución — UrbanFix

## Objetivo

Establecer criterios comunes para contribuir a los repositorios Frontend y Backend de UrbanFix, facilitando la colaboración, la autonomía de cada developer y la calidad técnica de los cambios.

## 1. Desarrollo y alcance

- Trabajar en una rama específica para cada tarea o corrección.
- Mantener los cambios dentro del alcance acordado.
- Respetar la arquitectura, las convenciones y las reglas de negocio aprobadas.
- Coordinar previamente cualquier cambio que afecte contratos API, autenticación, permisos, modelo de datos o integración entre equipos.
- Cualquier funcionalidad adicional, cambio de alcance o modificación de las reglas de negocio requiere aprobación y revisión por los responsables correspondientes.
- Los cambios de bajo riesgo, como ajustes de textos o componentes aislados, pueden ser gestionados por el developer responsable, siempre que no afecten funcionalidades compartidas ni contratos existentes. El riesgo se evalúa según el impacto real del cambio.
- Las decisiones técnicas se toman dentro del alcance y los comportamientos aprobados, y se comunican cuando afectan a otros integrantes del equipo.

## 2. Pull Requests

Antes de solicitar el merge, el autor debe revisar sus cambios, comprobar el resultado de los checks configurados, verificar que no existan conflictos de integración y ejecutar las comprobaciones pertinentes para el cambio y el repositorio.

Cuando no haya checks configurados, se documentarán las verificaciones ejecutadas y sus resultados. Las comprobaciones que no pudieron realizarse deben quedar identificadas con su motivo.

También debe comunicar bloqueos y riesgos a tiempo, documentar las decisiones relevantes y mantener la autonomía de cada área sin comprometer la integración del proyecto.

Se recomienda que cada PR incluya los siguientes apartados.

### Objetivo

Qué se busca implementar o resolver.

### Cambios realizados

Los cambios y los archivos modificados.

### Pruebas y verificaciones

Indicar los tests y las verificaciones ejecutadas. Incluir sus resultados.

### Observaciones

Limitaciones, riesgos, decisiones pendientes, verificaciones pendientes o conflictos de integración, cuando corresponda.

Cuando corresponda revisión adicional, indicar quién debe realizarla y qué aspectos necesita revisar.

### Criterios para las pruebas y verificaciones

Cada developer deberá ejecutar las comprobaciones pertinentes para sus cambios y registrar los resultados en el PR.

- Priorizar tests unitarios con mocks para comprobar la lógica y los casos de error.
- Utilizar recursos temporales o entornos de prueba aislados para tests de integración y E2E, cuando correspondan.
- Ejecutar lint sin autofix, type checking y build cuando estén disponibles y sean pertinentes.
- Antes de ejecutar tests o scripts, comprobar si modifican archivos, escriben datos o acceden a servicios externos.
- Para las pruebas que escriban datos se recomienda utilizar una base de pruebas identificada y aislada. El acceso a datos compartidos o de producción requiere coordinación y autorización previa.
- Revisar las diferencias al finalizar para detectar cambios inesperados en código, configuración, dependencias o archivos generados.
- Documentar las comprobaciones que no pudieron ejecutarse, su motivo y qué quedó pendiente.

Los mocks permiten verificar la lógica de forma aislada. Las pruebas de integración y E2E comprueban las conexiones y los flujos reales cuando el cambio lo requiere.

### Automatización con GitHub Actions

Se recomienda incorporar workflows en `.github/workflows/`, activados mediante `pull_request`, para ejecutar las pruebas, el lint sin autofix, el type checking o el build que correspondan al repositorio.

Cada developer configurará los workflows según las herramientas y necesidades de su repositorio, siguiendo los criterios comunes de esta guía.

Antes de automatizar un comando, se revisarán sus efectos para proteger el código, los datos y los servicios del proyecto. Las pruebas utilizarán mocks o entornos de prueba aislados cuando corresponda.

Los resultados quedarán visibles en el PR como información para la revisión. Su configuración inicial será informativa, sin establecerlos como requisitos obligatorios de merge. Los fallos deberán evaluarse y documentarse conforme a las condiciones de la sección 3.2.

## 3. Revisión adicional

Cada developer revisará los aspectos técnicos que pueda evaluar con fundamento. Los demás roles participarán cuando el cambio afecte sus responsabilidades.

Cuando un PR necesite revisión adicional, el autor deberá identificar a la persona responsable y su rol, comunicarle directamente la solicitud y compartirla con el equipo.

Las observaciones se registrarán preferentemente en el PR de GitHub para mantener la trazabilidad.

Al resolver las observaciones, el autor deberá actualizar el PR con los cambios realizados y las pruebas y verificaciones correspondientes. También actualizará el objetivo cuando haya cambiado.

Los cambios funcionales, de alcance o de reglas de negocio deberán cumplir las condiciones de aprobación de la sección 1.

El Tech Lead acompaña las decisiones de arquitectura, revisa los cambios de mayor riesgo dentro de su competencia, ayuda a resolver bloqueos y coordina los aspectos técnicos compartidos.

### 3.1. Cambios que requieren revisión adicional

Requieren revisión adicional antes del merge los cambios que afecten alguno de estos aspectos.

- **Contrato API.** Rutas, métodos HTTP, parámetros, campos obligatorios, estructura JSON, tipos de datos, valores permitidos, formato de fechas o respuestas de error.
- **Autenticación y seguridad.** Registro, login, tokens, duración y almacenamiento de sesiones, contraseñas, cabeceras de autenticación o controles de seguridad.
- **Roles y permisos.** Acciones permitidas, titularidad, asignación o datos visibles para cada rol.
- **Estados y reglas de negocio.** Transiciones de solicitudes y ofertas, condiciones de disponibilidad, aceptación, rechazo, cancelación o finalización.
- **Modelo de datos.** Cambios en Prisma, migraciones, relaciones, restricciones, índices u operaciones que puedan afectar datos existentes.
- **Conexión entre aplicaciones.** URL de la API, dominios, puertos, CORS, cabeceras o variables de configuración compartidas.
- **Peticiones desde Frontend.** Cambios en los datos enviados, tratamiento de respuestas, reintentos, frecuencia o concurrencia que puedan duplicar operaciones o aumentar significativamente las peticiones.
- **Estado mostrado en la interfaz.** Cambios que puedan mostrar una operación como completada antes de confirmar su resultado o gestionar incorrectamente un rechazo del servidor.

### 3.2. Plazo de revisión y merge

Se propone un plazo de 24 horas corridas para facilitar la revisión de los PR. El plazo funciona como referencia de coordinación. Su vencimiento no sustituye una revisión adicional requerida ni autoriza automáticamente el merge.

El developer responsable podrá realizar el merge cuando se cumplan todas estas condiciones.

- Las observaciones necesarias estén resueltas.
- Las revisiones técnicas requeridas estén completadas.
- No existan conflictos ni fallos nuevos conocidos en las verificaciones esenciales.
- Las limitaciones o fallos preexistentes estén documentados y su impacto sobre el cambio haya sido evaluado.
- El cambio respete el alcance y las decisiones aprobadas.
- Se cumplan los permisos y las reglas del repositorio.

Si una revisión necesaria sigue pendiente, se coordinará su resolución antes del merge. Una vez satisfechas las condiciones, podrá realizarse el merge sin esperar a que transcurran las 24 horas.

## 4. Principios de colaboración

- Priorizar cambios pequeños, claros y verificables.
- Comunicar bloqueos y riesgos a tiempo, documentar las decisiones relevantes y mantener la autonomía de cada área sin comprometer la integración del proyecto.
- Un mensaje de commit debe estructurarse de la siguiente forma: tipo, ámbito (opcional) y descripción, según [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

## 5. Comunicación de los PR en #desarrollo

### Enlace al PR

[PR #n.º](enlace)

- **Objetivo.** Qué implementa o resuelve el cambio.
- **Cambios realizados.** Archivos modificados y descripción de los cambios.
- **Pruebas y verificaciones.** Tests y verificaciones ejecutadas y sus resultados.
- **Observaciones.** Indicar si hay limitaciones, riesgos, conflictos de integración, decisiones o verificaciones pendientes.
- **Revisión técnica adicional.** Sí / No. Si corresponde, indicar la persona responsable, su rol y los aspectos que debe revisar.

Plazo de revisión de 24 horas corridas, como referencia de coordinación.

## Referencias

- [GitHub — Revisiones de PR](https://docs.github.com/en/pull-requests/reference/pull-request-reviews)
- [GitHub — Guías de contribución](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/setting-guidelines-for-repository-contributors)
