const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendInternalProblem } = require('../lib/internal-problem');

const { registerUser, loginUser } = require('../services/auth.service');

function createAuthRouter({ prisma, jwtSecret }) {
  const router = express.Router();

  function initializeDiagnostics(req, res, next) {
    res.locals.authStartedAt = performance.now();
    res.locals.databaseDiagnostics = new Map();
    next();
  }

  router.post('/login', initializeDiagnostics, express.json(), async (req, res, next) => {
    try {
      const result = await loginUser(req.body, {
        prisma,
        databaseDiagnostics: res.locals.databaseDiagnostics,
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
      return sendInternalProblem(res, error, {
        method: 'POST', route: '/api/auth/login', startedAt: res.locals.authStartedAt,
        databaseOperation: res.locals.databaseDiagnostics.get(error),
      });
    }
    if (status === 401) res.set('WWW-Authenticate', 'Bearer realm="urbanfix"');
    return res.status(status).type('application/problem+json').json({
      type: error.type, title: titles[status], status, detail: error.message,
      ...(status === 400 && { errors: error.errors }),
    });
  });

  router.post('/register', initializeDiagnostics, express.json(), async (req, res, next) => {
    try {
      const user = await registerUser(req.body, {
        prisma,
        databaseDiagnostics: res.locals.databaseDiagnostics,
        hashPassword: (password) => bcrypt.hash(password, 10),
      });
      res.status(201).json(user);
    } catch (error) {
      next(error);
    }
  }, (error, req, res, next) => {
    if (error instanceof SyntaxError && error.status === 400 && error.type === 'entity.parse.failed') {
      return res.status(400).type('application/problem+json').json({
        type: '/problems/invalid-json', title: 'JSON inválido', status: 400,
        detail: 'El cuerpo de la petición debe contener JSON válido',
      });
    }
    if (error.status === 400 && error.type === '/problems/validation-error') {
      return res.status(400).type('application/problem+json').json({
        type: error.type, title: 'Datos inválidos', status: 400,
        detail: error.errors.length === 1 && error.errors[0].field === 'email'
          ? 'Revisá el campo email.' : 'Revisá los campos indicados.',
        errors: error.errors,
      });
    }
    if (error.status === 409 && error.type === '/problems/email-already-registered') {
      return res.status(409).type('application/problem+json').json({
        type: error.type, title: 'Email registrado', status: 409,
        detail: 'Ya existe una cuenta registrada con ese email.',
      });
    }
    if (error.status === 404 && error.type === '/problems/not-found') {
      return res.status(404).type('application/problem+json').json({
        type: error.type, title: 'Recurso no encontrado', status: 404,
        detail: 'El recurso solicitado no está disponible.',
      });
    }
    return sendInternalProblem(res, error, {
      method: 'POST', route: '/api/auth/register', startedAt: res.locals.authStartedAt,
      databaseOperation: res.locals.databaseDiagnostics.get(error),
    });
  });

  return router;
}

module.exports = { createAuthRouter };
