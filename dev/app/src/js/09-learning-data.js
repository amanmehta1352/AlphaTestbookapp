/* =========================================================================
   V2.4.0 — Update 4 · Stage A: one source of truth for learning data
   ========================================================================= */
const SJ_TIME_CAP_SEC = 600; // never count more than 10 minutes on one question (idle phone)
let LearningStatsCache = { key: '', value: null };
function learningStats(ws = WorkspaceManager.current().id) {
  const last = AttemptHistory[AttemptHistory.length - 1];
  const key = ws + '|' + AttemptHistory.length + '|' + (last ? last.ts : '');
  if (LearningStatsCache.key === key) return LearningStatsCache.value;
  const byModule = new Map(), bySubject = new Map(), byDay = new Map(), unique = new Set();
  let answered = 0, correct = 0, sec = 0;
  const bump = (map, k, init, a) => {
    const x = map.get(k) || init();
    x.answered++; if (a.correct) x.correct++;
    const s = Number(a.sec); if (Number.isFinite(s) && s > 0) x.sec += Math.min(SJ_TIME_CAP_SEC, s);
    map.set(k, x); return x;
  };
  AttemptHistory.forEach(a => {
    if (a.ws !== ws) return;
    answered++; if (a.correct) correct++;
    const s = Number(a.sec); if (Number.isFinite(s) && s > 0) sec += Math.min(SJ_TIME_CAP_SEC, s);
    if (a.cid) unique.add(a.cid);
    const m = bump(byModule, a.moduleId || '?', () => ({ moduleId: a.moduleId, subject: a.subject, topic: a.topic, answered: 0, correct: 0, sec: 0, recent: [] }), a);
    m.recent.push(!!a.correct); if (m.recent.length > 30) m.recent.shift();
    bump(bySubject, a.subject || 'subject', () => ({ subject: a.subject, answered: 0, correct: 0, sec: 0 }), a);
    bump(byDay, a.day || '', () => ({ day: a.day, answered: 0, correct: 0, sec: 0 }), a);
  });
  const value = { ws, answered, correct, sec, unique, byModule, bySubject, byDay };
  LearningStatsCache = { key, value };
  return value;
}
const MASTERY_MIN_ANSWERS = 10;
function masteryLevelFor(score) { return score < 0.4 ? 'weak' : score < 0.7 ? 'learning' : score < 0.85 ? 'good' : 'mastered'; }
// Mastery = accuracy of the latest 30 answers in that topic, shown only after 10 answers.
function masteryFor(moduleId) {
  const m = learningStats().byModule.get(moduleId);
  const answered = m ? m.answered : 0;
  if (!m || answered < MASTERY_MIN_ANSWERS) return { moduleId, answered, enough: false, score: null, level: 'none' };
  const score = m.recent.filter(Boolean).length / m.recent.length;
  return { moduleId, answered, enough: true, score, level: masteryLevelFor(score) };
}
function masteryBadgeHtml(moduleId) {
  const x = masteryFor(moduleId);
  if (!x.enough) return `<span class="mastery-badge none" title="Mastery appears after ${MASTERY_MIN_ANSWERS} answers">${x.answered}/${MASTERY_MIN_ANSWERS} answers</span>`;
  return `<span class="mastery-badge ${x.level}">${x.level} · ${Math.round(x.score * 100)}%</span>`;
}
function questionHistoryFor(cid) {
  const ws = WorkspaceManager.current().id;
  const a = AttemptHistory.filter(x => x.ws === ws && x.cid === String(cid || ''));
  return { n: a.length, correct: a.filter(x => x.correct).length };
}

/* ---------- PYQ source status ---------- */
function pyqStatusOf(q) {
  const m = q?.metadata || {};
  const t = String(m.sourceType || q?.sourceType || '').toUpperCase().trim();
  if (/^(PYQ|PREVIOUS_YEAR_QUESTION|OFFICIAL_PYQ)$/.test(t) || m.isPYQ === true || m.isPyq === true) return 'PYQ';
  if (/^(PRACTICE|NOT_PYQ|MOCK|SAMPLE)$/.test(t)) return 'NOT_PYQ';
  return 'UNCONFIRMED';
}
function normalizeSourceType(raw) {
  const t = String(raw || '').toUpperCase().trim().replace(/[\s-]+/g, '_');
  if (!t) return '';
  if (/^(PYQ|PREVIOUS_YEAR|PREVIOUS_YEAR_QUESTION|OFFICIAL_PYQ)$/.test(t)) return 'PYQ';
  return 'PRACTICE';
}

/* ---------- Learn: real concept check from this topic ---------- */
let LearnCheckState = {};
function learnPickQuestion(mod, excludeId) {
  const qs = (mod.groups || []).flatMap(g => g.questions || []).filter(q => QuestionUI.getFormat(q) !== 'SUBJECTIVE' && Array.isArray(q.options) && q.options.length && q.answer);
  if (!qs.length) return null;
  const pool = qs.length > 1 ? qs.filter(q => String(q.canonicalQId) !== String(excludeId)) : qs;
  return pool[Math.floor(Math.random() * pool.length)];
}
function learnConceptCheckHtml(mod) {
  let st = LearnCheckState[mod.moduleId];
  let q = st ? (mod.groups || []).flatMap(g => g.questions || []).find(x => String(x.canonicalQId) === st.qid) : null;
  if (!q) { q = learnPickQuestion(mod); if (!q) return `<div class="card-btn"><strong>No questions in this topic yet</strong><small>Import questions to get a concept check here.</small></div>`; st = LearnCheckState[mod.moduleId] = { qid: String(q.canonicalQId), answer: '' }; }
  const done = !!st.answer;
  const opts = q.options.map(o => {
    const L = String(o.letter || '').toUpperCase();
    const cls = done ? (L === String(q.answer).toUpperCase() ? 'lc-opt ok' : (L === st.answer ? 'lc-opt bad' : 'lc-opt')) : 'lc-opt';
    return `<button type="button" class="${cls}" ${done ? 'disabled' : ''} onclick="learnCheckAnswer(${nbJsAttr(mod.moduleId)}, '${escapeHtml(L)}')"><span class="opt-circle">${escapeHtml(L)}</span><span>${escapeHtml(o.en || o.hi || '')}${o.hi && o.hi !== o.en ? `<small>${escapeHtml(o.hi)}</small>` : ''}</span></button>`;
  }).join('');
  return `<div class="card-btn lc-card">
    <div style="font-size:14px;font-weight:800;line-height:1.5;">${escapeHtml(q.QUESTION_EN || q.QUESTION_HI || '')}</div>
    ${q.QUESTION_EN && q.QUESTION_HI ? `<div style="font-size:13px;color:var(--text-muted);margin-top:4px;line-height:1.5;">${escapeHtml(q.QUESTION_HI)}</div>` : ''}
    <div class="lc-opts">${opts}</div>
    ${done ? `<div class="feedback-box ${st.answer === String(q.answer).toUpperCase() ? 'correct' : 'wrong'}"><b>${st.answer === String(q.answer).toUpperCase() ? '✅ Correct' : '❌ Not quite — correct answer: ' + escapeHtml(q.answer)}</b>${q.EXPLANATION ? `<div style="margin-top:6px;">${escapeHtml(q.EXPLANATION)}</div>` : ''}</div>
      <button type="button" class="btn-nav" style="margin-top:10px;" onclick="learnNextCheck(${nbJsAttr(mod.moduleId)})">Another question →</button>` : '<p class="sj-note sj-muted">Pick an answer. This is a real question from this topic.</p>'}
  </div>`;
}
function learnCheckAnswer(moduleId, letter) {
  const st = LearnCheckState[moduleId]; const mod = getWorkspaceModule(moduleId);
  if (!st || !mod || st.answer) return;
  const q = (mod.groups || []).flatMap(g => g.questions || []).find(x => String(x.canonicalQId) === st.qid);
  if (!q) return;
  st.answer = String(letter).toUpperCase();
  try { LearningHistory.recordPractice(q, mod, st.answer, null, 'learn'); } catch (e) { console.warn(e); }
  renderView();
}
function learnNextCheck(moduleId) {
  const mod = getWorkspaceModule(moduleId); if (!mod) return;
  const q = learnPickQuestion(mod, LearnCheckState[moduleId]?.qid);
  LearnCheckState[moduleId] = q ? { qid: String(q.canonicalQId), answer: '' } : null;
  renderView();
}

/* ---------- Topic hub: real subtopics ---------- */
function topicSubtopics(mod) {
  const m = new Map();
  (mod.groups || []).flatMap(g => g.questions || []).forEach(q => {
    const raw = String(q.metadata?.subtopic || q.SUB_TOPIC || '').trim();
    const label = !raw || /^general subtopic$/i.test(raw) ? 'General' : raw;
    const x = m.get(label) || { label, count: 0, numerical: 0, theory: 0, ids: [] };
    x.count++; if (q.metadata?.theoryOrNumerical === 'THEORY') x.theory++; else x.numerical++;
    x.ids.push(String(q.canonicalQId || ''));
    m.set(label, x);
  });
  return [...m.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
function topicSubtopicCardsHtml(mod) {
  const ws = WorkspaceManager.current().id;
  const seen = new Set(AttemptHistory.filter(a => a.ws === ws && a.moduleId === mod.moduleId).map(a => a.cid));
  const subs = topicSubtopics(mod);
  return subs.map(s => {
    const done = s.ids.filter(id => seen.has(id)).length;
    return `<div class="card-btn" onclick="navigate('subtopic', {moduleId:${nbJsAttr(mod.moduleId)}, subtopic:${nbJsAttr(s.label)}})">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;"><strong>${escapeHtml(s.label)}</strong><span class="tax-badge theory">${s.count} Q</span></div>
      <small>${s.numerical} numerical · ${s.theory} theory · you have tried ${done} of ${s.count}</small>
    </div>`;
  }).join('');
}

/* ---------- Mastery page (evidence based) ---------- */
function renderMasteryPage(v) {
  const mods = WorkspaceManager.filterModules(AppModules || []).filter(m => sjModuleQuestionCount(m) > 0);
  const rows = mods.map(m => ({ m, x: masteryFor(m.moduleId) })).sort((a, b) => (b.x.enough - a.x.enough) || ((a.x.score ?? 2) - (b.x.score ?? 2)) || b.x.answered - a.x.answered);
  const counts = { weak: 0, learning: 0, good: 0, mastered: 0, none: 0 };
  rows.forEach(r => counts[r.x.level]++);
  v.innerHTML = `
    <div class="nav-breadcrumb"><button onclick="navigate('home')">Home</button><span class="sep">/</span><button onclick="navigate('revision_hub')">Revision</button><span class="sep">/</span><span>Mastery</span></div>
    <div class="section-title"><span>🎯 MASTERY BY TOPIC</span><button class="btn-action-sm" onclick="navigate('home')">← Home</button></div>
    <div class="card-btn" style="margin-bottom:12px;cursor:default;">
      <div class="ms-levels"><span class="mastery-badge weak">Weak ${counts.weak}</span><span class="mastery-badge learning">Learning ${counts.learning}</span><span class="mastery-badge good">Good ${counts.good}</span><span class="mastery-badge mastered">Mastered ${counts.mastered}</span><span class="mastery-badge none">Not enough data ${counts.none}</span></div>
      <small style="margin-top:8px;">Mastery = accuracy of your latest 30 answers in a topic. It appears after ${MASTERY_MIN_ANSWERS} answers. Weak &lt;40% · Learning 40–69% · Good 70–84% · Mastered ≥85%.</small>
    </div>
    <div class="grid-cards">${rows.map(({ m, x }) => `
      <button type="button" class="card-btn" onclick="navigate('topic', {moduleId:${nbJsAttr(m.moduleId)}})">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;"><strong>${escapeHtml(m.topicTitle || m.topic)}</strong>${masteryBadgeHtml(m.moduleId)}</div>
        <div style="font-size:22px; font-weight:900; color:var(--primary); margin:6px 0;">${x.enough ? Math.round(x.score * 100) + '%' : '—'}</div>
        <small>${escapeHtml(subjectDisplayName(m.subject))} · ${x.answered} answer${x.answered === 1 ? '' : 's'} so far${x.enough ? '' : ` · ${MASTERY_MIN_ANSWERS - x.answered} more needed`}</small>
      </button>`).join('') || '<div class="card-btn"><strong>No topics yet</strong><small>Import questions to start.</small></div>'}
    </div>`;
}

/* ---------- Class: honest state ---------- */
function renderClassEngine(v, moduleId) {
  const mod = getWorkspaceModule(moduleId);
  if (!mod) return navigate('home');
  v.innerHTML = `
    <div class="nav-breadcrumb"><button onclick="navigate('home')">Home</button><span class="sep">/</span><button onclick="navigate('topic', {moduleId:${nbJsAttr(mod.moduleId)}})">${escapeHtml(mod.topicTitle)}</button><span class="sep">/</span><span>Class</span></div>
    <div class="section-title"><span>🎥 CLASS — ${escapeHtml(String(mod.topicTitle).toUpperCase())}</span><button class="btn-action-sm" onclick="navigate('topic', {moduleId:${nbJsAttr(mod.moduleId)}})">← Topic Hub</button></div>
    <div class="sj-empty" style="padding:18px;"><strong>No lecture video for this topic yet</strong><span>Lecture videos are not part of this app's question data. You can learn this topic from its notes and real questions instead.</span>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;"><button type="button" class="btn-nav primary" onclick="navigate('learn', {moduleId:${nbJsAttr(mod.moduleId)}})">📖 Open notes</button><button type="button" class="btn-nav" onclick="navigate('practice', {moduleId:${nbJsAttr(mod.moduleId)}, qIndex:0})">✍️ Practice</button></div></div>`;
}

/* ---------- PYQ archive per topic (only marked PYQ) ---------- */
function renderPYQEngine(v, moduleId) {
  const mod = getWorkspaceModule(moduleId);
  if (!mod) return navigate('home');
  const all = (mod.groups || []).flatMap(g => g.questions || []);
  const pyq = all.map((q, idx) => ({ q, idx })).filter(x => pyqStatusOf(x.q) === 'PYQ');
  const unconfirmed = all.filter(q => pyqStatusOf(q) === 'UNCONFIRMED').length;
  v.innerHTML = `
    <div class="nav-breadcrumb"><button onclick="navigate('home')">Home</button><span class="sep">/</span><button onclick="navigate('topic', {moduleId:${nbJsAttr(mod.moduleId)}})">${escapeHtml(mod.topicTitle)}</button><span class="sep">/</span><span>PYQ</span></div>
    <div class="section-title"><span>🎯 PYQ — ${escapeHtml(mod.topicTitle)} (${pyq.length})</span><button class="btn-action-sm" onclick="navigate('topic', {moduleId:${nbJsAttr(mod.moduleId)}})">← Topic Hub</button></div>
    ${unconfirmed ? `<div class="dc-health warn" style="margin-bottom:10px;">${unconfirmed} question(s) in this topic are not marked as PYQ or practice yet. <button type="button" class="sj-inline-link" onclick="DataControlView.filter='UNCONFIRMED';openDataControlModal()">Mark them in Data Control</button></div>` : ''}
    ${pyq.length ? `<div class="grid-cards">${pyq.slice(0, 60).map(({ q, idx }) => { const h = questionHistoryFor(q.canonicalQId); return `
      <button type="button" class="card-btn" onclick="navigate('practice', {moduleId:${nbJsAttr(mod.moduleId)}, qIndex:${idx}})">
        <div style="display:flex; justify-content:space-between; gap:8px; margin-bottom:4px;"><strong>Q.${escapeHtml(q.originalQNo)} • ${escapeHtml(q.metadata?.year || q.year || '')}</strong><span class="tax-badge exam">${h.n ? `You: ${h.correct}/${h.n} correct` : 'Not tried yet'}</span></div>
        <div style="font-size:13px; font-weight:600; color:var(--text-main); margin:6px 0; line-height:1.4;">${escapeHtml(q.QUESTION_EN || q.QUESTION_HI || '')}</div>
        <small>📌 ${escapeHtml(q.examInfo || q.metadata?.exam || 'Exam')}${q.metadata?.shift ? ' · ' + escapeHtml(q.metadata.shift) : ''}</small>
      </button>`; }).join('')}</div>${pyq.length > 60 ? `<p class="sj-note sj-muted">Showing first 60 of ${pyq.length}.</p>` : ''}`
      : `<div class="sj-empty"><strong>No questions marked as PYQ in this topic</strong><span>Mark real previous-year questions in Data Control, or add <b>SOURCE_TYPE: PYQ</b> to them when importing.</span></div>`}`;
}

/* ---------- Data Control: PYQ marking + exam/year repair ---------- */
let DataControlView = { filter: 'ALL', term: '' };
function dcOwnerMap() {
  const map = new Map();
  (AppModules || []).forEach(m => (m.groups || []).forEach(g => (g.questions || []).forEach(q => { const id = String(q.canonicalQId || ''); if (id && !map.has(id)) map.set(id, m); })));
  return map;
}
function dcIsMismatch(q, owner) {
  if (!owner) return false;
  const m = q.metadata || {};
  const qe = String(m.examId || '').toLowerCase(), qy = String(m.year || '');
  const me = String(owner.examId || '').toLowerCase(), my = String(owner.examYear || '');
  return !!((qe && me && qe !== me) || (qy && my && qy !== my));
}
function dcSelectedIds() { return [...new Set(Array.from(document.querySelectorAll('.dc-check:checked'), x => String(x.value || '').trim()).filter(Boolean))]; }
async function dcApplyToSelected(kind) {
  const ids = dcSelectedIds();
  if (!ids.length) { dcShowStatus('Select questions first (tick the boxes).', 'warn'); return; }
  const owners = dcOwnerMap();
  const ws = WorkspaceManager.current();
  const targets = ids.map(id => IndexEngine.registry.get(id)).filter(q => q && owners.get(String(q.canonicalQId))?.workspaceId === ws.id);
  if (targets.length !== ids.length) { dcShowStatus('Some selected questions are not in this workspace. Nothing was changed.', 'bad'); return; }
  const label = { pyq: 'mark as PYQ', practice: 'mark as practice (not PYQ)', clear: 'clear the PYQ mark', fixctx: "set exam/year to their topic's exam/year" }[kind];
  if (!confirm(`${targets.length} question(s): ${label}?`)) return;
  try {
    let changed = 0;
    await DataCore.mutate('Data Control: ' + label, mods => {
    const byId = DataCore.questionsById(mods, ws);
    ids.map(id => byId.get(id)?.q).filter(Boolean).forEach(q => {
      q.metadata = q.metadata || {};
      if (kind === 'pyq') { q.metadata.sourceType = 'PYQ'; changed++; }
      if (kind === 'practice') { q.metadata.sourceType = 'PRACTICE'; changed++; }
      if (kind === 'clear') { delete q.metadata.sourceType; changed++; }
      if (kind === 'fixctx') {
        const o = owners.get(String(q.canonicalQId));
        if (o && dcIsMismatch(q, o) && o.examId && o.examYear) {
          q.examInfo = sbExamName(o.examId); q.year = String(o.examYear);
          ['EXAM_NAME', 'EXAM', 'YEAR'].forEach(k => { if (k in q) delete q[k]; });
          changed++;
        }
      }
    });
    });
    openDataControlModal();
    dcShowStatus(`✓ ${changed} question(s) updated.`, 'good');
  } catch (e) {
    openDataControlModal();
    dcShowStatus('Change blocked; previous data kept. ' + (e.message || e), 'bad');
  }
}
// Status inside the Data Control sheet (a toast would replace the sheet).
function dcShowStatus(text, kind) {
  const el = document.getElementById('dcStatus');
  if (!el) return;
  el.className = 'dc-health ' + (kind || 'good');
  el.textContent = text; el.hidden = false;
}
function dcSelectAllVisible(on) { document.querySelectorAll('#dcList .dc-check').forEach(c => { c.checked = !!on; }); dcUpdateSelCount(); }
function dcUpdateSelCount() { const el = document.getElementById('dcSelCount'); if (el) el.textContent = String(dcSelectedIds().length); }
function openDataControlModal() {
  closeDrawer();
  const ws = WorkspaceManager.current();
  const owners = dcOwnerMap();
  const allItems = Array.from(IndexEngine.registry.values()).filter(q => owners.get(String(q.canonicalQId))?.workspaceId === ws.id);
  const audit = runDataIntegrityAudit(); const history = getImportHistory();
  const healthClass = audit.healthy ? 'good' : ((audit.duplicateIds.length + audit.missingStem.length + audit.malformedOptions.length + audit.missingPath.length + audit.orphanCount) < 5 ? 'warn' : 'bad');
  const pc = { PYQ: 0, NOT_PYQ: 0, UNCONFIRMED: 0 }; let mism = 0;
  allItems.forEach(q => { pc[pyqStatusOf(q)]++; if (dcIsMismatch(q, owners.get(String(q.canonicalQId)))) mism++; });
  const F = DataControlView.filter;
  const pill = (id, label) => `<button class="filter-pill ${F === id ? 'active' : ''}" data-dc-filter="${id}">${label}</button>`;
  openModal('🛡️ ALL DATA CONTROL', `
    <div class="data-control-dashboard">
      <div class="dc-metric"><b>${allItems.length}</b><span>QUESTIONS (THIS WORKSPACE)</span></div>
      <div class="dc-metric"><b>${pc.PYQ}</b><span>MARKED PYQ</span></div>
      <div class="dc-metric"><b>${pc.UNCONFIRMED}</b><span>NOT MARKED</span></div>
      <div class="dc-metric"><b>${mism}</b><span>EXAM/YEAR MISMATCH</span></div>
    </div>
    <div class="dc-health ${healthClass}">
      ${audit.healthy ? '🟢 DATA HEALTH: CLEAN — no duplicate IDs, missing stems, malformed options, missing paths or orphan questions.' :
      `🟠 DATA HEALTH: ATTENTION — Duplicate IDs: ${audit.duplicateIds.length} • Missing stems: ${audit.missingStem.length} • Bad options: ${audit.malformedOptions.length} • Missing paths: ${audit.missingPath.length} • Orphans: ${audit.orphanCount}`}
    </div>
    <div class="dc-toolbar">
      <input id="dcSearch" class="search-input" placeholder="Search Q.No, question, topic, exam, path…" value="${escapeHtml(DataControlView.term)}">
      <button class="btn-action-sm" onclick="runAndShowDataAudit()">🔍 Audit</button>
      <button class="btn-action-sm" onclick="closeModal();openHealthCheck()">🩺 Health</button>
      <button class="btn-action-sm" onclick="closeModal();openCleanup()">🧹 सफ़ाई</button>
      <button class="btn-action-sm" onclick="closeModal();openBackupCenter()">💾 Backup</button>
      <button class="btn-action-sm" onclick="downloadDataSnapshot()">💾 Snapshot</button>
      <button class="btn-action-sm" style="color:var(--danger); border-color:var(--danger);" onclick="undoLastImportUI()">⏪ Undo Last Import</button>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
      ${pill('ALL', 'ALL')}${pill('PYQ', `PYQ ✓ (${pc.PYQ})`)}${pill('NOT_PYQ', `PRACTICE (${pc.NOT_PYQ})`)}${pill('UNCONFIRMED', `NOT MARKED (${pc.UNCONFIRMED})`)}${pill('MISMATCH', `EXAM/YEAR MISMATCH (${mism})`)}${pill('BILINGUAL', 'BILINGUAL')}${pill('NUMERICAL', 'NUMERICAL')}${pill('THEORY', 'THEORY')}${pill('HARD', 'HARD')}${pill('MISSING', 'NEEDS CHECK')}
    </div>
    <div class="dc-bulk">
      <div class="dc-bulk-head"><b>Selected: <span id="dcSelCount">0</span></b><span><button class="btn-action-sm" onclick="dcSelectAllVisible(true)">Select all shown</button><button class="btn-action-sm" onclick="dcSelectAllVisible(false)">Clear</button></span></div>
      <div class="dc-bulk-actions">
        <button class="btn-action-sm" onclick="dcApplyToSelected('pyq')">🎯 Mark PYQ</button>
        <button class="btn-action-sm" onclick="dcApplyToSelected('practice')">✍️ Mark practice</button>
        <button class="btn-action-sm" onclick="dcApplyToSelected('clear')">↺ Clear mark</button>
        <button class="btn-action-sm" onclick="dcApplyToSelected('fixctx')">🔧 Fix exam/year</button>
        <button class="btn-action-sm" style="color:var(--danger);" onclick="deleteSelectedQuestions()">🗑️ Delete</button>
      </div>
      <p class="sj-note sj-muted">PYQ Test uses only questions marked PYQ. "Fix exam/year" sets a question's exam and year to its topic's, so it can be used in exam-specific tests.</p>
    </div>
    <div id="dcStatus" class="dc-health good" role="status" hidden></div>
    <div id="dcList"></div>
  `);
  const apply = () => {
    const term = (document.getElementById('dcSearch')?.value || '').toLowerCase();
    DataControlView.term = term;
    const f = DataControlView.filter;
    const items = allItems.filter(q => {
      const m = q.metadata || {}, hay = [q.originalQNo, q.QUESTION_EN, q.QUESTION_HI, m.topic, m.exam, q.canonicalPath, q.examPath].join(' ').toLowerCase();
      if (term && !hay.includes(term)) return false;
      if (f === 'PYQ' || f === 'NOT_PYQ' || f === 'UNCONFIRMED') return pyqStatusOf(q) === f;
      if (f === 'MISMATCH') return dcIsMismatch(q, owners.get(String(q.canonicalQId)));
      if (f === 'BILINGUAL') return m.language === 'BILINGUAL';
      if (f === 'NUMERICAL') return m.theoryOrNumerical === 'NUMERICAL';
      if (f === 'THEORY') return m.theoryOrNumerical === 'THEORY';
      if (f === 'HARD') return m.difficulty === 'HARD';
      if (f === 'MISSING') return !(q.QUESTION_EN || q.QUESTION_HI) || !Array.isArray(q.options) || q.options.length !== 4 || !q.canonicalPath;
      return true;
    });
    document.getElementById('dcList').innerHTML = renderDataControlRows(items.slice(0, 300)) + (items.length > 300 ? `<p class="sj-note sj-muted">Showing first 300 of ${items.length}. Use search or filters to narrow.</p>` : '');
    dcUpdateSelCount();
  };
  document.getElementById('dcSearch').oninput = apply;
  document.getElementById('dcList').addEventListener('change', e => { if (e.target.classList.contains('dc-check')) dcUpdateSelCount(); });
  document.querySelectorAll('[data-dc-filter]').forEach(btn => btn.onclick = () => { DataControlView.filter = btn.dataset.dcFilter; document.querySelectorAll('[data-dc-filter]').forEach(x => x.classList.toggle('active', x === btn)); apply(); });
  apply();
}
