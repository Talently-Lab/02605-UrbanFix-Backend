const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { sendInternalProblem } = require('../lib/internal-problem');
const { isParserTransportError } = require('../middleware/problem.middleware');
const { getOwnProfile, updateOwnProfile } = require('../services/usuarios.service');

function createUsuariosRouter({ prisma, jwtSecret }) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.locals.profileStartedAt = performance.now();
    res.locals.databaseDiagnostics = new Map();
    next();
  }, authenticate({ prisma, jwtSecret }));

  router.get('/me', async (req, res, next) => {
    try {
      res.status(200).json(await getOwnProfile(req.user.id, {
        prisma, databaseDiagnostics: res.locals.databaseDiagnostics,
      }));
    } catch (error) {
      next(error);
    }
  });

  router.patch('/me', express.json({ strict: false }), async (req, res, next) => {
    try {
      res.status(200).json(await updateOwnProfile(req.body, req.user, {
        prisma, databaseDiagnostics: res.locals.databaseDiagnostics,
      }));
    } catch (error) {
      next(error);
    }
  });

  router.use(handleProfileError);

  return router;
}

function handleProfileError(error, req, res, next) {
  res.locals ??= {};
  const startedAt = Number.isFinite(res.locals.profileStartedAt) ? res.locals.profileStartedAt
    : Number.isFinite(res.locals.problemStartedAt) ? res.locals.problemStartedAt : performance.now();
  const context = {
    method: ['GET', 'PATCH'].includes(req.method) ? req.method : 'OTHER',
    route: '/api/usuarios/me', startedAt,
    databaseOperation: res.locals.databaseDiagnostics?.get(error),
  };
  if (res.headersSent) {
    res.locals.internalProblemContext = context;
    return next(error);
  }
  if (isParserTransportError(error)) return next(error);
  if (error instanceof SyntaxError && error.status === 400 && error.type === 'entity.parse.failed') {
    return res.status(400).type('application/problem+json').json({
      type: '/problems/invalid-json', title: 'JSON inválido', status: 400,
      detail: 'El cuerpo de la petición debe contener JSON válido',
    });
  }
  if (error.status === 400 && error.type === '/problems/validation-error') {
    return res.status(400).type('application/problem+json').json({
      type: error.type, title: 'Datos inválidos', status: 400,
      detail: error.message, errors: error.errors,
    });
  }
  if (error.status === 401 && error.type === '/problems/invalid-token') {
    res.set('WWW-Authenticate', 'Bearer realm="urbanfix", error="invalid_token"');
    return res.status(401).type('application/problem+json').json({
      type: error.type, title: 'Sesión inválida', status: 401, detail: error.message,
    });
  }
  if (error.status === 403 && error.type === '/problems/account-suspended') {
    return res.status(403).type('application/problem+json').json({
      type: error.type, title: 'Cuenta suspendida', status: 403, detail: error.message,
    });
  }
  return sendInternalProblem(res, error, context);
}

module.exports = { createUsuariosRouter, handleProfileError };
