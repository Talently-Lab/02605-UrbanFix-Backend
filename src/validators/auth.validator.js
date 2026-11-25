function validationError(message, field, detail = message) {
  const error = new Error(message);
  error.status = 400;
  if (field !== undefined) {
    error.type = '/problems/validation-error';
    error.errors = [{ field, detail }];
  }
  return error;
}

function validateRegistration(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('Datos de registro inválidos', 'body');
  }

  for (const field of ['name', 'email', 'password', 'role']) {
    if (typeof input[field] !== 'string' || !input[field].trim()) {
      throw validationError(`El campo ${field} es obligatorio`, field);
    }
  }

  if (input.password.length < 8) {
    throw validationError('La contraseña debe tener al menos 8 caracteres', 'password');
  }

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) ||
    input.email !== input.email.toLowerCase()
  ) {
    throw validationError('Email inválido o con mayúsculas', 'email',
      input.email !== input.email.toLowerCase()
        ? 'El email debe enviarse únicamente en minúsculas.' : 'El formato de email es inválido.');
  }

  if (!['CLIENT', 'TECHNICIAN'].includes(input.role)) {
    throw validationError('Rol no permitido para registro público', 'role');
  }

  const allowedFields =
    input.role === 'CLIENT'
      ? ['name', 'email', 'password', 'role', 'phone']
      : ['name', 'email', 'password', 'role', 'phone', 'specialties', 'neighborhoodIds'];

  for (const field of Object.keys(input)) {
    if (!allowedFields.includes(field)) {
      throw validationError(`Campo no permitido: ${field}`, field, 'Campo no permitido.');
    }
  }

  if (
    typeof input.phone !== 'string' ||
    !/^\+[1-9][0-9]{1,14}$/.test(input.phone)
  ) {
    throw validationError('Teléfono internacional obligatorio', 'phone');
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
      throw validationError('Debe indicar al menos una especialidad', 'specialties');
    }

    const categories = new Set();

    for (const [index, item] of input.specialties.entries()) {
      const path = `specialties[${index}]`;
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw validationError('Especialidad inválida', path);
      }

      for (const field of Object.keys(item)) {
        if (!['category', 'licenseNumber'].includes(field)) {
          throw validationError(`Campo no permitido en especialidad: ${field}`, `${path}.${field}`, 'Campo no permitido.');
        }
      }

      if (!validSpecialties.includes(item.category)) {
        throw validationError('Especialidad inválida', `${path}.category`);
      }

      if (categories.has(item.category)) {
        throw validationError('Especialidad duplicada', `${path}.category`);
      }

      categories.add(item.category);

      if (['GAS', 'ELECTRICITY'].includes(item.category)) {
        if (
          typeof item.licenseNumber !== 'string' ||
          !item.licenseNumber.trim()
        ) {
          throw validationError('La especialidad requiere matrícula', `${path}.licenseNumber`);
        }
      } else if (
        item.licenseNumber !== undefined &&
        (typeof item.licenseNumber !== 'string' || !item.licenseNumber.trim())
      ) {
        throw validationError('Matrícula inválida', `${path}.licenseNumber`);
      }
    }

    if (
      !Array.isArray(input.neighborhoodIds) ||
      input.neighborhoodIds.length === 0
    ) {
      throw validationError('Debe indicar al menos un barrio', 'neighborhoodIds');
    }

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const neighborhoods = new Set();

    for (const [index, id] of input.neighborhoodIds.entries()) {
      if (typeof id !== 'string' || !uuidPattern.test(id)) {
        throw validationError('Identificador de barrio inválido', `neighborhoodIds[${index}]`);
      }

      if (neighborhoods.has(id.toLowerCase())) {
        throw validationError('Barrio duplicado', `neighborhoodIds[${index}]`);
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
