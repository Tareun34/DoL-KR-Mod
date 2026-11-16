const DoLSave = ((Story, Save) => {
	"use strict";

	const DEFAULT_DETAILS = Object.freeze({
		id: Story.domId,
		autosave: null,
		slots: [null, null, null, null, null, null, null, null],
	});
	const KEY_DETAILS = "dolSaveDetails";

	// Compressed saves are indicated by {jsoncompressed:1} in their metadata
	// The '1' can act as a compression algorithm id.

	// see game/00-framework-tools/03-compression/dictionaries.js
	const COMPRESSOR_DICTIONARIES = DoLCompressorDictionaries;
	// id of the dictionary to use for saving
	const COMPRESSOR_CURRENT_DICTIONARY_ID = "v3";
	/**
	 * When saving, decompress and compare with the original.
	 * If results differ, report an error and save the uncompressed version instead.
	 */
	function shouldVerifyCompression() {
		return true;
	}

	/* Place somewhere to expose globally. */
	function isObject(obj) {
		return typeof obj === "object" && obj != null;
	}

	/* Can also call from backcomp in the future? */
	function getSaveVersion(variables) {
		if (isObject(variables)) {
			if (!variables.saveVersions) {
				return -1;
			}
			return variables.saveVersions.last();
		}
		return -2;
	}

	function marshalVersion(version) {
		return typeof version === "string"
			? version
					.replace(/[^0-9.]+/g, "")
					.split(".")
					.map(v => parseInt(v))
			: [0, 0, 0, 0];
	}

	function parseVersion(version) {
		version = marshalVersion(version);
		return version ? version[0] * 1000000 + version[1] * 10000 + version[2] * 100 + version[3] * 1 : 0;
	}

	/**
	 * The handler which the load button should call.
	 * Contains checks to determine whether the save loads or pops up a confirmation window.
	 *
	 * @param {any} slot The slot ID to get the save from. 0 to 9, or 'auto'.
	 * @param {boolean} confirm Bypass the load confirmation.
	 * @returns {void}
	 */
	function loadHandler(slot, confirm) {
		if (V.ironmanmode === true && V.passage !== "Start") {
			Wikifier.wikifyEval(`<<loadIronmanSafetyCancel ${slot}>>`);
			return;
		}
		if (V.confirmLoad === true && confirm === undefined) {
			Wikifier.wikifyEval(`<<loadConfirm ${slot}>>`);
			return;
		}
		const save = slot === "auto" ? Save.autosave.get() : Save.slots.get(slot);
		// an empty slot gives back null, which is not the same as an empty save. JavaScript treats null as an object.
		// so checking the type alone would let an empty slot through and crash - isObject rules out null
		if (!isObject(save)) {
			Errors.report("해당 슬롯에서 유효한 세이브를 찾을 수 없습니다.", {});
			return;
		}
		const currVersion = parseVersion(StartConfig.version);
		/* Assume the save->variables is valid if an object. */
		const saveVersion = parseVersion(getSaveVersion(save.state.delta[0].variables));
		if (currVersion < saveVersion) {
			Wikifier.wikifyEval(`<<loadconfirmcompat ${slot}>>`);
			return;
		}
		load(slot, save);
	}

	/**
	 * Loads the given saveobj, or the save from the given slot.
	 *
	 * @param {number|string} slot The slot ID to get the save from. 0 to 9, or 'auto'.
	 * @param {object} saveObj The save object if already possessed by the callee.
	 * @param {boolean} overrides
	 * @returns {void}
	 */
	function load(slot, saveObj, overrides) {
		const save = saveObj == null ? (slot === "auto" ? Save.autosave.get() : Save.slots.get(slot)) : saveObj;
		// the details record can be missing (storage cleared) or lack this slot's row, so default to safe empties and don't crash
		const saveDetails = JSON.parse(localStorage.getItem(KEY_DETAILS)) ?? { autosave: null, slots: [] };
		const details = slot === "auto" ? saveDetails.autosave : saveDetails.slots[slot];
		const metadata = details?.metadata ?? {};
		/* Check if metadata for save matches the save's computed md5 hash. If it matches, the ironman save was not tampered with.
			Bypass this check if on a mobile, because they are notoriously difficult to grab saves from in the event of issues. */
		if (metadata.ironman && !Browser.isMobile.any()) {
			IronMan.update(save, metadata);
			// (if ironman mode enabled) following checks md5 signature of the save to see if the variables have been modified
			if (!IronMan.compare(metadata, save)) {
				Wikifier.wikifyEval(`<<loadIronmanCheater ${slot}>>`);
				return;
			}
		}
		const loaded = slot === "auto" ? Save.autosave.load() : Save.slots.load(slot);
		// if the load failed, stop here so ironman mode doesn't delete the player's other saves for nothing
		if (!loaded) return;
		if (V.ironmanmode) {
			// (ironman) remove all saves(except auto-save) with the same saveId than loaded save
			[0, 1, 2, 3, 4, 5, 6, 7].forEach(id => {
				const saveDetail = saveDetails.slots[id];
				if (saveDetail == null) return;
				if (saveDetail.metadata.saveId === metadata.saveId) {
					Save.slots.delete(id);
					deleteSaveDetails(id);
				}
			});
		}
	}

	function save(saveSlot, confirm, saveId, saveName) {
		if (saveId == null) {
			Wikifier.wikifyEval(`<<saveConfirm ${saveSlot}>>`);
		} else if ((V.confirmSave === true && confirm !== true) || (V.saveId !== saveId && saveId != null)) {
			Wikifier.wikifyEval(`<<saveConfirm ${saveSlot}>>`);
		} else {
			if (saveSlot != null) {
				const success = Save.slots.save(saveSlot, null, {
					saveId,
					saveName,
					ironman: V.ironmanmode,
				});
				if (success) {
					const save = Save.slots.get(saveSlot);
					// Copy save metadata (it includes the jsoncompressed indicator)
					const metadata = { ...save.metadata, saveId, saveName };
					if (V.ironmanmode) {
						Object.assign(metadata, {
							ironman: V.ironmanmode,
							signature: V.ironmanmode ? IronMan.getSignature(save) : false,
							schema: IronMan.schema,
						});
					}
					setSaveDetail(saveSlot, metadata);
					delete T.currentOverlay;
					// todo: find a better solution
					closeOverlay();
					if (V.ironmanmode === true) Engine.restart();
				}
			}
		}
	}

	function deleteSave(saveSlot, confirm) {
		if (saveSlot === "all") {
			if (confirm === undefined) {
				Wikifier.wikifyEval("<<clearSaveMenu>>");
				return;
			} else if (confirm === true) {
				Save.clear();
				deleteAllSaveDetails();
			}
		} else if (saveSlot === "auto") {
			if (V.confirmDelete === true && confirm === undefined) {
				Wikifier.wikifyEval(`<<deleteConfirm ${saveSlot}>>`);
				return;
			} else {
				Save.autosave.delete();
				deleteSaveDetails("autosave");
			}
		} else {
			if (V.confirmDelete === true && confirm === undefined) {
				Wikifier.wikifyEval(`<<deleteConfirm ${saveSlot}>>`);
				return;
			} else {
				Save.slots.delete(saveSlot);
				deleteSaveDetails(saveSlot);
			}
		}
		Wikifier.wikifyEval("<<resetSaveMenu>>");
	}

	function importSave(saveFile) {
		if (!window.FileReader) return; // Browser is not compatible

		const reader = new FileReader();

		reader.onloadend = function () {
			DeserializeGame(this.result);
		};

		reader.readAsText(saveFile[0]);
	}

	function prepareSaveDetails(forceRun) {
		const saveDetails = getSaveDetails();
		if (saveDetails == null || saveDetails.id !== Story.domId || forceRun) {
			const scSaveDetails = Save.get();
			// clone so we don't fill in the shared template and leave ghost saves
			const dolSaveDetails = clone(DEFAULT_DETAILS);
			/* Search SugarCube's autosave property, if it exists, reflect this in the save details. */
			if (scSaveDetails.autosave != null) {
				dolSaveDetails.autosave = {
					title: scSaveDetails.autosave.title,
					date: scSaveDetails.autosave.date,
					metadata: scSaveDetails.autosave.metadata,
				};
				if (dolSaveDetails.autosave.metadata === undefined) {
					dolSaveDetails.autosave.metadata = { saveName: "" };
				}
				if (dolSaveDetails.autosave.metadata.saveName === undefined) {
					dolSaveDetails.autosave.metadata.saveName = "";
				}
			}
			/* Check whether SugarCube's save slots exist and populate save details with them. */
			for (let i = 0; i < scSaveDetails.slots.length; i++) {
				if (scSaveDetails.slots[i] !== null) {
					dolSaveDetails.slots[i] = {
						title: scSaveDetails.slots[i].title,
						date: scSaveDetails.slots[i].date,
						metadata: scSaveDetails.slots[i].metadata,
					};
					if (dolSaveDetails.slots[i].metadata === undefined) {
						dolSaveDetails.slots[i].metadata = { saveName: "old save", saveId: 0 };
					}
					if (dolSaveDetails.slots[i].metadata.saveName === undefined) {
						dolSaveDetails.slots[i].metadata.saveName = "old save";
					}
				} else {
					dolSaveDetails.slots[i] = null;
				}
			}

			localStorage.setItem(KEY_DETAILS, JSON.stringify(dolSaveDetails));
			return true;
		}
		return false;
	}

	function setSaveDetail(saveSlot, metadata, story) {
		const saveDetails = JSON.parse(localStorage.getItem(KEY_DETAILS));
		if (saveSlot === "autosave") {
			saveDetails.autosave = {
				id: Story.domId,
				title: Story.get(V.passage).description(),
				date: Date.now(),
				metadata,
			};
		} else {
			const slot = parseInt(saveSlot);
			saveDetails.slots[slot] = {
				id: Story.domId,
				title: Story.get(V.passage).description(),
				date: Date.now(),
				metadata,
			};
		}
		localStorage.setItem(KEY_DETAILS, JSON.stringify(saveDetails));
	}

	function getSaveDetails(saveSlot) {
		if (Object.hasOwn(localStorage, KEY_DETAILS)) {
			const saveDetails = JSON.parse(localStorage.getItem(KEY_DETAILS));
			if (typeof saveSlot === "number") {
				if (saveDetails != null) {
					return saveDetails.slots[saveSlot];
				}
			} else {
				return saveDetails;
			}
		}
		return null;
	}

	function deleteSaveDetails(saveSlot) {
		const saveDetails = JSON.parse(localStorage.getItem(KEY_DETAILS));
		if (saveSlot === "autosave") {
			saveDetails.autosave = null;
		} else {
			const slot = parseInt(saveSlot);
			saveDetails.slots[slot] = null;
		}
		localStorage.setItem(KEY_DETAILS, JSON.stringify(saveDetails));
	}

	function deleteAllSaveDetails() {
		localStorage.setItem(KEY_DETAILS, JSON.stringify(DEFAULT_DETAILS));
	}

	function returnSaveData() {
		return Save.get();
	}

	function resetSaveMenu() {
		Wikifier.wikifyEval("<<resetSaveMenu>>");
	}

	function ironmanAutoSave() {
		const saveSlot = 8;
		const success = Save.slots.save(saveSlot, null, {
			saveId: V.saveId,
			saveName: V.saveName,
			ironman: V.ironmanmode,
		});
		if (success) {
			const save = Save.slots.get(saveSlot);
			const metadata = { saveId: V.saveId, saveName: V.saveName };
			if (V.ironmanmode) {
				Object.assign(metadata, {
					ironman: V.ironmanmode,
					signature: V.ironmanmode ? IronMan.getSignature(save) : false,
					schema: IronMan.schema,
				});
			}
			setSaveDetail(saveSlot, metadata);
		}
	}

	Macro.add("incrementautosave", {
		handler() {
			if (!V.ironmanmode) V.saveDetails.auto.count++;
		},
	});

	/**
	 * Compress a game state (not delta-encoded: {title, variables, prng, pull}) using most recent dictionary.
	 * Can throw an error.
	 *
	 * @param {object} state
	 */
	function compressState(state) {
		const dictionary = COMPRESSOR_DICTIONARIES[COMPRESSOR_CURRENT_DICTIONARY_ID];
		const compressor = new JsonCompressor(dictionary);
		const zstate = compressor.compress(state);
		zstate.dictionary = COMPRESSOR_CURRENT_DICTIONARY_ID;
		zstate.title =
				"이 세이브는 압축되어 있어 이전 버전의 Degrees of Lewdity와 호환되지 않습니다. 더 오래된 게임 빌드에서 이 세이브를 불러오려면 내보내기 기능을 사용하세요.";
		zstate.variables = {};
		if (shouldVerifyCompression()) {
			// Sanity check
			const uzstate = decompressState(zstate);
			if (JSON.stringify(state) !== JSON.stringify(uzstate)) {
					throw new Error("압축 해제 확인에 실패했습니다");
			}
		}
		return zstate;
	}

	/**
	 * Decompress the saved state using the dictionary it was compressed with.
	 * Can throw an error.
	 *
	 * @param {object} zstate
	 */
	function decompressState(zstate) {
		if (!("dictionary" in zstate)) throw new Error("불러올 수 없습니다 - 압축된 세이브에 사전 정보가 없습니다");
		const dicid = zstate.dictionary;
		if (!(dicid in COMPRESSOR_DICTIONARIES))
			throw new Error(
					"세이브 압축을 해제할 수 없습니다 - 사전 " +
					JSON.stringify(dicid) +
						"이 현재 게임 버전에서 알 수 없습니다. (구버전 게임에서 신버전 세이브를 불러오려는 건가요?)"
			);
		const dictionary = COMPRESSOR_DICTIONARIES[dicid];
		const decompressor = new JsonDecompressor(dictionary);
		return decompressor.decompress(zstate);
	}
	function enableCompression() {
		V.compressSave = true;
	}
	function disableCompression() {
		V.compressSave = false;
	}
	function isCompressionEnabled() {
		// for now, save compressor and delta-encoder work against each other, leading to bigger saves when both are active
		// todo: make them friends?
		return V.compressSave && State.history.length === 1;
	}

	/**
	 * Compress a SaveObject (the one with metadata and delta-encoded history), if the compression is enabled.
	 * If compression fails, report and error and do nothing.
	 * This function returns nothing, it modifies the saveObj parameter.
	 *
	 * @param {object} saveObj
	 */
	function compressIfNeeded(saveObj) {
		if (!saveObj.metadata) saveObj.metadata = {};
		saveObj.metadata.jsoncompressed = 0;
		if (!isCompressionEnabled()) return;
		try {
			saveObj.state.history = saveObj.state.history.map(state => compressState(state));
			saveObj.metadata.jsoncompressed = 1;
		} catch (e) {
			DOL.Errors.report("압축할 수 없습니다 - " + e);
			console.error(e);
			// Just return, the saveObj won't be modified
		}
	}
	function looksLikeCompressedSave(state) {
		return state.compressed === 1 && Array.isArray(state.values) && typeof state.values === "object" && typeof state.dictionary === "string";
	}
	/**
	 * Decompress a SaveObject (the one with metadata and delta-encoded history), if it is compressed.
	 *
	 * @param {object} saveObj
	 */
	function decompressIfNeeded(saveObj) {
		const isCompressed = (saveObj.metadata && saveObj.metadata.jsoncompressed === 1) || looksLikeCompressedSave(saveObj.state.history[0]);
		if (!isCompressed) return;
		let dictOverride = saveObj.state.history[0].dictionary;
		saveObj.state.history = saveObj.state.history.map(state => {
			state.dictionary = dictOverride;
			if (JsonDecompressor.isCompressed(state)) {
				// decompressing with the wrong dictionary can throw or produce nonsense, treat both as a failed attempt
				const tryDecompress = () => {
					try {
						const result = decompressState(state);
						return result.variables && result.variables.saveVersions ? result : null;
					} catch {
						return null;
					}
				};
				let decompressed = tryDecompress();
				// if that failed, the dictionary might be mislabeled, so try the others until one works
				const otherDicts = Object.keys(COMPRESSOR_DICTIONARIES).filter(d => d !== dictOverride);
				for (let k = 0; k < otherDicts.length && !decompressed; k++) {
					state.dictionary = otherDicts[k];
					decompressed = tryDecompress();
					if (decompressed) dictOverride = otherDicts[k];
				}
				if (!decompressed)
					throw new Error("게임의 어떤 사전으로도 저장 파일을 압축 해제할 수 없습니다 (저장 파일 이름은 " + JSON.stringify(dictOverride) + ") 입니다.)");
				return decompressed;
			} else return state;
		});
	}

	return Object.freeze({
		save,
		load,
		delete: deleteSave,
		import: importSave,
		getSaves: returnSaveData,
		resetMenu: resetSaveMenu,
		getVersion: getSaveVersion,
		loadHandler,
		enableCompression,
		disableCompression,
		isCompressionEnabled,
		compressState,
		decompressState,
		compressIfNeeded,
		decompressIfNeeded,
		SaveDetails: Object.freeze({
			prepare: prepareSaveDetails,
			set: setSaveDetail,
			get: getSaveDetails,
			delete: deleteSaveDetails,
			deleteAll: deleteAllSaveDetails,
		}),
		IronMan: Object.freeze({
			autoSave: ironmanAutoSave,
		}),
		Utils: Object.freeze({
			parseVer: parseVersion,
		}),
	});
})(Story, Save);
window.DoLSave = DoLSave;

/* Legacy references, references to the global namespace should be avoided, and thus this is considered deprecated usage. */
window.prepareSaveDetails = DoLSave.SaveDetails.prepare;
window.setSaveDetail = DoLSave.SaveDetails.set;
window.getSaveDetails = DoLSave.SaveDetails.get;
window.deleteSaveDetails = DoLSave.SaveDetails.delete;
window.deleteAllSaveDetails = DoLSave.SaveDetails.deleteAll;
window.returnSaveDetails = DoLSave.getSaves;
window.resetSaveMenu = DoLSave.resetMenu;
window.ironmanAutoSave = DoLSave.IronMan.autoSave;
window.loadSave = DoLSave.load;
window.save = DoLSave.save;
window.deleteSave = DoLSave.delete;
window.importSave = DoLSave.import;
window.SerializeGame = Save.serialize;
window.DeserializeGame = Save.deserialize;

window.getSaveData = function () {
	const compressionWasEnabled = DoLSave.isCompressionEnabled();
	DoLSave.disableCompression();
	const input = document.getElementById("saveDataInput");
	input.value = Save.serialize();
	if (compressionWasEnabled) DoLSave.enableCompression();
};

window.loadSaveData = function () {
	const input = document.getElementById("saveDataInput");
	const result = Save.deserialize(input.value);
	if (result === null) {
		input.value = "유효하지 않은 세이브입니다.";
	}
};

window.clearTextBox = function (id) {
	document.getElementById(id).value = "";
};

window.topTextArea = function (id) {
	const textArea = document.getElementById(id);
	textArea.scroll(0, 0);
};

window.bottomTextArea = function (id) {
	const textArea = document.getElementById(id);
	textArea.scroll(0, textArea.scrollHeight);
};

window.copySavedata = function (id) {
	const saveData = document.getElementById(id);
	saveData.focus();
	saveData.select();

	try {
		document.execCommand("copy");
	} catch (err) {
		const copyTextArea = document.getElementById("CopyTextArea");
		copyTextArea.value = "복사 오류";
		console.log("복사할 수 없습니다: ", err);
	}
};

window.importSettings = function (data, type) {
	let reader;
	switch (type) {
		case "text":
			V.importString = document.getElementById("settingsDataInput").value;
			Wikifier.wikifyEval('<<displaySettings "importConfirmDetails">>');
			break;
		case "file":
			reader = new FileReader();
			reader.addEventListener("load", event => {
				V.importString = event.target.result;
				Wikifier.wikifyEval('<<displaySettings "importConfirmDetails">>');
			});
			reader.readAsBinaryString(data[0]);
			break;
		case "function":
			importSettingsData(data);
			break;
	}
};

/**
 * Convert the retired binary dark skin percentage into skin tone scale settings.
 * 0% and 100% keep the exact tone the old light and dark NPCs were drawn with.
 * Anything in between becomes the most common tone across the full range.
 *
 * @param {number} darkChance the retired $settings.darkSkinChance, 0-100
 * @returns {{skinToneMin: number, skinToneMode: number, skinToneMax: number}}
 */
function skinToneSettingsFromDarkChance(darkChance) {
	const dark = Math.clamp(Math.round(darkChance), 0, 100);
	if (dark <= 0) return { skinToneMin: 0, skinToneMode: 0, skinToneMax: 0 };
	if (dark >= 100) return { skinToneMin: 70, skinToneMode: 70, skinToneMax: 70 };
	return { skinToneMin: 0, skinToneMode: dark, skinToneMax: 100 };
}
window.skinToneSettingsFromDarkChance = skinToneSettingsFromDarkChance;

function importSettingsData(data) {
	const imported = JSON.parse(data);
	delete V.importString;

	if (V.passage === "Start") applyStartingSettings(imported.starting);
	applyGeneralSettings(imported.general);
	applyNpcSettings(imported.npc);
}
window.importSettingsData = importSettingsData;

function applyGeneralSettings(general) {
	V.breastsizemin = general.breastsizemin ?? V.breastsizemin;
	V.breastsizemax = general.breastsizemax ?? V.breastsizemax;
	V.bottomsizemin = general.bottomsizemin ?? V.bottomsizemin;
	V.bottomsizemax = general.bottomsizemax ?? V.bottomsizemax;
	V.penissizemin = general.penissizemin ?? V.penissizemin;
	V.penissizemax = general.penissizemax ?? V.penissizemax;
	V.confirmSave = general.confirmSave ?? V.confirmSave;
	V.confirmLoad = general.confirmLoad ?? V.confirmLoad;
	V.confirmDelete = general.confirmDelete ?? V.confirmDelete;
	V.reducedLineHeight = general.reducedLineHeight ?? V.reducedLineHeight;
	V.outfitEditorPerPage = general.outfitEditorPerPage ?? V.outfitEditorPerPage;

	applyGameplaySettings(general.settings);
	applyBeastSettings(general.settings);
	applyOptions(general.options);
	applyShopDefaults(general.shopDefaults);
	applyWardrobeDefaults(general.wardrobeDefaults);
}

function applyBeastSettings(settings) {
	C.beastSettingTypes.forEach(type => {
		const incoming = settings.beastSettings[type];
		const target = V.settings.beastSettings[type];
		target.monsterChance = incoming.monsterChance ?? target.monsterChance;
		target.hallucinationsOnly = incoming.hallucinationsOnly ?? target.hallucinationsOnly;
		target.maleChance = incoming.maleChance ?? target.maleChance;
		target.maleChanceMale = incoming.maleChanceMale ?? target.maleChanceMale;
		target.maleChanceFemale = incoming.maleChanceFemale ?? target.maleChanceFemale;
		target.maleChanceSplit = incoming.maleChanceSplit ?? target.maleChanceSplit;
		target.bestiality = incoming.bestiality ?? target.bestiality;
		target.victimsAlwaysMonster = incoming.victimsAlwaysMonster ?? target.victimsAlwaysMonster;
	});

	C.namedBeasts.forEach(beast => {
		const incoming = settings.namedBeasts[beast];
		const target = V.settings.namedBeasts[beast];
		target.monsterChance = incoming.monsterChance ?? target.monsterChance;
		target.hallucinationsOnly = incoming.hallucinationsOnly ?? target.hallucinationsOnly;
	});
}

function applyNpcSettings(npc) {
	V.NPCNameList.forEach((name, i) => {
		const incoming = npc[name];
		const target = V.NPCName[i];

		// An NPC carrying a pregnancy keeps the gender it conceived with, regardless of the setting.
		const lockedGender = getActivePregnancies(target.nam).length ? target.gender : undefined;

		target.pronoun = incoming.pronoun ?? target.pronoun;
		target.gender = incoming.gender ?? target.gender;
		target.skincolour = incoming.skincolour ?? target.skincolour;
		target.skinType = incoming.skinType ?? target.skinType;
		target.penissize = incoming.penissize ?? target.penissize;
		target.breastsize = incoming.breastsize ?? target.breastsize;

		if (lockedGender) target.gender = lockedGender;
	});
}

function applyStartingSettings(starting) {
	const player = starting.player;

	V.bodysize = starting.bodysize ?? V.bodysize;
	V.facevariant = starting.facevariant ?? V.facevariant;
	V.breastsensitivity = starting.breastsensitivity ?? V.breastsensitivity;
	V.genitalsensitivity = starting.genitalsensitivity ?? V.genitalsensitivity;
	V.mouthsensitivity = starting.mouthsensitivity ?? V.mouthsensitivity;
	V.bottomsensitivity = starting.bottomsensitivity ?? V.bottomsensitivity;
	V.drunkSensitivity = starting.drunkSensitivity ?? V.drunkSensitivity;
	V.eyeselect = starting.eyeselect ?? V.eyeselect;
	V.hairselect = starting.hairselect ?? V.hairselect;
	V.hairlength = starting.hairlength ?? V.hairlength;
	V.awareselect = starting.awareselect ?? V.awareselect;
	V.background = starting.background ?? V.background;
	V.startingseason = starting.startingseason ?? V.startingseason;
	V.gamemode = starting.gamemode ?? V.gamemode;
	V.ironmanmode = starting.ironmanmode ?? V.ironmanmode;

	V.player.gender = player.gender ?? V.player.gender;
	V.player.sex = player.sex ?? V.player.sex;
	V.player.gender_body = player.gender_body ?? V.player.gender_body;
	V.player.bodyshape = player.bodyshape ?? V.player.bodyshape;
	V.player.skin.color = player.skinColour ?? V.player.skin.color;
	V.player.ballsExist = player.ballsExist ?? V.player.ballsExist;
	V.player.skin.faceFreckles = player.faceFreckles ?? V.player.skin.faceFreckles;
	V.player.skin.bodyFreckles = player.bodyFreckles ?? V.player.skin.bodyFreckles;
	V.player.breastsize = player.breastsize ?? V.player.breastsize;
	V.player.penissize = player.penissize ?? V.player.penissize;
	V.player.bottomsize = player.bottomsize ?? V.player.bottomsize;
}

function applyGameplaySettings(settings) {
	V.settings.analEnabled = settings.analEnabled ?? V.settings.analEnabled;
	V.settings.analingusGivingEnabled = settings.analingusGivingEnabled ?? V.settings.analingusGivingEnabled;
	V.settings.analingusReceivingEnabled = settings.analingusReceivingEnabled ?? V.settings.analingusReceivingEnabled;
	V.settings.transformAnimalEnabled = settings.transformAnimalEnabled ?? V.settings.transformAnimalEnabled;
	V.settings.asphyxiaLevel = settings.asphyxiaLevel ?? V.settings.asphyxiaLevel;
	V.settings.penisModifier = settings.penisModifier ?? V.settings.penisModifier;
	V.settings.breastModifier = settings.breastModifier ?? V.settings.breastModifier;
	V.settings.rentCostModifier = settings.rentCostModifier ?? V.settings.rentCostModifier;
	V.settings.baseNpcPregnancyChance = settings.baseNpcPregnancyChance ?? V.settings.baseNpcPregnancyChance;
	V.settings.basePlayerPregnancyChance = settings.basePlayerPregnancyChance ?? V.settings.basePlayerPregnancyChance;
	V.settings.beesEnabled = settings.beesEnabled ?? V.settings.beesEnabled;
	V.settings.blindStatsEnabled = settings.blindStatsEnabled ?? V.settings.blindStatsEnabled;
	V.settings.bodyWritingLevel = settings.bodyWritingLevel ?? V.settings.bodyWritingLevel;
	V.settings.breastFeedingEnabled = settings.breastFeedingEnabled ?? V.settings.breastFeedingEnabled;
	V.settings.cheatsEnabledToggle = settings.cheatsEnabledToggle ?? V.settings.cheatsEnabledToggle;
	V.settings.condomLevel = settings.condomLevel ?? V.settings.condomLevel;
	V.settings.clothingCostModifier = settings.clothingCostModifier ?? V.settings.clothingCostModifier;
	V.settings.furnitureCostModifier = settings.furnitureCostModifier ?? V.settings.furnitureCostModifier;
	V.settings.lewdClothingCostModifier = settings.lewdClothingCostModifier ?? V.settings.lewdClothingCostModifier;
	V.settings.schoolClothingCostModifier = settings.schoolClothingCostModifier ?? V.settings.schoolClothingCostModifier;
	V.settings.underwearCostModifier = settings.underwearCostModifier ?? V.settings.underwearCostModifier;
	V.settings.tendingYieldModifier = settings.tendingYieldModifier ?? V.settings.tendingYieldModifier;
	V.settings.toyDildoEnabled = settings.toyDildoEnabled ?? V.settings.toyDildoEnabled;
	V.settings.transformDivineEnabled = settings.transformDivineEnabled ?? V.settings.transformDivineEnabled;
	V.settings.analDoubleEnabled = settings.analDoubleEnabled ?? V.settings.analDoubleEnabled;
	V.settings.vaginalDoubleEnabled = settings.vaginalDoubleEnabled ?? V.settings.vaginalDoubleEnabled;
	V.settings.allureModifier = settings.allureModifier ?? V.settings.allureModifier;
	V.settings.facesitEnabled = settings.facesitEnabled ?? V.settings.facesitEnabled;
	V.settings.pregnancySpeechEnabled = settings.pregnancySpeechEnabled ?? V.settings.pregnancySpeechEnabled;
	V.settings.footFetishEnabled = settings.footFetishEnabled ?? V.settings.footFetishEnabled;
	V.settings.forcedCrossdressingEnabled = settings.forcedCrossdressingEnabled ?? V.settings.forcedCrossdressingEnabled;
	V.settings.granularBeastControl = settings.granularBeastControl ?? V.settings.granularBeastControl;
	V.settings.humanPregnancyMonths = settings.humanPregnancyMonths ?? V.settings.humanPregnancyMonths;
	V.settings.hypnosisEnabled = settings.hypnosisEnabled ?? V.settings.hypnosisEnabled;
	V.settings.npcVirginChanceAdult = settings.npcVirginChanceAdult ?? V.settings.npcVirginChanceAdult;
	V.settings.npcVirginChanceStudent = settings.npcVirginChanceStudent ?? V.settings.npcVirginChanceStudent;
	V.settings.skinToneMin = settings.skinToneMin ?? V.settings.skinToneMin;
	V.settings.skinToneMode = settings.skinToneMode ?? V.settings.skinToneMode;
	V.settings.skinToneMax = settings.skinToneMax ?? V.settings.skinToneMax;
	V.settings.lurkersEnabled = settings.lurkersEnabled ?? V.settings.lurkersEnabled;
	V.settings.fertilityCycleEnabled = settings.fertilityCycleEnabled ?? V.settings.fertilityCycleEnabled;
	V.settings.toyMultiplePenetrationEnabled = settings.toyMultiplePenetrationEnabled ?? V.settings.toyMultiplePenetrationEnabled;
	V.settings.multipleWardrobes = settings.multipleWardrobes ?? V.settings.multipleWardrobes;
	V.settings.maleChanceSplit = settings.maleChanceSplit ?? V.settings.maleChanceSplit;
	V.settings.npcPregnancyEnabled = settings.npcPregnancyEnabled ?? V.settings.npcPregnancyEnabled;
	V.settings.nnpcPregnancyEnabled = settings.nnpcPregnancyEnabled ?? V.settings.nnpcPregnancyEnabled;
	V.settings.analPregnancy = settings.analPregnancy ?? V.settings.analPregnancy;
	V.settings.npcAnalPregnancyEnabled = settings.npcAnalPregnancyEnabled ?? V.settings.npcAnalPregnancyEnabled;
	V.settings.maleChanceMale = settings.maleChanceMale ?? V.settings.maleChanceMale;
	V.settings.maleChanceFemale = settings.maleChanceFemale ?? V.settings.maleChanceFemale;
	V.settings.nudeGenderPerception = settings.nudeGenderPerception ?? V.settings.nudeGenderPerception;
	V.settings.parasitePregnancyEnabled = settings.parasitePregnancyEnabled ?? V.settings.parasitePregnancyEnabled;
	V.settings.parasitesEnabled = settings.parasitesEnabled ?? V.settings.parasitesEnabled;
	V.settings.maleNPCVaginaChance = settings.maleNPCVaginaChance ?? V.settings.maleNPCVaginaChance;
	V.settings.maleVictimChance = settings.maleVictimChance ?? V.settings.maleVictimChance;
	V.settings.maleChance = settings.maleChance ?? V.settings.maleChance;
	V.settings.femaleNPCPenisChance = settings.femaleNPCPenisChance ?? V.settings.femaleNPCPenisChance;
	if (setup.features?.herm) {
		// Herm 빌드에서만 가져온다. 그 외 빌드는 가져오기로도 양성 비율이 0에서 벗어나지 않게 한다.
		V.settings.femaleNPCHermChance = settings.femaleNPCHermChance ?? V.settings.femaleNPCHermChance;
		V.settings.maleNPCHermChance = settings.maleNPCHermChance ?? V.settings.maleNPCHermChance;
	}
	V.settings.straponChance = settings.straponChance ?? V.settings.straponChance;
	V.settings.plantsEnabled = settings.plantsEnabled ?? V.settings.plantsEnabled;
	V.settings.playerPregnancyEggLayingEnabled = settings.playerPregnancyEggLayingEnabled ?? V.settings.playerPregnancyEggLayingEnabled;
	V.settings.playerPregnancyBeastEnabled = settings.playerPregnancyBeastEnabled ?? V.settings.playerPregnancyBeastEnabled;
	V.settings.playerPregnancyHumanEnabled = settings.playerPregnancyHumanEnabled ?? V.settings.playerPregnancyHumanEnabled;
	V.settings.pregnancyType = settings.pregnancyType ?? V.settings.pregnancyType;
	V.settings.pubicHairEnabled = settings.pubicHairEnabled ?? V.settings.pubicHairEnabled;
	V.settings.ruinedOrgasmEnabled = settings.ruinedOrgasmEnabled ?? V.settings.ruinedOrgasmEnabled;
	V.settings.skillCheckStyle = settings.skillCheckStyle ?? V.settings.skillCheckStyle;
	V.settings.slimesEnabled = settings.slimesEnabled ?? V.settings.slimesEnabled;
	V.settings.slugsEnabled = settings.slugsEnabled ?? V.settings.slugsEnabled;
	V.settings.spidersEnabled = settings.spidersEnabled ?? V.settings.spidersEnabled;
	V.settings.swarmsEnabled = settings.swarmsEnabled ?? V.settings.swarmsEnabled;
	V.settings.tentaclesEnabled = settings.tentaclesEnabled ?? V.settings.tentaclesEnabled;
	V.settings.voreEnabled = settings.voreEnabled ?? V.settings.voreEnabled;
	V.settings.waspsEnabled = settings.waspsEnabled ?? V.settings.waspsEnabled;
	V.settings.watersportsEnabled = settings.watersportsEnabled ?? V.settings.watersportsEnabled;
	V.settings.toyWhipEnabled = settings.toyWhipEnabled ?? V.settings.toyWhipEnabled;
	V.settings.wolfPregnancyWeeks = settings.wolfPregnancyWeeks ?? V.settings.wolfPregnancyWeeks;
	V.settings.condomChance = settings.condomChance ?? V.settings.condomChance;
	V.settings.condomUseChanceRape = settings.condomUseChanceRape ?? V.settings.condomUseChanceRape;
	V.settings.condomUseChanceConsensual = settings.condomUseChanceConsensual ?? V.settings.condomUseChanceConsensual;
	V.settings.incompletePregnancyEnabled = settings.incompletePregnancyEnabled ?? V.settings.incompletePregnancyEnabled;
}

function applyOptions(options) {
	V.options.neverNudeMenus = options.neverNudeMenus ?? V.options.neverNudeMenus;
	V.options.showCaptionText = options.showCaptionText ?? V.options.showCaptionText;
	V.options.clothingCaption = options.clothingCaption ?? V.options.clothingCaption;
	V.options.clothingReplacementWarning = options.clothingReplacementWarning ?? V.options.clothingReplacementWarning;
	V.options.sidebarStats = options.sidebarStats ?? V.options.sidebarStats;
	V.options.sidebarTime = options.sidebarTime ?? V.options.sidebarTime;
	V.options.combatControls = options.combatControls ?? V.options.combatControls;
	V.options.mapMovement = options.mapMovement ?? V.options.mapMovement;
	V.options.mapTop = options.mapTop ?? V.options.mapTop;
	V.options.mapMarkers = options.mapMarkers ?? V.options.mapMarkers;
	V.options.images = options.images ?? V.options.images;
	V.options.combatImages = options.combatImages ?? V.options.combatImages;
	V.options.bodywritingImages = options.bodywritingImages ?? V.options.bodywritingImages;
	V.options.silhouetteEnabled = options.silhouetteEnabled ?? V.options.silhouetteEnabled;
	V.options.sidebarAnimations = options.sidebarAnimations ?? V.options.sidebarAnimations;
	V.options.blinkingEnabled = options.blinkingEnabled ?? V.options.blinkingEnabled;
	V.options.combatAnimations = options.combatAnimations ?? V.options.combatAnimations;
	V.options.halfClosedEnabled = options.halfClosedEnabled ?? V.options.halfClosedEnabled;
	V.options.characterLightEnabled = options.characterLightEnabled ?? V.options.characterLightEnabled;
	V.options.lightSpotlight = options.lightSpotlight ?? V.options.lightSpotlight;
	V.options.lightGradient = options.lightGradient ?? V.options.lightGradient;
	V.options.lightGlow = options.lightGlow ?? V.options.lightGlow;
	V.options.lightFlat = options.lightFlat ?? V.options.lightFlat;
	V.options.lightTFColor = options.lightTFColor ?? V.options.lightTFColor;
	V.options.combatLightEnabled = options.combatLightEnabled ?? V.options.combatLightEnabled;
	V.options.combatLightOffsetY = options.combatLightOffsetY ?? V.options.combatLightOffsetY;
	V.options.combatLightSpotlight = options.combatLightSpotlight ?? V.options.combatLightSpotlight;
	V.options.combatLightSpotlightX = options.combatLightSpotlightX ?? V.options.combatLightSpotlightX;
	V.options.combatLightSpotlightY = options.combatLightSpotlightY ?? V.options.combatLightSpotlightY;
	V.options.combatLightGradient = options.combatLightGradient ?? V.options.combatLightGradient;
	V.options.combatLightGlow = options.combatLightGlow ?? V.options.combatLightGlow;
	V.options.combatLightFlat = options.combatLightFlat ?? V.options.combatLightFlat;
	V.options.combatLightTFColor = options.combatLightTFColor ?? V.options.combatLightTFColor;
	V.options.maxStates = options.maxStates ?? V.options.maxStates;
	V.options.historyControls = options.historyControls ?? V.options.historyControls;
	V.options.useNarrowMarket = options.useNarrowMarket ?? V.options.useNarrowMarket;
	V.options.skipStatisticsConfirmation = options.skipStatisticsConfirmation ?? V.options.skipStatisticsConfirmation;
	V.options.passageCount = options.passageCount ?? V.options.passageCount;
	V.options.playtime = options.playtime ?? V.options.playtime;
	V.options.numberify_enabled = options.numberify_enabled ?? V.options.numberify_enabled;
	V.options.timestyle = options.timestyle ?? V.options.timestyle;
	V.options.tipdisable = options.tipdisable ?? V.options.tipdisable;
	V.options.pepperSprayDisplay = options.pepperSprayDisplay ?? V.options.pepperSprayDisplay;
	V.options.condomsDisplay = options.condomsDisplay ?? V.options.condomsDisplay;
	V.options.closeButtonMobile = options.closeButtonMobile ?? V.options.closeButtonMobile;
	V.options.showDebugRenderer = options.showDebugRenderer ?? V.options.showDebugRenderer;
	V.options.showCombatTools = options.showCombatTools ?? V.options.showCombatTools;
	V.options.numpad = options.numpad ?? V.options.numpad;
	V.options.traitOverlayFormat = options.traitOverlayFormat ?? V.options.traitOverlayFormat;
	V.options.font = options.font ?? V.options.font;
	V.options.passageLineHeight = options.passageLineHeight ?? V.options.passageLineHeight;
	V.options.overlayLineHeight = options.overlayLineHeight ?? V.options.overlayLineHeight;
	V.options.sidebarLineHeight = options.sidebarLineHeight ?? V.options.sidebarLineHeight;
	V.options.passageFontSize = options.passageFontSize ?? V.options.passageFontSize;
	V.options.overlayFontSize = options.overlayFontSize ?? V.options.overlayFontSize;
	V.options.sidebarFontSize = options.sidebarFontSize ?? V.options.sidebarFontSize;
	V.options.genderBody = options.genderBody ?? V.options.genderBody;
	V.options.notesAutoSave = options.notesAutoSave ?? V.options.notesAutoSave;
	V.options.dateFormat = options.dateFormat ?? V.options.dateFormat;
}

function applyShopDefaults(shopDefaults) {
	V.shopDefaults.alwaysBackToShopButton = shopDefaults.alwaysBackToShopButton ?? V.shopDefaults.alwaysBackToShopButton;
	V.shopDefaults.color = shopDefaults.color ?? V.shopDefaults.color;
	V.shopDefaults.colourItems = shopDefaults.colourItems ?? V.shopDefaults.colourItems;
	V.shopDefaults.compactMode = shopDefaults.compactMode ?? V.shopDefaults.compactMode;
	V.shopDefaults.disableReturn = shopDefaults.disableReturn ?? V.shopDefaults.disableReturn;
	V.shopDefaults.highContrast = shopDefaults.highContrast ?? V.shopDefaults.highContrast;
	V.shopDefaults.mannequinGender = shopDefaults.mannequinGender ?? V.shopDefaults.mannequinGender;
	V.shopDefaults.mannequinGenderFromClothes = shopDefaults.mannequinGenderFromClothes ?? V.shopDefaults.mannequinGenderFromClothes;
	V.shopDefaults.noHelp = shopDefaults.noHelp ?? V.shopDefaults.noHelp;
	V.shopDefaults.noTraits = shopDefaults.noTraits ?? V.shopDefaults.noTraits;
	V.shopDefaults.secColor = shopDefaults.secColor ?? V.shopDefaults.secColor;
}

function applyWardrobeDefaults(wardrobeDefaults) {
	V.wardrobeDefaults.showTraits = wardrobeDefaults.showTraits ?? V.wardrobeDefaults.showTraits;
	V.wardrobeDefaults.extraInfo = wardrobeDefaults.extraInfo ?? V.wardrobeDefaults.extraInfo;
}

/**
 * @param {"text" | "file"} type "text" to fill the textarea, "file" to download.
 */
function exportSettings(type) {
	const result = JSON.stringify(settingsToExportObject());
	if (type === "text") {
		document.getElementById("settingsDataInput").value = result;
	} else if (type === "file") {
		saveAs(new Blob([result], { type: "text/plain;charset=utf-8" }), "DolSettingsExport.txt");
	}
}
window.exportSettings = exportSettings;

function settingsToExportObject() {
	const data = {
		starting: {
			bodysize: V.bodysize,
			facevariant: V.facevariant,
			breastsensitivity: V.breastsensitivity,
			genitalsensitivity: V.genitalsensitivity,
			mouthsensitivity: V.mouthsensitivity,
			bottomsensitivity: V.bottomsensitivity,
			drunkSensitivity: V.drunkSensitivity,
			eyeselect: V.eyeselect,
			hairselect: V.hairselect,
			hairlength: V.hairlength,
			awareselect: V.awareselect,
			background: V.background,
			startingseason: V.startingseason,
			gamemode: V.gamemode,
			ironmanmode: V.ironmanmode,
			player: {
				gender: V.player.gender,
				sex: V.player.sex,
				gender_body: V.player.gender_body,
				bodyshape: V.player.bodyshape,
				skinColour: V.player.skin.color,
				ballsExist: V.player.ballsExist,
				faceFreckles: V.player.skin.faceFreckles,
				bodyFreckles: V.player.skin.bodyFreckles,
				breastsize: V.player.breastsize,
				penissize: V.player.penissize,
				bottomsize: V.player.bottomsize,
			},
		},
		general: {
			breastsizemin: V.breastsizemin,
			breastsizemax: V.breastsizemax,
			bottomsizemin: V.bottomsizemin,
			bottomsizemax: V.bottomsizemax,
			penissizemin: V.penissizemin,
			penissizemax: V.penissizemax,
			confirmSave: V.confirmSave,
			confirmLoad: V.confirmLoad,
			confirmDelete: V.confirmDelete,
			reducedLineHeight: V.reducedLineHeight,
			outfitEditorPerPage: V.outfitEditorPerPage,
			settings: {
				analEnabled: V.settings.analEnabled,
				analingusGivingEnabled: V.settings.analingusGivingEnabled,
				analingusReceivingEnabled: V.settings.analingusReceivingEnabled,
				transformAnimalEnabled: V.settings.transformAnimalEnabled,
				asphyxiaLevel: V.settings.asphyxiaLevel,
				penisModifier: V.settings.penisModifier,
				breastModifier: V.settings.breastModifier,
				rentCostModifier: V.settings.rentCostModifier,
				baseNpcPregnancyChance: V.settings.baseNpcPregnancyChance,
				basePlayerPregnancyChance: V.settings.basePlayerPregnancyChance,
				beesEnabled: V.settings.beesEnabled,
				blindStatsEnabled: V.settings.blindStatsEnabled,
				bodyWritingLevel: V.settings.bodyWritingLevel,
				breastFeedingEnabled: V.settings.breastFeedingEnabled,
				cheatsEnabledToggle: V.settings.cheatsEnabledToggle,
				condomLevel: V.settings.condomLevel,
				clothingCostModifier: V.settings.clothingCostModifier,
				furnitureCostModifier: V.settings.furnitureCostModifier,
				lewdClothingCostModifier: V.settings.lewdClothingCostModifier,
				schoolClothingCostModifier: V.settings.schoolClothingCostModifier,
				underwearCostModifier: V.settings.underwearCostModifier,
				tendingYieldModifier: V.settings.tendingYieldModifier,
				toyDildoEnabled: V.settings.toyDildoEnabled,
				transformDivineEnabled: V.settings.transformDivineEnabled,
				analDoubleEnabled: V.settings.analDoubleEnabled,
				vaginalDoubleEnabled: V.settings.vaginalDoubleEnabled,
				allureModifier: V.settings.allureModifier,
				facesitEnabled: V.settings.facesitEnabled,
				pregnancySpeechEnabled: V.settings.pregnancySpeechEnabled,
				footFetishEnabled: V.settings.footFetishEnabled,
				forcedCrossdressingEnabled: V.settings.forcedCrossdressingEnabled,
				granularBeastControl: V.settings.granularBeastControl,
				humanPregnancyMonths: V.settings.humanPregnancyMonths,
				hypnosisEnabled: V.settings.hypnosisEnabled,
				npcVirginChanceAdult: V.settings.npcVirginChanceAdult,
				npcVirginChanceStudent: V.settings.npcVirginChanceStudent,
				skinToneMin: V.settings.skinToneMin,
				skinToneMode: V.settings.skinToneMode,
				skinToneMax: V.settings.skinToneMax,
				lurkersEnabled: V.settings.lurkersEnabled,
				fertilityCycleEnabled: V.settings.fertilityCycleEnabled,
				toyMultiplePenetrationEnabled: V.settings.toyMultiplePenetrationEnabled,
				multipleWardrobes: V.settings.multipleWardrobes,
				maleChanceSplit: V.settings.maleChanceSplit,
				npcPregnancyEnabled: V.settings.npcPregnancyEnabled,
				nnpcPregnancyEnabled: V.settings.nnpcPregnancyEnabled,
				analPregnancy: V.settings.analPregnancy,
				npcAnalPregnancyEnabled: V.settings.npcAnalPregnancyEnabled,
				maleChanceMale: V.settings.maleChanceMale,
				maleChanceFemale: V.settings.maleChanceFemale,
				nudeGenderPerception: V.settings.nudeGenderPerception,
				parasitePregnancyEnabled: V.settings.parasitePregnancyEnabled,
				parasitesEnabled: V.settings.parasitesEnabled,
				maleNPCVaginaChance: V.settings.maleNPCVaginaChance,
				maleVictimChance: V.settings.maleVictimChance,
				maleChance: V.settings.maleChance,
				femaleNPCPenisChance: V.settings.femaleNPCPenisChance,
				...(setup.features?.herm
					? {
							femaleNPCHermChance: V.settings.femaleNPCHermChance,
							maleNPCHermChance: V.settings.maleNPCHermChance,
					  }
					: {}),
				straponChance: V.settings.straponChance,
				plantsEnabled: V.settings.plantsEnabled,
				playerPregnancyEggLayingEnabled: V.settings.playerPregnancyEggLayingEnabled,
				playerPregnancyBeastEnabled: V.settings.playerPregnancyBeastEnabled,
				playerPregnancyHumanEnabled: V.settings.playerPregnancyHumanEnabled,
				pregnancyType: V.settings.pregnancyType,
				pubicHairEnabled: V.settings.pubicHairEnabled,
				ruinedOrgasmEnabled: V.settings.ruinedOrgasmEnabled,
				skillCheckStyle: V.settings.skillCheckStyle,
				slimesEnabled: V.settings.slimesEnabled,
				slugsEnabled: V.settings.slugsEnabled,
				spidersEnabled: V.settings.spidersEnabled,
				swarmsEnabled: V.settings.swarmsEnabled,
				tentaclesEnabled: V.settings.tentaclesEnabled,
				voreEnabled: V.settings.voreEnabled,
				waspsEnabled: V.settings.waspsEnabled,
				watersportsEnabled: V.settings.watersportsEnabled,
				toyWhipEnabled: V.settings.toyWhipEnabled,
				wolfPregnancyWeeks: V.settings.wolfPregnancyWeeks,
				condomChance: V.settings.condomChance,
				condomUseChanceRape: V.settings.condomUseChanceRape,
				condomUseChanceConsensual: V.settings.condomUseChanceConsensual,
				incompletePregnancyEnabled: V.settings.incompletePregnancyEnabled,
				beastSettings: {},
				namedBeasts: {},
			},
			options: {
				neverNudeMenus: V.options.neverNudeMenus,
				showCaptionText: V.options.showCaptionText,
				clothingCaption: V.options.clothingCaption,
				clothingReplacementWarning: V.options.clothingReplacementWarning,
				sidebarStats: V.options.sidebarStats,
				sidebarTime: V.options.sidebarTime,
				combatControls: V.options.combatControls,
				mapMovement: V.options.mapMovement,
				mapTop: V.options.mapTop,
				mapMarkers: V.options.mapMarkers,
				images: V.options.images,
				combatImages: V.options.combatImages,
				bodywritingImages: V.options.bodywritingImages,
				silhouetteEnabled: V.options.silhouetteEnabled,
				sidebarAnimations: V.options.sidebarAnimations,
				blinkingEnabled: V.options.blinkingEnabled,
				combatAnimations: V.options.combatAnimations,
				halfClosedEnabled: V.options.halfClosedEnabled,
				characterLightEnabled: V.options.characterLightEnabled,
				lightSpotlight: V.options.lightSpotlight,
				lightGradient: V.options.lightGradient,
				lightGlow: V.options.lightGlow,
				lightFlat: V.options.lightFlat,
				lightTFColor: V.options.lightTFColor,
				combatLightEnabled: V.options.combatLightEnabled,
				combatLightOffsetY: V.options.combatLightOffsetY,
				combatLightSpotlight: V.options.combatLightSpotlight,
				combatLightSpotlightX: V.options.combatLightSpotlightX,
				combatLightSpotlightY: V.options.combatLightSpotlightY,
				combatLightGradient: V.options.combatLightGradient,
				combatLightGlow: V.options.combatLightGlow,
				combatLightFlat: V.options.combatLightFlat,
				combatLightTFColor: V.options.combatLightTFColor,
				maxStates: V.options.maxStates,
				historyControls: V.options.historyControls,
				useNarrowMarket: V.options.useNarrowMarket,
				skipStatisticsConfirmation: V.options.skipStatisticsConfirmation,
				passageCount: V.options.passageCount,
				playtime: V.options.playtime,
				numberify_enabled: V.options.numberify_enabled,
				timestyle: V.options.timestyle,
				tipdisable: V.options.tipdisable,
				pepperSprayDisplay: V.options.pepperSprayDisplay,
				condomsDisplay: V.options.condomsDisplay,
				closeButtonMobile: V.options.closeButtonMobile,
				showDebugRenderer: V.options.showDebugRenderer,
				showCombatTools: V.options.showCombatTools,
				numpad: V.options.numpad,
				traitOverlayFormat: V.options.traitOverlayFormat,
				font: V.options.font,
				passageLineHeight: V.options.passageLineHeight,
				overlayLineHeight: V.options.overlayLineHeight,
				sidebarLineHeight: V.options.sidebarLineHeight,
				passageFontSize: V.options.passageFontSize,
				overlayFontSize: V.options.overlayFontSize,
				sidebarFontSize: V.options.sidebarFontSize,
				genderBody: V.options.genderBody,
				notesAutoSave: V.options.notesAutoSave,
				dateFormat: V.options.dateFormat,
			},
			shopDefaults: {
				alwaysBackToShopButton: V.shopDefaults.alwaysBackToShopButton,
				color: V.shopDefaults.color,
				colourItems: V.shopDefaults.colourItems,
				compactMode: V.shopDefaults.compactMode,
				disableReturn: V.shopDefaults.disableReturn,
				highContrast: V.shopDefaults.highContrast,
				mannequinGender: V.shopDefaults.mannequinGender,
				mannequinGenderFromClothes: V.shopDefaults.mannequinGenderFromClothes,
				noHelp: V.shopDefaults.noHelp,
				noTraits: V.shopDefaults.noTraits,
				secColor: V.shopDefaults.secColor,
			},
			wardrobeDefaults: {
				showTraits: V.wardrobeDefaults.showTraits,
				extraInfo: V.wardrobeDefaults.extraInfo,
			},
		},
		npc: {},
	};

	C.beastSettingTypes.forEach(type => {
		data.general.settings.beastSettings[type] = {
			monsterChance: V.settings.beastSettings[type].monsterChance,
			hallucinationsOnly: V.settings.beastSettings[type].hallucinationsOnly,
			maleChance: V.settings.beastSettings[type].maleChance,
			maleChanceMale: V.settings.beastSettings[type].maleChanceMale,
			maleChanceFemale: V.settings.beastSettings[type].maleChanceFemale,
			maleChanceSplit: V.settings.beastSettings[type].maleChanceSplit,
			bestiality: V.settings.beastSettings[type].bestiality,
			victimsAlwaysMonster: V.settings.beastSettings[type].victimsAlwaysMonster,
		};
	});

	C.namedBeasts.forEach(beast => {
		data.general.settings.namedBeasts[beast] = {
			monsterChance: V.settings.namedBeasts[beast].monsterChance,
			hallucinationsOnly: V.settings.namedBeasts[beast].hallucinationsOnly,
		};
	});

	V.NPCNameList.forEach((name, i) => {
		data.npc[name] = {
			pronoun: V.NPCName[i].pronoun,
			gender: V.NPCName[i].gender,
			skincolour: V.NPCName[i].skincolour,
			skinType: V.NPCName[i].skinType,
			penissize: V.NPCName[i].penissize,
			breastsize: V.NPCName[i].breastsize,
		};
	});

	return data;
}

/**
 * @param {string} varName The setting's variable name.
 * @returns {string} The name to show.
 */
window.settingNameFromVarName = function (varName) {
	switch (varName) {
		case "dog":
			return "개";
		case "cat":
			return "고양이";
		case "pig":
			return "돼지";
		case "boar":
			return "멧돼지";
		case "wolf":
			return "늑대";
		case "bear":
			return "곰";
		case "dolphin":
			return "돌고래";
		case "lizard":
			return "도마뱀";
		case "cow":
			return "소";
		case "horse":
			return "말";
		case "fox":
			return "여우";
		case "hawk":
			return "매";
		case "spider":
			return "거미";
		case "snake":
			return "뱀";
		case "blackwolf":
			return "검은 늑대";
		case "greathawk":
			return "거대 매";
		case "nightmonster":
			return "밤의 괴물";
		case "bodysize":
			return "몸집";
		case "facevariant":
			return "인상";
		case "breastsensitivity":
			return "가슴 민감도";
		case "genitalsensitivity":
			return "성기 민감도";
		case "mouthsensitivity":
			return "입 민감도";
		case "bottomsensitivity":
			return "엉덩이 민감도";
		case "drunkSensitivity":
			return "주량";
		case "eyeselect":
			return "눈 색";
		case "hairselect":
			return "머리색";
		case "hairlength":
			return "머리 길이";
		case "awareselect":
			return "성지식";
		case "background":
			return "배경";
		case "startingseason":
			return "시작 계절";
		case "gamemode":
			return "게임 난이도";
		case "ironmanmode":
			return "아이언맨 모드";
		case "gender":
			return "성별";
		case "sex":
			return "성기";
		case "gender_body":
			return "신체 유형";
		case "bodyshape":
			return "체형";
		case "skinColour":
			return "자연 피부색";
		case "ballsExist":
			return "고환";
		case "faceFreckles":
			return "얼굴 주근깨";
		case "bodyFreckles":
			return "몸 주근깨";
		case "breastsize":
			return "가슴 크기";
		case "penissize":
			return "자지 크기";
		case "bottomsize":
			return "엉덩이 크기";
		case "breastsizemin":
			return "가슴 최소 크기";
		case "breastsizemax":
			return "가슴 최대 크기";
		case "bottomsizemin":
			return "엉덩이 최소 크기";
		case "bottomsizemax":
			return "엉덩이 최대 크기";
		case "penissizemin":
			return "자지 최소 크기";
		case "penissizemax":
			return "자지 최대 크기";
		case "confirmSave":
			return "세이브 확인 요구";
		case "confirmLoad":
			return "로드 확인 요구";
		case "confirmDelete":
			return "삭제 확인 요구";
		case "reducedLineHeight":
			return "줄 높이 축소";
		case "outfitEditorPerPage":
			return "페이지당 항목 수";
		case "analEnabled":
			return "애널";
		case "analingusGivingEnabled":
			return "애널링구스(시행)";
		case "analingusReceivingEnabled":
			return "애널링구스(받음)";
		case "transformAnimalEnabled":
			return "동물 변신";
		case "asphyxiaLevel":
			return "질식";
		case "penisModifier":
			return "NPC 자지 평균 크기";
		case "breastModifier":
			return "여성 가슴 평균 크기";
		case "rentCostModifier":
			return "베일리의 임대료";
		case "baseNpcPregnancyChance":
			return "NPC 기본 임신 확률";
		case "basePlayerPregnancyChance":
			return "플레이어 기본 임신 확률";
		case "beesEnabled":
			return "벌";
		case "blindStatsEnabled":
			return "블라인드 스탯 모드";
		case "bodyWritingLevel":
			return "몸 낙서";
		case "breastFeedingEnabled":
			return "모유수유";
		case "cheatsEnabledToggle":
			return "치트 모드";
		case "condomLevel":
			return "콘돔";
		case "clothingCostModifier":
			return "의류 가격";
		case "furnitureCostModifier":
			return "가구 가격";
		case "lewdClothingCostModifier":
			return "선정적인 의류 가격";
		case "schoolClothingCostModifier":
			return "교복 가격";
		case "underwearCostModifier":
			return "속옷 가격";
		case "tendingYieldModifier":
			return "작물 수확량";
		case "toyDildoEnabled":
			return "딜도";
		case "transformDivineEnabled":
			return "신성 변신";
		case "analDoubleEnabled":
			return "이중 애널";
		case "vaginalDoubleEnabled":
			return "이중 질 삽입";
		case "allureModifier":
			return "조우율";
		case "facesitEnabled":
			return "페이스시팅";
		case "pregnancySpeechEnabled":
			return "가임/임신 관련 언급";
		case "footFetishEnabled":
			return "발 페티시";
		case "forcedCrossdressingEnabled":
			return "강제 크로스드레싱";
		case "granularBeastControl":
			return "짐승 종류별 세부 설정";
		case "humanPregnancyMonths":
			return "인간 임신 기간";
		case "hypnosisEnabled":
			return "최면";
		case "npcVirginChanceAdult":
			return "성인 NPC가 동정/처녀일 확률";
		case "npcVirginChanceStudent":
			return "젊은 성인 NPC가 동정/처녀일 확률";
		case "skinToneMin":
			return "가장 밝은 NPC 피부색";
		case "skinToneMode":
			return "가장 흔한 NPC 피부색";
		case "skinToneMax":
			return "가장 어두운 NPC 피부색";
		case "lurkersEnabled":
			return "럴커";
		case "fertilityCycleEnabled":
			return "월경 주기";
		case "toyMultiplePenetrationEnabled":
			return "섹스 토이 다중 삽입";
		case "multipleWardrobes":
			return "여러 옷장";
		case "maleChanceSplit":
			return "NPC의 성별 외형별 끌림 분리";
		case "npcPregnancyEnabled":
			return "일반 NPC 임신";
		case "nnpcPregnancyEnabled":
			return "주요 NPC/연인 임신";
		case "analPregnancy":
			return "플레이어 항문 임신";
		case "npcAnalPregnancyEnabled":
			return "NPC 항문 임신";
		case "maleChanceMale":
			return "남성에게 끌리는 NPC";
		case "maleChanceFemale":
			return "여성에게 끌리는 NPC";
		case "nudeGenderPerception":
			return "나체 성별 인식";
		case "parasitePregnancyEnabled":
			return "기생충 임신";
		case "parasitesEnabled":
			return "기생충";
		case "maleNPCVaginaChance":
			return "보지를 가진 남성 비율";
		case "maleVictimChance":
			return "다른 피해자 중 남성 비율";
		case "maleChance":
			return "당신에게 끌리는 사람 중 남성 비율";
		case "femaleNPCPenisChance":
			return "자지를 가진 여성 비율";
		case "femaleNPCHermChance":
			return setup.features?.herm ? "자지와 보지를 모두 가진 여성 비율" : varName;
		case "maleNPCHermChance":
			return setup.features?.herm ? "자지와 보지를 모두 가진 남성 비율" : varName;
		case "straponChance":
			return "페니스 밴드를 가진 여성 비율";
		case "plantsEnabled":
			return "식물 수인";
		case "playerPregnancyEggLayingEnabled":
			return "플레이어 산란";
		case "playerPregnancyBeastEnabled":
			return "플레이어의 짐승 임신";
		case "playerPregnancyHumanEnabled":
			return "플레이어의 인간 임신";
		case "pregnancyType":
			return "임신 모드";
		case "pubicHairEnabled":
			return "음모";
		case "ruinedOrgasmEnabled":
			return "망친 절정";
		case "skillCheckStyle":
			return "스킬 체크 표시";
		case "slimesEnabled":
			return "슬라임";
		case "slugsEnabled":
			return "민달팽이";
		case "spidersEnabled":
			return "거미";
		case "swarmsEnabled":
			return "무리";
		case "tentaclesEnabled":
			return "촉수";
		case "voreEnabled":
			return "보어";
		case "waspsEnabled":
			return "말벌";
		case "watersportsEnabled":
			return "워터스포츠";
		case "toyWhipEnabled":
			return "채찍";
		case "wolfPregnancyWeeks":
			return "늑대 임신 기간";
		case "neverNudeMenus":
			return "메뉴에서 플레이어 노출 숨기기";
		case "showCaptionText":
			return "사이드바 캡션 텍스트 표시";
		case "clothingCaption":
			return "사이드바 의류 설명 표시";
		case "clothingReplacementWarning":
			return "의류 교체 경고 활성화";
		case "sidebarStats":
			return "닫힌 사이드바 스탯";
		case "sidebarTime":
			return "닫힌 사이드바 시간";
		case "combatControls":
			return "전투 조작";
		case "mapMovement":
			return "지도 클릭 이동 활성화";
		case "mapTop":
			return "지도를 지도 링크 위로 이동";
		case "mapMarkers":
			return "지도에서 클릭 가능 영역 표시";
		case "images":
			return "이미지";
		case "combatImages":
			return "전투 이미지";
		case "bodywritingImages":
			return "몸 낙서 이미지";
		case "silhouetteEnabled":
			return "NPC 실루엣";
		case "sidebarAnimations":
			return "사이드바 이미지";
		case "blinkingEnabled":
			return "눈 깜빡임 애니메이션";
		case "combatAnimations":
			return "전투 애니메이션";
		case "halfClosedEnabled":
			return "반쯤 감은 눈";
		case "characterLightEnabled":
			return "캐릭터 조명";
		case "lightSpotlight":
			return "스포트라이트";
		case "lightGradient":
			return "그라데이션";
		case "lightGlow":
			return "광채";
		case "lightFlat":
			return "평면광";
		case "lightTFColor":
			return "천사/악마 변신 색상 요소";
		case "combatLightEnabled":
			return "캐릭터 조명";
		case "combatLightOffsetY":
			return "Y 오프셋";
		case "combatLightSpotlight":
			return "스포트라이트";
		case "combatLightSpotlightX":
			return "스포트라이트 너비";
		case "combatLightSpotlightY":
			return "스포트라이트 높이";
		case "combatLightGradient":
			return "그라데이션";
		case "combatLightGlow":
			return "광채";
		case "combatLightFlat":
			return "평면광";
		case "combatLightTFColor":
			return "천사/악마 변신 색상 요소";
		case "maxStates":
			return "히스토리 깊이";
		case "historyControls":
			return "히스토리 조작 표시";
		case "useNarrowMarket":
			return "시장 인벤토리에 좁은 화면 버전 사용";
		case "skipStatisticsConfirmation":
			return "추가 스탯 보기 확인 건너뛰기";
		case "passageCount":
			return "패시지 수 표시";
		case "playtime":
			return "플레이 시간 표시";
		case "numberify_enabled":
			return "번호 링크 이동 활성화";
		case "timestyle":
			return "시간 표시 방식";
		case "tipdisable":
			return "사이드바 팁";
		case "pepperSprayDisplay":
			return "호신 스프레이 표시";
		case "condomsDisplay":
			return "콘돔 표시";
		case "closeButtonMobile":
			return "페이지당 항목 수";
		case "showDebugRenderer":
			return "렌더러 디버거 활성화";
		case "showCombatTools":
			return "전투 도구 활성화";
		case "numpad":
			return "숫자패드 활성화";
		case "traitOverlayFormat":
			return "특성 표시";
		case "font":
			return "글꼴";
		case "passageLineHeight":
			return "패시지 줄 높이";
		case "overlayLineHeight":
			return "오버레이 줄 높이";
		case "sidebarLineHeight":
			return "사이드바 줄 높이";
		case "passageFontSize":
			return "패시지 글자 크기";
		case "overlayFontSize":
			return "오버레이 글자 크기";
		case "sidebarFontSize":
			return "사이드바 글자 크기";
		case "genderBody":
			return "표시할 신체 유형";
		case "notesAutoSave":
			return "메모 자동 저장";
		case "dateFormat":
			return "날짜 형식";
		case "alwaysBackToShopButton":
			return "상점으로 돌아가기 버튼 항상 표시";
		case "color":
			return "기본 의상 색";
		case "colourItems":
			return "카탈로그 아이템 색상";
		case "compactMode":
			return "컴팩트 모드";
		case "disableReturn":
			return "돌아가기 버튼 숨기기";
		case "highContrast":
			return "고대비";
		case "mannequinGender":
			return "마네킹 성별";
		case "mannequinGenderFromClothes":
			return "옷에 따른 마네킹 성별";
		case "noHelp":
			return "도움말 숨기기";
		case "noTraits":
			return "특성 숨기기";
		case "secColor":
			return "기본 보조 의상 색";
		case "showTraits":
			return "특성 표시";
		case "extraInfo":
			return "추가 정보 표시";
		case "monsterChance":
			return "수인 출현 확률";
		case "hallucinationsOnly":
			return "환각 상태에서만 수인 출현";
		case "victimsAlwaysMonster":
			return "피해자인 짐승은 항상 수인";
		case "bestiality":
			return "수간";
		case "pronoun":
			return "대명사";
		case "skincolour":
			return "피부색";
		case "skinType":
			return "피부 유형";
		default:
			return varName;
	}
};

/**
 * @param {string} varName The setting's variable name.
 * @param {any} value The value from the settings string.
 * @returns {any} The value to show.
 */
function settingValueNameFromValue(varName, value) {
	switch (varName) {
		case "bodysize":
			switch (value) {
				case 0:
					return "조그마함";
				case 1:
					return "작음";
				case 2:
					return "보통";
				case 3:
					return "큼";
			}
			break;
		case "facevariant":
			switch (value) {
				case "default":
					return "상냥한";
				case "catty":
					return "새침한";
				case "aloof":
					return "냉담한";
				case "sweet":
					return "다정한";
				case "foxy":
					return "여우같은";
				case "gloomy":
					return "우울한";
			}
			break;
		case "breastsensitivity":
			switch (value) {
				case 1:
					return "보통";
				case 2:
					return "반응함";
				case 3:
					return "예민함";
			}
			break;
		case "genitalsensitivity":
			switch (value) {
				case 1:
					return "보통";
				case 2:
					return "반응함";
				case 3:
					return "예민함";
			}
			break;
		case "mouthsensitivity":
			switch (value) {
				case 1:
					return "보통";
				case 2:
					return "반응함";
				case 3:
					return "예민함";
			}
			break;
		case "bottomsensitivity":
			switch (value) {
				case 1:
					return "보통";
				case 2:
					return "반응함";
				case 3:
					return "예민함";
			}
			break;
		case "drunkSensitivity":
			switch (value) {
				case 1:
					return "보통";
				case 0.5:
					return "주당";
				case 1.5:
					return "약한 편";
			}
			break;
		case "eyeselect":
			switch (value) {
				case "purple":
					return "보라색";
				case "dark blue":
					return "짙은 파란색";
				case "light blue":
					return "밝은 파란색";
				case "amber":
					return "호박색";
				case "hazel":
					return "헤이즐색";
				case "brown":
					return "갈색";
				case "green":
					return "초록색";
				case "lime green":
					return "라임색";
				case "red":
					return "빨간색";
				case "pink":
					return "분홍색";
				case "black":
					return "검은색";
				case "grey":
					return "회색";
				case "light grey":
					return "연회색";
				case "random":
					return "무작위";
			}
			break;
		case "hairselect":
			switch (value) {
				case "red":
					return "빨간색";
				case "jetblack":
					return "칠흑색";
				case "black":
					return "검은색";
				case "darkbrown":
					return "어두운 갈색";
				case "brown":
					return "갈색";
				case "copperbrown":
					return "구리빛 갈색";
				case "softbrown":
					return "부드러운 갈색";
				case "lightbrown":
					return "밝은 갈색";
				case "burntorange":
					return "진한 주황색";
				case "blond":
					return "금발";
				case "softblond":
					return "부드러운 금발";
				case "platinumblond":
					return "플래티넘 블론드";
				case "ashyblond":
					return "잿빛 금발";
				case "strawberryblond":
					return "스트로베리 블론드";
				case "ginger":
					return "적갈색";
				case "white":
					return "흰색";
				case "snowwhite":
					return "순백색";
				case "random":
					return "무작위";
			}
			break;
		case "awareselect":
			switch (value) {
				case "innocent":
					return "순진함";
				case "knowledgeable":
					return "알고 있음";
			}
			break;
		case "background":
			switch (value) {
				case "waif":
					return "부랑아";
				case "nerd":
					return "범생이";
				case "athlete":
					return "운동선수";
				case "delinquent":
					return "불량배";
				case "promiscuous":
					return "난잡함";
				case "exhibitionist":
					return "노출증";
				case "deviant":
					return "일탈자";
				case "beautiful":
					return "미모";
				case "crossdresser":
					return "크로스드레서";
				case "lustful":
					return "호색한";
				case "plantlover":
					return "나무성애자";
			}
			break;
		case "startingseason":
			switch (value) {
				case "spring":
					return "봄";
				case "summer":
					return "여름";
				case "autumn":
					return "가을";
				case "winter":
					return "겨울";
				case "random":
					return "무작위";
			}
			break;
		case "gamemode":
			switch (value) {
				case "normal":
					return "노말";
				case "soft":
					return "이지";
				case "hard":
					return "하드";
			}
			break;
		case "gender":
			switch (value) {
				case "m":
					return "남성";
				case "f":
					return "여성";
				case "n":
					return "어느 쪽도 아님";
			}
			break;
		case "sex":
			switch (value) {
				case "m":
					return "자지";
				case "f":
					return "보지";
				case "h":
					return "양성";
			}
			break;
		case "gender_body":
			switch (value) {
				case "m":
					return "남성적";
				case "f":
					return "여성적";
				case "a":
					return "중성적";
			}
			break;
		case "bodyshape":
			switch (value) {
				case "classic":
					return "평범한";
				case "slender":
					return "슬림한";
				case "curvy":
					return "잘록한";
				case "soft":
					return "푹신한";
			}
			break;
		case "skinColour":
			switch (value) {
				case "light":
					return "뉴트럴 밝은";
				case "medium":
					return "뉴트럴 중간";
				case "dark":
					return "뉴트럴 어두운";
				case "gyaru":
					return "뉴트럴 갸루";
				case "rlight":
					return "웜 밝은";
				case "rmedium":
					return "웜 중간";
				case "rdark":
					return "웜 어두운";
				case "rgyaru":
					return "웜 갸루";
				case "glight":
					return "골든 밝은";
				case "gmedium":
					return "골든 중간";
				case "gdark":
					return "골든 어두운";
				case "ggyaru":
					return "골든 갸루";
				case "ylight":
					return "올리브 밝은";
				case "ymedium":
					return "올리브 중간";
				case "ydark":
					return "올리브 어두운";
				case "ygyaru":
					return "올리브 갸루";
				case "blight":
					return "쿨 밝은";
				case "bmedium":
					return "쿨 중간";
				case "bdark":
					return "쿨 어두운";
				case "bgyaru":
					return "쿨 갸루";
			}
			break;
		case "ballsExist":
			switch (value) {
				case true:
					return "있음";
				case false:
					return "없음";
			}
			break;
		case "faceFreckles":
			switch (value) {
				case true:
					return "있음";
				case false:
					return "없음";
				case "random":
					return "무작위";
			}
			break;
		case "bodyFreckles":
			switch (value) {
				case "none":
					return "없음";
				case "upper":
					return "상반신";
				case "full":
					return "전신";
				case "random":
					return "무작위";
			}
			break;
		case "breastsize":
			switch (value) {
				case 0:
					return "납작한";
				case 1:
					return "아주 작은";
				case 2:
					return "작은";
				case 3:
					return "봉긋한";
				case 4:
					return "볼륨있는";
			}
			break;
		case "penissize":
			switch (value) {
				case 0:
					return "매우 작음";
				case 1:
					return "작음";
				case 2:
					return "보통";
			}
			break;
		case "bottomsize":
			switch (value) {
				case 0:
					return "납작한";
				case 1:
					return "아담한";
				case 2:
					return "둥근";
				case 3:
					return "부드러운";
			}
			break;
		case "breastsizemin":
			switch (value) {
				case 0:
					return "납작한";
				case 1:
					return "아주 작은";
				case 2:
					return "작은";
				case 3:
					return "봉긋한";
				case 4:
					return "볼륨있는";
			}
			break;
		case "breastsizemax":
			switch (value) {
				case 0:
					return "납작한";
				case 1:
					return "아주 작은";
				case 2:
					return "작은";
				case 3:
					return "봉긋한";
				case 4:
					return "볼륨있는";
				case 5:
					return "글래머한";
				case 6:
					return "꽉 찬";
				case 7:
					return "풍만한";
				case 8:
					return "큰";
				case 9:
					return "커다란";
				case 10:
					return "거대한";
				case 11:
					return "엄청난";
				case 12:
					return "어마어마한";
			}
			break;
		case "bottomsizemin":
			switch (value) {
				case 0:
					return "납작한";
				case 1:
					return "아담한";
				case 2:
					return "둥근";
				case 3:
					return "부드러운";
			}
			break;
		case "bottomsizemax":
			switch (value) {
				case 0:
					return "납작한";
				case 1:
					return "아담한";
				case 2:
					return "둥근";
				case 3:
					return "부드러운";
				case 4:
					return "통통한";
				case 5:
					return "꽉 찬";
				case 6:
					return "풍만한";
				case 7:
					return "큰";
				case 8:
					return "거대한";
			}
			break;
		case "penissizemin":
			switch (value) {
				case 0:
					return "매우 작은";
				case 1:
					return "약간 작은";
				case 2:
					return "작은";
			}
			break;
		case "penissizemax":
			switch (value) {
				case 0:
					return "매우 작은";
				case 1:
					return "약간 작은";
				case 2:
					return "작은";
				case 3:
					return "보통";
				case 4:
					return "큰";
				case 5:
					return "매우 큰";
				case 6:
					return "거대한";
			}
			break;
		case "asphyxiaLevel":
			switch (value) {
				case 0:
					return "NPC가 당신의 목을 건드리지 않습니다";
				case 1:
					return "NPC가 호흡을 방해하지 않는 선에서 당신의 목을 잡을 수 있습니다";
				case 2:
					return "합의된 조우 중 NPC가 당신의 목을 조르려 할 수 있습니다";
				case 3:
					return "비동의 조우 중 NPC가 당신의 목을 조르려 할 수 있습니다";
			}
			break;
		case "bodyWritingLevel":
			switch (value) {
				case 0:
					return "NPC가 당신 몸에 낙서하지 않습니다";
				case 1:
					return "NPC가 당신 몸에 낙서해도 되는지 물을 수 있습니다";
				case 2:
					return "NPC가 억지로 당신 몸에 낙서할 수 있습니다";
				case 3:
					return "NPC가 억지로 당신 몸에 낙서하고 문신을 새길 수 있습니다";
			}
			break;
		case "condomLevel":
			switch (value) {
				case 0:
					return "모두가 라텍스와 안전한 성관계에 알레르기가 있습니다";
				case 1:
					return "당신만 콘돔을 사용할 수 있지만, NPC에게 콘돔을 줄 수 있습니다";
				case 2:
					return "NPC는 플레이어와 임신이 가능한 경우에만 콘돔을 소지합니다";
				case 3:
					return "NPC는 원할 때 언제든 콘돔을 소지하고 사용할 수 있습니다";
			}
			break;
		case "multipleWardrobes":
			switch (value) {
				case false:
					return "공용 옷장 하나만 사용";
				case "isolated":
					return "장소마다 따로 사용";
			}
			break;
		case "analPregnancy":
			switch (value) {
				case false:
					return "비활성화";
				case "exceptional":
					return "특수한 상황에서만";
				case "always":
					return "항상";
			}
			break;
		case "nudeGenderPerception":
			switch (value) {
				case 0:
					return "NPC가 성별을 인식할 때 성기를 무시합니다";
				case 1:
					return "NPC가 당신의 성별을 인식할 때 성기를 고려합니다";
				case 2:
					return "NPC가 성기를 기준으로 당신의 성별을 판단합니다";
				case -1:
					return "NPC가 성별을 인식할 때 성기를 무시하며, 크로스드레싱 경고가 표시되지 않습니다";
			}
			break;
		case "pregnancyType":
			switch (value) {
				case "realistic":
					return "현실적";
				case "fetish":
					return "페티시";
			}
			break;
		case "skillCheckStyle":
			switch (value) {
				case "percentage":
					return "정확한 성공 확률(%) 표시";
				case "words":
					return "대략적인 성공 확률 표시";
				case "skillname":
					return "요구되는 스킬 이름만 표시";
			}
			break;
		case "sidebarStats":
			switch (value) {
				case "disabled":
					return "비활성화";
				case "limited":
					return "제한됨";
				case "all":
					return "모두 표시";
			}
			break;
		case "sidebarTime":
			switch (value) {
				case "disabled":
					return "비활성화";
				case "top":
					return "위";
				case "bottom":
					return "아래";
			}
			break;
		case "combatControls":
			switch (value) {
				case "radio":
					return "라디오 버튼";
				case "columnRadio":
					return "라디오 버튼 (세로열)";
				case "lists":
					return "리스트 (너비 제한 없음)";
				case "limitedLists":
					return "리스트 (너비 제한 있음)";
			}
			break;
		case "passageCount":
			switch (value) {
				case "disabled":
					return "비활성화";
				case "changes":
					return "패시지 이동 횟수";
				case "total":
					return "총 패시지 수";
			}
			break;
		case "numberify_enabled":
		case "images":
		case "combatImages":
		case "lightFlat":
		case "combatLightGradient":
		case "combatLightFlat":
			switch (value) {
				case 0:
					return "비활성화";
				case 1:
					return "활성화";
			}
			break;
		case "timestyle":
			switch (value) {
				case "military":
					return "24시간제";
				case "ampm":
					return "12시간제";
			}
			break;
		case "tipdisable":
			return value ? "비활성화" : "활성화";
		case "pepperSprayDisplay":
			switch (value) {
				case "none":
					return "숨김";
				case "sprays":
					return "표준";
				case "compact":
					return "컴팩트";
			}
			break;
		case "condomsDisplay":
			switch (value) {
				case "none":
					return "숨김";
				case "standard":
					return "표준";
			}
			break;
		case "traitOverlayFormat":
			switch (value) {
				case "table":
					return "표";
				case "reducedTable":
					return "축소된 표";
				case "list":
					return "목록";
			}
			break;
		case "font":
			switch (value) {
				case "":
					return "시스템 기본값";
				case "Arial":
					return "Arial";
				case "Verdana":
					return "Verdana";
				case "TimesNewRoman":
					return "Times New Roman";
				case "Georgia":
					return "Georgia";
				case "Garamond":
					return "Garamond";
				case "CourierNew":
					return "Courier New";
				case "LucidaConsole":
					return "Lucida Console";
				case "Monaco":
					return "Monaco";
				case "ComicSans":
					return "Comic Sans";
			}
			break;
		case "passageLineHeight":
			switch (value) {
				case 0:
					return "기본값";
			}
			break;
		case "overlayLineHeight":
			switch (value) {
				case 0:
					return "기본값";
			}
			break;
		case "sidebarLineHeight":
			switch (value) {
				case 0:
					return "기본값";
			}
			break;
		case "passageFontSize":
			switch (value) {
				case 0:
					return "기본값";
			}
			break;
		case "overlayFontSize":
			switch (value) {
				case 0:
					return "기본값";
			}
			break;
		case "sidebarFontSize":
			switch (value) {
				case 0:
					return "기본값";
			}
			break;
		case "genderBody":
			switch (value) {
				case "default":
					return "기본값";
				case "m":
					return "남성적";
				case "a":
					return "중성적";
				case "f":
					return "여성적";
			}
			break;
		case "dateFormat":
			switch (value) {
				case "en-GB":
					return "일/월/년";
				case "en-US":
					return "월/일/년";
				case "zh-CN":
					return "년/월/일";
			}
			break;
		case "color":
			switch (value) {
				case "black":
					return "검은색";
				case "blue":
					return "파란색";
				case "brown":
					return "갈색";
				case "green":
					return "초록색";
				case "pink":
					return "분홍색";
				case "purple":
					return "보라색";
				case "red":
					return "빨간색";
				case "tangerine":
					return "주황색";
				case "teal":
					return "청록색";
				case "white":
					return "흰색";
				case "yellow":
					return "노란색";
				case "custom":
					return "사용자 지정";
				case "random":
					return "무작위";
			}
			break;
		case "colourItems":
			switch (value) {
				case "disable":
					return "비활성화";
				case "random":
					return "랜덤 색상 사용";
				case "default":
					return "기본 색상 사용";
			}
			break;
		case "mannequinGender":
			switch (value) {
				case "same":
					return "플레이어와 동일";
				case "opposite":
					return "플레이어와 반대";
				case "male":
					return "항상 남성";
				case "female":
					return "항상 여성";
			}
			break;
		case "secColor":
			switch (value) {
				case "black":
					return "검은색";
				case "blue":
					return "파란색";
				case "brown":
					return "갈색";
				case "green":
					return "초록색";
				case "pink":
					return "분홍색";
				case "purple":
					return "보라색";
				case "red":
					return "빨간색";
				case "tangerine":
					return "주황색";
				case "teal":
					return "청록색";
				case "white":
					return "흰색";
				case "yellow":
					return "노란색";
				case "custom":
					return "사용자 지정";
				case "random":
					return "무작위";
			}
			break;
		case "bestiality":
			switch (value) {
				case "on":
					return "활성화";
				case "off":
					return "비활성화";
				case "monsterOnly":
					return "수인일 때만";
			}
			break;
		case "pronoun":
			switch (value) {
				case "none":
					return "해당 없음";
				case "m":
					return "남성";
				case "f":
					return "여성";
			}
			break;
		case "skinType":
			switch (value) {
				case "ghost":
					return "유령처럼 창백함";
			}
			break;
		case "skincolour":
			return setup.colours.getSkinToneLabel(value);
		case "skinToneMin":
		case "skinToneMode":
		case "skinToneMax":
			return `${value} (${setup.colours.getSkinToneLabel(value)})`;
	}

	if ((varName === "femaleNPCHermChance" || varName === "maleNPCHermChance") && setup.features?.herm) return value + "%";

	switch (varName) {
		case "rentCostModifier":
		case "clothingCostModifier":
		case "furnitureCostModifier":
		case "lewdClothingCostModifier":
		case "schoolClothingCostModifier":
		case "underwearCostModifier":
		case "tendingYieldModifier":
		case "allureModifier":
			return Math.round(value * 100) + "%";
		case "maleChance":
		case "maleChanceMale":
		case "maleChanceFemale":
		case "femaleNPCPenisChance":
		case "maleNPCVaginaChance":
		case "maleVictimChance":
		case "npcVirginChanceStudent":
		case "npcVirginChanceAdult":
		case "straponChance":
		case "monsterChance":
		case "basePlayerPregnancyChance":
		case "baseNpcPregnancyChance":
			return value + "%";
		case "humanPregnancyMonths":
			return value + (value === 1 ? "개월" : "개월");
		case "wolfPregnancyWeeks":
			return value + (value === 1 ? "주" : "주");
	}

	switch (value) {
		case true:
			return "활성화";
		case false:
			return "비활성화";
		default:
			return value;
	}
}
window.settingValueNameFromValue = settingValueNameFromValue;

function randomiseCharacterAppearance() {
	V.bodysize = random(0, 3);
	V.facevariant = either("default", "catty", "aloof", "sweet", "foxy", "gloomy");
	V.eyeselect = either(
		"purple",
		"dark blue",
		"light blue",
		"amber",
		"hazel",
		"brown",
		"green",
		"lime green",
		"red",
		"pink",
		"black",
		"grey",
		"light grey",
		"random"
	);
	V.hairselect = either(
		"red",
		"jetblack",
		"black",
		"darkbrown",
		"brown",
		"copperbrown",
		"softbrown",
		"lightbrown",
		"burntorange",
		"blond",
		"softblond",
		"platinumblond",
		"ashyblond",
		"strawberryblond",
		"ginger",
		"white",
		"snowwhite",
		"random"
	);
	V.hairlength = random(0, 400);
	V.player.gender = either("m", "f", "n");
	V.player.sex = either("m", "f", "h");
	V.player.bodyshape = either("classic", "slender", "curvy", "soft");
	V.player.skin.color = either(
		"light",
		"medium",
		"dark",
		"gyaru",
		"rlight",
		"rmedium",
		"rdark",
		"rgyaru",
		"ylight",
		"ymedium",
		"ydark",
		"ygyaru",
		"glight",
		"gmedium",
		"gdark",
		"ggyaru",
		"blight",
		"bmedium",
		"bdark",
		"bgyaru"
	);
	V.player.ballsExist = either(true, false);
	V.player.skin.faceFreckles = either(true, false);
	V.player.skin.bodyFreckles = either("none", "upper", "full");
	V.player.breastsize = random(0, 4);
	V.player.penissize = random(0, 2);
	V.player.bottomsize = random(0, 3);
}

function randomiseCharacterTrait() {
	V.breastsensitivity = random(1, 3);
	V.genitalsensitivity = random(1, 3);
	V.mouthsensitivity = random(1, 3);
	V.bottomsensitivity = random(1, 3);
	V.drunkSensitivity = Math.round(randomFloat(0.5, 1.5) * 10) / 10;
	V.awareselect = either("innocent", "knowledgeable");
	V.background = either(
		"waif",
		"nerd",
		"athlete",
		"delinquent",
		"promiscuous",
		"exhibitionist",
		"deviant",
		"beautiful",
		"crossdresser",
		"lustful",
		"plantlover"
	);
}

function randomiseEncounterSettings() {
	V.settings.penisModifier = random(-8, 8);
	V.settings.breastModifier = random(-12, 12);
	V.settings.npcVirginChanceAdult = random(0, 100);
	V.settings.npcVirginChanceStudent = random(0, 100);
	const skinTones = [random(0, 100), random(0, 100), random(0, 100)].sort((a, b) => a - b);
	V.settings.skinToneMin = skinTones[0];
	V.settings.skinToneMode = skinTones[1];
	V.settings.skinToneMax = skinTones[2];
	V.settings.maleChanceMale = random(0, 100);
	V.settings.maleChanceFemale = random(0, 100);
	V.settings.maleNPCVaginaChance = random(0, 100);
	V.settings.maleVictimChance = random(0, 100);
	V.settings.maleChance = random(0, 100);
	V.settings.femaleNPCPenisChance = random(0, 100);
	V.settings.straponChance = random(0, 100);
	if (setup.features?.herm) {
		V.settings.femaleNPCHermChance = random(0, 100);
		V.settings.maleNPCHermChance = random(0, 100);
	}

	V.genericBeastSettings.beastMaleChance = random(0, 100);
	V.genericBeastSettings.beastMaleChanceMale = random(0, 100);
	V.genericBeastSettings.beastMaleChanceFemale = random(0, 100);
	V.genericBeastSettings.monsterChance = random(0, 100);
	V.genericBeastSettings.monsterHallucinationsOnly = either(true, false);
	V.genericBeastSettings.victimsAlwaysMonster = either(true, false);
	setAllBeastsMaleChance(V.genericBeastSettings.beastMaleChance);
	setAllBeastsMaleChanceMale(V.genericBeastSettings.beastMaleChanceMale);
	setAllBeastsMaleChanceFemale(V.genericBeastSettings.beastMaleChanceFemale);
	setAllBeastsMonsterChance(V.genericBeastSettings.monsterChance);
	setAllBeastsMonsterHallucinationsOnly(V.genericBeastSettings.monsterHallucinationsOnly);
	setAllBeastsVictimsAlwaysMonster(V.genericBeastSettings.victimsAlwaysMonster);

	C.namedBeasts.forEach(beast => {
		V.settings.namedBeasts[beast].monsterChance = random(0, 100);
		V.settings.namedBeasts[beast].hallucinationsOnly = either(true, false);
	});
}

function randomiseGameplaySettings() {
	V.settings.rentCostModifier = Math.round(randomFloat(0.1, 3) * 10) / 10;
	V.settings.baseNpcPregnancyChance = random(0, 100);
	V.settings.basePlayerPregnancyChance = random(0, 100);
	V.settings.condomLevel = random(0, 3);
	V.settings.clothingCostModifier = Math.round(randomFloat(1, 10) * 10) / 10;
	V.settings.furnitureCostModifier = Math.round(randomFloat(0.6, 5) * 10) / 10;
	V.settings.lewdClothingCostModifier = Math.round(randomFloat(0.1, 2) * 10) / 10;
	V.settings.schoolClothingCostModifier = Math.round(randomFloat(1, 2) * 10) / 10;
	V.settings.underwearCostModifier = Math.round(randomFloat(1, 2) * 10) / 10;
	V.settings.tendingYieldModifier = Math.round(randomFloat(1, 10) * 10) / 10;
	V.settings.allureModifier = Math.round(randomFloat(0.2, 2) * 10) / 10;
	V.settings.skillCheckStyle = either("percentage", "words", "skillname");
}

/**
 * Randomises one category of settings, or everything when given no category.
 *
 * @param {string} category One of the randomise categories, or undefined for all of them.
 */
function randomiseSettings(category) {
	switch (category) {
		case "characterAppearance":
			randomiseCharacterAppearance();
			break;
		case "characterTrait":
			randomiseCharacterTrait();
			break;
		case "encounter":
			randomiseEncounterSettings();
			break;
		case "gameplay":
			randomiseGameplaySettings();
			break;
		default:
			if (V.passage === "Start") {
				randomiseCharacterAppearance();
				randomiseCharacterTrait();
			}
			randomiseEncounterSettings();
			randomiseGameplaySettings();
	}
}
window.randomiseSettings = randomiseSettings;

window.loadExternalExportFile = function () {
	importScripts("DolSettingsExport.js")
		.then(function () {
			const textArea = document.getElementById("settingsDataInput");
			textArea.value = JSON.stringify(DolSettingsExport);
		})
		.catch(function () {
			const button = document.getElementById("LoadExternalExportFile");
			button.value = "불러오기 오류";
		});
};

/**
 * instantly moves changes made in the passage into save data without changing the passage
 * WARNING: the game __will__ re-apply passage effects after reload, be sure to account for that or avoid using it
 */
function updateMoment() {
	State.history[State.activeIndex].variables = JSON.parse(JSON.stringify(V));
}
window.updateMoment = updateMoment;

window.isJsonString = function (s) {
	try {
		JSON.parse(s);
	} catch (e) {
		return false;
	}
	return true;
};

/**
 * Recursively traverses an object, reporting an error for any NaN values or null objects or functions\
 * Example: `let result = recurseNaN(a, "a");`.
 *
 * @param {object} obj The head of the object tree.
 * @param {string} path A string to indicate the path, put the object name in quotes.
 * @param {object} result An object to store the results in. - leave blank.
 * @param {Set} hist A set used for Cycle history. - leave blank.
 */

function recurseNaN(obj, path, result = null, hist = null) {
	result = Object.assign({ nulls: [], nan: [], functions: [], cycle: [] }, result);
	if (hist == null) hist = new Set([obj]);
	/* let result = {"nulls" : [], "nan" : [], "cycle" : []}; */
	for (const [key, val] of Object.entries(obj)) {
		const newPath = `${path}.${key}`;
		if (Number.isNaN(val)) {
			result.nan.push(newPath);
			continue;
		}
		if (typeof val === "function") result.functions.push(newPath);
		if (typeof val === "object") {
			if (val === null) {
				result.nulls.push(newPath);
				continue;
			}
		} else {
			continue;
		}
		if (hist.has(val)) {
			result.cycle.push(newPath);
			continue;
		}
		hist.add(val);
		recurseNaN(val, `${newPath}`, result, hist);
	}
	return result;
}
window.recurseNaN = recurseNaN;

/**
 * Recursively traverse target object, finding and returning an object containing all the NaN vars inside.
 *
 * Use with nukeNaNs to re-assign 0 to all bad NaN'd vars.	Use with caution.
 *
 * @param {object} target The object to traverse.	Defaults to V ($).
 * @returns {object} An object containing all the properties/sub-props that were NaN.
 */
function scanNaNs(target = V) {
	// If this gets set to true during function, a NaN was hit within scope.
	let isMutated = false;
	const current = Object.create({});
	// Loop through all properties of the target for NaNs and objects to scan.
	for (const [key, value] of Object.entries(target)) {
		// If value is an object, scan that property.
		if (value && typeof value === "object") {
			const resp = scanNaNs(value);
			// If scanNaNs returns a non-null object, there was a NaN somewhere, so make sure to update current obj.
			if (resp && typeof resp === "object") {
				current[key] = resp;
				isMutated = true;
			}
		} else if (typeof value === "number") {
			// Does what it says on the tin, make sure you only test numbers.
			if (isNaN(value)) {
				// Set property to a default value, likely zero.
				current[key] = 0;
				isMutated = true;
			}
		}
	}
	// Return a fully realised object, indicating there were NaNs, or null, which can be ignored.
	// isMutated controls whether we have encountered NaNs, remember to update where necessary.
	return isMutated ? current : null;
}
window.scanNaNs = scanNaNs;

function nukeNaNs(target = V) {
	for (const key in target) {
		const value = target[key];
		if (typeof value === "object" && value !== null) nukeNaNs(value);
		else if (Number.isNaN(value)) target[key] = 0;
	}
}
window.nukeNaNs = nukeNaNs;
