/* =========================================================================
   HEALTH CHECK + version (V2.8.0)
   One screen that tells the admin, in plain words, whether the app's data
   and connections are healthy — and a text report to send for support.
   ========================================================================= */
// Starter (demo) questions, remembered before anything can change them.
const starterKey = (m, q) => m.moduleId + '|' + String(q.QUESTION_EN || q.QUESTION_HI || '').trim();
const STARTER_SIGNATURE = DEFAULT_MODULES.flatMap(m => (m.groups || []).flatMap(g => (g.questions || []).map(q => starterKey(m, q)))).sort().join('\n');
function appVersionShort() { return String(appVersionLabel()).split('_')[0]; }
// True when this app still holds only the untouched demo questions (e.g. a new install before restoring a backup).
function isPristineDemo(ws = WorkspaceManager.current()) {
  const sig = WorkspaceManager.filterModules(AppModules).flatMap(m => (m.groups || []).flatMap(g => (g.questions || []).map(q => starterKey(m, q)))).sort().join('\n');
  return !(ImportHistory || []).length && sig === STARTER_SIGNATURE;
}
function healthCollect() {
  const items = [];
  const add = (level, title, detail, action) => items.push({ level, title, detail, action });
  const a = runDataIntegrityAudit();
  const ws = WorkspaceManager.current();
  const wsQs = WorkspaceManager.filterModules(AppModules).reduce((n, m) => n + (m.groups || []).reduce((x, g) => x + (g.questions || []).length, 0), 0);
  add('ok', `Version ${appVersionShort()}`, `${ws.name} · इस workspace में ${wsQs} सवाल, कुल ${a.total}`);
  // storage
  const failed = DataHealth.failedKeys.size;
  add(failed ? 'bad' : 'ok', failed ? 'कुछ बदलाव save नहीं हुए' : 'Data save हो रहा है', `Storage: ${AppStorage.useFallback ? 'छोटी (localStorage)' : 'IndexedDB'}${DataHealth.persisted === true ? ' · browser इसे नहीं हटाएगा' : ' · browser जगह कम होने पर हटा सकता है'}`, failed ? { label: 'फिर कोशिश करें', call: 'retryAllSaves();openHealthCheck()' } : null);
  if (DataHealth.readOnly) add('warn', 'यह ऐप दूसरे tab में खुला है', 'यहाँ के बदलाव save नहीं होंगे।', { label: 'यहीं इस्तेमाल करें', call: 'tabGuardTakeOver()' });
  if (DataHealth.corrupt.length) add('warn', `${DataHealth.corrupt.length} हिस्सा पढ़ा नहीं जा सका`, 'खराब copy सुरक्षित रखी है।', { label: 'देखें', call: 'openBackupCenter()' });
  // question data
  const bad = a.duplicateIds.length + a.missingStem.length + a.malformedOptions.length;
  add(bad ? 'warn' : 'ok', bad ? `${bad} ${bad === 1 ? 'सवाल' : 'सवालों'} में गड़बड़ी` : 'सवालों का data ठीक है',
    bad ? `duplicate ID ${a.duplicateIds.length} · खाली सवाल ${a.missingStem.length} · गलत options/उत्तर ${a.malformedOptions.length}${a.malformedOptions.length ? ' (जैसे ' + a.malformedOptions.slice(0, 3).join(', ') + ')' : ''}` : `${a.total} सवाल जाँचे: ID, सवाल, options और उत्तर सब ठीक`,
    bad ? { label: 'Data Control', call: 'closeModal();openDataControlModal()' } : null);
  const oldStyle = WorkspaceManager.filterModules(AppModules).reduce((n, m) => n + (m.groups || []).reduce((x, g) => x + (g.questions || []).filter(q => !['IMPORTED', 'SERVER', 'CLEANED'].includes(q.metadata?.status)).length, 0), 0);
  if (oldStyle) add('info', `${oldStyle} सवाल पुराने तरीके से import हुए`, 'इनमें कुछ exam/year/shift अपने-आप भरे गए हो सकते हैं — सफ़ाई tool से जाँचें।', { label: 'सफ़ाई', call: 'openCleanup()' });
  if (isPristineDemo()) add('warn', 'अभी सिर्फ़ demo सवाल हैं', 'अपना data लाने के लिए Backup restore करें या Google से login करें।', { label: 'Backup', call: 'openBackupCenter()' });
  // backups
  add(StudySettings.lastBackupAt ? 'ok' : 'info', 'Backup', `आख़िरी download: ${StudySettings.lastBackupAt ? fmtWhen(StudySettings.lastBackupAt) : 'कभी नहीं'} · अपने-आप backup: रोज़ + हर बड़े बदलाव से पहले`, { label: 'खोलें', call: 'openBackupCenter()' });
  // account / sync
  const s = ServerState.session;
  const pending = AttemptHistory.filter(x => !x.synced && !x.syncSkip).length;
  if (!s) add('info', 'Login नहीं है', cloudOnline() ? 'Google से login करने पर progress server पर सुरक्षित रहती है।' : 'Login सिर्फ़ install वाले ऐप / link में चलता है।', cloudOnline() ? { label: 'Login', call: 'openAccount()' } : null);
  else add(pending > 50 ? 'warn' : 'ok', `${s.email || 'Login'}${CloudState.isAdmin ? ' · Admin' : ''}`, `आख़िरी sync: ${CloudState.lastSyncAt ? fmtWhen(CloudState.lastSyncAt) : '—'} · भेजने बाकी: ${pending}${CloudState.msg && CloudState.msgKind !== 'good' ? ' · ' + CloudState.msg : ''}`, { label: 'Sync', call: "cloudSync('manual').then(()=>openHealthCheck())" });
  // app install
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  add(standalone ? 'ok' : 'info', standalone ? 'Install वाला ऐप' : 'Browser में खुला', `${navigator.serviceWorker?.controller ? 'बिना internet खुल सकता है' : 'Offline तैयारी नहीं (file या पहली बार)'} · ${navigator.onLine === false ? 'अभी internet नहीं' : 'internet चालू'}`);
  // recent data changes
  if (DataCore.log.length) add('info', 'हाल के बदलाव', DataCore.log.slice(0, 4).map(l => `${fmtWhen(l.at)} ${l.reason}`).join(' · '));
  return { items, audit: a };
}
function healthReportText() {
  const { items } = healthCollect();
  const mark = { ok: '✓', warn: '⚠', bad: '✕', info: '•' };
  return `TestBook Health Check — ${new Date().toLocaleString('hi-IN')}\n` + items.map(i => `${mark[i.level]} ${i.title}: ${i.detail}`).join('\n');
}
async function healthCopy() {
  const t = healthReportText();
  try { await navigator.clipboard.writeText(t); openCustomToast('रिपोर्ट copy हो गई — chat में paste कर दें।'); }
  catch (_) { openModal('🩺 रिपोर्ट', `<textarea class="hc-text" readonly>${escapeHtml(t)}</textarea><p class="srv-note">ऊपर का text select करके copy करें।</p>`); }
}
async function healthServerPing() {
  const el = document.getElementById('hcPing'); if (el) el.textContent = '⏳ जाँच…';
  try {
    const r = await fetch(ServerConfig.url + '/auth/v1/settings', { headers: { apikey: ServerConfig.key } });
    if (el) el.textContent = r.ok ? '✓ Server से जुड़ाव ठीक' : `✕ Server ने मना किया (HTTP ${r.status})`;
  } catch (_) { if (el) el.textContent = '✕ Server तक नहीं पहुँचे (internet?)'; }
}
function openHealthCheck() {
  closeDrawer();
  const { items } = healthCollect();
  const worst = items.some(i => i.level === 'bad') ? 'bad' : items.some(i => i.level === 'warn') ? 'warn' : 'ok';
  const icon = { ok: '✓', warn: '⚠️', bad: '✕', info: 'ℹ️' };
  openModal('🩺 Health Check', `<div class="hc">
    <div class="hc-sum ${worst}"><b>${worst === 'ok' ? '✓ सब ठीक है' : worst === 'warn' ? (n => `⚠️ ${n} ${n === 1 ? 'बात' : 'बातों'} पर ध्यान दें`)(items.filter(i => i.level === 'warn').length) : '✕ कुछ ज़रूरी ठीक करना है'}</b><span>नीचे हर हिस्से की हालत है।</span></div>
    ${items.map(i => `<div class="hc-row ${i.level}"><span class="hc-ic" aria-hidden="true">${icon[i.level]}</span><span class="hc-tx"><b>${escapeHtml(i.title)}</b><small>${escapeHtml(i.detail)}</small></span>${i.action ? `<button type="button" class="btn-action-sm" onclick="${i.action.call}">${escapeHtml(i.action.label)}</button>` : ''}</div>`).join('')}
    <div class="hc-row info"><span class="hc-ic" aria-hidden="true">☁️</span><span class="hc-tx"><b>Server</b><small id="hcPing">जाँचने के लिए बटन दबाएँ</small></span><button type="button" class="btn-action-sm" onclick="healthServerPing()">जाँचें</button></div>
    <button type="button" class="btn-nav primary srv-wide" onclick="healthCopy()">📋 रिपोर्ट copy करें</button>
    <p class="srv-note">कोई दिक्कत हो तो यह रिपोर्ट copy करके Claude को भेज दें — इसमें कोई password या निजी जवाब नहीं होता।</p>
  </div>`);
}
function paintVersion() { const el = document.getElementById('drwVersion'); if (el) el.textContent = `TestBook ${appVersionShort()}`; }
