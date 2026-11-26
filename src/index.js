const express = require('express');
const cors = require('cors');
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
  try {
    frontendOrigins = parseFrontendOrigins(process.env.FRONTEND_URL);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
  if (frontendOrigins) {
    const prisma = require('./lib/prisma');
    const app = createApp({ prisma, jwtSecret: process.env.JWT_SECRET, frontendOrigins });
    app.listen(3000, () => {
      console.log('Servidor UrbanFix iniciado en http://localhost:3000');
    });
  }
}

module.exports = { createApp };
