const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { PrismaClientInitializationError, PrismaClientKnownRequestError } = require('@prisma/client/runtime/client');

const projectRoot = path.resolve(__dirname, '../..');
const frameFunctions = new Map([
  ['src/index.js', ['createApp']],
  ['src/routes/auth.routes.js', ['createAuthRouter', 'signToken']],
  ['src/services/auth.service.js', ['registerUser', 'loginUser', 'runPrismaQuery']],
  ['src/middleware/auth.middleware.js', ['authenticateRequest']],
]);

const packageFrames = new Map([
  [require.resolve('@prisma/client/runtime/client'), {
    file: '@prisma/client/runtime/client.js', functions: ['request', 'handleRequestError', 'handleAndLogRequestError'],
  }],
  [require.resolve('bcryptjs'), { file: 'bcryptjs/umd/index.js', functions: ['hash', 'compare'] }],
  [require.resolve('jsonwebtoken/sign'), { file: 'jsonwebtoken/sign.js', functions: ['sign'] }],
]);

const prismaCodes = new Set([
  'P1000', 'P1001', 'P1002', 'P1003', 'P1008', 'P1009', 'P1010', 'P1011', 'P1012', 'P1013', 'P1014', 'P1015',
  'P1016', 'P1017', 'P1018',
  'P2000', 'P2001', 'P2002', 'P2003', 'P2004', 'P2005', 'P2006', 'P2007', 'P2008', 'P2009', 'P2010', 'P2011',
  'P2012', 'P2013', 'P2014', 'P2015', 'P2016', 'P2017', 'P2018', 'P2019', 'P2020', 'P2021', 'P2022', 'P2023',
  'P2024', 'P2025', 'P2026', 'P2027', 'P2028', 'P2029', 'P2030', 'P2031', 'P2033', 'P2034', 'P2035', 'P2036',
  'P2037', 'P2038', 'P2039',
]);

function getPrismaCode(error) {
  let code;
  if (error instanceof PrismaClientKnownRequestError) code = error.code;
  if (error instanceof PrismaClientInitializationError) code = error.errorCode;
  return prismaCodes.has(code) ? code : null;
}

function sanitizeStack(stack) {
  if (typeof stack !== 'string') return [];

  const frames = [];
  for (const entry of stack.slice(0, 8192).split('\n').slice(1)) {
    const match = /^ {4}at (?:(.*?) \()?(.+?):([1-9]\d{0,5}):([1-9]\d{0,5})\)?$/.exec(entry.trimEnd());
    if (!match) continue;

    const [, label, location, line, column] = match;
    const absoluteFile = path.resolve(projectRoot, location);
    const projectFile = path.relative(projectRoot, absoluteFile).split(path.sep).join('/');
    const packageFrame = packageFrames.get(absoluteFile);
    const allowedFunctions = packageFrame?.functions ?? frameFunctions.get(projectFile);
    if (!allowedFunctions) continue;

    const name = label?.replace(/^async /, '').split('.').at(-1);
    frames.push({
      function: allowedFunctions.includes(name) ? name : '<anonymous>',
      file: packageFrame?.file ?? projectFile, line: Number(line), column: Number(column),
    });
    if (frames.length === 8) break;
  }
  return frames;
}

function sendInternalProblem(res, error, { method, route, startedAt, event = 'API_INTERNAL_ERROR', databaseOperation }) {
  const traceId = randomUUID();
  try {
    const prismaCode = getPrismaCode(error);
    const stackFrames = sanitizeStack(error?.stack);
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(), level: 'ERROR', event, traceId,
      method, route, status: 500, durationMs: performance.now() - startedAt,
      errorName: prismaCode ? 'PrismaError' : 'UnexpectedError', prismaCode,
      ...(stackFrames.length > 0 && { stackFrames }),
      ...(databaseOperation && { modelName: databaseOperation.modelName, operation: databaseOperation.operation }),
    }));
  } catch {}

  return res.status(500).type('application/problem+json').json({
    type: '/problems/internal-error', title: 'Error interno', status: 500,
    detail: 'No pudimos completar la operación. Intentá nuevamente más tarde.', traceId,
  });
}

module.exports = { sendInternalProblem };
