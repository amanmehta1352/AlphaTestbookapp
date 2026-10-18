/* =========================================================================
   V2.7.0 — Phase C2: student account (Google login), questions from the
   server, progress kept on the server (attempts, tests, bookmarks, goal).
   ========================================================================= */
const CLOUD_STATE_KEY = 'master_student_journey_v90_cloud_state';
var CloudState = { userId: '', email: '', name: '', isAdmin: null, lastSyncAt: '', lastContentAt: '', serverQuestions: 0, bookmarksMerged: false, busy: false, msg: '', msgKind: '' };
function cloudOnline() { return /^https?:$/.test(location.protocol); }
function cloudAppUrl() { return location.origin + location.pathname; }
async function cloudLoadState() { try { const s = JSON.parse((await AppStorage.getRaw(CLOUD_STATE_KEY)) || 'null'); if (s && typeof s === 'object') CloudState = { ...CloudState, ...s, busy: false, msg: '' }; } catch (_) {} }
function cloudSaveState() { const { busy, msg, msgKind, ...keep } = CloudState; return StorageWriteQueue.enqueue(() => AppStorage.setRawDirect(CLOUD_STATE_KEY, JSON.stringify(keep))).catch(() => {}); }

/* ---------- Google login (redirect) ---------- */
function cloudLoginGoogle() {
  if (!cloudOnline()) { openCustomToast('Google login सिर्फ़ install वाले ऐप / link में चलता है।'); return; }
  location.href = `${ServerConfig.url}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(cloudAppUrl())}`;
}
// After Google, Supabase sends the student back with the login in the address (#access_token=…).
async function cloudFinishRedirect() {
  const h = location.hash || '';
  if (!/access_token=|error_description=/.test(h)) return false;
  const p = new URLSearchParams(h.replace(/^#/, ''));
  try { history.replaceState(history.state, document.title, location.pathname + location.search); } catch (_) {}
  if (p.get('error_description')) { CloudState.msg = 'Google login नहीं हुआ: ' + p.get('error_description'); CloudState.msgKind = 'bad'; return true; }
  Server.setSession({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: p.get('expires_in') || 3600, user: {} });
  try {
    const u = await Server.req('/auth/v1/user');
    ServerState.session.email = u?.email || ''; ServerState.session.user_id = u?.id || '';
    try { localStorage.setItem(SERVER_SESSION_KEY, JSON.stringify(ServerState.session)); } catch (_) {}
    CloudState.name = u?.user_metadata?.full_name || u?.user_metadata?.name || '';
  } catch (e) { CloudState.msg = e.message; CloudState.msgKind = 'bad'; }
  return true;
}

/* ---------- content: questions from the server ---------- */
async function cloudPullAll(table, select, order) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const rows = await Server.select(table, `select=${select}&order=${order}&limit=1000&offset=${offset}`);
    out.push(...(rows || []));
    if (!rows || rows.length < 1000) break;
  }
  return out;
}
function cloudTargetWorkspace() { const w = WorkspaceManager.current(); return w.type === 'COMPETITIVE' ? w : WorkspaceManager.DEFAULT; }
function cloudQuestionFromRow(r, examName, ws, idx) {
  const st = r.source_type === 'PYQ' ? 'PYQ' : r.source_type === 'PRACTICE' ? 'PRACTICE' : undefined;
  const meta = {
    canonicalQId: r.id, subject: r.subject, chapter: r.chapter, topic: r.topic, subtopic: r.subtopic || 'General', examId: r.exam_id || '', exam: examName || r.exam_id || '',
    year: r.year ? String(r.year) : '', shift: r.shift || '', difficulty: r.difficulty || 'MODERATE', difficultySource: r.difficulty ? 'SERVER' : 'DEFAULT',
    questionFormat: r.format === 'SUBJECTIVE' ? 'SUBJECTIVE' : 'MCQ', status: 'SERVER', workspaceId: ws.id, workspaceType: ws.type
  };
  if (st) meta.sourceType = st;
  return {
    canonicalQId: r.id, originalQNo: r.question_no || idx + 1, QUESTION_EN: r.question_en || '', QUESTION_HI: r.question_hi || '',
    options: Array.isArray(r.options) ? r.options.map(o => ({ letter: String(o.letter || '').toUpperCase(), en: o.en || '', hi: o.hi || o.en || '' })) : [],
    answer: r.answer || '', EXPLANATION: r.explanation_en || r.explanation_hi || '', EXPLANATION_HI: r.explanation_hi || '',
    hints: [r.explanation_en || r.explanation_hi || ''].filter(Boolean), examInfo: examName || '', year: meta.year, paperDate: meta.shift,
    metadata: meta, workspaceId: ws.id, workspaceType: ws.type, contentHash: r.content_hash || '', importState: 'READY', version: 'server'
  };
}
async function cloudPullContent() {
  const ws = cloudTargetWorkspace();
  const exams = await cloudPullAll('exams', 'id,name', 'id');
  const topics = await cloudPullAll('topics', 'id,subject,chapter,title,exam_id,year', 'id');
  let rows = await cloudPullAll('questions', 'id,topic_id,exam_id,year,shift,subject,chapter,topic,subtopic,question_no,format,question_en,question_hi,options,answer,explanation_en,explanation_hi,source_type,difficulty,content_hash', 'topic_id,question_no,id');
  const examName = new Map(exams.map(e => [e.id, e.name]));
  CloudState.profileIndex = typeof profileIndex === 'function' ? profileIndex(rows, examName) : null;
  const allCount = rows.length;
  if (typeof profileFilterRows === 'function') rows = profileFilterRows(rows);
  const byTopic = new Map(); rows.forEach(r => { if (!byTopic.has(r.topic_id)) byTopic.set(r.topic_id, []); byTopic.get(r.topic_id).push(r); });
  const modules = [];
  topics.forEach(t => {
    const list = byTopic.get(t.id) || []; if (!list.length) return;
    const qs = list.map((r, i) => cloudQuestionFromRow(r, examName.get(r.exam_id), ws, i));
    const groups = [];
    for (let i = 0; i < qs.length; i += 20) { const c = qs.slice(i, i + 20), n = String(i / 20 + 1).padStart(2, '0'); groups.push({ groupId: `${t.id}-g${n}`, title: `G-${n}`, description: `${c.length} Questions • Q${c[0].originalQNo}–Q${c[c.length - 1].originalQNo}`, questions: c }); }
    const subj = String(t.subject || 'general');
    const mod = { workspaceId: ws.id, workspaceType: ws.type, moduleId: t.id, source: 'server', subject: subj,
      subjectTitle: subj === 'maths' ? '📐 Mathematics' : subj === 'science' ? '🔬 General Science' : subj === 'reasoning' ? '🧠 Reasoning' : '📘 ' + subjectDisplayName(subj),
      topic: slugify(t.title), topicTitle: t.title, chapter: t.chapter, examId: t.exam_id || undefined, examYear: t.year ? String(t.year) : undefined,
      testType: 'class-test', testTypeTitle: 'Class Test', groups };
    WorkspaceManager.stampM(mod, ws); modules.push(mod);
  });
  const serverIds = new Set(modules.map(m => m.moduleId));
  const keep = AppModules.filter(m => !(m.workspaceId === ws.id && (serverIds.has(m.moduleId) || m.source === 'server')));
  const before = AppModules;
  const next = [...keep, ...modules];
  const changed = JSON.stringify(before.filter(m => m.workspaceId === ws.id && m.source === 'server').map(m => [m.moduleId, m.groups.map(g => g.questions.map(q => q.contentHash))])) !== JSON.stringify(modules.map(m => [m.moduleId, m.groups.map(g => g.questions.map(q => q.contentHash))]));
  if (changed) {
    await DataCore.commit(next, { reason: 'Server से सवाल', snapshot: 'Server से सवाल लाने से पहले', allowNewIssues: true });
  }
  CloudState.serverQuestions = rows.length; CloudState.serverQuestionsAll = allCount; CloudState.lastContentAt = new Date().toISOString();
  return { questions: rows.length, topics: modules.length, changed };
}

/* ---------- progress: attempts, tests, bookmarks, goal ---------- */
function cloudAttemptId(a) { return a.clientId || `${a.cid}@${a.ts}`; }
async function cloudExisting(table, ids) {
  const found = new Set();
  for (let i = 0; i < ids.length; i += 60) { const res = await Server.select(table, `select=id&id=in.${srvInList(ids.slice(i, i + 60))}`); (res || []).forEach(x => found.add(x.id)); }
  return found;
}
async function cloudInsertIgnore(table, rows) {
  if (!rows.length) return;
  await Server.ensureFresh();
  for (let i = 0; i < rows.length; i += 300) await Server.req(`/rest/v1/${table}?on_conflict=user_id,client_id`, { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: rows.slice(i, i + 300) });
}
async function cloudSyncProgress() {
  const uid = ServerState.session?.user_id || CloudState.userId;
  const ws = cloudTargetWorkspace();
  // attempts up
  const pending = AttemptHistory.filter(a => !a.synced && !a.syncSkip && (!a.uid || a.uid === uid) && a.cid && /^[A-D]$/i.test(String(a.answer || '')));
  const known = await cloudExisting('questions', [...new Set(pending.map(a => a.cid))]);
  const send = [];
  pending.forEach(a => {
    if (!known.has(a.cid)) { a.syncSkip = true; return; }
    send.push({ client_id: cloudAttemptId(a), question_id: a.cid, chosen: String(a.answer).toUpperCase(), is_correct: !!a.correct, seconds: Number.isFinite(Number(a.sec)) && a.sec !== null ? Math.max(0, Math.min(3600, Math.round(a.sec))) : null, mode: ['practice', 'test', 'revision'].includes(a.mode) ? a.mode : 'practice', session_id: a.resultId || null, answered_at: a.ts });
  });
  await cloudInsertIgnore('attempts', send);
  const sentIds = new Set(send.map(r => r.client_id));
  AttemptHistory.forEach(a => { if (sentIds.has(cloudAttemptId(a))) { a.synced = true; a.uid = uid; a.clientId = cloudAttemptId(a); } });
  // tests up (the whole local record rides along so another phone can show it fully)
  const examIds = new Set((await cloudPullAll('exams', 'id', 'id')).map(e => e.id));
  const rPending = ResultHistory.filter(r => !r.synced && (!r.uid || r.uid === uid));
  await cloudInsertIgnore('results', rPending.map(r => ({ client_id: r.id, title: [r.topicTitle, r.groupTitle].filter(Boolean).join(' · ').slice(0, 200) || 'Test', exam_id: examIds.has(r.examId) ? r.examId : null, year: srvYear(r.examYear), question_ids: (r.questionIds || []).map(String), answers: { local: r }, correct: Math.max(0, r.correct | 0), wrong: Math.max(0, r.wrong | 0), skipped: Math.max(0, r.unattempted | 0), score: Number.isFinite(Number(r.score)) ? Number(r.score) : null, duration_seconds: Number.isFinite(Number(r.timeUsedSec)) ? Math.max(0, Math.round(r.timeUsedSec)) : null, submitted_at: r.ts })));
  rPending.forEach(r => { r.synced = true; r.uid = uid; });
  // attempts + tests down (a new phone gets its history back)
  const have = new Set(AttemptHistory.map(cloudAttemptId));
  const qById = id => IndexEngine.registry.get(id);
  const srvAttempts = await Server.select('attempts', 'select=client_id,question_id,chosen,is_correct,seconds,mode,session_id,answered_at&order=answered_at.desc&limit=5000');
  const added = [];
  (srvAttempts || []).forEach(x => {
    if (have.has(x.client_id)) return;
    const q = qById(x.question_id), m = q?.metadata || {}, mod = AppModules.find(md => (md.groups || []).some(g => (g.questions || []).includes(q)));
    const ts = new Date(x.answered_at).toISOString();
    added.push({ v: 1, ts, day: sjLocalDay(new Date(ts)), mode: x.mode, ws: ws.id, moduleId: mod?.moduleId || '', cid: x.question_id, qno: q?.originalQNo ?? null, subject: m.subject || '', chapter: m.chapter || '', topic: m.topic || '', subtopic: m.subtopic || '', type: m.theoryOrNumerical || '', difficulty: m.difficulty || '', examId: m.examId || '', year: m.year || '', answer: x.chosen || '', key: q?.answer || '', correct: !!x.is_correct, sec: x.seconds, resultId: x.session_id || undefined, clientId: x.client_id, synced: true, uid });
  });
  if (added.length) { AttemptHistory.push(...added); AttemptHistory.sort((a, b) => String(a.ts).localeCompare(String(b.ts))); if (AttemptHistory.length > ATTEMPT_HISTORY_CAP) AttemptHistory.splice(0, AttemptHistory.length - ATTEMPT_HISTORY_CAP); }
  const haveR = new Set(ResultHistory.map(r => r.id));
  const srvResults = await Server.select('results', 'select=client_id,answers,submitted_at&order=submitted_at.desc&limit=200');
  let addedR = 0;
  (srvResults || []).forEach(x => { const r = x.answers?.local; if (!r || haveR.has(x.client_id) || r.id !== x.client_id) return; ResultHistory.push({ ...r, ws: ws.id, synced: true, uid }); addedR++; });
  if (addedR) { ResultHistory.sort((a, b) => String(b.ts).localeCompare(String(a.ts))); if (ResultHistory.length > RESULT_HISTORY_CAP) ResultHistory.length = RESULT_HISTORY_CAP; }
  await saveAttemptHistory(); await saveResultHistory();
  // bookmarks: first time on a phone = merge both ways; afterwards this phone decides
  const srvB = await Server.select('bookmarks', 'select=question_id');
  const srvSet = new Set((srvB || []).map(b => b.question_id));
  const local = ReviewState.bookmarks.filter(b => b.ws === ws.id);
  const localSet = new Set(local.map(b => b.cid));
  const firstTime = !CloudState.bookmarksMerged || CloudState.userId !== uid;
  if (firstTime) srvSet.forEach(id => { if (!localSet.has(id) && qById(id)) { ReviewState.bookmarks.unshift({ cid: id, ws: ws.id, ts: new Date().toISOString() }); localSet.add(id); } });
  const knownB = await cloudExisting('questions', [...localSet].filter(id => !srvSet.has(id)));
  const upB = [...localSet].filter(id => !srvSet.has(id) && knownB.has(id)).map(id => ({ question_id: id }));
  if (upB.length) { await Server.ensureFresh(); await Server.req('/rest/v1/bookmarks?on_conflict=user_id,question_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: upB }); }
  if (!firstTime) { const del = [...srvSet].filter(id => !localSet.has(id)); for (let i = 0; i < del.length; i += 60) await Server.req(`/rest/v1/bookmarks?question_id=in.${srvInList(del.slice(i, i + 60))}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }); }
  await saveReviewState();
  // goal + exam date
  const prof = (await Server.select('profiles', 'select=daily_goal,exam_date,display_name'))?.[0] || {};
  if (prof.display_name && !CloudState.name) CloudState.name = prof.display_name;
  if (!StudySettings.dailyGoal && prof.daily_goal) StudySettings.dailyGoal = prof.daily_goal;
  if (!StudySettings.examDate && prof.exam_date) StudySettings.examDate = prof.exam_date;
  const goal = Number(StudySettings.dailyGoal) || null;
  if ((goal && goal !== prof.daily_goal) || ((StudySettings.examDate || null) && StudySettings.examDate !== prof.exam_date)) await Server.patch('profiles', `id=eq.${encodeURIComponent(uid)}`, { daily_goal: goal && goal >= 1 && goal <= 1000 ? goal : null, exam_date: StudySettings.examDate || null });
  await saveStudySettings();
  CloudState.bookmarksMerged = true;
  return { up: send.length, upTests: rPending.length, down: added.length, downTests: addedR };
}

/* ---------- one sync ---------- */
var CloudSyncRunning = null;
async function cloudSync(reason = 'manual') {
  if (!ServerState.session || DataHealth.readOnly) return null;
  if (CloudSyncRunning) return CloudSyncRunning;
  CloudSyncRunning = (async () => {
    CloudState.busy = true; cloudPaint(); try { cloudHomePrompt(); } catch (_) {}
    try {
      await Server.ensureFresh();
      const uid = ServerState.session.user_id;
      if (CloudState.isAdmin === null || CloudState.userId !== uid) CloudState.isAdmin = await Server.checkAdmin();
      let content = null;
      if (!CloudState.isAdmin) content = await cloudPullContent();
      const prog = await cloudSyncProgress();
      CloudState.userId = uid; CloudState.email = ServerState.session.email || CloudState.email; CloudState.lastSyncAt = new Date().toISOString();
      CloudState.msg = `✓ Sync हो गया${content?.changed ? ` · ${content.questions} सवाल server से आए` : ''}${prog.up ? ` · ${prog.up} जवाब भेजे` : ''}${prog.down ? ` · ${prog.down} पुराने जवाब वापस आए` : ''}`; CloudState.msgKind = 'good';
      await cloudSaveState();
      if (content?.changed || prog.down || prog.downTests) { try { renderView(); } catch (_) {} }
      return { content, prog };
    } catch (e) {
      CloudState.msg = (reason === 'auto' ? 'Sync बाद में होगा: ' : '') + e.message; CloudState.msgKind = e.network ? 'warn' : 'bad';
      return null;
    } finally { CloudState.busy = false; CloudSyncRunning = null; cloudPaint(); try { cloudHomePrompt(); } catch (_) {} }
  })();
  return CloudSyncRunning;
}

/* ---------- account sheet ---------- */
function cloudPaint() { const el = document.getElementById('cloudSheet'); if (el) el.innerHTML = cloudSheetHtml(); }
function cloudSheetHtml() {
  const s = ServerState.session;
  const msg = CloudState.msg ? `<div class="srv-msg ${CloudState.msgKind}" role="status">${escapeHtml(CloudState.msg)}</div>` : '';
  if (!s) return `${msg}
    <div class="cl-hero"><b>अपना account बनाइए</b><span>Google से login करने पर सारे सवाल server से आते हैं, और आपकी progress — जवाब, टेस्ट, bookmark, लक्ष्य — सुरक्षित रहती है। फ़ोन बदलें तो login करते ही सब वापस।</span></div>
    <button type="button" class="cl-google" onclick="cloudLoginGoogle()" ${cloudOnline() ? '' : 'disabled'}><span class="g">G</span> Google से login करें</button>
    ${cloudOnline() ? '' : '<p class="srv-note">Login सिर्फ़ install वाले ऐप या link में चलता है, फ़ोन में खोली file में नहीं।</p>'}
    <button type="button" class="btn-action-sm" onclick="closeModal();openServerSync()">Admin? Email से login</button>`;
  return `${msg}
    <div class="cl-user"><span class="cl-avatar" aria-hidden="true">${escapeHtml((CloudState.name || s.email || '?').trim().charAt(0).toUpperCase())}</span><span><b>${escapeHtml(CloudState.name || s.email || 'Login हो गया')}</b><small>${escapeHtml(s.email || '')}${CloudState.isAdmin ? ' · Admin' : ''}</small></span></div>
    <div class="cl-stats"><span><b>${CloudState.lastSyncAt ? fmtWhen(CloudState.lastSyncAt) : '—'}</b>आख़िरी sync</span><span><b>${CloudState.isAdmin ? '—' : (CloudState.serverQuestions || 0)}</b>server के सवाल</span><span><b>${AttemptHistory.filter(a => !a.synced && !a.syncSkip).length}</b>भेजने बाकी</span></div>
    ${CloudState.isAdmin ? '<p class="srv-note">आप admin हैं: इस फ़ोन पर server से सवाल नहीं आते। सवाल डालने, जाँचने और publish करने के लिए <a href="admin/">🛠️ Admin Studio</a> खोलें। आपकी progress यहाँ से sync होती है।</p>' : ''}
    <button type="button" class="btn-nav primary srv-wide" onclick="cloudSync('manual')" ${CloudState.busy ? 'disabled' : ''}>${CloudState.busy ? '⏳ Sync हो रहा है…' : '🔄 अभी sync करें'}</button>
    <p class="srv-note">ऐप खुलते समय और हर 10 मिनट में अपने-आप sync होता है। बिना internet के जो करेंगे, वह internet आने पर भेजा जाएगा। (Revision cards अभी सिर्फ़ इसी फ़ोन में रहते हैं।)</p>
    <button type="button" class="btn-action-sm" onclick="cloudLogout()">Logout</button>`;
}
async function openAccount() {
  closeDrawer();
  if (!ServerState.session) Server.loadSession();
  openModal('👤 मेरा account', `<div id="cloudSheet" class="srv">${cloudSheetHtml()}</div>`);
}
async function cloudLogout() {
  if (!confirm('Logout करें? इस फ़ोन का data रहेगा; दोबारा login करने पर sync फिर से होगा।')) return;
  await Server.logout(); CloudState.isAdmin = null; CloudState.msg = 'Logout हो गया।'; CloudState.msgKind = ''; await cloudSaveState(); cloudPaint(); try { renderView(); } catch (_) {}
}
// Home: explain why server questions are unavailable and provide a safe recovery action.
function cloudHomePrompt() {
  if (Route?.page !== 'home' || !cloudOnline() || WorkspaceManager.current().type === 'BOARD') return;
  const v = document.getElementById('mainView'); if (!v) return;
  const syncCard = v.querySelector('.cl-sync-prompt');
  if (ServerState.session) {
    const needsHelp = CloudState.isAdmin !== true && (CloudState.msgKind === 'bad' ||
      (CloudState.isAdmin === false && !!CloudState.lastSyncAt && Number(CloudState.serverQuestions || 0) === 0));
    if (!needsHelp) { syncCard?.remove(); return; }
    const hasFilteredOutQuestions = Number(CloudState.serverQuestionsAll || 0) > 0 && Number(CloudState.serverQuestions || 0) === 0;
    const title = CloudState.busy ? 'सवाल sync हो रहे हैं…' : 'सवाल लोड नहीं हुए';
    const detail = CloudState.msgKind === 'bad'
      ? (CloudState.msg || 'Server से सवाल लाने में समस्या हुई।')
      : hasFilteredOutQuestions
        ? 'आपके चुने exam/branch में सवाल नहीं मिले। अपना exam और branch जाँचें।'
        : 'इस account के लिए अभी कोई published सवाल उपलब्ध नहीं हैं।';
    const card = syncCard || document.createElement('section');
    card.className = 'cl-sync-prompt'; card.setAttribute('role', 'status'); card.setAttribute('aria-live', 'polite');
    card.innerHTML = `<b>⚠️ ${escapeHtml(title)}</b><p>${escapeHtml(detail)}</p><div class="cl-sync-actions"><button type="button" class="cl-sync-retry" ${CloudState.busy ? 'disabled' : ''} onclick="cloudSync('manual')">${CloudState.busy ? 'Sync हो रहा है…' : 'फिर कोशिश करें'}</button>${profileAvailable() ? '<button type="button" class="cl-sync-change" onclick="openProfileSheet()">Exam बदलें</button>' : ''}<button type="button" class="cl-sync-account" onclick="openAccount()">Account विवरण</button></div>`;
    if (!syncCard) v.prepend(card);
    return;
  }
  if (syncCard) syncCard.remove();
  if (!cloudOnline() || v.querySelector('.cl-prompt')) return;
  const el = document.createElement('button'); el.type = 'button'; el.className = 'cl-prompt'; el.onclick = openAccount;
  el.innerHTML = `<span class="g">G</span><span><b>Google से login करें</b><small>सारे सवाल पाएँ और progress सुरक्षित रखें</small></span><span aria-hidden="true">›</span>`;
  v.prepend(el);
}
async function cloudBoot() {
  await cloudLoadState();
  Server.loadSession();
  const came = await cloudFinishRedirect();
  if (ServerState.session) { await cloudSync('auto'); if (came) openAccount(); }
  else if (came) openAccount();
  setInterval(() => { if (ServerState.session && navigator.onLine !== false) cloudSync('auto'); }, 10 * 60 * 1000);
  window.addEventListener('online', () => { if (ServerState.session) cloudSync('auto'); });
}

const _c2RenderView = renderView;
renderView = function () { _c2RenderView(); try { cloudHomePrompt(); } catch (_) {} };