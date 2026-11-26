const express = require('express');
const { listSpecialties, listNeighborhoods } = require('../services/catalogos.service');
const { sendInternalProblem } = require('../lib/internal-problem');

function createCatalogosRouter({ prisma }) {
  const router = express.Router();
  router.get('/especialidades', (req, res) => {
    res.status(200).json(listSpecialties());
  });

  router.get('/barrios', async (req, res) => {
    const startedAt = performance.now();
    try {
      res.status(200).json(await listNeighborhoods({ prisma }));
    } catch (error) {
      sendInternalProblem(res, error, {
        method: req.method, route: '/api/barrios', startedAt,
        databaseOperation: { modelName: 'Neighborhood', operation: 'findMany' },
      });
    }
  });
  return router;
}

module.exports = { createCatalogosRouter };
