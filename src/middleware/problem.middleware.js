const { sendInternalProblem, logInternalProblem } = require('../lib/internal-problem');

function notFound(req, res) {
  return res.status(404).type('application/problem+json').json({
    type: '/problems/not-found', title: 'Recurso no encontrado', status: 404,
    detail: 'El recurso solicitado no está disponible.',
  });
}

function isParserTransportError(error) {
  return (error?.status === 413 && error.type === 'entity.too.large') ||
    (error?.status === 415 && ['encoding.unsupported', 'charset.unsupported'].includes(error.type));
}

function problemHandler(error, req, res, next) {
  const context = res.locals?.internalProblemContext ?? {
    method: ['GET', 'HEAD', 'POST', 'PATCH', 'OPTIONS', 'PUT', 'DELETE'].includes(req.method) ? req.method : 'OTHER',
    route: req.route?.path === '/' ? '/' : '/*',
    startedAt: res.locals?.problemStartedAt ?? performance.now(),
  };
  if (res.headersSent) {
    logInternalProblem(res, error, context);
    const safeError = new Error('No pudimos completar la operación.');
    safeError.stack = undefined;
    return next(safeError);
  }
  if (error instanceof SyntaxError && error.status === 400 && error.type === 'entity.parse.failed') {
    return res.status(400).type('application/problem+json').json({
      type: '/problems/invalid-json', title: 'JSON inválido', status: 400,
      detail: 'El cuerpo de la petición debe contener JSON válido',
    });
  }
  if (isParserTransportError(error)) {
    const problem = error.status === 413 ? {
      type: '/problems/payload-too-large', title: 'Solicitud demasiado grande', status: 413,
      detail: 'El cuerpo de la solicitud supera el tamaño máximo permitido.',
    } : {
      type: '/problems/unsupported-media-type', title: 'Formato no soportado', status: 415,
      detail: 'El formato o la codificación de la solicitud no están soportados.',
    };
    return res.status(problem.status).type('application/problem+json').json(problem);
  }
  return sendInternalProblem(res, error, context);
}

module.exports = { notFound, problemHandler, isParserTransportError };
