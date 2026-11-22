function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function validateRegistration(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('Datos de registro inválidos');
  }

  for (const field of ['name', 'email', 'password', 'role']) {
    if (typeof input[field] !== 'string' || !input[field].trim()) {
      throw validationError(`El campo ${field} es obligatorio`);
    }
  }

  if (input.password.length < 8) {
    throw validationError('La contraseña debe tener al menos 8 caracteres');
  }

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) ||
    input.email !== input.email.toLowerCase()
  ) {
    throw validationError('Email inválido o con mayúsculas');
  }

  if (!['CLIENT', 'TECHNICIAN'].includes(input.role)) {
    throw validationError('Rol no permitido para registro público');
  }

  const allowedFields =
    input.role === 'CLIENT'
      ? ['name', 'email', 'password', 'role', 'phone']
      : ['name', 'email', 'password', 'role', 'specialties', 'neighborhoodIds'];

  for (const field of Object.keys(input)) {
    if (!allowedFields.includes(field)) {
      throw validationError(`Campo no permitido: ${field}`);
    }
  }

  if (input.role === 'CLIENT') {
    if (
      typeof input.phone !== 'string' ||
      !/^\+[1-9][0-9]{1,14}$/.test(input.phone)
    ) {
      throw validationError('Teléfono internacional obligatorio');
    }
  }

  if (input.role === 'TECHNICIAN') {
    const validSpecialties = [
      'ELECTRICITY',
      'PLUMBING',
      'GAS',
      'LOCKSMITH',
      'MASONRY',
    ];

    if (!Array.isArray(input.specialties) || input.specialties.length === 0) {
      throw validationError('Debe indicar al menos una especialidad');
    }

    const categories = new Set();

    for (const item of input.specialties) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw validationError('Especialidad inválida');
      }

      for (const field of Object.keys(item)) {
        if (!['category', 'licenseNumber'].includes(field)) {
          throw validationError(`Campo no permitido en especialidad: ${field}`);
        }
      }

      if (!validSpecialties.includes(item.category)) {
        throw validationError('Especialidad inválida');
      }

      if (categories.has(item.category)) {
        throw validationError('Especialidad duplicada');
      }

      categories.add(item.category);

      if (['GAS', 'ELECTRICITY'].includes(item.category)) {
        if (
          typeof item.licenseNumber !== 'string' ||
          !item.licenseNumber.trim()
        ) {
          throw validationError('La especialidad requiere matrícula');
        }
      } else if (
        item.licenseNumber !== undefined &&
        (typeof item.licenseNumber !== 'string' || !item.licenseNumber.trim())
      ) {
        throw validationError('Matrícula inválida');
      }
    }

    if (
      !Array.isArray(input.neighborhoodIds) ||
      input.neighborhoodIds.length === 0
    ) {
      throw validationError('Debe indicar al menos un barrio');
    }

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const neighborhoods = new Set();

    for (const id of input.neighborhoodIds) {
      if (typeof id !== 'string' || !uuidPattern.test(id)) {
        throw validationError('Identificador de barrio inválido');
      }

      if (neighborhoods.has(id.toLowerCase())) {
        throw validationError('Barrio duplicado');
      }

      neighborhoods.add(id.toLowerCase());
    }
  }
}

function validateLogin(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    errors.push({ field: 'body', detail: 'El cuerpo debe ser un objeto JSON.' });
  } else {
    if (typeof input.email !== 'string' ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) ||
        input.email !== input.email.toLowerCase()) {
      errors.push({ field: 'email', detail: 'El email debe ser válido y estar en minúsculas.' });
    }
    if (typeof input.password !== 'string' || !input.password.trim()) {
      errors.push({ field: 'password', detail: 'La contraseña es obligatoria.' });
    }
    for (const field of Object.keys(input)) {
      if (!['email', 'password'].includes(field)) {
        errors.push({ field, detail: 'Campo no permitido.' });
      }
    }
  }
  if (errors.length) {
    const error = validationError('Revisá los campos indicados.');
    error.type = '/problems/validation-error';
    error.errors = errors;
    throw error;
  }
}

module.exports = { validateRegistration, validateLogin };
