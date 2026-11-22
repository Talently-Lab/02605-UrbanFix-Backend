const express = require('express');
const { authenticate, authorize } = require('../middleware/auth.middleware');

function createAdminRouter({ prisma, jwtSecret }) {
  const router = express.Router();
  router.use(authenticate({ prisma, jwtSecret }), authorize('ADMIN'));
  return router;
}

module.exports = { createAdminRouter };
