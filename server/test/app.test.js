import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../store.js';
import { createApp } from '../app.js';

const KR = 'Degrees of Lewdity_kr.html';
const KR_URL = '/Degrees%20of%20Lewdity_kr.html';

async function startApp({ token = '' } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dol-app-'));
  const dataDir = path.join(root, 'data');
  const imgDir = path.join(root, 'img');
  const distDir = path.join(root, 'dist');
  await fs.mkdir(imgDir, { recursive: true });
  await fs.mkdir(distDir, { recursive: true });
  await fs.writeFile(path.join(imgDir, 'x.txt'), 'img');
  await fs.writeFile(path.join(distDir, KR), 'patched');
  const store = await createStore(dataDir);
  const app = createApp({ store, distDir, imgDir, token });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, root, distDir, imgDir, close: () => new Promise((r) => server.close(r)) };
}

const json = (body) => ({
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('health', async () => {
  const { base, close } = await startApp();
  try {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    await close();
  }
});

test('put get details delete flow', async () => {
  const { base, close } = await startApp();
  try {
    let res = await fetch(`${base}/api/saves/2`, { method: 'PUT', ...json({ save: { history: [] }, details: { date: 1 } }) });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });

    res = await fetch(`${base}/api/saves/2`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { slot: 2, data: { history: [] } });

    res = await fetch(`${base}/api/saves/details`);
    assert.deepEqual(await res.json(), [{ slot: 2, data: { date: 1 } }]);

    res = await fetch(`${base}/api/saves/2`, { method: 'DELETE' });
    assert.equal(res.status, 200);

    res = await fetch(`${base}/api/saves/2`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'not found' });
  } finally {
    await close();
  }
});

test('get all saves', async () => {
  const { base, close } = await startApp();
  try {
    await fetch(`${base}/api/saves/1`, { method: 'PUT', ...json({ save: { history: ['a'] }, details: {} }) });
    await fetch(`${base}/api/saves/0`, { method: 'PUT', ...json({ save: { history: ['b'] }, details: {} }) });
    const res = await fetch(`${base}/api/saves`);
    assert.deepEqual(await res.json(), [
      { slot: 0, data: { history: ['b'] } },
      { slot: 1, data: { history: ['a'] } },
    ]);
  } finally {
    await close();
  }
});

test('delete all', async () => {
  const { base, close } = await startApp();
  try {
    await fetch(`${base}/api/saves/1`, { method: 'PUT', ...json({ save: { history: [] }, details: {} }) });
    const res = await fetch(`${base}/api/saves`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.deepEqual(await (await fetch(`${base}/api/saves/details`)).json(), []);
  } finally {
    await close();
  }
});

test('rejects bad slots', async () => {
  const { base, close } = await startApp();
  try {
    for (const p of ['-1', '1.5', '1e9', 'abc']) {
      const res = await fetch(`${base}/api/saves/${p}`);
      assert.equal(res.status, 400, `slot ${p}`);
      assert.deepEqual(await res.json(), { error: 'invalid slot' });
    }
    const res = await fetch(`${base}/api/saves/..%2Fx`);
    assert.ok([400, 404].includes(res.status), `status ${res.status}`);
  } finally {
    await close();
  }
});

test('rejects bad bodies', async () => {
  const { base, close } = await startApp();
  try {
    for (const body of [{}, { save: 1, details: {} }, { save: {}, details: null }]) {
      const res = await fetch(`${base}/api/saves/1`, { method: 'PUT', ...json(body) });
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    const res = await fetch(`${base}/api/saves/1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    assert.equal(res.status, 400);
  } finally {
    await close();
  }
});

test('accepts a 10MB body', async () => {
  const { base, close } = await startApp();
  try {
    const res = await fetch(`${base}/api/saves/1`, {
      method: 'PUT',
      ...json({ save: { history: ['x'.repeat(10 * 1024 * 1024)] }, details: {} }),
    });
    assert.equal(res.status, 200);
  } finally {
    await close();
  }
});

test('serves dist html with encoded spaces', async () => {
  const { base, close } = await startApp();
  try {
    const res = await fetch(`${base}${KR_URL}`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'patched');
  } finally {
    await close();
  }
});

test('serves images from imgDir', async () => {
  const { base, close } = await startApp();
  try {
    const res = await fetch(`${base}/img/x.txt`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'img');
  } finally {
    await close();
  }
});

test('root redirects to single dist html', async () => {
  const { base, close } = await startApp();
  try {
    const res = await fetch(`${base}/`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), KR_URL);
  } finally {
    await close();
  }
});

test('root lists when dist has two html files', async () => {
  const { base, distDir, close } = await startApp();
  try {
    await fs.writeFile(path.join(distDir, 'other.html'), 'o');
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(body.includes(KR));
    assert.ok(body.includes('other.html'));
  } finally {
    await close();
  }
});

test('token required when configured', async () => {
  const { base, close } = await startApp({ token: 's3cret' });
  try {
    let res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'unauthorized' });
    res = await fetch(`${base}/api/health`, { headers: { authorization: 'Bearer s3cret' } });
    assert.equal(res.status, 200);
    res = await fetch(`${base}/img/x.txt`);
    assert.equal(res.status, 200);
  } finally {
    await close();
  }
});

test('only dist and img are served', async () => {
  const { base, root, close } = await startApp();
  try {
    await fs.mkdir(path.join(root, 'server', 'saves'), { recursive: true });
    await fs.writeFile(path.join(root, 'server', 'saves', 'slot-1.json'), '{"secret":1}');
    await fs.writeFile(path.join(root, 'README.md'), 'x');
    for (const p of [
      '/server/saves/slot-1.json',
      '/README.md',
      '/img/%2e%2e/server/saves/slot-1.json',
      '/img/../server/saves/slot-1.json',
      '/img/',
    ]) {
      assert.equal((await fetch(`${base}${p}`)).status, 404, p);
    }
    assert.equal((await fetch(`${base}${KR_URL}`)).status, 200);
    assert.equal((await fetch(`${base}/img/x.txt`)).status, 200);
  } finally {
    await close();
  }
});
