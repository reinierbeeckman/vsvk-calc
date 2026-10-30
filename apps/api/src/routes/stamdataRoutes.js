import { Router } from 'express';
import { withTransaction } from '../db/pool.js';
import { applyScope } from '../db/scope.js';
import {
  listArtikelen,
  listDebiteuren,
  listWerknemers,
} from '../repositories/stamdataRepository.js';

export const stamdataRoutes = Router();

stamdataRoutes.get('/artikelen', async (req, res, next) => {
  try {
    const rows = await withTransaction(async (client) => {
      await applyScope(client, req.user);
      return listArtikelen(client);
    });

    res.json({ items: rows });
  } catch (error) {
    next(error);
  }
});

stamdataRoutes.get('/debiteuren', async (req, res, next) => {
  try {
    const rows = await withTransaction(async (client) => {
      await applyScope(client, req.user);
      return listDebiteuren(client);
    });

    res.json({ items: rows });
  } catch (error) {
    next(error);
  }
});

stamdataRoutes.get('/werknemers', async (req, res, next) => {
  try {
    const rows = await withTransaction(async (client) => {
      await applyScope(client, req.user);
      return listWerknemers(client);
    });

    res.json({ items: rows });
  } catch (error) {
    next(error);
  }
});
