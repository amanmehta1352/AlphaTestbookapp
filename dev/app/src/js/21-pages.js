/* =========================================================================
   5. PAGE RENDERING MODULES
   ========================================================================= */

/* =========================================================================
   V2.3.7 — LEARNING HISTORY (additive)
   Two NEW storage keys. Existing keys (modules, user state, import history),
   question data, scoring and import logic are not modified.
   - Attempt history: one record per answered MCQ (practice first answer per
     question per page session; CBT answered questions at submit).
   - Result history: one summary per submitted CBT, reopenable later.
   ========================================================================= */
const ATTEMPT_HISTORY_KEY = 'master_student_journey_v90_attempt_history';
const RESULT_HISTORY_KEY = 'master_student_journey_v90_result_history';
const ATTEMPT_HISTORY_CAP = 5000;
const RESULT_HISTORY_CAP = 200;
let AttemptHistory = [];
let ResultHistory = [];
function sjLocalDay(d = new Date()) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
async function hydrateLearningHistory() {
  try {
    const a = parseStored(await AppStorage.getRaw(ATTEMPT_HISTORY_KEY), [], ATTEMPT_HISTORY_KEY);
    AttemptHistory = Array.isArray(a) ? a.filter(x => x && typeof x === 'object' && x.v === 1) : [];
  } catch (e) { console.warn('[History] attempt history unreadable; starting empty.', e); AttemptHistory = []; }
  try {
    const r = parseStored(await AppStorage.getRaw(RESULT_HISTORY_KEY), [], RESULT_HISTORY_KEY);
    ResultHistory = Array.isArray(r) ? r.filter(x => x && typeof x === 'object' && x.v === 1 && x.id) : [];
  } catch (e) { console.warn('[History] result history unreadable; starting empty.', e); ResultHistory = []; }
}
function saveAttemptHistory() {
  const snapshot = JSON.stringify(AttemptHistory);
  return StorageWriteQueue.enqueue(() => AppStorage.setRawDirect(ATTEMPT_HISTORY_KEY, snapshot)).catch(e => console.warn('[History] attempt save failed', e));
}
function saveResultHistory() {
  const snapshot = JSON.stringify(ResultHistory);
  return StorageWriteQueue.enqueue(() => AppStorage.setRawDirect(RESULT_HISTORY_KEY, snapshot)).catch(e => console.warn('[History] result save failed', e));
}
const LearningHistory = {
  baseRecord(q, mod, mode) {
    const m = q?.metadata || {};
    return {
      v: 1, ts: new Date().toISOString(), day: sjLocalDay(), mode,
      ws: String(mod?.workspaceId || q?.workspaceId || WorkspaceManager.current().id),
      moduleId: String(mod?.moduleId || ''), cid: String(q?.canonicalQId || ''), qno: q?.originalQNo ?? null,
      subject: String(m.subject || mod?.subject || ''), chapter: String(m.chapter || mod?.chapter || ''),
      topic: String(m.topic || mod?.topicTitle || ''), subtopic: String(m.subtopic || ''),
      type: String(m.theoryOrNumerical || ''), difficulty: String(m.difficulty || ''),
      examId: String(mod?.examId || m.examId || ''), year: String(mod?.examYear || m.year || '')
    };
  },
  push(records) {
    if (!records.length) return;
    AttemptHistory.push(...records);
    if (AttemptHistory.length > ATTEMPT_HISTORY_CAP) AttemptHistory.splice(0, AttemptHistory.length - ATTEMPT_HISTORY_CAP);
    saveAttemptHistory();
  },
  recordPractice(q, mod, letter, sec, mode) {
    if (!q || !mod || QuestionUI.getFormat(q) === 'SUBJECTIVE') return;
    const rec = this.baseRecord(q, mod, mode || 'practice');
    rec.answer = String(letter || ''); rec.key = String(q.answer || '');
    rec.correct = rec.answer.toUpperCase() === rec.key.toUpperCase();
    rec.sec = Number.isFinite(Number(sec)) && sec !== null ? Math.max(0, Math.min(SJ_TIME_CAP_SEC, Math.round(Number(sec)))) : null;
    this.push([rec]);
  },
  // Called once from submitTestSession after scoring is final; reads only.
  recordTest(session, result) {
    const isCustom = session.sessionContractVersion === 1;
    const srcById = new Map((session.sourceRefs || []).map(x => [String(x.canonicalQId), x]));
    const resultId = 'R-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();
    const perQuestionSec = session.questions.map((q, i) => { try { return getQuestionElapsedSeconds(i); } catch (_) { return null; } });
    const records = [];
    session.questions.forEach((q, i) => {
      if (QuestionUI.getFormat(q) === 'SUBJECTIVE') return;
      const key = isCustom ? String(q.canonicalQId || '') : String(q.originalQNo ?? '');
      const ans = session.answers[key];
      if (!ans) return; // unanswered is not an attempt
      const src = srcById.get(String(q.canonicalQId || ''));
      const mod = getWorkspaceModule(src?.moduleId || session.moduleId) || { moduleId: src?.moduleId || session.moduleId, workspaceId: session.workspaceId, examId: session.examId, examYear: session.examYear };
      const rec = this.baseRecord(q, mod, 'test');
      rec.answer = String(ans); rec.key = String(q.answer || '');
      rec.correct = rec.answer.toUpperCase() === rec.key.toUpperCase();
      rec.sec = perQuestionSec[i]; rec.resultId = resultId;
      records.push(rec);
    });
    this.push(records);
    const started = Number(session.sessionStartedAt) || Date.now();
    ResultHistory.unshift({
      v: 1, id: resultId, ts: new Date().toISOString(), day: sjLocalDay(), ws: String(session.workspaceId || ''),
      moduleId: result.moduleId, groupId: result.groupId, topicTitle: result.topicTitle, groupTitle: result.groupTitle,
      examId: String(session.examId || ''), examYear: String(session.examYear || ''),
      total: result.total, correct: result.correct, wrong: result.wrong, unattempted: result.unattempted,
      score: result.score, accuracy: result.accuracy,
      durationSeconds: Number(session.durationSeconds) || null,
      timeUsedSec: Math.max(0, Math.min(Number(session.durationSeconds) || Infinity, Math.floor((Date.now() - started) / 1000))),
      questionIds: session.questions.map(q => String(q.canonicalQId || '')), perQuestionSec,
      answers: { ...(result.answers || {}) }, subjectiveState: { ...(result.subjectiveState || {}) }, marked: { ...(result.marked || {}) },
      langMode: result.langMode, sessionContractVersion: result.sessionContractVersion,
      questionSequenceFingerprint: result.questionSequenceFingerprint,
      sourceRefs: (result.sourceRefs || []).map(x => ({ ...x }))
    });
    if (ResultHistory.length > RESULT_HISTORY_CAP) ResultHistory.length = RESULT_HISTORY_CAP;
    saveResultHistory();
    return resultId;
  },
  attemptsForWorkspace(ws = WorkspaceManager.current().id) { return AttemptHistory.filter(a => a.ws === ws); },
  resultsForWorkspace(ws = WorkspaceManager.current().id) { return ResultHistory.filter(r => r.ws === ws); }
};
function sjFormatWhen(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d)) return 'date unknown';
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
function openStoredResult(id) {
  const rec = ResultHistory.find(r => r.id === id && r.ws === WorkspaceManager.current().id);
  if (!rec) { openCustomToast('This result is not available in the current workspace.'); return; }
  const questions = (rec.questionIds || []).map(cid => IndexEngine.registry.get(cid)).filter(Boolean);
  if (!questions.length) { openCustomToast('The questions of this test are no longer in the question bank.'); return; }
  const missing = (rec.questionIds || []).length - questions.length;
  closeModal();
  navigate('result', { result: { ...rec, questions, fromHistory: true } });
  if (missing > 0) setTimeout(() => openCustomToast(`${missing} question(s) of this test were deleted and are not shown.`), 50);
}
function openTestHistoryModal() {
  const rows = LearningHistory.resultsForWorkspace();
  const body = rows.length ? `<div class="sj-recent">${rows.map(r => `<button type="button" class="sj-action" onclick="openStoredResult(${nbJsAttr(r.id)})"><span aria-hidden="true">⏱️</span><span class="sj-action-copy"><strong>${escapeHtml(r.topicTitle || 'Test')} · ${Number(r.score) || 0}/${Number(r.total) || 0}</strong><small>Accuracy ${Number(r.accuracy) || 0}% · ${Number(r.correct) || 0} correct · ${Number(r.wrong) || 0} wrong · ${Number(r.unattempted) || 0} skipped · ${escapeHtml(sjFormatWhen(r.ts))}</small></span><span class="sj-action-go" aria-hidden="true">›</span></button>`).join('')}</div><p class="sj-note sj-muted">Latest ${RESULT_HISTORY_CAP} results are kept on this device.</p>`
    : `<div class="sj-empty"><strong>No saved tests yet</strong><span>Every test you submit is saved here so you can open it again.</span><button type="button" class="btn-nav" onclick="closeModal();navigate('native_builder')">Build a test</button></div>`;
  openModal('📜 Test History', body);
}

/* 5.1 HOME — STUDENT JOURNEY DASHBOARD
   Read-only view. Sources: WorkspaceManager.filterModules(AppModules) · IndexEngine ·
   AttemptHistory/ResultHistory · UserState.mistakeBook (existing scope helper) ·
   UserState.masteryMap · UserState.selectedExam/selectedYear · ImportHistory ·
   AppRouteStack (resume position, this tab only).
   Not displayed: studyMinutesToday, studyGoalMinutes, questionsAttemptedToday,
   dailyStreak (fixed starter values, never updated). */
const SJ_SEED_MASTERY = { 'percentage': 0.88, 'profit-loss': 0.65, 'electricity': 0.35 };
function sjIsSeedMistake(m) {
  return String(m?.qId) === '10935' && m?.savedAt === 'Yesterday' && m?.rootCause === 'FORMULA_MISMATCH';
}
function sjModuleQuestionCount(m) {
  return (m?.groups || []).reduce((a, g) => a + ((g.questions || []).length), 0);
}
function sjCollectDashboardData() {
  const workspace = WorkspaceManager.current();
  const modules = (typeof profileVisible==='function'?profileVisible:(x=>x))(WorkspaceManager.filterModules(AppModules || [])).filter(m => sjModuleQuestionCount(m) > 0);
  const subjects = new Map();
  let totalQuestions = 0;
  modules.forEach(m => {
    const n = sjModuleQuestionCount(m);
    totalQuestions += n;
    const key = String(m.subject || 'other');
    const s = subjects.get(key) || { key, title: subjectDisplayName(key), questions: 0, topics: 0 };
    s.questions += n; s.topics += 1; subjects.set(key, s);
  });

  const today = sjLocalDay();
  const attemptsToday = LearningHistory.attemptsForWorkspace(workspace.id).filter(a => a.day === today);
  const results = LearningHistory.resultsForWorkspace(workspace.id);
  const resultsToday = results.filter(r => r.day === today);
  const practiceToday = attemptsToday.filter(a => a.mode === 'practice').length;
  const answered = attemptsToday.length;
  const correct = attemptsToday.filter(a => a.correct === true).length;

  let resume = null;
  const stack = [...(Array.isArray(AppRouteStack) ? AppRouteStack : [])].reverse();
  for (const r of stack) {
    if (r?.page === 'practice' && r.params?.moduleId && !Array.isArray(r.params?.customQuestions)) {
      const m = getWorkspaceModule(r.params.moduleId);
      if (m && sjModuleQuestionCount(m) > 0) {
        const qIndex = Math.max(0, Math.min(Number(r.params.qIndex) || 0, sjModuleQuestionCount(m) - 1));
        resume = { module: m, qIndex };
        break;
      }
    }
  }

  const scopedMistakes = (competitiveEnabledGuard() ? getScopedCompetitiveMistakes() : (UserState.mistakeBook || [])) || [];
  const realMistakes = scopedMistakes.filter(m => !sjIsSeedMistake(m));
  const starterMistakes = scopedMistakes.length - realMistakes.length;
  const workspaceMistakes = (UserState.mistakeBook || []).filter(m => !sjIsSeedMistake(m) && getWorkspaceModule(m.moduleId));
  const otherExamMistakes = Math.max(0, workspaceMistakes.length - realMistakes.length);
  const topicMistakes = new Map();
  realMistakes.forEach(m => {
    const key = String(m.moduleId || '') + '␟' + String(m.topicTitle || 'Topic');
    const t = topicMistakes.get(key) || { moduleId: m.moduleId, topic: String(m.topicTitle || 'Topic'), count: 0 };
    t.count++; topicMistakes.set(key, t);
  });
  const weakTopics = [...topicMistakes.values()].sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));

  const mastery = Object.entries(UserState.masteryMap || {}).map(([topic, d]) => ({
    topic, score: Number(d?.score) || 0, level: String(d?.level || 'learning'),
    starter: Object.prototype.hasOwnProperty.call(SJ_SEED_MASTERY, topic) && Number(d?.score) === SJ_SEED_MASTERY[topic]
  }));

  const examProfile = UniversalExamRegistry.registry.get(UserState.selectedExam) || null;
  const examName = examProfile?.examName || UniversalExamRegistry.knownProfiles[UserState.selectedExam]?.name || '';
  const imports = (typeof getImportHistory === 'function' ? getImportHistory() : []).slice(0, 5);

  return {
    workspace, modules, subjects: [...subjects.values()].sort((a, b) => b.questions - a.questions),
    totalQuestions, results, resultsToday, practiceToday,
    answered, correct, accuracy: answered > 0 ? Math.round((correct / answered) * 100) : null,
    resume, realMistakes, starterMistakes, otherExamMistakes, weakTopics, mastery, examName,
    examYear: String(UserState.selectedYear || ''), imports
  };
}
function sjBarRows(rows, max, onClickFor) {
  return rows.map(r => {
    const pct = max > 0 ? Math.max(4, Math.round((r.value / max) * 100)) : 0;
    const call = onClickFor ? onClickFor(r) : '';
    const tag = call ? 'button' : 'div';
    return `<${tag} class="sj-bar-row" ${call ? `type="button" onclick="${call}"` : ''} title="${escapeHtml(r.label)}: ${escapeHtml(r.valueLabel)}">
      <span class="sj-bar-label">${escapeHtml(r.label)}</span>
      <span class="sj-bar-track" aria-hidden="true"><span class="sj-bar-fill" style="width:${pct}%"></span></span>
      <span class="sj-bar-value">${escapeHtml(r.valueLabel)}</span>
    </${tag}>`;
  }).join('');
}
function sjOpenAllExamMistakes() { MistakeViewState.allExams = true; navigate('mistakes'); }
/* V2.3.7: show how the eligible question count was reached, step by step. Read-only. */
function nbCountFunnel() {
  const S = NativeBuilderState;
  const stored = WorkspaceManager.filterModules(AppModules || []).filter(m => m.workspaceType !== 'BOARD').reduce((n, m) => n + sjModuleQuestionCount(m), 0);
  let rows = nbSourceRows();
  const steps = [{ label: 'In bank', n: stored }];
  if (rows.length !== stored) steps.push({ label: 'Usable', n: rows.length, why: `${stored - rows.length} not usable: duplicate ID, missing options/answer, or missing subject/topic.` });
  if (S.examId || S.year) {
    rows = rows.filter(r => (!S.examId || r.examId === S.examId) && (!S.year || r.year === S.year));
    steps.push({ label: 'Exam/Year', n: rows.length });
  }
  if (S.difficulty) { rows = rows.filter(r => r.difficulty === S.difficulty); steps.push({ label: 'Difficulty', n: rows.length }); }
  if (S.mode === 'pyq') { rows = rows.filter(nbSafePYQ); steps.push({ label: 'Verified PYQ', n: rows.length }); }
  const term = String(S.search || '').trim().toLowerCase();
  if (term) {
    rows = rows.filter(r => [r.subject, r.chapter, r.topic, r.q.QUESTION_EN, r.q.QUESTION_HI, r.id].some(x => String(x || '').toLowerCase().includes(term)));
    steps.push({ label: 'Search', n: rows.length });
  }
  if (S.subjects.size || S.topics.size) steps.push({ label: S.topics.size ? 'Topic' : 'Subject', n: nbBuilderTypePool().length });
  if (S.questionTypes.size) steps.push({ label: 'Type', n: nbFilteredRows().length });
  return steps;
}
function nbRenderFunnel(v) {
  if (NativeBuilderState.tab !== 'selection' || NativeBuilderState.wizardStep < 1) return;
  const progress = v.querySelector('.nb-wizard-progress');
  if (!progress) return;
  const steps = nbCountFunnel();
  const el = document.createElement('div');
  el.className = 'nb-funnel';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', 'How the question count was reached');
  el.innerHTML = steps.map((s, i) => `${i ? '<span class="nb-funnel-sep" aria-hidden="true">→</span>' : ''}<span class="nb-funnel-chip ${i && s.n < steps[i - 1].n ? 'drop' : ''}">${escapeHtml(s.label)} <b>${s.n}</b></span>`).join('')
    + (steps.find(s => s.why) ? `<span class="nb-funnel-why">${escapeHtml(steps.find(s => s.why).why)}</span>` : '');
  progress.insertAdjacentElement('afterend', el);
}

/* 5.2 UNIVERSAL EXAM MODULE & HUB */
function renderUniversalExamHub(v) {
  const allExams = UniversalExamRegistry.getAllExams();
  const totalQuestions = IndexEngine.registry.size;

  v.innerHTML = `
    <div class="nav-breadcrumb">
      <button onclick="navigate('home')">Home</button>
      <span class="sep">/</span>
      <span>Universal Exam Hub</span>
    </div>

    <div class="student-hero-card ao-page-head">
      <span class="journey-pill">🎯 ${tx('Choose your exam', 'अपनी परीक्षा चुनें')}</span>
      <h1>${tx('What are you preparing for?', 'आप किस परीक्षा की तैयारी कर रहे हैं?')}</h1>
      <p>${tx('Choose an exam to find subjects, previous-year questions and practice tests.', 'विषय, पिछले वर्षों के सवाल और अभ्यास टेस्ट देखने के लिए परीक्षा चुनें।')}</p>
    </div>

    <div class="section-title ao-page-head">
      <span>Registered Exam Frameworks (${allExams.length} Exams • ${totalQuestions} Questions)</span>
      <div style="display:flex;gap:6px;"><button class="btn-action-sm" onclick="navigate('competitive_hub')">🏆 Competitive Hub</button>${ServerState?.isAdmin === true ? '<button class="btn-action-sm" onclick="openImportModal()">+ Import New Exam</button>' : ''}</div>
    </div>

    <div class="grid-cards" style="margin-bottom:20px;">
      ${allExams.map(ex => `
        <div class="card-btn" onclick="navigate('exam_profile', {examId:'${ex.examId}'})">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <strong>${ex.examName}</strong>
            <span style="font-size:11px; font-weight:800; background:var(--primary-light); color:var(--primary); padding:2px 8px; border-radius:999px;">
              ${ex.questionCount} Questions
            </span>
          </div>
          <small>🏛️ Board: <b>${ex.examBoard}</b> • ${ex.category}</small>
          <div style="margin-top:6px; font-size:11px; color:var(--text-muted);">
            Years: <b>${Array.from(ex.years).join(', ')}</b> • Marking: <b>${ex.markingScheme}</b>
          </div>
          <div style="margin-top:12px; display:flex; gap:6px;">
            <button class="btn-action-sm" style="background:var(--primary); color:var(--on-primary); width:100%; justify-content:center;">Open Exam Profile ➔</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderExamProfile(v, examId) {
  const exam = UniversalExamRegistry.registry.get(examId) || UniversalExamRegistry.getAllExams()[0];
  UserState.selectedExam = exam.examId;
  saveUserState();

  v.innerHTML = `
    <div class="nav-breadcrumb">
      <button onclick="navigate('home')">Home</button>
      <span class="sep">/</span>
      <button onclick="navigate('exam_hub')">Exams</button>
      <span class="sep">/</span>
      <span>${exam.examName}</span>
    </div>

    <div class="student-hero-card ao-page-head">
      <span class="journey-pill">🎓 Active Exam Profile</span>
      <h1>${exam.examName} (${exam.examBoard})</h1>
      <p>${exam.category} • Marking: ${exam.markingScheme} • Standard Duration: ${exam.defaultDurationMinutes} Mins</p>
    </div>

    <div class="section-title ao-page-head">
      <span>${tx('Choose your next step', 'अपना अगला कदम चुनें')}</span>
      <span class="tax-badge exam">${exam.questionCount} Questions Loaded</span>
    </div>

    <div class="grid-cards" style="margin-bottom:20px;">
      <div class="card-btn ao-primary-card" onclick="navigate('subjects')">
        <strong>📖 ${tx('Start with a subject', 'विषय से शुरुआत करें')}</strong>
        <small>Chapters and topics that have questions</small>
      </div>
      <div class="card-btn" onclick="navigate('syllabus', {examId:'${exam.examId}'})">
        <strong>📚 Syllabus sections</strong>
        <small>Sections listed for this exam</small>
      </div>

      <div class="card-btn" onclick="setTaxonomyFilter('examId', '${exam.examId}'); navigate('taxonomy_explorer');">
        <strong>📅 Years & PYQ Archive</strong>
        <small>Papers from ${Array.from(exam.years).join(', ')} with shift filters</small>
      </div>
      <div class="card-btn" onclick="navigate('test_hub')">
        <strong>🧪 CBT Assessment Simulation</strong>
        <small>Pattern mock test with strict ${exam.markingScheme} negative marking</small>
      </div>
      <div class="card-btn" onclick="navigate('revision_hub')">
        <strong>🔄 Smart Revision</strong>
        <small>Cards and mistakes that are due today</small>
      </div>
      <div class="card-btn" onclick="navigate('mistakes')">
        <strong>📕 Mistake Book</strong>
        <small>Questions you answered wrong</small>
      </div>
    </div>
  `;
}

function renderSyllabusMatrix(v, examId) {
  const exam = UniversalExamRegistry.registry.get(examId) || UniversalExamRegistry.getAllExams()[0];

  v.innerHTML = `
    <div class="nav-breadcrumb">
      <button onclick="navigate('home')">Home</button>
      <span class="sep">/</span>
      <button onclick="navigate('exam_profile', {examId:'${exam.examId}'})">${exam.examName}</button>
      <span class="sep">/</span>
      <span>Syllabus Matrix</span>
    </div>

    <div class="section-title ao-page-head">
      <span>${exam.examName.toUpperCase()} — SYLLABUS SECTIONS</span>
      <button class="btn-action-sm" onclick="navigate('exam_profile', {examId:'${exam.examId}'})">← Exam Profile</button>
    </div>

    <div class="grid-cards">
      ${(exam.syllabus || []).map(section => `
        <div class="card-btn" onclick="navigate('subjects')">
          <strong>${escapeHtml(section)}</strong>
          <small>Section named in the exam profile. Practise it from Subjects.</small>
          <div style="margin-top:10px;">
            <span class="btn-action-sm" style="color:var(--primary);">Browse subjects ➔</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

/* 5.3 SUBJECT -> CHAPTER -> TOPIC -> SUBTOPIC -> CONCEPT FLOW */
function renderChapterPage(v, subject, chapter) {
  const filtered = CurriculumContext.filterModules(AppModules).filter(m =>
    String(m.subject || '').toLowerCase() === String(subject || '').toLowerCase() &&
    String(m.chapter || '').toLowerCase() === String(chapter || '').toLowerCase()
  );

  v.innerHTML = `
    <div class="nav-breadcrumb">
      <button onclick="navigate('home')">Home</button>
      <span class="sep">/</span>
      <button onclick="navigate('subjects')">Subjects</button>
      <span class="sep">/</span>
      <button onclick="navigate('subject', {subject:'${subject}'})">${subject.toUpperCase()}</button>
      <span class="sep">/</span>
      <span>${chapter}</span>
    </div>

    <div class="section-title ao-page-head">
      <span>${chapter.toUpperCase()} — TOPICS</span>
      <button class="btn-action-sm" onclick="navigate('subject', {subject:'${subject}'})">← Chapters</button>
    </div>

    <div class="grid-cards">
      ${filtered.map(m => {
        const qCount = m.groups.reduce((n, g) => n + g.questions.length, 0);
        return `
          <div class="card-btn" onclick="navigate('topic', {moduleId:'${m.moduleId}'})">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <strong>${m.topicTitle}</strong>
              ${masteryBadgeHtml(m.moduleId)}
            </div>
            <small>${m.groups.length} Groups • ${qCount} Questions</small>
            <div style="margin-top:10px; display:flex; gap:6px;">
              <span class="btn-action-sm" style="background:var(--primary-light); color:var(--primary);">Open Topic Hub ➔</span>
            </div>
          </div>
        `;
      }).join('') || '<div class="card-btn"><strong>No topics available for this chapter in the active workspace.</strong><small>Check the active workspace and imported module data. No questions or ownership were changed.</small></div>'}
    </div>
  `;
}

function renderTopicHubPage(v, moduleId) {
  const mod = getWorkspaceModule(moduleId);
  if (!mod) return navigate('home');

  const totalQuestions = mod.groups.reduce((acc, g) => acc + g.questions.length, 0);
  const sjM = masteryFor(mod.moduleId);

  v.innerHTML = `
    <div class="nav-breadcrumb">
      <button onclick="navigate('home')">Home</button>
      <span class="sep">/</span>
      <button onclick="navigate('subjects')">Subjects</button>
      <span class="sep">/</span>
      <button onclick="navigate('subject', {subject:${nbJsAttr(mod.subject)}})">${escapeHtml(mod.subject.toUpperCase())}</button>
      <span class="sep">/</span>
      <span>${escapeHtml(mod.topicTitle)}</span>
    </div>

    <div class="student-hero-card ao-page-head">
      <span class="journey-pill">📍 TOPIC: ${escapeHtml(mod.topicTitle.toUpperCase())}</span>
      <h1>${escapeHtml(mod.topicTitle)} Hub</h1>
      <p>${sjM.enough ? `Mastery: ${Math.round(sjM.score * 100)}% (${sjM.level})` : `Mastery: shown after ${MASTERY_MIN_ANSWERS} answers (${sjM.answered} so far)`} • ${mod.groups.length} Groups • ${totalQuestions} Questions</p>
    </div>

    <div class="section-title ao-page-head">
      <span>🎯 अभी क्या करना है? (Choose Mode for this Topic)</span>
    </div>

    <div class="intent-matrix-grid">
      <div class="intent-tile practice ao-primary-card" onclick="navigate('practice', {moduleId:${nbJsAttr(mod.moduleId)}, qIndex:0})">
        <div>
          <div class="intent-tile-header">
            <span class="intent-tile-title">✏️ ${tx('START PRACTICE', 'अभ्यास शुरू करें')}</span>
            <span>📝</span>
          </div>
          <div class="intent-tile-desc">${tx('Work through this topic with hints and instant solutions.', 'संकेत और तुरंत हल के साथ इस टॉपिक का अभ्यास करें।')}</div>
        </div>
        <div class="intent-tile-action" style="color:#10b981;">${tx('Practise this topic', 'इस टॉपिक का अभ्यास करें')} ➔</div>
      </div>
      <div class="intent-tile learn" onclick="navigate('learn', {moduleId:${nbJsAttr(mod.moduleId)}})">
        <div>
          <div class="intent-tile-header">
            <span class="intent-tile-title">📖 LEARN</span>
            <span>💡</span>
          </div>
          <div class="intent-tile-desc">Theory, concept notes & core formulas before practicing.</div>
        </div>
        <div class="intent-tile-action" style="color:#3b82f6;">Read Notes ➔</div>
      </div>

      <div class="intent-tile revision" onclick="navigate('revision', {moduleId:${nbJsAttr(mod.moduleId)}})">
        <div>
          <div class="intent-tile-header">
            <span class="intent-tile-title">🔄 REVISION</span>
            <span>⚡</span>
          </div>
          <div class="intent-tile-desc">Review this topic's mistakes and cards on a 1-3-7-14 day schedule.</div>
        </div>
        <div class="intent-tile-action" style="color:#8b5cf6;">Flip Cards ➔</div>
      </div>


      <div class="intent-tile class" onclick="navigate('class', {moduleId:${nbJsAttr(mod.moduleId)}})">
        <div>
          <div class="intent-tile-header">
            <span class="intent-tile-title">🎥 CLASS</span>
            <span>🎓</span>
          </div>
          <div class="intent-tile-desc">Lecture videos are not added for this topic yet.</div>
        </div>
        <div class="intent-tile-action" style="color:var(--text-muted);">Not available</div>
      </div>

      <div class="intent-tile pyq" onclick="navigate('pyq', {moduleId:${nbJsAttr(mod.moduleId)}})">
        <div>
          <div class="intent-tile-header">
            <span class="intent-tile-title">🎯 PYQ</span>
            <span>🏛️</span>
          </div>
          <div class="intent-tile-desc">Questions marked as previous-year (PYQ) in this topic.</div>
        </div>
        <div class="intent-tile-action" style="color:#06b6d4;">Explore Archive ➔</div>
      </div>

      <div class="intent-tile test" onclick="initTestSession(${nbJsAttr(mod.moduleId)}, ${nbJsAttr(mod.groups.find(g => g.questions?.length)?.groupId || '')}, 0)">
        <div>
          <div class="intent-tile-header">
            <span class="intent-tile-title">⏱️ TEST</span>
            <span>🏆</span>
          </div>
          <div class="intent-tile-desc">Strict CBT exam simulation with locked timer & full scorecard.</div>
        </div>
        <div class="intent-tile-action" style="color:#ef4444;">Start CBT ➔</div>
      </div>

      <div class="intent-tile test" onclick="sbOpenForModule(${nbJsAttr(mod.moduleId)})">
        <div>
          <div class="intent-tile-header">
            <span class="intent-tile-title">🧩 BUILD TEST</span>
            <span>⚙️</span>
          </div>
          <div class="intent-tile-desc">Your own test from this topic: choose count, time and difficulty.</div>
        </div>
        <div class="intent-tile-action" style="color:#2563eb;">Open Builder ➔</div>
      </div>
    </div>

    <div class="section-title ao-page-head">
      <span>🔬 Subtopic & Concept Breakdown</span>
    </div>
    <div class="grid-cards" style="margin-bottom:20px;">${topicSubtopicCardsHtml(mod) || '<div class="card-btn"><strong>No subtopics recorded</strong></div>'}</div>

    <div class="section-title ao-page-head">
      <span>📁 Practice / CBT Groups (${mod.groups.length})</span>
    </div>
    <div class="grid-cards">
      ${mod.groups.map(g => `
        <div class="card-btn">
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
            <strong>${escapeHtml(g.title)}</strong>
            <span style="font-size:11px; font-weight:800; background:var(--primary-light); color:var(--primary); padding:2px 8px; border-radius:999px;">
              ${g.questions.length} Qs
            </span>
          </div>
          <small style="margin-bottom:10px;">${escapeHtml(g.description)}</small>
          <div style="display:flex; gap:8px;">
            <button class="btn-nav secondary" style="flex:1; min-height:38px; font-size:12px; padding:6px;" onclick="navigate('practice', {moduleId:${nbJsAttr(mod.moduleId)}, qIndex:0})">
              Drill
            </button>
            <button class="btn-nav primary" style="flex:1; min-height:38px; font-size:12px; padding:6px;" onclick="initTestSession(${nbJsAttr(mod.moduleId)}, ${nbJsAttr(g.groupId)}, 0)">
              CBT Test
            </button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderSubtopicConceptPage(v, moduleId, subtopic) {
  const mod = getWorkspaceModule(moduleId);
  if (!mod) return navigate('home');

  v.innerHTML = `
    <div class="nav-breadcrumb">
      <button onclick="navigate('home')">Home</button>
      <span class="sep">/</span>
      <button onclick="navigate('topic', {moduleId:'${mod.moduleId}'})">${mod.topicTitle}</button>
      <span class="sep">/</span>
      <span>${subtopic}</span>
    </div>

    <div class="student-hero-card ao-page-head">
      <span class="journey-pill">🔬 SUBTOPIC LAYER</span>
      <h1>${subtopic}</h1>
      <p>Theory → Practice → Numerical → PYQ</p>
    </div>

    <div class="section-title ao-page-head">
      <span>Concept Modes</span>
      <button class="btn-action-sm" onclick="navigate('topic', {moduleId:'${mod.moduleId}'})">← Topic Hub</button>
    </div>

    <div class="grid-cards">
      <div class="card-btn" onclick="navigate('learn', {moduleId:'${mod.moduleId}'})">
        <strong>📖 Theory & Definition</strong>
        <small>Core concepts, physical principles & qualitative insights</small>
      </div>
      <div class="card-btn" onclick="navigate('revision', {moduleId:'${mod.moduleId}'})">
        <strong>🔄 Revise this topic</strong>
        <small>Cards and mistakes on a spaced schedule</small>
      </div>
      <div class="card-btn" onclick="setTaxonomyFilter('type', 'numerical'); navigate('taxonomy_explorer');">
        <strong>🔢 Numerical Problems</strong>
        <small>Step-by-step calculation drills & numerical variants</small>
      </div>
      <div class="card-btn" onclick="navigate('pyq', {moduleId:'${mod.moduleId}'})">
        <strong>📚 PYQ Pattern</strong>
        <small>Official competitive exam benchmark questions</small>
      </div>
    </div>
  `;
}

/* 5.4 TAXONOMY EXPLORER */
let ActiveTaxonomyFilters = { subject: '', type: '', difficulty: '', length: '', examId: '' };

function setTaxonomyFilter(key, val) { ActiveTaxonomyFilters[key] = val; renderView(); }
function resetTaxonomyFilters() { ActiveTaxonomyFilters = { subject: '', type: '', difficulty: '', length: '', examId: '' }; renderView(); }
function startSinglePractice(canonicalQId) {
  const q = IndexEngine.registry.get(canonicalQId);
  if (!q) return;
  const visibleModules = CurriculumContext.isActive() ? CurriculumContext.filterModules(AppModules) : WorkspaceManager.filterModules(AppModules);
  let targetMod = visibleModules[0]; let targetIndex = 0;
  for (const m of visibleModules) {
    const all = m.groups.flatMap(g => g.questions);
    const idx = all.findIndex(item => item.canonicalQId === canonicalQId || item.originalQNo === q.originalQNo);
    if (idx >= 0) { targetMod = m; targetIndex = idx; break; }
  }
  navigate('practice', { moduleId: targetMod.moduleId, qIndex: targetIndex });
}
function launchFilteredDrill() {
  const filtered = CurriculumContext.isActive() ? CurriculumContext.query(ActiveTaxonomyFilters) : IndexEngine.query(ActiveTaxonomyFilters);
  if (!filtered.length) return;
  startSinglePractice(filtered[0].canonicalQId);
}

/* 5.5 GLOBAL PYQ & CBT TEST & REVISION HUBS */
function renderGlobalPYQHub(v) { renderUniversalExamHub(v); }
function renderGlobalTestHub(v) {
  const resume = UserState.resumeState;
  const assessments = CurriculumContext.filterModules(AppModules)
    .map(mod => ({mod, group: mod.groups?.find(g => g.questions?.length)}))
    .filter(item => item.group);
  const selected = assessments.find(item => item.mod.moduleId === resume?.moduleId) || assessments[0];
  const {mod, group} = selected || {};
  const exam = mod ? UniversalExamRegistry.registry.get(mod.examId || group.questions[0]?.metadata?.examId) : null;

  v.innerHTML = `
    <div class="nav-breadcrumb">
      <button onclick="navigate('home')">Home</button>
      <span class="sep">/</span>
      <span>CBT Assessment Center</span>
    </div>

    <div class="student-hero-card ao-page-head">
      <span class="journey-pill">⏱️ Real Exam Simulation</span>
      <h1>Computer-Based Test (CBT)</h1>
      <p>Exam-style screen with timer, question palette and full scorecard. +1 per correct answer, no negative marking.</p>
    </div>

    ${mod ? `<div class="resume-action-card ao-primary-card">
      <div class="resume-info">
        <span class="resume-badge">🎯 READY ASSESSMENT</span>
        <div class="resume-title">${escapeHtml(mod.topicTitle)} — ${escapeHtml(group.title || 'G-01')}</div>
        <div class="resume-subtitle">${Number(exam?.defaultDurationMinutes) || 30} ${tx('Mins', 'मिनट')} • ${group.questions.length} ${tx('Questions', 'सवाल')}</div>
      </div>
      <button class="btn-nav primary" style="min-height:40px; padding:8px 14px; font-size:13px;" onclick="initTestSession(${nbJsAttr(mod.moduleId)}, ${nbJsAttr(group.groupId || '')}, 0, null, {curriculumContext:true})">
        ${tx('Start Test', 'टेस्ट शुरू करें')} ➔
      </button>
    </div>` : `<div class="sj-empty"><strong>${tx('No tests available yet', 'अभी कोई टेस्ट उपलब्ध नहीं है')}</strong><span>${tx('Choose your exam and sync its questions to start.', 'शुरू करने के लिए अपनी परीक्षा चुनें और सवाल सिंक करें।')}</span><button type="button" class="btn-nav primary" onclick="navigate('me')">${tx('Open exam settings', 'परीक्षा सेटिंग खोलें')} →</button></div>`}

    <button type="button" class="card-btn" style="width:100%;margin-bottom:12px;" onclick="openTestHistoryModal()">
      <strong>📜 Test History (${LearningHistory.resultsForWorkspace().length})</strong>
      <small>Open any test you submitted earlier, with answers and solutions.</small>
    </button>

    <div class="section-title ao-page-head">
      <span>Available Assessment Test Groups</span>
    </div>

    <div class="grid-cards">
      ${assessments.map(({mod: m, group: g}) => `
        <div class="card-btn">
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
            <strong>${escapeHtml(m.topicTitle)}</strong>
            <span class="mastery-badge good">${m.groups.filter(group => group.questions?.length).length} Tests</span>
          </div>
          <small>${escapeHtml(m.subjectTitle)} • Class Test Series</small>
          <div style="margin-top:12px;">
            <button class="btn-nav primary" style="width:100%; min-height:40px; font-size:12px;" onclick="initTestSession(${nbJsAttr(m.moduleId)}, ${nbJsAttr(g.groupId)}, 0, null, {curriculumContext:true})">
              Launch ${escapeHtml(g.title || 'G-01')} CBT Test ➔
            </button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}
function getScopedCompetitiveMistakes() {
  const ctx = CompetitiveContext.current();
  return (UserState.mistakeBook || []).filter(m => {
    const mod = getWorkspaceModule(m.moduleId);
    return mod && CompetitiveContext.matchesModule(mod, ctx);
  });
}