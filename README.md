# UrbanFix Solutions — Backend

Backend de UrbanFix Solutions, una plataforma web que busca conectar clientes con técnicos de servicios de forma organizada y transparente.

## 1. Descripción del proyecto

Este repositorio contiene el Backend de UrbanFix Solutions, responsable de proporcionar la API y, progresivamente, implementar la lógica de negocio y el acceso a los datos de la plataforma.

## 2. Tecnologías

- **Node.js:** entorno de ejecución de JavaScript.
- **Express:** framework para desarrollar la API.
- **Prisma ORM:** herramienta para modelar y acceder a los datos.
- **PostgreSQL:** base de datos relacional, con Neon como proveedor previsto.

## 3. Estructura del proyecto

```text
├── src/
│   └── index.js           # Servidor Express
├── prisma/
│   └── schema.prisma      # Boceto inicial del modelo de datos
├── prisma7.config.ts      # Configuración de Prisma
├── package.json           # Dependencias y scripts
├── pnpm-lock.yaml         # Versiones de dependencias
├── .gitignore             # Archivos excluidos de Git
└── README.md              # Documentación del proyecto
```

## 4. Requisitos previos

Entorno utilizado para la configuración inicial:

- Node.js `v24.16.0`
- pnpm `11.5.1`
- Git, para clonar el repositorio.

## 5. Configuración

El servidor Express utiliza actualmente el puerto `3000`, definido en `src/index.js`.

La configuración de Prisma se encuentra en `prisma7.config.ts` y utiliza la variable de entorno `DATABASE_URL` para la conexión a PostgreSQL.

El archivo `.env` está excluido del control de versiones para evitar publicar credenciales.

La conexión con Neon todavía no ha sido verificada y no es necesaria para ejecutar el endpoint inicial de Express.

## 6. Instalación y ejecución

Clonar el repositorio:

```bash
git clone https://github.com/Talently-Lab/02605-UrbanFix-Backend.git
```

Ingresar al directorio del proyecto:

```bash
cd 02605-UrbanFix-Backend
```

Instalar las dependencias:

```bash
pnpm install
```

Iniciar el servidor:

```bash
pnpm start
```

El servidor estará disponible en:

`http://localhost:3000`

## 7. API disponible

### GET /

Endpoint inicial para comprobar que el servidor responde.

**URL:** `http://localhost:3000/`

**Método:** `GET`

**Respuesta esperada (200 OK):**

```json
{
  "message": "UrbanFix API funcionando"
}
```

Este endpoint no requiere autenticación.

## 8. Verificación

Con el servidor iniciado, abrir en el navegador:

`http://localhost:3000/`

También se puede verificar desde PowerShell:

```powershell
Invoke-RestMethod -Uri http://localhost:3000/ -Method Get
```

El comando realiza una petición GET y muestra la respuesta del servidor.

Si devuelve el mensaje `UrbanFix API funcionando`, el servidor inicial responde correctamente.
