const { isArgentinePhone } = require('./phone.validator');

function validateProfilePatch(input, role) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    errors.push({ field: 'body', detail: 'El cuerpo debe ser un objeto JSON.' });
  } else {
    const allowedFields = role === 'CLIENT' ? ['name', 'phone'] : ['name'];
    if (Object.keys(input).length === 0) {
      errors.push({ field: 'body', detail: 'Informá al menos un campo editable para tu rol.' });
    }
    for (const field of Object.keys(input)) {
      if (!allowedFields.includes(field)) {
        errors.push({ field, detail: 'Campo no permitido.' });
      }
    }
    if (Object.hasOwn(input, 'name') && (typeof input.name !== 'string' || !input.name.trim())) {
      errors.push({ field: 'name', detail: 'El campo name es obligatorio' });
    }
    if (role === 'CLIENT' && Object.hasOwn(input, 'phone') &&
        (typeof input.phone !== 'string' || !isArgentinePhone(input.phone))) {
      errors.push({ field: 'phone', detail: 'Teléfono argentino obligatorio en formato internacional' });
    }
  }
  if (errors.length) {
    const error = new Error('Revisá los campos indicados.');
    error.status = 400;
    error.type = '/problems/validation-error';
    error.errors = errors;
    throw error;
  }

  const data = {};
  if (Object.hasOwn(input, 'name')) data.name = input.name;
  if (role === 'CLIENT' && Object.hasOwn(input, 'phone')) data.phone = input.phone;
  return data;
}

module.exports = { validateProfilePatch };
