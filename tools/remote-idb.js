/*
 * Remote storage layer for DoL's `idb` module.
 *
 * This file is NOT a module. patch.py splices each section below into the
 * minified `const idb=(()=>{ ... })()` closure of the game HTML, replacing the
 * IndexedDB code. The code may therefore use closure variables that already
 * exist there (_lock, _active, _settings, _saveDetails, footerHTML, baddies,
 * log, funNuke, ekuNnuf) and the game's globals (V, State, Story, Save, clone).
 */

// === section: settings
function updateSettings(setting, value) {
	_settings = JSON.parse(localStorage.getItem("idb-settings")) || {
		warnSave: V.confirmSave || false,
		warnLoad: V.confirmLoad || false,
		warnDelete: V.confirmDelete || true,
		active: true,
		useDelta: true,
	};
	// Remote saves are the only storage: never let a device fall back to local saves.
	_settings.active = true;
	_active = true;
	if (!setting) return;
	if (!["warnSave", "warnLoad", "warnDelete", "active", "useDelta"].includes(setting)) {
		return console.warn(`idbupdatesettings: invalid argument: ${setting}`);
	}
	if (value == null) return _settings[setting];
	if (setting !== "active") _settings[setting] = value;
	localStorage.setItem("idb-settings", JSON.stringify(_settings));
}
updateSettings();

// === section: storage
// Lets game scripts tell a remote-save build apart (e.g. the footer hides the "export your save" nag).
window.DOL_REMOTE_SAVE = true;
const API_BASE = location.origin;
const TOKEN_KEY = "dol-remote-token";
// A request that hangs (dead Tailscale peer, flaky wifi) must fail instead of
// wedging the queue or leaving `_lock` set forever.
const TIMEOUT_MS = { health: 10000, request: 120000 };

function authHeaders() {
	const token = localStorage.getItem(TOKEN_KEY);
	return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Call the save server. Resolves with the parsed JSON body, or null on 404.
 * Rejects with an Error("<status> <body>") on any other non-2xx status.
 * On 401 asks for the token once, stores it, and retries once.
 */
async function apiFetch(path, { method = "GET", body, timeout = TIMEOUT_MS.request } = {}) {
	const send = async () => {
		const headers = authHeaders();
		const init = { method, headers, signal: AbortSignal.timeout(timeout) };
		if (body !== undefined) {
			headers["Content-Type"] = "application/json";
			init.body = JSON.stringify(body);
		}
		return fetch(API_BASE + path, init);
	};
	let res = await send();
	if (res.status === 401) {
		const answer = prompt("세이브 서버 비밀번호를 입력하세요");
		if (!answer) throw new Error("401 unauthorized");
		localStorage.setItem(TOKEN_KEY, answer);
		res = await send();
	}
	const text = await res.text();
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`${res.status} ${text}`);
	return text ? JSON.parse(text) : null;
}

// All save-server requests run one at a time, in call order, so an overlapping
// save is never dropped the way the IndexedDB `_lock` guard used to drop it.
let _queue = Promise.resolve();
function enqueue(fn) {
	const run = _queue.then(fn, fn);
	_queue = run.catch(() => {});
	return run;
}

async function init() {
	try {
		await apiFetch("/api/health", { timeout: TIMEOUT_MS.health });
	} catch (err) {
		log("세이브 서버에 연결할 수 없습니다", err);
	} finally {
		_lock = false;
	}
}

async function importFromLocalStorage() {
	return false;
}

async function getItem(slot) {
	return enqueue(async () => {
		try {
			return await apiFetch(`/api/saves/${slot}`);
		} catch (err) {
			log(`couldn't retrieve save in slot ${slot}`, err);
			return null;
		}
	});
}

async function setItem(slot, saveObj, details) {
	if (_lock) return;
	if (saveObj == null || !Object.hasOwn(saveObj, "history")) return false;
	const saveVars = saveObj.history[saveObj.index].variables;
	const metadata = Object.assign({ saveId: saveVars.saveId, saveName: saveVars.saveName }, details?.metadata);
	if (details) details.metadata = metadata;
	const detailsItem = details
		? { slot, data: details }
		: {
				slot,
				data: {
					id: Story.domId,
					idx: State.qc,
					title: Story.get(State.passage).description(),
					date: Date.now(),
					metadata,
				},
		  };
	try {
		let counter = 0;
		saveObj.history.forEach(s => {
			baddies.splice(0);
			funNuke(s.variables, "", !counter++);
			if (baddies.length) s.baddies = clone(baddies);
		});
		if (_settings.useDelta && slot !== 0) {
			saveObj.delta = State.deltaEncode(saveObj.history);
			delete saveObj.history;
		}
	} catch (ex) {
		log(`idb.setItem failure unknown. Couldn't complete the save in slot ${slot}`, ex);
		return false;
	}
	return enqueue(async () => {
		try {
			await apiFetch(`/api/saves/${slot}`, { method: "PUT", body: { save: saveObj, details: detailsItem.data } });
			return true;
		} catch (err) {
			log(`couldn't put save in slot ${slot}`, err);
			return false;
		}
	});
}

async function deleteItem(slot) {
	if (_lock) return;
	const result = await enqueue(async () => {
		try {
			await apiFetch(`/api/saves/${slot}`, { method: "DELETE" });
			return true;
		} catch (err) {
			log(`couldn't delete save in slot ${slot}`, err);
			return false;
		}
	});
	await getSaveDetails();
	return result;
}

async function loadState(slot) {
	if (_lock) return;
	const data = await getItem(slot);
	if (data == null) return false;
	const state = data.data;
	if (state.delta) {
		state.history = State.deltaDecode(state.delta);
		delete state.delta;
	}
	state.history.forEach(s => {
		if (s.baddies) {
			ekuNnuf(s.variables, s.baddies);
			delete s.baddies;
		}
	});
	let details = _saveDetails.find(d => d.slot === slot)?.data;
	if (!details) {
		await getSaveDetails();
		details = _saveDetails.find(d => d.slot === slot)?.data;
	}
	if (!details) return false;
	state.idx = details.idx;
	const fullSaveObj = Object.assign({ state }, details);
	Save.onLoad.handlers.forEach(fn => fn(fullSaveObj));
	State.unmarshalForSave(state);
	State.show();
}

async function saveState(slot, title, metadata) {
	if (_lock) return;
	if (!V.saveId) {
		const saveId = Math.floor(90000 * Math.random()) + 10000;
		V.saveId = saveId;
		State.history.forEach(s => (s.variables.saveId = saveId));
	}
	const saveObj = State.marshalForSave();
	const fullSaveObj = {
		state: saveObj,
		date: Date.now(),
		id: Story.domId,
		idx: State.qc,
		title: title || Story.get(State.passage).description(),
	};
	if (metadata != null) fullSaveObj.metadata = metadata;
	Save.onSave.handlers.forEach(fn => fn(fullSaveObj, { type: slot <= 0 ? "autosave" : "slot" }));
	const details = fullSaveObj;
	delete details.state;
	if (saveObj == null) return;
	await setItem(slot, saveObj, details);
	await getSaveDetails();
	return true;
}

async function getSaveDetails() {
	return enqueue(async () => {
		try {
			const details = (await apiFetch("/api/saves/details")) || [];
			_saveDetails = details;
			return details;
		} catch (err) {
			log("couldn't load the save list from the server", err);
			throw err;
		}
	});
}

async function getAllSaves() {
	return enqueue(async () => (await apiFetch("/api/saves")) || []);
}

async function clearAll() {
	if (_lock) return;
	return enqueue(async () => {
		try {
			await apiFetch("/api/saves", { method: "DELETE" });
			_saveDetails = [];
			return true;
		} catch (err) {
			log("couldn't clear saves on the server", err);
			return false;
		}
	});
}
