import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FRAGMENT = fs.readFileSync(path.join(here, '..', 'remote-idb.js'), 'utf8');

function section(name) {
  const marker = `// === section: ${name}`;
  const start = FRAGMENT.indexOf(marker);
  if (start < 0) throw new Error(`missing ${marker}`);
  const next = FRAGMENT.indexOf('// === section:', start + marker.length);
  return FRAGMENT.slice(start + marker.length, next < 0 ? undefined : next);
}

/** Build the fragment inside a fake idb closure with controllable globals. */
function harness({ responses = [], fetchImpl, promptAnswers = [], state = {}, timeouts, vars } = {}) {
  const calls = [];
  const promptCalls = [];
  const queue = [...responses];
  const fetch =
    fetchImpl ??
    (async (url, init = {}) => {
      calls.push([init.method ?? 'GET', url, init.body ?? null, init.headers ?? {}, init.signal]);
      const r = queue.shift() ?? { status: 200, text: '{}' };
      if (r.reject) throw new Error(r.reject);
      return { status: r.status, ok: r.status >= 200 && r.status < 300, text: async () => r.text };
    });
  const storage = new Map();
  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };
  const prompt = (msg) => {
    promptCalls.push(msg);
    return promptAnswers.shift() ?? null;
  };
  const State = {
    qc: 3,
    passage: 'P',
    history: [],
    deltaEncode: () => 'D',
    deltaDecode: (d) => d,
    marshalForSave: () => ({ history: [{ variables: { saveId: 1 } }], index: 0 }),
    unmarshalForSave: (s) => State.calls.push(['unmarshal', s]),
    show: () => State.calls.push(['show']),
    calls: [],
    ...state,
  };
  const Story = { domId: 'dol', get: () => ({ description: () => 'desc' }) };
  const Save = { onLoad: { handlers: [] }, onSave: { handlers: [] } };
  const V = vars ?? { saveId: 1, saveName: 'n' };
  const window = { Errors: null };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const location = { origin: 'http://srv', host: 'srv' };
  const build = new Function(
    'V', 'State', 'Story', 'Save', 'clone', 'window', 'localStorage', 'location', 'fetch', 'prompt', 'console',
    `let _lock=true,_active=true,_settings={},_saveDetails=[],footerHTML="";const baddies=[];
     const logCalls=[]; const log=(d,x)=>logCalls.push([d,x]); function funNuke(){} function ekuNnuf(){}
     ${section('settings')}
     ${timeouts ? section('storage').replace('health: 10000', `health: ${timeouts.health}`).replace('request: 120000', `request: ${timeouts.request}`) : section('storage')}
     return {get lock(){return _lock}, get saveDetails(){return _saveDetails}, get settings(){return _settings}, logCalls,
             updateSettings, init, getItem, setItem, deleteItem, loadState, saveState, getSaveDetails, getAllSaves, clearAll, apiFetch};`
  );
  const idb = build(V, State, Story, Save, clone, window, localStorage, location, fetch, prompt, { log() {}, warn() {} });
  return { idb, calls, promptCalls, storage, State, Save };
}

const ok = (obj) => ({ status: 200, text: JSON.stringify(obj) });

async function ready(opts) {
  const h = harness({ ...opts, responses: [ok({ ok: true }), ...(opts?.responses ?? [])] });
  await h.idb.init();
  h.calls.length = 0;
  return h;
}

test('init unlocks on success', async () => {
  const h = harness({ responses: [ok({ ok: true })] });
  assert.equal(h.idb.lock, true);
  await h.idb.init();
  assert.equal(h.idb.lock, false);
  assert.deepEqual(h.idb.logCalls, []);
  assert.equal(h.calls[0][1], 'http://srv/api/health');
});

test('init unlocks and logs on failure', async () => {
  const h = harness({ responses: [{ reject: 'down' }] });
  await h.idb.init();
  assert.equal(h.idb.lock, false);
  assert.equal(h.idb.logCalls[0][0], '세이브 서버에 연결할 수 없습니다');
});

test('setItem PUTs save and details', async () => {
  const h = await ready({ responses: [ok({ ok: true })] });
  const result = await h.idb.setItem(2, { history: [{ variables: { saveId: 1 } }], index: 0 }, { metadata: {} });
  assert.equal(result, true);
  const [method, url, body] = h.calls[0];
  assert.equal(method, 'PUT');
  assert.equal(url, 'http://srv/api/saves/2');
  const parsed = JSON.parse(body);
  assert.ok(parsed.save);
  assert.equal(parsed.details.metadata.saveId, 1);
});

test('setItem slot>0 with useDelta sends delta not history', async () => {
  const h = await ready({ responses: [ok({ ok: true })] });
  h.idb.updateSettings('useDelta', true);
  await h.idb.setItem(2, { history: [{ variables: {} }], index: 0 }, { metadata: {} });
  const parsed = JSON.parse(h.calls[0][2]);
  assert.equal(parsed.save.delta, 'D');
  assert.equal('history' in parsed.save, false);
});

test('setItem returns false and logs on 500', async () => {
  const h = await ready({ responses: [{ status: 500, text: 'boom' }] });
  const result = await h.idb.setItem(2, { history: [{ variables: {} }], index: 0 }, { metadata: {} });
  assert.equal(result, false);
  assert.equal(h.idb.logCalls.length, 1);
});

test('setItem rejects objects without history', async () => {
  const h = await ready();
  assert.equal(await h.idb.setItem(2, { nope: 1 }, { metadata: {} }), false);
  assert.equal(h.calls.length, 0);
});

test('requests are serialized in call order', async () => {
  const events = [];
  let resolveFirst;
  const fetchImpl = async (url, init = {}) => {
    events.push(`start ${init.method} ${url}`);
    if (url.endsWith('/api/health')) return { status: 200, ok: true, text: async () => '{}' };
    if (url.endsWith('/1')) await new Promise((r) => (resolveFirst = r));
    events.push(`end ${init.method} ${url}`);
    return { status: 200, ok: true, text: async () => '{"ok":true}' };
  };
  const h = harness({ fetchImpl });
  await h.idb.init();
  const p1 = h.idb.setItem(1, { history: [{ variables: {} }], index: 0 }, { metadata: {} });
  const p2 = h.idb.setItem(2, { history: [{ variables: {} }], index: 0 }, { metadata: {} });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(events.slice(1), ['start PUT http://srv/api/saves/1']);
  resolveFirst();
  await Promise.all([p1, p2]);
  assert.deepEqual(events.slice(1), [
    'start PUT http://srv/api/saves/1',
    'end PUT http://srv/api/saves/1',
    'start PUT http://srv/api/saves/2',
    'end PUT http://srv/api/saves/2',
  ]);
});

test('getItem returns null on 404', async () => {
  const h = await ready({ responses: [{ status: 404, text: '{"error":"not found"}' }] });
  assert.equal(await h.idb.getItem(5), null);
});

test('getSaveDetails stores result', async () => {
  const details = [{ slot: 1, data: { date: 1 } }];
  const h = await ready({ responses: [ok(details)] });
  assert.deepEqual(await h.idb.getSaveDetails(), details);
  assert.deepEqual(h.idb.saveDetails, details);
  assert.equal(h.calls[0][1], 'http://srv/api/saves/details');
});

test('getSaveDetails logs and rethrows on failure', async () => {
  const h = await ready({ responses: [{ status: 500, text: 'x' }] });
  await assert.rejects(() => h.idb.getSaveDetails());
  assert.equal(h.idb.logCalls.length, 1);
});

test('deleteItem DELETEs then refreshes details', async () => {
  const h = await ready({ responses: [ok({ ok: true }), ok([])] });
  await h.idb.deleteItem(3);
  assert.deepEqual(h.calls.map((c) => [c[0], c[1]]), [
    ['DELETE', 'http://srv/api/saves/3'],
    ['GET', 'http://srv/api/saves/details'],
  ]);
});

test('clearAll DELETEs /api/saves and empties cache', async () => {
  const h = await ready({ responses: [ok([{ slot: 1, data: {} }]), ok({ ok: true })] });
  await h.idb.getSaveDetails();
  await h.idb.clearAll();
  assert.deepEqual(h.calls[1].slice(0, 2), ['DELETE', 'http://srv/api/saves']);
  assert.deepEqual(h.idb.saveDetails, []);
});

test('loadState fetches details when cache misses', async () => {
  const h = await ready({
    responses: [ok({ slot: 1, data: { history: [{ variables: {} }], index: 0 } }), ok([{ slot: 1, data: { idx: 7 } }])],
  });
  await h.idb.loadState(1);
  assert.equal(h.calls[1][1], 'http://srv/api/saves/details');
  const unmarshal = h.State.calls.find((c) => c[0] === 'unmarshal');
  assert.equal(unmarshal[1].idx, 7);
  assert.ok(h.State.calls.some((c) => c[0] === 'show'));
});

test('loadState returns false for empty slot', async () => {
  const h = await ready({ responses: [{ status: 404, text: '{}' }] });
  assert.equal(await h.idb.loadState(9), false);
  assert.equal(h.State.calls.length, 0);
});

test('prompts for token once on 401', async () => {
  const h = await ready({ responses: [{ status: 401, text: '{"error":"unauthorized"}' }, ok({ ok: true })], promptAnswers: ['pw'] });
  await h.idb.apiFetch('/api/health');
  assert.equal(h.promptCalls.length, 1);
  assert.equal(h.promptCalls[0], '세이브 서버 비밀번호를 입력하세요');
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1][3].Authorization, 'Bearer pw');
  assert.equal(h.storage.get('dol-remote-token'), 'pw');
});

test('cancelled prompt fails without loop', async () => {
  const h = await ready({ responses: [{ status: 401, text: '{}' }], promptAnswers: [null] });
  await assert.rejects(() => h.idb.apiFetch('/api/health'));
  assert.equal(h.calls.length, 1);
  assert.equal(h.promptCalls.length, 1);
});

test('updateSettings forces active true', async () => {
  const h = harness();
  h.storage.set('idb-settings', JSON.stringify({ warnSave: false, warnLoad: false, warnDelete: true, active: false, useDelta: true }));
  assert.equal(h.idb.updateSettings('active'), true);
  h.idb.updateSettings('active', false);
  assert.equal(h.idb.updateSettings('active'), true);
  assert.equal(JSON.parse(h.storage.get('idb-settings')).active, true);
  h.idb.updateSettings('warnSave', true);
  assert.equal(h.idb.updateSettings('warnSave'), true);
});

test('saveState runs onSave handlers and PUTs details without state', async () => {
  const h = await ready({ responses: [ok({ ok: true }), ok([{ slot: 2, data: {} }])] });
  const seen = [];
  h.Save.onSave.handlers.push((obj, info) => seen.push([Object.keys(obj).sort(), info]));
  assert.equal(await h.idb.saveState(2, 'title', { saveId: 1, saveName: 'n' }), true);
  assert.deepEqual(seen, [[['date', 'id', 'idx', 'metadata', 'state', 'title'], { type: 'slot' }]]);
  const [method, url, body] = h.calls[0];
  assert.equal(`${method} ${url}`, 'PUT http://srv/api/saves/2');
  const parsed = JSON.parse(body);
  assert.equal('state' in parsed.details, false);
  assert.equal(parsed.details.title, 'title');
  assert.equal(parsed.details.idx, 3);
  assert.equal(h.calls[1][1], 'http://srv/api/saves/details');
});

test('saveState slot 0 reports autosave and assigns a saveId when missing', async () => {
  const h = harness({
    responses: [ok({ ok: true }), ok({ ok: true }), ok([])],
    vars: { saveName: 'n' },
    state: { history: [{ variables: {} }], marshalForSave: () => ({ history: [{ variables: {} }], index: 0 }) },
  });
  await h.idb.init();
  const types = [];
  h.Save.onSave.handlers.push((obj, info) => types.push(info.type));
  await h.idb.saveState(0);
  assert.deepEqual(types, ['autosave']);
  assert.ok(Number.isInteger(h.State.history[0].variables.saveId));
  const parsed = JSON.parse(h.calls[1][2]);
  assert.ok(Array.isArray(parsed.save.history), 'slot 0 keeps full history (no delta)');
});

test('fetch requests carry an abort signal', async () => {
  const h = await ready({ responses: [ok({ ok: true })] });
  await h.idb.getItem(1);
  assert.ok(h.calls[0][4] instanceof AbortSignal);
  assert.equal(h.calls[0][4].aborted, false);
});

test('a hung health check times out, unlocks and logs', { timeout: 2000 }, async () => {
  const fetchImpl = (url, init = {}) =>
    new Promise((resolve, reject) => {
      if (init.signal) init.signal.addEventListener('abort', () => reject(init.signal.reason));
      // without a signal this never settles, and the test times out
    });
  const h = harness({ fetchImpl, timeouts: { health: 20, request: 20 } });
  await h.idb.init();
  assert.equal(h.idb.lock, false);
  assert.equal(h.idb.logCalls[0][0], '세이브 서버에 연결할 수 없습니다');
});

test('a hung save times out, logs, and lets the next request run', { timeout: 2000 }, async () => {
  let n = 0;
  const fetchImpl = (url, init = {}) =>
    new Promise((resolve, reject) => {
      n++;
      if (n === 2) {
        if (init.signal) init.signal.addEventListener('abort', () => reject(init.signal.reason));
        return;
      }
      resolve({ status: 200, ok: true, text: async () => '{"ok":true}' });
    });
  const h = harness({ fetchImpl, timeouts: { health: 20, request: 20 } });
  await h.idb.init();
  const r1 = await h.idb.setItem(1, { history: [{ variables: {} }], index: 0 }, { metadata: {} });
  const r2 = await h.idb.setItem(2, { history: [{ variables: {} }], index: 0 }, { metadata: {} });
  assert.equal(r1, false);
  assert.equal(r2, true);
  assert.equal(h.idb.logCalls.length, 1);
});
