/* =========================================================================
   ADMIN STUDIO (V2.11.0, S1) — served at /admin/ from the same source.
   The admin works straight on the server: import a file → questions go in
   as Draft → review → Publish. Students see only Published questions.
   Nothing here touches the phone's saved app data: the studio keeps its
   data in memory only and never calls initApp / AppStorage.
   ========================================================================= */
const STUDIO_STATUS = { draft: { icon: '📝', label: 'Draft', hi: 'कच्चा' }, reviewed: { icon: '👀', label: 'Reviewed', hi: 'जाँचा' }, published: { icon: '✅', label: 'Published', hi: 'students को दिखता' } };
var Studio = { tab: 'home', topics: [], exams: new Map(), qIndex: [], loadedAt: 0, busy: false, msg: '', msgKind: '', progress: '',
  review: { topicId: '', filter: 'draft', rows: [], loading: false }, imp: { file: null, analysis: null, plan: null, changedToDraft: false } };

function studioEl() { return document.getElementById('studioRoot'); }
function studioSetMsg(text, kind = '') { Studio.msg = text; Studio.msgKind = kind; studioPaint(); }
function studioLoginUrl() { return `${ServerConfig.url}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(location.origin + location.pathname)}`; }

async function studioBoot() {
  document.body.classList.add('studio-mode');
  document.title = 'TestBook Admin Studio';
  if (!studioEl()) { const r = document.createElement('div'); r.id = 'studioRoot'; document.body.prepend(r); }
  AppModules = []; ImportHistory = [];
  try { WorkspaceManager.set(WorkspaceManager.DEFAULT, false); } catch (_) {}
  Server.loadSession();
  try { await cloudFinishRedirect(); } catch (_) {}
  if (CloudState.msg && CloudState.msgKind === 'bad') { Studio.msg = CloudState.msg; Studio.msgKind = 'bad'; }
  studioPaint();
  if (!ServerState.session) return;
  try {
    const ok = await Server.checkAdmin();
    if (!ok) { studioPaint(); return; }
    await studioLoad();
  } catch (e) { Studio.msg = e.message; Studio.msgKind = 'bad'; studioPaint(); }
}

async function studioLoad() {
  Studio.busy = true; Studio.progress = 'Server से data ला रहे हैं…'; studioPaint();
  try {
    const [exams, topics, qs] = await Promise.all([
      cloudPullAll('exams', 'id,name', 'id'),
      cloudPullAll('topics', 'id,subject,chapter,title,exam_id,year,updated_at', 'id'),
      cloudPullAll('questions', 'id,topic_id,status,is_active,solution_status', 'id')
    ]);
    Studio.exams = new Map(exams.map(e => [e.id, e.name]));
    Studio.topics = topics; Studio.qIndex = qs; Studio.loadedAt = Date.now();
  } finally { Studio.busy = false; Studio.progress = ''; studioPaint(); }
}

function studioCounts(rows) {
  const c = { draft: 0, reviewed: 0, published: 0, hidden: 0, total: 0 };
  rows.forEach(r => { c.total++; if (!r.is_active) c.hidden++; else c[r.status || 'published'] = (c[r.status || 'published'] || 0) + 1; });
  return c;
}
function studioTopicStats() {
  const by = new Map();
  Studio.qIndex.forEach(q => { if (!by.has(q.topic_id)) by.set(q.topic_id, []); by.get(q.topic_id).push(q); });
  return Studio.topics.map(t => ({ t, c: studioCounts(by.get(t.id) || []) })).filter(x => x.c.total)
    .sort((a, b) => (b.c.draft + b.c.reviewed) - (a.c.draft + a.c.reviewed) || String(a.t.title).localeCompare(String(b.t.title)));
}

/* ---------- paint ---------- */
function studioPaint() {
  const root = studioEl(); if (!root) return;
  if (document.getElementById('impDef_YEAR')) saveImportDefaults(readImportDefaults()); // keep what was typed across repaints
  const s = ServerState.session;
  const msg = Studio.msg ? `<div class="st-msg ${Studio.msgKind}" role="status">${escapeHtml(Studio.msg)}</div>` : '';
  const prog = Studio.progress ? `<div class="st-msg" role="status">⏳ ${escapeHtml(Studio.progress)}</div>` : '';
  const head = `<header class="st-head"><div><b>🛠️ Admin Studio</b><small>${s ? escapeHtml(s.email || '') : 'TestBook'}</small></div><a class="st-link" href="../">ऐप खोलें ›</a></header>`;
  if (!s) {
    root.innerHTML = `${head}<main class="st-main">${msg}<section class="st-card st-center">
      <h2>Admin login</h2><p>सवाल डालने और publish करने के लिए अपने admin Google account से login करें।</p>
      <a class="st-btn primary" href="${escapeHtml(studioLoginUrl())}">Google से login करें</a>
      <p class="st-note">अगर login के बाद आप ऐप में पहुँच जाएँ, तो कोई बात नहीं — ऐप में login हो चुका होगा। फिर यह Admin Studio दोबारा खोलें।</p></section></main>`;
    return;
  }
  if (ServerState.isAdmin === false) {
    root.innerHTML = `${head}<main class="st-main"><section class="st-card st-center"><h2>अनुमति नहीं</h2><p><b>${escapeHtml(s.email || '')}</b> admin नहीं है। यह जगह सिर्फ़ admin के लिए है।</p><a class="st-btn" href="../">ऐप पर वापस</a></section></main>`;
    return;
  }
  if (ServerState.isAdmin !== true) { root.innerHTML = `${head}<main class="st-main">${msg}${prog || '<div class="st-msg">⏳ जाँच रहे हैं…</div>'}${Studio.msgKind === 'bad' ? '<button class="st-btn" onclick="location.reload()">फिर कोशिश करें</button>' : ''}</main>`; return; }
  const tabs = [['home', '📊', 'सारांश'], ['import', '📥', 'Import'], ['review', '👀', 'Review']];
  const nav = `<nav class="st-tabs" role="tablist">${tabs.map(([id, ic, l]) => `<button role="tab" aria-selected="${Studio.tab === id}" class="${Studio.tab === id ? 'on' : ''}" onclick="studioTab('${id}')">${ic} ${l}</button>`).join('')}</nav>`;
  const body = Studio.tab === 'import' ? studioImportHtml() : Studio.tab === 'review' ? studioReviewHtml() : studioHomeHtml();
  root.innerHTML = `${head}${nav}<main class="st-main">${msg}${prog}${body}</main>`;
}
function studioTab(t) { Studio.tab = t; Studio.msg = ''; if (t === 'review' && Studio.review.topicId && !Studio.review.rows.length) studioLoadTopic(Studio.review.topicId); studioPaint(); window.scrollTo(0, 0); }

/* ---------- home ---------- */
function studioHomeHtml() {
  const c = studioCounts(Studio.qIndex);
  const list = studioTopicStats();
  return `<section class="st-stats">
      <div class="st-stat draft"><b>${c.draft}</b><span>📝 Draft</span></div>
      <div class="st-stat reviewed"><b>${c.reviewed}</b><span>👀 Reviewed</span></div>
      <div class="st-stat published"><b>${c.published}</b><span>✅ Published</span></div>
    </section>
    <p class="st-note">Students को सिर्फ़ ✅ Published सवाल दिखते हैं।${c.hidden ? ` ${c.hidden} सवाल छिपाए गए हैं।` : ''} कुल ${c.total} सवाल, ${list.length} topics।</p>
    <div class="st-row"><button class="st-btn primary" onclick="studioTab('import')">📥 नई file import करें</button><button class="st-btn" onclick="studioLoad()" ${Studio.busy ? 'disabled' : ''}>↻ ताज़ा करें</button></div>
    <h3 class="st-h">Topics</h3>
    <div class="st-list">${list.map(({ t, c }) => `<button class="st-topic" onclick="studioOpenTopic('${escapeHtml(t.id)}')">
      <span><b>${escapeHtml(t.title)}</b><small>${escapeHtml(subjectDisplayName(t.subject))} · ${escapeHtml(t.chapter || '')}${t.exam_id ? ' · ' + escapeHtml(Studio.exams.get(t.exam_id) || t.exam_id) : ''}${t.year ? ' ' + t.year : ''}</small></span>
      <span class="st-pills">${c.draft ? `<i class="draft">📝 ${c.draft}</i>` : ''}${c.reviewed ? `<i class="reviewed">👀 ${c.reviewed}</i>` : ''}<i class="published">✅ ${c.published}</i></span></button>`).join('') || '<p class="st-note">Server पर अभी कोई सवाल नहीं।</p>'}</div>`;
}
function studioOpenTopic(id) {
  const c = studioCounts(Studio.qIndex.filter(q => q.topic_id === id));
  Studio.review = { topicId: id, filter: c.draft ? 'draft' : c.reviewed ? 'reviewed' : 'all', rows: [], loading: false };
  studioTab('review');
}

/* ---------- import: file → check → send as Draft ---------- */
function studioImportHtml() {
  const a = Studio.imp.analysis, p = Studio.imp.plan;
  let review = '';
  if (a) {
    const errs = (a.validationErrors || []).slice(0, 30).map(e => `<li>Block ${e.index} (Q.${escapeHtml(e.qNo ?? '?')}): ${escapeHtml((e.errors || []).join(', '))}</li>`).join('');
    const warns = (a.warnings || []).slice(0, 12).map(w => `<li>${escapeHtml(w)}</li>`).join('');
    const dups = [...(a.duplicateBatch || []), ...(a.duplicateExternal || [])].slice(0, 10).map(d => `<li>${escapeHtml(typeof d === 'string' ? d : (d.message || JSON.stringify(d)))}</li>`).join('');
    review = `<section class="st-card">
      <h3>${escapeHtml(a.topicTitle)}</h3>
      <p class="st-note">${a.totalQuestions} सवाल · ${escapeHtml(subjectDisplayName(a.detectedSubject))} · ${escapeHtml(a.detectedChapter || '')}${a.examId ? ' · ' + escapeHtml(Studio.exams.get(a.examId) || a.examsRegistered?.[0] || a.examId) : ''} ${escapeHtml(a.examYear || '')}</p>
      ${errs ? `<div class="st-msg bad"><b>${a.validationErrors.length} सवालों में गलती — पहले file ठीक करें:</b><ul>${errs}</ul></div>` : ''}
      ${dups ? `<div class="st-msg bad"><b>दोहराए सवाल:</b><ul>${dups}</ul></div>` : ''}
      ${warns ? `<details class="st-det"><summary>${a.warnings.length} सूचनाएँ</summary><ul>${warns}</ul></details>` : ''}
      ${p ? `<div class="st-plan"><span><b>${p.fresh.length}</b>नए → 📝 Draft</span><span><b>${p.changed.length}</b>बदले</span><span><b>${p.same}</b>पहले जैसे</span>${p.skipped.length ? `<span class="bad"><b>${p.skipped.length}</b>रुके</span>` : ''}${p.conflicts.length ? `<span class="bad"><b>${p.conflicts.length}</b>टकराव</span>` : ''}</div>
        ${p.skipped.length || p.conflicts.length ? `<details class="st-det" open><summary>रुके / टकराव</summary><ul>${p.skipped.slice(0, 20).map(x => `<li>Q.${escapeHtml(x.no)}: ${escapeHtml(x.why)}</li>`).join('')}${p.conflicts.slice(0, 20).map(x => `<li>${escapeHtml(x.id)} पहले से topic "${escapeHtml(x.topic)}" में है</li>`).join('')}</ul></details>` : ''}
        ${p.changed.length ? `<label class="st-check"><input type="checkbox" ${Studio.imp.changedToDraft ? 'checked' : ''} onchange="Studio.imp.changedToDraft=this.checked"> <span>बदले हुए ${p.changed.length} सवाल भी 📝 Draft में डालें (students से छिपेंगे जब तक दोबारा publish न करें)। टिक न करें तो उनकी हालत वही रहेगी।</span></label>` : ''}
        <button class="st-btn primary wide" onclick="studioSend()" ${Studio.busy || !(p.fresh.length + p.changed.length) ? 'disabled' : ''}>☁️ Server पर भेजें (${p.fresh.length + p.changed.length})</button>
        ${!(p.fresh.length + p.changed.length) ? '<p class="st-note">भेजने को कुछ नया या बदला नहीं है।</p>' : ''}` : ''}
    </section>`;
  }
  return `<section class="st-card">
      <h3>📥 सवालों की file</h3>
      <label class="st-file"><input type="file" id="stFile" accept=".txt,text/plain" onchange="studioPickFile(this)"><span id="stFileName">${Studio.imp.file ? '📄 ' + escapeHtml(Studio.imp.file.name) + ' · ' + (Studio.imp.file.size / 1024).toFixed(1) + ' KB' : 'File चुनें (.txt)'}</span></label>
      ${renderImportDefaults()}
      <button class="st-btn primary wide" onclick="studioAnalyze()" ${Studio.busy ? 'disabled' : ''}>🔎 जाँचें</button>
      <p class="st-note">जाँच में कुछ नहीं भेजा जाता। नए सवाल server पर <b>📝 Draft</b> बनकर जाते हैं — students को तब तक नहीं दिखते जब तक आप Review में Publish न करें।</p>
    </section>${review}`;
}
function studioPickFile(input) {
  Studio.imp = { file: input.files?.[0] || null, analysis: null, plan: null, changedToDraft: false }; Studio.msg = '';
  studioPaint();
}
async function studioAnalyze() {
  const file = Studio.imp.file;
  if (!file) return studioSetMsg('पहले .txt file चुनें।', 'bad');
  const defaults = readImportDefaults();
  if (defaults.YEAR && !/^(19|20)\d{2}$/.test(defaults.YEAR)) return studioSetMsg(`ऊपर भरा Year "${defaults.YEAR}" सही नहीं (जैसे 2024 लिखें)`, 'bad');
  saveImportDefaults(defaults);
  Studio.busy = true; Studio.msg = ''; Studio.imp = { file, analysis: null, plan: null, changedToDraft: false }; Studio.progress = 'File जाँच रहे हैं…'; studioPaint();
  try {
    // 1st pass finds the topic; then that topic's server questions are loaded so IDs match exactly like a re-import.
    AppModules = [];
    let a = await ImportEngine.analyzeTxt(file, '', defaults);
    const serverRows = await studioTopicRows(a.moduleId, true);
    if (serverRows.length) {
      AppModules = [studioModuleFromRows(a.moduleId, serverRows)];
      a = await ImportEngine.analyzeTxt(file, '', defaults);
    }
    Studio.imp.analysis = a;
    if (a.commitReady) Studio.imp.plan = await studioBuildPlan(a, serverRows);
    Studio.msg = a.commitReady ? 'जाँच पूरी। नीचे देखें, फिर "Server पर भेजें" दबाएँ।' : 'File में गलतियाँ हैं — नीचे देखें।';
    Studio.msgKind = a.commitReady ? 'good' : 'bad';
  } catch (e) { Studio.msg = e.message; Studio.msgKind = 'bad'; }
  finally { AppModules = []; Studio.busy = false; Studio.progress = ''; studioPaint(); }
}
async function studioTopicRows(topicId, full) {
  const cols = full ? 'id,topic_id,exam_id,year,shift,subject,chapter,topic,subtopic,question_no,format,question_en,question_hi,options,answer,explanation_en,explanation_hi,source_type,difficulty,content_hash,status,is_active' : 'id,content_hash,status,is_active';
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const rows = await Server.select('questions', `select=${cols}&topic_id=eq.${encodeURIComponent(topicId)}&order=question_no,id&limit=1000&offset=${offset}`);
    out.push(...(rows || [])); if (!rows || rows.length < 1000) break;
  }
  return out;
}
function studioModuleFromRows(topicId, rows) {
  const ws = WorkspaceManager.current(), t = Studio.topics.find(x => x.id === topicId) || {};
  const qs = rows.map((r, i) => cloudQuestionFromRow(r, Studio.exams.get(r.exam_id), ws, i));
  const mod = { moduleId: topicId, source: 'server', subject: t.subject || rows[0]?.subject, topicTitle: t.title || rows[0]?.topic, chapter: t.chapter || rows[0]?.chapter, examId: t.exam_id || undefined, examYear: t.year ? String(t.year) : undefined, groups: [{ groupId: topicId + '-g01', title: 'G-01', questions: qs }] };
  return WorkspaceManager.stampM(mod, ws);
}
function studioModFromAnalysis(a) {
  return { moduleId: a.moduleId, subject: a.detectedSubject, chapter: a.detectedChapter || 'General', topicTitle: a.topicTitle, examId: a.examId, examYear: a.examYear };
}
async function studioBuildPlan(a, serverRows) {
  const mod = studioModFromAnalysis(a);
  const rows = [], skipped = [];
  a.questions.forEach(q => { const r = srvQuestionRow(q, mod); if (r.problems.length) skipped.push({ no: q.originalQNo, why: r.problems.join(', ') }); else rows.push(r.row); });
  const sMap = new Map(serverRows.map(x => [x.id, x]));
  const unknown = rows.map(r => r.id).filter(i => !sMap.has(i)), elsewhere = new Map();
  for (let i = 0; i < unknown.length; i += 60) {
    const res = await Server.select('questions', `select=id,topic_id&id=in.${srvInList(unknown.slice(i, i + 60))}`);
    (res || []).forEach(x => { if (x.topic_id !== mod.moduleId) elsewhere.set(x.id, x.topic_id); });
  }
  const conflicts = rows.filter(r => elsewhere.has(r.id)).map(r => ({ id: r.id, topic: elsewhere.get(r.id) }));
  const send = rows.filter(r => !elsewhere.has(r.id));
  const fresh = send.filter(r => !sMap.has(r.id));
  const changed = send.filter(r => sMap.has(r.id) && (sMap.get(r.id).content_hash !== r.content_hash || !sMap.get(r.id).is_active));
  const exams = new Map();
  [srvTopicRow(mod).exam_id, ...send.map(r => r.exam_id)].filter(Boolean).forEach(e => { if (!exams.has(e)) exams.set(e, srvExamRow(e, a.questions.find(q => q.metadata?.examId === e)?.metadata?.exam)); });
  return { mod, fresh, changed, same: send.length - fresh.length - changed.length, skipped, conflicts, exams, builtAt: Date.now() };
}
async function studioSend() {
  const a = Studio.imp.analysis, p = Studio.imp.plan; if (!a || !p) return;
  if (Date.now() - p.builtAt > 10 * 60 * 1000) { Studio.imp.plan = null; return studioSetMsg('जाँच पुरानी हो गई — दोबारा "जाँचें" दबाएँ।', 'warn'); }
  const batchId = `STUDIO-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const step = t => { Studio.progress = t; studioPaint(); };
  Studio.busy = true; Studio.msg = ''; studioPaint();
  try {
    step('Exams और topic भेज रहे हैं…');
    await Server.upsert('exams', [...p.exams.values()], 'id');
    await Server.upsert('topics', [srvTopicRow(p.mod)], 'id');
    await Server.upsert('import_batches', [{ id: batchId, file_name: String(a.sourceFile || 'file').slice(0, 120), topic_id: p.mod.moduleId, added: p.fresh.length, changed: p.changed.length, unchanged: p.same, removed: 0 }], 'id');
    const total = p.fresh.length + p.changed.length; let done = 0;
    const sendRows = async (rows, extra) => { for (let i = 0; i < rows.length; i += 200) { const chunk = rows.slice(i, i + 200).map(r => ({ ...r, ...extra, import_batch_id: batchId })); await Server.upsert('questions', chunk, 'id'); done += chunk.length; step(`सवाल भेज रहे हैं… ${done} / ${total}`); } };
    await sendRows(p.fresh, { status: 'draft' });
    await sendRows(p.changed, Studio.imp.changedToDraft ? { status: 'draft' } : {});
    const topicId = p.mod.moduleId, n = p.fresh.length, ch = p.changed.length;
    Studio.imp = { file: null, analysis: null, plan: null, changedToDraft: false };
    await studioLoad();
    Studio.review = { topicId, filter: n ? 'draft' : 'all', rows: [], loading: false }; Studio.tab = 'review';
    await studioLoadTopic(topicId);
    Studio.msg = `✅ भेज दिया: ${n} नए${ch ? `, ${ch} बदले` : ''}। ${n ? 'नीचे जाँचकर Publish करें — तब तक students को नहीं दिखेंगे।' : ''}`; Studio.msgKind = 'good';
  } catch (e) { Studio.msg = 'भेजना पूरा नहीं हुआ: ' + e.message + ' — दोबारा "जाँचें" और "भेजें" दबाएँ; जो जा चुका है वह दोहराया नहीं जाएगा।'; Studio.msgKind = 'bad'; Studio.imp.plan = null; }
  finally { Studio.busy = false; Studio.progress = ''; studioPaint(); }
}

/* ---------- review: draft → reviewed → published ---------- */
async function studioLoadTopic(id) {
  Studio.review.topicId = id; Studio.review.loading = true; Studio.review.rows = []; studioPaint();
  try { Studio.review.rows = await studioTopicRows(id, true); }
  catch (e) { Studio.msg = e.message; Studio.msgKind = 'bad'; }
  finally { Studio.review.loading = false; studioPaint(); }
}
function studioReviewRows() {
  const f = Studio.review.filter;
  return Studio.review.rows.filter(r => f === 'all' || (f === 'hidden' ? !r.is_active : r.is_active && r.status === f));
}
function studioReviewHtml() {
  const list = studioTopicStats();
  const rv = Studio.review;
  const pick = `<label class="st-pick"><span>Topic</span><select onchange="studioPickTopic(this.value)"><option value="">— topic चुनें —</option>${list.map(({ t, c }) => `<option value="${escapeHtml(t.id)}" ${t.id === rv.topicId ? 'selected' : ''}>${escapeHtml(t.title)}${c.draft + c.reviewed ? ` (📝${c.draft} 👀${c.reviewed})` : ''}</option>`).join('')}</select></label>`;
  if (!rv.topicId) return `<section class="st-card">${pick}<p class="st-note">Topic चुनें — उसके सवाल यहाँ दिखेंगे।</p></section>`;
  if (rv.loading) return `<section class="st-card">${pick}</section><div class="st-msg">⏳ सवाल ला रहे हैं…</div>`;
  const c = studioCounts(rv.rows);
  const chips = [['draft', `📝 Draft ${c.draft}`], ['reviewed', `👀 Reviewed ${c.reviewed}`], ['published', `✅ Published ${c.published}`], ['all', `सब ${c.total}`]].concat(c.hidden ? [['hidden', `🙈 छिपे ${c.hidden}`]] : []);
  const rows = studioReviewRows();
  const bulk = rows.length && rv.filter !== 'all' && rv.filter !== 'hidden' ? `<div class="st-bulk"><span>दिख रहे ${rows.length} सवाल:</span>
      ${rv.filter === 'draft' ? `<button class="st-btn" onclick="studioBulk('reviewed')">👀 सब Reviewed</button>` : ''}
      ${rv.filter !== 'published' ? `<button class="st-btn primary" onclick="studioBulk('published')">✅ सब Publish</button>` : `<button class="st-btn" onclick="studioBulk('draft')">📝 सब Draft में (छिपाएँ)</button>`}</div>` : '';
  return `<section class="st-card">${pick}<div class="st-chips">${chips.map(([k, l]) => `<button class="${rv.filter === k ? 'on' : ''}" onclick="Studio.review.filter='${k}';studioPaint()">${l}</button>`).join('')}</div>${bulk}</section>
    <div class="st-qs">${rows.slice(0, 200).map(studioQCard).join('') || '<p class="st-note">इस हिस्से में कोई सवाल नहीं।</p>'}${rows.length > 200 ? `<p class="st-note">पहले 200 दिखाए; बाकी के लिए ऊपर के bulk बटन इस्तेमाल करें।</p>` : ''}</div>`;
}
function studioPickTopic(id) { Studio.review = { topicId: id, filter: 'draft', rows: [], loading: false }; if (id) studioLoadTopic(id); else studioPaint(); }
function studioQCard(r) {
  const st = r.is_active ? (r.status || 'published') : 'hidden';
  const opts = Array.isArray(r.options) ? r.options : [];
  const actions = !r.is_active ? '' : st === 'draft'
    ? `<button class="st-btn sm" onclick="studioSetStatus(['${escapeHtml(r.id)}'],'reviewed')">👀 Reviewed</button><button class="st-btn sm primary" onclick="studioSetStatus(['${escapeHtml(r.id)}'],'published')">✅ Publish</button>`
    : st === 'reviewed' ? `<button class="st-btn sm" onclick="studioSetStatus(['${escapeHtml(r.id)}'],'draft')">↩ Draft</button><button class="st-btn sm primary" onclick="studioSetStatus(['${escapeHtml(r.id)}'],'published')">✅ Publish</button>`
    : `<button class="st-btn sm" onclick="studioSetStatus(['${escapeHtml(r.id)}'],'draft')">↩ Draft में (छिपाएँ)</button>`;
  return `<article class="st-q ${st}">
    <div class="st-q-top"><b>Q.${escapeHtml(r.question_no ?? '?')}</b><span class="st-badge ${st}">${st === 'hidden' ? '🙈 छिपा' : STUDIO_STATUS[st].icon + ' ' + STUDIO_STATUS[st].label}</span>${r.source_type === 'PYQ' ? '<span class="st-badge">PYQ</span>' : ''}<small>${escapeHtml([Studio.exams.get(r.exam_id) || r.exam_id, r.year, r.shift].filter(Boolean).join(' · '))}</small></div>
    ${r.question_en ? `<p class="st-q-text">${escapeHtml(r.question_en)}</p>` : ''}${r.question_hi && r.question_hi !== r.question_en ? `<p class="st-q-text hi">${escapeHtml(r.question_hi)}</p>` : ''}
    <ol class="st-opts">${opts.map(o => `<li class="${o.letter === r.answer ? 'ok' : ''}"><b>${escapeHtml(o.letter)}</b><span>${escapeHtml(o.en || '')}${o.hi && o.hi !== o.en ? `<small>${escapeHtml(o.hi)}</small>` : ''}</span>${o.letter === r.answer ? '<em>✓ उत्तर</em>' : ''}</li>`).join('')}</ol>
    ${r.explanation_en || r.explanation_hi ? `<details class="st-det"><summary>व्याख्या</summary><p>${escapeHtml(r.explanation_en || r.explanation_hi)}</p></details>` : ''}
    <div class="st-q-act">${actions}</div></article>`;
}
async function studioSetStatus(ids, status) {
  if (!ids.length) return;
  Studio.busy = true; Studio.progress = 'बदल रहे हैं…'; studioPaint();
  try {
    for (let i = 0; i < ids.length; i += 60) await Server.patch('questions', `id=in.${srvInList(ids.slice(i, i + 60))}`, { status });
    const set = new Set(ids);
    Studio.review.rows.forEach(r => { if (set.has(r.id)) r.status = status; });
    Studio.qIndex.forEach(r => { if (set.has(r.id)) r.status = status; });
    Studio.msg = `${ids.length} सवाल → ${STUDIO_STATUS[status].icon} ${STUDIO_STATUS[status].label}${status === 'published' ? ' (अब students को दिखेंगे)' : status === 'draft' ? ' (students से छिपे)' : ''}`; Studio.msgKind = 'good';
  } catch (e) { Studio.msg = 'नहीं बदला: ' + e.message; Studio.msgKind = 'bad'; }
  finally { Studio.busy = false; Studio.progress = ''; studioPaint(); }
}
function studioBulk(status) {
  const rows = studioReviewRows(); if (!rows.length) return;
  const t = Studio.topics.find(x => x.id === Studio.review.topicId);
  const what = status === 'published' ? 'Publish करें — students को दिखने लगेंगे' : status === 'draft' ? 'Draft में डालें — students से छिप जाएँगे' : 'Reviewed करें';
  if (!confirm(`"${t?.title || ''}" के ${rows.length} सवाल ${what}?`)) return;
  studioSetStatus(rows.map(r => r.id), status);
}
