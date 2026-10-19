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
/** Return the localized label for a theory, numerical or unknown question type. */
function sbTypeLabel(key) {
  return tx(
    SB_TYPE_LABEL[key],
    { NUMERICAL: "संख्यात्मक", THEORY: "सैद्धांतिक", OTHER: "अवर्गीकृत" }[key],
  );
}
/** Return the localized label for a known difficulty, falling back to Other. */
function sbDiffLabel(key) {
  return tx(
    SB_DIFF_LABEL[key],
    { EASY: "आसान", MODERATE: "मध्यम", HARD: "कठिन", OTHER: "कठिनाई तय नहीं" }[
      key
    ],
  );
}
/** Return a quick-test preset label in the current interface language. */
function sbPresetLabel(preset) {
  return tx(
    preset.label,
    { daily: "रोज़ के 10", speed: "तेज़ 20", full: "पूरे 30" }[preset.id],
  );
}
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
/** Update count, duration and start controls in place, then save the builder draft. */
function sbSettingsRefresh() {
  const n = sbCustomRows("pick").length;
  const short = SB.pick !== "pick" && SB.count > n;
  const w = document.getElementById("sbWarn");
  if (w) w.hidden = !short;
  document
    .querySelectorAll("[data-sb-count]")
    .forEach((b) =>
      b.classList.toggle("on", Number(b.dataset.sbCount) === SB.count),
    );
  const info = document.getElementById("sbBarInfo");
  if (info)
    info.innerHTML = `${sbCount(SB.pick === "pick" ? n : Math.min(SB.count, n))} · ${SB.minutes} ${tx("min", "मिनट")}`;
  const btn = document.getElementById("sbPrimary");
  if (btn) btn.disabled = !n || short;
  sbSaveDraft();
}
/** Validate and clamp the typed PYQ duration, update its summary and save the draft. */
function sbPyqMinutesInput(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1) return;
  SB.pyqMinutes = Math.min(300, n);
  SB.pyqMinutesTouched = true;
  const info = document.getElementById("sbBarInfo");
  if (info)
    info.innerHTML = `${sbCount(Math.min(sbPyqFinalRows().length, 500))} · ${SB.pyqMinutes} ${tx("min", "मिनट")}`;
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
/** Remove a preview question while retaining at least one and adjusting automatic duration. */
function sbRemoveFromPreview(id) {
  if (SB.previewIds.length <= 1) {
    openCustomToast(
      tx(
        "A test needs at least one question.",
        "टेस्ट में कम से कम एक सवाल होना चाहिए।",
      ),
    );
    return;
  }
  SB.previewIds = SB.previewIds.filter((x) => x !== id);
  if (!SB.minutesTouched) SB.minutes = SB.previewIds.length;
  sbRerender(false);
}
/** Replace a preview question with an unused eligible question from the same exam and year. */
function sbReplaceInPreview(id) {
  const used = new Set(SB.previewIds);
  const pool = (SB.mode === "custom" ? sbCustomRows("pick") : sbAll()).filter(
    (r) => !used.has(r.id) && r.examId === SB.examId && r.year === SB.year,
  );
  if (!pool.length) {
    openCustomToast(
      tx(
        "No other eligible question is available for this selection.",
        "इस चयन के लिए कोई दूसरा योग्य सवाल उपलब्ध नहीं है।",
      ),
    );
    return;
  }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  SB.previewIds = SB.previewIds.map((x) => (x === id ? pick.id : x));
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
/** Prepare up to 500 selected PYQ questions and advance to the instructions step. */
function sbPyqToInstructions() {
  const rows = sbPyqFinalRows().slice(0, 500);
  if (!rows.length) {
    openCustomToast(tx("Choose a paper first.", "पहले एक पेपर चुनें।"));
    return;
  }
  SB.previewIds = rows.map((r) => r.id);
  SB.examId = rows[0].examId;
  SB.year = rows[0].year;
  SB.minutes = SB.pyqMinutesTouched ? SB.pyqMinutes : rows.length;
  SB.title = `PYQ · ${sbExamName(SB.pyqExam)} ${SB.pyqYear}${SB.pyqShift && SB.pyqShift !== "*" ? " · " + SB.pyqShift : ""}`;
  sbGo("instructions");
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
/** Launch a preset test, preferring unattempted questions and scaling time for a smaller pool. */
function sbQuickStart(presetId) {
  const p = SB_QUICK_PRESETS.find((x) => x.id === presetId);
  const rows = sbQuickRows();
  if (!p || !rows.length) {
    openCustomToast(
      tx(
        "Choose at least one subject with questions.",
        "कम से कम एक ऐसा विषय चुनें जिसमें सवाल हों।",
      ),
    );
    return;
  }
  const seen = sbAttemptedIds();
  const fresh = sbShuffle(rows.filter((r) => !seen.has(r.id)));
  const old = sbShuffle(rows.filter((r) => seen.has(r.id)));
  const ids = sbGroupBySubject([...fresh, ...old].slice(0, p.n)).map(
    (r) => r.id,
  );
  const minutes =
    ids.length < p.n
      ? Math.max(1, Math.round((p.min * ids.length) / p.n))
      : p.min;
  const ok = sbLaunch(
    ids,
    minutes,
    "both",
    tx(`Quick Test · ${p.label}`, `झटपट टेस्ट · ${sbPresetLabel(p)}`),
  );
  if (ok && ids.length < p.n)
    setTimeout(
      () =>
        openCustomToast(
          tx(
            `Only ${ids.length} questions were available, so the test has ${ids.length} questions and ${minutes} min.`,
            `केवल ${ids.length} सवाल उपलब्ध थे, इसलिए टेस्ट में ${ids.length} सवाल और ${minutes} मिनट हैं।`,
          ),
        ),
      60,
    );
}

/* ---------- templates ---------- */
/** Return a workspace-scoped template of current filters and settings, without fixed question IDs. */
function sbTemplateFromState(name) {
  return {
    v: 1,
    id: "T-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
    ws: WorkspaceManager.current().id,
    name:
      String(name || "")
        .trim()
        .slice(0, 60) || tx("My test", "मेरा टेस्ट"),
    createdAt: new Date().toISOString(),
    board: SB.board,
    examId: SB.examId,
    year: SB.year,
    exSubject: [...SB.exSubject],
    exTopic: [...SB.exTopic],
    exSubtopic: [...SB.exSubtopic],
    exType: [...SB.exType],
    exDiff: [...SB.exDiff],
    hist: SB.hist,
    count: SB.count,
    minutes: SB.minutes,
    lang: SB.lang,
    shuffle: SB.shuffle,
  };
}
/** Open the template naming dialog with a summary of the saved settings. */
function sbOpenSaveTemplate() {
  openModal(
    tx("⭐ Save as template", "⭐ टेम्पलेट के रूप में सहेजें"),
    `<label for="sbTplName" style="display:block;font-size:12px;font-weight:800;color:var(--text-muted);margin-bottom:6px;">${tx("Template name", "टेम्पलेट का नाम")}</label><input id="sbTplName" class="search-input" style="padding-left:14px;margin:0;" maxlength="60" placeholder="${tx("e.g. Daily Maths 20", "जैसे रोज़ के 20 गणित सवाल")}" value="${escapeHtml(sbExamName(SB.examId) + " · " + SB.count + tx(" Q", " सवाल"))}"><p class="sj-note sj-muted">${tx("Saves the filters and settings, not a fixed set of questions. Each run picks fresh questions.", "फ़िल्टर और सेटिंग सहेजी जाएँगी, सवालों की तय सूची नहीं। हर बार नए सवाल चुने जाएँगे।")}</p><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;"><button class="btn-nav" onclick="closeModal()">${tx("Cancel", "रद्द करें")}</button><button class="btn-nav primary" onclick="sbSaveTemplate(document.getElementById('sbTplName').value)">${tx("Save", "सहेजें")}</button></div>`,
  );
}
/** Save the named selection template, retain the newest 30 and close the dialog. */
function sbSaveTemplate(name) {
  BuilderTemplates.unshift(sbTemplateFromState(name));
  if (BuilderTemplates.length > 30) BuilderTemplates.length = 30;
  saveBuilderTemplates();
  closeModal();
  openCustomToast(
    tx(
      "Template saved. Find it on the first Builder screen.",
      "टेम्पलेट सहेजा गया। यह टेस्ट बनाने की पहली स्क्रीन पर मिलेगा।",
    ),
  );
}
/** Delete a saved template after confirmation and refresh the builder. */
function sbDeleteTemplate(id) {
  const t = BuilderTemplates.find((x) => x.id === id);
  if (
    !t ||
    !confirm(tx(`Delete template "${t.name}"?`, `टेम्पलेट "${t.name}" हटाएँ?`))
  )
    return;
  BuilderTemplates = BuilderTemplates.filter((x) => x.id !== id);
  saveBuilderTemplates();
  sbRerender(false);
}
/** Load a template for the current workspace, rejecting an exam/year with no available questions. */
function sbApplyTemplate(id) {
  const t = BuilderTemplates.find(
    (x) => x.id === id && x.ws === WorkspaceManager.current().id,
  );
  if (!t) return;
  const keep = BuilderTemplates;
  SB = sbFresh();
  BuilderTemplates = keep;
  SB.mode = "custom";
  SB.board = t.board;
  SB.examId = t.examId;
  SB.year = t.year;
  ["exSubject", "exTopic", "exSubtopic", "exType", "exDiff"].forEach((k) => {
    SB[k] = new Set(t[k] || []);
  });
  SB.hist = t.hist || "all";
  SB.count = t.count || 20;
  SB.countTouched = true;
  SB.minutes = t.minutes || SB.count;
  SB.minutesTouched = true;
  SB.lang = t.lang || "both";
  SB.shuffle = t.shuffle !== false;
  if (!sbAll().some((r) => r.examId === SB.examId && r.year === SB.year)) {
    openCustomToast(
      tx(
        "The exam/year of this template has no questions now.",
        "इस टेम्पलेट की परीक्षा और वर्ष के लिए अभी सवाल नहीं हैं।",
      ),
    );
    SB = sbFresh();
    BuilderTemplates = keep;
    sbRerender(true);
    return;
  }
  SB.stack = ["mode", "subject"];
  SB.step = "settings";
  sbRerender(true);
}

/* ---------- entry points from other screens ---------- */
/** Initialize a custom test selection for one topic and navigate to its settings. */
function sbOpenForModule(moduleId) {
  const m = getWorkspaceModule(moduleId);
  const rows = sbAll().filter((r) => r.mod.moduleId === moduleId);
  SBCache = null;
  if (!m || !rows.length) {
    openCustomToast(
      tx(
        "This topic has no questions available for a test.",
        "इस टॉपिक में टेस्ट के लिए सवाल उपलब्ध नहीं हैं।",
      ),
    );
    return;
  }
  const keep = BuilderTemplates;
  SB = sbFresh();
  BuilderTemplates = keep;
  SB.mode = "custom";
  SB.examId = rows[0].examId;
  SB.year = rows[0].year;
  SB.board = sbBoardOf(SB.examId);
  const ctx = sbAll().filter(
    (r) => r.examId === SB.examId && r.year === SB.year,
  );
  ctx.forEach((r) => {
    if (r.subject !== rows[0].subject) SB.exSubject.add(r.subject);
    else if (r.mod.moduleId !== moduleId) SB.exTopic.add(sbTopicKey(r));
  });
  SB.count = Math.min(10, rows.length);
  SB.countTouched = true;
  SB.minutes = SB.count;
  SB.stack = ["mode", "topic"];
  SB.step = "settings";
  navigate("native_builder");
}
/** Open a custom test of saved mistakes from the first available exam/year context. */
function sbOpenMistakeTest() {
  SBCache = null;
  const wrong = sbWrongIds();
  const rows = sbAll().filter((r) => wrong.has(r.id));
  if (!rows.length) {
    openCustomToast(
      tx(
        "No saved mistakes are available for a test yet.",
        "अभी टेस्ट के लिए कोई सहेजी हुई गलती उपलब्ध नहीं है।",
      ),
    );
    return;
  }
  const ctx = sbContexts(rows)[0];
  const keep = BuilderTemplates;
  SB = sbFresh();
  BuilderTemplates = keep;
  SB.mode = "custom";
  SB.examId = ctx.examId;
  SB.year = ctx.year;
  SB.board = sbBoardOf(ctx.examId);
  SB.hist = "wrong";
  SB.count = Math.min(20, ctx.count);
  SB.countTouched = true;
  SB.minutes = SB.count;
  SB.stack = ["mode", "subject"];
  SB.step = "settings";
  navigate("native_builder");
  if (sbContexts(rows).length > 1)
    setTimeout(
      () =>
        openCustomToast(
          tx(
            `Showing mistakes from ${sbExamName(ctx.examId)} ${ctx.year}. One test uses one exam and year.`,
            `${sbExamName(ctx.examId)} ${ctx.year} की गलतियाँ दिखाई जा रही हैं। एक टेस्ट में एक ही परीक्षा और वर्ष होता है।`,
          ),
        ),
      60,
    );
}

/* ---------- launch (single path for all modes) ---------- */
/** Validate unique questions from one exam/year and launch a CBT session; return whether it started. */
function sbLaunch(ids, minutes, lang, title) {
  if (ActiveTestSession?.sessionStatus === "ACTIVE") {
    openCustomToast(
      tx(
        "A test is already running. Submit or exit it first.",
        "एक टेस्ट पहले से चल रहा है। पहले उसे जमा करें या उससे बाहर निकलें।",
      ),
    );
    return false;
  }
  SBCache = null;
  const byId = new Map(sbAll().map((r) => [r.id, r]));
  if (
    !ids.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !byId.has(id))
  ) {
    openCustomToast(
      tx(
        "The selection changed. Please review it again.",
        "चयन बदल गया है। कृपया इसे फिर से जाँचें।",
      ),
    );
    return false;
  }
  const rows = ids.map((id) => byId.get(id));
  const f = rows[0];
  if (rows.some((r) => r.examId !== f.examId || r.year !== f.year)) {
    openCustomToast(
      tx(
        "All questions in one test must be from the same exam and year.",
        "एक टेस्ट के सभी सवाल एक ही परीक्षा और वर्ष के होने चाहिए।",
      ),
    );
    return false;
  }
  const spec = {
    version: 1,
    questionIds: ids.slice(),
    durationMinutes: Math.max(
      1,
      Math.min(300, Math.round(Number(minutes) || ids.length)),
    ),
    langMode: ["both", "en", "hi"].includes(lang) ? lang : "both",
    shuffleQuestions: false,
    fingerprint: ids.join("|"),
    title: String(title || "Custom Test").slice(0, 80),
  };
  const before = ActiveTestSession;
  initTestSession(f.mod.moduleId, f.group.groupId, 0, null, {
    sessionSpec: spec,
  });
  if (
    !ActiveTestSession ||
    ActiveTestSession === before ||
    ActiveTestSession.sessionStatus !== "ACTIVE" ||
    ActiveTestSession.questionIds.join("|") !== ids.join("|")
  ) {
    if (ActiveTestSession !== before) ActiveTestSession = before;
    openCustomToast(
      tx(
        "The test could not start. Please go back to Preview and try again.",
        "टेस्ट शुरू नहीं हुआ। पूर्वावलोकन पर वापस जाकर फिर कोशिश करें।",
      ),
    );
    return false;
  }
  sbReset();
  return true;
}
/** Return the PYQ title or a localized title for the selected custom-test history filter. */
function sbTestTitle() {
  if (SB.mode === "pyq") return SB.title;
  if (SB.hist === "wrong") return tx("Mistakes Test", "गलतियों का टेस्ट");
  if (SB.hist === "bookmarked") return tx("Bookmarks Test", "बुकमार्क टेस्ट");
  return tx("Custom Test", "अपना टेस्ट");
}
/** Launch the previewed questions using the chosen duration, language and test title. */
function sbStartFromInstructions() {
  sbLaunch(SB.previewIds.slice(), SB.minutes, SB.lang, sbTestTitle());
}

// Change the builder selection without changing the student's downloaded profile.
/** Return exam/year choices from eligible PYQ rows or all rows for the current builder mode. */
function sbContextChoices() { return sbContexts(SB.mode === 'pyq' ? sbPyqRows() : sbAll()); }
/** Show available builder exam/year contexts with question counts or empty-state guidance. */
function sbOpenContextPicker() {
  const choices = sbContextChoices();
  openModal(tx('Choose exam and year', 'परीक्षा और वर्ष चुनें'), `
    <p class="sj-note">${tx('Choosing an exam starts a new test selection.', 'परीक्षा चुनने पर टेस्ट का चयन फिर से शुरू होगा।')}</p>
    <div class="sb-list">${choices.map(c => sbItemChoice(`sbChooseContext(${nbJsAttr(c.key)})`, sbExamName(c.examId), c.year, c.count)).join('') || studyEmptyState()}</div>`);
}
/** Reset the selection to a valid exam/year while retaining the current builder mode. */
function sbChooseContext(key) {
  const choice = sbContextChoices().find(c => c.key === key);
  if (!choice) return;
  const mode = SB.mode || 'custom';
  SB = sbFresh(); SB.mode = mode; SB.stack = ['mode'];
  if (mode === 'quick') { SB.quickCtx = key; SB.step = 'quick'; }
  else if (mode === 'pyq') {
    SB.pyqExam = choice.examId; SB.pyqYear = choice.year; SB.step = 'pyq_shift';
    SB.stack.push('pyq_exam', 'pyq_year'); sbPyqAutoAdvance();
  } else {
    SB.board = sbBoardOf(choice.examId); SB.examId = choice.examId; SB.year = choice.year;
    SB.stack.push('board', 'exam', 'year'); SB.step = 'subject';
  }
  closeModal(); sbRerender(true);
}

/* ---------- rendering ---------- */
function sbBar(left, buttonHtml) {
  return `<div class="sb-bar-info" id="sbBarInfo">${left}</div>${buttonHtml || ''}`;
}
/** Return localized question-count HTML with English singular/plural agreement. */
function sbCount(n) {
  return tx(`<b>${n}</b> question${n === 1 ? "" : "s"}`, `<b>${n}</b> सवाल`);
}
/** Return breadcrumb controls for completed and current builder steps. */
function sbCrumbs() {
  if (SB.mode !== "custom") return "";
  const parts = [];
  /** Append a breadcrumb, enabling jumps only to steps in the builder history. */
  const add = (step, label) =>
    parts.push(
      SB.stack.includes(step)
        ? `<button type="button" onclick="sbJump('${step}')">${escapeHtml(label)}</button>`
        : `<span>${escapeHtml(label)}</span>`,
    );
  if (SB.board) add("board", SB.board);
  if (SB.examId) add("exam", sbExamName(SB.examId));
  if (SB.year) add("year", SB.year);
  const idx = SB_CUSTOM_STEPS.indexOf(SB.step);
  if (idx > SB_CUSTOM_STEPS.indexOf("subject")) {
    const n = sbGroup(
      sbCustomRows("subject"),
      (r) => r.subject,
      (r) => "",
    ).length;
    add("subject", tx(`${n} subject${n === 1 ? "" : "s"}`, `${n} विषय`));
  }
  if (idx > SB_CUSTOM_STEPS.indexOf("topic")) {
    const n = sbGroup(sbCustomRows("topic"), sbTopicKey, (r) => "").length;
    add("topic", tx(`${n} topic${n === 1 ? "" : "s"}`, `${n} टॉपिक`));
  }
  if (!parts.length) return "";
  return `<nav class="sb-crumbs" aria-label="${tx("Your selection", "आपका चयन")}">${parts.join('<span class="sb-crumb-sep" aria-hidden="true">›</span>')}</nav>`;
}
const SB_TITLES = {
  mode: "Create Test",
  quick: "Quick Test",
  pyq_exam: "PYQ · Choose exam",
  pyq_year: "PYQ · Choose year",
  pyq_shift: "PYQ · Choose paper",
  pyq_scope: "PYQ · Paper",
  board: "Choose board",
  exam: "Choose exam",
  year: "Choose year",
  subject: "Choose subjects",
  topic: "Choose topics",
  subtopic: "Choose subtopics",
  type: "Question type & difficulty",
  questions: "Questions",
  settings: "Test settings",
  preview: "Preview",
  instructions: "Instructions",
};
function sbItemMulti(level, it, on) {
  return `<button type="button" class="sb-item ${on ? 'on' : ''}" aria-pressed="${on}" onclick="sbToggle('${level}', ${nbJsAttr(it.key)})"><span class="sb-check" aria-hidden="true">${on ? '✓' : ''}</span><span class="sb-item-main"><strong>${escapeHtml(it.label)}</strong>${it.meta ? `<small>${escapeHtml(it.meta)}</small>` : ''}</span><span class="sb-count">${it.count}</span></button>`;
}
function sbItemChoice(onclick, label, meta, count) {
  return `<button type="button" class="sb-item sb-choice" onclick="${onclick}"><span class="sb-item-main"><strong>${escapeHtml(label)}</strong>${meta ? `<small>${escapeHtml(meta)}</small>` : ''}</span><span class="sb-count">${count}</span><span class="sb-go" aria-hidden="true">›</span></button>`;
}
/** Return the builder mode chooser and templates saved for the current workspace. */
function sbRenderMode() {
  const all = sbAll();
  const pyqN = sbPyqRows().length;
  const mockReady = nbHasVerifiedMockPattern(UserState?.selectedExam);
  const tpls = BuilderTemplates.filter(
    (t) => t.ws === WorkspaceManager.current().id,
  );
  const body = `
    ${all.length ? "" : studyEmptyState()}
    <div class="sb-modes">
      <button type="button" class="sb-mode" ${all.length ? "" : "disabled"} onclick="sbStartMode('quick')"><span class="sb-mode-icon" aria-hidden="true">⚡</span><span class="sb-mode-copy"><strong>${tx("Quick Test", "झटपट टेस्ट")}</strong><small>${tx("Start in one tap. Pick subjects and a size.", "एक टैप में शुरू करें। विषय और सवालों की संख्या चुनें।")}</small></span><span class="sb-go" aria-hidden="true">›</span></button>
      <button type="button" class="sb-mode" ${pyqN ? "" : "disabled"} onclick="sbStartMode('pyq')"><span class="sb-mode-icon" aria-hidden="true">🎯</span><span class="sb-mode-copy"><strong>${tx("PYQ Test", "PYQ टेस्ट")}</strong><small>${pyqN ? tx(`Real past paper in original order · ${pyqN} questions marked PYQ`, `पुराना असली पेपर, मूल क्रम में · ${pyqN} PYQ सवाल`) : tx("No verified PYQ questions available for your selection", "आपके चयन में सत्यापित PYQ सवाल उपलब्ध नहीं हैं")}</small></span><span class="sb-go" aria-hidden="true">›</span></button>
      <button type="button" class="sb-mode" ${all.length ? "" : "disabled"} onclick="sbStartMode('custom')"><span class="sb-mode-icon" aria-hidden="true">⚙️</span><span class="sb-mode-copy"><strong>${tx("Custom Test", "अपना टेस्ट")}</strong><small>${tx("Build it step by step: board, exam, year, subject, topic, subtopic, type.", "बोर्ड, परीक्षा, वर्ष, विषय, टॉपिक, उपविषय और प्रकार चुनकर अपना टेस्ट बनाएँ।")}</small></span><span class="sb-go" aria-hidden="true">›</span></button>
    </div>
    <p class="sb-mock-note">${mockReady ? tx("Full Mock is available from the exam profile.", "पूरा मॉक टेस्ट परीक्षा प्रोफ़ाइल में उपलब्ध है।") : tx("Full Mock: available once a verified exam pattern is added.", "पूरा मॉक टेस्ट: सत्यापित परीक्षा पैटर्न जुड़ने पर उपलब्ध होगा।")}</p>
    ${tpls.length ? `<h3 class="sb-h3">${tx("⭐ My templates", "⭐ मेरे टेम्पलेट")}</h3><div class="sb-list">${tpls.map((t) => `<div class="sb-tpl"><button type="button" class="sb-item sb-choice" onclick="sbApplyTemplate(${nbJsAttr(t.id)})"><span class="sb-item-main"><strong>${escapeHtml(t.name)}</strong><small>${escapeHtml(sbExamName(t.examId))} ${escapeHtml(t.year)} · ${Number(t.count) || 0} ${tx("Q", "सवाल")} · ${Number(t.minutes) || 0} ${tx("min", "मिनट")}</small></span><span class="sb-go" aria-hidden="true">›</span></button><button type="button" class="sb-tpl-del" aria-label="${tx(`Delete template ${escapeHtml(t.name)}`, `टेम्पलेट ${escapeHtml(t.name)} हटाएँ`)}" onclick="sbDeleteTemplate(${nbJsAttr(t.id)})">✕</button></div>`).join("")}</div>` : ""}`;
  return {
    body,
    bar: sbBar(
      tx(
        `${sbCount(all.length)} in your bank`,
        `आपके बैंक में ${sbCount(all.length)}`,
      ),
      "",
    ),
  };
}
/** Return quick-test context, subject controls and available preset choices. */
function sbRenderQuick() {
  const ctxs = sbContexts();
  const key = sbQuickContextKey();
  const ctxRows = sbAll().filter((r) => r.examId + SB_SEP + r.year === key);
  const subjects = sbGroup(
    ctxRows,
    (r) => r.subject,
    (r) => sbSubjectLabel(r.subject),
  ).sort((a, b) => a.label.localeCompare(b.label));
  const pool = sbQuickRows();
  const body = `
    <label class="sb-label" for="sbQuickCtx">${tx("Exam", "परीक्षा")}</label>
    <select id="sbQuickCtx" class="sb-select" onchange="sbQuickSetContext(this.value)">${ctxs.map((c) => `<option value="${escapeHtml(c.key)}" ${c.key === key ? "selected" : ""}>${escapeHtml(sbExamName(c.examId))} · ${escapeHtml(c.year)} (${c.count})</option>`).join("")}</select>
    <div class="sb-label">${tx("Subjects", "विषय")}</div>
    <div class="sb-chips">${subjects
      .map((s) => {
        const on = !SB.quickEx.has(s.key);
        return `<button type="button" class="sb-chip ${on ? "on" : ""}" aria-pressed="${on}" onclick="sbQuickToggleSubject(${nbJsAttr(s.key)})">${on ? "✓ " : ""}${escapeHtml(s.label)} <span>${s.count}</span></button>`;
      })
      .join("")}</div>
    <div class="sb-label">${tx("Start a test", "टेस्ट शुरू करें")}</div>
    <div class="sb-presets">${SB_QUICK_PRESETS.map((p) => `<button type="button" class="sb-preset" ${pool.length ? "" : "disabled"} onclick="sbQuickStart('${p.id}')"><strong>${sbPresetLabel(p)}</strong><small>${tx(p.desc, `${p.n} सवाल · ${p.min} मिनट`)}</small></button>`).join("")}</div>
    <p class="sj-note sj-muted">${tx("Questions you have not attempted come first. Tapping a size starts the test straight away.", "जो सवाल आपने हल नहीं किए हैं वे पहले आते हैं। संख्या चुनते ही टेस्ट शुरू हो जाएगा।")}</p>`;
  return {
    body,
    bar: sbBar(
      tx(`${sbCount(pool.length)} available`, `${sbCount(pool.length)} उपलब्ध`),
      "",
    ),
  };
}
/** Return a board, exam or year chooser with counts and contextual guidance. */
function sbRenderChoice(step) {
  const items = sbLevelItems(step);
  const hint = {
    board: tx("Tap a board to continue.", "आगे बढ़ने के लिए बोर्ड चुनें।"),
    exam: tx("Tap an exam to continue.", "आगे बढ़ने के लिए परीक्षा चुनें।"),
    year: tx("Tap a year to continue.", "आगे बढ़ने के लिए वर्ष चुनें।"),
  }[step];
  /** Return a board label for exam choices, or no metadata for other choice steps. */
  const metaFor = (it) => (step === "exam" ? sbBoardOf(it.key) : "");
  const body = items.length
    ? `<p class="sb-hint">${hint}</p><div class="sb-list">${items.map((it) => sbItemChoice(`sbChoose('${step}', ${nbJsAttr(it.key)})`, it.label, metaFor(it), it.count)).join("")}</div>`
    : `<div class="sj-empty"><strong>${tx("Nothing to choose here", "यहाँ चुनने के लिए कुछ नहीं है")}</strong><span>${tx("No questions match the earlier choices.", "पिछले चयन से कोई सवाल नहीं मिला।")}</span></div>`;
  return { body, bar: sbBar(hint, "") };
}
/** Return inclusion controls for the subject, topic or subtopic selection step. */
function sbRenderMulti(level) {
  const items = sbLevelItems(level);
  const ex = SB[SB_EX_FOR[level]];
  const selected = items.filter((i) => !ex.has(i.key)).length;
  const pool = sbCustomRows(level).length;
  const body = `<div class="sb-tools"><span>${tx(`${selected} of ${items.length} selected`, `${items.length} में से ${selected} चुने गए`)}</span><span><button type="button" class="sb-link" onclick="sbSetAll('${level}', true)">${tx("All", "सभी")}</button><button type="button" class="sb-link" onclick="sbSetAll('${level}', false)">${tx("None", "कोई नहीं")}</button></span></div>
    <div class="sb-list">${items.map((it) => sbItemMulti(level, it, !ex.has(it.key))).join("")}</div>`;
  return {
    body,
    bar: sbBar(
      sbCount(pool),
      `<button type="button" class="btn-nav primary" ${pool ? "" : "disabled"} onclick="sbForward()">${tx("Next →", "आगे →")}</button>`,
    ),
  };
}
/** Return question-type and difficulty filters with eligible question counts. */
function sbRenderType() {
  const rows = sbCustomRows("subtopic");
  const types = sbGroup(rows, sbTypeOf, (r) => sbTypeLabel(sbTypeOf(r)));
  const diffs = sbGroup(rows, sbDiffOf, (r) => sbDiffLabel(sbDiffOf(r)));
  const order = ["EASY", "MODERATE", "HARD", "OTHER"];
  diffs.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  const pool = sbCustomRows("type").length;
  /** Return a filter chip showing whether its key is included in the selection. */
  const chip = (kind, it, set) => {
    const on = !set.has(it.key);
    return `<button type="button" class="sb-chip ${on ? "on" : ""}" aria-pressed="${on}" onclick="sbToggleType('${kind}', '${it.key}')">${on ? "✓ " : ""}${escapeHtml(it.label)} <span>${it.count}</span></button>`;
  };
  const body = `<div class="sb-label">${tx("Question type", "सवाल का प्रकार")}</div><div class="sb-chips">${types.map((t) => chip("type", t, SB.exType)).join("")}</div>
    <div class="sb-label">${tx("Difficulty", "कठिनाई")}</div><div class="sb-chips">${diffs.map((d) => chip("diff", d, SB.exDiff)).join("")}</div>
    ${pool ? "" : `<p class="sj-note">${tx("No question matches this combination. Turn on at least one type and one difficulty.", "इस संयोजन से कोई सवाल नहीं मिला। कम से कम एक प्रकार और एक कठिनाई चुनें।")}</p>`}`;
  return {
    body,
    bar: sbBar(
      sbCount(pool),
      `<button type="button" class="btn-nav primary" ${pool ? "" : "disabled"} onclick="sbForward()">${tx("Next →", "आगे →")}</button>`,
    ),
  };
}
/** Return a selectable question row with its number, topic, subtopic and difficulty. */
function sbQuestionRow(r, on) {
  const text =
    r.q.QUESTION_EN ||
    r.q.QUESTION_HI ||
    tx("Question text unavailable", "सवाल का पाठ उपलब्ध नहीं है");
  return `<button type="button" class="sb-item sb-q ${on ? "on" : ""}" aria-pressed="${on}" onclick="sbTogglePicked(${nbJsAttr(r.id)})"><span class="sb-check" aria-hidden="true">${on ? "✓" : ""}</span><span class="sb-item-main"><strong>${escapeHtml(text)}</strong><small>Q.${escapeHtml(r.q.originalQNo ?? "")} · ${escapeHtml(r.topic)} · ${escapeHtml(sbSubtopic(r))} · ${escapeHtml(sbDiffLabel(sbDiffOf(r)))}</small></span></button>`;
}
/** Return question selection controls with search, answer-history filters and pagination. */
function sbRenderQuestions() {
  const base = sbCustomRows("history");
  const attempted = sbAttemptedIds();
  const wrong = sbWrongIds();
  const all = sbCustomRows("type");
  const unattN = all.filter((r) => !attempted.has(r.id)).length;
  const wrongN = all.filter((r) => wrong.has(r.id)).length;
  /** Return a history-filter chip with its matching question count and active state. */
  const histChip = (id, label, n) =>
    `<button type="button" class="sb-chip ${SB.hist === id ? "on" : ""}" aria-pressed="${SB.hist === id}" ${n ? "" : "disabled"} onclick="sbSetHist('${id}')">${escapeHtml(label)} <span>${n}</span></button>`;
  let list = "";
  if (SB.pick === "pick") {
    const cand = sbPickCandidates();
    list = `<div class="search-box-wrap" style="margin:10px 0 6px;"><span class="search-icon">🔍</span><input id="sbQSearch" type="search" class="search-input" aria-label="${tx("Search questions", "सवाल खोजें")}" placeholder="${tx("Search question text or Q number", "सवाल का पाठ या सवाल नंबर खोजें")}" value="${escapeHtml(SB.qSearch)}" oninput="sbQuestionSearch(this.value)"></div>
      <div class="sb-tools"><span>${tx(`${SB.picked.size} chosen · ${cand.length} shown`, `${SB.picked.size} चुने गए · ${cand.length} मिले`)}</span><span><button type="button" class="sb-link" onclick="sbPickVisible(true)">${tx("Choose visible", "दिख रहे सवाल चुनें")}</button><button type="button" class="sb-link" onclick="sbPickVisible(false)">${tx("Clear visible", "दिख रहे सवालों का चयन हटाएँ")}</button></span></div>
      <div class="sb-list">${
        cand
          .slice(0, SB.qShow)
          .map((r) => sbQuestionRow(r, SB.picked.has(r.id)))
          .join("") ||
        `<p class="sj-note">${tx("No question matches this search.", "इस खोज से कोई सवाल नहीं मिला।")}</p>`
      }</div>
      ${cand.length > SB.qShow ? `<button type="button" class="btn-nav" style="width:100%;margin-top:8px;" onclick="SB.qShow+=60;sbRerender(false)">${tx(`Show more (${cand.length - SB.qShow} left)`, `और दिखाएँ (${cand.length - SB.qShow} बाकी)`)}</button>` : ""}`;
  }
  const pool = sbCustomRows("pick").length;
  const body = `<div class="sb-label">${tx("Which questions", "कौन से सवाल")}</div>
    <div class="sb-chips">${histChip("all", tx("All questions", "सभी सवाल"), all.length)}${histChip("unattempted", tx("Not attempted yet", "अभी तक हल नहीं किए"), unattN)}${histChip("wrong", tx("My wrong answers", "मेरे गलत जवाब"), wrongN)}${histChip("bookmarked", tx("⭐ Bookmarked", "⭐ बुकमार्क किए"), all.filter((r) => bookmarkedIds().has(r.id)).length)}</div>
    <div class="sb-label">${tx("How to choose", "कैसे चुनें")}</div>
    <div class="sb-seg" role="group" aria-label="${tx("How to choose questions", "सवाल कैसे चुनें")}"><button type="button" class="${SB.pick === "all" ? "on" : ""}" aria-pressed="${SB.pick === "all"}" onclick="sbSetPick('all')">${tx("Pick automatically", "अपने आप चुनें")}<small>${tx(`${base.length} eligible`, `${base.length} उपलब्ध`)}</small></button><button type="button" class="${SB.pick === "pick" ? "on" : ""}" aria-pressed="${SB.pick === "pick"}" onclick="sbSetPick('pick')">${tx("I'll choose myself", "मैं खुद चुनूँगा")}<small>${tx("tick each question", "हर सवाल पर निशान लगाएँ")}</small></button></div>
    ${list}`;
  return {
    body,
    bar: sbBar(
      SB.pick === "pick"
        ? tx(
            `<b>${SB.picked.size}</b> chosen`,
            `<b>${SB.picked.size}</b> चुने गए`,
          )
        : tx(
            `${sbCount(base.length)} eligible`,
            `${sbCount(base.length)} उपलब्ध`,
          ),
      `<button type="button" class="btn-nav primary" ${pool ? "" : "disabled"} onclick="sbForward()">${tx("Next →", "आगे →")}</button>`,
    ),
  };
}
function sbLangInfo(rows) {
  const hi = rows.filter(r => String(r.q.QUESTION_HI || '').trim()).length;
  const en = rows.filter(r => String(r.q.QUESTION_EN || r.q.QUESTION || '').trim()).length;
  return { hi, en, total: rows.length };
}
/** Return count, duration, question-language and shuffle controls for the selection. */
function sbRenderSettings() {
  sbSyncCountDefaults();
  const pool = sbCustomRows("pick");
  const n = pool.length;
  const L = sbLangInfo(pool);
  const short = SB.pick !== "pick" && SB.count > n;
  const presets = [10, 20, 30, 50, 100].filter((x) => x < n);
  const countHtml =
    SB.pick === "pick"
      ? `<p class="sb-hint">${tx(`You chose ${n} question${n === 1 ? "" : "s"} yourself.`, `आपने खुद ${n} सवाल चुने हैं।`)}</p>`
      : `<div class="sb-chips">${presets.map((x) => `<button type="button" class="sb-chip ${SB.count === x ? "on" : ""}" data-sb-count="${x}" onclick="sbSetCount(${x})">${x}</button>`).join("")}<button type="button" class="sb-chip ${SB.count === Math.min(n, 500) ? "on" : ""}" data-sb-count="${Math.min(n, 500)}" onclick="sbSetCount(${Math.min(n, 500)})">${tx(`All ${Math.min(n, 500)}`, `सभी ${Math.min(n, 500)}`)}</button></div>
       <div class="sb-inline"><label for="sbCountIn">${tx("Or type a number", "या संख्या लिखें")}</label><input id="sbCountIn" type="number" inputmode="numeric" min="1" max="500" value="${SB.count}" oninput="sbCountInput(this.value)"></div>
       <div id="sbWarn" class="sb-warn" ${short ? "" : "hidden"}>${tx(`Only ${n} question${n === 1 ? " is" : "s are"} available.`, `केवल ${n} सवाल उपलब्ध हैं।`)} <button type="button" class="btn-nav primary" onclick="sbSetCount(${n})">${tx(`Use ${n}`, `${n} चुनें`)}</button></div>`;
  /** Return a question-language button reflecting the current builder language choice. */
  const langBtn = (id, label) =>
    `<button type="button" class="${SB.lang === id ? "on" : ""}" aria-pressed="${SB.lang === id}" onclick="sbSet('lang','${id}')">${label}</button>`;
  const body = `<div class="sb-label">${tx("Number of questions", "सवालों की संख्या")}</div>${countHtml}
    <div class="sb-label">${tx("Time", "समय")}</div>
    <div class="sb-inline"><label for="sbMinIn">${tx("Minutes", "मिनट")}</label><input id="sbMinIn" type="number" inputmode="numeric" min="1" max="300" value="${SB.minutes}" oninput="sbMinutesInput(this.value)"></div>
    <p class="sj-note sj-muted">${SB.minutesTouched ? tx("Custom time.", "आपका चुना समय।") : tx("Suggested: 1 minute per question.", "सुझाव: हर सवाल के लिए 1 मिनट।")}</p>
    <div class="sb-label">${tx("Language", "भाषा")}</div>
    <div class="sb-seg" role="group" aria-label="${tx("Question language", "सवालों की भाषा")}">${langBtn("both", "English + हिंदी")}${langBtn("en", "English")}${langBtn("hi", "हिंदी")}</div>
    <p class="sj-note ${SB.lang === "hi" && L.hi < L.total ? "" : "sj-muted"}">${tx(`${L.hi} of ${L.total} eligible questions have Hindi text`, `${L.total} उपलब्ध सवालों में से ${L.hi} हिंदी में हैं`)}${SB.lang === "hi" && L.hi < L.total ? tx("; the others will show in English.", "; बाकी अंग्रेज़ी में दिखेंगे।") : tx(".", "।")}</p>
    <div class="sb-label">${tx("Order", "क्रम")}</div>
    <button type="button" class="sb-toggle ${SB.shuffle ? "on" : ""}" aria-pressed="${SB.shuffle}" onclick="sbSet('shuffle', ${!SB.shuffle})"><span class="sb-toggle-knob" aria-hidden="true"></span>${tx("Shuffle questions", "सवालों का क्रम बदलें")}</button>
    <button type="button" class="btn-nav" style="width:100%;margin-top:16px;" onclick="sbOpenSaveTemplate()">${tx("⭐ Save these settings as a template", "⭐ इन सेटिंग को टेम्पलेट के रूप में सहेजें")}</button>`;
  const count = SB.pick === "pick" ? n : Math.min(SB.count, n);
  return {
    body,
    bar: sbBar(
      `${sbCount(count)} · ${SB.minutes} ${tx("min", "मिनट")}`,
      `<button type="button" id="sbPrimary" class="btn-nav primary" ${!n || short ? "disabled" : ""} onclick="sbForward()">${tx("Preview →", "पूर्वावलोकन →")}</button>`,
    ),
  };
}
/** Return labeled question-count bars for up to eight subject/topic groups. */
function sbDistribution(rows) {
  const g = sbGroup(
    rows,
    (r) => r.subject + SB_SEP + r.topic,
    (r) => `${sbSubjectLabel(r.subject)} › ${r.topic}`,
  ).sort((a, b) => b.count - a.count);
  const max = Math.max(1, ...g.map((x) => x.count));
  return sjBarRows(
    g
      .slice(0, 8)
      .map((x) => ({
        label: x.label,
        value: x.count,
        valueLabel: tx(`${x.count} Q`, `${x.count} सवाल`),
      })),
    max,
    null,
  );
}
/** Return available preview questions with distribution, replace and remove controls. */
function sbRenderPreview() {
  const byId = new Map(sbAll().map((r) => [r.id, r]));
  const rows = SB.previewIds.map((id) => byId.get(id)).filter(Boolean);
  if (rows.length !== SB.previewIds.length)
    SB.previewIds = rows.map((r) => r.id);
  const body = rows.length
    ? `
    <div class="sb-summary"><div><b>${rows.length}</b><span>${tx("Questions", "सवाल")}</span></div><div><b>${SB.minutes}</b><span>${tx("Minutes", "मिनट")}</span></div><div><b>${new Set(rows.map((r) => r.topic)).size}</b><span>${tx("Topics", "टॉपिक")}</span></div></div>
    <div class="sj-bars" style="margin:10px 0 4px;">${sbDistribution(rows)}</div>
    <div class="sb-label">${tx("Questions in this test", "इस टेस्ट के सवाल")}</div>
    <ol class="sb-preview">${rows.map((r, i) => `<li><div class="sb-pq-main"><strong>${i + 1}. ${escapeHtml(r.q.QUESTION_EN || r.q.QUESTION_HI || tx("Question text unavailable", "सवाल का पाठ उपलब्ध नहीं है"))}</strong><small>${escapeHtml(sbSubjectLabel(r.subject))} › ${escapeHtml(r.topic)} · ${escapeHtml(sbDiffLabel(sbDiffOf(r)))}</small></div><div class="sb-pq-actions"><button type="button" aria-label="${tx(`Replace question ${i + 1}`, `सवाल ${i + 1} बदलें`)}" title="${tx("Replace", "बदलें")}" onclick="sbReplaceInPreview(${nbJsAttr(r.id)})">↻</button><button type="button" aria-label="${tx(`Remove question ${i + 1}`, `सवाल ${i + 1} हटाएँ`)}" title="${tx("Remove", "हटाएँ")}" onclick="sbRemoveFromPreview(${nbJsAttr(r.id)})">✕</button></div></li>`).join("")}</ol>`
    : `<div class="sj-empty"><strong>${tx("Preview is empty", "पूर्वावलोकन खाली है")}</strong><span>${tx("Go back and change your selection.", "वापस जाकर अपना चयन बदलें।")}</span></div>`;
  return {
    body,
    bar: sbBar(
      `${sbCount(rows.length)} · ${SB.minutes} ${tx("min", "मिनट")}`,
      `<button type="button" class="btn-nav primary" ${rows.length ? "" : "disabled"} onclick="sbGo('instructions')">${tx("Continue →", "आगे →")}</button>`,
    ),
  };
}
/** Return the current PYQ exam, year, paper or scope selection screen. */
function sbRenderPyq() {
  if (SB.step === "pyq_exam") {
    const items = sbPyqExams();
    return {
      body: `<p class="sb-hint">${tx("Only questions marked as PYQ are used.", "केवल PYQ चिह्नित सवाल शामिल किए जाते हैं।")}</p><div class="sb-list">${items.map((it) => sbItemChoice(`sbPyqChoose('exam', ${nbJsAttr(it.key)})`, it.label, it.meta, it.count)).join("")}</div>`,
      bar: sbBar(
        tx("Tap an exam to continue.", "आगे बढ़ने के लिए परीक्षा चुनें।"),
        "",
      ),
    };
  }
  if (SB.step === "pyq_year") {
    const items = sbPyqYears();
    return {
      body: `<div class="sb-list">${items.map((it) => sbItemChoice(`sbPyqChoose('year', ${nbJsAttr(it.key)})`, it.label, sbExamName(SB.pyqExam), it.count)).join("")}</div>`,
      bar: sbBar(
        tx("Tap a year to continue.", "आगे बढ़ने के लिए वर्ष चुनें।"),
        "",
      ),
    };
  }
  if (SB.step === "pyq_shift") {
    const items = sbPyqShifts();
    const total = items.reduce((a, b) => a + b.count, 0);
    return {
      body: `<div class="sb-list">${items.length > 1 ? sbItemChoice(`sbPyqChoose('shift', '*')`, tx("All papers of this year", "इस वर्ष के सभी पेपर"), tx(`${items.length} papers`, `${items.length} पेपर`), total) : ""}${items.map((it) => sbItemChoice(`sbPyqChoose('shift', ${nbJsAttr(it.key)})`, it.label, `${sbExamName(SB.pyqExam)} ${SB.pyqYear}`, it.count)).join("")}</div>`,
      bar: sbBar(
        tx("Tap a paper to continue.", "आगे बढ़ने के लिए पेपर चुनें।"),
        "",
      ),
    };
  }
  const paper = sbPyqPaperRows();
  const subjects = sbGroup(
    paper,
    (r) => r.subject,
    (r) => sbSubjectLabel(r.subject),
  ).sort((a, b) => a.label.localeCompare(b.label));
  const final = sbPyqFinalRows();
  if (!SB.pyqMinutesTouched) SB.pyqMinutes = Math.max(1, final.length);
  const allPyq = sbAll().filter(
    (r) => r.examId === SB.pyqExam && r.year === SB.pyqYear && nbVerifiedPYQ(r),
  );
  const blocked =
    allPyq.length -
    sbPyqRows().filter((r) => r.examId === SB.pyqExam && r.year === SB.pyqYear)
      .length;
  const body = `<div class="sb-paper"><strong>${escapeHtml(sbExamName(SB.pyqExam))} · ${escapeHtml(SB.pyqYear)}</strong><small>${SB.pyqShift === "*" ? tx("All papers", "सभी पेपर") : escapeHtml(SB.pyqShift)} · ${tx("original question order", "सवालों का मूल क्रम")}</small></div>
    <div class="sb-label">${tx("What to attempt", "क्या हल करना है")}</div>
    <div class="sb-list">
      <button type="button" class="sb-item ${SB.pyqScope === "full" ? "on" : ""}" aria-pressed="${SB.pyqScope === "full"}" onclick="sbPyqSetScope('full')"><span class="sb-check" aria-hidden="true">${SB.pyqScope === "full" ? "✓" : ""}</span><span class="sb-item-main"><strong>${tx("Full paper", "पूरा पेपर")}</strong><small>${tx("All subjects", "सभी विषय")}</small></span><span class="sb-count">${paper.length}</span></button>
      ${
        subjects.length > 1
          ? subjects
              .map((s) => {
                const on = SB.pyqScope === "subject" && SB.pyqSubject === s.key;
                return `<button type="button" class="sb-item ${on ? "on" : ""}" aria-pressed="${on}" onclick="sbPyqSetScope('subject', ${nbJsAttr(s.key)})"><span class="sb-check" aria-hidden="true">${on ? "✓" : ""}</span><span class="sb-item-main"><strong>${tx(`Only ${escapeHtml(s.label)}`, `केवल ${escapeHtml(s.label)}`)}</strong></span><span class="sb-count">${s.count}</span></button>`;
              })
              .join("")
          : ""
      }
    </div>
    <div class="sb-inline" style="margin-top:12px;"><label for="sbPyqMin">${tx("Minutes", "मिनट")}</label><input id="sbPyqMin" type="number" inputmode="numeric" min="1" max="300" value="${SB.pyqMinutes}" oninput="sbPyqMinutesInput(this.value)"></div>
    <p class="sj-note sj-muted">${SB.pyqMinutesTouched ? tx("Custom time.", "आपका चुना समय।") : tx("Suggested: 1 minute per question.", "सुझाव: हर सवाल के लिए 1 मिनट।")}${final.length > 500 ? tx(" Only the first 500 questions are used.", " केवल पहले 500 सवाल शामिल होंगे।") : ""}</p>
    ${blocked > 0 ? `<p class="sj-note">${tx(`${blocked} question(s) of this exam/year are not included because their source exam/year differs from their topic's assignment.`, `इस परीक्षा/वर्ष के ${blocked} सवाल शामिल नहीं हैं क्योंकि उनका मूल परीक्षा/वर्ष टॉपिक के वर्गीकरण से अलग है।`)} <button type="button" class="sj-inline-link" onclick="openDataControlModal()">${tx("Review in Data Control", "डेटा कंट्रोल में जाँचें")}</button></p>` : ""}`;
  return {
    body,
    bar: sbBar(
      `${sbCount(Math.min(final.length, 500))} · ${SB.pyqMinutes} ${tx("min", "मिनट")}`,
      `<button type="button" class="btn-nav primary" ${final.length ? "" : "disabled"} onclick="sbPyqToInstructions()">${tx("Continue →", "आगे →")}</button>`,
    ),
  };
}
/** Return pre-test instructions, selection totals, language controls and the start action. */
function sbRenderInstructions() {
  const byId = new Map(sbAll().map((r) => [r.id, r]));
  const rows = SB.previewIds.map((id) => byId.get(id)).filter(Boolean);
  const L = sbLangInfo(rows);
  const subjects = sbGroup(
    rows,
    (r) => r.subject,
    (r) => sbSubjectLabel(r.subject),
  );
  /** Return a question-language button reflecting the current builder language choice. */
  const langBtn = (id, label) =>
    `<button type="button" class="${SB.lang === id ? "on" : ""}" aria-pressed="${SB.lang === id}" onclick="sbSet('lang','${id}')">${label}</button>`;
  const body = rows.length
    ? `
    <div class="sb-paper"><strong>${escapeHtml(sbTestTitle())}</strong><small>${escapeHtml(sbExamName(rows[0].examId))} · ${escapeHtml(rows[0].year)}</small></div>
    <div class="sb-summary"><div><b>${rows.length}</b><span>${tx("Questions", "सवाल")}</span></div><div><b>${SB.minutes}</b><span>${tx("Minutes", "मिनट")}</span></div><div><b>${subjects.length}</b><span>${tx(`Subject${subjects.length === 1 ? "" : "s"}`, "विषय")}</span></div></div>
    <ul class="sb-rules">
      <li><b>${tx("Marking:", "अंक:")}</b> ${tx("+1 for each correct answer. Wrong or skipped answers get 0 (no negative marking).", "हर सही जवाब पर +1 अंक। गलत या छोड़े हुए सवाल पर 0 अंक (कोई ऋणात्मक अंक नहीं)।")}</li>
      <li><b>${tx("Timer:", "समय:")}</b> ${tx("runs from the start; the test submits itself when time is over.", "टेस्ट शुरू होते ही समय चलेगा; समय पूरा होने पर टेस्ट अपने आप जमा हो जाएगा।")}</li>
      <li><b>${tx("Moving around:", "सवाल बदलना:")}</b> ${tx("use Previous / Save &amp; Next, or ▦ to jump to any question. Use Mark for Review to come back later.", "पिछला / सहेजें और आगे से सवाल बदलें या ▦ से किसी भी सवाल पर जाएँ। बाद में लौटने के लिए दोहराई का निशान लगाएँ।")}</li>
      <li><b>${tx("Safety:", "सुरक्षा:")}</b> ${tx("if the page reloads, your answers and time are restored. Leaving the test asks for confirmation.", "पेज फिर खुलने पर आपके जवाब और बचा समय लौट आएँगे। टेस्ट छोड़ने से पहले पुष्टि माँगी जाएगी।")}</li>
    </ul>
    <div class="sb-label">${tx("Language", "भाषा")}</div>
    <div class="sb-seg" role="group" aria-label="${tx("Question language", "सवालों की भाषा")}">${langBtn("both", "English + हिंदी")}${langBtn("en", "English")}${langBtn("hi", "हिंदी")}</div>
    <p class="sj-note sj-muted">${tx(`${L.hi} of ${L.total} questions have Hindi text. You can switch language inside the test with A/अ.`, `${L.total} में से ${L.hi} सवाल हिंदी में हैं। टेस्ट के अंदर A/अ से भाषा बदल सकते हैं।`)}</p>`
    : `<div class="sj-empty"><strong>${tx("Nothing to start", "शुरू करने के लिए सवाल नहीं हैं")}</strong><span>${tx("Go back and choose questions.", "वापस जाकर सवाल चुनें।")}</span></div>`;
  return {
    body,
    bar: sbBar(
      `${sbCount(rows.length)} · ${SB.minutes} ${tx("min", "मिनट")}`,
      `<button type="button" class="btn-nav primary" ${rows.length ? "" : "disabled"} onclick="sbStartFromInstructions()">${tx("I'm ready — Start", "मैं तैयार हूँ — शुरू करें")}</button>`,
    ),
  };
}
// Each step renders its final body and footer directly from SB state.
const SB_RENDERERS = {
  mode: sbRenderMode,
  quick: sbRenderQuick,
  pyq_exam: sbRenderPyq,
  pyq_year: sbRenderPyq,
  pyq_shift: sbRenderPyq,
  pyq_scope: sbRenderPyq,
  /** Render the custom-test board selection step. */
  board: () => sbRenderChoice("board"),
  /** Render the custom-test exam selection step. */
  exam: () => sbRenderChoice("exam"),
  /** Render the custom-test year selection step. */
  year: () => sbRenderChoice("year"),
  /** Render the subject inclusion step. */
  subject: () => sbRenderMulti("subject"),
  /** Render the topic inclusion step. */
  topic: () => sbRenderMulti("topic"),
  /** Render the subtopic inclusion step. */
  subtopic: () => sbRenderMulti("subtopic"),
  type: sbRenderType,
  questions: sbRenderQuestions,
  settings: sbRenderSettings,
  /** Build missing preview IDs before rendering the preview and its footer. */
  preview: () => {
    if (!SB.previewIds.length && SB.mode === "custom") sbBuildPreview();
    return sbRenderPreview();
  },
  instructions: sbRenderInstructions,
};
const SB_TITLES_HI = {
  mode: "टेस्ट बनाएँ",
  quick: "झटपट टेस्ट",
  pyq_exam: "PYQ · परीक्षा चुनें",
  pyq_year: "PYQ · वर्ष चुनें",
  pyq_shift: "PYQ · पेपर चुनें",
  pyq_scope: "PYQ · पेपर",
  board: "बोर्ड चुनें",
  exam: "परीक्षा चुनें",
  year: "वर्ष चुनें",
  subject: "विषय चुनें",
  topic: "टॉपिक चुनें",
  subtopic: "उपविषय चुनें",
  type: "सवाल का प्रकार और कठिनाई",
  questions: "सवाल",
  settings: "टेस्ट सेटिंग",
  preview: "पूर्वावलोकन",
  instructions: "निर्देश",
};
/** Render the active builder step and footer, initializing and restoring draft state as needed. */
function sbRender(v) {
  SBCache = null;
  if (!SB.inited) SB = sbLoadDraft() || sbFresh();
  if (WorkspaceManager.current().type === "BOARD") {
    v.innerHTML = `<div class="sb-shell"><header class="sb-top"><button type="button" class="sb-back" onclick="navigate('home')">${tx("← Back", "← वापस")}</button><div class="sb-title">${tx("Create a test", "टेस्ट बनाएँ")}</div></header><div class="sb-body"><div class="sj-empty"><strong>${tx("Test Builder is for competitive exam workspaces", "टेस्ट बिल्डर प्रतियोगी परीक्षाओं के वर्कस्पेस के लिए है")}</strong><span>${tx("Switch to a competitive workspace to build a test.", "टेस्ट बनाने के लिए प्रतियोगी परीक्षा का वर्कस्पेस चुनें।")}</span><button type="button" class="btn-nav" onclick="openWorkspaceSwitcher()">${tx("Switch workspace", "वर्कस्पेस बदलें")}</button></div></div></div>`;
    return;
  }
  const renderer = SB_RENDERERS[SB.step];
  if (!renderer) SB = sbFresh();
  const out = (renderer || sbRenderMode)();
  v.innerHTML = `<div class="sb-shell" data-step="${escapeHtml(SB.step)}">
    <header class="sb-top"><button type="button" class="sb-back" onclick="sbBack()" aria-label="${tx("Back", "वापस")}">← ${tx("Back", "वापस")}</button><div class="sb-title">${escapeHtml(tx(SB_TITLES[SB.step] || "Create Test", SB_TITLES_HI[SB.step]))}</div>${SB.step !== "mode" ? `<button type="button" class="sb-restart" onclick="sbStartOver()">${tx("Start over", "फिर से शुरू करें")}</button>` : ""}</header>
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
