/* =========================================================================
   V2.3.8 — SMART TEST BUILDER (Update 2)
   Three modes with one fixed meaning each:
     Quick  — start a test in one tap.
     PYQ    — a real previous-year paper, original order.
     Custom — build step by step: Board → Exam → Year → Subject → Topic →
              Subtopic → Type → Questions → Settings → Preview → Instructions.
   Source of questions: nbSourceRows() (workspace-scoped, de-duplicated, valid).
   Launch: the existing initTestSession(... {sessionSpec}) contract — scoring,
   timer and result logic are unchanged.
   ========================================================================= */
const BUILDER_TEMPLATE_KEY = 'master_student_journey_v90_builder_templates';
const BUILDER_DRAFT_KEY = 'masterTestBookBuilderDraftV1';
let BuilderTemplates = [];
const SB_SEP = '␟';
const SB_QUICK_PRESETS = [
  { id: 'daily', label: 'Daily 10', n: 10, min: 10, desc: '10 questions · 10 min' },
  { id: 'speed', label: 'Speed 20', n: 20, min: 12, desc: '20 questions · 12 min' },
  { id: 'full', label: 'Full 30', n: 30, min: 30, desc: '30 questions · 30 min' }
];
const SB_CUSTOM_STEPS = ['board', 'exam', 'year', 'subject', 'topic', 'subtopic', 'type', 'questions', 'settings', 'preview', 'instructions'];
function sbFresh() {
  return {
    inited: true, mode: '', step: 'mode', stack: [],
    board: '', examId: '', year: '',
    exSubject: new Set(), exTopic: new Set(), exSubtopic: new Set(), exType: new Set(), exDiff: new Set(),
    pick: 'all', picked: new Set(), qSearch: '', qShow: 60,
    hist: 'all', count: 20, countTouched: false, minutes: 20, minutesTouched: false, lang: 'both', shuffle: true,
    previewIds: [], quickCtx: '', quickEx: new Set(),
    pyqExam: '', pyqYear: '', pyqShift: '', pyqScope: 'full', pyqSubject: '', pyqMinutes: 0, pyqMinutesTouched: false,
    title: ''
  };
}
let SB = { inited: false };
let SBCache = null;

/* ---------- storage: templates (new key) + draft (session only) ---------- */
async function hydrateBuilderTemplates() {
  try {
    const t = parseStored(await AppStorage.getRaw(BUILDER_TEMPLATE_KEY), [], BUILDER_TEMPLATE_KEY);
    BuilderTemplates = Array.isArray(t) ? t.filter(x => x && x.v === 1 && x.id) : [];
  } catch (e) { BuilderTemplates = []; }
}
function saveBuilderTemplates() {
  const s = JSON.stringify(BuilderTemplates);
  return StorageWriteQueue.enqueue(() => AppStorage.setRawDirect(BUILDER_TEMPLATE_KEY, s)).catch(e => console.warn('[Builder] template save failed', e));
}
const SB_SET_KEYS = ['exSubject', 'exTopic', 'exSubtopic', 'exType', 'exDiff', 'picked', 'quickEx'];
function sbSerialize(state) {
  const o = { ...state };
  SB_SET_KEYS.forEach(k => { o[k] = [...(state[k] || [])]; });
  return o;
}
function sbDeserialize(o) {
  const s = { ...sbFresh(), ...o };
  SB_SET_KEYS.forEach(k => { s[k] = new Set(Array.isArray(o?.[k]) ? o[k] : []); });
  s.inited = true;
  return s;
}
function sbSaveDraft() {
  try { sessionStorage.setItem(BUILDER_DRAFT_KEY, JSON.stringify({ ws: WorkspaceManager.current().id, state: sbSerialize(SB) })); } catch (_) {}
}
function sbLoadDraft() {
  try {
    const d = JSON.parse(sessionStorage.getItem(BUILDER_DRAFT_KEY) || 'null');
    if (d && d.ws === WorkspaceManager.current().id && d.state) return sbDeserialize(d.state);
  } catch (_) {}
  return null;
}
function sbReset() { SB = sbFresh(); try { sessionStorage.removeItem(BUILDER_DRAFT_KEY); } catch (_) {} }

/* ---------- data helpers ---------- */
function sbAll() { if (!SBCache) SBCache = nbSourceRows(); return SBCache; }
function sbBoardOf(examId) {
  const p = UniversalExamRegistry.registry.get(examId) || {};
  const known = UniversalExamRegistry.knownProfiles[examId];
  const raw = String(known?.board || '').trim();
  if (raw) return raw === 'RRC/RRB' ? 'RRB' : (raw === 'Railway Police' ? 'RPF' : raw);
  const id = String(examId || '').toLowerCase();
  for (const b of ['ssc', 'rrb', 'rpf', 'upsc', 'bpsc', 'dpsc']) if (id.startsWith(b)) return b.toUpperCase();
  const pb = String(p.examBoard || '').trim();
  return pb && pb !== 'Official Exam Board' ? pb : 'Other';
}
function sbExamName(examId) {
  const p = UniversalExamRegistry.registry.get(examId);
  return String(p?.examName || UniversalExamRegistry.knownProfiles[examId]?.name || examId || 'Exam');
}
function sbSubjectLabel(subject) { return subjectDisplayName(subject); }
function sbSubtopic(r) {
  const s = String(r.q.metadata?.subtopic || r.q.SUB_TOPIC || '').trim();
  return !s || /^general subtopic$/i.test(s) ? 'General' : s;
}
function sbTypeOf(r) { const t = String(r.q.metadata?.theoryOrNumerical || '').toUpperCase(); return t === 'THEORY' ? 'THEORY' : (t === 'NUMERICAL' ? 'NUMERICAL' : 'OTHER'); }
function sbDiffOf(r) { const d = String(r.q.metadata?.difficulty || r.difficulty || '').toUpperCase(); return ['EASY', 'MODERATE', 'HARD'].includes(d) ? d : 'OTHER'; }
const SB_TYPE_LABEL = { NUMERICAL: 'Numerical', THEORY: 'Theory', OTHER: 'Unclassified' };
const SB_DIFF_LABEL = { EASY: 'Easy', MODERATE: 'Medium', HARD: 'Hard', OTHER: 'Unrated' };
function sbTopicKey(r) { return r.subject + SB_SEP + r.topic; }
function sbSubKey(r) { return r.subject + SB_SEP + r.topic + SB_SEP + sbSubtopic(r); }
function sbAttemptedIds() {
  const ws = WorkspaceManager.current().id;
  return new Set(AttemptHistory.filter(a => a.ws === ws && a.cid).map(a => a.cid));
}
function sbWrongIds() {
  const ids = new Set();
  const rows = sbAll();
  const byModQno = new Map(rows.map(r => [r.mod.moduleId + SB_SEP + String(r.q.originalQNo), r.id]));
  (UserState.mistakeBook || []).forEach(m => {
    if (sjIsSeedMistake(m)) return;
    if (m.canonicalQId && rows.some(r => r.id === String(m.canonicalQId))) ids.add(String(m.canonicalQId));
    else { const id = byModQno.get(String(m.moduleId) + SB_SEP + String(m.qId)); if (id) ids.add(id); }
  });
  return ids;
}
function sbShuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function sbContexts(rows = sbAll()) {
  const m = new Map();
  rows.forEach(r => {
    if (!r.examId || !r.year) return;
    const k = r.examId + SB_SEP + r.year;
    const c = m.get(k) || { key: k, examId: r.examId, year: r.year, count: 0 };
    c.count++; m.set(k, c);
  });
  return [...m.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/* Custom pipeline: rows after applying every filter up to and including `stage`. */
const SB_STAGES = ['year', 'subject', 'topic', 'subtopic', 'type', 'history', 'pick'];
function sbCustomRows(stage) {
  const upto = SB_STAGES.indexOf(stage);
  let rows = sbAll().filter(r => r.examId === SB.examId && r.year === SB.year);
  if (upto >= 1) rows = rows.filter(r => !SB.exSubject.has(r.subject));
  if (upto >= 2) rows = rows.filter(r => !SB.exTopic.has(sbTopicKey(r)));
  if (upto >= 3) rows = rows.filter(r => !SB.exSubtopic.has(sbSubKey(r)));
  if (upto >= 4) rows = rows.filter(r => !SB.exType.has(sbTypeOf(r)) && !SB.exDiff.has(sbDiffOf(r)));
  if (upto >= 5 && SB.hist === 'unattempted') { const a = sbAttemptedIds(); rows = rows.filter(r => !a.has(r.id)); }
  if (upto >= 5 && SB.hist === 'wrong') { const w = sbWrongIds(); rows = rows.filter(r => w.has(r.id)); }
  if (upto >= 5 && SB.hist === 'bookmarked') { const bm = bookmarkedIds(); rows = rows.filter(r => bm.has(r.id)); }
  if (upto >= 6 && SB.pick === 'pick') rows = rows.filter(r => SB.picked.has(r.id));
  return rows;
}
function sbGroup(rows, keyFn, labelFn, metaFn) {
  const m = new Map();
  rows.forEach(r => {
    const k = keyFn(r);
    const g = m.get(k) || { key: k, label: labelFn(r), meta: metaFn ? metaFn(r) : '', count: 0 };
    g.count++; m.set(k, g);
  });
  return [...m.values()];
}
function sbLevelItems(step) {
  const all = sbAll();
  if (step === 'board') return sbGroup(all.filter(r => r.examId && r.year), r => sbBoardOf(r.examId), r => sbBoardOf(r.examId)).sort((a, b) => a.label.localeCompare(b.label));
  if (step === 'exam') return sbGroup(all.filter(r => r.examId && r.year && sbBoardOf(r.examId) === SB.board), r => r.examId, r => sbExamName(r.examId)).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  if (step === 'year') return sbGroup(all.filter(r => r.examId === SB.examId && r.year), r => r.year, r => r.year).sort((a, b) => b.key.localeCompare(a.key));
  if (step === 'subject') return sbGroup(sbCustomRows('year'), r => r.subject, r => sbSubjectLabel(r.subject)).sort((a, b) => a.label.localeCompare(b.label));
  if (step === 'topic') return sbGroup(sbCustomRows('subject'), sbTopicKey, r => r.topic, r => `${sbSubjectLabel(r.subject)} › ${r.chapter}`).sort((a, b) => a.meta.localeCompare(b.meta) || a.label.localeCompare(b.label));
  if (step === 'subtopic') return sbGroup(sbCustomRows('topic'), sbSubKey, r => sbSubtopic(r), r => r.topic).sort((a, b) => a.meta.localeCompare(b.meta) || a.label.localeCompare(b.label));
  return [];
}
const SB_EX_FOR = { subject: 'exSubject', topic: 'exTopic', subtopic: 'exSubtopic' };

/* ---------- navigation inside the builder ---------- */
function sbNextCustomStep(from) {
  const i = SB_CUSTOM_STEPS.indexOf(from);
  return SB_CUSTOM_STEPS[i + 1] || 'instructions';
}
// A level is skipped (auto-chosen) when there is nothing to choose.
function sbAutoSkip(step) {
  if (step === 'board' || step === 'exam' || step === 'year') {
    const items = sbLevelItems(step);
    if (items.length === 1) { sbApplyChoice(step, items[0].key); return true; }
    return false;
  }
  if (step === 'subject' || step === 'topic' || step === 'subtopic') return sbLevelItems(step).length <= 1;
  if (step === 'type') {
    const rows = sbCustomRows('subtopic');
    return new Set(rows.map(sbTypeOf)).size <= 1 && new Set(rows.map(sbDiffOf)).size <= 1;
  }
  return false;
}
function sbGo(step, pushCurrent = true) {
  if (pushCurrent && SB.step !== step) SB.stack.push(SB.step);
  SB.step = step;
  if (step === 'preview' && SB.mode === 'custom') sbBuildPreview();
  sbRerender(true);
}
function sbForward() {
  if (SB.mode !== 'custom') return;
  let next = sbNextCustomStep(SB.step);
  SB.stack.push(SB.step);
  while (['board', 'exam', 'year', 'subject', 'topic', 'subtopic', 'type'].includes(next) && sbAutoSkip(next)) next = sbNextCustomStep(next);
  SB.step = next;
  if (next === 'settings') sbSyncCountDefaults();
  if (next === 'preview') sbBuildPreview();
  sbRerender(true);
}
function sbBack() {
  if (SB.step === 'mode' || !SB.stack.length) {
    sbSaveDraft();
    if (Array.isArray(AppRouteStack) && AppRouteStack.length) appNavigateBack(); else navigate('home');
    return;
  }
  SB.step = SB.stack.pop();
  sbRerender(true);
}
function sbHardwareBack() {
  if (!document.body.classList.contains('native-builder-active')) return false;
  if (SB.step === 'mode' || !SB.stack.length) return false;
  sbBack();
  return true;
}
function sbJump(step) {
  const i = SB.stack.indexOf(step);
  if (i < 0) return;
  SB.stack = SB.stack.slice(0, i);
  SB.step = step;
  sbRerender(true);
}
function sbRerender(scrollTop) {
  const body = document.getElementById('sbBody');
  const keep = body && !scrollTop ? body.scrollTop : 0;
  renderView();
  const next = document.getElementById('sbBody');
  if (next) next.scrollTop = keep;
}

/* ---------- actions ---------- */
function sbStartMode(mode) {
  const keepTemplates = BuilderTemplates;
  SB = sbFresh();
  BuilderTemplates = keepTemplates;
  SB.mode = mode;
  if (mode === 'quick') { SB.stack = ['mode']; SB.step = 'quick'; sbRerender(true); return; }
  if (mode === 'pyq') {
    SB.stack = ['mode']; SB.step = 'pyq_exam';
    const exams = sbPyqExams();
    if (exams.length === 1) { SB.pyqExam = exams[0].key; SB.stack.push('pyq_exam'); SB.step = 'pyq_year'; sbPyqAutoAdvance(); }
    sbRerender(true); return;
  }
  SB.stack = [];
  SB.step = 'mode';
  sbForwardFromMode();
}
function sbForwardFromMode() {
  SB.stack = ['mode'];
  let next = 'board';
  while (['board', 'exam', 'year', 'subject', 'topic', 'subtopic', 'type'].includes(next) && sbAutoSkip(next)) next = sbNextCustomStep(next);
  SB.step = next;
  if (next === 'settings') sbSyncCountDefaults();
  sbRerender(true);
}
function sbApplyChoice(step, key) {
  if (step === 'board') { if (SB.board !== key) { SB.examId = ''; SB.year = ''; } SB.board = key; }
  if (step === 'exam') { if (SB.examId !== key) SB.year = ''; SB.examId = key; }
  if (step === 'year') SB.year = key;
}
function sbChoose(step, key) {
  sbApplyChoice(step, key);
  SB.previewIds = [];
  sbForward();
}
function sbToggle(level, key) {
  const set = SB[SB_EX_FOR[level]];
  if (set.has(key)) set.delete(key); else set.add(key);
  SB.previewIds = [];
  sbRerender(false);
}
function sbSetAll(level, on) {
  const set = SB[SB_EX_FOR[level]];
  sbLevelItems(level).forEach(i => { if (on) set.delete(i.key); else set.add(i.key); });
  SB.previewIds = [];
  sbRerender(false);
}
function sbToggleType(kind, key) {
  const set = kind === 'type' ? SB.exType : SB.exDiff;
  if (set.has(key)) set.delete(key); else set.add(key);
  SB.previewIds = [];
  sbRerender(false);
}
function sbSetPick(mode) { SB.pick = mode; SB.previewIds = []; sbRerender(false); }
function sbTogglePicked(id) { if (SB.picked.has(id)) SB.picked.delete(id); else SB.picked.add(id); SB.previewIds = []; sbRerender(false); }
function sbPickVisible(on) {
  sbPickCandidates().slice(0, SB.qShow).forEach(r => { if (on) SB.picked.add(r.id); else SB.picked.delete(r.id); });
  sbRerender(false);
}
function sbPickCandidates() {
  const term = SB.qSearch.trim().toLowerCase();
  const rows = sbCustomRows('history');
  return term ? rows.filter(r => [r.q.QUESTION_EN, r.q.QUESTION_HI, r.topic, sbSubtopic(r), r.q.originalQNo].some(x => String(x ?? '').toLowerCase().includes(term))) : rows;
}
function sbQuestionSearch(value) {
  const el = document.getElementById('sbQSearch');
  const pos = el && typeof el.selectionStart === 'number' ? el.selectionStart : String(value || '').length;
  SB.qSearch = String(value || ''); SB.qShow = 60;
  sbRerender(false);
  const n = document.getElementById('sbQSearch');
  if (n) { try { n.focus({ preventScroll: true }); n.setSelectionRange(pos, pos); } catch (_) {} }
}
function sbSyncCountDefaults() {
  const pool = sbCustomRows('pick').length;
  if (SB.pick === 'pick') SB.count = pool;
  else if (!SB.countTouched) SB.count = Math.min(20, pool);
  if (SB.count > pool && !SB.countTouched) SB.count = pool;
  if (!SB.minutesTouched) SB.minutes = Math.max(1, SB.count);
}
function sbSetCount(n) {
  SB.count = Math.max(1, Math.min(500, Math.round(Number(n) || 1)));
  SB.countTouched = true;
  if (!SB.minutesTouched) SB.minutes = SB.count;
  SB.previewIds = [];
  sbRerender(false);
}
function sbSetMinutes(n) { SB.minutes = Math.max(1, Math.min(300, Math.round(Number(n) || 1))); SB.minutesTouched = true; sbRerender(false); }
function sbCountInput(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1) return;
  SB.count = Math.min(500, n); SB.countTouched = true; SB.previewIds = [];
  if (!SB.minutesTouched) { SB.minutes = SB.count; const mi = document.getElementById('sbMinIn'); if (mi) mi.value = SB.minutes; }
  sbSettingsRefresh();
}
function sbMinutesInput(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1) return;
  SB.minutes = Math.min(300, n); SB.minutesTouched = true;
  sbSettingsRefresh();
}
// Update only the parts that depend on the typed numbers, so focus and the next tap are never lost.
function sbSettingsRefresh() {
  const n = sbCustomRows('pick').length;
  const short = SB.pick !== 'pick' && SB.count > n;
  const w = document.getElementById('sbWarn'); if (w) w.hidden = !short;
  document.querySelectorAll('[data-sb-count]').forEach(b => b.classList.toggle('on', Number(b.dataset.sbCount) === SB.count));
  const info = document.getElementById('sbBarInfo');
  if (info) info.innerHTML = `${sbCount(SB.pick === 'pick' ? n : Math.min(SB.count, n))} · ${SB.minutes} min`;
  const btn = document.getElementById('sbPrimary'); if (btn) btn.disabled = !n || short;
  sbSaveDraft();
}
function sbPyqMinutesInput(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1) return;
  SB.pyqMinutes = Math.min(300, n); SB.pyqMinutesTouched = true;
  const info = document.getElementById('sbBarInfo');
  if (info) info.innerHTML = `${sbCount(Math.min(sbPyqFinalRows().length, 500))} · ${SB.pyqMinutes} min`;
  sbSaveDraft();
}
function sbSetHist(h) { SB.hist = h; SB.countTouched = false; SB.previewIds = []; sbSyncCountDefaults(); sbRerender(false); }
function sbSet(key, value) { SB[key] = value; if (key === 'shuffle') SB.previewIds = []; sbRerender(false); }

/* ---------- preview ---------- */
function sbBuildPreview() {
  const pool = sbCustomRows('pick');
  const n = SB.pick === 'pick' ? pool.length : Math.min(SB.count, pool.length, 500);
  const ordered = SB.shuffle ? sbShuffle(pool) : pool.slice().sort((a, b) => a.subject.localeCompare(b.subject) || a.topic.localeCompare(b.topic) || (Number(a.q.originalQNo) || 0) - (Number(b.q.originalQNo) || 0));
  SB.previewIds = sbGroupBySubject(ordered.slice(0, n)).map(r => r.id);
}
function sbRemoveFromPreview(id) {
  if (SB.previewIds.length <= 1) { openCustomToast('A test needs at least one question.'); return; }
  SB.previewIds = SB.previewIds.filter(x => x !== id);
  if (!SB.minutesTouched) SB.minutes = SB.previewIds.length;
  sbRerender(false);
}
function sbReplaceInPreview(id) {
  const used = new Set(SB.previewIds);
  const pool = (SB.mode === 'custom' ? sbCustomRows('pick') : sbAll()).filter(r => !used.has(r.id) && r.examId === SB.examId && r.year === SB.year);
  if (!pool.length) { openCustomToast('No other eligible question is available for this selection.'); return; }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  SB.previewIds = SB.previewIds.map(x => (x === id ? pick.id : x));
  sbRerender(false);
}

/* ---------- PYQ ---------- */
function sbPyqRows() { return sbAll().filter(nbSafePYQ); }
function sbPyqShiftOf(r) { return String(r.q.metadata?.shift || r.q.paperDate || 'Paper').trim() || 'Paper'; }
function sbPyqExams() { return sbGroup(sbPyqRows(), r => r.examId, r => sbExamName(r.examId), r => sbBoardOf(r.examId)).sort((a, b) => b.count - a.count); }
function sbPyqYears() { return sbGroup(sbPyqRows().filter(r => r.examId === SB.pyqExam), r => r.year, r => r.year).sort((a, b) => b.key.localeCompare(a.key)); }
function sbPyqShifts() { return sbGroup(sbPyqRows().filter(r => r.examId === SB.pyqExam && r.year === SB.pyqYear), sbPyqShiftOf, sbPyqShiftOf).sort((a, b) => a.label.localeCompare(b.label)); }
function sbPyqPaperRows() {
  return sbPyqRows().filter(r => r.examId === SB.pyqExam && r.year === SB.pyqYear && (SB.pyqShift === '*' || sbPyqShiftOf(r) === SB.pyqShift))
    .sort((a, b) => (Number(a.q.originalQNo) || 0) - (Number(b.q.originalQNo) || 0) || a.id.localeCompare(b.id));
}
function sbPyqFinalRows() {
  const rows = sbPyqPaperRows();
  return SB.pyqScope === 'subject' && SB.pyqSubject ? rows.filter(r => r.subject === SB.pyqSubject) : rows;
}
function sbPyqAutoAdvance() {
  if (SB.step === 'pyq_year') { const y = sbPyqYears(); if (y.length === 1) { SB.pyqYear = y[0].key; SB.stack.push('pyq_year'); SB.step = 'pyq_shift'; } }
  if (SB.step === 'pyq_shift') { const s = sbPyqShifts(); if (s.length === 1) { SB.pyqShift = s[0].key; SB.stack.push('pyq_shift'); SB.step = 'pyq_scope'; } }
}
function sbPyqChoose(level, key) {
  SB.stack.push(SB.step);
  if (level === 'exam') { SB.pyqExam = key; SB.pyqYear = ''; SB.pyqShift = ''; SB.step = 'pyq_year'; }
  if (level === 'year') { SB.pyqYear = key; SB.pyqShift = ''; SB.step = 'pyq_shift'; }
  if (level === 'shift') { SB.pyqShift = key; SB.step = 'pyq_scope'; }
  SB.pyqMinutesTouched = false;
  sbPyqAutoAdvance();
  sbRerender(true);
}
function sbPyqSetScope(scope, subject) { SB.pyqScope = scope; SB.pyqSubject = subject || ''; SB.pyqMinutesTouched = false; sbRerender(false); }
function sbPyqToInstructions() {
  const rows = sbPyqFinalRows().slice(0, 500);
  if (!rows.length) { openCustomToast('Choose a paper first.'); return; }
  SB.previewIds = rows.map(r => r.id);
  SB.examId = rows[0].examId; SB.year = rows[0].year;
  SB.minutes = SB.pyqMinutesTouched ? SB.pyqMinutes : rows.length;
  SB.title = `PYQ · ${sbExamName(SB.pyqExam)} ${SB.pyqYear}${SB.pyqShift && SB.pyqShift !== '*' ? ' · ' + SB.pyqShift : ''}`;
  sbGo('instructions');
}

/* ---------- Quick ---------- */
function sbQuickContextKey() {
  const ctxs = sbContexts();
  if (SB.quickCtx && ctxs.some(c => c.key === SB.quickCtx)) return SB.quickCtx;
  const pref = ctxs.find(c => c.examId === UserState?.selectedExam && c.year === String(UserState?.selectedYear || '')) || ctxs.find(c => c.examId === UserState?.selectedExam) || ctxs[0];
  return pref ? pref.key : '';
}
function sbQuickRows() {
  const key = sbQuickContextKey();
  return sbAll().filter(r => r.examId + SB_SEP + r.year === key && !SB.quickEx.has(r.subject));
}
function sbQuickToggleSubject(subject) { if (SB.quickEx.has(subject)) SB.quickEx.delete(subject); else SB.quickEx.add(subject); sbRerender(false); }
function sbQuickSetContext(key) { SB.quickCtx = key; SB.quickEx.clear(); sbRerender(false); }
function sbQuickStart(presetId) {
  const p = SB_QUICK_PRESETS.find(x => x.id === presetId);
  const rows = sbQuickRows();
  if (!p || !rows.length) { openCustomToast('Choose at least one subject with questions.'); return; }
  const seen = sbAttemptedIds();
  const fresh = sbShuffle(rows.filter(r => !seen.has(r.id)));
  const old = sbShuffle(rows.filter(r => seen.has(r.id)));
  const ids = sbGroupBySubject([...fresh, ...old].slice(0, p.n)).map(r => r.id);
  const minutes = ids.length < p.n ? Math.max(1, Math.round(p.min * ids.length / p.n)) : p.min;
  const ok = sbLaunch(ids, minutes, 'both', `Quick Test · ${p.label}`);
  if (ok && ids.length < p.n) setTimeout(() => openCustomToast(`Only ${ids.length} questions were available, so the test has ${ids.length} questions and ${minutes} min.`), 60);
}

/* ---------- templates ---------- */
function sbTemplateFromState(name) {
  return {
    v: 1, id: 'T-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), ws: WorkspaceManager.current().id,
    name: String(name || '').trim().slice(0, 60) || 'My test', createdAt: new Date().toISOString(),
    board: SB.board, examId: SB.examId, year: SB.year,
    exSubject: [...SB.exSubject], exTopic: [...SB.exTopic], exSubtopic: [...SB.exSubtopic], exType: [...SB.exType], exDiff: [...SB.exDiff],
    hist: SB.hist, count: SB.count, minutes: SB.minutes, lang: SB.lang, shuffle: SB.shuffle
  };
}
function sbOpenSaveTemplate() {
  openModal('⭐ Save as template', `<label for="sbTplName" style="display:block;font-size:12px;font-weight:800;color:var(--text-muted);margin-bottom:6px;">Template name</label><input id="sbTplName" class="search-input" style="padding-left:14px;margin:0;" maxlength="60" placeholder="e.g. Daily Maths 20" value="${escapeHtml(sbExamName(SB.examId) + ' · ' + SB.count + ' Q')}"><p class="sj-note sj-muted">Saves the filters and settings, not a fixed set of questions. Each run picks fresh questions.</p><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;"><button class="btn-nav" onclick="closeModal()">Cancel</button><button class="btn-nav primary" onclick="sbSaveTemplate(document.getElementById('sbTplName').value)">Save</button></div>`);
}
function sbSaveTemplate(name) {
  BuilderTemplates.unshift(sbTemplateFromState(name));
  if (BuilderTemplates.length > 30) BuilderTemplates.length = 30;
  saveBuilderTemplates();
  closeModal();
  openCustomToast('Template saved. Find it on the first Builder screen.');
}
function sbDeleteTemplate(id) {
  const t = BuilderTemplates.find(x => x.id === id);
  if (!t || !confirm(`Delete template "${t.name}"?`)) return;
  BuilderTemplates = BuilderTemplates.filter(x => x.id !== id);
  saveBuilderTemplates();
  sbRerender(false);
}
function sbApplyTemplate(id) {
  const t = BuilderTemplates.find(x => x.id === id && x.ws === WorkspaceManager.current().id);
  if (!t) return;
  const keep = BuilderTemplates;
  SB = sbFresh(); BuilderTemplates = keep;
  SB.mode = 'custom'; SB.board = t.board; SB.examId = t.examId; SB.year = t.year;
  ['exSubject', 'exTopic', 'exSubtopic', 'exType', 'exDiff'].forEach(k => { SB[k] = new Set(t[k] || []); });
  SB.hist = t.hist || 'all'; SB.count = t.count || 20; SB.countTouched = true; SB.minutes = t.minutes || SB.count; SB.minutesTouched = true; SB.lang = t.lang || 'both'; SB.shuffle = t.shuffle !== false;
  if (!sbAll().some(r => r.examId === SB.examId && r.year === SB.year)) { openCustomToast('The exam/year of this template has no questions now.'); SB = sbFresh(); BuilderTemplates = keep; sbRerender(true); return; }
  SB.stack = ['mode', 'subject']; SB.step = 'settings';
  sbRerender(true);
}

/* ---------- entry points from other screens ---------- */
function sbOpenForModule(moduleId) {
  const m = getWorkspaceModule(moduleId);
  const rows = sbAll().filter(r => r.mod.moduleId === moduleId);
  SBCache = null;
  if (!m || !rows.length) { openCustomToast('This topic has no questions available for a test.'); return; }
  const keep = BuilderTemplates;
  SB = sbFresh(); BuilderTemplates = keep;
  SB.mode = 'custom'; SB.examId = rows[0].examId; SB.year = rows[0].year; SB.board = sbBoardOf(SB.examId);
  const ctx = sbAll().filter(r => r.examId === SB.examId && r.year === SB.year);
  ctx.forEach(r => { if (r.subject !== rows[0].subject) SB.exSubject.add(r.subject); else if (r.mod.moduleId !== moduleId) SB.exTopic.add(sbTopicKey(r)); });
  SB.count = Math.min(10, rows.length); SB.countTouched = true; SB.minutes = SB.count;
  SB.stack = ['mode', 'topic']; SB.step = 'settings';
  navigate('native_builder');
}
function sbOpenMistakeTest() {
  SBCache = null;
  const wrong = sbWrongIds();
  const rows = sbAll().filter(r => wrong.has(r.id));
  if (!rows.length) { openCustomToast('No saved mistakes are available for a test yet.'); return; }
  const ctx = sbContexts(rows)[0];
  const keep = BuilderTemplates;
  SB = sbFresh(); BuilderTemplates = keep;
  SB.mode = 'custom'; SB.examId = ctx.examId; SB.year = ctx.year; SB.board = sbBoardOf(ctx.examId); SB.hist = 'wrong';
  SB.count = Math.min(20, ctx.count); SB.countTouched = true; SB.minutes = SB.count;
  SB.stack = ['mode', 'subject']; SB.step = 'settings';
  navigate('native_builder');
  if (sbContexts(rows).length > 1) setTimeout(() => openCustomToast(`Showing mistakes from ${sbExamName(ctx.examId)} ${ctx.year}. One test uses one exam and year.`), 60);
}

/* ---------- launch (single path for all modes) ---------- */
function sbLaunch(ids, minutes, lang, title) {
  if (ActiveTestSession?.sessionStatus === 'ACTIVE') { openCustomToast('A test is already running. Submit or exit it first.'); return false; }
  SBCache = null;
  const byId = new Map(sbAll().map(r => [r.id, r]));
  if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !byId.has(id))) { openCustomToast('The selection changed. Please review it again.'); return false; }
  const rows = ids.map(id => byId.get(id)); const f = rows[0];
  if (rows.some(r => r.examId !== f.examId || r.year !== f.year)) { openCustomToast('All questions in one test must be from the same exam and year.'); return false; }
  const spec = { version: 1, questionIds: ids.slice(), durationMinutes: Math.max(1, Math.min(300, Math.round(Number(minutes) || ids.length))), langMode: ['both', 'en', 'hi'].includes(lang) ? lang : 'both', shuffleQuestions: false, fingerprint: ids.join('|'), title: String(title || 'Custom Test').slice(0, 80) };
  const before = ActiveTestSession;
  initTestSession(f.mod.moduleId, f.group.groupId, 0, null, { sessionSpec: spec });
  if (!ActiveTestSession || ActiveTestSession === before || ActiveTestSession.sessionStatus !== 'ACTIVE' || ActiveTestSession.questionIds.join('|') !== ids.join('|')) {
    if (ActiveTestSession !== before) ActiveTestSession = before;
    openCustomToast('The test could not start. Please go back to Preview and try again.');
    return false;
  }
  sbReset();
  return true;
}
function sbStartFromInstructions() {
  const title = SB.mode === 'pyq' ? SB.title : (SB.hist === 'wrong' ? 'Mistakes Test' : SB.hist === 'bookmarked' ? 'Bookmarks Test' : 'Custom Test');
  sbLaunch(SB.previewIds.slice(), SB.minutes, SB.lang, title);
}

/* ---------- rendering ---------- */
function sbBar(left, buttonHtml) {
  return `<div class="sb-bar-info" id="sbBarInfo">${left}</div>${buttonHtml || ''}`;
}
function sbCount(n) { return `<b>${n}</b> question${n === 1 ? '' : 's'}`; }
function sbCrumbs() {
  if (SB.mode !== 'custom') return '';
  const parts = [];
  const add = (step, label) => parts.push(SB.stack.includes(step) ? `<button type="button" onclick="sbJump('${step}')">${escapeHtml(label)}</button>` : `<span>${escapeHtml(label)}</span>`);
  if (SB.board) add('board', SB.board);
  if (SB.examId) add('exam', sbExamName(SB.examId));
  if (SB.year) add('year', SB.year);
  const idx = SB_CUSTOM_STEPS.indexOf(SB.step);
  if (idx > SB_CUSTOM_STEPS.indexOf('subject')) { const n = sbGroup(sbCustomRows('subject'), r => r.subject, r => '').length; add('subject', `${n} subject${n === 1 ? '' : 's'}`); }
  if (idx > SB_CUSTOM_STEPS.indexOf('topic')) { const n = sbGroup(sbCustomRows('topic'), sbTopicKey, r => '').length; add('topic', `${n} topic${n === 1 ? '' : 's'}`); }
  if (!parts.length) return '';
  return `<nav class="sb-crumbs" aria-label="Your selection">${parts.join('<span class="sb-crumb-sep" aria-hidden="true">›</span>')}</nav>`;
}
const SB_TITLES = {
  mode: 'Create a test', quick: 'Quick Test', pyq_exam: 'PYQ · Choose exam', pyq_year: 'PYQ · Choose year', pyq_shift: 'PYQ · Choose paper', pyq_scope: 'PYQ · Paper',
  board: 'Choose board', exam: 'Choose exam', year: 'Choose year', subject: 'Choose subjects', topic: 'Choose topics', subtopic: 'Choose subtopics',
  type: 'Question type & difficulty', questions: 'Questions', settings: 'Test settings', preview: 'Preview', instructions: 'Instructions'
};
function sbItemMulti(level, it, on) {
  return `<button type="button" class="sb-item ${on ? 'on' : ''}" aria-pressed="${on}" onclick="sbToggle('${level}', ${nbJsAttr(it.key)})"><span class="sb-check" aria-hidden="true">${on ? '✓' : ''}</span><span class="sb-item-main"><strong>${escapeHtml(it.label)}</strong>${it.meta ? `<small>${escapeHtml(it.meta)}</small>` : ''}</span><span class="sb-count">${it.count}</span></button>`;
}
function sbItemChoice(onclick, label, meta, count) {
  return `<button type="button" class="sb-item sb-choice" onclick="${onclick}"><span class="sb-item-main"><strong>${escapeHtml(label)}</strong>${meta ? `<small>${escapeHtml(meta)}</small>` : ''}</span><span class="sb-count">${count}</span><span class="sb-go" aria-hidden="true">›</span></button>`;
}
function sbRenderMode() {
  const all = sbAll();
  const pyqN = sbPyqRows().length;
  const mockReady = nbHasVerifiedMockPattern(UserState?.selectedExam);
  const tpls = BuilderTemplates.filter(t => t.ws === WorkspaceManager.current().id);
  const body = `
    ${all.length ? '' : `<div class="sj-empty"><strong>No questions yet</strong><span>Import questions first, then come back to build a test.</span><button type="button" class="btn-nav" onclick="openImportModal()">Import questions</button></div>`}
    <div class="sb-modes">
      <button type="button" class="sb-mode" ${all.length ? '' : 'disabled'} onclick="sbStartMode('quick')"><span class="sb-mode-icon" aria-hidden="true">⚡</span><span class="sb-mode-copy"><strong>Quick Test</strong><small>Start in one tap. Pick subjects and a size.</small></span><span class="sb-go" aria-hidden="true">›</span></button>
      <button type="button" class="sb-mode" ${pyqN ? '' : 'disabled'} onclick="sbStartMode('pyq')"><span class="sb-mode-icon" aria-hidden="true">🎯</span><span class="sb-mode-copy"><strong>PYQ Test</strong><small>${pyqN ? `Real past paper in original order · ${pyqN} questions marked PYQ` : 'No questions marked as PYQ yet — mark them in Data Control'}</small></span><span class="sb-go" aria-hidden="true">›</span></button>
      <button type="button" class="sb-mode" ${all.length ? '' : 'disabled'} onclick="sbStartMode('custom')"><span class="sb-mode-icon" aria-hidden="true">⚙️</span><span class="sb-mode-copy"><strong>Custom Test</strong><small>Build it step by step: board, exam, year, subject, topic, subtopic, type.</small></span><span class="sb-go" aria-hidden="true">›</span></button>
    </div>
    <p class="sb-mock-note">${mockReady ? 'Full Mock is available from the exam profile.' : 'Full Mock: available once a verified exam pattern is added.'}</p>
    ${tpls.length ? `<h3 class="sb-h3">⭐ My templates</h3><div class="sb-list">${tpls.map(t => `<div class="sb-tpl"><button type="button" class="sb-item sb-choice" onclick="sbApplyTemplate(${nbJsAttr(t.id)})"><span class="sb-item-main"><strong>${escapeHtml(t.name)}</strong><small>${escapeHtml(sbExamName(t.examId))} ${escapeHtml(t.year)} · ${Number(t.count) || 0} Q · ${Number(t.minutes) || 0} min</small></span><span class="sb-go" aria-hidden="true">›</span></button><button type="button" class="sb-tpl-del" aria-label="Delete template ${escapeHtml(t.name)}" onclick="sbDeleteTemplate(${nbJsAttr(t.id)})">✕</button></div>`).join('')}</div>` : ''}`;
  return { body, bar: sbBar(`${sbCount(all.length)} in your bank`, '') };
}
function sbRenderQuick() {
  const ctxs = sbContexts();
  const key = sbQuickContextKey();
  const ctxRows = sbAll().filter(r => r.examId + SB_SEP + r.year === key);
  const subjects = sbGroup(ctxRows, r => r.subject, r => sbSubjectLabel(r.subject)).sort((a, b) => a.label.localeCompare(b.label));
  const pool = sbQuickRows();
  const body = `
    <label class="sb-label" for="sbQuickCtx">Exam</label>
    <select id="sbQuickCtx" class="sb-select" onchange="sbQuickSetContext(this.value)">${ctxs.map(c => `<option value="${escapeHtml(c.key)}" ${c.key === key ? 'selected' : ''}>${escapeHtml(sbExamName(c.examId))} · ${escapeHtml(c.year)} (${c.count})</option>`).join('')}</select>
    <div class="sb-label">Subjects</div>
    <div class="sb-chips">${subjects.map(s => { const on = !SB.quickEx.has(s.key); return `<button type="button" class="sb-chip ${on ? 'on' : ''}" aria-pressed="${on}" onclick="sbQuickToggleSubject(${nbJsAttr(s.key)})">${on ? '✓ ' : ''}${escapeHtml(s.label)} <span>${s.count}</span></button>`; }).join('')}</div>
    <div class="sb-label">Start a test</div>
    <div class="sb-presets">${SB_QUICK_PRESETS.map(p => `<button type="button" class="sb-preset" ${pool.length ? '' : 'disabled'} onclick="sbQuickStart('${p.id}')"><strong>${p.label}</strong><small>${p.desc}</small></button>`).join('')}</div>
    <p class="sj-note sj-muted">Questions you have not attempted come first. Tapping a size starts the test straight away.</p>`;
  return { body, bar: sbBar(`${sbCount(pool.length)} available`, '') };
}
function sbRenderChoice(step) {
  const items = sbLevelItems(step);
  const hint = { board: 'Tap a board to continue.', exam: 'Tap an exam to continue.', year: 'Tap a year to continue.' }[step];
  const metaFor = it => step === 'exam' ? sbBoardOf(it.key) : '';
  const body = items.length ? `<p class="sb-hint">${hint}</p><div class="sb-list">${items.map(it => sbItemChoice(`sbChoose('${step}', ${nbJsAttr(it.key)})`, it.label, metaFor(it), it.count)).join('')}</div>`
    : `<div class="sj-empty"><strong>Nothing to choose here</strong><span>No questions match the earlier choices.</span></div>`;
  return { body, bar: sbBar(hint, '') };
}
function sbRenderMulti(level) {
  const items = sbLevelItems(level);
  const ex = SB[SB_EX_FOR[level]];
  const selected = items.filter(i => !ex.has(i.key)).length;
  const pool = sbCustomRows(level).length;
  const body = `<div class="sb-tools"><span>${selected} of ${items.length} selected</span><span><button type="button" class="sb-link" onclick="sbSetAll('${level}', true)">All</button><button type="button" class="sb-link" onclick="sbSetAll('${level}', false)">None</button></span></div>
    <div class="sb-list">${items.map(it => sbItemMulti(level, it, !ex.has(it.key))).join('')}</div>`;
  return { body, bar: sbBar(sbCount(pool), `<button type="button" class="btn-nav primary" ${pool ? '' : 'disabled'} onclick="sbForward()">Next →</button>`) };
}
function sbRenderType() {
  const rows = sbCustomRows('subtopic');
  const types = sbGroup(rows, sbTypeOf, r => SB_TYPE_LABEL[sbTypeOf(r)]);
  const diffs = sbGroup(rows, sbDiffOf, r => SB_DIFF_LABEL[sbDiffOf(r)]);
  const order = ['EASY', 'MODERATE', 'HARD', 'OTHER'];
  diffs.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  const pool = sbCustomRows('type').length;
  const chip = (kind, it, set) => { const on = !set.has(it.key); return `<button type="button" class="sb-chip ${on ? 'on' : ''}" aria-pressed="${on}" onclick="sbToggleType('${kind}', '${it.key}')">${on ? '✓ ' : ''}${escapeHtml(it.label)} <span>${it.count}</span></button>`; };
  const body = `<div class="sb-label">Question type</div><div class="sb-chips">${types.map(t => chip('type', t, SB.exType)).join('')}</div>
    <div class="sb-label">Difficulty</div><div class="sb-chips">${diffs.map(d => chip('diff', d, SB.exDiff)).join('')}</div>
    ${pool ? '' : '<p class="sj-note">No question matches this combination. Turn on at least one type and one difficulty.</p>'}`;
  return { body, bar: sbBar(sbCount(pool), `<button type="button" class="btn-nav primary" ${pool ? '' : 'disabled'} onclick="sbForward()">Next →</button>`) };
}
function sbQuestionRow(r, on) {
  const text = r.q.QUESTION_EN || r.q.QUESTION_HI || 'Question text unavailable';
  return `<button type="button" class="sb-item sb-q ${on ? 'on' : ''}" aria-pressed="${on}" onclick="sbTogglePicked(${nbJsAttr(r.id)})"><span class="sb-check" aria-hidden="true">${on ? '✓' : ''}</span><span class="sb-item-main"><strong>${escapeHtml(text)}</strong><small>Q.${escapeHtml(r.q.originalQNo ?? '')} · ${escapeHtml(r.topic)} · ${escapeHtml(sbSubtopic(r))} · ${escapeHtml(SB_DIFF_LABEL[sbDiffOf(r)])}</small></span></button>`;
}
function sbRenderQuestions() {
  const base = sbCustomRows('history');
  const attempted = sbAttemptedIds(); const wrong = sbWrongIds();
  const all = sbCustomRows('type');
  const unattN = all.filter(r => !attempted.has(r.id)).length;
  const wrongN = all.filter(r => wrong.has(r.id)).length;
  const histChip = (id, label, n) => `<button type="button" class="sb-chip ${SB.hist === id ? 'on' : ''}" aria-pressed="${SB.hist === id}" ${n ? '' : 'disabled'} onclick="sbSetHist('${id}')">${escapeHtml(label)} <span>${n}</span></button>`;
  let list = '';
  if (SB.pick === 'pick') {
    const cand = sbPickCandidates();
    list = `<div class="search-box-wrap" style="margin:10px 0 6px;"><span class="search-icon">🔍</span><input id="sbQSearch" type="search" class="search-input" aria-label="Search questions" placeholder="Search question text or Q number" value="${escapeHtml(SB.qSearch)}" oninput="sbQuestionSearch(this.value)"></div>
      <div class="sb-tools"><span>${SB.picked.size} chosen · ${cand.length} shown</span><span><button type="button" class="sb-link" onclick="sbPickVisible(true)">Choose visible</button><button type="button" class="sb-link" onclick="sbPickVisible(false)">Clear visible</button></span></div>
      <div class="sb-list">${cand.slice(0, SB.qShow).map(r => sbQuestionRow(r, SB.picked.has(r.id))).join('') || '<p class="sj-note">No question matches this search.</p>'}</div>
      ${cand.length > SB.qShow ? `<button type="button" class="btn-nav" style="width:100%;margin-top:8px;" onclick="SB.qShow+=60;sbRerender(false)">Show more (${cand.length - SB.qShow} left)</button>` : ''}`;
  }
  const pool = sbCustomRows('pick').length;
  const body = `<div class="sb-label">Which questions</div>
    <div class="sb-chips">${histChip('all', 'All questions', all.length)}${histChip('unattempted', 'Not attempted yet', unattN)}${histChip('wrong', 'My wrong answers', wrongN)}${histChip('bookmarked', '⭐ Bookmarked', all.filter(r => bookmarkedIds().has(r.id)).length)}</div>
    <div class="sb-label">How to choose</div>
    <div class="sb-seg" role="group" aria-label="How to choose questions"><button type="button" class="${SB.pick === 'all' ? 'on' : ''}" aria-pressed="${SB.pick === 'all'}" onclick="sbSetPick('all')">Pick automatically<small>${base.length} eligible</small></button><button type="button" class="${SB.pick === 'pick' ? 'on' : ''}" aria-pressed="${SB.pick === 'pick'}" onclick="sbSetPick('pick')">I'll choose myself<small>tick each question</small></button></div>
    ${list}`;
  return { body, bar: sbBar(SB.pick === 'pick' ? `<b>${SB.picked.size}</b> chosen` : `${sbCount(base.length)} eligible`, `<button type="button" class="btn-nav primary" ${pool ? '' : 'disabled'} onclick="sbForward()">Next →</button>`) };
}
function sbLangInfo(rows) {
  const hi = rows.filter(r => String(r.q.QUESTION_HI || '').trim()).length;
  const en = rows.filter(r => String(r.q.QUESTION_EN || r.q.QUESTION || '').trim()).length;
  return { hi, en, total: rows.length };
}
function sbRenderSettings() {
  sbSyncCountDefaults();
  const pool = sbCustomRows('pick');
  const n = pool.length;
  const L = sbLangInfo(pool);
  const short = SB.pick !== 'pick' && SB.count > n;
  const presets = [10, 20, 30, 50, 100].filter(x => x < n);
  const countHtml = SB.pick === 'pick' ? `<p class="sb-hint">You chose ${n} question${n === 1 ? '' : 's'} yourself.</p>`
    : `<div class="sb-chips">${presets.map(x => `<button type="button" class="sb-chip ${SB.count === x ? 'on' : ''}" data-sb-count="${x}" onclick="sbSetCount(${x})">${x}</button>`).join('')}<button type="button" class="sb-chip ${SB.count === Math.min(n, 500) ? 'on' : ''}" data-sb-count="${Math.min(n, 500)}" onclick="sbSetCount(${Math.min(n, 500)})">All ${Math.min(n, 500)}</button></div>
       <div class="sb-inline"><label for="sbCountIn">Or type a number</label><input id="sbCountIn" type="number" inputmode="numeric" min="1" max="500" value="${SB.count}" oninput="sbCountInput(this.value)"></div>
       <div id="sbWarn" class="sb-warn" ${short ? '' : 'hidden'}>Only ${n} question${n === 1 ? ' is' : 's are'} available. <button type="button" class="btn-nav primary" onclick="sbSetCount(${n})">Use ${n}</button></div>`;
  const langBtn = (id, label) => `<button type="button" class="${SB.lang === id ? 'on' : ''}" aria-pressed="${SB.lang === id}" onclick="sbSet('lang','${id}')">${label}</button>`;
  const body = `<div class="sb-label">Number of questions</div>${countHtml}
    <div class="sb-label">Time</div>
    <div class="sb-inline"><label for="sbMinIn">Minutes</label><input id="sbMinIn" type="number" inputmode="numeric" min="1" max="300" value="${SB.minutes}" oninput="sbMinutesInput(this.value)"></div>
    <p class="sj-note sj-muted">${SB.minutesTouched ? 'Custom time.' : 'Suggested: 1 minute per question.'}</p>
    <div class="sb-label">Language</div>
    <div class="sb-seg" role="group" aria-label="Question language">${langBtn('both', 'English + हिंदी')}${langBtn('en', 'English')}${langBtn('hi', 'हिंदी')}</div>
    <p class="sj-note ${SB.lang === 'hi' && L.hi < L.total ? '' : 'sj-muted'}">${L.hi} of ${L.total} eligible questions have Hindi text${SB.lang === 'hi' && L.hi < L.total ? '; the others will show in English.' : '.'}</p>
    <div class="sb-label">Order</div>
    <button type="button" class="sb-toggle ${SB.shuffle ? 'on' : ''}" aria-pressed="${SB.shuffle}" onclick="sbSet('shuffle', ${!SB.shuffle})"><span class="sb-toggle-knob" aria-hidden="true"></span>Shuffle questions</button>
    <button type="button" class="btn-nav" style="width:100%;margin-top:16px;" onclick="sbOpenSaveTemplate()">⭐ Save these settings as a template</button>`;
  const count = SB.pick === 'pick' ? n : Math.min(SB.count, n);
  return { body, bar: sbBar(`${sbCount(count)} · ${SB.minutes} min`, `<button type="button" id="sbPrimary" class="btn-nav primary" ${!n || short ? 'disabled' : ''} onclick="sbForward()">Preview →</button>`) };
}
function sbDistribution(rows) {
  const g = sbGroup(rows, r => r.subject + SB_SEP + r.topic, r => `${sbSubjectLabel(r.subject)} › ${r.topic}`).sort((a, b) => b.count - a.count);
  const max = Math.max(1, ...g.map(x => x.count));
  return sjBarRows(g.slice(0, 8).map(x => ({ label: x.label, value: x.count, valueLabel: `${x.count} Q` })), max, null);
}
function sbRenderPreview() {
  const byId = new Map(sbAll().map(r => [r.id, r]));
  const rows = SB.previewIds.map(id => byId.get(id)).filter(Boolean);
  if (rows.length !== SB.previewIds.length) SB.previewIds = rows.map(r => r.id);
  const body = rows.length ? `
    <div class="sb-summary"><div><b>${rows.length}</b><span>Questions</span></div><div><b>${SB.minutes}</b><span>Minutes</span></div><div><b>${new Set(rows.map(r => r.topic)).size}</b><span>Topics</span></div></div>
    <div class="sj-bars" style="margin:10px 0 4px;">${sbDistribution(rows)}</div>
    <div class="sb-label">Questions in this test</div>
    <ol class="sb-preview">${rows.map((r, i) => `<li><div class="sb-pq-main"><strong>${i + 1}. ${escapeHtml(r.q.QUESTION_EN || r.q.QUESTION_HI || 'Question text unavailable')}</strong><small>${escapeHtml(sbSubjectLabel(r.subject))} › ${escapeHtml(r.topic)} · ${escapeHtml(SB_DIFF_LABEL[sbDiffOf(r)])}</small></div><div class="sb-pq-actions"><button type="button" aria-label="Replace question ${i + 1}" title="Replace" onclick="sbReplaceInPreview(${nbJsAttr(r.id)})">↻</button><button type="button" aria-label="Remove question ${i + 1}" title="Remove" onclick="sbRemoveFromPreview(${nbJsAttr(r.id)})">✕</button></div></li>`).join('')}</ol>`
    : `<div class="sj-empty"><strong>Preview is empty</strong><span>Go back and change your selection.</span></div>`;
  return { body, bar: sbBar(`${sbCount(rows.length)} · ${SB.minutes} min`, `<button type="button" class="btn-nav primary" ${rows.length ? '' : 'disabled'} onclick="sbGo('instructions')">Continue →</button>`) };
}
function sbRenderPyq() {
  if (SB.step === 'pyq_exam') {
    const items = sbPyqExams();
    return { body: `<p class="sb-hint">Only questions marked as PYQ are used.</p><div class="sb-list">${items.map(it => sbItemChoice(`sbPyqChoose('exam', ${nbJsAttr(it.key)})`, it.label, it.meta, it.count)).join('')}</div>`, bar: sbBar('Tap an exam to continue.', '') };
  }
  if (SB.step === 'pyq_year') {
    const items = sbPyqYears();
    return { body: `<div class="sb-list">${items.map(it => sbItemChoice(`sbPyqChoose('year', ${nbJsAttr(it.key)})`, it.label, sbExamName(SB.pyqExam), it.count)).join('')}</div>`, bar: sbBar('Tap a year to continue.', '') };
  }
  if (SB.step === 'pyq_shift') {
    const items = sbPyqShifts();
    const total = items.reduce((a, b) => a + b.count, 0);
    return { body: `<div class="sb-list">${items.length > 1 ? sbItemChoice(`sbPyqChoose('shift', '*')`, 'All papers of this year', `${items.length} papers`, total) : ''}${items.map(it => sbItemChoice(`sbPyqChoose('shift', ${nbJsAttr(it.key)})`, it.label, `${sbExamName(SB.pyqExam)} ${SB.pyqYear}`, it.count)).join('')}</div>`, bar: sbBar('Tap a paper to continue.', '') };
  }
  const paper = sbPyqPaperRows();
  const subjects = sbGroup(paper, r => r.subject, r => sbSubjectLabel(r.subject)).sort((a, b) => a.label.localeCompare(b.label));
  const final = sbPyqFinalRows();
  if (!SB.pyqMinutesTouched) SB.pyqMinutes = Math.max(1, final.length);
  const allPyq = sbAll().filter(r => r.examId === SB.pyqExam && r.year === SB.pyqYear && nbVerifiedPYQ(r));
  const blocked = allPyq.length - sbPyqRows().filter(r => r.examId === SB.pyqExam && r.year === SB.pyqYear).length;
  const body = `<div class="sb-paper"><strong>${escapeHtml(sbExamName(SB.pyqExam))} · ${escapeHtml(SB.pyqYear)}</strong><small>${SB.pyqShift === '*' ? 'All papers' : escapeHtml(SB.pyqShift)} · original question order</small></div>
    <div class="sb-label">What to attempt</div>
    <div class="sb-list">
      <button type="button" class="sb-item ${SB.pyqScope === 'full' ? 'on' : ''}" aria-pressed="${SB.pyqScope === 'full'}" onclick="sbPyqSetScope('full')"><span class="sb-check" aria-hidden="true">${SB.pyqScope === 'full' ? '✓' : ''}</span><span class="sb-item-main"><strong>Full paper</strong><small>All subjects</small></span><span class="sb-count">${paper.length}</span></button>
      ${subjects.length > 1 ? subjects.map(s => { const on = SB.pyqScope === 'subject' && SB.pyqSubject === s.key; return `<button type="button" class="sb-item ${on ? 'on' : ''}" aria-pressed="${on}" onclick="sbPyqSetScope('subject', ${nbJsAttr(s.key)})"><span class="sb-check" aria-hidden="true">${on ? '✓' : ''}</span><span class="sb-item-main"><strong>Only ${escapeHtml(s.label)}</strong></span><span class="sb-count">${s.count}</span></button>`; }).join('') : ''}
    </div>
    <div class="sb-inline" style="margin-top:12px;"><label for="sbPyqMin">Minutes</label><input id="sbPyqMin" type="number" inputmode="numeric" min="1" max="300" value="${SB.pyqMinutes}" oninput="sbPyqMinutesInput(this.value)"></div>
    <p class="sj-note sj-muted">${SB.pyqMinutesTouched ? 'Custom time.' : 'Suggested: 1 minute per question.'}${final.length > 500 ? ' Only the first 500 questions are used.' : ''}</p>
    ${blocked > 0 ? `<p class="sj-note">${blocked} question(s) of this exam/year are not included because their source exam/year differs from their topic's assignment. <button type="button" class="sj-inline-link" onclick="openDataControlModal()">Review in Data Control</button></p>` : ''}`;
  return { body, bar: sbBar(`${sbCount(Math.min(final.length, 500))} · ${SB.pyqMinutes} min`, `<button type="button" class="btn-nav primary" ${final.length ? '' : 'disabled'} onclick="sbPyqToInstructions()">Continue →</button>`) };
}
function sbRenderInstructions() {
  const byId = new Map(sbAll().map(r => [r.id, r]));
  const rows = SB.previewIds.map(id => byId.get(id)).filter(Boolean);
  const L = sbLangInfo(rows);
  const subjects = sbGroup(rows, r => r.subject, r => sbSubjectLabel(r.subject));
  const langBtn = (id, label) => `<button type="button" class="${SB.lang === id ? 'on' : ''}" aria-pressed="${SB.lang === id}" onclick="sbSet('lang','${id}')">${label}</button>`;
  const body = rows.length ? `
    <div class="sb-paper"><strong>${escapeHtml(SB.mode === 'pyq' ? SB.title : (SB.hist === 'wrong' ? 'Mistakes Test' : 'Custom Test'))}</strong><small>${escapeHtml(sbExamName(rows[0].examId))} · ${escapeHtml(rows[0].year)}</small></div>
    <div class="sb-summary"><div><b>${rows.length}</b><span>Questions</span></div><div><b>${SB.minutes}</b><span>Minutes</span></div><div><b>${subjects.length}</b><span>Subject${subjects.length === 1 ? '' : 's'}</span></div></div>
    <ul class="sb-rules">
      <li><b>Marking:</b> +1 for each correct answer. Wrong or skipped answers get 0 (no negative marking).</li>
      <li><b>Timer:</b> runs from the start; the test submits itself when time is over.</li>
      <li><b>Moving around:</b> use Previous / Save &amp; Next, or ▦ to jump to any question. Use Mark for Review to come back later.</li>
      <li><b>Safety:</b> if the page reloads, your answers and time are restored. Leaving the test asks for confirmation.</li>
    </ul>
    <div class="sb-label">Language</div>
    <div class="sb-seg" role="group" aria-label="Question language">${langBtn('both', 'English + हिंदी')}${langBtn('en', 'English')}${langBtn('hi', 'हिंदी')}</div>
    <p class="sj-note sj-muted">${L.hi} of ${L.total} questions have Hindi text. You can switch language inside the test with A/अ.</p>`
    : `<div class="sj-empty"><strong>Nothing to start</strong><span>Go back and choose questions.</span></div>`;
  return { body, bar: sbBar(`${sbCount(rows.length)} · ${SB.minutes} min`, `<button type="button" class="btn-nav primary" ${rows.length ? '' : 'disabled'} onclick="sbStartFromInstructions()">I'm ready — Start</button>`) };
}
function sbRender(v) {
  SBCache = null;
  if (!SB.inited) SB = sbLoadDraft() || sbFresh();
  if (WorkspaceManager.current().type === 'BOARD') {
    v.innerHTML = `<div class="sb-shell"><header class="sb-top"><button type="button" class="sb-back" onclick="navigate('home')">← Back</button><div class="sb-title">Create a test</div></header><div class="sb-body"><div class="sj-empty"><strong>Test Builder is for competitive exam workspaces</strong><span>Switch to a competitive workspace to build a test.</span><button type="button" class="btn-nav" onclick="openWorkspaceSwitcher()">Switch workspace</button></div></div></div>`;
    return;
  }
  let out;
  const s = SB.step;
  if (s === 'mode') out = sbRenderMode();
  else if (s === 'quick') out = sbRenderQuick();
  else if (s.startsWith('pyq_')) out = sbRenderPyq();
  else if (s === 'board' || s === 'exam' || s === 'year') out = sbRenderChoice(s);
  else if (s === 'subject' || s === 'topic' || s === 'subtopic') out = sbRenderMulti(s);
  else if (s === 'type') out = sbRenderType();
  else if (s === 'questions') out = sbRenderQuestions();
  else if (s === 'settings') out = sbRenderSettings();
  else if (s === 'preview') { if (!SB.previewIds.length && SB.mode === 'custom') sbBuildPreview(); out = sbRenderPreview(); }
  else if (s === 'instructions') out = sbRenderInstructions();
  else { SB = sbFresh(); out = sbRenderMode(); }
  v.innerHTML = `<div class="sb-shell" data-step="${escapeHtml(SB.step)}">
    <header class="sb-top"><button type="button" class="sb-back" onclick="sbBack()" aria-label="Back">← Back</button><div class="sb-title">${escapeHtml(SB_TITLES[SB.step] || 'Create a test')}</div>${SB.step !== 'mode' ? `<button type="button" class="sb-restart" onclick="sbStartOver()">Start over</button>` : ''}</header>
    ${sbCrumbs()}
    <div class="sb-body" id="sbBody">${out.body}</div>
    <footer class="sb-bar">${out.bar}</footer>
  </div>`;
  sbSaveDraft();
}
function sbStartOver() { const keep = BuilderTemplates; sbReset(); BuilderTemplates = keep; sbRerender(true); }
function renderNativeBuilder(v) { sbRender(v); }


/* DC-06 LIB-01 — Digital Library route.
   No verified resource manifest is present in this source baseline; do not fabricate entries or links. */
function renderDigitalLibrary(v) {
  v.innerHTML = `
    <div class="nav-breadcrumb"><button class="btn-nav" onclick="navigate('home')">← Home</button><span>›</span><strong>Digital Library</strong></div>
    <div class="section-title"><span>📖 Digital Library</span></div>
    <div class="card-btn" role="status" aria-live="polite">
      <strong>📚 No verified library resources available yet</strong>
      <small>इस समय उपलब्ध स्रोतों में सत्यापित Library resources की सूची नहीं मिली। कोई नकली resource या dead link नहीं दिखाया गया है। सामग्री सत्यापित होने पर ही यहाँ दिखाई जाएगी।</small>
    </div>
    <div style="margin-top:12px;">
      <button class="btn-nav" onclick="navigate('subjects')">Browse existing subjects</button>
    </div>
  `;
}
