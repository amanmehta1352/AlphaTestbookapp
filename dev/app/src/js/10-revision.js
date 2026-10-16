/* =========================================================================
   V2.4.0 — Update 4 · Stage B: real spaced revision, mistake reasons,
   bookmarks, practice filters. New storage key only; existing records kept.
   ========================================================================= */
const REVIEW_STATE_KEY = 'master_student_journey_v90_review_state';
const REVIEW_INTERVALS = [1, 3, 7, 14, 30];
const MISTAKE_REASONS = [
  { id: 'concept', label: 'Concept not clear' },
  { id: 'calc', label: 'Calculation' },
  { id: 'hurry', label: 'Hurry / silly' },
  { id: 'misread', label: 'Misread question' },
  { id: 'time', label: 'Ran out of time' }
];
let ReviewState = { v: 1, cards: {}, reasons: {}, bookmarks: [] };
async function hydrateReviewState() {
  try {
    const r = parseStored(await AppStorage.getRaw(REVIEW_STATE_KEY), null, REVIEW_STATE_KEY);
    if (r && r.v === 1) ReviewState = { v: 1, cards: r.cards || {}, reasons: r.reasons || {}, bookmarks: Array.isArray(r.bookmarks) ? r.bookmarks : [] };
  } catch (e) { console.warn('[Review] state unreadable; starting empty', e); }
}
function saveReviewState() {
  const s = JSON.stringify(ReviewState);
  return StorageWriteQueue.enqueue(() => AppStorage.setRawDirect(REVIEW_STATE_KEY, s)).catch(e => console.warn('[Review] save failed', e));
}
function sjAddDays(day, n) { const d = new Date(day + 'T00:00:00'); d.setDate(d.getDate() + n); return sjLocalDay(d); }

/* ---------- bookmarks ---------- */
function isBookmarked(cid) { const ws = WorkspaceManager.current().id; return ReviewState.bookmarks.some(b => b.cid === String(cid) && b.ws === ws); }
function toggleBookmark(cid) {
  const ws = WorkspaceManager.current().id; const id = String(cid || '');
  if (!id) return;
  const i = ReviewState.bookmarks.findIndex(b => b.cid === id && b.ws === ws);
  if (i >= 0) ReviewState.bookmarks.splice(i, 1); else ReviewState.bookmarks.unshift({ cid: id, ws, ts: new Date().toISOString() });
  saveReviewState();
  renderView();
}
function bookmarkButtonHtml(cid, extraClass = '') {
  const on = isBookmarked(cid);
  return `<button type="button" class="bm-btn ${on ? 'on' : ''} ${extraClass}" aria-pressed="${on}" aria-label="${on ? 'Remove bookmark' : 'Bookmark this question'}" title="${on ? 'Bookmarked' : 'Bookmark'}" onclick="toggleBookmark(${nbJsAttr(cid)})">${on ? '★' : '☆'}</button>`;
}
function bookmarkedIds() { const ws = WorkspaceManager.current().id; return new Set(ReviewState.bookmarks.filter(b => b.ws === ws).map(b => b.cid)); }

/* ---------- mistake keys and reasons ---------- */
function mbKey(m) { return m.canonicalQId ? 'c:' + m.canonicalQId : 'm:' + m.moduleId + '|' + m.qId; }
function mbCid(m) {
  if (m.canonicalQId && IndexEngine.registry.get(String(m.canonicalQId))) return String(m.canonicalQId);
  const mod = getWorkspaceModule(m.moduleId);
  const q = (mod?.groups || []).flatMap(g => g.questions || []).find(x => String(x.originalQNo) === String(m.qId));
  return q ? String(q.canonicalQId || '') : '';
}
function setMistakeReason(key, reason) {
  if (ReviewState.reasons[key] === reason) delete ReviewState.reasons[key]; else ReviewState.reasons[key] = reason;
  saveReviewState(); renderView();
}
function mistakeReasonChipsHtml(m) {
  const key = mbKey(m); const cur = ReviewState.reasons[key];
  return `<div class="mr-chips" role="group" aria-label="Why was this wrong?"><span class="mr-label">Why wrong?</span>${MISTAKE_REASONS.map(r => `<button type="button" class="mr-chip ${cur === r.id ? 'on' : ''}" aria-pressed="${cur === r.id}" onclick="setMistakeReason(${nbJsAttr(key)}, '${r.id}')">${r.label}</button>`).join('')}</div>`;
}
function mistakeReasonSummaryHtml(list) {
  if (!list.length) return '';
  const counts = new Map(MISTAKE_REASONS.map(r => [r.id, 0])); let untagged = 0;
  list.forEach(m => { const r = ReviewState.reasons[mbKey(m)]; if (r && counts.has(r)) counts.set(r, counts.get(r) + 1); else untagged++; });
  const tagged = list.length - untagged;
  if (!tagged) return `<div class="sj-empty" style="margin-bottom:10px;"><strong>Why do you make mistakes?</strong><span>Tag each mistake below with a reason. A chart of your most common reasons appears here.</span></div>`;
  const rows = MISTAKE_REASONS.map(r => ({ label: r.label, value: counts.get(r.id), valueLabel: `${counts.get(r.id)}` })).filter(r => r.value > 0).sort((a, b) => b.value - a.value);
  return `<section class="sj-card" style="margin-bottom:10px;"><div class="sj-card-head"><h2>Why mistakes happen</h2><span class="sj-chip">${tagged} of ${list.length} tagged</span></div><div class="sj-bars">${sjBarRows(rows, Math.max(...rows.map(r => r.value)), null)}</div></section>`;
}

/* ---------- spaced review queue ---------- */
function reviewItems(moduleId = null) {
  const ws = WorkspaceManager.current().id;
  const today = sjLocalDay();
  const items = [];
  (UserState.mistakeBook || []).forEach(m => {
    if (sjIsSeedMistake(m)) return;
    const mod = getWorkspaceModule(m.moduleId); if (!mod) return;
    if (moduleId && m.moduleId !== moduleId) return;
    const cid = mbCid(m); if (!cid) return;
    const q = IndexEngine.registry.get(cid); if (!q || QuestionUI.getFormat(q) === 'SUBJECTIVE') return;
    const key = 'q:' + cid; const st = ReviewState.cards[key];
    items.push({ key, kind: 'q', cid, q, mod, mistake: m, due: st?.due || today, isNew: !st });
  });
  WorkspaceManager.filterModules(AppModules || []).forEach(mod => {
    if (moduleId && mod.moduleId !== moduleId) return;
    (mod.flashcards || []).forEach((fc, i) => {
      if (!fc || !fc.front) return;
      const key = 'fc:' + mod.moduleId + ':' + i; const st = ReviewState.cards[key];
      items.push({ key, kind: 'fc', fc, mod, due: st?.due || today, isNew: !st });
    });
  });
  void ws;
  return items;
}
function reviewDue(moduleId = null) {
  const today = sjLocalDay();
  return reviewItems(moduleId).filter(x => x.due <= today).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'q' ? -1 : 1) || a.due.localeCompare(b.due));
}
function reviewUpcoming(days = 7) {
  const today = sjLocalDay(), end = sjAddDays(today, days);
  return reviewItems().filter(x => x.due > today && x.due <= end).length;
}
function reviewSchedule(key, rating) {
  const st = ReviewState.cards[key] || { box: 0, streak: 0, n: 0 };
  let box = Number(st.box) || 0;
  if (rating === 'hard') box = 0;
  else if (rating === 'okay') box = Math.max(1, box);
  else box = Math.min(REVIEW_INTERVALS.length - 1, Math.max(2, box + 1));
  const days = REVIEW_INTERVALS[box];
  ReviewState.cards[key] = { ...st, box, due: sjAddDays(sjLocalDay(), days), last: new Date().toISOString(), n: (st.n || 0) + 1 };
  return days;
}
let RevisionSession = null;
function revisionStart(moduleId = null) {
  const due = reviewDue(moduleId);
  if (!due.length) { openCustomToast('Nothing is due for revision right now.'); return; }
  RevisionSession = { moduleId, keys: due.map(x => x.key), i: 0, answer: '', revealed: false, shownAt: Date.now(), done: 0, correct: 0, resolved: 0, note: '' };
  renderView();
}
function revisionEnd() { RevisionSession = null; renderView(); }
function revisionCurrent() {
  if (!RevisionSession) return null;
  const key = RevisionSession.keys[RevisionSession.i];
  // Keep the card on screen even if answering it just resolved its mistake.
  if (RevisionSession.cache && RevisionSession.cache.key === key) return RevisionSession.cache;
  const it = reviewItems(RevisionSession.moduleId).find(x => x.key === key) || null;
  RevisionSession.cache = it;
  return it;
}
function revisionAnswer(letter) {
  const it = revisionCurrent(); if (!it || it.kind !== 'q' || RevisionSession.answer) return;
  const L = String(letter).toUpperCase();
  RevisionSession.answer = L; RevisionSession.revealed = true;
  const ok = L === String(it.q.answer || '').toUpperCase();
  try { LearningHistory.recordPractice(it.q, it.mod, L, (Date.now() - RevisionSession.shownAt) / 1000, 'revision'); } catch (e) { console.warn(e); }
  const st = ReviewState.cards[it.key] || { box: 0, streak: 0, n: 0 };
  st.streak = ok ? (Number(st.streak) || 0) + 1 : 0;
  ReviewState.cards[it.key] = st;
  if (ok) RevisionSession.correct++;
  RevisionSession.note = '';
  if (ok && st.streak >= 2) {
    const idx = (UserState.mistakeBook || []).indexOf(it.mistake);
    if (idx >= 0) { UserState.mistakeBook.splice(idx, 1); saveUserState(); RevisionSession.resolved++; RevisionSession.note = '✓ Correct twice in a row — removed from the Mistake Book.'; }
  }
  saveReviewState();
  renderView();
}
function revisionReveal() { if (RevisionSession) { RevisionSession.revealed = true; renderView(); } }
function revisionRate(rating) {
  const it = revisionCurrent(); if (!it) { revisionSkip(); return; }
  if (it.kind === 'q' && RevisionSession.answer && RevisionSession.answer !== String(it.q.answer || '').toUpperCase()) rating = 'hard';
  reviewSchedule(it.key, rating);
  saveReviewState();
  RevisionSession.done++;
  revisionSkip();
}
function revisionSkip() {
  if (!RevisionSession) return;
  RevisionSession.i++; RevisionSession.answer = ''; RevisionSession.revealed = false; RevisionSession.shownAt = Date.now(); RevisionSession.note = RevisionSession.i < RevisionSession.keys.length ? RevisionSession.note : RevisionSession.note;
  renderView();
}
function revisionCardHtml() {
  const S = RevisionSession;
  const total = S.keys.length;
  if (S.i >= total) {
    return `<section class="rv-card rv-done"><div class="rv-emoji" aria-hidden="true">🎉</div><h2>Revision done</h2><p>${S.done} reviewed · ${S.correct} correct${S.resolved ? ` · ${S.resolved} removed from the Mistake Book` : ''}</p><p class="sj-note sj-muted">Next reviews are scheduled automatically (1, 3, 7, 14, 30 days).</p><div class="rs-actions"><button type="button" class="btn-nav primary" onclick="revisionEnd()">Back to revision</button><button type="button" class="btn-nav" onclick="RevisionSession=null;navigate('home')">Home</button></div></section>`;
  }
  const it = revisionCurrent();
  if (!it) { setTimeout(revisionSkip, 0); return ''; }
  const head = `<div class="rv-head"><span>${S.i + 1} / ${total}</span><span>${escapeHtml(it.mod.topicTitle || '')}</span><button type="button" class="sb-link" onclick="revisionEnd()">End</button></div><div class="rv-progress" aria-hidden="true"><span style="width:${Math.round(S.i / total * 100)}%"></span></div>`;
  const rateRow = (allowAll) => `<div class="rv-rate"><button type="button" class="rv-r hard" onclick="revisionRate('hard')">Hard<small>again in 1 day</small></button>${allowAll ? `<button type="button" class="rv-r okay" onclick="revisionRate('okay')">Okay<small>${REVIEW_INTERVALS[Math.max(1, ReviewState.cards[it.key]?.box || 0)]} days</small></button><button type="button" class="rv-r easy" onclick="revisionRate('easy')">Easy<small>${REVIEW_INTERVALS[Math.min(4, Math.max(2, (ReviewState.cards[it.key]?.box || 0) + 1))]} days</small></button>` : ''}</div>`;
  if (it.kind === 'fc') {
    return `<section class="rv-card">${head}<div class="rv-kind">Flashcard${it.isNew ? ' · new' : ''}</div><div class="rv-front">${escapeHtml(it.fc.front)}</div>${S.revealed ? `<div class="rv-back">${escapeHtml(it.fc.back || '')}</div>${rateRow(true)}` : `<button type="button" class="btn-nav primary" style="width:100%;margin-top:14px;" onclick="revisionReveal()">Show answer</button>`}</section>`;
  }
  const q = it.q; const ans = String(q.answer || '').toUpperCase(); const done = !!S.answer;
  const opts = (q.options || []).map(o => { const L = String(o.letter || '').toUpperCase(); const cls = done ? (L === ans ? 'lc-opt ok' : L === S.answer ? 'lc-opt bad' : 'lc-opt') : 'lc-opt'; return `<button type="button" class="${cls}" ${done ? 'disabled' : ''} onclick="revisionAnswer('${escapeHtml(L)}')"><span class="opt-circle">${escapeHtml(L)}</span><span>${escapeHtml(o.en || o.hi || '')}${o.hi && o.hi !== o.en ? `<small>${escapeHtml(o.hi)}</small>` : ''}</span></button>`; }).join('');
  const ok = done && S.answer === ans;
  return `<section class="rv-card">${head}<div class="rv-kind">Your past mistake${it.isNew ? ' · first review' : ''} ${bookmarkButtonHtml(it.cid)}</div>
    <div class="rv-front">${escapeHtml(q.QUESTION_EN || q.QUESTION_HI || '')}</div>${q.QUESTION_EN && q.QUESTION_HI ? `<div class="rv-sub">${escapeHtml(q.QUESTION_HI)}</div>` : ''}
    <div class="lc-opts">${opts}</div>
    ${done ? `<div class="feedback-box ${ok ? 'correct' : 'wrong'}"><b>${ok ? '✅ Correct' : '❌ Correct answer: ' + escapeHtml(q.answer)}</b>${q.EXPLANATION ? `<div style="margin-top:6px;">${escapeHtml(q.EXPLANATION)}</div>` : ''}</div>${S.note ? `<p class="sj-note"><b>${escapeHtml(S.note)}</b></p>` : ''}${ok ? rateRow(true) : `<button type="button" class="btn-nav primary" style="width:100%;margin-top:12px;" onclick="revisionRate('hard')">Next — review again tomorrow</button>`}` : '<p class="sj-note sj-muted">Answer first. Two correct reviews in a row remove it from the Mistake Book.</p>'}
  </section>`;
}
function renderRevisionPage(v, moduleId) {
  const mod = moduleId ? getWorkspaceModule(moduleId) : null;
  if (moduleId && !mod) return navigate('revision_hub');
  if (RevisionSession && (RevisionSession.moduleId || null) === (moduleId || null)) {
    v.innerHTML = `<div class="nav-breadcrumb"><button onclick="RevisionSession=null;navigate('home')">Home</button><span class="sep">/</span><button onclick="RevisionSession=null;navigate('revision_hub')">Revision</button>${mod ? `<span class="sep">/</span><span>${escapeHtml(mod.topicTitle)}</span>` : ''}</div>${revisionCardHtml()}`;
    return;
  }
  const due = reviewDue(moduleId);
  const all = reviewItems(moduleId);
  const dueQ = due.filter(x => x.kind === 'q').length, dueF = due.length - dueQ;
  const upcoming = moduleId ? all.filter(x => x.due > sjLocalDay()).length : reviewUpcoming(7);
  const mistakesN = (UserState.mistakeBook || []).filter(m => !sjIsSeedMistake(m) && getWorkspaceModule(m.moduleId) && (!moduleId || m.moduleId === moduleId)).length;
  const bms = [...bookmarkedIds()].map(id => IndexEngine.registry.get(id)).filter(Boolean);
  const topics = moduleId ? [] : WorkspaceManager.filterModules(AppModules || []).map(m => ({ m, items: all.filter(x => x.mod.moduleId === m.moduleId) })).filter(x => x.items.length);
  v.innerHTML = `
    <div class="nav-breadcrumb"><button onclick="navigate('home')">Home</button><span class="sep">/</span>${mod ? `<button onclick="navigate('revision_hub')">Revision</button><span class="sep">/</span><span>${escapeHtml(mod.topicTitle)}</span>` : '<span>Revision</span>'}</div>
    <section class="rv-hero">
      <span class="journey-pill">🔄 Spaced revision${mod ? ' · ' + escapeHtml(mod.topicTitle) : ''}</span>
      <h1>${due.length ? `${due.length} to revise today` : 'All caught up'}</h1>
      <p>${due.length ? `${dueQ} past mistake${dueQ === 1 ? '' : 's'} · ${dueF} flashcard${dueF === 1 ? '' : 's'}` : 'Nothing is due today.'}${upcoming ? ` · ${upcoming} due ${moduleId ? 'later' : 'in the next 7 days'}` : ''}</p>
      ${due.length ? `<button type="button" class="btn-nav primary rv-start" onclick="revisionStart(${moduleId ? nbJsAttr(moduleId) : 'null'})">Start revision (${due.length}) →</button>` : ''}
    </section>
    <p class="sj-note sj-muted" style="margin:0 2px 12px;">Your wrong answers and topic flashcards come back after 1, 3, 7, 14 and 30 days, depending on how well you knew them.</p>
    ${!all.length ? `<div class="sj-empty"><strong>Nothing to revise ${mod ? 'in this topic ' : ''}yet</strong><span>Wrong answers from practice and tests become revision cards automatically.</span>${mod ? `<button type="button" class="btn-nav" onclick="navigate('practice',{moduleId:${nbJsAttr(mod.moduleId)},qIndex:0})">Practice this topic</button>` : ''}</div>` : ''}
    <div class="sj-grid">
      <button type="button" class="card-btn" onclick="navigate('mistakes')"><strong>📕 Mistake Book</strong><small>${mistakesN} unresolved mistake${mistakesN === 1 ? '' : 's'} · tag why each happened</small></button>
      <button type="button" class="card-btn" onclick="navigate('mastery')"><strong>🎯 Mastery by topic</strong><small>Based on your latest answers</small></button>
    </div>
    ${topics.length ? `<div class="section-title"><span>By topic</span></div><div class="sj-recent">${topics.map(({ m, items }) => { const d = items.filter(x => x.due <= sjLocalDay()).length; return `<button type="button" class="sj-action" onclick="navigate('revision',{moduleId:${nbJsAttr(m.moduleId)}})"><span aria-hidden="true">📘</span><span class="sj-action-copy"><strong>${escapeHtml(m.topicTitle)}</strong><small>${d} due today · ${items.length} card${items.length === 1 ? '' : 's'} in total</small></span><span class="sj-action-go" aria-hidden="true">›</span></button>`; }).join('')}</div>` : ''}
    ${!moduleId ? `<div class="section-title"><span>⭐ Bookmarks (${bms.length})</span>${bms.length ? `<button class="btn-action-sm" onclick="sbOpenBookmarkTest()">Test from bookmarks</button>` : ''}</div>
    ${bms.length ? `<div class="sj-recent">${bms.slice(0, 30).map(q => `<div class="bm-row"><button type="button" class="sj-action" onclick="startSinglePractice(${nbJsAttr(q.canonicalQId)})"><span aria-hidden="true">⭐</span><span class="sj-action-copy"><strong>${escapeHtml((q.QUESTION_EN || q.QUESTION_HI || '').slice(0, 90))}</strong><small>${escapeHtml(q.metadata?.topic || '')} · Q.${escapeHtml(q.originalQNo)}</small></span></button>${bookmarkButtonHtml(q.canonicalQId)}</div>`).join('')}</div>` : `<div class="sj-empty"><strong>No bookmarks yet</strong><span>Tap ☆ on any question in Practice, Revision or a test to save it here.</span></div>`}` : ''}`;
}
function renderGlobalRevisionHub(v) { renderRevisionPage(v, null); }
function renderRevisionEngine(v, moduleId) { renderRevisionPage(v, moduleId); }

/* ---------- practice filters ---------- */
let PracticeFilter = { diff: '', type: '', status: '' };
function practiceBaseQuestions(mod) { return (mod?.groups || []).flatMap(g => g.questions || []); }
function practiceFilteredQuestions(mod) {
  let qs = practiceBaseQuestions(mod);
  const F = PracticeFilter;
  if (F.diff) qs = qs.filter(q => String(q.metadata?.difficulty || '').toUpperCase() === F.diff);
  if (F.type) qs = qs.filter(q => String(q.metadata?.theoryOrNumerical || '').toUpperCase() === F.type);
  if (F.status) {
    const ws = WorkspaceManager.current().id;
    if (F.status === 'new') { const seen = new Set(AttemptHistory.filter(a => a.ws === ws).map(a => a.cid)); qs = qs.filter(q => !seen.has(String(q.canonicalQId))); }
    if (F.status === 'wrong') { const wrong = new Set((UserState.mistakeBook || []).filter(m => m.moduleId === mod.moduleId && !sjIsSeedMistake(m)).map(m => String(m.qId))); qs = qs.filter(q => wrong.has(String(q.originalQNo))); }
    if (F.status === 'bookmarked') { const b = bookmarkedIds(); qs = qs.filter(q => b.has(String(q.canonicalQId))); }
  }
  return qs;
}
function setPracticeFilter(key, value, moduleId) {
  PracticeFilter[key] = PracticeFilter[key] === value ? '' : value;
  ActiveHintStep = 0;
  navigate('practice', { moduleId, qIndex: 0 });
}
function practiceFilterBarHtml(mod) {
  const F = PracticeFilter; const id = nbJsAttr(mod.moduleId);
  const chip = (key, value, label) => `<button type="button" class="filter-pill ${F[key] === value ? 'active' : ''}" aria-pressed="${F[key] === value}" onclick="setPracticeFilter('${key}','${value}',${id})">${label}</button>`;
  const active = F.diff || F.type || F.status;
  return `<details class="pf-bar" ${active ? 'open' : ''}><summary>Filter questions${active ? ' · on' : ''}</summary><div class="filter-bar" style="flex-wrap:wrap;">
    ${chip('status', 'new', 'Not tried yet')}${chip('status', 'wrong', 'My wrong')}${chip('status', 'bookmarked', '⭐ Bookmarked')}
    ${chip('diff', 'EASY', 'Easy')}${chip('diff', 'MODERATE', 'Medium')}${chip('diff', 'HARD', 'Hard')}
    ${chip('type', 'NUMERICAL', 'Numerical')}${chip('type', 'THEORY', 'Theory')}
    ${active ? `<button type="button" class="filter-pill" onclick="PracticeFilter={diff:'',type:'',status:''};navigate('practice',{moduleId:${id},qIndex:0})">Clear</button>` : ''}
  </div></details>`;
}

/* ---------- builder: bookmarks as a source ---------- */
function sbOpenBookmarkTest() {
  SBCache = null;
  const b = bookmarkedIds();
  const rows = sbAll().filter(r => b.has(r.id));
  if (!rows.length) { openCustomToast('No bookmarked questions are available for a test.'); return; }
  const ctx = sbContexts(rows)[0];
  const keep = BuilderTemplates;
  SB = sbFresh(); BuilderTemplates = keep;
  SB.mode = 'custom'; SB.examId = ctx.examId; SB.year = ctx.year; SB.board = sbBoardOf(ctx.examId); SB.hist = 'bookmarked';
  SB.count = Math.min(20, ctx.count); SB.countTouched = true; SB.minutes = SB.count;
  SB.stack = ['mode', 'subject']; SB.step = 'settings';
  navigate('native_builder');
  if (sbContexts(rows).length > 1) setTimeout(() => openCustomToast(`Showing bookmarks from ${sbExamName(ctx.examId)} ${ctx.year}. One test uses one exam and year.`), 60);
}
