const jwt = require('jsonwebtoken');
const { sendInternalProblem } = require('../lib/internal-problem');

function internalProblem(req, res, startedAt, error, databaseOperation) {
  const baseRoute = req.baseUrl?.toLowerCase();
  const route = ['/api/admin', '/api/solicitudes'].includes(baseRoute) ? baseRoute : req.route?.path ?? '/';
  return sendInternalProblem(res, error, {
    method: req.method, route, startedAt, event: 'AUTHENTICATION_ERROR', databaseOperation,
  });
}

function authenticationProblem(res, type) {
  const problems = {
    'authentication-required': ['Autenticación requerida', 'Iniciá sesión para continuar.'],
    'invalid-token': ['Sesión inválida', 'La sesión no es válida. Iniciá sesión nuevamente.'],
    'token-expired': ['Sesión vencida', 'Tu sesión venció. Iniciá sesión nuevamente para continuar.'],
  };
  const [title, detail] = problems[type];
  const challenge = type === 'authentication-required'
    ? 'Bearer realm="urbanfix"' : 'Bearer realm="urbanfix", error="invalid_token"';
  res.set('WWW-Authenticate', challenge);
  return res.status(401).type('application/problem+json').json({
    type: `/problems/${type}`, title, status: 401, detail,
  });
}

function authenticate({ prisma, jwtSecret }) {
  return async function authenticateRequest(req, res, next) {
    const startedAt = performance.now();
    if (typeof jwtSecret !== 'string' || !jwtSecret.trim()) {
      return internalProblem(req, res, startedAt, new Error('JWT configuration missing'));
    }
    const header = req.headers.authorization;
    if (header === undefined) return authenticationProblem(res, 'authentication-required');
    const bearer = typeof header === 'string' && /^Bearer +([^\s]+)$/i.exec(header);
    if (!bearer) return authenticationProblem(res, 'invalid-token');

    let claims;
    try {
      claims = jwt.verify(bearer[1], jwtSecret, { algorithms: ['HS256'] });
    } catch (error) {
      return authenticationProblem(res, error.name === 'TokenExpiredError' ? 'token-expired' : 'invalid-token');
    }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!claims || typeof claims !== 'object' || typeof claims.userId !== 'string' ||
        !uuid.test(claims.userId) || !['CLIENT', 'TECHNICIAN', 'ADMIN'].includes(claims.role) ||
        !Number.isFinite(claims.exp)) {
      return authenticationProblem(res, 'invalid-token');
    }
    let user;
    try {
      user = await prisma.user.findUnique({
        where: { id: claims.userId },
        select: {
          id: true, role: true, accountStatus: true,
          technician: { select: { id: true, approvalStatus: true } },
        },
      });
    } catch (error) {
      return internalProblem(req, res, startedAt, error, { modelName: 'User', operation: 'findUnique' });
    }
    if (!user) return authenticationProblem(res, 'invalid-token');
    if (user.accountStatus !== 'ACTIVE') {
      return res.status(403).type('application/problem+json').json({
        type: '/problems/account-suspended', title: 'Cuenta suspendida', status: 403,
        detail: 'Tu cuenta está suspendida. Contactá al equipo de UrbanFix.',
      });
    }
    req.user = user;
    return next();
  };
}

function authorize(...roles) {
  return function authorizeRequest(req, res, next) {
    if (!req.user) return authenticationProblem(res, 'authentication-required');
    if (!roles.includes(req.user.role)) {
      return res.status(403).type('application/problem+json').json({
        type: '/problems/forbidden', title: 'Acceso prohibido', status: 403,
        detail: 'Tu rol no tiene permiso para realizar esta acción.',
      });
    }
    return next();
  };
}

module.exports = { authenticate, authorize };
