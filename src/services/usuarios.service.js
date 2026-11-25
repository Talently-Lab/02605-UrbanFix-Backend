const { validateProfilePatch } = require('../validators/usuarios.validator');

const profileSelect = {
  id: true, name: true, email: true, phone: true, role: true,
  accountStatus: true, lastLoginAt: true, isTestUser: true,
  technician: { select: { id: true, approvalStatus: true } },
};

async function queryUser(prisma, operation, args, databaseDiagnostics) {
  try {
    return await prisma.user[operation](args);
  } catch (error) {
    databaseDiagnostics?.set(error, { modelName: 'User', operation });
    throw error;
  }
}

function accountAccessError(accountExists) {
  const error = new Error(accountExists
    ? 'Tu cuenta está suspendida. Contactá al equipo de UrbanFix.'
    : 'La sesión no es válida. Iniciá sesión nuevamente.');
  error.status = accountExists ? 403 : 401;
  error.type = accountExists ? '/problems/account-suspended' : '/problems/invalid-token';
  return error;
}

function publicProfile(user) {
  return {
    id: user.id, name: user.name, email: user.email, phone: user.phone,
    role: user.role, accountStatus: user.accountStatus,
    technician: user.role === 'TECHNICIAN' && user.technician ? {
      id: user.technician.id, approvalStatus: user.technician.approvalStatus,
    } : null,
    lastLoginAt: user.lastLoginAt, isTestUser: user.isTestUser,
  };
}

async function getOwnProfile(userId, { prisma, databaseDiagnostics }) {
  const user = await queryUser(prisma, 'findUnique', {
    where: { id: userId }, select: profileSelect,
  }, databaseDiagnostics);
  if (!user || user.accountStatus !== 'ACTIVE') throw accountAccessError(Boolean(user));
  return publicProfile(user);
}

async function updateOwnProfile(input, authenticatedUser, { prisma, databaseDiagnostics }) {
  const data = validateProfilePatch(input, authenticatedUser.role);
  try {
    const user = await queryUser(prisma, 'update', {
      where: { id: authenticatedUser.id, accountStatus: 'ACTIVE' },
      data, select: profileSelect,
    }, databaseDiagnostics);
    return publicProfile(user);
  } catch (error) {
    if (error.code !== 'P2025') throw error;
    const account = await queryUser(prisma, 'findUnique', {
      where: { id: authenticatedUser.id }, select: { id: true },
    }, databaseDiagnostics);
    throw accountAccessError(Boolean(account));
  }
}

module.exports = { getOwnProfile, updateOwnProfile };
