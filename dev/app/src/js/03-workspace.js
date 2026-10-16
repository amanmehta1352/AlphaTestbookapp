/* =========================================================================
 PHASE 3 — PROFILE-DRIVEN WORKSPACE / DATA AIRLOCK
 Additive only. Phase 1A storage and Phase 2 QuestionUI are frozen.
 ========================================================================= */
const PHASE4_BOARD_ENABLED=true;
const WorkspaceManager=(()=>{const DEFAULT={id:'ws-comp-legacy',type:'COMPETITIVE',name:'Competitive — Legacy'},BOARD={id:'ws-board-cbse-10',type:'BOARD',name:'CBSE Class 10'},COMP={id:'ws-comp-ssc',type:'COMPETITIVE',name:'Competitive — SSC / RRB'};let active=DEFAULT;const valid=new Set(['COMPETITIVE','BOARD']);function norm(w){return !w||!w.id||!valid.has(w.type)?DEFAULT:{id:String(w.id),type:w.type,name:String(w.name||w.id)}}function current(){return active}function set(w,persist=true){const next=norm(w);if(next.type==='BOARD'&&!PHASE4_BOARD_ENABLED)return DEFAULT;active=next;if(typeof UserState!=='undefined'&&UserState){UserState.activeWorkspace={...active};if(persist&&typeof saveUserState==='function')saveUserState()}if(typeof Route!=='undefined'&&Route)Route={page:'home',params:{}};return active}function hydrate(){if(typeof UserState!=='undefined'&&UserState?.activeWorkspace)set(UserState.activeWorkspace,false);else if(typeof UserState!=='undefined'&&UserState)UserState.activeWorkspace={...active}}function stampQ(q,w){w=norm(w||active);q.workspaceId=q.workspaceId||w.id;q.workspaceType=q.workspaceType||w.type;q.metadata=q.metadata||{};q.metadata.workspaceId=q.metadata.workspaceId||q.workspaceId;q.metadata.workspaceType=q.metadata.workspaceType||q.workspaceType;if(w.type==='BOARD')BoardCurriculumRegistry.associateQuestion(q,w);return q}function stampM(m,w){w=norm(w||active);m.workspaceId=m.workspaceId||w.id;m.workspaceType=m.workspaceType||w.type;if(w.type==='BOARD'){m.curriculumId=m.curriculumId||BoardCurriculumRegistry.PROFILE.curriculumId;m.boardId=m.boardId||BoardCurriculumRegistry.PROFILE.boardId;m.classId=m.classId||BoardCurriculumRegistry.PROFILE.classId;if(m.streamId===undefined)m.streamId=null}(m.groups||[]).forEach(g=>{g.workspaceId=g.workspaceId||m.workspaceId;g.workspaceType=g.workspaceType||m.workspaceType;(g.questions||[]).forEach(q=>stampQ(q,w))});return m}function migrate(ms){let changed=false;(ms||[]).forEach(m=>{if(!m.workspaceId){stampM(m,DEFAULT);changed=true}else{const b=JSON.stringify([m.workspaceId,m.workspaceType,m.curriculumId,m.boardId,m.classId,m.streamId]);stampM(m,{id:m.workspaceId,type:m.workspaceType||DEFAULT.type,name:m.workspaceId});if(b!==JSON.stringify([m.workspaceId,m.workspaceType,m.curriculumId,m.boardId,m.classId,m.streamId]))changed=true}});return{changed,modules:ms}}function matches(x){return String(x?.workspaceId||x?.metadata?.workspaceId||'')===active.id}function filterModules(ms){return(ms||[]).filter(matches)}function filterQuestions(qs){return(qs||[]).filter(matches)}function requireActive(){if(!active?.id)throw new Error('Workspace selection required before this operation.');return active}function withTransient(w,fn){const previous=active;const next=norm(w);active=next;try{return fn()}finally{active=previous}}function list(){return PHASE4_BOARD_ENABLED?[COMP,BOARD,DEFAULT]:[COMP,DEFAULT]}function switchTo(id){const w=list().find(x=>x.id===id);if(!w)throw new Error('Unknown or disabled workspace.');return set(w,true)}return{DEFAULT,BOARD,COMP,current,set,hydrate,stampQ,stampM,migrate,matches,filterModules,filterQuestions,requireActive,withTransient,list,switchTo}})();
const BoardCurriculumRegistry=(()=>{const PROFILE={curriculumId:'curriculum-cbse-class-10',boardId:'cbse',classId:'class-10',streamId:null};const nodes={subjects:new Map(),chapters:new Map(),topics:new Map(),outcomes:new Map()};const id=(p,...a)=>`${p}-${a.map(x=>slugify(x||'general')).filter(Boolean).join('-')}`;function reset(){Object.values(nodes).forEach(m=>m.clear())}function associateQuestion(q,w=PROFILE){if(!q||w.type==='COMPETITIVE')return;const m=q.metadata||{};m.workspaceId=q.workspaceId||'ws-board-cbse-10';m.workspaceType='BOARD';m.curriculumId=m.curriculumId||PROFILE.curriculumId;m.boardId=m.boardId||PROFILE.boardId;m.classId=m.classId||PROFILE.classId;if(m.streamId===undefined)m.streamId=PROFILE.streamId;m.subjectId=m.subjectId||id('sub',m.subject||'general');m.chapterId=m.chapterId||id('chap',m.subject||'general',m.chapter||'general');m.topicId=m.topicId||id('topic',m.subject||'general',m.chapter||'general',m.topic||'general');q.metadata=m}function sync(ms){reset();for(const m of ms||[]){if(m.workspaceId!=='ws-board-cbse-10')continue;const sub=m.subject||'General',ch=m.chapter||m.topicTitle||'General Chapter',top=m.topic||m.topicTitle||ch;const sid=m.subjectId||id('sub',sub),cid=m.chapterId||id('chap',sub,ch),tid=m.topicId||id('topic',sub,ch,top);nodes.subjects.set(sid,{id:sid,label:m.subjectTitle||sub});nodes.chapters.set(cid,{id:cid,label:ch,subjectId:sid});nodes.topics.set(tid,{id:tid,label:m.topicTitle||top,chapterId:cid,subjectId:sid});for(const g of m.groups||[])for(const q of g.questions||[]){associateQuestion(q,{type:'BOARD'});const lo=q.metadata?.learningOutcomeId;if(lo)nodes.outcomes.set(String(lo),{id:String(lo),label:q.metadata.learningOutcome||String(lo),topicId:tid})}}}function subjects(){return[...nodes.subjects.values()]}function chapters(s){return[...nodes.chapters.values()].filter(x=>x.subjectId===s)}function topics(c){return[...nodes.topics.values()].filter(x=>x.chapterId===c)}function outcomes(t){return[...nodes.outcomes.values()].filter(x=>x.topicId===t)}function questions(f={}){const out=[];for(const m of WorkspaceManager.filterModules(AppModules||[]))for(const g of m.groups||[])for(const q of g.questions||[]){const md=q.metadata||{};if(f.subjectId&&md.subjectId!==f.subjectId)continue;if(f.chapterId&&md.chapterId!==f.chapterId)continue;if(f.topicId&&md.topicId!==f.topicId)continue;if(f.learningOutcomeId&&md.learningOutcomeId!==f.learningOutcomeId)continue;out.push(q)}return out}return{PROFILE,nodes,reset,associateQuestion,sync,subjects,chapters,topics,outcomes,questions}})();
function openWorkspaceSwitcher(){const w=WorkspaceManager.current();openModal('🧭 Workspace Switcher',`<div style="font-size:13px;font-weight:800;margin-bottom:12px;">Current: ${escapeHtml(w.name)}</div><div class="grid-cards">${WorkspaceManager.list().map(x=>`<button class="card-btn" onclick="switchWorkspace('${x.id}')"><strong>${x.type==='BOARD'?'🎓':'🏆'} ${escapeHtml(x.name)}</strong><small>${x.id===w.id?'✓ Active':'Switch workspace'}</small></button>`).join('')}</div>`)}
function switchWorkspace(id){try{if(typeof ActiveTestSession!=='undefined'&&ActiveTestSession?.sessionStatus==='ACTIVE'){openCustomToast('🔒 CBT ACTIVE — Workspace switching is locked.');return;}WorkspaceManager.switchTo(id);closeModal();if(typeof PracticeAnswerState!=='undefined')Object.keys(PracticeAnswerState).forEach(k=>delete PracticeAnswerState[k]);if(typeof PracticeSubjectiveState!=='undefined')Object.keys(PracticeSubjectiveState).forEach(k=>delete PracticeSubjectiveState[k]);navigate('home',{})}catch(e){openCustomToast('Workspace switch failed: '+e.message)}}
function boardEnabledGuard(){return PHASE4_BOARD_ENABLED&&WorkspaceManager.current().type==='BOARD'}
function boardCrumbs(items){return `<div class="board-breadcrumb"><button onclick="navigate('home')">🏠 Board Home</button>${items.map(x=>`<span>›</span>${x.action?`<button onclick="${x.action}">${escapeHtml(x.label)}</button>`:`<span>${escapeHtml(x.label)}</span>`}`).join('')}</div>`}
function renderBoardDashboard(v){if(!boardEnabledGuard())return navigate('home');BoardCurriculumRegistry.sync(AppModules);const ss=BoardCurriculumRegistry.subjects();const ms=WorkspaceManager.filterModules(AppModules);const count=ms.reduce((n,m)=>n+(m.groups||[]).reduce((a,g)=>a+(g.questions||[]).length,0),0);v.innerHTML=`<div class="board-shell">${boardCrumbs([])}<div class="student-hero-card"><span class="journey-pill">🎓 BOARD / SCHOOL WORKSPACE</span><h1>CBSE Class 10 Campus</h1><p>Curriculum-driven learning • ${ss.length} Subjects • ${count} Questions</p></div><div class="section-title"><span>📚 Curriculum</span></div><div class="grid-cards">${ss.length?ss.map(x=>`<button class="card-btn board-node-card" onclick="navigate('board_chapters',{subjectId:'${x.id}'})"><strong>📘 ${escapeHtml(x.label)}</strong><span class="node-meta">${BoardCurriculumRegistry.chapters(x.id).length} Chapters</span></button>`).join(''):'<div class="card-btn"><strong>Board curriculum registry ready</strong><small>No Board curriculum/questions imported yet.</small></div>'}</div><div class="grid-cards"><button class="card-btn" onclick="navigate('board_subjects',{})"><strong>📖 Subjects</strong><small>Browse curriculum</small></button><button class="card-btn" onclick="navigate('board_subjects',{})"><strong>🔁 Curriculum Revision</strong><small>Choose a Board topic first; no global Competitive state is exposed.</small></button></div></div>`}
function renderBoardSubjects(v){if(!boardEnabledGuard())return navigate('home');BoardCurriculumRegistry.sync(AppModules);const ss=BoardCurriculumRegistry.subjects();v.innerHTML=`<div class="board-shell">${boardCrumbs([])}<div class="section-title"><span>📚 BOARD SUBJECTS</span><button class="btn-action-sm" onclick="navigate('home')">← Board Home</button></div><div class="grid-cards">${ss.length?ss.map(x=>`<button class="card-btn board-node-card" onclick="navigate('board_chapters',{subjectId:'${x.id}'})"><strong>${escapeHtml(x.label)}</strong><span class="node-meta">${BoardCurriculumRegistry.chapters(x.id).length} Chapters</span></button>`).join(''):'<div class="card-btn"><strong>No subjects mapped</strong><small>Import Board content first.</small></div>'}</div></div>`}
function renderBoardChapters(v,sid){if(!boardEnabledGuard())return navigate('home');BoardCurriculumRegistry.sync(AppModules);const s=BoardCurriculumRegistry.subjects().find(x=>x.id===sid);if(!s)return navigate('board_subjects',{});const cs=BoardCurriculumRegistry.chapters(sid);v.innerHTML=`<div class="board-shell">${boardCrumbs([{label:s.label}])}<div class="section-title"><span>📕 ${escapeHtml(s.label)} — CHAPTERS</span><button class="btn-action-sm" onclick="navigate('board_subjects',{})">← Subjects</button></div><div class="grid-cards">${cs.length?cs.map(c=>`<button class="card-btn board-node-card" onclick="navigate('board_topics',{chapterId:'${c.id}',subjectId:'${sid}'})"><strong>${escapeHtml(c.label)}</strong><span class="node-meta">${BoardCurriculumRegistry.topics(c.id).length} Topics</span></button>`).join(''):'<div class="card-btn"><strong>No chapters mapped</strong></div>'}</div></div>`}
function renderBoardTopics(v,cid,sid){if(!boardEnabledGuard())return navigate('home');BoardCurriculumRegistry.sync(AppModules);const s=BoardCurriculumRegistry.subjects().find(x=>x.id===sid),c=BoardCurriculumRegistry.chapters(sid).find(x=>x.id===cid);if(!s||!c)return navigate('board_subjects',{});const ts=BoardCurriculumRegistry.topics(cid);v.innerHTML=`<div class="board-shell">${boardCrumbs([{label:s.label,action:`navigate('board_chapters',{subjectId:'${sid}'})`},{label:c.label}])}<div class="section-title"><span>📗 ${escapeHtml(c.label)} — TOPICS</span></div><div class="grid-cards">${ts.length?ts.map(t=>`<button class="card-btn board-node-card" onclick="navigate('board_topic',{topicId:'${t.id}',chapterId:'${cid}',subjectId:'${sid}'})"><strong>${escapeHtml(t.label)}</strong><span class="node-meta">${BoardCurriculumRegistry.questions({topicId:t.id}).length} Questions • ${BoardCurriculumRegistry.outcomes(t.id).length} Learning Outcomes</span></button>`).join(''):'<div class="card-btn"><strong>No topics mapped</strong></div>'}</div></div>`}
function renderBoardTopic(v,tid,cid,sid){if(!boardEnabledGuard())return navigate('home');BoardCurriculumRegistry.sync(AppModules);const s=BoardCurriculumRegistry.subjects().find(x=>x.id===sid),c=BoardCurriculumRegistry.chapters(sid).find(x=>x.id===cid),t=BoardCurriculumRegistry.topics(cid).find(x=>x.id===tid);if(!s||!c||!t)return navigate('board_subjects',{});const qs=BoardCurriculumRegistry.questions({topicId:tid}),los=BoardCurriculumRegistry.outcomes(tid);v.innerHTML=`<div class="board-shell">${boardCrumbs([{label:s.label,action:`navigate('board_chapters',{subjectId:'${sid}'})`},{label:c.label,action:`navigate('board_topics',{chapterId:'${cid}',subjectId:'${sid}'})`},{label:t.label}])}<div class="section-title"><span>📚 ${escapeHtml(t.label)}</span></div><div class="grid-cards"><div class="card-btn board-lo-card"><strong>🎯 Learning Outcomes</strong><small>${los.length?los.map(x=>escapeHtml(x.label)).join(' • '):'No Learning Outcome IDs mapped yet.'}</small></div><div class="card-btn"><strong>📝 Questions</strong><small>${qs.length} Board questions mapped.</small>${qs.length?`<button class="btn-nav primary" style="margin-top:10px;width:100%;" onclick="startSinglePractice('${qs[0].canonicalQId}')">Start Practice →</button>`:''}</div></div></div>`}

function getWorkspaceModule(moduleId){
  if (typeof CurriculumContext !== 'undefined' && CurriculumContext.isActive()) {
    return CurriculumContext.module(moduleId);
  }
  return (AppModules||[]).find(m => WorkspaceManager.matches(m) && String(m.moduleId) === String(moduleId)) || null;
}
function enforceWorkspaceRoute(page, params){
  if (String(page||'').startsWith('board_') && !boardEnabledGuard()) { Route={page:'home',params:{}}; return false; }
  if (!params || !params.moduleId) return true;
  const m = getWorkspaceModule(params.moduleId);
  if (!m) { openCustomToast('This content belongs to another workspace or is unavailable.'); Route={page:'home',params:{}}; return false; }
  return true;
}


// 1.5 INDEX ENGINE: Multi-Faceted Inverted Indexes
const IndexEngine = {
  registry: new Map(),
  
  indexes: {
    bySubject: {},
    byChapter: {},
    byTopic: {},
    bySubtopic: {},
    byType: {},
    byDifficulty: {},
    byLength: {},
    byExam: {},
    byExamId: {},
    byYear: {},
    byTag: {}
  },
  
  clear() {
    this.registry.clear();
    for (const key in this.indexes) {
      this.indexes[key] = {};
    }
  },
  
  register(question) {
    const qId = question.canonicalQId || `Q-${question.originalQNo}`;
    this.registry.set(qId, question);
    
    const m = question.metadata;
    if (!m) return;
    
    const addTo = (bucket, key) => {
      if (!key) return;
      const sKey = slugify(key);
      if (!bucket[sKey]) bucket[sKey] = new Set();
      bucket[sKey].add(qId);
    };
    
    addTo(this.indexes.bySubject, m.subject);
    addTo(this.indexes.byChapter, m.chapter);
    addTo(this.indexes.byTopic, m.topic);
    addTo(this.indexes.bySubtopic, m.subtopic);
    addTo(this.indexes.byType, m.theoryOrNumerical);
    addTo(this.indexes.byDifficulty, m.difficulty);
    addTo(this.indexes.byLength, m.questionLength);
    addTo(this.indexes.byExam, m.exam);
    addTo(this.indexes.byExamId, m.examId);
    addTo(this.indexes.byYear, m.year);
    
    (m.tags || []).forEach(tag => addTo(this.indexes.byTag, tag));
  },
  
  query(criteria = {}) {
    let resultSet = null;
    
    const intersect = (bucket, val) => {
      if (!val) return;
      const sKey = slugify(val);
      const set = bucket[sKey] || new Set();
      if (resultSet === null) {
        resultSet = new Set(set);
      } else {
        const next = new Set();
        for (const id of resultSet) {
          if (set.has(id)) next.add(id);
        }
        resultSet = next;
      }
    };
    
    if (criteria.subject) intersect(this.indexes.bySubject, criteria.subject);
    if (criteria.chapter) intersect(this.indexes.byChapter, criteria.chapter);
    if (criteria.topic) intersect(this.indexes.byTopic, criteria.topic);
    if (criteria.subtopic) intersect(this.indexes.bySubtopic, criteria.subtopic);
    if (criteria.type) intersect(this.indexes.byType, criteria.type);
    if (criteria.difficulty) intersect(this.indexes.byDifficulty, criteria.difficulty);
    if (criteria.length) intersect(this.indexes.byLength, criteria.length);
    if (criteria.examId) intersect(this.indexes.byExamId, criteria.examId);
    else if (criteria.exam) intersect(this.indexes.byExam, criteria.exam);
    if (criteria.year) intersect(this.indexes.byYear, criteria.year);
    if (criteria.tag) intersect(this.indexes.byTag, criteria.tag);

    const raw = resultSet === null ? Array.from(this.registry.values()) : Array.from(resultSet).map(id => this.registry.get(id)).filter(Boolean);
    let scoped = WorkspaceManager.filterQuestions(raw);

    // DEFECT-01 FIX: generic queries remain workspace-scoped only.
    // Competitive exam/year scope is applied only when explicitly requested.
    const explicitExamId = criteria.examId || '';
    const explicitExam = criteria.exam || '';
    const explicitYear = criteria.examYear || criteria.year || '';
    if (explicitExamId) scoped = scoped.filter(q => q.metadata?.examId === explicitExamId);
    else if (explicitExam) scoped = scoped.filter(q => q.metadata?.exam === explicitExam);
    if (explicitYear) scoped = scoped.filter(q => String(q.metadata?.year || '') === String(explicitYear));

    return scoped;
  }
};

// 1.6 TAXONOMY ENGINE
const TaxonomyEngine = {
  tree: {},
  buildTree(context = {}) {
    const tree = {};
    const explicitExamId = context.examId || '';
    const explicitExam = context.exam || '';
    const explicitYear = context.examYear || context.year || '';
    for (const [, q] of IndexEngine.registry) {
      if (!WorkspaceManager.matches(q)) continue;
      // DEFECT-01 FIX: taxonomy is workspace-scoped by default;
      // exam/year scope exists only for an explicit Competitive operation.
      if (explicitExamId && q.metadata?.examId !== explicitExamId) continue;
      if (!explicitExamId && explicitExam && q.metadata?.exam !== explicitExam) continue;
      if (explicitYear && String(q.metadata?.year || '') !== String(explicitYear)) continue;
      const m = q.metadata;
      if (!m) continue;
      
      const s = m.subject;
      const c = m.chapter;
      const t = m.topic;
      const sub = m.subtopic || 'General';
      const typ = m.theoryOrNumerical;
      const d = m.difficulty;
      
      if (!tree[s]) tree[s] = { count: 0, chapters: {} };
      tree[s].count++;
      
      if (!tree[s].chapters[c]) tree[s].chapters[c] = { count: 0, topics: {} };
      tree[s].chapters[c].count++;
      
      if (!tree[s].chapters[c].topics[t]) tree[s].chapters[c].topics[t] = { count: 0, subtopics: {} };
      tree[s].chapters[c].topics[t].count++;

      if (!tree[s].chapters[c].topics[t].subtopics[sub]) tree[s].chapters[c].topics[t].subtopics[sub] = { count: 0, types: {} };
      tree[s].chapters[c].topics[t].subtopics[sub].count++;
      
      if (!tree[s].chapters[c].topics[t].subtopics[sub].types[typ]) tree[s].chapters[c].topics[t].subtopics[sub].types[typ] = { count: 0, difficulties: {} };
      tree[s].chapters[c].topics[t].subtopics[sub].types[typ].count++;

      if (!tree[s].chapters[c].topics[t].subtopics[sub].types[typ].difficulties[d]) tree[s].chapters[c].topics[t].subtopics[sub].types[typ].difficulties[d] = 0;
      tree[s].chapters[c].topics[t].subtopics[sub].types[typ].difficulties[d]++;
    }
    this.tree = tree;
    return tree;
  }
};

// 1.7 UNIVERSAL SEARCH ENGINE
const SearchEngine = {
  search(term, context = {}) {
    const qStr = String(term || '').trim().toLowerCase();
    if (!qStr) return [];
    
    const results = [];
    for (const [, q] of IndexEngine.registry) {
      const m = q.metadata || {};
      const haystack = [
        q.originalQNo,
        q.QUESTION_EN,
        q.QUESTION_HI,
        q.examInfo,
        m.examId,
        m.exam,
        m.examBoard,
        m.subject,
        m.chapter,
        m.topic,
        m.subtopic,
        m.concept,
        m.theoryOrNumerical,
        m.difficulty,
        m.questionLength,
        m.year,
        ...(m.tags || []),
        q.canonicalPath,
        q.examPath,
        q.pyqPath
      ].filter(Boolean).join(' ').toLowerCase();
      
      if (haystack.includes(qStr)) {
        results.push(q);
      }
    }
    let scoped = WorkspaceManager.filterQuestions(results);

    // DEFECT-01 FIX: search is workspace-scoped by default.
    // Competitive exam/year scope is applied only from explicit context.
    const explicitExamId = context.examId || '';
    const explicitExam = context.exam || '';
    const explicitYear = context.examYear || context.year || '';
    if (explicitExamId) scoped = scoped.filter(q => q.metadata?.examId === explicitExamId);
    else if (explicitExam) scoped = scoped.filter(q => q.metadata?.exam === explicitExam);
    if (explicitYear) scoped = scoped.filter(q => String(q.metadata?.year || '') === String(explicitYear));

    return scoped;
  }
};

const CurriculumContext = (() => {
  // CAND-02: derive context from the single WorkspaceManager authority.
  // Curriculum context no longer silently switches to the legacy workspace.
  const PAGES = new Set([
    'subjects','subject','chapter','topic','subtopic','taxonomy_explorer',
    'learn','revision','practice','class','pyq','test'
  ]);
  function isActive(params = (typeof Route !== 'undefined' ? Route.params : null)) {
    return !!params?.curriculumContext;
  }
  function scope(fn) {
    if (typeof fn !== 'function') throw new TypeError('CurriculumContext.scope requires a function.');
    return fn();
  }
  function query(criteria = {}) {
    return scope(() => IndexEngine.query(criteria));
  }
  function search(term, context = {}) {
    return scope(() => SearchEngine.search(term, context));
  }
  function filterModules(modules) {
    return scope(() => WorkspaceManager.filterModules(modules || []));
  }
  function module(moduleId) {
    const workspace = WorkspaceManager.current();
    return (AppModules || []).find(m =>
      m.workspaceId === workspace.id && m.workspaceType === workspace.type &&
      String(m.moduleId) === String(moduleId)
    ) || null;
  }
  function isPage(page) {
    return PAGES.has(String(page || ''));
  }
  return { get WORKSPACE() { return WorkspaceManager.current(); }, PAGES, isActive, scope, query, search, filterModules, module, isPage };
})();
