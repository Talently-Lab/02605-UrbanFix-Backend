const express = require('express');
const { createAuthRouter } = require('./auth.routes');
const { createSolicitudesRouter } = require('./solicitudes.routes');
const { createAdminRouter } = require('./admin.routes');
const { createUsuariosRouter } = require('./usuarios.routes');
const { createCatalogosRouter } = require('./catalogos.routes');

function createApiRouter({ prisma, jwtSecret }) {
  const router = express.Router();
  router.use(createCatalogosRouter({ prisma }));
  router.use('/auth', createAuthRouter({ prisma, jwtSecret }));
  router.use('/usuarios', createUsuariosRouter({ prisma, jwtSecret }));
  router.use('/solicitudes', createSolicitudesRouter({ prisma, jwtSecret }));
  router.use('/admin', createAdminRouter({ prisma, jwtSecret }));
  return router;
}

module.exports = { createApiRouter };
