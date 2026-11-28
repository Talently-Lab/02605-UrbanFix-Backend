const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const openapi = require('../docs/openapi.json');
const { createApiRouter } = require('./routes');
const { parseFrontendOrigins } = require('./config/cors.config');
const { notFound, problemHandler } = require('./middleware/problem.middleware');

function createApp({ prisma, jwtSecret, frontendOrigins = [] }) {
  const app = express();
  app.use((req, res, next) => {
    res.locals.problemStartedAt = performance.now();
    res.vary('Origin');
    next();
  });
  app.use(cors({
    origin: (origin, callback) => callback(null, frontendOrigins.includes(origin)),
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    exposedHeaders: ['WWW-Authenticate'],
    credentials: false,
    optionsSuccessStatus: 204,
  }));
  app.get('/openapi.json', (req, res) => res.json(openapi));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi, {
    swaggerOptions: { validatorUrl: null, persistAuthorization: false },
  }));
  app.use('/api', createApiRouter({ prisma, jwtSecret }));

  app.use(express.json());

  app.get('/', (req, res) => {
    res.json({ message: 'UrbanFix API funcionando' });
  });

  app.use(notFound);
  app.use(problemHandler);

  return app;
}

if (require.main === module) {
  require('dotenv/config');
  let frontendOrigins;
  let port;
  try {
    const configuredPort = process.env.PORT ?? '3000';
    if (!/^[0-9]+$/.test(configuredPort) || Number(configuredPort) < 1 || Number(configuredPort) > 65535) {
      throw new Error('PORT debe ser un entero entre 1 y 65535');
    }
    port = Number(configuredPort);
    frontendOrigins = parseFrontendOrigins(process.env.FRONTEND_URL);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
  if (frontendOrigins) {
    const prisma = require('./lib/prisma');
    const app = createApp({ prisma, jwtSecret: process.env.JWT_SECRET, frontendOrigins });
    app.listen(port, '0.0.0.0', () => {
      console.log(`Servidor UrbanFix iniciado en puerto ${port}`);
    });
  }
}

module.exports = { createApp };
