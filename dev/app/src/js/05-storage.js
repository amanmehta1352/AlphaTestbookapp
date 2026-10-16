/* =========================================================================
   PHASE 1A — SAFE STORAGE ARCHITECTURE
   In-memory singletons remain synchronous after hydration. IndexedDB is the
   persistence layer; localStorage remains a non-destructive fallback.
   ========================================================================= */
const AppStorage = (() => {
  const DB_NAME = 'MasterTestBookDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'appData';
  let db = null;
  let useFallback = false;
  let initPromise = null;

  function openDatabase() {
    if (initPromise) return initPromise;
    initPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable.'));
      let request;
      try { request = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (err) { reject(err); return; }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => { db = request.result; resolve(db); };
      request.onerror = () => reject(request.error || new Error('IndexedDB open failed.'));
      request.onblocked = () => reject(new Error('IndexedDB open blocked.'));
    }).catch(err => {
      useFallback = true;
      console.warn('[Phase 1A] IndexedDB unavailable; using localStorage fallback.', err);
      return null;
    });
    return initPromise;
  }

  async function init() { await openDatabase(); return { available: !!db && !useFallback, useFallback }; }

  function localGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function localSet(key, value) {
    try { localStorage.setItem(key, value); return true; }
    catch (e) { console.warn('[Phase 1A] localStorage write failed.', e); return false; }
  }
  function localDelete(key) { try { localStorage.removeItem(key); } catch (e) {} }

  function getRaw(key) {
    if (useFallback || !db) return Promise.resolve(localGet(key));
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result == null ? null : String(req.result));
        req.onerror = () => reject(req.error || new Error('IndexedDB read failed.'));
      } catch (e) { reject(e); }
    }).catch(async err => {
      // V2.5.0: never switch storage on a read error — retry once, then fail loudly.
      console.warn('[Storage] read failed; retrying once.', err);
      await new Promise(r => setTimeout(r, 150));
      return new Promise((resolve, reject) => {
        try {
          const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
          req.onsuccess = () => resolve(req.result == null ? null : String(req.result));
          req.onerror = () => reject(req.error || new Error('IndexedDB read failed.'));
        } catch (e) { reject(e); }
      });
    });
  }

  function idbPut(key, value) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed.'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted.'));
        tx.objectStore(STORE_NAME).put(value, key);
      } catch (e) { reject(e); }
    });
  }
  function reportSave(key, err) { try { if (typeof DataSafety !== 'undefined' && DataSafety) { if (err) DataSafety.fail(key, err); else DataSafety.ok(key); } } catch (_) {} }
  function setRawDirect(key, value) {
    if (useFallback || !db) {
      if (!localSet(key, value)) { const e = new Error('Storage write failed.'); reportSave(key, e); return Promise.reject(e); }
      reportSave(key); return Promise.resolve(true);
    }
    // V2.5.0: retry once; never switch to localStorage mid-session (that lost data on reload).
    return idbPut(key, value).catch(async err => {
      console.warn('[Storage] write failed; retrying once.', err);
      await new Promise(r => setTimeout(r, 200));
      return idbPut(key, value);
    }).then(v => { reportSave(key); return v; }, err => { reportSave(key, err); throw err; });
  }
  async function deleteKey(key) {
    if (useFallback || !db) { localDelete(key); return true; }
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction(STORE_NAME, 'readwrite');
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error('IndexedDB delete failed.'));
        tx.objectStore(STORE_NAME).delete(key);
      } catch (e) { reject(e); }
    }).catch(() => { localDelete(key); return true; });
  }

  async function migrate() {
    await init();
    const keys = [STORAGE_KEY, USER_KEY, IMPORT_HISTORY_KEY];
    if (useFallback || !db) return { migrated: false, fallback: true };
    let migrated = false;
    for (const key of keys) {
      const existing = await getRaw(key);
      if (existing == null) {
        const legacy = localGet(key);
        if (legacy != null) {
          await setRawDirect(key, legacy);
          migrated = true;
        }
      }
    }
    return { migrated, fallback: false };
  }

  async function commitValidatedImport(payload) {
    if (!payload || !Array.isArray(payload.modules) || !Array.isArray(payload.importHistory)) {
      throw new Error('Validated import commit requires module and import-history snapshots.');
    }
    const modulesSnapshot = JSON.stringify(payload.modules);
    const historySnapshot = JSON.stringify(payload.importHistory);
    await init();
    if (!useFallback && db) {
      await new Promise((resolve, reject) => {
        let tx;
        try {
          tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).put(modulesSnapshot, STORAGE_KEY);
          tx.objectStore(STORE_NAME).put(historySnapshot, IMPORT_HISTORY_KEY);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error || new Error('Atomic import storage transaction failed.'));
          tx.onabort = () => reject(tx.error || new Error('Atomic import storage transaction aborted.'));
        } catch (err) { reject(err); }
      });
      return { persisted: true, mode: 'indexeddb-atomic' };
    }
    // localStorage has no multi-key transaction; preserve exact prior values and roll back on any write failure.
    const oldModules = localGet(STORAGE_KEY);
    const oldHistory = localGet(IMPORT_HISTORY_KEY);
    try {
      if (!localSet(STORAGE_KEY, modulesSnapshot)) throw new Error('Could not persist imported modules.');
      if (!localSet(IMPORT_HISTORY_KEY, historySnapshot)) throw new Error('Could not persist import history.');
      return { persisted: true, mode: 'localstorage-rollback-guarded' };
    } catch (err) {
      if (oldModules == null) localDelete(STORAGE_KEY); else localSet(STORAGE_KEY, oldModules);
      if (oldHistory == null) localDelete(IMPORT_HISTORY_KEY); else localSet(IMPORT_HISTORY_KEY, oldHistory);
      throw new Error('Import persistence failed; previous storage values were restored. ' + (err.message || err));
    }
  }

  // Several keys in one all-or-nothing step (restore, snapshots).
  async function commitMany(map) {
    const keys = Object.keys(map || {});
    if (!keys.length) return true;
    await init();
    if (!useFallback && db) {
      await new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          keys.forEach(k => tx.objectStore(STORE_NAME).put(map[k], k));
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error || new Error('Storage transaction failed.'));
          tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted.'));
        } catch (e) { reject(e); }
      });
      return true;
    }
    const old = {}; keys.forEach(k => { old[k] = localGet(k); });
    try { keys.forEach(k => { if (!localSet(k, map[k])) throw new Error('Could not save ' + k); }); return true; }
    catch (e) { keys.forEach(k => { if (old[k] == null) localDelete(k); else localSet(k, old[k]); }); throw e; }
  }
  return { init, migrate, getRaw, setRawDirect, deleteKey, commitValidatedImport, commitMany, get useFallback() { return useFallback; } };
})();

class AsyncWriteQueue {
  constructor() { this.tail = Promise.resolve(); }
  enqueue(task) {
    if (typeof DataHealth !== 'undefined' && DataHealth && DataHealth.readOnly) { const p = Promise.reject(new Error('READ_ONLY_TAB')); p.catch(() => {}); return p; }
    const run = this.tail.then(() => task(), () => task());
    run.catch(() => {});
    this.tail = run.catch(() => undefined);
    return run;
  }
  flush() { return this.tail; }
}
const StorageWriteQueue = new AsyncWriteQueue();

function parseStored(raw, fallback, key) {
  if (raw == null || raw === '') return fallback;
  try { return JSON.parse(raw); } catch (e) {
    if (key && typeof DataHealth !== 'undefined' && DataHealth) {
      const labels = { [STORAGE_KEY]: 'questions', [USER_KEY]: 'progress', [IMPORT_HISTORY_KEY]: 'import-history' };
      DataHealth.corrupt.push({ key, raw: String(raw), label: labels[key] || String(key).replace(/^master_student_journey_v90_/, '') });
    }
    return fallback;
  }
}

async function loadModules() {
  const raw = await AppStorage.getRaw(STORAGE_KEY);
  const parsed = parseStored(raw, null, STORAGE_KEY);
  // A saved empty list is respected (the user deleted everything); only a first run gets the starter data.
  return Array.isArray(parsed) ? parsed : DEFAULT_MODULES;
}

let AppModules = [];

function saveModules() {
  const snapshot = JSON.stringify(AppModules);
  return StorageWriteQueue.enqueue(() => AppStorage.setRawDirect(STORAGE_KEY, snapshot));
}

async function loadUserState() {
  const raw = await AppStorage.getRaw(USER_KEY);
  const parsed = parseStored(raw, null, USER_KEY);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  return { theme: 'light', selectedExam: 'rrb-ntpc', selectedYear: '', resumeState: null, masteryMap: {}, mistakeBook: [] };
}

let UserState = null;

function saveUserState() {
  const snapshot = JSON.stringify(UserState);
  return StorageWriteQueue.enqueue(() => AppStorage.setRawDirect(USER_KEY, snapshot));
}

let ImportHistory = [];
async function hydrateImportHistory() {
  const raw = await AppStorage.getRaw(IMPORT_HISTORY_KEY);
  const parsed = parseStored(raw, [], IMPORT_HISTORY_KEY);
  ImportHistory = Array.isArray(parsed) ? parsed : [];
}
function getImportHistory() { return ImportHistory; }
function saveImportHistory() {
  const snapshot = JSON.stringify(ImportHistory);
  return StorageWriteQueue.enqueue(() => AppStorage.setRawDirect(IMPORT_HISTORY_KEY, snapshot));
}

async function hydrateSingletons() {
  const modules = await loadModules();
  const userState = await loadUserState();
  await hydrateImportHistory();
  await hydrateLearningHistory();
  await hydrateBuilderTemplates();
  await hydrateReviewState();
  await hydrateStudySettings();
  try { applyDisplaySettings(); } catch (_) {}
  if (DataHealth.corrupt.length) await DataSafety.quarantine();
  AppModules = Array.isArray(modules) ? modules : DEFAULT_MODULES;
  UserState = userState || {};
  const workspaceMigration = WorkspaceManager.migrate(AppModules);
  WorkspaceManager.hydrate();
  if (workspaceMigration.changed) await saveModules();
}

function setHydrationStatus(message, isError = false) {
  const gate = document.getElementById('hydrationGate');
  const status = document.getElementById('hydrationStatus');
  if (status) status.textContent = message;
  if (gate) gate.classList.toggle('hydration-error', !!isError);
}

function releaseHydrationGate() {
  const gate = document.getElementById('hydrationGate');
  if (!gate) return;
  gate.setAttribute('aria-busy', 'false');
  gate.remove();
}

async function initApp() {
  try {
    tabGuardAnnounce();
    setHydrationStatus('Opening secure local storage...');
    await AppStorage.init();
    setHydrationStatus('Checking migration safety...');
    await AppStorage.migrate();
    setHydrationStatus('Restoring modules, progress, and import history...');
    await hydrateSingletons();
    setHydrationStatus('Resolving taxonomy and rebuilding indexes...');
    synchronizeTaxonomyEngine();
    setHydrationStatus('Finalizing learning environment...');
    document.body.classList.toggle('dark', UserState.theme === 'dark');
    const btnTheme = document.getElementById('btnTheme');
    if (btnTheme) {
      btnTheme.textContent = UserState.theme === 'dark' ? '☀️' : '🌙';
      if (btnTheme.dataset.v226ThemeWired !== 'true') {
        btnTheme.dataset.v226ThemeWired = 'true';
        btnTheme.addEventListener('click', toggleCbtDark);
      }
    }
    releaseHydrationGate();
    DataSafety.paint();
    paintVersion();
    try { if (navigator.storage?.persist) navigator.storage.persisted().then(p => p ? true : navigator.storage.persist()).then(v => { DataHealth.persisted = !!v; }).catch(() => {}); } catch (_) {}
    setTimeout(() => DataSafety.dailySnapshot(), 4000);
    setTimeout(() => { cloudBoot().catch(e => console.warn('[Cloud] start failed', e)); }, 200);
    if (!recoverCbtSessionIfValid()) { if (!restoreAppRoute()) navigate('home', {}); else renderView(); }
  } catch (error) {
    console.error('[Phase 1A] Hydration failed:', error);
    setHydrationStatus('Storage hydration failed. Main UI was not mounted. Check console for details.', true);
    const gate = document.getElementById('hydrationGate');
    if (gate) gate.setAttribute('aria-busy', 'true');
  }
}
