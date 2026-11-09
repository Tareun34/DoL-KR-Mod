import fs from 'node:fs/promises';
import express from 'express';

const SLOT_PARAM = /^\d+$/;

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function createApp({ store, distDir, imgDir, token = '' }) {
  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - started}ms`);
    });
    next();
  });

  const api = express.Router();

  if (token) {
    api.use((req, res, next) => {
      if (req.get('authorization') === `Bearer ${token}`) return next();
      res.status(401).json({ error: 'unauthorized' });
    });
  }

  api.use(express.json({ limit: '64mb' }));

  api.param('slot', (req, res, next, value) => {
    if (!SLOT_PARAM.test(value)) return res.status(400).json({ error: 'invalid slot' });
    req.slot = Number(value);
    next();
  });

  const isObject = (v) => v !== null && typeof v === 'object';

  api.get('/health', (req, res) => res.json({ ok: true }));

  api.get('/saves/details', async (req, res, next) => {
    try {
      res.json(await store.getDetails());
    } catch (err) {
      next(err);
    }
  });

  api.get('/saves', async (req, res, next) => {
    try {
      res.json(await store.getAllSaves());
    } catch (err) {
      next(err);
    }
  });

  api.delete('/saves', async (req, res, next) => {
    try {
      await store.clear();
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  api.get('/saves/:slot', async (req, res, next) => {
    try {
      const save = await store.getSave(req.slot);
      if (!save) return res.status(404).json({ error: 'not found' });
      res.json(save);
    } catch (err) {
      next(err);
    }
  });

  api.put('/saves/:slot', async (req, res, next) => {
    try {
      const { save, details } = req.body ?? {};
      if (!isObject(save) || !isObject(details)) {
        return res.status(400).json({ error: 'body must be {save: object, details: object}' });
      }
      await store.putSave(req.slot, save, details);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  api.delete('/saves/:slot', async (req, res, next) => {
    try {
      await store.deleteSave(req.slot);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  api.use((req, res) => res.status(404).json({ error: 'not found' }));

  // JSON parse errors and other API failures.
  api.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large' || err.status === 400) {
      return res.status(400).json({ error: 'bad request' });
    }
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });

  app.use('/api', api);

  app.get('/', async (req, res, next) => {
    try {
      const names = (await fs.readdir(distDir).catch(() => [])).filter((n) => n.endsWith('.html')).sort();
      if (names.length === 1) return res.redirect(302, `/${encodeURIComponent(names[0])}`);
      const items = names.map((n) => `<li><a href="/${encodeURIComponent(n)}">${escapeHtml(n)}</a></li>`).join('');
      res.type('html').send(`<!DOCTYPE html><meta charset="utf-8"><title>DoL</title><ul>${items}</ul>`);
    } catch (err) {
      next(err);
    }
  });

  // Static files are an allow-list: the built HTML files and the game images.
  // Nothing else (sources, server code, save files) is ever served; saves are
  // only reachable through the authenticated API.
  app.use(express.static(distDir, { index: false }));
  app.use('/img', express.static(imgDir, { index: false }));

  return app;
}
