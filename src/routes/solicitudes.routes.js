const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');

function createSolicitudesRouter({ prisma, jwtSecret }) {
  const router = express.Router();
  router.use(authenticate({ prisma, jwtSecret }));
  return router;
}

module.exports = { createSolicitudesRouter };
