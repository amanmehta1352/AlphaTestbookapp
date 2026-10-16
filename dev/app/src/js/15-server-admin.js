/* =========================================================================
   V2.6.0 — Phase C1: server connection (admin upload)
   Plain fetch to Supabase Auth + REST. The publishable key is public by
   design; the database's own rules decide what each login may do.
   ========================================================================= */
const ServerConfig = { url: 'https://fzkvwkrbtykucjfdqiin.supabase.co', key: 'sb_publishable_o_P1uxqNhrFmOZDVVvl80A_JYQAAhB3' };
const SERVER_SESSION_KEY = 'mtb_server_session_v1';
const SERVER_SYNC_KEY = 'master_student_journey_v90_server_sync';
var ServerState = { session: null, isAdmin: null, busy: false, plan: null, syncInfo: {}, msg: '', msgKind: '', progress: '' };

const Server = {
  headers(extra = {}) {
    const h = { apikey: ServerConfig.key, 'Content-Type': 'application/json', ...extra };
    if (ServerState.session?.access_token) h.Authorization = 'Bearer ' + ServerState.session.access_token;
    return h;
  },
  async req(path, opts = {}) {
    let res;
    try { res = await fetch(ServerConfig.url + path, { method: opts.method || 'GET', headers: this.headers(opts.headers), body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined }); }
    catch (e) { const err = new Error('Internet नहीं है या server तक नहीं पहुँच पाए।'); err.network = true; throw err; }
    const text = await res.text(); let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
    if (!res.ok) {
      let msg = (data && (data.message || data.msg || data.error_description || data.error)) || ('HTTP ' + res.status);
      if (/invalid login credentials/i.test(msg)) msg = 'Email या password गलत है।';
      else if (/email not confirmed/i.test(msg)) msg = 'यह email अभी confirm नहीं है (Supabase में "Auto Confirm" से user बनाएँ)।';
      else if (res.status === 401 || /JWT/i.test(msg)) msg = 'Login की अवधि खत्म — दोबारा login करें।';
      else if (data?.code === '42501' || /row-level security/i.test(msg)) msg = 'इस login को यह काम करने की अनुमति नहीं है (admin नहीं)।';
      const e = new Error(msg); e.status = res.status; e.code = data?.code; throw e;
    }
    return data;
  },
  setSession(d) {
    ServerState.session = { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + (Number(d.expires_in) || 3600) * 1000, email: d.user?.email || ServerState.session?.email || '', user_id: d.user?.id || '' };
    try { localStorage.setItem(SERVER_SESSION_KEY, JSON.stringify(ServerState.session)); } catch (_) {}
  },
  loadSession() { try { const s = JSON.parse(localStorage.getItem(SERVER_SESSION_KEY) || 'null'); if (s && s.refresh_token) ServerState.session = s; } catch (_) {} },
  async login(email, password) {
    ServerState.session = null;
    const d = await this.req('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
    this.setSession(d); ServerState.isAdmin = null; return d;
  },
  async ensureFresh() {
    const s = ServerState.session;
    if (!s) throw new Error('पहले login करें।');
    if (Date.now() < Number(s.expires_at) - 60000) return;
    ServerState.session = null;
    try { const d = await this.req('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token } }); this.setSession({ ...d, user: d.user || { email: s.email } }); }
    catch (e) { if (e.network) { ServerState.session = s; throw e; } await this.logout(true); throw new Error('Login की अवधि खत्म — दोबारा login करें।'); }
  },
  async logout(localOnly) {
    const s = ServerState.session; ServerState.session = null; ServerState.isAdmin = null; ServerState.plan = null;
    try { localStorage.removeItem(SERVER_SESSION_KEY); } catch (_) {}
    if (!localOnly && s) { try { await fetch(ServerConfig.url + '/auth/v1/logout', { method: 'POST', headers: { apikey: ServerConfig.key, Authorization: 'Bearer ' + s.access_token } }); } catch (_) {} }
  },
  async checkAdmin() { await this.ensureFresh(); const v = await this.req('/rest/v1/rpc/is_admin', { method: 'POST', body: {} }); ServerState.isAdmin = v === true; return ServerState.isAdmin; },
  async select(table, query) { await this.ensureFresh(); return this.req(`/rest/v1/${table}?${query}`); },
  async upsert(table, rows, onConflict) {
    if (!rows.length) return;
    await this.ensureFresh();
    return this.req(`/rest/v1/${table}?on_conflict=${onConflict}`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: rows });
  },
  async patch(table, query, body) { await this.ensureFresh(); return this.req(`/rest/v1/${table}?${query}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body }); }
};

/* ---------- mapping app data → server rows ---------- */
function srvYear(v) { const n = parseInt(String(v || '').trim(), 10); return n >= 1950 && n <= 2100 ? n : null; }
function srvValidExamId(id) { return /^[a-z0-9][a-z0-9-]{1,80}$/.test(String(id || '')); }
function srvInList(ids) { return '(' + ids.map(id => encodeURIComponent('"' + String(id).replace(/["\\]/g, '\\$&') + '"')).join(',') + ')'; }
function srvExamRow(id, nameHint) {
  const p = UniversalExamRegistry.registry.get(id) || {}, k = UniversalExamRegistry.knownProfiles[id] || {};
  return { id, name: String(p.examName || k.name || nameHint || id).slice(0, 120), board: p.examBoard || k.board || null, category: p.category || k.category || null, marking: p.markingScheme || k.marking || null };
}
function srvTopicRow(mod) {
  return { id: mod.moduleId, workspace: 'competitive', subject: String(mod.subject || 'general'), chapter: String(mod.chapter || 'General'), title: String(mod.topicTitle || mod.moduleId), exam_id: srvValidExamId(mod.examId) ? mod.examId : null, year: srvYear(mod.examYear) };
}
function srvQuestionRow(q, mod) {
  const m = q.metadata || {}, problems = [];
  const subjective = String(m.questionFormat || q.questionFormat || '').toUpperCase() === 'SUBJECTIVE';
  const answer = String(q.answer || '').toUpperCase().trim();
  if (!(q.QUESTION_EN || q.QUESTION_HI || '').trim()) problems.push('सवाल का text नहीं');
  if (!subjective) {
    if (!/^[A-D]$/.test(answer)) problems.push(`उत्तर "${String(q.answer || '').slice(0, 8)}" A–D नहीं`);
    if (!Array.isArray(q.options) || q.options.length !== 4 || q.options.some(o => !(o?.en || o?.hi))) problems.push('चारों options नहीं');
  }
  const st = pyqStatusOf(q);
  const diff = m.difficultySource === 'DEFAULT' ? null : (['EASY', 'MODERATE', 'HARD'].includes(String(m.difficulty || '').toUpperCase()) ? String(m.difficulty).toUpperCase() : null);
  const row = {
    id: String(q.canonicalQId), topic_id: mod.moduleId, workspace: 'competitive',
    exam_id: srvValidExamId(m.examId) ? m.examId : (srvValidExamId(mod.examId) ? mod.examId : null),
    year: srvYear(m.year || mod.examYear), shift: String(m.shift || '').trim() || null,
    subject: String(m.subject || mod.subject || 'general'), chapter: String(m.chapter || mod.chapter || 'General'), topic: String(m.topic || mod.topicTitle || mod.moduleId),
    subtopic: m.subtopic ? String(m.subtopic) : null, question_no: Number(q.originalQNo) > 0 ? Math.floor(Number(q.originalQNo)) : null,
    format: subjective ? 'SUBJECTIVE' : 'MCQ', question_en: String(q.QUESTION_EN || '').trim() || null, question_hi: String(q.QUESTION_HI || '').trim() || null,
    options: subjective ? [] : (q.options || []).map(o => ({ letter: String(o.letter || '').toUpperCase(), en: String(o.en || ''), hi: String(o.hi || '') })),
    answer: subjective ? null : (/^[A-D]$/.test(answer) ? answer : null),
    explanation_en: String(q.EXPLANATION || '').trim() || null, explanation_hi: String(q.EXPLANATION_HI || '').trim() || null,
    source_type: st === 'PYQ' ? 'PYQ' : st === 'NOT_PYQ' ? 'PRACTICE' : null, difficulty: diff, is_active: true
  };
  // Hash of everything we send: any change (text, answer, PYQ mark…) makes it "changed".
  row.content_hash = 'v1-' + importHash(JSON.stringify(row));
  return { row, problems };
}

/* ---------- plan: what will be sent ---------- */
async function srvBuildPlan(moduleIds) {
  const plan = { topics: [], examRows: new Map(), totals: { new: 0, changed: 0, same: 0, skipped: 0, conflict: 0, serverOnly: 0 }, builtAt: Date.now() };
  for (const id of moduleIds) {
    const mod = getWorkspaceModule(id); if (!mod) continue;
    ServerState.progress = `जाँच: ${mod.topicTitle || mod.moduleId}`; srvPaint();
    const rows = [], skipped = [];
    (mod.groups || []).flatMap(g => g.questions || []).forEach(q => { const r = srvQuestionRow(q, mod); if (r.problems.length) skipped.push({ no: q.originalQNo, id: String(q.canonicalQId), why: r.problems.join(', ') }); else rows.push(r.row); });
    const server = await Server.select('questions', `select=id,content_hash,is_active&topic_id=eq.${encodeURIComponent(mod.moduleId)}`);
    const sMap = new Map((server || []).map(x => [x.id, x]));
    const unknown = rows.map(r => r.id).filter(i => !sMap.has(i)), elsewhere = new Map();
    for (let i = 0; i < unknown.length; i += 60) {
      const res = await Server.select('questions', `select=id,topic_id&id=in.${srvInList(unknown.slice(i, i + 60))}`);
      (res || []).forEach(x => { if (x.topic_id !== mod.moduleId) elsewhere.set(x.id, x.topic_id); });
    }
    const conflicts = rows.filter(r => elsewhere.has(r.id)).map(r => ({ id: r.id, topic: elsewhere.get(r.id) }));
    const send = rows.filter(r => !elsewhere.has(r.id));
    const fresh = send.filter(r => !sMap.has(r.id));
    const changed = send.filter(r => sMap.has(r.id) && (sMap.get(r.id).content_hash !== r.content_hash || !sMap.get(r.id).is_active));
    const localIds = new Set([...rows.map(r => r.id), ...skipped.map(s => s.id)]);
    const serverOnly = (server || []).filter(x => x.is_active && !localIds.has(x.id)).map(x => x.id);
    const topicRow = srvTopicRow(mod);
    [topicRow.exam_id, ...send.map(r => r.exam_id)].filter(Boolean).forEach(e => { if (!plan.examRows.has(e)) plan.examRows.set(e, srvExamRow(e, (mod.groups || []).flatMap(g => g.questions || []).find(q => q.metadata?.examId === e)?.metadata?.exam)); });
    const t = { moduleId: mod.moduleId, title: mod.topicTitle || mod.moduleId, topicRow, toSend: [...fresh, ...changed], counts: { new: fresh.length, changed: changed.length, same: send.length - fresh.length - changed.length, skipped: skipped.length, conflict: conflicts.length, serverOnly: serverOnly.length }, skipped, conflicts, serverOnly };
    Object.keys(plan.totals).forEach(k => { plan.totals[k] += t.counts[k]; });
    plan.topics.push(t);
  }
  ServerState.progress = '';
  return plan;
}

/* ---------- run the plan ---------- */
async function srvRunPlan(plan, hideServerOnly) {
  const batchId = `SYNC-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const step = t => { ServerState.progress = t; srvPaint(); };
  step('Exams भेज रहे हैं…');
  await Server.upsert('exams', [...plan.examRows.values()], 'id');
  step('Topics भेज रहे हैं…');
  await Server.upsert('topics', plan.topics.map(t => t.topicRow), 'id');
  const sent = plan.topics.reduce((n, t) => n + t.toSend.length, 0);
  await Server.upsert('import_batches', [{ id: batchId, file_name: 'ऐप से upload', topic_id: plan.topics.length === 1 ? plan.topics[0].moduleId : null, added: plan.totals.new, changed: plan.totals.changed, unchanged: plan.totals.same, removed: hideServerOnly ? plan.totals.serverOnly : 0 }], 'id');
  let done = 0;
  for (const t of plan.topics) {
    for (let i = 0; i < t.toSend.length; i += 200) {
      const chunk = t.toSend.slice(i, i + 200).map(r => ({ ...r, import_batch_id: batchId }));
      await Server.upsert('questions', chunk, 'id');
      done += chunk.length; step(`सवाल भेज रहे हैं… ${done} / ${sent}`);
    }
    if (hideServerOnly && t.serverOnly.length) {
      for (let i = 0; i < t.serverOnly.length; i += 60) await Server.patch('questions', `id=in.${srvInList(t.serverOnly.slice(i, i + 60))}`, { is_active: false });
    }
    ServerState.syncInfo[t.moduleId] = { at: new Date().toISOString(), sent: t.toSend.length, total: t.counts.new + t.counts.changed + t.counts.same };
  }
  try { await AppStorage.setRawDirect(SERVER_SYNC_KEY, JSON.stringify(ServerState.syncInfo)); } catch (_) {}
  ServerState.progress = '';
  return { batchId, sent, hidden: hideServerOnly ? plan.totals.serverOnly : 0 };
}

/* ---------- sheet UI ---------- */
function srvMsg(text, kind = '') { ServerState.msg = text; ServerState.msgKind = kind; srvPaint(); }
function srvPaint() { if (document.getElementById('srvSheet')) document.getElementById('srvSheet').innerHTML = srvSheetHtml(); }
function srvSheetHtml() {
  const s = ServerState.session, ws = WorkspaceManager.current();
  const msg = ServerState.msg ? `<div class="srv-msg ${ServerState.msgKind}" role="status">${escapeHtml(ServerState.msg)}</div>` : '';
  const prog = ServerState.progress ? `<div class="srv-msg" role="status">⏳ ${escapeHtml(ServerState.progress)}</div>` : '';
  const head = `<div class="srv-head"><span>☁️ ${escapeHtml(ServerConfig.url.replace(/^https:\/\//, ''))}</span>${s ? `<button type="button" class="btn-action-sm" onclick="srvLogout()">Logout</button>` : ''}</div>`;
  if (!s) return `${head}${msg}
    <form class="srv-login" onsubmit="event.preventDefault();srvLogin()">
      <label>Admin email<input id="srvEmail" type="email" autocomplete="username" required placeholder="you@gmail.com"></label>
      <label>Password<input id="srvPass" type="password" autocomplete="current-password" required></label>
      <button type="submit" class="btn-nav primary" ${ServerState.busy ? 'disabled' : ''}>${ServerState.busy ? 'Login हो रहा है…' : 'Login'}</button>
      <p class="srv-note">यह वही email और password है जो आपने Supabase → Authentication → Users में बनाया था। Password ऐप में save नहीं होता।</p>
    </form>`;
  if (ServerState.isAdmin === null) return ServerState.adminErr ? `${head}<div class="srv-msg bad">${escapeHtml(ServerState.adminErr)}</div><button type="button" class="btn-nav primary srv-wide" onclick="srvCheckAdmin()">फिर कोशिश करें</button>` : `${head}${msg}<div class="srv-msg">⏳ जाँच रहे हैं कि ${escapeHtml(s.email)} admin है या नहीं…</div>`;
  if (!ServerState.isAdmin) return `${head}<div class="srv-msg bad"><b>${escapeHtml(s.email)}</b> admin नहीं है। सवाल सिर्फ़ admin भेज सकता है।</div>${msg}`;
  if (ws.type !== 'COMPETITIVE') return `${head}${msg}<div class="srv-msg bad">अभी सिर्फ़ Competitive workspace के सवाल server पर जाते हैं। Workspace बदलें।</div>`;
  const mods = WorkspaceManager.filterModules(AppModules).filter(m => (m.groups || []).some(g => (g.questions || []).length));
  const p = ServerState.plan;
  const list = mods.map(m => {
    const n = (m.groups || []).reduce((a, g) => a + (g.questions || []).length, 0), info = ServerState.syncInfo[m.moduleId];
    const t = p?.topics.find(x => x.moduleId === m.moduleId);
    return `<label class="srv-topic"><input type="checkbox" class="srv-mod" value="${escapeHtml(m.moduleId)}" ${!p || t ? 'checked' : ''} ${ServerState.busy ? 'disabled' : ''} onchange="ServerState.plan=null;srvPaint()">
      <span><b>${escapeHtml(m.topicTitle || m.moduleId)}</b><small>${n} सवाल · ${escapeHtml(subjectDisplayName(m.subject))}${info ? ` · आख़िरी बार भेजा: ${fmtWhen(info.at)}` : ' · अभी server पर नहीं भेजा'}</small>
      ${t ? `<small class="srv-counts">नए ${t.counts.new} · बदले ${t.counts.changed} · वही ${t.counts.same}${t.counts.skipped ? ` · <em>रुके ${t.counts.skipped}</em>` : ''}${t.counts.conflict ? ` · <em>टकराव ${t.counts.conflict}</em>` : ''}${t.counts.serverOnly ? ` · सिर्फ़ server पर ${t.counts.serverOnly}` : ''}</small>` : ''}</span></label>`;
  }).join('');
  const details = p ? p.topics.filter(t => t.skipped.length || t.conflicts.length).map(t => `<details class="srv-detail"><summary>${escapeHtml(t.title)}: ${t.skipped.length} रुके, ${t.conflicts.length} टकराव</summary><ul>${t.skipped.slice(0, 20).map(x => `<li>Q.${escapeHtml(x.no)}: ${escapeHtml(x.why)}</li>`).join('')}${t.conflicts.slice(0, 20).map(x => `<li>${escapeHtml(x.id)} पहले से server के topic "${escapeHtml(x.topic)}" में है</li>`).join('')}</ul></details>`).join('') : '';
  const toSend = p ? p.totals.new + p.totals.changed : 0;
  return `${head}<div class="srv-msg good">✓ ${escapeHtml(s.email)} · Admin</div>${msg}${prog}
    <h4>कौन से topics भेजने हैं</h4><div class="srv-list">${list || '<p class="srv-note">इस workspace में अभी कोई सवाल नहीं।</p>'}</div>
    ${details}
    ${p && p.totals.serverOnly ? `<label class="ir-remove"><input type="checkbox" id="srvHide"> <span>Server पर <b>${p.totals.serverOnly}</b> सवाल ऐसे हैं जो अब ऐप में नहीं हैं। <b>उन्हें students से छिपाएँ</b> (मिटेंगे नहीं)</span></label>` : ''}
    <div class="srv-actions">
      <button type="button" class="btn-nav" ${ServerState.busy || !mods.length ? 'disabled' : ''} onclick="srvCheck()">1. जाँचें</button>
      <button type="button" class="btn-nav primary" ${ServerState.busy || !p || (!toSend && !(p.totals.serverOnly)) ? 'disabled' : ''} onclick="srvSend()">2. Server पर भेजें${p ? ` (${toSend})` : ''}</button>
    </div>
    <p class="srv-note">पहले "जाँचें" दबाएँ: ऐप बताएगा कितने सवाल नए हैं, कितने बदले हैं। जो पहले से वैसे ही हैं, वे दोबारा नहीं भेजे जाते।</p>`;
}
async function openServerSync() {
  closeDrawer();
  if (!ServerState.session) Server.loadSession();
  try { const raw = await AppStorage.getRaw(SERVER_SYNC_KEY); ServerState.syncInfo = JSON.parse(raw || '{}') || {}; } catch (_) { ServerState.syncInfo = {}; }
  ServerState.msg = ''; ServerState.plan = null;
  openModal('☁️ Server (Admin)', `<div id="srvSheet" class="srv">${srvSheetHtml()}</div>`);
  if (ServerState.session && ServerState.isAdmin === null) srvCheckAdmin();
}
async function srvCheckAdmin() {
  ServerState.adminErr = ''; ServerState.isAdmin = null; srvPaint();
  try { await Server.checkAdmin(); ServerState.msg = ''; }
  catch (e) { ServerState.isAdmin = null; if (ServerState.session) ServerState.adminErr = e.message; else { ServerState.msg = e.message; ServerState.msgKind = 'bad'; } }
  srvPaint();
}
async function srvLogin() {
  const email = document.getElementById('srvEmail')?.value.trim(), pass = document.getElementById('srvPass')?.value || '';
  if (!email || !pass) return srvMsg('Email और password दोनों भरें।', 'bad');
  ServerState.busy = true; ServerState.msg = ''; srvPaint();
  try { await Server.login(email, pass); ServerState.busy = false; srvPaint(); await srvCheckAdmin(); }
  catch (e) { ServerState.busy = false; srvMsg(e.message, 'bad'); }
}
async function srvLogout() { await Server.logout(); ServerState.msg = 'Logout हो गया।'; ServerState.msgKind = ''; srvPaint(); }
function srvSelectedModules() { return Array.from(document.querySelectorAll('#srvSheet .srv-mod:checked'), x => x.value); }
async function srvCheck() {
  const ids = srvSelectedModules(); if (!ids.length) return srvMsg('कम से कम एक topic चुनें।', 'bad');
  if (isPristineDemo()) return srvMsg('रुकिए: इस ऐप में अभी सिर्फ़ demo सवाल हैं, आपका असली data नहीं। पहले "💾 Backup & Restore" से अपना backup वापस लाएँ, फिर भेजें — वरना demo सवाल server पर चले जाएँगे।', 'bad');
  ServerState.busy = true; ServerState.msg = ''; srvPaint();
  try { ServerState.plan = await srvBuildPlan(ids); const t = ServerState.plan.totals; ServerState.msg = `जाँच पूरी: ${t.new} नए, ${t.changed} बदले, ${t.same} पहले जैसे${t.skipped ? `, ${t.skipped} रुके (नीचे देखें)` : ''}।`; ServerState.msgKind = t.skipped || t.conflict ? 'warn' : 'good'; }
  catch (e) { ServerState.plan = null; ServerState.msg = e.message; ServerState.msgKind = 'bad'; }
  ServerState.busy = false; ServerState.progress = ''; srvPaint();
}
async function srvSend() {
  const p = ServerState.plan; if (!p) return;
  if (Date.now() - p.builtAt > 10 * 60 * 1000) { ServerState.plan = null; return srvMsg('जाँच पुरानी हो गई — दोबारा "जाँचें" दबाएँ।', 'warn'); }
  const hide = !!document.getElementById('srvHide')?.checked;
  ServerState.busy = true; ServerState.msg = ''; srvPaint();
  try {
    const r = await srvRunPlan(p, hide);
    ServerState.plan = null;
    ServerState.msg = `✅ भेज दिया: ${r.sent} सवाल${r.hidden ? `, ${r.hidden} छिपाए` : ''}। अब students को ये server से मिलेंगे।`; ServerState.msgKind = 'good';
  } catch (e) { ServerState.msg = 'भेजना पूरा नहीं हुआ: ' + e.message + ' — दोबारा "जाँचें" और "भेजें" दबाएँ; जो जा चुका है वह दोहराया नहीं जाएगा।'; ServerState.msgKind = 'bad'; ServerState.plan = null; }
  ServerState.busy = false; ServerState.progress = ''; srvPaint();
}
