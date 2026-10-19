/* =========================================================================
   4. ROUTING & CONTROLLER ARCHITECTURE
   ========================================================================= */
let Route = { page: 'home', params: {} };
let ActiveTestSession = null;
let TimerInterval = null;
const APP_ROUTE_HISTORY_KEY = 'masterTestBookRouteHistoryV1';
let AppRouteStack = [];
let AppRouteRestoring = false;
// One renderer owns the shell. Features register named hooks instead of wrapping it.
const ViewHooks = { before: new Map(), after: new Map() };
const RouteViewStates = new Map();
const RouteUiMemory = new Map();
let RenderedRouteKey = '';
function registerViewHook(phase, name, hook) {
  ViewHooks[phase].set(name, hook);
}
function runViewHooks(phase) {
  ViewHooks[phase].forEach((hook, name) => {
    try { hook(); } catch (error) { console.warn('[View hook]', name, error); }
  });
}
function registerRouteViewState(page, adapter) { RouteViewStates.set(page, adapter); }
function routeUiKey(route = Route) {
  return JSON.stringify([WorkspaceManager.current().id, route.page, route.params]);
}
function captureRouteView() {
  if (RenderedRouteKey !== routeUiKey()) return;
  const adapter = RouteViewStates.get(Route.page);
  RouteUiMemory.delete(RenderedRouteKey);
  RouteUiMemory.set(RenderedRouteKey, {
    scroll: document.getElementById('mainView')?.scrollTop || 0,
    state: adapter ? adapter.capture() : null
  });
  while (RouteUiMemory.size > 40) RouteUiMemory.delete(RouteUiMemory.keys().next().value);
}
function routeSnapshot(route=Route){ return {page:String(route?.page||'home'),params:route?.params&&typeof route.params==='object'?route.params:{}}; }
function sameRoute(a,b){ return !!a&&!!b&&a.page===b.page&&JSON.stringify(a.params||{})===JSON.stringify(b.params||{}); }
function persistAppRoute(){ try { sessionStorage.setItem(APP_ROUTE_HISTORY_KEY, JSON.stringify({version:1,workspaceId:WorkspaceManager.current().id,stack:AppRouteStack.slice(-40),current:routeSnapshot()})); } catch(_) {} }
function restoreAppRoute(){
  try {
    const saved=JSON.parse(sessionStorage.getItem(APP_ROUTE_HISTORY_KEY)||'null');
    if(saved?.version!==1 || saved.workspaceId!==WorkspaceManager.current().id || !saved.current || typeof saved.current.page!=='string') return false;
    const candidate=routeSnapshot(saved.current);
    if(candidate.page==='test' || candidate.page==='result') return false;
    if(candidate.params?.moduleId && !getWorkspaceModule(candidate.params.moduleId)) return false;
    AppRouteStack=Array.isArray(saved.stack)?saved.stack.filter(x=>x&&typeof x.page==='string'&&x.page!=='test'&&x.page!=='result').slice(-40):[];
    Route=candidate; AppRouteRestoring=true; return true;
  } catch(_) { return false; }
}
function updateAppBackButton(){
  const b=document.getElementById('btnAppBack'); if(!b)return;
  const canBack=Route.page!=='home' || AppRouteStack.length>0;
  b.hidden=!canBack; b.disabled=!canBack;
  b.setAttribute('aria-label', tx('Back', 'वापस')); b.title=tx('Back', 'वापस'); b.textContent='← '+tx('Back', 'वापस');
}
const APP_ACTIVE_MODE_PAGES = new Set(['practice','test','learn','revision','pyq','mockSession','mock_session']);
let AppBackConfirmationOpen = false;
let AllowOneBrowserExit = false;
function currentPreviousAppRoute(){ return AppRouteStack.length ? routeSnapshot(AppRouteStack[AppRouteStack.length-1]) : null; }
function appBackWouldExitMode(target=currentPreviousAppRoute()){
  return APP_ACTIVE_MODE_PAGES.has(Route.page) && (!target || target.page !== Route.page);
}
function appNavigateBack(confirmed=false){
  const previous=currentPreviousAppRoute();
  if(!confirmed && ActiveTestSession?.sessionStatus==='ACTIVE'){ CbtExitGuard.requestExit(); return; }
  if(!confirmed && Route.page==='practice'){ requestPracticeBackOptions(); return; }
  if(!confirmed && (appBackWouldExitMode(previous) || (!previous && Route.page==='home'))){ requestAppBackConfirmation(); return; }
  if(ActiveTestSession?.sessionStatus==='ACTIVE'){ CbtExitGuard.requestExit(); return; }
  AppBackConfirmationOpen=false;
  captureRouteView();
  if(previous){
    AppRouteStack.pop(); AppBackConfirmationOpen=false;
    AppRouteRestoring=true; Route=routeSnapshot(previous); persistAppRoute(); renderView(); updateAppBackButton();
    try { history.replaceState({...history.state,__masterTestBookRoute:routeSnapshot(Route)},document.title,location.href); } catch(_) {}
    return;
  }
  if(Route.page!=='home'){
    AppRouteRestoring=true; Route={page:'home',params:{}}; persistAppRoute(); renderView(); updateAppBackButton();
    try { history.replaceState({...history.state,__masterTestBookRoute:routeSnapshot(Route)},document.title,location.href); } catch(_) {}
    return;
  }
  if(confirmed){
    closeModal();
    AllowOneBrowserExit=true;
    try { history.back(); } catch(_) { AllowOneBrowserExit=false; }
    return;
  }
  requestAppBackConfirmation();
}
function practiceSessionSummary(){
  const params=Route?.params||{},mod=getWorkspaceModule(params.moduleId);
  const qs=Array.isArray(params.customQuestions)?params.customQuestions:(mod?.groups||[]).flatMap(g=>g.questions||[]);
  const answered=qs.filter(q=>Object.prototype.hasOwnProperty.call(PracticeAnswerState,String(q.originalQNo))||Object.prototype.hasOwnProperty.call(PracticeSubjectiveState,String(q.originalQNo))).length;
  const correct=qs.filter(q=>Object.prototype.hasOwnProperty.call(PracticeAnswerState,String(q.originalQNo))&&PracticeAnswerState[String(q.originalQNo)]===q.answer).length;
  const wrong=qs.filter(q=>Object.prototype.hasOwnProperty.call(PracticeAnswerState,String(q.originalQNo))&&PracticeAnswerState[String(q.originalQNo)]!==q.answer).length;
  return {total:qs.length,answered,correct,wrong,unanswered:Math.max(0,qs.length-answered)};
}
function requestPracticeBackOptions(){
  if(AppBackConfirmationOpen)return;AppBackConfirmationOpen=true;
  const x=practiceSessionSummary();
  openModal(tx('Practice is in progress', 'अभ्यास चल रहा है'),`<div style="font-size:14px;line-height:1.6;color:var(--text-main);">${tx('You have an active practice session. Submit shows a summary; Exit returns to the previous screen; Cancel keeps this question open. Existing answers and mistake-book entries are not deleted.', 'आपका अभ्यास चल रहा है। जमा करें से सारांश दिखेगा; बाहर निकलें से पिछला पेज खुलेगा; रद्द करें से यही सवाल खुला रहेगा। सहेजे जवाब और गलतियों की किताब सुरक्षित रहेंगे।')}</div><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:12px;font-size:12px;"><div class="nb-stat"><small>${tx('ANSWERED', 'हल किए')}</small><strong>${x.answered} / ${x.total}</strong></div><div class="nb-stat"><small>${tx('UNANSWERED', 'बिना हल किए')}</small><strong>${x.unanswered}</strong></div></div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap;"><button onclick="submitPracticeSessionSummary()" class="btn-nav primary">${tx('SUBMIT', 'जमा करें')}</button><button onclick="exitPracticeSession()" class="btn-nav">${tx('EXIT', 'बाहर निकलें')}</button><button onclick="cancelAppBack()" class="btn-nav">${tx('CANCEL', 'रद्द करें')}</button></div>`);
}
function submitPracticeSessionSummary(){
  const x=practiceSessionSummary();AppBackConfirmationOpen=true;
  openModal(tx('Practice summary', 'अभ्यास का सारांश'),`<div style="font-size:14px;line-height:1.6;color:var(--text-main);">${tx('Practice review summary from the questions available in this session. This does not write a separate scored exam result.', 'इस अभ्यास के सवालों का सारांश। इसे अलग परीक्षा परिणाम के रूप में नहीं सहेजा जाएगा।')}</div><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:12px;font-size:12px;"><div class="nb-stat"><small>${tx('ANSWERED', 'हल किए')}</small><strong>${x.answered} / ${x.total}</strong></div><div class="nb-stat"><small>${tx('CORRECT', 'सही')}</small><strong>${x.correct}</strong></div><div class="nb-stat"><small>${tx('WRONG', 'गलत')}</small><strong>${x.wrong}</strong></div><div class="nb-stat"><small>${tx('UNANSWERED', 'बिना हल किए')}</small><strong>${x.unanswered}</strong></div></div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap;"><button onclick="cancelAppBack()" class="btn-nav">${tx('KEEP REVIEWING', 'देखते रहें')}</button><button onclick="exitPracticeSession()" class="btn-nav primary">${tx('FINISH PRACTICE', 'अभ्यास पूरा करें')}</button></div>`);
}
function exitPracticeSession(){AppBackConfirmationOpen=false;closeModal();appNavigateBack(true);}

function requestAppBackConfirmation(){
  if(AppBackConfirmationOpen) return;
  if(ActiveTestSession?.sessionStatus==='ACTIVE'){ CbtExitGuard.requestExit(); return; }
  if(Route.page==='practice'){ requestPracticeBackOptions(); return; }
  AppBackConfirmationOpen=true;
  const atRoot=Route.page==='home' && !AppRouteStack.length;
  const message=atRoot
    ? tx('You are at the application root. Confirm only if you want to leave this page; the browser or Android may still control whether it can close.', 'आप होम पेज पर हैं। ऐप छोड़ने के लिए पुष्टि करें। पेज बंद करना ब्राउज़र या Android के नियंत्रण में है।')
    : tx('Leaving this mode will return to the previous screen. Cancel to keep your current screen and progress.', 'बाहर निकलने पर पिछला पेज खुलेगा। इसी पेज पर रहने के लिए रद्द करें।');
  openModal(atRoot?tx('Leave Master TestBook?', 'Master TestBook छोड़ें?'):tx('Exit current mode?', 'इस मोड से बाहर निकलें?'), `<div style="font-size:14px;line-height:1.6;color:var(--text-main);">${message}</div><div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;flex-wrap:wrap;"><button onclick="cancelAppBack()" class="btn-nav">${tx('CANCEL / STAY', 'रद्द करें / रहें')}</button><button onclick="confirmAppBack()" class="btn-nav primary">${tx('CONFIRM EXIT', 'बाहर निकलें')}</button></div>`);
}
function cancelAppBack(){ AppBackConfirmationOpen=false; closeModal(); }
function confirmAppBack(){
  if(ActiveTestSession?.sessionStatus==='ACTIVE'){ CbtExitGuard.confirmExit(); return; }
  AppBackConfirmationOpen=false; closeModal(); appNavigateBack(true);
}
function navigate(page, params = {}) {
  if (ActiveTestSession?.sessionStatus === 'ACTIVE' && page !== 'test') {
    if (page === 'result') { /* submitTestSession clears the session before the result route is reached */ }
    else { openCustomToast('🔒 CBT ACTIVE — Exit is locked until submission.'); return; }
  }
  if (page !== 'home' && params?.workspaceId && params.workspaceId !== WorkspaceManager.current().id) { page = 'home'; params = {}; }
  const curriculumPage = typeof CurriculumContext !== 'undefined' && CurriculumContext.isPage(page);
  const inheritedCurriculum = typeof CurriculumContext !== 'undefined' && CurriculumContext.isActive() && curriculumPage;
  if (curriculumPage && (page === 'subjects' || inheritedCurriculum)) {
    params = { ...params, curriculumContext: true };
  } else if (!curriculumPage && params?.curriculumContext) {
    const nextParams = { ...params };
    delete nextParams.curriculumContext;
    params = nextParams;
  }
  const nextRoute = { page, params };
  if (!AppRouteRestoring && !sameRoute(Route,nextRoute) && Route.page!=='test' && page!=='result' && !(ActiveTestSession?.sessionStatus==='ACTIVE')) {
    AppRouteStack.push(routeSnapshot(Route));
    if(AppRouteStack.length>40) AppRouteStack=AppRouteStack.slice(-40);
  }
  captureRouteView();
  AppRouteRestoring=false;
  Route = nextRoute;
  persistAppRoute();
  try { history.pushState({...history.state,__masterTestBookRoute:routeSnapshot(Route)},document.title,location.href); } catch(_) {}
  closeDrawer();
  closeModal();
  
  if (page !== 'test') {
    if (TimerInterval) { clearInterval(TimerInterval); TimerInterval = null; }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  renderView();
}

const AppRoutes = {
  home: { nav: 'home', title: ['🏠 Home', '🏠 होम'], render: v => {
    if (WorkspaceManager.current().type === 'BOARD') {
      document.getElementById('txtHeaderTitle').textContent = '🎓 CBSE CAMPUS';
      renderBoardDashboard(v);
    } else renderHomePage(v);
  } },
  competitive_hub: { nav: 'exams', title: ['🏆 Competitive exams', '🏆 प्रतियोगी परीक्षाएँ'], render: v => renderCompetitiveDashboard(v) },
  competitive_subjects: { nav: 'exams', title: ['📚 Subjects', '📚 विषय'], render: v => renderCompetitiveSubjects(v) },
  competitive_chapters: { nav: 'exams', title: ['📚 Chapters', '📚 अध्याय'], render: (v, p) => renderCompetitiveChapters(v, p.subject) },
  competitive_topics: { nav: 'exams', title: ['📚 Topics', '📚 टॉपिक'], render: (v, p) => renderCompetitiveTopics(v, p.subject, p.chapter) },
  competitive_topic: { nav: 'exams', title: ['📚 Topic', '📚 टॉपिक'], render: (v, p) => renderCompetitiveTopic(v, p.moduleId) },
  exam_hub: { nav: 'exams', title: ['🏛️ Exams', '🏛️ परीक्षाएँ'], render: v => renderUniversalExamHub(v) },
  exam_profile: { nav: 'exams', title: ['🎓 Exam', '🎓 परीक्षा'], render: (v, p) => renderExamProfile(v, p.examId) },
  syllabus: { nav: 'exams', title: ['📚 Syllabus', '📚 पाठ्यक्रम'], render: (v, p) => renderSyllabusMatrix(v, p.examId) },
  board_subjects: { nav: 'subjects', title: ['📚 Subjects', '📚 विषय'], render: v => renderBoardSubjects(v) },
  board_chapters: { nav: 'subjects', title: ['📚 Chapters', '📚 अध्याय'], render: (v, p) => renderBoardChapters(v, p.subjectId) },
  board_topics: { nav: 'subjects', title: ['📚 Topics', '📚 टॉपिक'], render: (v, p) => renderBoardTopics(v, p.chapterId, p.subjectId) },
  board_topic: { nav: 'subjects', title: ['📚 Topic', '📚 टॉपिक'], render: (v, p) => renderBoardTopic(v, p.topicId, p.chapterId, p.subjectId) },
  digital_library: { nav: 'library', title: ['📖 Study library', '📖 स्टडी लाइब्रेरी'], render: v => renderDigitalLibrary(v) },
  native_builder: { nav: 'builder', title: ['🧩 Create Test', '🧩 टेस्ट बनाएँ'], render: v => renderNativeBuilder(v) },
  subjects: { nav: 'subjects', title: ['📚 Subjects', '📚 विषय'], render: v => renderSubjectsCatalog(v) },
  subject: { nav: 'subjects', title: ['📚 Chapters', '📚 अध्याय'], render: (v, p) => renderSubjectPage(v, p.subject) },
  chapter: { nav: 'subjects', title: ['📚 Topics', '📚 टॉपिक'], render: (v, p) => renderChapterPage(v, p.subject, p.chapter) },
  topic: { nav: 'subjects', title: ['📚 Topic', '📚 टॉपिक'], render: (v, p) => renderTopicHubPage(v, p.moduleId) },
  subtopic: { nav: 'subjects', title: ['📚 Subtopic', '📚 उपविषय'], render: (v, p) => renderSubtopicConceptPage(v, p.moduleId, p.subtopic) },
  taxonomy_explorer: { nav: 'bank', title: ['🔎 Question Bank', '🔎 प्रश्न बैंक'], render: (v, p) => renderTaxonomyExplorer(v, p) },
  learn: { nav: 'subjects', title: ['📖 Learn', '📖 सीखें'], render: (v, p) => renderLearnEngine(v, p.moduleId) },
  revision: { nav: 'revision', title: ['🔄 Revision', '🔄 रिवीज़न'], render: (v, p) => renderRevisionEngine(v, p.moduleId) },
  practice: { nav: 'subjects', title: ['✍️ Practice', '✍️ अभ्यास'], render: (v, p) => renderPracticeEngine(v, p.moduleId, p.qIndex || 0, p.customQuestions) },
  class: { nav: 'subjects', title: ['📚 Class', '📚 कक्षा'], render: (v, p) => renderClassEngine(v, p.moduleId) },
  pyq: { nav: 'pyq', title: ['🎯 PYQ papers', '🎯 पिछले वर्ष के पेपर'], render: (v, p) => renderPYQEngine(v, p.moduleId) },
  pyq_hub: { nav: 'pyq', title: ['🎯 PYQ papers', '🎯 पिछले वर्ष के पेपर'], render: v => renderGlobalPYQHub(v) },
  test_hub: { nav: 'tests', title: ['⏱️ Tests', '⏱️ टेस्ट'], render: v => renderGlobalTestHub(v) },
  revision_hub: { nav: 'revision', title: ['🔄 Revision', '🔄 रिवीज़न'], render: v => renderGlobalRevisionHub(v) },
  test: { nav: 'tests', title: ['⏱️ Test', '⏱️ टेस्ट'], render: (v, p) => renderTestPage(v, p.moduleId, p.groupId, p.qIndex || 0) },
  mistakes: { nav: 'revision', title: ['📕 Mistake Book', '📕 गलतियों की किताब'], render: v => renderMistakeBookPage(v) },
  mastery: { nav: 'revision', title: ['🎯 Mastery', '🎯 महारत'], render: v => renderMasteryPage(v) },
  result: { nav: 'tests', title: ['📊 Result', '📊 परिणाम'], render: (v, p) => renderResultPage(v, p.result) },
  me: { nav: 'me', title: ['👤 Me', '👤 मैं'], render: v => renderMePage(v) }
};
const RouteNavItems = {
  home: ['tabHome', 'drwHome'], subjects: ['tabSubjects', 'drwSubjects'],
  exams: ['tabPYQ', 'drwExams'], tests: ['tabTest', 'drwTest'],
  builder: ['tabTest', 'drwNativeBuilder'], pyq: ['tabPYQ', 'drwPYQ'],
  revision: ['tabRevision', 'drwRevision'], bank: ['drwTaxonomy'],
  library: ['drwLibrary'], me: ['drwMe', 'btnMe']
};
function updateRouteNavigation() {
  document.querySelectorAll('.nav-tab, .drawer-item, #btnMe').forEach(el => {
    el.classList.remove('active'); el.removeAttribute('aria-current');
  });
  (RouteNavItems[AppRoutes[Route.page]?.nav] || []).forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.add('active'); el.setAttribute('aria-current', 'page'); }
  });
}
function renderView() {
  const container = document.getElementById('mainView');
  if (!container) return;
  if (Route.params?.moduleId && !enforceWorkspaceRoute(Route.page, Route.params)) return renderView();
  const key = routeUiKey();
  const changed = key !== RenderedRouteKey;
  const saved = RouteUiMemory.get(key);
  const scroll = changed
    ? AppRouteRestoring
      ? saved?.scroll || 0
      : 0
    : container.scrollTop;
  if (changed) RouteViewStates.get(Route.page)?.restore(saved?.state, AppRouteRestoring);
  RenderedRouteKey = key;
  AppRouteRestoring = false;
  nbApplyShellForRoute(Route.page);
  updateRouteNavigation();
  updateAppBackButton();
  const header = document.getElementById('appHeader');
  if (header && !document.getElementById('workspaceSwitcherBtn')) {
    const b = document.createElement('button'); b.id = 'workspaceSwitcherBtn'; b.className = 'btn-action-sm';
    b.textContent = "🧭 " + tx("Workspace", "वर्कस्पेस");
    b.onclick = openWorkspaceSwitcher;
    document.querySelector("#sideDrawer .drawer-nav").appendChild(b);
  }
  const title = document.getElementById('txtHeaderTitle');
  if (title) title.textContent = '📚 Master TestBook';
  runViewHooks('before');
  AppRoutes[Route.page]?.render(container, Route.params || {});
  runViewHooks('after');
  container.scrollTop = scroll;
  requestAnimationFrame(() => { if (RenderedRouteKey === key) container.scrollTop = scroll; });
}

/* V2.1.5 — Native Builder integration. Uses the existing IndexEngine registry and CBT host lifecycle. */
const NativeBuilderState = { tab:'selection', wizardStep:0, mode:'custom', search:'', examId:'', year:'', difficulty:'', subjects:new Set(), topics:new Set(), selectedIds:new Set(), questionTypes:new Set(), requestedCount:20, durationMinutes:30, langMode:'both', shuffleQuestions:true, previewIds:[], previewFingerprint:'', busy:false, error:'' };
let NativeBuilderStartLock = false;
function nbEsc(v){return escapeHtml(String(v??''));}
function nbJsAttr(v){return JSON.stringify(String(v??'')).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function nbQuestionKey(q){return ActiveTestSession?.sessionContractVersion===1 ? String(q?.canonicalQId||'') : String(q?.originalQNo??'');}
function nbTypeInfo(row){
  const q=row?.q||{},m=q.metadata||{};
  const candidates=[q.SUB_TOPIC,q.subTopic,q.SUB_CONCEPT,m.subtopic,m.subTopic,q.CONCEPT,q.concept,m.concept,row?.topic,row?.chapter];
  let raw='';
  for(const value of candidates){
    const label=String(value||'').replace(/\s+/g,' ').trim();
    if(label && !/^(general subtopic|core concept|unspecified|unknown|n\/a)$/i.test(label)){raw=label;break;}
  }
  const label=raw||'General / uncategorised';
  const normalized=label.toLocaleLowerCase().normalize('NFKC').replace(/[^\w\u0900-\u097F]+/g,'-').replace(/^-+|-+$/g,'')||'general';
  return {id:'SUBTOPIC:'+normalized,label};
}
function nbTypeCategory(row){return nbTypeInfo(row).id;}
function nbVerifiedPYQ(row){ return pyqStatusOf(row?.q) === 'PYQ'; }
function nbSafePYQ(row){
  if(!row||row.sourceContextMismatch||!nbVerifiedPYQ(row))return false;
  const sourceExam=String(row.sourceExamId||row.sourceExamName||row.examId||'').trim();
  const sourceYear=String(row.sourceYear||row.year||'').trim();
  return !!(sourceExam&&/^\d{4}$/.test(sourceYear));
}
function nbSelectBuilderMode(mode){
  const allowed=['quick','custom','topic','pyq','mock'];if(!allowed.includes(mode))return;
  if(mode==='pyq'&&!nbSourceRows().some(nbSafePYQ)){const rows=nbSourceRows();const found=rows.some(nbVerifiedPYQ);openCustomToast(found?'PYQ mode is blocked: source exam/year metadata conflicts with the current module assignment. Reconcile the mapping before creating an exam-specific PYQ test.':'PYQ mode is unavailable: this workspace has no questions with verified previous-year source metadata.');return;}
  if(mode==='mock'&&!nbHasVerifiedMockPattern(NativeBuilderState.examId||UserState?.selectedExam)){openCustomToast('Full Mock is unavailable until this exam has a verified exam-pattern contract. Choose Quick Test or Custom Test.');return;}
  const previous=NativeBuilderState.mode;NativeBuilderState.mode=mode;
  if(previous!==mode){
    NativeBuilderState.questionTypes.clear();NativeBuilderState.selectedIds.clear();
    if(mode==='quick'){
      const rows=nbSourceRows();const prefExam=String(UserState?.selectedExam||'');const prefYear=String(UserState?.selectedYear||'');
      const preferred=rows.find(r=>r.examId===prefExam&&r.year===prefYear)||rows.find(r=>r.examId===prefExam)||rows[0];
      if(preferred){NativeBuilderState.examId=preferred.examId||'';NativeBuilderState.year=preferred.year||'';NativeBuilderState.difficulty='';NativeBuilderState.subjects.clear();NativeBuilderState.topics.clear();NativeBuilderState.selectedIds.clear();rows.filter(r=>r.examId===NativeBuilderState.examId&&r.year===NativeBuilderState.year).forEach(r=>NativeBuilderState.subjects.add(r.subject));NativeBuilderState.requestedCount=Math.max(1,Math.min(20,rows.filter(r=>r.examId===NativeBuilderState.examId&&r.year===NativeBuilderState.year).length||20));}
    }
    if(mode==='pyq') { NativeBuilderState.subjects.clear();NativeBuilderState.topics.clear();NativeBuilderState.selectedIds.clear();NativeBuilderState.examId='';NativeBuilderState.year=''; }
    if(mode==='custom'||mode==='topic') { NativeBuilderState.subjects.clear();NativeBuilderState.topics.clear();NativeBuilderState.selectedIds.clear(); }
    NativeBuilderState.error='';nbResetPreview();
  }
  NativeBuilderState.tab='selection';NativeBuilderState.wizardStep=0;renderView();
}
function nbTypeCounts(rows=nbSourceRows()){
  const out={};
  for(const r of rows){const info=nbTypeInfo(r);if(!out[info.id])out[info.id]={label:info.label,count:0};out[info.id].count++;}
  return out;
}
function nbBuilderTypePool(){
  let rows=nbSourceRows();const term=String(NativeBuilderState.search||'').trim().toLowerCase();
  if(NativeBuilderState.examId)rows=rows.filter(r=>r.examId===NativeBuilderState.examId);
  if(NativeBuilderState.year)rows=rows.filter(r=>r.year===NativeBuilderState.year);
  if(NativeBuilderState.difficulty)rows=rows.filter(r=>r.difficulty===NativeBuilderState.difficulty);
  if(NativeBuilderState.mode==='pyq')rows=rows.filter(nbSafePYQ);
  if(term)rows=rows.filter(r=>[r.subject,r.chapter,r.topic,r.q.QUESTION_EN,r.q.QUESTION_HI,r.id].some(v=>String(v||'').toLowerCase().includes(term)));
  if(NativeBuilderState.subjects.size||NativeBuilderState.topics.size){
    const selectedTopicsBySubject=new Map();
    for(const key of NativeBuilderState.topics){const parts=key.split('\u241f');const subject=parts[0];selectedTopicsBySubject.set(subject,(selectedTopicsBySubject.get(subject)||new Set()).add(key));}
    rows=rows.filter(r=>{const key=r.subject+'\u241f'+r.chapter+'\u241f'+r.topic;const parentChosen=NativeBuilderState.subjects.has(r.subject);const childKeys=selectedTopicsBySubject.get(r.subject);if(parentChosen)return childKeys&&childKeys.size?childKeys.has(key):true;return NativeBuilderState.topics.has(key);});
  }
  return rows;
}
function nbClampRequestedCountToPool(){
  if(NativeBuilderState.selectedIds.size)return;
  const available=nbFilteredRows().length;
  if(available>0&&Number(NativeBuilderState.requestedCount)>available)NativeBuilderState.requestedCount=available;
}
function nbToggleQuestionType(type,checked){
  const counts=nbTypeCounts(nbBuilderTypePool());
  if(!Object.prototype.hasOwnProperty.call(counts,type)||!counts[type]?.count)return;
  if(checked)NativeBuilderState.questionTypes.add(type);else NativeBuilderState.questionTypes.delete(type);
  NativeBuilderState.selectedIds.clear();
  NativeBuilderState.error='';nbResetPreview();nbClampRequestedCountToPool();renderView();
}
function nbSourceRows(){
  const workspace=WorkspaceManager.current();
  if(!workspace?.id || workspace.type==='BOARD' || !IndexEngine?.registry || typeof IndexEngine.registry.get!=='function') return [];
  const owners=new Map();
  for(const mod of WorkspaceManager.filterModules(AppModules||[])){
    if(!mod || mod.workspaceId!==workspace.id || mod.workspaceType!==workspace.type || mod.workspaceType==='BOARD') continue;
    for(const group of (mod.groups||[])) for(const q of (group.questions||[])){
      const id=String(q?.canonicalQId||'').trim(); if(!id) continue;
      if(!owners.has(id)) owners.set(id,[]);
      owners.get(id).push({q,mod,group});
    }
  }
  const rows=[];
  for(const [id,entries] of owners){
    if(entries.length!==1) continue;
    const {q,mod,group}=entries[0];
    if(IndexEngine.registry.get(id)!==q) continue;
    const meta=q.metadata||{};
    const subject=String(meta.subject||mod.subject||mod.title||mod.topicTitle||'').trim();
    const chapter=String(meta.chapter||mod.chapter||mod.topicTitle||'').trim();
    const topic=String(meta.topic||meta.subtopic||mod.topicTitle||chapter||'').trim();
    const format=String(meta.questionFormat||q.TYPE||'MCQ').toUpperCase();
    const hasStem=!!(q.QUESTION_EN||q.QUESTION_HI);
    const validContent=format==='SUBJECTIVE'?hasStem:(hasStem&&Array.isArray(q.options)&&q.options.length>0&&!!q.answer);
    if(!subject || !topic || !validContent) continue;
    const sourceExamId=String(meta.examId||meta.examCategoryId||'').trim();
    const sourceExamName=String(meta.exam||meta.examName||'').trim();
    const sourceYear=String(meta.year||meta.examYear||meta.sourceYear||'').trim();
    const moduleExamId=String(mod.examId||'').trim();
    const moduleYear=String(mod.examYear||'').trim();
    const sourceContextMismatch=!!((sourceExamId&&moduleExamId&&sourceExamId.toLowerCase()!==moduleExamId.toLowerCase())||(sourceYear&&moduleYear&&sourceYear!==moduleYear));
    rows.push({id,q,mod,group,subject,chapter:chapter||'Uncategorised',topic,difficulty:String(meta.difficulty||'Unspecified'),type:format,examId:String(mod.examId||meta.examId||''),year:String(mod.examYear||meta.year||''),sourceExamId,sourceExamName,sourceYear,sourceContextMismatch,workspaceId:workspace.id,workspaceType:workspace.type});
  }
  return rows.sort((a,b)=>a.subject.localeCompare(b.subject)||a.chapter.localeCompare(b.chapter)||a.topic.localeCompare(b.topic)||a.id.localeCompare(b.id));
}

function nbFilteredRows(){
  let rows=nbSourceRows();const term=NativeBuilderState.search.trim().toLowerCase();
  if(NativeBuilderState.examId)rows=rows.filter(r=>r.examId===NativeBuilderState.examId);
  if(NativeBuilderState.year)rows=rows.filter(r=>r.year===NativeBuilderState.year);
  if(NativeBuilderState.difficulty)rows=rows.filter(r=>r.difficulty===NativeBuilderState.difficulty);
  if(NativeBuilderState.mode==='pyq')rows=rows.filter(nbSafePYQ);
  if(NativeBuilderState.questionTypes?.size)rows=rows.filter(r=>NativeBuilderState.questionTypes.has(nbTypeCategory(r)));
  if(term)rows=rows.filter(r=>[r.subject,r.chapter,r.topic,r.q.QUESTION_EN,r.q.QUESTION_HI,r.id].some(v=>String(v||'').toLowerCase().includes(term)));
  if(NativeBuilderState.subjects.size||NativeBuilderState.topics.size){
    const topicRows=new Map();for(const r of rows){const key=r.subject+'\u241f'+r.chapter+'\u241f'+r.topic;if(!topicRows.has(key))topicRows.set(key,[]);topicRows.get(key).push(r);}
    const selectedTopicsBySubject=new Map();for(const key of NativeBuilderState.topics){const parts=key.split('\u241f');const subject=parts[0];selectedTopicsBySubject.set(subject,(selectedTopicsBySubject.get(subject)||new Set()).add(key));}
    rows=rows.filter(r=>{
      const key=r.subject+'\u241f'+r.chapter+'\u241f'+r.topic;const parentChosen=NativeBuilderState.subjects.has(r.subject);const childKeys=selectedTopicsBySubject.get(r.subject);
      if(parentChosen)return childKeys&&childKeys.size?childKeys.has(key):true;
      return NativeBuilderState.topics.has(key);
    });
  }
  return rows;
}

function nbVisibleTopics(){
  let rows=nbSourceRows(); const s=NativeBuilderState.search.trim().toLowerCase();
  if(NativeBuilderState.examId) rows=rows.filter(r=>r.examId===NativeBuilderState.examId);
  if(NativeBuilderState.year) rows=rows.filter(r=>r.year===NativeBuilderState.year);
  if(NativeBuilderState.difficulty) rows=rows.filter(r=>r.difficulty===NativeBuilderState.difficulty);
  if(NativeBuilderState.mode==='pyq') rows=rows.filter(nbSafePYQ);
  if(NativeBuilderState.questionTypes?.size) rows=rows.filter(r=>NativeBuilderState.questionTypes.has(nbTypeCategory(r)));
  if(NativeBuilderState.subjects.size) rows=rows.filter(r=>NativeBuilderState.subjects.has(r.subject));
  if(s) rows=rows.filter(r=>[r.subject,r.chapter,r.topic,r.q.QUESTION_EN,r.q.QUESTION_HI].some(v=>String(v||'').toLowerCase().includes(s)));
  const map=new Map(); for(const r of rows){const k=r.subject+'\u241f'+r.chapter+'\u241f'+r.topic;if(!map.has(k))map.set(k,{key:k,subject:r.subject,chapter:r.chapter,topic:r.topic,count:0,ids:new Set()});const x=map.get(k);if(!x.ids.has(r.id)){x.ids.add(r.id);x.count++;}}
  return [...map.values()].map(x=>({...x,count:x.ids.size,ids:undefined})).sort((a,b)=>a.subject.localeCompare(b.subject)||a.chapter.localeCompare(b.chapter)||a.topic.localeCompare(b.topic));
}

function nbFilteredTopicRows(){const topics=nbVisibleTopics();return NativeBuilderState.topics.size?topics.filter(t=>NativeBuilderState.topics.has(t.key)):topics;}
function nbResetPreview(){NativeBuilderState.previewIds=[];NativeBuilderState.previewFingerprint='';}
function nbSetTab(tab){NativeBuilderState.tab=tab;renderView();}
function nbWizardGo(step){const current=Number(NativeBuilderState.wizardStep)||0;const next=Math.max(0,Math.min(5,Number(step)||0));if(next>current+1){openCustomToast('Complete the current step before continuing.');return;}if(next===1&&!['quick','custom','topic','pyq','mock'].includes(NativeBuilderState.mode)){openCustomToast('Choose a test mode first.');return;}if(next===1&&NativeBuilderState.mode==='quick'&&!NativeBuilderState.subjects.size){openCustomToast('Choose at least one subject.');return;}if(next===2&&!NativeBuilderState.subjects.size&&!NativeBuilderState.topics.size){openCustomToast('Choose at least one subject or topic to continue.');return;}if(next===3&&!NativeBuilderState.subjects.size&&!NativeBuilderState.topics.size){openCustomToast('Choose a subject or topic first.');return;}if(next===4&&!NativeBuilderState.questionTypes.size&&NativeBuilderState.mode!=='quick'){openCustomToast('Choose at least one available question Type to include its eligible questions.');return;}NativeBuilderState.wizardStep=next;NativeBuilderState.tab='selection';nbResetPreview();renderView();}
function nbWizardNext(){if(NativeBuilderState.busy)return;if(NativeBuilderState.wizardStep===0&&NativeBuilderState.mode==='quick'){NativeBuilderState.wizardStep=1;NativeBuilderState.tab='selection';nbResetPreview();renderView();return;}if(NativeBuilderState.wizardStep===1&&!NativeBuilderState.subjects.size){openCustomToast('Choose at least one subject.');return;}if(NativeBuilderState.wizardStep===4){nbPreparePreview();if(NativeBuilderState.tab!=='preview')return;NativeBuilderState.wizardStep=5;renderView();return;}if(NativeBuilderState.wizardStep===5){return;}nbWizardGo(NativeBuilderState.wizardStep+1);}
function nbWizardBack(){if(NativeBuilderState.busy)return;if(NativeBuilderState.wizardStep===0){if(Array.isArray(AppRouteStack)&&AppRouteStack.length)appNavigateBack();else navigate('digital_library');return;}if(NativeBuilderState.wizardStep===5){NativeBuilderState.wizardStep=4;NativeBuilderState.tab='selection';renderView();return;}if(NativeBuilderState.mode==='quick'&&NativeBuilderState.wizardStep===1){NativeBuilderState.wizardStep=0;NativeBuilderState.tab='selection';nbResetPreview();renderView();return;}nbWizardGo(NativeBuilderState.wizardStep-1);}
function nbSearch(value){
  const previous=document.getElementById('nbSearch');
  const start=previous&&typeof previous.selectionStart==='number'?previous.selectionStart:String(value||'').length;
  const end=previous&&typeof previous.selectionEnd==='number'?previous.selectionEnd:String(value||'').length;
  NativeBuilderState.search=String(value||'');nbResetPreview();renderView();
  const next=document.getElementById('nbSearch');
  if(next){try{next.focus({preventScroll:true});const len=next.value.length;next.setSelectionRange(Math.min(start,len),Math.min(end,len));}catch(_){}}
}
function nbToggleSubject(subject,checked){if(checked)NativeBuilderState.subjects.add(subject);else NativeBuilderState.subjects.delete(subject);NativeBuilderState.topics.clear();NativeBuilderState.questionTypes.clear();NativeBuilderState.selectedIds.clear();NativeBuilderState.error='';nbResetPreview();nbClampRequestedCountToPool();renderView();}
function nbToggleTopic(key,checked){if(checked)NativeBuilderState.topics.add(key);else NativeBuilderState.topics.delete(key);NativeBuilderState.questionTypes.clear();NativeBuilderState.selectedIds.clear();NativeBuilderState.error='';nbResetPreview();nbClampRequestedCountToPool();renderView();}
function nbToggleQuestion(id,checked){if(checked)NativeBuilderState.selectedIds.add(String(id));else NativeBuilderState.selectedIds.delete(String(id));NativeBuilderState.error='';nbResetPreview();renderView();}
function nbBulkQuestions(action){const visible=nbFilteredRows().slice(0,100).map(r=>r.id);if(action==='all')visible.forEach(id=>NativeBuilderState.selectedIds.add(id));else if(action==='clear')visible.forEach(id=>NativeBuilderState.selectedIds.delete(id));else visible.forEach(id=>NativeBuilderState.selectedIds.has(id)?NativeBuilderState.selectedIds.delete(id):NativeBuilderState.selectedIds.add(id));NativeBuilderState.error='';nbResetPreview();renderView();}
function nbBulkSubjects(action){let rows=nbSourceRows();if(NativeBuilderState.examId)rows=rows.filter(r=>r.examId===NativeBuilderState.examId);if(NativeBuilderState.year)rows=rows.filter(r=>r.year===NativeBuilderState.year);if(NativeBuilderState.difficulty)rows=rows.filter(r=>r.difficulty===NativeBuilderState.difficulty);if(NativeBuilderState.search){const term=NativeBuilderState.search.toLowerCase();rows=rows.filter(r=>[r.subject,r.chapter,r.topic,r.q.QUESTION_EN,r.q.QUESTION_HI,r.id].some(v=>String(v||'').toLowerCase().includes(term)));}const visible=[...new Set(rows.map(r=>r.subject))];if(action==='all')visible.forEach(x=>NativeBuilderState.subjects.add(x));else if(action==='clear'){NativeBuilderState.subjects.clear();NativeBuilderState.topics.clear();NativeBuilderState.selectedIds.clear();}else visible.forEach(x=>NativeBuilderState.subjects.has(x)?NativeBuilderState.subjects.delete(x):NativeBuilderState.subjects.add(x));NativeBuilderState.questionTypes.clear();NativeBuilderState.error='';nbResetPreview();nbClampRequestedCountToPool();renderView();}
function nbBulkTopics(action){const all=nbVisibleTopics().map(t=>t.key);if(action==='all')all.forEach(x=>NativeBuilderState.topics.add(x));else if(action==='clear')NativeBuilderState.topics.clear();else all.forEach(x=>NativeBuilderState.topics.has(x)?NativeBuilderState.topics.delete(x):NativeBuilderState.topics.add(x));NativeBuilderState.questionTypes.clear();NativeBuilderState.selectedIds.clear();NativeBuilderState.error='';nbResetPreview();nbClampRequestedCountToPool();renderView();}
function nbSettingsChanged(key,value){
  const before={exam:NativeBuilderState.examId,year:NativeBuilderState.year,difficulty:NativeBuilderState.difficulty};
  if(key==='count') NativeBuilderState.requestedCount=Math.max(1,Math.min(500,Number(value)||1));
  if(key==='duration') NativeBuilderState.durationMinutes=Math.max(1,Math.min(300,Number(value)||1));
  if(key==='lang') NativeBuilderState.langMode=value;
  if(key==='exam') { NativeBuilderState.examId=String(value||''); if(NativeBuilderState.year&&!nbSourceRows().some(r=>r.examId===NativeBuilderState.examId&&r.year===NativeBuilderState.year)) NativeBuilderState.year=''; }
  if(key==='year') NativeBuilderState.year=String(value||'');
  if(key==='difficulty') NativeBuilderState.difficulty=String(value||'');
  const changedContext=['exam','year','difficulty'].includes(key)&&(before.exam!==NativeBuilderState.examId||before.year!==NativeBuilderState.year||before.difficulty!==NativeBuilderState.difficulty);
  if(changedContext){
    NativeBuilderState.subjects.clear();NativeBuilderState.topics.clear();NativeBuilderState.questionTypes.clear();NativeBuilderState.selectedIds.clear();
    if(NativeBuilderState.mode==='quick'){
      const eligible=nbSourceRows().filter(r=>(!NativeBuilderState.examId||r.examId===NativeBuilderState.examId)&&(!NativeBuilderState.year||r.year===NativeBuilderState.year)&&(!NativeBuilderState.difficulty||r.difficulty===NativeBuilderState.difficulty));
      [...new Set(eligible.map(r=>r.subject))].forEach(x=>NativeBuilderState.subjects.add(x));
      if(eligible.length)NativeBuilderState.requestedCount=Math.min(20,eligible.length);
    }
  }
  NativeBuilderState.error='';nbResetPreview();nbClampRequestedCountToPool();renderView();
}

function nbStableShuffle(rows){const a=rows.slice();let seed=2166136261;for(const r of a){for(const c of r.id)seed=Math.imul(seed^c.charCodeAt(0),16777619)>>>0;}for(let i=a.length-1;i>0;i--){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const j=seed%(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
function nbQuickTest(){
  const all=nbSourceRows();
  if(!all.length){NativeBuilderState.error='NO_INDEXED_QUESTIONS';openCustomToast('No valid questions are available in the current workspace. Import and validate questions first.');renderView();return;}
  const prefExam=String(UserState?.selectedExam||'');const prefYear=String(UserState?.selectedYear||'');
  const preferred=all.find(r=>r.examId===prefExam&&r.year===prefYear)||all.find(r=>r.examId===prefExam)||all[0];
  if(!preferred.examId||!preferred.year||!UniversalExamRegistry.registry.get(preferred.examId)){NativeBuilderState.error='EXAM_CONTEXT_UNAVAILABLE';openCustomToast('Quick Test needs a valid exam and year from indexed questions. Choose Custom Test to inspect available content.');renderView();return;}
  NativeBuilderState.mode='quick';NativeBuilderState.search='';NativeBuilderState.examId=preferred.examId;NativeBuilderState.year=preferred.year;NativeBuilderState.difficulty='';NativeBuilderState.subjects.clear();NativeBuilderState.topics.clear();NativeBuilderState.questionTypes.clear();NativeBuilderState.selectedIds.clear();
  const inContext=all.filter(r=>r.examId===preferred.examId&&r.year===preferred.year);NativeBuilderState.subjects.clear();
  NativeBuilderState.requestedCount=Math.min(20,inContext.length);NativeBuilderState.shuffleQuestions=true;NativeBuilderState.error='';NativeBuilderState.tab='selection';NativeBuilderState.wizardStep=0;nbResetPreview();renderView();
}
function nbPracticeByTopic(){NativeBuilderState.mode='topic';NativeBuilderState.subjects.clear();NativeBuilderState.topics.clear();NativeBuilderState.questionTypes.clear();NativeBuilderState.selectedIds.clear();NativeBuilderState.search='';NativeBuilderState.error='';NativeBuilderState.tab='selection';NativeBuilderState.wizardStep=0;nbResetPreview();renderView();}
function nbCustomTest(){NativeBuilderState.mode='custom';NativeBuilderState.subjects.clear();NativeBuilderState.topics.clear();NativeBuilderState.questionTypes.clear();NativeBuilderState.selectedIds.clear();NativeBuilderState.search='';NativeBuilderState.error='';NativeBuilderState.tab='selection';NativeBuilderState.wizardStep=0;nbResetPreview();renderView();}
function nbPreparePreview(){
  // V2.1.9 safety gate: no host-owned, verified exam-pattern contract was found in this baseline.
  // Do not represent a generic question selection as a Full Mock until that contract is established.
  if(NativeBuilderState.mode==='mock'){
    NativeBuilderState.error='VERIFIED_EXAM_PATTERN_UNAVAILABLE';nbResetPreview();
    openCustomToast('Full Mock is unavailable: this exam has no verified host exam-pattern configuration. Choose Custom Test instead.');
    renderView();return;
  }
  const pool=nbFilteredRows();const exact=false;
  const scopeRows=pool;
  const requested=NativeBuilderState.mode==='quick'?Math.min(Number(NativeBuilderState.requestedCount)||1,scopeRows.length):Number(NativeBuilderState.requestedCount);
  if(NativeBuilderState.mode!=='quick'&&!NativeBuilderState.subjects.size&&!NativeBuilderState.topics.size&&!NativeBuilderState.questionTypes.size){NativeBuilderState.error='SELECT_SCOPE';nbResetPreview();openCustomToast('Choose a subject/topic and one metadata Type.');renderView();return;}
  if(!scopeRows.length){NativeBuilderState.error='NO_RESULTS';nbResetPreview();renderView();return;}
  if(requested>scopeRows.length){NativeBuilderState.error='SHORTAGE';nbResetPreview();openCustomToast(`Only ${scopeRows.length} eligible question(s) are available; reduce the requested count or change filters.`);renderView();return;}
  let chosenRows;
  {
    const contexts=new Set(scopeRows.map(r=>r.examId+'\u241f'+r.year));
    if(contexts.size!==1||!scopeRows[0].examId||!scopeRows[0].year||!UniversalExamRegistry.registry.get(scopeRows[0].examId)){
      NativeBuilderState.error='CHOOSE_EXAM_CONTEXT';nbResetPreview();openCustomToast('Choose one exam and year before previewing.');renderView();return;
    }
    const ordered=NativeBuilderState.shuffleQuestions?nbStableShuffle(scopeRows):scopeRows.slice().sort((a,b)=>a.id.localeCompare(b.id));
    chosenRows=ordered.slice(0,requested);
  }
  const chosenContexts=new Set(chosenRows.map(r=>r.examId+'\u241f'+r.year));
  if(chosenContexts.size!==1||!chosenRows[0]?.examId||!chosenRows[0]?.year||!UniversalExamRegistry.registry.get(chosenRows[0].examId)){
    NativeBuilderState.error='CHOOSE_EXAM_CONTEXT';nbResetPreview();openCustomToast('Selected questions must share one valid exam and year.');renderView();return;
  }
  NativeBuilderState.previewIds=chosenRows.map(r=>r.id);NativeBuilderState.previewFingerprint=NativeBuilderState.previewIds.join('|');NativeBuilderState.error='';NativeBuilderState.tab='preview';renderView();
}

function nbStartTest(){
  // Defense in depth: block direct/replayed launch calls that bypass preview validation.
  if(NativeBuilderState.mode==='mock'){
    NativeBuilderState.error='VERIFIED_EXAM_PATTERN_UNAVAILABLE';nbResetPreview();
    openCustomToast('Full Mock is unavailable: this exam has no verified host exam-pattern configuration. Choose Custom Test instead.');renderView();return;
  }
  if(NativeBuilderStartLock||NativeBuilderState.busy){openCustomToast('Test start is already in progress.');return;}
  if(ActiveTestSession?.sessionStatus==='ACTIVE'){openCustomToast('An assessment is already active. Submit or exit it before starting another.');return;}
  NativeBuilderStartLock=true;NativeBuilderState.busy=true;
  try{
    const all=nbSourceRows();if(NativeBuilderState.mode==='pyq'&&!all.some(nbSafePYQ))throw new Error('PYQ_SOURCE_CONTEXT_MISMATCH');
    const eligible=nbFilteredRows();
    const ids=NativeBuilderState.previewIds.slice();const expected=NativeBuilderState.mode==='quick'?Math.min(Number(NativeBuilderState.requestedCount)||1,eligible.length):Number(NativeBuilderState.requestedCount);
    if(!ids.length||ids.length!==expected)throw new Error('PREVIEW_REQUIRED');
    if(new Set(ids).size!==ids.length)throw new Error('DUPLICATE_IDS');
    if(ids.join('|')!==NativeBuilderState.previewFingerprint)throw new Error('SEQUENCE_MISMATCH');
    const byId=new Map(eligible.map(r=>[r.id,r]));if(ids.some(id=>!byId.has(id)))throw new Error('STALE_SELECTION');
    const rows=ids.map(id=>byId.get(id));const first=rows[0];
    if(rows.some(r=>r.workspaceId!==first.workspaceId||r.workspaceType!==first.workspaceType||r.examId!==first.examId||r.year!==first.year))throw new Error('MIXED_EXAM_CONTEXT');
    if(!first.examId||!first.year||!UniversalExamRegistry.registry.get(first.examId))throw new Error('EXAM_CONTEXT_UNAVAILABLE');
    const sessionSpec={version:1,questionIds:ids,durationMinutes:Number(NativeBuilderState.durationMinutes),langMode:NativeBuilderState.langMode,shuffleQuestions:!!NativeBuilderState.shuffleQuestions,fingerprint:ids.join('|')};
    const before=ActiveTestSession;initTestSession(first.mod.moduleId,first.group.groupId,0,null,{sessionSpec});
    if(!ActiveTestSession||ActiveTestSession===before||ActiveTestSession.sessionStatus!=='ACTIVE'||ActiveTestSession.sessionContractVersion!==1||ActiveTestSession.questionIds.join('|')!==ids.join('|')||ActiveTestSession.moduleId!==first.mod.moduleId||ActiveTestSession.groupId!==first.group.groupId){ActiveTestSession=before;throw new Error('HOST_START_REJECTED');}
    NativeBuilderState.busy=false;NativeBuilderStartLock=false;
  }catch(e){NativeBuilderState.busy=false;NativeBuilderStartLock=false;NativeBuilderState.error=e.message||'START_FAILED';openCustomToast('Test not started: '+NativeBuilderState.error);renderView();}
}

function nbApplyShellForRoute(page){
  document.body.classList.toggle('sj-home-active', page==='home' && WorkspaceManager.current().type!=='BOARD');
  const builderActive=page==='native_builder';
  const cbtActive=page==='test';
  const studyModeActive=page==='learn'||page==='practice';
  const hardImmersive=builderActive||cbtActive;
  const hideGlobalShell=hardImmersive||studyModeActive;
  document.body.classList.toggle('native-builder-active',builderActive);
  document.body.classList.toggle('cbt-active',cbtActive);
  document.body.classList.toggle('study-mode-active',studyModeActive);
  const header=document.getElementById('appHeader'),bottom=document.getElementById('bottomNav'),main=document.getElementById('mainView');
  if(header)header.style.display=hideGlobalShell?'none':'flex';
  if(bottom)bottom.style.display=hideGlobalShell?'none':'flex';
  if(main){
    main.style.top=hardImmersive?'0':studyModeActive?'var(--safe-top)':'calc(56px + var(--safe-top))';
    main.style.bottom=hardImmersive?'0':studyModeActive?'0':'calc(62px + var(--safe-bottom))';
    main.style.maxWidth=hardImmersive||studyModeActive?'none':'960px';
    main.style.padding=hardImmersive?'calc(var(--safe-top) + 12px) 14px calc(var(--safe-bottom) + 14px)':studyModeActive?'calc(var(--safe-top) + 8px) 12px calc(var(--safe-bottom) + 12px)':'14px 14px calc(22px + var(--safe-bottom))';
    main.style.overflow=hardImmersive?'hidden':'auto';
  }
  document.body.style.overflow=hardImmersive?'hidden':'auto';
}
function nbHasVerifiedMockPattern(examId){
  const profile=UniversalExamRegistry?.registry?.get(String(examId||''));
  const contract=profile?.verifiedExamPatternContract;
  return !!(contract&&contract.version===1&&contract.verified===true&&Array.isArray(contract.sections)&&contract.sections.length>0&&contract.sections.every(x=>x&&String(x.name||'').trim()&&Number(x.questionCount)>0));
}
