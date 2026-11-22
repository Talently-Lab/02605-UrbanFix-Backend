const express = require('express');
const bcrypt = require('bcryptjs');

const { prisma } = require('./lib/prisma');
const { registerUser } = require('./services/auth.service');

const app = express();
const PORT = 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'UrbanFix API funcionando' });
});

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const user = await registerUser(req.body, {
      prisma,
      hashPassword: (password) => bcrypt.hash(password, 10),
    });

    res.status(201).json(user);
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({
      message: 'JSON inválido',
    });
  }

  const status = [400, 404, 409].includes(error.status) ? error.status : 500;

  if (status === 500) {
    console.error('Error interno en la API:', error);
  }

  return res.status(status).json({
    message: status === 500 ? 'Error interno del servidor' : error.message,
  });
});

app.listen(PORT, () => {
  console.log(`Servidor UrbanFix iniciado en http://localhost:${PORT}`);
});
