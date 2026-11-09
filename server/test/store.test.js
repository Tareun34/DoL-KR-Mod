import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../store.js';

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'dol-store-'));
}

test('put then get round-trips save and details', async () => {
  const store = await createStore(await tmpDir());
  await store.putSave(1, { history: [1] }, { date: 5, title: 't' });
  assert.deepEqual(await store.getSave(1), { slot: 1, data: { history: [1] } });
  assert.deepEqual(await store.getDetails(), [{ slot: 1, data: { date: 5, title: 't' } }]);
});

test('details are sorted by slot ascending', async () => {
  const store = await createStore(await tmpDir());
  for (const slot of [10, 0, 2]) await store.putSave(slot, { history: [] }, { date: slot });
  assert.deepEqual((await store.getDetails()).map((d) => d.slot), [0, 2, 10]);
});

test('getSave of empty slot returns null', async () => {
  const store = await createStore(await tmpDir());
  assert.equal(await store.getSave(5), null);
});

test('deleteSave removes file and index entry; deleting absent slot is fine', async () => {
  const dir = await tmpDir();
  const store = await createStore(dir);
  await store.putSave(3, { history: [] }, { date: 1 });
  await store.deleteSave(3);
  assert.equal(await store.getSave(3), null);
  assert.deepEqual(await store.getDetails(), []);
  assert.deepEqual(await fs.readdir(dir), ['details.json']);
  await store.deleteSave(42);
});

test('clear removes everything', async () => {
  const dir = await tmpDir();
  const store = await createStore(dir);
  await store.putSave(1, { history: [] }, { date: 1 });
  await store.putSave(2, { history: [] }, { date: 2 });
  await store.clear();
  assert.deepEqual(await store.getDetails(), []);
  assert.deepEqual(await store.getAllSaves(), []);
  assert.deepEqual(await fs.readdir(dir), ['details.json']);
});

test('no tmp files remain after writes', async () => {
  const dir = await tmpDir();
  const store = await createStore(dir);
  await store.putSave(1, { history: [] }, { date: 1 });
  await store.deleteSave(1);
  await store.putSave(2, { history: [] }, { date: 2 });
  const names = await fs.readdir(dir);
  assert.ok(names.every((n) => !n.endsWith('.tmp')), `tmp files left: ${names}`);
});

test('rebuild on createStore recreates details.json from slot files', async () => {
  const dir = await tmpDir();
  await fs.writeFile(
    path.join(dir, 'slot-4.json'),
    JSON.stringify({ slot: 4, save: { history: [] }, details: { date: 44 } })
  );
  const store = await createStore(dir);
  assert.deepEqual(await store.getDetails(), [{ slot: 4, data: { date: 44 } }]);
  assert.ok((await fs.readdir(dir)).includes('details.json'));
});

test('rebuild skips corrupt files', async () => {
  const dir = await tmpDir();
  await fs.writeFile(path.join(dir, 'slot-3.json'), 'not json');
  await fs.writeFile(
    path.join(dir, 'slot-7.json'),
    JSON.stringify({ slot: 7, save: { history: [] }, details: { date: 7 } })
  );
  await fs.writeFile(path.join(dir, 'slot-9.json.1.2.tmp'), '{');
  const store = await createStore(dir);
  assert.deepEqual(await store.getDetails(), [{ slot: 7, data: { date: 7 } }]);
  assert.ok(!(await fs.readdir(dir)).includes('slot-9.json.1.2.tmp'));
});

test('concurrent puts to one slot', async () => {
  const dir = await tmpDir();
  const store = await createStore(dir);
  await Promise.all(
    Array.from({ length: 20 }, (_, i) => store.putSave(1, { history: [i] }, { date: i }))
  );
  const file = JSON.parse(await fs.readFile(path.join(dir, 'slot-1.json'), 'utf8'));
  const i = file.save.history[0];
  assert.ok(Number.isInteger(i) && i >= 0 && i < 20);
  assert.equal(file.details.date, i);
  const details = JSON.parse(await fs.readFile(path.join(dir, 'details.json'), 'utf8'));
  assert.deepEqual(details, [{ slot: 1, data: { date: i } }]);
});

test('getAllSaves returns every slot', async () => {
  const store = await createStore(await tmpDir());
  await store.putSave(2, { history: ['b'] }, { date: 2 });
  await store.putSave(0, { history: ['a'] }, { date: 0 });
  assert.deepEqual(await store.getAllSaves(), [
    { slot: 0, data: { history: ['a'] } },
    { slot: 2, data: { history: ['b'] } },
  ]);
});
