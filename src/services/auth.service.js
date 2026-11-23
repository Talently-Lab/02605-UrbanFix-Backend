const { validateRegistration, validateLogin } = require('../validators/auth.validator');

// The dummy hash uses the same bcrypt cost as public registration.
const DUMMY_PASSWORD_HASH = '$2b$10$6S57Im9Ew3cqk98q9x/0q.ty850o588rUMoGbcvePu2M9TgLFMXAe';

async function runPrismaQuery(databaseDiagnostics, modelName, operation, delegate, args) {
  try {
    return await delegate[operation](args);
  } catch (error) {
    databaseDiagnostics?.set(error, { modelName, operation });
    throw error;
  }
}

async function registerUser(input, { prisma, hashPassword, databaseDiagnostics }) {
  validateRegistration(input);

  const passwordHash = await hashPassword(input.password);

  let user;

  try {
    if (input.role === 'CLIENT') {
      user = await runPrismaQuery(databaseDiagnostics, 'User', 'create', prisma.user, {
        data: {
          name: input.name,
          email: input.email,
          phone: input.phone,
          passwordHash,
          role: input.role,
        },
      });
    } else {
      user = await prisma.$transaction(async (tx) => {
        const createdUser = await runPrismaQuery(databaseDiagnostics, 'User', 'create', tx.user, {
          data: {
            name: input.name,
            email: input.email,
            phone: null,
            passwordHash,
            role: 'TECHNICIAN',
          },
        });

        const technician = await runPrismaQuery(databaseDiagnostics, 'Technician', 'create', tx.technician, {
          data: {
            userId: createdUser.id,
            approvalStatus: 'PENDING',
            specialties: {
              create: input.specialties.map((item) => ({
                category: item.category,
                ...(item.licenseNumber !== undefined && {
                  licenseNumber: item.licenseNumber,
                }),
              })),
            },
            neighborhoods: {
              create: input.neighborhoodIds.map((neighborhoodId) => ({
                neighborhoodId,
              })),
            },
          },
        });

        return { ...createdUser, technician };
      });
    }
  } catch (error) {
    const target = error.meta?.target;
    const constraintIndex =
      error.meta?.driverAdapterError?.cause?.constraint?.index;
    const emailIndexes = ['User_email_key', 'User_email_case_insensitive'];

    const isEmailConflict =
      error.code === 'P2002' &&
      (emailIndexes.includes(target) ||
        target === 'email' ||
        (Array.isArray(target) && target.includes('email')) ||
        emailIndexes.includes(constraintIndex));

    if (isEmailConflict) {
      const conflict = new Error('El email ya está registrado');
      conflict.status = 409;
      conflict.type = '/problems/email-already-registered';
      throw conflict;
    }

    if (input.role === 'TECHNICIAN' && error.code === 'P2003' &&
        error.meta?.modelName === 'Technician' &&
        constraintIndex === 'TechnicianNeighborhood_neighborhoodId_fkey') {
      const notFound = new Error('El recurso solicitado no está disponible.');
      notFound.status = 404;
      notFound.type = '/problems/not-found';
      throw notFound;
    }

    throw error;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    accountStatus: user.accountStatus,
    technician: user.technician ? {
      id: user.technician.id,
      approvalStatus: user.technician.approvalStatus,
    } : null,
    lastLoginAt: user.lastLoginAt,
    isTestUser: user.isTestUser,
  };
}

async function loginUser(input, { prisma, comparePassword, signToken, now = () => new Date(), databaseDiagnostics }) {
  validateLogin(input);
  const user = await runPrismaQuery(databaseDiagnostics, 'User', 'findFirst', prisma.user, {
    where: { email: { equals: input.email, mode: 'insensitive' } },
    select: {
      id: true, name: true, email: true, passwordHash: true, role: true,
      accountStatus: true, lastLoginAt: true, isTestUser: true,
      technician: { select: { id: true, approvalStatus: true } },
    },
  });
  const passwordMatches = await comparePassword(input.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !passwordMatches) {
    const error = new Error('El email o la contraseña son incorrectos.');
    error.status = 401;
    error.type = '/problems/invalid-credentials';
    throw error;
  }
  if (user.accountStatus !== 'ACTIVE') {
    const error = new Error('Tu cuenta está suspendida. Contactá al equipo de UrbanFix.');
    error.status = 403;
    error.type = '/problems/account-suspended';
    throw error;
  }
  const identity = {
    id: user.id, name: user.name, email: user.email, role: user.role,
    accountStatus: user.accountStatus, technician: user.technician,
    lastLoginAt: user.lastLoginAt, isTestUser: user.isTestUser,
  };
  const accessToken = await signToken({ userId: user.id, role: user.role });
  await runPrismaQuery(databaseDiagnostics, 'User', 'update', prisma.user, {
    where: { id: user.id }, data: { lastLoginAt: now() },
  });
  return { accessToken, tokenType: 'Bearer', expiresIn: 3600, user: identity };
}

module.exports = { registerUser, loginUser };
