const { validateRegistration, validateLogin } = require('../validators/auth.validator');

// The dummy hash uses the same bcrypt cost as public registration.
const DUMMY_PASSWORD_HASH = '$2b$10$6S57Im9Ew3cqk98q9x/0q.ty850o588rUMoGbcvePu2M9TgLFMXAe';

async function registerUser(input, { prisma, hashPassword }) {
  validateRegistration(input);

  const passwordHash = await hashPassword(input.password);

  let user;

  try {
    if (input.role === 'CLIENT') {
      user = await prisma.user.create({
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
        const createdUser = await tx.user.create({
          data: {
            name: input.name,
            email: input.email,
            phone: null,
            passwordHash,
            role: 'TECHNICIAN',
          },
        });

        await tx.technician.create({
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

        return createdUser;
      });
    }
  } catch (error) {
    const target = error.meta?.target;
    const constraintIndex =
      error.meta?.driverAdapterError?.cause?.constraint?.index;

    const isEmailConflict =
      error.code === 'P2002' &&
      (target === 'User_email_case_insensitive' ||
        target === 'email' ||
        (Array.isArray(target) && target.includes('email')) ||
        constraintIndex === 'User_email_case_insensitive');

    if (isEmailConflict) {
      const conflict = new Error('El email ya está registrado');
      conflict.status = 409;
      throw conflict;
    }

    throw error;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    technician: null,
  };
}

async function loginUser(input, { prisma, comparePassword, signToken, now = () => new Date() }) {
  validateLogin(input);
  const user = await prisma.user.findFirst({
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
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: now() } });
  return { accessToken, tokenType: 'Bearer', expiresIn: 3600, user: identity };
}

module.exports = { registerUser, loginUser };
