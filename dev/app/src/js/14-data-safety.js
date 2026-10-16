/* =========================================================================
   V2.5.0 — Phase A2: data safety, auto backups, restore, one-tab guard
   ========================================================================= */
var DataHealth = { corrupt: [], failedKeys: new Map(), readOnly: false, persisted: null, lastSaveOk: '' };
const AUTOSNAP_INDEX_KEY = 'master_student_journey_v90_autosnap_index';
const AUTOSNAP_SLOTS = 3;
const AUTOSNAP_KEY = n => `master_student_journey_v90_autosnap_${n}`;
const BACKUP_SCHEMA = 'mtb-backup-2';
function appVersionLabel() { return document.querySelector('meta[name="app-version"]')?.content || document.querySelector('meta[content^="V2."]')?.content || 'V2.5.0'; }
function buildBackupPayload(override = {}) {
  return {
    schema: BACKUP_SCHEMA, exportedAt: new Date().toISOString(), app: 'MASTER TEST-BOOK', version: appVersionLabel(),
    modules: override.modules || AppModules, userState: UserState, importHistory: override.importHistory || getImportHistory(),
    attemptHistory: AttemptHistory, resultHistory: ResultHistory, builderTemplates: BuilderTemplates, reviewState: ReviewState, studySettings: StudySettings
  };
}
function backupCounts(p) {
  const mods = Array.isArray(p?.modules) ? p.modules : [];
  return {
    modules: mods.length, questions: mods.reduce((n, m) => n + (m.groups || []).reduce((a, g) => a + (g.questions || []).length, 0), 0),
    attempts: Array.isArray(p?.attemptHistory) ? p.attemptHistory.length : 0, results: Array.isArray(p?.resultHistory) ? p.resultHistory.length : 0,
    bookmarks: Array.isArray(p?.reviewState?.bookmarks) ? p.reviewState.bookmarks.length : 0
  };
}
function validateBackupPayload(p) {
  const errors = [];
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, errors: ['यह Master TestBook backup file नहीं है।'] };
  if (!Array.isArray(p.modules)) errors.push('इसमें सवालों (modules) की list नहीं है।');
  else p.modules.forEach((m, i) => {
    if (!m || typeof m !== 'object' || !m.moduleId || !Array.isArray(m.groups)) errors.push(`Module ${i + 1} अधूरा है।`);
    else m.groups.forEach(g => { if (!g || !Array.isArray(g.questions)) errors.push(`Module ${m.moduleId}: group अधूरा है।`); else g.questions.forEach(q => { if (!q || !(q.canonicalQId || q.originalQNo)) errors.push(`Module ${m.moduleId}: एक सवाल की ID नहीं है।`); }); });
  });
  [['attemptHistory', 'array'], ['resultHistory', 'array'], ['importHistory', 'array'], ['builderTemplates', 'array'], ['userState', 'object'], ['reviewState', 'object'], ['studySettings', 'object']].forEach(([k, t]) => {
    if (p[k] === undefined || p[k] === null) return;
    if (t === 'array' ? !Array.isArray(p[k]) : (typeof p[k] !== 'object' || Array.isArray(p[k]))) errors.push(`"${k}" का format गलत है।`);
  });
  return { ok: !errors.length, errors: errors.slice(0, 6), counts: backupCounts(p), exportedAt: p.exportedAt || '', version: p.version || '' };
}

var DataSafety = {
  ok(key) { if (DataHealth.failedKeys.delete(key)) this.paint(); DataHealth.lastSaveOk = new Date().toISOString(); },
  fail(key, err) {
    const quota = err && (err.name === 'QuotaExceededError' || /quota/i.test(String(err.message || '')));
    DataHealth.failedKeys.set(key, quota ? 'QUOTA' : 'ERROR');
    console.warn('[Storage] save failed', key, err);
    this.paint();
  },
  async quarantine() {
    for (const c of DataHealth.corrupt) {
      if (c.savedAs) continue;
      const k = `${c.key}__damaged_${Date.now()}`;
      try { await AppStorage.setRawDirect(k, c.raw); c.savedAs = k; } catch (e) { console.warn('[Storage] could not keep damaged copy', e); }
    }
    this.paint();
  },
  async readIndex() { const raw = await AppStorage.getRaw(AUTOSNAP_INDEX_KEY); try { const v = JSON.parse(raw || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } },
  async snapshot(reason, override) {
    if (DataHealth.readOnly) return null;
    await StorageWriteQueue.flush();
    const idx = await this.readIndex();
    const used = new Set(idx.map(x => x.slot));
    let slot = [...Array(AUTOSNAP_SLOTS)].map((_, i) => i + 1).find(n => !used.has(n));
    if (!slot) slot = idx.slice().sort((a, b) => String(a.at).localeCompare(String(b.at)))[0].slot;
    const payload = buildBackupPayload(override || {});
    const entry = { slot, at: payload.exportedAt, reason: String(reason || '').slice(0, 80), counts: backupCounts(payload) };
    const next = [entry, ...idx.filter(x => x.slot !== slot)].sort((a, b) => String(b.at).localeCompare(String(a.at)));
    await AppStorage.commitMany({ [AUTOSNAP_KEY(slot)]: JSON.stringify(payload), [AUTOSNAP_INDEX_KEY]: JSON.stringify(next) });
    return entry;
  },
  async dailySnapshot() {
    try {
      const idx = await this.readIndex();
      const last = idx[0] ? Date.parse(idx[0].at) : 0;
      const hasData = (AttemptHistory || []).length || (ImportHistory || []).length;
      if (hasData && Date.now() - last > 24 * 3600 * 1000) await this.snapshot('रोज़ का अपने-आप backup');
    } catch (e) { console.warn('[Backup] daily snapshot skipped', e); }
  },
  paint() {
    let el = document.getElementById('dsBanner');
    const failed = DataHealth.failedKeys.size, quota = [...DataHealth.failedKeys.values()].includes('QUOTA');
    const unseenCorrupt = DataHealth.corrupt.filter(c => !c.dismissed);
    let html = '';
    if (DataHealth.readOnly) html = `<span>🔒 यह ऐप दूसरे tab में खुला है। यहाँ के बदलाव save नहीं होंगे।</span><button type="button" onclick="tabGuardTakeOver()">यहीं इस्तेमाल करें</button>`;
    else if (failed) html = `<span>⚠️ ${quota ? 'फ़ोन में जगह भर गई —' : ''} आपका पिछला बदलाव save नहीं हुआ।</span><button type="button" onclick="retryAllSaves()">फिर कोशिश करें</button><button type="button" onclick="downloadDataSnapshot()">Backup लें</button>`;
    else if (unseenCorrupt.length) html = `<span>⚠️ कुछ पुराना data पढ़ा नहीं जा सका। उसे सुरक्षित अलग रखा गया है।</span><button type="button" onclick="openBackupCenter()">देखें</button>`;
    if (!html) { if (el) el.remove(); document.body.classList.remove('ds-banner-on'); return; }
    if (!el) { el = document.createElement('div'); el.id = 'dsBanner'; el.setAttribute('role', 'alert'); document.body.appendChild(el); }
    el.innerHTML = html; document.body.classList.add('ds-banner-on');
  }
};
function retryAllSaves() {
  DataHealth.failedKeys.clear();
  [saveModules, saveUserState, saveImportHistory, saveReviewState, saveStudySettings, saveBuilderTemplates, saveAttemptHistory, saveResultHistory].forEach(fn => { try { fn(); } catch (_) {} });
  DataSafety.paint();
}

/* ---------- one tab at a time ---------- */
var TabGuard = { id: Math.random().toString(36).slice(2), ch: null };
try {
  TabGuard.ch = new BroadcastChannel('master-testbook-v1');
  TabGuard.ch.onmessage = e => { const m = e.data || {}; if (m.from === TabGuard.id) return; if (m.type === 'hello' || m.type === 'takeover') { DataHealth.readOnly = true; DataSafety.paint(); } };
} catch (_) {}
function tabGuardAnnounce() { try { TabGuard.ch?.postMessage({ type: 'hello', from: TabGuard.id }); } catch (_) {} }
function tabGuardTakeOver() { try { TabGuard.ch?.postMessage({ type: 'takeover', from: TabGuard.id }); } catch (_) {} location.reload(); }

/* ---------- backup download / restore ---------- */
function downloadDataSnapshot() {
  try { StudySettings.lastBackupAt = new Date().toISOString(); saveStudySettings(); } catch (_) {}
  const payload = buildBackupPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `MASTER_TESTBOOK_BACKUP_${new Date().toISOString().slice(0, 10)}_${Date.now()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  if (document.querySelector('#modalSheetBody .bk')) setTimeout(() => openBackupCenter(), 300);
}
let PendingRestore = null;
function fmtWhen(iso) { const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleString('hi-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
function countsLine(c) { return `${c.questions} सवाल · ${c.attempts} जवाब · ${c.results} टेस्ट · ${c.bookmarks} bookmark`; }
async function openBackupCenter() {
  closeDrawer();
  const idx = await DataSafety.readIndex().catch(() => []);
  const cur = backupCounts(buildBackupPayload());
  const failed = DataHealth.failedKeys.size;
  const corrupt = DataHealth.corrupt;
  openModal('💾 Backup और Restore', `<div class="bk">
    <div class="bk-status ${failed ? 'bad' : 'good'}"><b>${failed ? '⚠️ कुछ बदलाव save नहीं हुए' : '✓ Data save हो रहा है'}</b><span>${countsLine(cur)}</span><span>Storage: ${AppStorage.useFallback ? 'छोटी (localStorage)' : 'IndexedDB'} · ${DataHealth.persisted === true ? 'Browser हटाएगा नहीं (persistent)' : 'Browser जगह कम होने पर हटा सकता है'} · आख़िरी backup: ${StudySettings.lastBackupAt ? fmtWhen(StudySettings.lastBackupAt) : 'कभी नहीं'}</span></div>
    ${corrupt.length ? `<div class="bk-status bad"><b>⚠️ ${corrupt.length} हिस्सा पढ़ा नहीं जा सका</b><span>उसकी जगह साफ़ data लिया गया। खराब copy सुरक्षित अलग रखी है।</span>${corrupt.map((c, i) => `<button type="button" class="btn-action-sm" onclick="downloadDamaged(${i})">⬇️ खराब copy download (${escapeHtml(c.label)})</button>`).join('')}</div>` : ''}
    <button type="button" class="btn-nav primary bk-wide" onclick="downloadDataSnapshot()">⬇️ अभी Backup file download करें</button>
    <label class="bk-file"><span>⬆️ Backup file से वापस लाएँ</span><input type="file" accept=".json,application/json" onchange="restoreFromFile(this.files[0])"></label>
    <div id="bkRestore"></div>
    <h4>अपने-आप बने backup (आख़िरी ${AUTOSNAP_SLOTS})</h4>
    ${idx.length ? idx.map(e => `<div class="bk-row"><div><b>${escapeHtml(e.reason || 'Backup')}</b><small>${fmtWhen(e.at)} · ${countsLine(e.counts || {})}</small></div><button type="button" class="btn-action-sm" onclick="restoreFromSlot(${Number(e.slot)})">वापस लाएँ</button></div>`).join('') : '<p class="bk-note">अभी कोई नहीं। Import, delete, restore और reset से पहले, और रोज़ एक बार अपने-आप बनता है।</p>'}
    <p class="bk-note">Backup file को Google Drive या WhatsApp पर खुद को भेजकर रखें। फ़ोन बदलने पर उसी से data वापस आएगा।</p>
  </div>`);
}
function downloadDamaged(i) {
  const c = DataHealth.corrupt[i]; if (!c) return;
  const blob = new Blob([c.raw], { type: 'text/plain' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `MASTER_TESTBOOK_DAMAGED_${c.label}_${Date.now()}.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  c.dismissed = true; DataSafety.paint();
}
function showRestorePreview(payload, label) {
  const v = validateBackupPayload(payload);
  const box = document.getElementById('bkRestore'); if (!box) return;
  if (!v.ok) { PendingRestore = null; box.innerHTML = `<div class="bk-status bad"><b>❌ यह backup इस्तेमाल नहीं हो सकता</b>${v.errors.map(e => `<span>${escapeHtml(e)}</span>`).join('')}</div>`; return; }
  PendingRestore = payload;
  const missing = ['userState', 'attemptHistory', 'resultHistory', 'reviewState', 'studySettings'].filter(k => payload[k] === undefined);
  box.innerHTML = `<div class="bk-status warn"><b>${escapeHtml(label)}</b><span>${v.exportedAt ? 'बना: ' + fmtWhen(v.exportedAt) + ' · ' : ''}${countsLine(v.counts)}</span>
    <span>अभी का data इससे <b>बदल जाएगा</b>। बदलने से पहले अभी वाले data का अपने-आप backup बनेगा।</span>${missing.length ? `<span>इस backup में ${missing.length} हिस्से नहीं हैं — वे अभी जैसे हैं वैसे रहेंगे।</span>` : ''}
    <div class="bk-actions"><button type="button" class="btn-nav" onclick="PendingRestore=null;document.getElementById('bkRestore').innerHTML=''">रद्द</button><button type="button" class="btn-nav primary" onclick="confirmRestore()">हाँ, वापस लाएँ</button></div></div>`;
}
async function restoreFromFile(file) {
  if (!file) return;
  let payload = null;
  try { payload = JSON.parse(await file.text()); } catch (_) { const box = document.getElementById('bkRestore'); if (box) box.innerHTML = `<div class="bk-status bad"><b>❌ File पढ़ी नहीं जा सकी</b><span>यह सही JSON backup file नहीं है।</span></div>`; return; }
  showRestorePreview(payload, '📄 ' + file.name);
}
async function restoreFromSlot(slot) {
  const raw = await AppStorage.getRaw(AUTOSNAP_KEY(slot));
  let payload = null; try { payload = JSON.parse(raw || 'null'); } catch (_) {}
  showRestorePreview(payload, '🕒 अपने-आप बना backup');
}
async function confirmRestore() {
  const p = PendingRestore; if (!p) return;
  if (ActiveTestSession?.sessionStatus === 'ACTIVE') { openCustomToast('पहले चल रहा टेस्ट submit करें।'); return; }
  try {
    await DataSafety.snapshot('Restore से पहले');
    const map = { [STORAGE_KEY]: JSON.stringify(p.modules) };
    if (p.userState) map[USER_KEY] = JSON.stringify(p.userState);
    if (p.importHistory) map[IMPORT_HISTORY_KEY] = JSON.stringify(p.importHistory);
    if (p.attemptHistory) map[ATTEMPT_HISTORY_KEY] = JSON.stringify(p.attemptHistory);
    if (p.resultHistory) map[RESULT_HISTORY_KEY] = JSON.stringify(p.resultHistory);
    if (p.builderTemplates) map[BUILDER_TEMPLATE_KEY] = JSON.stringify(p.builderTemplates);
    if (p.reviewState) map[REVIEW_STATE_KEY] = JSON.stringify(p.reviewState);
    if (p.studySettings) map[STUDY_SETTINGS_KEY] = JSON.stringify(p.studySettings);
    await StorageWriteQueue.flush();
    await AppStorage.commitMany(map);
    PendingRestore = null;
    location.reload();
  } catch (e) {
    const box = document.getElementById('bkRestore'); if (box) box.innerHTML = `<div class="bk-status bad"><b>❌ Restore नहीं हुआ</b><span>${escapeHtml(e.message || e)}। अभी का data जैसा था वैसा है।</span></div>`;
  }
}

/* ---------- safe delete (one place for every delete) ---------- */
async function deleteOwnedQuestions(ids) {
  const workspace = WorkspaceManager.requireActive();
  const selected = new Set(ids.map(x => String(x || '').trim()).filter(Boolean));
  if (!selected.size) { openCustomToast('पहले questions select करें.'); return false; }
  const owned = new Set();
  for (const mod of (AppModules || [])) {
    if (mod?.workspaceId !== workspace.id || mod?.workspaceType !== workspace.type) continue;
    for (const g of (mod.groups || [])) for (const q of (g.questions || [])) { const id = String(q?.canonicalQId || '').trim(); if (id && selected.has(id)) owned.add(id); }
  }
  if (!owned.size) { openCustomToast('चयनित प्रश्न active workspace में नहीं हैं; कोई बदलाव नहीं किया गया।'); return false; }
  if (owned.size !== selected.size) { openCustomToast('कुछ चयनित प्रश्न active workspace के स्वामित्व में नहीं हैं; सुरक्षा के लिए पूरी deletion रोक दी गई।'); return false; }
  if (!confirm(`${owned.size} question(s) को active workspace (${workspace.name}) से delete करना है?\n\nDelete से पहले अपने-आप backup बनेगा।`)) return false;
  try {
    const next = AppModules.map(mod => {
      if (mod?.workspaceId !== workspace.id || mod?.workspaceType !== workspace.type) return mod;
      return { ...mod, groups: (mod.groups || []).map(g => ({ ...g, questions: (g.questions || []).filter(q => !owned.has(String(q?.canonicalQId || ''))) })).filter(g => (g.questions || []).length) };
    }).filter(mod => mod?.workspaceId !== workspace.id || mod?.workspaceType !== workspace.type || (mod.groups || []).length);
    await DataCore.commit(next, { reason: `Delete ${owned.size}`, snapshot: `Delete से पहले (${owned.size} सवाल)`, allowNewIssues: true });
    openDataControlModal();
    return true;
  } catch (e) {
    openCustomToast('Delete नहीं हुआ; पुराना data वैसा ही है।');
    return false;
  }
}
async function deleteSelectedQuestions() { return deleteOwnedQuestions(Array.from(document.querySelectorAll('.dc-check:checked'), x => x.value)); }
async function deleteQuestionDNA(canonicalQId) { return deleteOwnedQuestions([canonicalQId]); }

/* ---------- undo last import of this workspace ---------- */
async function undoLastImportUI() {
  const ws = WorkspaceManager.current();
  const history = getImportHistory();
  const entry = history.find(h => (h.workspaceId ? h.workspaceId === ws.id : !!AppModules.find(m => m.moduleId === h.moduleId && WorkspaceManager.matches(m))));
  if (!entry) return openCustomToast('इस workspace में undo करने लायक कोई import नहीं है।');
  if (entry.beforeModule === undefined) return openCustomToast('यह पुराना import है — इसे undo नहीं कर सकते। "Backup और Restore" से पुराना backup वापस ला सकते हैं।');
  if (!confirm(`आख़िरी import वापस लें?\n\nFile: ${entry.sourceFile}\nTopic: ${entry.topicTitle}\n\n${entry.beforeModule ? 'Topic import से पहले जैसा हो जाएगा।' : 'यह topic हट जाएगा (यह इसी import से बना था)।'}`)) return;
  try {
    const idx = AppModules.findIndex(m => m.moduleId === entry.moduleId && WorkspaceManager.matches(m));
    const next = AppModules.slice();
    if (entry.beforeModule) { if (idx >= 0) next[idx] = entry.beforeModule; else next.push(entry.beforeModule); } else if (idx >= 0) next.splice(idx, 1);
    const nextHistory = history.filter(h => h !== entry);
    await DataCore.commit(next, { reason: 'Undo import', snapshot: 'Undo से पहले: ' + entry.topicTitle, importHistory: nextHistory, allowNewIssues: true });
    openCustomToast('✅ Import वापस ले लिया गया।');
  } catch (e) {
    openCustomToast('❌ Undo नहीं हुआ: ' + escapeHtml(e.message || e));
  }
}
