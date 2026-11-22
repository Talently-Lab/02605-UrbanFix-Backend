const express = require('express');
const { createApiRouter } = require('./routes');

function createApp({ prisma, jwtSecret }) {
  const app = express();
  app.use('/api', createApiRouter({ prisma, jwtSecret }));

  app.use(express.json());

  app.get('/', (req, res) => {
    res.json({ message: 'UrbanFix API funcionando' });
  });

  app.use((error, req, res, next) => {
    const invalidJson = error instanceof SyntaxError && error.status === 400 && 'body' in error;
    if (invalidJson) return res.status(400).json({ message: 'JSON inválido' });
    const status = [400, 404, 409].includes(error.status) ? error.status : 500;
    return res.status(status).json({
      message: status === 500 ? 'Error interno del servidor' : error.message,
    });
  });

  return app;
}

if (require.main === module) {
  const prisma = require('./lib/prisma');
  const app = createApp({ prisma, jwtSecret: process.env.JWT_SECRET });
  app.listen(3000, () => {
    console.log('Servidor UrbanFix iniciado en http://localhost:3000');
  });
}

module.exports = { createApp };
