const { validateRegistration } = require('../validators/auth.validator');

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

module.exports = { registerUser };
