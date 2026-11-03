const express = require('express');

const app = express();
const PORT = 3000;

app.get('/', (req, res) => {
  res.json({ message: 'UrbanFix API funcionando' });
});

app.listen(PORT, () => {
  console.log(`Servidor UrbanFix iniciado en http://localhost:${PORT}`);
});
