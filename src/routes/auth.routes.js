const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('node:crypto');

const { registerUser, loginUser } = require('../services/auth.service');

function createAuthRouter({ prisma, jwtSecret }) {
  const router = express.Router();

  router.post('/login', express.json(), async (req, res, next) => {
    try {
      const result = await loginUser(req.body, {
        prisma,
        comparePassword: bcrypt.compare,
        signToken: (payload) => {
          if (typeof jwtSecret !== 'string' || !jwtSecret.trim()) {
            throw new Error('JWT_SECRET is required');
          }
          return jwt.sign(payload, jwtSecret, { algorithm: 'HS256', expiresIn: 3600 });
        },
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }, (error, req, res, next) => {
    const invalidJson = error instanceof SyntaxError && error.status === 400 && 'body' in error;
    if (invalidJson) {
      return res.status(400).type('application/problem+json').json({
        type: '/problems/invalid-json', title: 'JSON inválido', status: 400,
        detail: 'El cuerpo de la petición debe contener JSON válido',
      });
    }

    const status = [400, 401, 403].includes(error.status) ? error.status : 500;
    const titles = { 400: 'Datos inválidos', 401: 'Credenciales incorrectas', 403: 'Cuenta suspendida' };
    if (status === 500) {
      const traceId = randomUUID();
      console.error(JSON.stringify({ level: 'ERROR', event: 'API_INTERNAL_ERROR', traceId,
        method: req.method, route: '/api/auth/login', status }));
      return res.status(500).type('application/problem+json').json({
        type: '/problems/internal-error', title: 'Error interno', status: 500,
        detail: 'No pudimos completar la operación. Intentá nuevamente más tarde.', traceId,
      });
    }
    if (status === 401) res.set('WWW-Authenticate', 'Bearer realm="urbanfix"');
    return res.status(status).type('application/problem+json').json({
      type: error.type, title: titles[status], status, detail: error.message,
      ...(status === 400 && { errors: error.errors }),
    });
  });

  router.use(express.json());

  router.post('/register', async (req, res, next) => {
    try {
      const user = await registerUser(req.body, {
        prisma,
        hashPassword: (password) => bcrypt.hash(password, 10),
      });
      res.status(201).json(user);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createAuthRouter };
