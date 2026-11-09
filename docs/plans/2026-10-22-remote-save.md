# DoL Remote Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace DoL's IndexedDB save storage with a self-hosted HTTP save server, so the Korean build can be played from any device via Tailscale with one shared set of save slots.

**Architecture:** A small Express server stores one JSON file per slot under a data dir, keeps a `details.json` index, and serves the game folder statically with `dist/` (patched HTML) layered on top. A Python patcher rewrites only the storage layer of the minified `idb` module inside the game HTML, swapping IndexedDB calls for `fetch` calls to that server; the save-menu UI code is untouched.

**Tech Stack:** Node.js 22 + Express 5 (server, `node:test` for tests), Python 3.9+ stdlib (patcher, `unittest`), Docker Compose. Client fragment is plain ES2020 browser JS.

**Spec:** `dol-remote-save/docs/specs/2026-10-22-remote-save-design.md`

All paths below are relative to `dol-remote-save/` unless they start with `../`. The game folder (`../`) contains `Degrees of Lewdity_kr.html`, `img/`, `style.css`.

## Global Constraints

- Original HTML files in `../` are never modified. Patched output goes to `dist/`.
- `patch.py` runs on Python 3.9 (local Mac) with the standard library only. No `match` statements.
- Server runs on Node 22 (local dev machine has Node 24; both must work). Only runtime dependency: `express`.
- Every anchor used by the patcher must match **exactly once**; any miss aborts with the anchor's name printed. Never a regex over the HTML.
- Save files: `slot-<n>.json` containing `{"slot": n, "save": <saveObj>, "details": <detailsObj>}`; index `details.json` containing `[{"slot": n, "data": <detailsObj>}]` sorted by slot ascending. Slot is an integer ≥ 0.
- All file writes go through tmp-file + fsync + rename.
- JSON body limit 64MB. Auth only when env `SAVE_TOKEN` is non-empty: `Authorization: Bearer <token>` on `/api/*`, else 401 `{"error":"unauthorized"}`.
- Client: requests to the save API are serialized through one promise queue; `_lock` is only `true` before `init()` finishes; `init()` always ends with `_lock=false`.
- The client never writes saves to IndexedDB or localStorage. `idb-settings` (confirm toggles) stays in localStorage. Token stays in localStorage under `dol-remote-token`.
- User-visible strings added by this work are Korean: 서버 연결 실패 `세이브 서버에 연결할 수 없습니다`, token prompt `세이브 서버 비밀번호를 입력하세요`, footer `원격 저장: <host>`.
- Git: `dol-remote-save/` is its own git repository (Task 1 creates it). `dist/`, `server/saves/`, `node_modules/` are ignored.

## Review Focus

1. Slot path params like `-1`, `1.5`, `1e9`, `abc`, `../x` must return 400 and never touch the filesystem. (Task 2 test `rejects bad slots`)
2. A corrupt or half-written slot file (`slot-3.json` with invalid JSON, or a leftover `*.tmp`) at startup must be skipped with a log line; the server still starts and other slots list fine. (Task 1 test `rebuild skips corrupt files`)
3. Two overlapping PUTs to the same slot must leave one intact file and a consistent `details.json`, never interleaved bytes. (Task 1 test `concurrent puts to one slot`)
4. With `SAVE_TOKEN` set, the client gets 401, prompts once; if the user cancels the prompt the request fails via `log` and does not loop. (Task 4 tests `prompts for token once on 401`, `cancelled prompt fails without loop`)
5. The patched HTML file name has spaces; `/Degrees%20of%20Lewdity_kr.html` must be served from `dist/`, and `/` must redirect there when it is the only patched file. (Task 2 tests `serves dist html with encoded spaces`, `root redirects to single dist html`)

---

### Task 1: Save store with atomic files and index

**Files:**
- Create: `.gitignore`, `server/package.json`, `server/store.js`
- Test: `server/test/store.test.js`

**Interfaces:**
- Produces:
  - `createStore(dataDir: string): Promise<Store>` — creates `dataDir` if missing, rebuilds `details.json` from `slot-*.json`, returns a store.
  - `Store.getDetails(): Promise<Array<{slot:number, data:object}>>` — from `details.json`, sorted ascending.
  - `Store.getSave(slot:number): Promise<{slot:number, data:object} | null>` — `data` is the stored `save`.
  - `Store.getAllSaves(): Promise<Array<{slot:number, data:object}>>` — sorted ascending.
  - `Store.putSave(slot:number, save:object, details:object): Promise<void>`
  - `Store.deleteSave(slot:number): Promise<void>` — no error if absent.
  - `Store.clear(): Promise<void>` — removes all slot files, writes `[]` to `details.json`.
  - `writeAtomic(filePath:string, text:string): Promise<void>` (exported for tests) — writes `${filePath}.${process.pid}.${counter}.tmp`, `fsync`, `rename`.

- [ ] **Step 1: Scaffold the repo**

```bash
cd dol-remote-save && git init
printf 'dist/\nserver/saves/\nnode_modules/\n' > .gitignore
```
`server/package.json`: `"name":"dol-remote-save-server"`, `"type":"module"`, `"engines":{"node":">=22"}`, scripts `"start":"node server.js"`, `"test":"node --test test/"`, dependency `express` `^5`. Run `cd server && npm install`.

- [ ] **Step 2: Write the failing store tests** in `server/test/store.test.js` (`node:test`, each test uses a fresh `fs.mkdtemp` dir):

```js
test('put then get round-trips save and details', ...)   // putSave(1,{history:[1]},{date:5,title:'t'}); getSave(1) → {slot:1,data:{history:[1]}}; getDetails() → [{slot:1,data:{date:5,title:'t'}}]
test('details are sorted by slot ascending', ...)          // put 10, 0, 2 → slots [0,2,10]
test('getSave of empty slot returns null', ...)
test('deleteSave removes file and index entry; deleting absent slot is fine', ...)
test('clear removes everything', ...)
test('no tmp files remain after writes', ...)             // readdir has no name ending in '.tmp'
test('rebuild on createStore recreates details.json from slot files', ...) // write slot-4.json by hand, delete details.json, createStore → getDetails has slot 4
test('rebuild skips corrupt files', ...)                   // slot-3.json = 'not json', slot-7.json valid, stale 'slot-9.json.1.2.tmp' → createStore resolves; getDetails = [slot 7]; tmp file removed
test('concurrent puts to one slot', ...)                   // Promise.all of 20 putSave(1, {history:[i]}, {date:i}) → file parses, data.history[0] is one of 0..19, details.json date equals that same i
test('getAllSaves returns every slot', ...)
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd server && npm test`
Expected: FAIL, `Cannot find module './store.js'` or equivalent.

- [ ] **Step 4: Implement `server/store.js`**

Per-slot mutex: `Map<number, Promise>`; chain each slot's operations. A separate global chain for `details.json` updates. `rebuild` reads every `slot-*.json` (filename test `^slot-(\d+)\.json$`), `JSON.parse` in try/catch, `console.warn('skipping corrupt slot file', name)` on failure, deletes leftover `*.tmp`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add .gitignore server/package.json server/package-lock.json server/store.js server/test/store.test.js
git commit -m "feat(server): save store with atomic slot files and details index"
```

---

### Task 2: HTTP API and static game serving

**Files:**
- Create: `server/app.js`, `server/server.js`
- Test: `server/test/app.test.js`

**Interfaces:**
- Consumes: `createStore`, `Store` from Task 1.
- Produces:
  - `createApp({store, gameDir, distDir, token}): express.Application`
  - `server/server.js` reads env `PORT` (default `8080`), `DATA_DIR` (default `/data`), `GAME_DIR` (default `/game`), `DIST_DIR` (default `${GAME_DIR}/dol-remote-save/dist`), `SAVE_TOKEN` (default empty), calls `createStore`, `createApp`, listens on `0.0.0.0:PORT`.
  - Routes (all JSON, errors as `{error: string}`):
    - `GET /api/health` → 200 `{ok:true}`
    - `GET /api/saves/details` → 200 array
    - `GET /api/saves` → 200 array
    - `GET /api/saves/:slot` → 200 `{slot,data}` or 404 `{error:"not found"}`
    - `PUT /api/saves/:slot` body `{save:object, details:object}` → 200 `{ok:true}`; 400 if either is missing or not an object
    - `DELETE /api/saves/:slot` → 200 `{ok:true}`
    - `DELETE /api/saves` → 200 `{ok:true}`
    - `:slot` valid iff `/^\d+$/.test(param)` → 400 `{error:"invalid slot"}` otherwise
  - Static: `express.static(distDir)` then `express.static(gameDir)`; `GET /` lists `*.html` in `distDir`; exactly one → 302 to `/<encodeURIComponent(name)>`; zero or many → 200 HTML `<ul>` of links.
  - One log line per request to stdout: `METHOD URL STATUS MSms`.

- [ ] **Step 1: Write the failing app tests** in `server/test/app.test.js`. Helper `startApp({token})` creates temp `dataDir`, `gameDir` (with `img/x.txt` containing `img`), `distDir` (with `Degrees of Lewdity_kr.html` containing `patched`), listens on port 0, returns `{base, close}`; tests use global `fetch`.

```js
test('health', ...)                                   // GET /api/health → 200 {ok:true}
test('put get details delete flow', ...)              // PUT 2 {save:{history:[]},details:{date:1}} → 200; GET /api/saves/2 → data.history []; GET details → [{slot:2,...}]; DELETE 2 → 200; GET /api/saves/2 → 404
test('get all saves', ...)
test('delete all', ...)
test('rejects bad slots', ...)                        // for p of ['-1','1.5','1e9','abc'] → GET /api/saves/${p} → 400; GET /api/saves/..%2Fx → status is 400 or 404, never 200
test('rejects bad bodies', ...)                       // PUT with {}, {save:1,details:{}}, {save:{},details:null}, non-JSON text → 400
test('accepts a 10MB body', ...)                      // PUT save:{history:['x'.repeat(10*1024*1024)]} → 200
test('serves dist html with encoded spaces', ...)     // GET /Degrees%20of%20Lewdity_kr.html → body 'patched'
test('serves game assets from gameDir', ...)          // GET /img/x.txt → 'img'
test('root redirects to single dist html', ...)       // GET / (redirect:'manual') → 302, location '/Degrees%20of%20Lewdity_kr.html'
test('root lists when dist has two html files', ...)  // add second file → 200, body contains both names
test('token required when configured', ...)           // startApp({token:'s3cret'}); GET /api/health → 401 {error:'unauthorized'}; with header → 200; GET /img/x.txt → 200 without header
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npm test`
Expected: FAIL on `./app.js` import.

- [ ] **Step 3: Implement `server/app.js` and `server/server.js`**

`express.json({limit:'64mb'})` only on `/api`. Auth middleware before `/api` routes. Register `GET /api/saves/details` before `GET /api/saves/:slot`. Express 5 path syntax (no regex in route strings). JSON parse errors must produce 400, not 500.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npm test`
Expected: all PASS.

- [ ] **Step 5: Smoke-run against the real game folder**

Run from `server/`:
```bash
mkdir -p ../dist && PORT=8089 DATA_DIR=./saves GAME_DIR=../.. DIST_DIR=../dist node server.js &
sleep 1; curl -s localhost:8089/api/health; curl -sI 'localhost:8089/img/ui/coin-silver.gif' | head -1; kill %1
```
Expected: `{"ok":true}` and `HTTP/1.1 200 OK`.

- [ ] **Step 6: Commit**

```bash
git add server/app.js server/server.js server/test/app.test.js
git commit -m "feat(server): save API, auth, and static game serving"
```

---

### Task 3: Docker packaging

**Files:**
- Create: `server/Dockerfile`, `server/docker-compose.yml`, `server/.dockerignore`

**Interfaces:**
- Consumes: `server/server.js` env contract from Task 2.
- Produces: `docker compose up -d` in `server/` serves the game on host port 8080 with saves in `server/saves/`.

- [ ] **Step 1: Write `Dockerfile`**

`FROM node:22-alpine`, `WORKDIR /app`, copy `package*.json`, `RUN npm ci --omit=dev`, copy `*.js`, `ENV PORT=8080 DATA_DIR=/data GAME_DIR=/game`, `EXPOSE 8080`, `CMD ["node","server.js"]`. `.dockerignore`: `node_modules`, `saves`, `test`.

- [ ] **Step 2: Write `docker-compose.yml`**

Service `dol-save`: `build: .`, `ports: ["${HOST_PORT:-8080}:8080"]`, volumes `./saves:/data` and `../..:/game:ro`, `environment: SAVE_TOKEN: "${SAVE_TOKEN:-}"`, `restart: unless-stopped`.

- [ ] **Step 3: Verify the container works**

Run from `server/`:
```bash
docker compose build && HOST_PORT=8090 docker compose up -d
sleep 2; curl -s localhost:8090/api/health; curl -sI localhost:8090/img/ui/coin-silver.gif | head -1
curl -s -X PUT localhost:8090/api/saves/1 -H 'content-type: application/json' -d '{"save":{"history":[]},"details":{"date":1}}'; ls saves/
docker compose down
```
Expected: `{"ok":true}`, `HTTP/1.1 200 OK`, `{"ok":true}`, `saves/` lists `details.json slot-1.json`. Remove `saves/slot-1.json` and `saves/details.json` afterwards.

- [ ] **Step 4: Commit**

```bash
git add server/Dockerfile server/docker-compose.yml server/.dockerignore
git commit -m "feat(server): docker packaging"
```

---

### Task 4: Client storage fragment (`remote-idb.js`)

**Files:**
- Create: `patch/remote-idb.js`
- Test: `patch/test/remote-idb.test.js` (run with `node --test patch/test/`)

**Interfaces:**
- Consumes: HTTP API from Task 2.
- Produces: a JS **fragment** (not a module) with two sections delimited by exact marker lines `// === section: settings` and `// === section: storage`. The patcher (Task 5) splices each section into the idb closure, so the code may reference closure variables that already exist there: `_lock`, `_active`, `_settings`, `_saveDetails`, `footerHTML`, `baddies`, `log`, `funNuke`, `ekuNnuf`, and globals `V`, `State`, `Story`, `Save`, `clone`, `window`, `localStorage`, `location`, `fetch`, `prompt`, `console`.
  - settings section defines `function updateSettings(setting, value)` with the original behavior except `_settings.active` and `_active` are always `true` (reads of `"active"` return `true`; writes of `"active"` are ignored). Ends with the call `updateSettings();` like the original.
  - storage section defines: `const API_BASE = location.origin;` `function apiFetch(path, {method='GET', body}={}): Promise<any>` (throws `Error` with `${status} ${bodyText}` on non-2xx; returns `null` on 404; handles 401 once via `prompt`), `function enqueue(fn): Promise` (single promise chain), `async function init(): Promise<void>`, `async function importFromLocalStorage(){ return false; }`, `async function getItem(slot)`, `async function setItem(slot, saveObj, details)`, `async function deleteItem(slot)`, `async function loadState(slot)`, `async function saveState(slot, title, metadata)` (logic identical to the original minified `saveState`), `async function getSaveDetails()`, `async function getAllSaves()`, `async function clearAll()`.
  - Return contracts, matching the original: `setItem` → `true` on success, `false` on failure (after `log`); `getItem` → `{slot, data}` or `null`; `getSaveDetails` → array and assigns `_saveDetails` (on failure: `log`, then rethrow); `deleteItem` → calls `getSaveDetails()` after; `clearAll` → sets `_saveDetails=[]`; `loadState` → `false` when slot empty, otherwise runs `Save.onLoad.handlers`, `State.unmarshalForSave`, `State.show` as the original; if `_saveDetails` lacks the slot it calls `getSaveDetails()` first.
  - `init()` → `GET /api/health`; on error `log("세이브 서버에 연결할 수 없습니다", err)`; in `finally` sets `_lock = false`.

- [ ] **Step 1: Write the failing fragment tests**

Test harness in the test file: read `patch/remote-idb.js`, extract both sections by marker, build
```js
new Function('V','State','Story','Save','clone','window','localStorage','location','fetch','prompt','console',
  `let _lock=true,_active=true,_settings={},_saveDetails=[],footerHTML="";const baddies=[];
   const logCalls=[]; const log=(d,x)=>logCalls.push([d,x]); function funNuke(){} function ekuNnuf(){}
   ${settingsSection}
   ${storageSection}
   return {get lock(){return _lock}, get saveDetails(){return _saveDetails}, logCalls, updateSettings, init, getItem, setItem, deleteItem, loadState, saveState, getSaveDetails, getAllSaves, clearAll, apiFetch};`)
```
Fake `fetch` records `[method, url, bodyText, headers]` and returns queued responses `{status, text}`. Fake `localStorage` is a Map-backed object with `getItem`/`setItem`. `location = {origin:'http://srv', host:'srv'}`.

```js
test('init unlocks on success', ...)                     // health 200 → lock false, logCalls empty
test('init unlocks and logs on failure', ...)            // fetch rejects → lock false, logCalls[0][0] === '세이브 서버에 연결할 수 없습니다'
test('setItem PUTs save and details', ...)               // after init; setItem(2,{history:[{variables:{saveId:1}}],index:0},{metadata:{}}) → calls[0] = ['PUT','http://srv/api/saves/2', body with save.history & details.metadata.saveId===1]; returns true
test('setItem slot>0 with useDelta sends delta not history', ...) // State.deltaEncode stub returns 'D'; body.save.delta === 'D', no body.save.history
test('setItem returns false and logs on 500', ...)
test('setItem rejects objects without history', ...)     // returns false, no fetch
test('requests are serialized in call order', ...)       // fetch resolves out of order (2nd fast, 1st slow) → recorded start order is [PUT 1, PUT 2] and 2nd starts after 1st resolves
test('getItem returns null on 404', ...)
test('getSaveDetails stores result', ...)                // GET /api/saves/details → saveDetails equals response
test('getSaveDetails logs and rethrows on failure', ...)
test('deleteItem DELETEs then refreshes details', ...)   // calls = [DELETE /api/saves/3, GET /api/saves/details]
test('clearAll DELETEs /api/saves and empties cache', ...)
test('loadState fetches details when cache misses', ...) // cache [] ; responses: GET slot → {slot:1,data:{history:[{variables:{}}],index:0}}, GET details → [{slot:1,data:{idx:7}}]; State.unmarshalForSave called with state.idx===7; State.show called
test('loadState returns false for empty slot', ...)
test('prompts for token once on 401', ...)               // 401 → prompt returns 'pw' → retry has header 'Bearer pw' → 200; localStorage['dol-remote-token']==='pw'; prompt called once
test('cancelled prompt fails without loop', ...)         // 401, prompt returns null → rejects, fetch called once, prompt called once
test('updateSettings forces active true', ...)           // localStorage idb-settings {active:false,...} → updateSettings('active') === true; updateSettings('active',false) leaves stored active true
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test patch/test/`
Expected: FAIL (`ENOENT` reading `patch/remote-idb.js`).

- [ ] **Step 3: Implement `patch/remote-idb.js`**

Copy `saveState`, and the pre-processing part of `setItem` (`funNuke` loop, delta encoding, `detailsItem` construction, `metadata` merge) from the original module, reformatted but logically identical. The original module is the text between `const idb=(()=>{` and `window.idb=idb;` in `../Degrees of Lewdity_kr.html`; a pretty-printed copy exists at `/private/tmp/claude-501/-Users-chan-Documents----Degrees-of-Lewdity-0-5-12-13/fa9e5d37-681f-435c-b6fe-ee0dacac3709/scratchpad/idb_module_pretty.js`. Token: read `localStorage.getItem("dol-remote-token")`; send header only when non-empty; on 401 call `prompt("세이브 서버 비밀번호를 입력하세요")`, store, retry once; `null`/empty answer → throw. Body JSON via `JSON.stringify`; response via `JSON.parse(await res.text())`. Keep the fragment free of `import`/`export` and top-level `return`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test patch/test/`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add patch/remote-idb.js patch/test/remote-idb.test.js
git commit -m "feat(patch): remote storage fragment for the idb module"
```

---

### Task 5: HTML patcher (`patch.py`)

**Files:**
- Create: `patch/patch.py`, `patch/test/fixtures/idb-module.js` (verbatim copy of the extracted original module, from `const idb=(()=>{` up to but excluding `window.idb=idb;`)
- Test: `patch/test/test_patch.py` (`python3 -m unittest discover -s patch/test -p 'test_*.py'`)

**Interfaces:**
- Consumes: `patch/remote-idb.js` sections from Task 4.
- Produces:
  - CLI: `python3 patch/patch.py [INPUT_HTML] [--out-dir DIR] [--check]`. Defaults: `INPUT_HTML` = `<repo>/../Degrees of Lewdity_kr.html`, `--out-dir` = `<repo>/dist`. Output file = `<out-dir>/<basename of input>`. Prints one line per replacement (`ok  <name>`), then `wrote <path>` or `check ok`. On any failure: prints `missing anchor: <name>` (or `ambiguous anchor: <name> (N)`) to stderr and exits 1 without writing.
  - Library: `patch_html(html: str, fragment: str) -> str` raising `PatchError(name)`; `load_sections(fragment: str) -> dict` with keys `settings`, `storage`.
  - Replacement table (applied inside the single `const idb=(()=>{` … `window.idb=idb;` block, each anchor must occur exactly once in that block):

| name | from (exact text) | to (exact text) | replacement |
|---|---|---|---|
| module | `const idb=(()=>{` | `window.idb=idb;` | (locates the block; both must occur exactly once in the whole file) |
| guard | `if(null==window.indexedDB)return Object.freeze({lock:!0,init:()=>!1,` | through `set footerHTML(_){return!1}});` (inclusive) | removed |
| idb-open | `function dbUpgrade(ev){` | up to `function updateSettings(setting,value){` (exclusive) | removed |
| settings | `function updateSettings(setting,value){` | up to `const baddies=[];` (exclusive) | `settings` section |
| storage | `async function importFromLocalStorage(){` | up to `function savesAllowed(){` (exclusive) | `storage` section |
| getAllSaves | `getAllSaves:{value:async function(){const db=await openDB(),saves=db.transaction(["saves"],"readonly").objectStore("saves").getAll(),result=await makePromise(saves);return db.close(),result}}` | | `getAllSaves:{value:getAllSaves}` |
| active | `active:{get:()=>_active,set(val){_active=Boolean(val)}}` | | `active:{get:()=>_active,set(val){_active=Boolean(val)\|\|!(window.V&&V.ironmanmode)}}` |
| init | `init:{value:dbName=>openDB(dbName)}` | | `init:{value:init}` |
| footer | `footerHTML:{get:()=>footerHTML,set(val){footerHTML=val}}` | | `footerHTML:{get:()=>footerHTML,set(val){footerHTML=val+'<li>원격 저장: '+location.host+'</li>'}}` (setter appends: the save list renders the closure variable, not the getter) |
| legacy-button | `const idbtoggle=document.createElement("button");` | through `li.appendChild(idbtoggle),ul.appendChild(li),list.appendChild(ul),` (inclusive) | removed |

  (`\|\|` in the `active` row is markdown escaping for `||`.)

  Before replacing the `storage` span, assert it contains each of `function makePromise(`, `async function getItem(`, `async function setItem(`, `async function deleteItem(`, `async function loadState(`, `async function saveState(`, `async function getSaveDetails(`, `async function clearAll(` exactly once (names reported as `missing anchor: storage/<fn>`).

- [ ] **Step 1: Create the fixture**

```bash
python3 - <<'PY'
t=open("../Degrees of Lewdity_kr.html",encoding="utf-8").read()
e=t.find("window.idb=idb;"); s=t.rfind("const idb=(()=>{",0,e)
open("patch/test/fixtures/idb-module.js","w",encoding="utf-8").write(t[s:e])
PY
```
Expected: file is 26975 bytes.

- [ ] **Step 2: Write the failing patcher tests** in `patch/test/test_patch.py`. Fixture HTML = `"<html><script>" + module + "window.idb=idb;</script><p>x</p></html>"`.

```python
def test_patch_removes_indexeddb_and_installs_fragment(self)  # out has no 'indexedDB.open', no 'dbUpgrade', contains 'getAllSaves:{value:getAllSaves}', 'init:{value:init}', 'API_BASE', '원격 저장', and still contains 'function generateSaveRow(' and '<p>x</p>'
def test_patching_twice_fails(self)                          # patch_html(patch_html(html)) raises PatchError (anchors gone)
def test_missing_anchor_names_it(self)                       # html with 'init:{value:dbName=>openDB(dbName)}' altered → PatchError whose str contains 'init'
def test_ambiguous_module_fails(self)                        # two modules → PatchError 'module'
def test_storage_span_checks_function_names(self)            # remove 'async function clearAll(' from fixture → PatchError 'storage/clearAll'
def test_patched_module_is_valid_js(self)                    # write patched block (without surrounding html) to tmp .js; subprocess `node --check` returns 0 (skipTest if node not on PATH)
def test_cli_check_writes_nothing(self)                      # run patch.py on tmp html with --check --out-dir tmp → exit 0, out-dir empty
def test_cli_writes_output_and_keeps_input(self)             # exit 0, out file exists, input bytes unchanged
def test_real_kr_html_patches(self)                          # skipTest unless ../Degrees of Lewdity_kr.html exists; --check exits 0
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `python3 -m unittest discover -s patch/test -p 'test_*.py' -v`
Expected: FAIL/ERROR importing `patch`.

- [ ] **Step 4: Implement `patch/patch.py`**

Pure string `find`/`count`; read and write files as UTF-8 (`newline=''`). Write output to `<out>.tmp` then `os.replace`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `python3 -m unittest discover -s patch/test -p 'test_*.py' -v`
Expected: all PASS (node check and real-file tests run, not skipped, on this machine).

- [ ] **Step 6: Build the real patched file**

Run: `python3 patch/patch.py`
Expected: prints `ok` lines for every table row and `wrote .../dist/Degrees of Lewdity_kr.html`; `ls -la dist/` shows a ~58MB file; `shasum` of the original before and after is identical.

- [ ] **Step 7: Commit**

```bash
git add patch/patch.py patch/test/test_patch.py patch/test/fixtures/idb-module.js
git commit -m "feat(patch): HTML patcher that swaps the idb storage layer"
```

---

### Task 6: README and end-to-end check

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write `README.md`** (Korean) covering, in this order: what this is (one paragraph), requirements (Ubuntu + Docker, Tailscale on each device), setup steps 1–5 from the spec's "사용자가 할 일" with exact commands, how to set `SAVE_TOKEN` and `HOST_PORT` via a `server/.env` file, where saves live (`server/saves/`) and that this is the NAS backup target, how to move existing saves (in the old page: load a slot → 세이브 메뉴 → 내보내기; in the new page: 가져오기 → pick the file → 저장 to a slot; repeat per save), how to re-run `patch.py` after replacing the game HTML, and the known limits (last write wins, ironman stays local, no offline).

- [ ] **Step 2: End-to-end run on this machine**

From `server/`: `HOST_PORT=8090 docker compose up -d --build`. Then:
```bash
curl -s 'localhost:8090/Degrees%20of%20Lewdity_kr.html' | grep -c 'API_BASE'   # expect 1
curl -sI localhost:8090/ | grep -i location                                      # expect the kr html
```
Then open `http://localhost:8090/` in a browser (use the `claude-in-chrome` skill if available, otherwise ask the user): start a new game, advance one passage, open 세이브, save to slot 1, confirm `server/saves/slot-1.json` exists and `docker compose logs` shows `PUT /api/saves/1 200`. Open the same URL in a private window: 세이브 list shows slot 1; load it. Record what was verified in the final report. `docker compose down` afterwards; delete the test saves from `server/saves/`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: setup and migration guide"
```
