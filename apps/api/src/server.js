import express from 'express';
import { authenticate, requirePermission } from './auth/authenticate.js';
import { stamdataRoutes } from './routes/stamdataRoutes.js';

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/stamdata', authenticate, requirePermission('stamdata.read'), stamdataRoutes);

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'internal_server_error' });
});

const port = Number(process.env.PORT ?? 8090);
app.listen(port, () => {
  console.log(`VSVK API listening on port ${port}`);
});
