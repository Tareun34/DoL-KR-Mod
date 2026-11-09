import fs from 'node:fs/promises';
import path from 'node:path';

const SLOT_FILE = /^slot-(\d+)\.json$/;
const DETAILS_FILE = 'details.json';

let tmpCounter = 0;

/** Write `text` to `filePath` via a temp file, fsync, and rename. */
export async function writeAtomic(filePath, text) {
  const tmp = `${filePath}.${process.pid}.${++tmpCounter}.tmp`;
  const handle = await fs.open(tmp, 'w');
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, filePath);
}

/** Serialize async work per key: each call waits for the previous call with the same key. */
function makeLocks() {
  const chains = new Map();
  return function withLock(key, fn) {
    const prev = chains.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    chains.set(key, tail);
    tail.then(() => {
      if (chains.get(key) === tail) chains.delete(key);
    });
    return run;
  };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

export async function createStore(dataDir) {
  await fs.mkdir(dataDir, { recursive: true });
  const withLock = makeLocks();
  const DETAILS_KEY = Symbol('details');
  const slotPath = (slot) => path.join(dataDir, `slot-${slot}.json`);
  const detailsPath = path.join(dataDir, DETAILS_FILE);

  async function readDetails() {
    try {
      return await readJson(detailsPath);
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  function writeDetails(list) {
    list.sort((a, b) => a.slot - b.slot);
    return writeAtomic(detailsPath, JSON.stringify(list));
  }

  /** Apply `update(list) -> list` to details.json under the details lock. */
  function updateDetails(update) {
    return withLock(DETAILS_KEY, async () => writeDetails(update(await readDetails())));
  }

  async function rebuild() {
    const names = await fs.readdir(dataDir);
    const list = [];
    for (const name of names) {
      if (name.endsWith('.tmp')) {
        await fs.rm(path.join(dataDir, name), { force: true });
        continue;
      }
      const m = SLOT_FILE.exec(name);
      if (!m) continue;
      try {
        const file = await readJson(path.join(dataDir, name));
        list.push({ slot: Number(m[1]), data: file.details });
      } catch {
        console.warn('skipping corrupt slot file', name);
      }
    }
    await writeDetails(list);
  }

  await rebuild();

  async function readSlotFile(slot) {
    try {
      return await readJson(slotPath(slot));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  return {
    getDetails: () => withLock(DETAILS_KEY, readDetails),

    async getSave(slot) {
      const file = await withLock(slot, () => readSlotFile(slot));
      return file ? { slot, data: file.save } : null;
    },

    async getAllSaves() {
      const names = await fs.readdir(dataDir);
      const slots = names.map((n) => SLOT_FILE.exec(n)).filter(Boolean).map((m) => Number(m[1]));
      slots.sort((a, b) => a - b);
      const out = [];
      for (const slot of slots) {
        const file = await withLock(slot, () => readSlotFile(slot));
        if (file) out.push({ slot, data: file.save });
      }
      return out;
    },

    putSave(slot, save, details) {
      return withLock(slot, async () => {
        await writeAtomic(slotPath(slot), JSON.stringify({ slot, save, details }));
        await updateDetails((list) => [...list.filter((d) => d.slot !== slot), { slot, data: details }]);
      });
    },

    deleteSave(slot) {
      return withLock(slot, async () => {
        await fs.rm(slotPath(slot), { force: true });
        await updateDetails((list) => list.filter((d) => d.slot !== slot));
      });
    },

    async clear() {
      const names = await fs.readdir(dataDir);
      for (const name of names) {
        const m = SLOT_FILE.exec(name);
        if (!m) continue;
        const slot = Number(m[1]);
        await withLock(slot, () => fs.rm(slotPath(slot), { force: true }));
      }
      await updateDetails(() => []);
    },
  };
}
