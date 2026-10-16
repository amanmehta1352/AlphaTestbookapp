/* =========================================================================
   PHASE 5B — COMPETITIVE EXAM HIERARCHY + DASHBOARD
   Uses the existing router and Competitive shell.
   ========================================================================= */
function competitiveEnabledGuard() { return WorkspaceManager.current().type === 'COMPETITIVE'; }
function competitiveModules(ctx = CompetitiveContext.current()) {
  return WorkspaceManager.filterModules(AppModules).filter(m => CompetitiveContext.matchesModule(m, ctx));
}
function renderCompetitiveDashboard(v) {
  if (!competitiveEnabledGuard()) return navigate('home');
  const exams = UniversalExamRegistry.getAllExams();
  const selected = UserState?.selectedExam || exams[0]?.examId || '';
  const exam = UniversalExamRegistry.registry.get(selected) || exams[0];
  const years = exam ? Array.from(exam.years || []).sort().reverse() : [];
  const ctx = CompetitiveContext.current(selected, UserState?.selectedYear || years[0]);
  const mods = competitiveModules(ctx);
  v.innerHTML = `<div class="competitive-shell">
    <div class="nav-breadcrumb"><button onclick="navigate('home')">Home</button><span class="sep">/</span><span>Competitive Exam Hub</span></div>
    <div class="student-hero-card"><span class="journey-pill">🏆 COMPETITIVE EXAM WORKSPACE</span><h1>${escapeHtml(exam?.examName || 'Competitive Exams')}</h1><p>Exam → Year → Subject → Chapter → Topic → Practice / CBT</p></div>
    <div class="section-title"><span>1 • Exam</span></div>
    <div class="grid-cards">${exams.map(ex=>`<button class="card-btn" onclick="setCompetitiveContext('${ex.examId}', '${Array.from(ex.years||[])[0]||'2024'}')"><strong>🏛️ ${escapeHtml(ex.examName)}</strong><small>${escapeHtml(ex.category||'Competitive Exam')} • ${ex.questionCount||0} Questions</small></button>`).join('')}</div>
    <div class="section-title"><span>2 • Year</span></div>
    <div class="grid-cards">${years.length?years.map(y=>`<button class="card-btn" onclick="setCompetitiveContext('${exam.examId}', '${String(y).replace(/'/g,"\\'")}')"><strong>📅 ${escapeHtml(y)}</strong><small>Open ${escapeHtml(exam.examName)} ${escapeHtml(y)}</small></button>`).join(''):'<div class="card-btn"><strong>No year registered</strong></div>'}</div>
    <div class="section-title"><span>3 • Subject</span></div>
    <div class="grid-cards">${Array.from(new Set(mods.map(m=>m.subject||m.subjectTitle||'Subject'))).map(subject=>`<button class="card-btn" onclick="navigate('competitive_chapters',{subject:'${String(subject).replace(/'/g,"\'")}'})"><strong>📘 ${escapeHtml(subject)}</strong><small>Open chapters</small></button>`).join('') || '<div class="card-btn"><strong>No subjects in selected context</strong><small>Choose another exam/year or import scoped questions.</small></div>'}</div>
    <div class="grid-cards"><button class="card-btn" onclick="navigate('competitive_subjects')"><strong>📚 Browse Subjects</strong><small>Continue through the Competitive hierarchy.</small></button><button class="card-btn" onclick="navigate('test_hub')"><strong>🧪 CBT Assessment</strong><small>Launch the existing CBT controller.</small></button></div>
  </div>`;
}
function setCompetitiveContext(examId, year) { UserState.selectedExam = examId; UserState.selectedYear = String(year || ''); saveUserState(); navigate('competitive_hub'); }

/* Phase 5D — application-level CBT visibility signal; no OS/browser security claims. */
document.addEventListener('visibilitychange', () => {
  if (ActiveTestSession?.sessionStatus === 'ACTIVE') {
    ActiveTestSession.lastVisibilityState = document.visibilityState;
    saveCbtRecoveryState();
    if (document.visibilityState === 'visible') openCustomToast('↩️ CBT session active — continue from the current question.');
  }
});

/* Phase 5E — one authoritative Back owner for app routes and active CBT. */
const CbtExitGuard = {
  HISTORY_KEY: 'masterTestBookCbtActive',
  armed: false,
  arm() {
    if (this.armed || ActiveTestSession?.sessionStatus !== 'ACTIVE') return;
    try { history.pushState({ ...(history.state || {}), __masterTestBookCbtGuard: this.HISTORY_KEY, __masterTestBookRoute: routeSnapshot(Route) }, document.title, location.href); } catch(_) {}
    this.armed = true;
  },
  disarm() { this.armed = false; },
  requestExit() {
    if (ActiveTestSession?.sessionStatus !== 'ACTIVE' || AppBackConfirmationOpen) return;
    AppBackConfirmationOpen=true;
    openModal('Test is in progress', `<div style="font-size:14px;line-height:1.6;color:var(--text-main);">Choose what to do with this active test. Submit opens the normal submit confirmation. Exit leaves the test after confirmation. Cancel returns to the current question without changing answers or timer.</div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap;"><button onclick="AppBackConfirmationOpen=false;closeModal();confirmSubmitTest()" class="btn-nav primary">SUBMIT</button><button onclick="CbtExitGuard.confirmExit()" class="btn-nav">EXIT</button><button onclick="cancelCbtExit()" class="btn-nav">CANCEL</button></div>`);
  },
  confirmExit(afterExit) {
    if (ActiveTestSession?.sessionStatus !== 'ACTIVE') { AppBackConfirmationOpen=false; closeModal(); if(typeof afterExit==='function')afterExit(); return; }
    if (TimerInterval) { clearInterval(TimerInterval); TimerInterval = null; }
    clearCbtRecoveryState();
    ActiveTestSession = null;
    this.disarm();
    AppBackConfirmationOpen=false;
    const cleanState = { ...(history.state || {}) };
    delete cleanState.__masterTestBookCbtGuard;
    history.replaceState(cleanState, document.title, location.href);
    closeModal();
    appNavigateBack(true);
    if(typeof afterExit==='function')afterExit();
  }
};
function cancelCbtExit(){ AppBackConfirmationOpen=false; closeModal(); }

/* Native Android Back and supported browser gestures generally surface as popstate.
   Restore a guard entry before showing any dialog so repeated presses cannot bypass it. */
window.addEventListener('popstate', (event) => {
  if (AllowOneBrowserExit) { AllowOneBrowserExit=false; return; }
  try { history.pushState({...history.state,__masterTestBookRoute:routeSnapshot(Route),__masterTestBookBackGuard:true},document.title,location.href); } catch(_) {}
  if (AppBackConfirmationOpen) return;
  if (ActiveTestSession?.sessionStatus === 'ACTIVE') { CbtExitGuard.requestExit(); return; }
  if (document.body.classList.contains('native-builder-active') && typeof sbHardwareBack==='function') { if(sbHardwareBack()) return; }
  const target=event.state?.__masterTestBookRoute;
  if(target && typeof target.page==='string' && target.page!=='test' && target.page!=='result' && !sameRoute(Route,target)){
    const snap=routeSnapshot(target);
    if(appBackWouldExitMode(snap)){ requestAppBackConfirmation(); return; }
    if(snap.params?.moduleId && !getWorkspaceModule(snap.params.moduleId)) { Route={page:'home',params:{}}; AppRouteStack=[]; persistAppRoute(); renderView(); updateAppBackButton(); return; }
    const stackTarget=currentPreviousAppRoute();
    if(stackTarget && sameRoute(stackTarget,snap)) { appNavigateBack(true); return; }
  }
  appNavigateBack(false);
});

window.addEventListener('beforeunload', (event) => {
  if (ActiveTestSession?.sessionStatus === 'ACTIVE' || Route?.page === 'practice') {
    event.preventDefault();
    event.returnValue = '';
  }
});

function getMathsParentChapter(chapter,subject=''){
  const s=String(subject||'').toLowerCase(),c=String(chapter||'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
  if(!/math|maths|mathematics|quantitative|arithmetic/.test(s)&&!/number system|percentage|profit|loss|simple interest|compound interest|ratio|average|geometry|mensuration|trigonometry|algebra|time and work|speed|distance|mixture|partnership|probability|statistics|data interpretation/.test(c))return String(chapter||'General');
  const groups=[
    ['Arithmetic',/number system|number theory|divisibility|percentage|profit|loss|simple interest|compound interest|ratio|proportion|average|mixture|alligation|partnership|time and work|pipe|cistern|speed|distance|train|boat|stream|age|simplification|approximation|fraction|decimal|hcf|lcm|unitary method|discount/],
    ['Algebra',/algebra|equation|polynomial|surds|indices|exponent|sequence|series/],
    ['Geometry',/geometry|triangle|circle|polygon|quadrilateral|angle|coordinate geometry/],
    ['Mensuration',/mensuration|area|perimeter|volume|surface area|solid/],
    ['Trigonometry',/trigonometry|trigonometric|height and distance/],
    ['Data Interpretation & Statistics',/data interpretation|statistics|mean|median|mode|graph|table chart/],
    ['Probability',/probability/]
  ];
  for(const [label,re] of groups)if(re.test(c))return label;
  return String(chapter||'General');
}
function competitiveScopedModulesFor(examId = null, year = null) { return competitiveModules(CompetitiveContext.current(examId || UserState?.selectedExam || null, year || UserState?.selectedYear || null)); }
function renderCompetitiveSubjects(v) {
  const mods = competitiveScopedModulesFor(); const subjects = Array.from(new Set(mods.map(m=>m.subject||m.subjectTitle||'Subject')));
  v.innerHTML = `<div class="nav-breadcrumb"><button onclick="navigate('competitive_hub')">Competitive Hub</button><span class="sep">/</span><span>Subjects</span></div><div class="section-title"><span>📚 ${escapeHtml(UserState?.selectedExam||'EXAM')} • ${escapeHtml(UserState?.selectedYear||'YEAR')} • Subjects</span></div><div class="grid-cards">${subjects.map(s=>`<button class="card-btn" onclick="navigate('competitive_chapters',{subject:'${String(s).replace(/'/g,"\\'")}'})"><strong>📘 ${escapeHtml(s)}</strong><small>Open chapters →</small></button>`).join('') || '<div class="card-btn"><strong>No subjects found</strong></div>'}</div>`;
}
function renderCompetitiveChapters(v, subject) {
  const mods = competitiveScopedModulesFor().filter(m=>(m.subject||m.subjectTitle||'')===subject); const chapters=Array.from(new Set(mods.map(m=>getMathsParentChapter(m.chapter||m.topicTitle||'General',m.subject||subject))));
  v.innerHTML = `<div class="nav-breadcrumb"><button onclick="navigate('competitive_subjects')">Subjects</button><span class="sep">/</span><span>${escapeHtml(subject)}</span></div><div class="section-title"><span>📖 Chapters</span></div><div class="grid-cards">${chapters.map(c=>`<button class="card-btn" onclick="navigate('competitive_topics',{subject:'${String(subject).replace(/'/g,"\\'")}',chapter:'${String(c).replace(/'/g,"\\'")}'})"><strong>📖 ${escapeHtml(c)}</strong><small>Open topics →</small></button>`).join('') || '<div class="card-btn"><strong>No chapters found</strong></div>'}</div>`;
}
function renderCompetitiveTopics(v, subject, chapter) {
  const mods=competitiveScopedModulesFor().filter(m=>(m.subject||m.subjectTitle||'')===subject && getMathsParentChapter(m.chapter||m.topicTitle||'General',m.subject||subject)===chapter);
  v.innerHTML = `<div class="nav-breadcrumb"><button onclick="navigate('competitive_chapters',{subject:'${String(subject).replace(/'/g,"\\'")}'})">${escapeHtml(subject)}</button><span class="sep">/</span><span>${escapeHtml(chapter)}</span></div><div class="section-title"><span>🧩 Topics</span></div><div class="grid-cards">${mods.map(m=>`<button class="card-btn" onclick="navigate('competitive_topic',{moduleId:'${String(m.moduleId).replace(/'/g,"\\'")}'})"><strong>🎯 ${escapeHtml(m.topicTitle||'Topic')}</strong><small>Practice / CBT →</small></button>`).join('') || '<div class="card-btn"><strong>No topics found</strong></div>'}</div>`;
}
function renderCompetitiveTopic(v, moduleId) { const mod=getWorkspaceModule(moduleId); if(!mod || !CompetitiveContext.matchesModule(mod)) return navigate('competitive_hub'); v.innerHTML=`<div class="nav-breadcrumb"><button onclick="navigate('competitive_subjects')">Subjects</button><span class="sep">/</span><span>${escapeHtml(mod.topicTitle||'Topic')}</span></div><div class="student-hero-card"><span class="journey-pill">🎯 TOPIC</span><h1>${escapeHtml(mod.topicTitle||'Topic')}</h1><p>${escapeHtml(mod.subjectTitle||mod.subject||'Subject')} • ${escapeHtml(mod.chapter||'Chapter')} • ${escapeHtml(mod.examId||UserState.selectedExam||'Exam')} • ${escapeHtml(mod.examYear||UserState.selectedYear||'Year')}</p></div><div class="grid-cards"><button class="card-btn" onclick="navigate('practice',{moduleId:'${String(mod.moduleId).replace(/'/g,"\\'")}',qIndex:0})"><strong>📝 Practice</strong><small>Open practice mode</small></button><button class="card-btn" onclick="initTestSession('${String(mod.moduleId).replace(/'/g,"\\'")}','${String(mod.groups?.[0]?.groupId||'').replace(/'/g,"\\'")}',0)"><strong>🧪 CBT</strong><small>Start exam simulation</small></button></div>`; }
