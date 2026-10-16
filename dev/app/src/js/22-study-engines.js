/* =========================================================================
   6. THE 6 CORE STUDY ENGINES
   ========================================================================= */

/* Engine 1: Learn Mode */
function renderLearnEngine(v, moduleId) {
  const mod = getWorkspaceModule(moduleId);
  if (!mod) return navigate('home');

  v.innerHTML = `
    <div class="nav-breadcrumb">
      <button onclick="navigate('home')">Home</button>
      <span class="sep">/</span>
      <button onclick="navigate('topic', {moduleId:'${mod.moduleId}'})">${mod.topicTitle}</button>
      <span class="sep">/</span>
      <span>Learn</span>
    </div>

    <div class="section-title">
      <span>📖 LEARN — ${mod.topicTitle.toUpperCase()}</span>
      <button class="btn-action-sm" onclick="navigate('topic', {moduleId:'${mod.moduleId}'})">← Topic Hub</button>
    </div>

    <div class="card-btn" style="margin-bottom:16px;">
      <span class="journey-pill" style="background:var(--primary-light); color:var(--primary);">Core Chapter Notes</span>
      <h2 style="font-size:18px; font-weight:900; margin:8px 0;">${mod.topicTitle} Theory & Rules</h2>
      <div style="font-size:14px; line-height:1.7; color:var(--text-main); white-space:pre-wrap; font-weight:600;">
${escapeHtml(mod.theoryNotes || "No notes have been added for this topic yet. Use the Concept Check and Practice below.")}
      </div>
    </div>

    <div class="section-title">
      <span>💡 Concept Check</span>
    </div>
    ${learnConceptCheckHtml(mod)}

    <div style="margin-top:20px; display:flex; gap:10px;">
      <button onclick="navigate('practice', {moduleId:'${mod.moduleId}', qIndex:0})" class="btn-nav primary" style="width:100%;">
        Go to Practice Drill ➔
      </button>
    </div>
  `;
}

/* Engine 2: Revision Mode */
let ActiveCardIndex = 0; let CardFlipped = false;
function toggleCardFlip() { CardFlipped = !CardFlipped; renderView(); }
function nextCard(rating) {
  CardFlipped = false; ActiveCardIndex = (ActiveCardIndex + 1);
  const mod = getWorkspaceModule(Route.params.moduleId);
  if (ActiveCardIndex >= (mod?.flashcards?.length || 1)) { ActiveCardIndex = 0; openCustomToast("🎉 All flashcards reviewed!"); }
  renderView();
}

/* Engine 3: Practice Mode */
let PracticeAnswerState = {};
let PracticeShownAt = {};
let PracticeSubjectiveState = {};
let SubjectiveResultStateBuffer = {};
let ActiveHintStep = 0;

/*
 * PHASE 2 — QuestionUI Factory
 * Hard boundary: MCQ uses legacy classes/events; Subjective uses only
 * subjective-* classes and isolated state handlers. Missing/malformed format
 * always routes to MCQ.
 */
function testStateKey(q,context='test'){return context==='test'&&ActiveTestSession?.sessionContractVersion===1?String(q?.canonicalQId||''):String(q?.originalQNo??'');}

const QuestionUI = {
  getFormat(question) {
    const q = question || {};
    const explicit = String(q.metadata?.questionFormat || q.TYPE || '').toUpperCase().trim();
    return explicit === 'SUBJECTIVE' ? 'SUBJECTIVE' : 'MCQ';
  },

  render(question, context = 'practice', state = {}, qIndex = 0, moduleId = '') {
    const q = question || {};
    return this.getFormat(q) === 'SUBJECTIVE'
      ? this.renderSubjective(q, context, state, qIndex, moduleId)
      : this.renderMCQ(q, context, state, qIndex, moduleId);
  },

  renderMCQ(q, context = 'practice', state = {}, qIndex = 0, moduleId = '') {
    if (context === 'practice') {
      const selected = state?.[q.originalQNo];
      const optsHtml = q.options.map(opt => {
        let cls = 'opt-card', optStyle = '';
        if (selected) {
          if (opt.letter === q.answer) { cls += ' selected'; optStyle = 'border-color:var(--success); background:var(--success-bg);'; }
          else if (selected === opt.letter) optStyle = 'border-color:var(--danger); background:var(--danger-bg);';
        }
        return `
      <div class=\"${cls}\" style=\"${optStyle}\" onclick=\"onPracticeSelect('${escapeHtml(opt.letter)}', ${q.originalQNo}, '${moduleId}', ${qIndex})\">
        <div class=\"opt-circle\">${escapeHtml(opt.letter)}</div>
        <div class=\"opt-text\">${escapeHtml(opt.en)} ${opt.hi && opt.hi !== opt.en ? `<span style=\"display:block; font-size:13px; color:var(--text-muted);\">${escapeHtml(opt.hi)}</span>` : ''}</div>
      </div>
    `;
      }).join('');
      return optsHtml;
    }

    const currentAnswer = state?.[testStateKey(q,context)] || '';
    const uniqueOptions = []; const seenLetters = new Set();
    (q.options || []).forEach(opt => {
      const l = String(opt.letter || '').toUpperCase().trim();
      if (['A', 'B', 'C', 'D'].includes(l) && !seenLetters.has(l)) {
        seenLetters.add(l);
        uniqueOptions.push({ letter: l, en: opt.en || '', hi: opt.hi || opt.en || '' });
      }
    });

    return uniqueOptions.map(opt => {
      const isSelected = currentAnswer === opt.letter;
      return `
      <div class="opt-card ${isSelected ? 'selected' : ''}" onclick="selectOption('${escapeHtml(opt.letter)}', ${qIndex})">
        <div class="opt-circle">${escapeHtml(opt.letter)}</div>
        <div class="opt-text"><div class="en-text">${escapeHtml(opt.en || '')}</div>${opt.hi && opt.hi !== opt.en ? `<div class="hi-text">${escapeHtml(opt.hi)}</div>` : `<div class="hi-text option-hi-fallback">${escapeHtml(opt.en || '')}</div>`}</div>
        <div class="opt-radio-circle"></div>
      </div>
    `;
    }).join('');
  },

  renderSubjective(q, context = 'practice', state = {}, qIndex = 0, moduleId = '') {
    const attempted = state?.[testStateKey(q,context)] === 'ATTEMPTED';
    const safeModule = String(moduleId || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const handler = context === 'practice'
      ? `markPracticeSubjectiveAttempted(${q.originalQNo}, '${safeModule}', ${qIndex})`
      : `markTestSubjectiveAttempted(${qIndex})`;
    const modelId = `subjectiveModel_${context}_${q.originalQNo}`;
    const statusText = attempted ? '✓ ATTEMPTED' : 'NOT ATTEMPTED';

    return `
      <div class="subjective-response-area">
        <div class="subjective-box">
          <div class="subjective-box-header">
            <span class="subjective-label">📝 THEORY / SUBJECTIVE</span>
            <span class="subjective-status ${attempted ? 'attempted' : ''}">${statusText}</span>
          </div>
          <div class="subjective-hint">Write your answer in your notebook. The box below is only a temporary scratchpad; it is not stored in the MCQ answer state.</div>
          <textarea class="subjective-scratchpad" spellcheck="false" placeholder="Optional temporary scratchpad..."></textarea>
          <div class="subjective-actions">
            <button class="subjective-attempt-btn ${attempted ? 'attempted' : ''}" onclick="${handler}">${attempted ? '✓ Attempted' : 'Mark as Attempted'}</button>
            <button class="subjective-reveal-btn" onclick="toggleSubjectiveModelAnswer('${modelId}')">👁️ Reveal Model Answer</button>
          </div>
          <div id="${modelId}" class="subjective-model-answer"><strong>📘 Model Answer:</strong><br>${escapeHtml(q.EXPLANATION || 'Model answer is not available.')}</div>
        </div>
      </div>
    `;
  }
};
window.QuestionUI = QuestionUI;

function markPracticeSubjectiveAttempted(qNo, moduleId, qIndex) {
  PracticeSubjectiveState[qNo] = PracticeSubjectiveState[qNo] === 'ATTEMPTED' ? undefined : 'ATTEMPTED';
  if (PracticeSubjectiveState[qNo] === undefined) delete PracticeSubjectiveState[qNo];
  renderView();
}

function markTestSubjectiveAttempted(qIndex) {
  if (!ActiveTestSession) return; const q=ActiveTestSession.questions[qIndex]; if(!q)return; const qNo=nbQuestionKey(q);
  ActiveTestSession.subjectiveState = ActiveTestSession.subjectiveState || {};
  const next = ActiveTestSession.subjectiveState[qNo] === 'ATTEMPTED' ? undefined : 'ATTEMPTED';
  if (next) {
    ActiveTestSession.subjectiveState[qNo] = next;
    SubjectiveResultStateBuffer[qNo] = next;
  } else {
    delete ActiveTestSession.subjectiveState[qNo];
    delete SubjectiveResultStateBuffer[qNo];
  }
  renderView();
}

function toggleSubjectiveModelAnswer(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('open');
}


function renderPracticeEngine(v, moduleId, qIndex, customQuestions = null) {
  const mod = getWorkspaceModule(moduleId) || WorkspaceManager.filterModules(AppModules)[0];
  const sjBase = customQuestions || mod?.groups?.flatMap(g => g.questions) || [];
  if (!sjBase.length) return navigate('home');
  const allQs = customQuestions ? sjBase : practiceFilteredQuestions(mod);
  if (!allQs.length) {
    v.innerHTML = `<div class="nav-breadcrumb"><button onclick="navigate('home')">Home</button><span class="sep">/</span><button onclick="navigate('topic', {moduleId:${nbJsAttr(mod.moduleId)}})">${escapeHtml(mod.topicTitle)}</button><span class="sep">/</span><span>Practice</span></div>${practiceFilterBarHtml(mod)}<div class="sj-empty"><strong>No question matches these filters</strong><span>Change or clear the filters above.</span><button type="button" class="btn-nav" onclick="PracticeFilter={diff:'',type:'',status:''};navigate('practice',{moduleId:${nbJsAttr(mod.moduleId)},qIndex:0})">Clear filters</button></div>`;
    return;
  }

  qIndex = Math.max(0, Math.min(Number(qIndex) || 0, allQs.length - 1));
  const q = allQs[qIndex];
  const m = q.metadata || {};
  const selected = PracticeAnswerState[q.originalQNo];
  if (!selected) { const shownKey = String(moduleId) + '|' + q.originalQNo; if (!PracticeShownAt[shownKey]) PracticeShownAt[shownKey] = Date.now(); }

  const optsHtml = QuestionUI.render(q, 'practice', QuestionUI.getFormat(q) === 'SUBJECTIVE' ? PracticeSubjectiveState : PracticeAnswerState, qIndex, moduleId);

  v.innerHTML = `
    <div class="nav-breadcrumb">
      <button onclick="navigate('home')">Home</button>
      <span class="sep">/</span>
      <button onclick="navigate('topic', {moduleId:'${mod.moduleId}'})">${mod.topicTitle}</button>
      <span class="sep">/</span>
      <span>Practice</span>
    </div>

    <div class="section-title">
      <div>
        <span>✏️ PRACTICE (Q.${q.originalQNo} • ${qIndex + 1}/${allQs.length})</span>
        <div style="display:flex; gap:4px; margin-top:4px; flex-wrap:wrap;">
          <span class="tax-badge exam">${m.exam || 'Universal Exam'}</span>
          <span class="tax-badge ${m.theoryOrNumerical === 'NUMERICAL' ? 'num' : 'theory'}">${m.theoryOrNumerical || 'NUMERICAL'}</span>
          <span class="tax-badge ${m.difficulty === 'EASY' ? 'easy' : (m.difficulty === 'HARD' ? 'hard' : 'moderate')}">${m.difficulty || 'MODERATE'}</span>
        </div>
      </div>
      <button class="btn-action-sm" onclick="navigate('topic', {moduleId:'${mod.moduleId}'})">← Topic Hub</button>
    </div>
    ${customQuestions ? '' : practiceFilterBarHtml(mod)}

    <div class="card-btn" style="margin-bottom:14px;">
      <div class="question-stem">
        <div class="en-stem">${escapeHtml(q.QUESTION_EN || '')}</div>
        ${q.QUESTION_HI ? `<div class="hi-stem">${escapeHtml(q.QUESTION_HI || '')}</div>` : ''}
      </div>

      <div style="margin-bottom:12px; display:flex; flex-direction:column; gap:4px;">
        <span class="path-pill">${q.canonicalPath || AutoPathEngine.generateCanonicalHierarchy(m)}</span>
      </div>

      <div class="options-list">
        ${optsHtml}
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border); padding-top:12px; margin-top:12px;">
        <button class="btn-action-sm" onclick="showPracticeHint(${qIndex})" style="background:var(--warning-bg); color:var(--warning); border-color:var(--warning);">
          💡 Need a Hint? (${ActiveHintStep}/3)
        </button>
        <span style="display:flex;gap:6px;align-items:center;">${bookmarkButtonHtml(q.canonicalQId)}<button class="btn-action-sm" onclick="openScratchpad()">📝 Scratchpad</button></span>
      </div>

      <div id="practiceHintDisplay" style="margin-top:10px; font-size:13px; color:var(--text-main); font-weight:700; background:var(--warning-bg); padding:10px; border-radius:var(--radius-md); display:${ActiveHintStep > 0 ? 'block' : 'none'};">
        ${q.hints && q.hints[ActiveHintStep - 1] ? q.hints[ActiveHintStep - 1] : q.EXPLANATION}
      </div>

      ${selected ? `
        <div class="feedback-box ${selected === q.answer ? 'correct' : 'wrong'}">
          <b>${selected === q.answer ? '✅ सही उत्तर (Correct!)' : '❌ गलत उत्तर (Incorrect)'}</b>
          <div style="margin-top:6px;">${q.EXPLANATION}</div>
        </div>
      ` : ''}
    </div>

    <div style="display:flex; gap:10px;">
      <button class="btn-nav" ${qIndex === 0 ? 'disabled' : ''} onclick="ActiveHintStep=0; navigate('practice', {moduleId:'${moduleId}', qIndex:${qIndex - 1}})">← Previous</button>
      <button class="btn-nav primary" style="flex:1.4;" ${qIndex === allQs.length - 1 ? 'disabled' : ''} onclick="ActiveHintStep=0; navigate('practice', {moduleId:'${moduleId}', qIndex:${qIndex + 1}})">Next Problem →</button>
    </div>
  `;
}
function onPracticeSelect(letter, qNo, moduleId, qIndex) {
  const sjFirstAnswer = !Object.prototype.hasOwnProperty.call(PracticeAnswerState, qNo);
  PracticeAnswerState[qNo] = letter;
  const mod = getWorkspaceModule(moduleId);
  const q = mod?.groups?.flatMap(g => g.questions).find(item => item.originalQNo === qNo);
  if (sjFirstAnswer && q) { const shownAt = PracticeShownAt[String(moduleId) + '|' + qNo]; const sec = shownAt ? (Date.now() - shownAt) / 1000 : null; try { LearningHistory.recordPractice(q, mod, letter, sec); } catch (e) { console.warn('[History] practice record failed', e); } }
  
  if (q && letter !== q.answer) {
    const exists = UserState.mistakeBook.some(m => m.qId === qNo && m.moduleId === moduleId);
    if (!exists) {
      UserState.mistakeBook.unshift({
        qId: qNo, moduleId, topicTitle: mod.topicTitle, subtopic: q.metadata?.subtopic || 'General',
        question: q.QUESTION_EN || q.QUESTION_HI, userAnswer: letter, correctAnswer: q.answer,
        rootCause: "CONCEPTUAL_MISMATCH", savedAt: "Just now"
      });
      saveUserState();
    }
  }
  renderView();
}
function showPracticeHint(qIndex) { ActiveHintStep = (ActiveHintStep % 3) + 1; renderView(); }

/* Engine 6: Test Mode (CBT Simulation Engine) */
let PendingCbtSectionSwitch=null;
function cbtCurrentSectionLabel(){
  if(ActiveTestSession?.sessionContractVersion===1){
    const title=String(ActiveTestSession.topicTitle||'Custom Test').trim()||'Custom Test';
    const count=Array.isArray(ActiveTestSession.questions)?ActiveTestSession.questions.length:0;
    return `${title} · ${count} questions`;
  }
  const option=cbtAvailableSectionOptions().find(x=>x.id===String(ActiveTestSession?.moduleId||''));
  return option?.label||String(ActiveTestSession?.topicTitle||'Current section').trim()||'Current section';
}
function cbtAvailableSectionOptions(){
  const workspace=WorkspaceManager.current();
  const modules=WorkspaceManager.filterModules(AppModules||[]).filter(m=>m&&m.workspaceId===workspace.id&&m.workspaceType===workspace.type&&(m.groups||[]).some(g=>(g.questions||[]).length));
  const indexed=typeof nbSourceRows==='function'?nbSourceRows():[];
  const options=[],seenModules=new Set();
  const subjectName=(raw)=>{
    const clean=String(raw||'Subject').trim().replace(/^[^a-z0-9ऀ-ॿ]+/i,'').replace(/\s+/g,' ');
    const key=clean.toLowerCase();
    const aliases={'math':'Mathematics','maths':'Mathematics','mathematics':'Mathematics','science':'General Science','general science':'General Science','gs':'General Science','reasoning':'Reasoning Ability','reasoning ability':'Reasoning Ability'};
    return aliases[key]||clean||'Subject';
  };
  for(const mod of modules){
    const moduleId=String(mod.moduleId||'');if(!moduleId||seenModules.has(moduleId))continue;
    const rows=indexed.filter(r=>String(r.mod?.moduleId||r.moduleId||'')===moduleId);
    const rawSubject=String(rows[0]?.subject||mod.subject||mod.subjectTitle||'').trim();
    const subjectLabel=subjectName(rawSubject);
    const topic=String(mod.topicTitle||mod.topic||rows[0]?.topic||mod.chapter||'').trim();
    if(!subjectLabel||!topic)continue;
    seenModules.add(moduleId);
    options.push({value:'topic:'+moduleId,label:`${subjectLabel} · ${topic}`,type:'topic',id:moduleId,subjectLabel,topicLabel:topic});
  }
  return options.sort((a,b)=>a.subjectLabel.localeCompare(b.subjectLabel)||a.topicLabel.localeCompare(b.topicLabel)||a.value.localeCompare(b.value));
}
function requestCbtSectionSwitch(value){
  if(!ActiveTestSession||ActiveTestSession.sessionStatus!=='ACTIVE'||!value)return;
  const target=cbtAvailableSectionOptions().find(x=>x.value===String(value));
  if(!target){openCustomToast('That section is no longer available in the active workspace.');renderView();return;}
  if(target.type==='topic'&&target.id===String(ActiveTestSession.moduleId)){renderView();return;}
  if(target.type==='subject'&&String(getWorkspaceModule(ActiveTestSession.moduleId)?.subject||'')===target.id){renderView();return;}
  PendingCbtSectionSwitch={...target};AppBackConfirmationOpen=true;
  openModal('Leave test and open study topic?',`<div style="font-size:14px;line-height:1.6;color:var(--text-main);">Open <b>${escapeHtml(target.label)}</b>? Leaving now exits the active test; current answers will not be submitted for scoring. Submit the test first if you need a scored result.</div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap;"><button onclick="cancelCbtSectionSwitch()" class="btn-nav">CANCEL</button><button onclick="confirmCbtSectionSwitch()" class="btn-nav primary">EXIT &amp; OPEN</button></div>`);
}
function cancelCbtSectionSwitch(){PendingCbtSectionSwitch=null;AppBackConfirmationOpen=false;closeModal();renderView();}
function confirmCbtSectionSwitch(){
  const pending=PendingCbtSectionSwitch;
  const current=pending&&cbtAvailableSectionOptions().find(x=>x.value===pending.value);
  if(!pending||!current||ActiveTestSession?.sessionStatus!=='ACTIVE'){PendingCbtSectionSwitch=null;AppBackConfirmationOpen=false;closeModal();openCustomToast('Section switch cancelled: current context changed.');return;}
  CbtExitGuard.confirmExit(()=>{
    PendingCbtSectionSwitch=null;
    const destination=current.type==='topic'?current.id:current.moduleId;
    if(destination&&getWorkspaceModule(destination))navigate('topic',{moduleId:destination});
    else navigate('home');
  });
}
function initTestSession(moduleId, groupId, qIndex = 0, recoveryState = null, launchContext = null) {
  if (launchContext?.curriculumContext && !(typeof CurriculumContext !== 'undefined' && CurriculumContext.isActive())) {
    // CurriculumContext.scope() currently invokes the callback without activating Route context;
    // recurse-with-same-context never terminates. The hub modules are already active-workspace filtered,
    // and getWorkspaceModule()/the workspace ownership guard below remain authoritative.
    launchContext = { ...launchContext, curriculumContext: false };
  }
  // Duplicate-start guard is limited to the existing host's single active CBT session.
  if (ActiveTestSession?.sessionStatus === 'ACTIVE' && !recoveryState) { openCustomToast('An assessment is already active. Submit or exit it before starting another.'); return; }
  const mod = getWorkspaceModule(moduleId);
  const group = mod?.groups?.find(g => g.groupId === groupId) || (!launchContext?.sessionSpec ? mod?.groups?.[0] : null);
  if (!mod || !group || !Array.isArray(group.questions) || !group.questions.length || (!launchContext?.sessionSpec && !competitiveEnabledGuard())) return;
  const effectiveWorkspace = (typeof CurriculumContext !== 'undefined' && CurriculumContext.isActive()) ? CurriculumContext.WORKSPACE : WorkspaceManager.current();
  if (!effectiveWorkspace?.id || mod.workspaceId !== effectiveWorkspace.id || mod.workspaceType !== effectiveWorkspace.type || mod.workspaceType === 'BOARD') return;
  const sessionSpec = launchContext?.sessionSpec || null;
  let sessionQuestions = group.questions;
  let sessionQuestionIds = group.questions.map(q=>String(q.canonicalQId||q.originalQNo));
  let sourceRefs = [];
  if (sessionSpec) {
    if (sessionSpec.version !== 1 || !Array.isArray(sessionSpec.questionIds) || !sessionSpec.questionIds.length || sessionSpec.questionIds.length > 500 || new Set(sessionSpec.questionIds.map(String)).size !== sessionSpec.questionIds.length || sessionSpec.fingerprint !== sessionSpec.questionIds.map(String).join('|')) { openCustomToast('Custom test rejected: invalid, duplicate or unfrozen question sequence.'); return; }
    const wanted = sessionSpec.questionIds.map(String); const available = new Map();
    if(!IndexEngine?.registry || typeof IndexEngine.registry.get!=='function') { openCustomToast('Custom test rejected: canonical Index registry is unavailable.'); return; }
    for (const m of WorkspaceManager.filterModules(AppModules||[])) {
      if (m.workspaceId !== effectiveWorkspace.id || m.workspaceType !== effectiveWorkspace.type || m.workspaceType === 'BOARD') continue;
      for (const g of (m.groups||[])) for (const q of (g.questions||[])) {
        const id = String(q.canonicalQId||''); if (!id) continue;
        if (!available.has(id)) available.set(id,{q,m,g}); else available.set(id,{ambiguous:true});
      }
    }
    for (const [id,entry] of available) if(!entry.ambiguous && IndexEngine.registry.get(id)!==entry.q) available.set(id,{ambiguous:true});
    const picked=[];
    for (const id of wanted) { const entry=available.get(id); if(!entry||entry.ambiguous){openCustomToast('Custom test rejected: a selected canonical question is unavailable or ambiguous.');return;} picked.push(entry); }
    const anchor=picked[0]; const examId=String(anchor.m.examId||anchor.q.metadata?.examId||''); const examYear=String(anchor.m.examYear||anchor.q.metadata?.year||'').trim();
    if (!examId || !examYear || picked.some(e=>String(e.m.examId||e.q.metadata?.examId||'')!==examId || String(e.m.examYear||e.q.metadata?.year||'').trim()!==examYear)) { openCustomToast('Custom test rejected: selected questions must share one verified exam/year context.'); return; }
    if (anchor.m.moduleId !== moduleId || anchor.g.groupId !== group.groupId) { openCustomToast('Custom test rejected: anchor source changed. Rebuild preview.'); return; }
    sessionQuestions=picked.map(e=>e.q); sessionQuestionIds=wanted;
    sourceRefs=picked.map(e=>({canonicalQId:String(e.q.canonicalQId),moduleId:e.m.moduleId,groupId:e.g.groupId,subject:String(e.q.metadata?.subject||e.m.subject||''),chapter:String(e.q.metadata?.chapter||''),topic:String(e.q.metadata?.topic||e.q.metadata?.subtopic||'')}));
    if(recoveryState&&sessionSpec&&recoveryState.sessionContractVersion===1){const saved=Array.isArray(recoveryState.sourceRefs)?recoveryState.sourceRefs:[];const same=saved.length===sourceRefs.length&&saved.every((x,i)=>['canonicalQId','moduleId','groupId','subject','chapter','topic'].every(k=>String(x?.[k]||'')===String(sourceRefs[i]?.[k]||'')));if(!same){openCustomToast('Custom test recovery rejected: question source metadata changed.');clearCbtRecoveryState();return;}}
  }
  const firstQ=sessionQuestions[0];
  const derivedExamId=mod.examId||firstQ?.metadata?.examId||UserState.selectedExam||'';
  const derivedYear=String(mod.examYear||firstQ?.metadata?.year||UserState.selectedYear||'').trim();
  const profile=UniversalExamRegistry.registry.get(derivedExamId);
  if(!derivedExamId||!derivedYear||!profile||String(profile.examId||derivedExamId)!==String(derivedExamId)) return;
  const durationSeconds=sessionSpec?Math.max(60,Math.min(18000,Number(sessionSpec.durationMinutes||30)*60)):Math.max(1,Number(profile.defaultDurationMinutes||30)*60);
  const startedAt=Number(recoveryState?.sessionStartedAt||Date.now());
  if(!Number.isFinite(startedAt)||startedAt<=0||startedAt>Date.now()+5000){if(recoveryState)clearCbtRecoveryState();return;}
  const elapsed=Math.max(0,Math.floor((Date.now()-startedAt)/1000)); const remaining=Math.max(0,durationSeconds-elapsed);
  const effectiveQuestionSetId=sessionSpec?`CUSTOM:${sessionSpec.fingerprint}`:`${group.groupId}:${group.questions.map(q=>q.canonicalQId||q.originalQNo).join(',')}`;
  if(recoveryState&&(recoveryState.examId!==derivedExamId||String(recoveryState.examYear)!==derivedYear||recoveryState.moduleId!==moduleId||recoveryState.questionSetId!==effectiveQuestionSetId||recoveryState.sessionStatus!=='ACTIVE'||!recoveryState.sessionStartedAt||(sessionSpec&&(!Array.isArray(recoveryState.questionIds)||recoveryState.questionIds.map(String).join('|')!==sessionSpec.questionIds.map(String).join('|'))))){if(recoveryState.sessionContractVersion!==1)clearCbtRecoveryState();return;}
  if(remaining<=0){if(recoveryState)clearCbtRecoveryState();return;}
  // Commit one frozen sequence to the existing CBT session object; no parallel engine or storage.
  const requestedQIndex=Math.max(0,Math.min(Number(qIndex)||0,sessionQuestions.length-1));
  const restoredTimerIndex=Number(recoveryState?.questionTimerIndex);
  const restoredQuestionStart=Number(recoveryState?.questionTimerStartedAt);
  const useRestoredQuestionTimer=!!recoveryState&&Number.isFinite(restoredTimerIndex)&&restoredTimerIndex===requestedQIndex&&Number.isFinite(restoredQuestionStart)&&restoredQuestionStart>0&&restoredQuestionStart<=Date.now()+5000;
  ActiveTestSession={moduleId,groupId:group.groupId,topicTitle:sessionSpec?(String(sessionSpec.title||'').trim()||'Custom Test'):mod.topicTitle,groupTitle:sessionSpec?`${String(sessionSpec.title||'').trim()||'Custom Test'} · ${sessionQuestions.length} questions`:group.title,questions:sessionQuestions,answers:recoveryState?.answers||{},subjectiveState:recoveryState?.subjectiveState||{},marked:recoveryState?.marked||{},questionTimeSpent:recoveryState?.questionTimeSpent&&typeof recoveryState.questionTimeSpent==='object'&&!Array.isArray(recoveryState.questionTimeSpent)?{...recoveryState.questionTimeSpent}:{},questionTimerIndex:requestedQIndex,questionTimerStartedAt:useRestoredQuestionTimer?restoredQuestionStart:Date.now(),timeRemaining:remaining,startTime:startedAt,sessionStartedAt:startedAt,durationSeconds,examId:derivedExamId,examProfile:profile,examYear:derivedYear,workspaceId:effectiveWorkspace.id,workspaceType:effectiveWorkspace.type,sessionStatus:'ACTIVE',submissionState:'PENDING',questionSetId:effectiveQuestionSetId,langMode:recoveryState?.langMode||sessionSpec?.langMode||'both',...(sessionSpec?{sessionContractVersion:1,questionIds:sessionQuestionIds.slice(),questionSequenceFingerprint:sessionSpec.fingerprint,sourceRefs}: {})};
  SubjectiveResultStateBuffer={...(recoveryState?.subjectiveState||{})};
  UserState.resumeState={moduleId,groupId:group.groupId,qIndex,mode:'test'};
  saveUserState(); saveCbtRecoveryState(); CbtExitGuard.arm();
  if(TimerInterval)clearInterval(TimerInterval);
  TimerInterval=setInterval(()=>{if(!ActiveTestSession||ActiveTestSession.sessionStatus!=='ACTIVE'){clearInterval(TimerInterval);TimerInterval=null;return;}const elapsedNow=Math.max(0,Math.floor((Date.now()-ActiveTestSession.sessionStartedAt)/1000));ActiveTestSession.timeRemaining=Math.max(0,ActiveTestSession.durationSeconds-elapsedNow);saveCbtRecoveryState();const timerElem=document.getElementById('testTimerDisplay');if(timerElem){const mins=String(Math.floor(ActiveTestSession.timeRemaining/60)).padStart(2,'0');const secs=String(ActiveTestSession.timeRemaining%60).padStart(2,'0');timerElem.textContent=`${mins}:${secs}`;}const currentQuestionIndex=Math.max(0,Number(Route?.params?.qIndex)||0);const questionTimerElem=document.querySelector('#cbtViewport .q-time');if(questionTimerElem)questionTimerElem.textContent='⏱ '+formatCbtElapsedTime(getQuestionElapsedSeconds(currentQuestionIndex));if(ActiveTestSession.timeRemaining<=0){clearInterval(TimerInterval);TimerInterval=null;clearCbtRecoveryState();submitTestSession();}},1000);
  navigate('test',{moduleId,groupId:group.groupId,qIndex});
}

function clearCbtRecoveryState() {
  if (!UserState) return;
  delete UserState.cbtSession;
  if (UserState.resumeState?.mode === 'test') delete UserState.resumeState;
  saveUserState();
}
function saveCbtRecoveryState() {
  if (!ActiveTestSession || !UserState) return;
  const isCustom=ActiveTestSession.sessionContractVersion===1;
  UserState.cbtSession = {
    workspaceId: ActiveTestSession.workspaceId,
    workspaceType: ActiveTestSession.workspaceType,
    examId: ActiveTestSession.examId, examYear: ActiveTestSession.examYear, moduleId: ActiveTestSession.moduleId, groupId: ActiveTestSession.groupId,
    questionSetId: ActiveTestSession.questionSetId, sessionStartedAt: ActiveTestSession.sessionStartedAt, durationSeconds: ActiveTestSession.durationSeconds,
    sessionStatus: ActiveTestSession.sessionStatus, submissionState: ActiveTestSession.submissionState,
    answers: ActiveTestSession.answers, subjectiveState: ActiveTestSession.subjectiveState, marked: ActiveTestSession.marked, langMode: ActiveTestSession.langMode,
    questionIndex: Math.max(0, Number(Route?.params?.qIndex)||0), questionTimeSpent: {...(ActiveTestSession.questionTimeSpent||{})}, questionTimerIndex: Number(ActiveTestSession.questionTimerIndex)||0, questionTimerStartedAt: Number(ActiveTestSession.questionTimerStartedAt)||Date.now(),
    ...(isCustom?{sessionTitle:ActiveTestSession.topicTitle,sessionContractVersion:1,questionIds:ActiveTestSession.questionIds.slice(),questionSequenceFingerprint:ActiveTestSession.questionSequenceFingerprint,sourceRefs:(ActiveTestSession.sourceRefs||[]).map(x=>({...x}))}:{})
  };
  saveUserState();
}

function recoverCbtSessionIfValid() {
  const r = UserState?.cbtSession;
  if (!r || r.sessionStatus !== 'ACTIVE') return false;
  // CAND-02: validate recovery against the active WorkspaceManager; never switch workspace transiently.
  const ts = Number(r.sessionStartedAt);
  if (r.workspaceId !== WorkspaceManager.current().id || (r.workspaceType && r.workspaceType !== WorkspaceManager.current().type) || !r.examId || !r.examYear || !r.moduleId || !r.groupId || !r.questionSetId || !Number.isFinite(ts) || ts <= 0 || ts > Date.now() + 5000 || !Number.isFinite(Number(r.durationSeconds)) || Number(r.durationSeconds) <= 0) { clearCbtRecoveryState(); return false; }
  const mod = getWorkspaceModule(r.moduleId); const group = mod?.groups?.find(g=>g.groupId===r.groupId);
  if (!mod || !group) { clearCbtRecoveryState(); return false; }
  const p = UniversalExamRegistry.registry.get(r.examId);
  if (!p || String(mod.examId||'') !== String(r.examId) || String(mod.examYear||'') !== String(r.examYear)) { clearCbtRecoveryState(); return false; }
  if(r.sessionContractVersion===1){
    if(!Array.isArray(r.questionIds)||!r.questionIds.length||r.questionIds.length>500||new Set(r.questionIds).size!==r.questionIds.length||r.questionIds.join('|')!==r.questionSequenceFingerprint||r.questionSetId!==`CUSTOM:${r.questionSequenceFingerprint}`){clearCbtRecoveryState();return false;}
    if(!IndexEngine?.registry || typeof IndexEngine.registry.get!=='function'){clearCbtRecoveryState();return false;}
    const available=new Map();for(const m of WorkspaceManager.filterModules(AppModules||[]))for(const g of (m.groups||[]))for(const q of (g.questions||[])){const id=String(q.canonicalQId||'');if(id&&!available.has(id))available.set(id,{q,m,g});else if(id&&available.has(id))available.set(id,{ambiguous:true});}
    for(const [id,entry] of available)if(!entry.ambiguous&&IndexEngine.registry.get(id)!==entry.q)available.set(id,{ambiguous:true});
    if(r.questionIds.some(id=>!available.has(id)||available.get(id).ambiguous)){clearCbtRecoveryState();return false;}
    const rows=r.questionIds.map(id=>available.get(id));if(rows.some(x=>x.m.workspaceId!==r.workspaceId||x.m.workspaceType!==r.workspaceType||String(x.m.examId||x.q.metadata?.examId||'')!==String(r.examId)||String(x.m.examYear||x.q.metadata?.year||'')!==String(r.examYear))){clearCbtRecoveryState();return false;}
    const spec={version:1,questionIds:r.questionIds.slice(),durationMinutes:Number(r.durationSeconds)/60,langMode:r.langMode||'both',fingerprint:r.questionSequenceFingerprint,title:r.sessionTitle||''};initTestSession(r.moduleId,r.groupId,Math.max(0,Number(r.questionIndex)||0),r,{sessionSpec:spec});return !!ActiveTestSession;
  }
  const questionSetId = `${group.groupId}:${group.questions.map(q=>q.canonicalQId||q.originalQNo).join(',')}`;
  if (questionSetId !== r.questionSetId) { clearCbtRecoveryState(); return false; }
  initTestSession(r.moduleId, r.groupId, Math.max(0,Number(r.questionIndex)||0), r);
  return !!ActiveTestSession;
}


function formatCbtElapsedTime(seconds){const n=Math.max(0,Math.floor(Number(seconds)||0));return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;}
function getQuestionElapsedSeconds(qIndex,now=Date.now()){
  if(!ActiveTestSession)return 0;
  const key=String(Math.max(0,Number(qIndex)||0));const base=Math.max(0,Number(ActiveTestSession.questionTimeSpent?.[key])||0);
  if(Number(ActiveTestSession.questionTimerIndex)!==Number(key))return Math.floor(base);
  const started=Number(ActiveTestSession.questionTimerStartedAt)||now;
  return Math.floor(base+Math.max(0,now-started)/1000);
}
// V2.2.7: track per-question elapsed time at render boundary so the existing,
// user-verified switchQuestion() navigation handler remains byte-for-byte unchanged.
function syncQuestionTimerIndex(qIndex,now=Date.now()){
  if(!ActiveTestSession||ActiveTestSession.sessionStatus!=='ACTIVE')return;
  const count=Math.max(1,ActiveTestSession.questions?.length||1);
  const index=Math.max(0,Math.min(Number(qIndex)||0,count-1));
  const prior=Number(ActiveTestSession.questionTimerIndex);
  if(Number.isFinite(prior)&&prior===index)return;
  const started=Number(ActiveTestSession.questionTimerStartedAt)||now;
  const spent={...(ActiveTestSession.questionTimeSpent||{})};
  if(Number.isFinite(prior)&&prior>=0){const elapsed=Math.max(0,Math.floor((now-started)/1000));spent[String(prior)]=Math.max(0,Number(spent[String(prior)])||0)+elapsed;}
  ActiveTestSession.questionTimeSpent=spent;
  ActiveTestSession.questionTimerIndex=index;
  ActiveTestSession.questionTimerStartedAt=now;
  saveCbtRecoveryState();
}
function renderTestPage(v, moduleId, groupId, qIndex) {
  syncQuestionTimerIndex(qIndex);
  if (!ActiveTestSession) return navigate('home');

  qIndex = Math.max(0, Math.min(Number(qIndex) || 0, ActiveTestSession.questions.length - 1));
  const q = ActiveTestSession.questions[qIndex];
  const total = ActiveTestSession.questions.length;
  const currentAnswer = ActiveTestSession.answers[nbQuestionKey(q)] || '';
  const isMarked = !!ActiveTestSession.marked[nbQuestionKey(q)];

  const mins = String(Math.floor(ActiveTestSession.timeRemaining / 60)).padStart(2, '0');
  const secs = String(ActiveTestSession.timeRemaining % 60).padStart(2, '0');

  (ActiveTestSession.visited = ActiveTestSession.visited || {})[nbQuestionKey(q)] = true;
  const chipsHtml = ActiveTestSession.questions.map((item, idx) => {
    const isCurrent = idx === qIndex;
    const isAnswered = !!ActiveTestSession.answers[nbQuestionKey(item)] || ActiveTestSession.subjectiveState?.[nbQuestionKey(item)] === 'ATTEMPTED';
    const isItemMarked = !!ActiveTestSession.marked[nbQuestionKey(item)];
    let cls = 'strip-chip';
    if (isCurrent) cls += ' active'; else if (isItemMarked) cls += (isAnswered ? ' marked ans-rev' : ' marked'); else if (isAnswered) cls += ' answered'; else if (ActiveTestSession.visited[nbQuestionKey(item)]) cls += ' skipped';
    const status=isCurrent?'current question':isItemMarked?'marked for review':isAnswered?'answered':'not answered';
    return `<button type="button" class="${cls}" onclick="switchQuestion(${idx})" aria-label="Question ${idx+1}, ${status}" ${isCurrent?'aria-current="step"':''}>${idx + 1}</button>`;
  }).join('');

  const optionsHtml = QuestionUI.render(
    q,
    'test',
    QuestionUI.getFormat(q) === 'SUBJECTIVE' ? ActiveTestSession.subjectiveState : ActiveTestSession.answers,
    qIndex,
    moduleId
  );

  let langClass = '';
  if (ActiveTestSession.langMode === 'en') langClass = 'lang-en-only'; else if (ActiveTestSession.langMode === 'hi') langClass = 'lang-hi-only';

  v.innerHTML = `
    <div class="test-fixed-viewport ${langClass}" id="cbtViewport">
      <div class="test-fixed-header">
        <div class="test-header-row">
          <div style="display:flex; align-items:center; gap:6px; min-width:0;">
            <button type="button" class="cbt-one-step-back" aria-label="ONE STEP BACK" title="ONE STEP BACK" onclick="appNavigateBack()">← Back</button>
            <div class="header-logo-box">A+</div>
            <div class="section-switcher-wrap">
                <div>Test</div>
                <span class="section-switcher cbt-test-label" title="${escapeHtml(cbtCurrentSectionLabel())}">${escapeHtml(cbtCurrentSectionLabel())}</span>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
             <div class="proctor-status" title="Live Sync"><div class="proctor-dot"></div><span class="hidden sm:inline">LIVE</span></div>
            <div class="timer-badge" role="button" tabindex="0" onclick="cbtToggleTimer()" title="Tap to hide/show time"><span style="color:var(--text-muted);">⏱</span><span id="testTimerDisplay">${mins}:${secs}</span></div>
            <button type="button" class="cbt-header-submit" onclick="confirmSubmitTest()">Submit</button>
          </div>
        </div>
        ${cbtSubjectStripHtml(qIndex)}
        <div class="cbt-compact-tools-row">
            <button type="button" class="question-palette-toggle" id="questionPaletteToggle" onclick="toggleQuestionPalette()" aria-expanded="false" aria-controls="questionPaletteDrawer" title="Open question numbers">▦ <span>Q${qIndex + 1} / ${total}</span></button>
            <div class="header-actions shrink-0">
               <button class="icon-btn" onclick="cbtOpenPad()" title="Rough pad" aria-label="Rough pad">✏️</button>
               <button class="icon-btn" onclick="toggleCbtLang()" title="Toggle Language">A/अ</button>
               <button class="icon-btn" onclick="toggleCbtDark()" title="Dark Mode Toggle">🌙</button>
               <button class="icon-btn" onclick="toggleCbtFullscreen()" title="Focus Mode (Full Screen)" id="btnFullscreen"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M216,48V88a8,8,0,0,1-16,0V56H168a8,8,0,0,1,0-16h40A8,8,0,0,1,216,48ZM88,200H56V168a8,8,0,0,0-16,0v40a8,8,0,0,0,8,8H88a8,8,0,0,0,0-16Zm120-40a8,8,0,0,0-8,8v32H168a8,8,0,0,0,8,8h40a8,8,0,0,0,8-8V168A8,8,0,0,0,208,160ZM48,88a8,8,0,0,0,8-8V48h40a8,8,0,0,0,0-16H48a8,8,0,0,0-8,8V96A8,8,0,0,0,48,104Z"></path></svg></button>
            </div>
        </div>
        <div class="question-palette-drawer" id="questionPaletteDrawer" role="dialog" aria-label="Question palette" hidden>
          <div class="question-palette-head"><strong>Question palette</strong><span>${total} questions</span><button type="button" class="question-palette-close" onclick="closeQuestionPalette()" aria-label="Close question palette">×</button></div>
          <div class="question-palette-grid" id="stripContainer">${cbtPaletteHtml(qIndex, chipsHtml)}</div>
          <div class="question-palette-legend"><span><i class="palette-dot current"></i>Current</span><span><i class="palette-dot answered"></i>Answered</span><span><i class="palette-dot marked"></i>Review</span><span><i class="palette-dot skipped"></i>Not answered</span><span><i class="palette-dot"></i>Not visited</span></div>
        </div>
      </div>
      <div class="test-scrollable-body" id="testScrollableContainer">
        <div class="cbt-question-card">
            <div class="question-badge-row">
              <div class="q-badge">Question ${qIndex + 1} ${bookmarkButtonHtml(q.canonicalQId, 'cbt-bm')}</div>
              <div class="q-metrics"><span class="q-time">⏱ ${formatCbtElapsedTime(getQuestionElapsedSeconds(qIndex))}</span><span class="q-marks" title="Scoring: +1 correct, 0 wrong or skipped"><span class="mark-pos">+1</span> <span class="mark-neg" style="color:var(--text-muted)">0 neg</span></span></div>
            </div>
            <div class="question-stem"><div class="en-stem">${escapeHtml(q.QUESTION_EN || '')}</div>${q.QUESTION_HI ? `<div class="hi-stem">${escapeHtml(q.QUESTION_HI || '')}</div>` : ''}</div>
            <div class="options-list">${optionsHtml}</div>
            ${typeof cbtConfidenceRow==='function'?cbtConfidenceRow(q, qIndex):''}
        </div>
      </div>
      <div class="test-fixed-footer">
        <div class="test-footer-inner">
          <button class="footer-btn btn-nav-prev" ${qIndex === 0 ? 'disabled style="opacity:0.3; pointer-events:none;"' : ''} onclick="switchQuestion(${qIndex - 1})" aria-label="Previous Question">← Previous</button>
          <div style="display:flex; gap:12px; align-items:center;">
             <button class="footer-btn btn-nav-clear" onclick="clearOption(${qIndex})">Clear</button>
             <button class="footer-btn btn-nav-mark ${isMarked ? 'marked' : ''}" onclick="toggleMarkReview(${qIndex})"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256" style="margin-right:3px;"><path d="M192,24H96A16,16,0,0,0,80,40V56H64A16,16,0,0,0,48,72V224a8,8,0,0,0,12.65,6.51L112,193.83l51.36,36.68A8,8,0,0,0,176,224V184h16a16,16,0,0,0,16-16V40A16,16,0,0,0,192,24ZM160,206.17l-43.35-31a8,8,0,0,0-9.3,0L64,206.17V72H160Zm32-38.17V72a16,16,0,0,0-16-16H96V40h96Z"></path></svg> Mark for Review</button>
          </div>
          <button class="footer-btn btn-nav-next" onclick="onNextClick(${qIndex}, ${total})">${qIndex === total - 1 ? 'Finish Test' : 'Save & Next →'}</button>
        </div>
      </div>
    </div>
  `;

  try { cbtAfterRender(qIndex); } catch (e) { console.warn('[CBT] subject strip', e); }
  const btnFs = document.getElementById('btnFullscreen');
  if (btnFs) {
      if (document.fullscreenElement) {
          btnFs.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M216,48V104a8,8,0,0,1-16,0V56H152a8,8,0,0,1,0-16h48A8,8,0,0,1,216,48ZM104,200H56V152a8,8,0,0,0-16,0v48a8,8,0,0,0,8,8h48a8,8,0,0,0,0-16Zm104-56a8,8,0,0,0-8,8v48H152a8,8,0,0,0,0,16h48a8,8,0,0,0,8-16V152A8,8,0,0,0,208,144ZM48,104a8,8,0,0,0,8-8V48h48a8,8,0,0,0,0-16H48a8,8,0,0,0-8,8V96A8,8,0,0,0,48,104Z"></path></svg>`;
      }
  }

}

function toggleQuestionPalette(force){
  const drawer=document.getElementById('questionPaletteDrawer');
  const button=document.getElementById('questionPaletteToggle');
  if(!drawer||!button)return;
  const opening=force===undefined?drawer.hidden:!!force;
  drawer.hidden=!opening;
  button.setAttribute('aria-expanded',String(opening));
  if(opening)drawer.querySelector('.strip-chip.active')?.focus({preventScroll:true});
}
function closeQuestionPalette(){toggleQuestionPalette(false);}
if(!window.__MTB_QUESTION_PALETTE_HANDLERS__){
  window.__MTB_QUESTION_PALETTE_HANDLERS__=true;
  document.addEventListener('keydown',event=>{
    const drawer=document.getElementById('questionPaletteDrawer');
    if(event.key==='Escape'&&drawer&&!drawer.hidden){closeQuestionPalette();event.stopPropagation();event.preventDefault();}
  },true);
  document.addEventListener('pointerdown',event=>{
    const drawer=document.getElementById('questionPaletteDrawer');
    const toggle=document.getElementById('questionPaletteToggle');
    if(drawer&&!drawer.hidden&&!drawer.contains(event.target)&&!toggle?.contains(event.target))closeQuestionPalette();
  });
}

function syncCbtFullscreenButton(){
  const button=document.getElementById('btnFullscreen');if(!button)return;
  const active=!!document.fullscreenElement;document.body.classList.toggle('cbt-focus-mode',active&&Route?.page==='test');button.setAttribute('aria-pressed',active?'true':'false');button.title=active?'Exit Focus Mode':'Focus Mode (Full Screen)';button.setAttribute('aria-label',button.title);
}
document.addEventListener('fullscreenchange',syncCbtFullscreenButton);
async function toggleCbtFullscreen(){
  try{
    if(!document.fullscreenElement){
      if(!document.documentElement||typeof document.documentElement.requestFullscreen!=='function'){openCustomToast('Focus Mode is unavailable in this browser.');return;}
      await document.documentElement.requestFullscreen();
    }else{await document.exitFullscreen();}
    syncCbtFullscreenButton();
  }catch(err){console.warn('Focus Mode toggle failed:',err);openCustomToast('Focus Mode could not be changed in this browser.');syncCbtFullscreenButton();}
}
function toggleCbtLang() {
    if (!ActiveTestSession) return;
    if (ActiveTestSession.langMode === 'both') ActiveTestSession.langMode = 'en'; else if (ActiveTestSession.langMode === 'en') ActiveTestSession.langMode = 'hi'; else ActiveTestSession.langMode = 'both';
    renderView();
}
function toggleCbtDark() { UserState.theme = UserState.theme === 'dark' ? 'light' : 'dark'; document.body.classList.toggle('dark', UserState.theme === 'dark'); const globalThemeButton=document.getElementById('btnTheme'); if(globalThemeButton)globalThemeButton.textContent=UserState.theme==='dark'?'☀️':'🌙'; saveUserState(); renderView(); }
function readAloudQuestion(text) {
    if ('speechSynthesis' in window) { window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text); utterance.rate = 0.9; window.speechSynthesis.speak(utterance); } 
    else alert("Audio pronunciation is not supported in this browser.");
}
function clearOption(qIndex) {
  if (!ActiveTestSession) return;
  const q=ActiveTestSession.questions[qIndex]; if(!q) return;
  const key=nbQuestionKey(q);
  if (QuestionUI.getFormat(q)==='SUBJECTIVE') {
    delete ActiveTestSession.subjectiveState[key]; delete SubjectiveResultStateBuffer[key];
  } else delete ActiveTestSession.answers[key];
  saveCbtRecoveryState(); renderView();
}

function switchQuestion(newIndex) { Route.params.qIndex = newIndex; window.speechSynthesis.cancel(); renderView(); }
function selectOption(letter, qIndex) {
  if (!ActiveTestSession) return;
  const q=ActiveTestSession.questions[qIndex]; if(!q) return;
  const key=nbQuestionKey(q);
  if(ActiveTestSession.answers[key]===letter) delete ActiveTestSession.answers[key]; else ActiveTestSession.answers[key]=letter;
  saveCbtRecoveryState(); renderView();
}

function toggleMarkReview(qIndex) {
  if(!ActiveTestSession) return;
  const q=ActiveTestSession.questions[Number(qIndex)]; if(!q) return;
  const key=nbQuestionKey(q); ActiveTestSession.marked[key]=!ActiveTestSession.marked[key];
  saveCbtRecoveryState(); renderView();
}

function onNextClick(currentIndex, total) { if (currentIndex === total - 1) confirmSubmitTest(); else switchQuestion(currentIndex + 1); }
function confirmSubmitTest() {
  window.speechSynthesis.cancel();
  const answeredCount = Object.keys(ActiveTestSession.answers).length; const total = ActiveTestSession.questions.length;
  openModal('📤 Submit Assessment?', `<div style="font-size:14px; line-height:1.6; color:var(--text-main);">Are you ready to submit your test?<br><br>• <b>Answered:</b> ${answeredCount} / ${total}<br>• <b>Remaining:</b> ${total - answeredCount}</div><div style="display:flex; gap:10px; margin-top:20px;"><button onclick="closeModal()" class="btn-nav">Review More</button><button onclick="closeModal(); clearCbtRecoveryState(); submitTestSession();" class="btn-nav primary">Confirm & Submit</button></div>`);
}
function submitTestSession() {
  if (!ActiveTestSession || ActiveTestSession.submissionState==='COMMITTED') return;
  const session=ActiveTestSession; const isCustom=session.sessionContractVersion===1;
  if (TimerInterval) { clearInterval(TimerInterval); TimerInterval=null; }
  CbtExitGuard.disarm(); if(window.speechSynthesis?.cancel) window.speechSynthesis.cancel();
  if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});
  let correct=0,wrong=0,unattempted=0;
  const sourceById=new Map((session.sourceRefs||[]).map(x=>[String(x.canonicalQId),x]));
  session.questions.forEach(q=>{
    const key=nbQuestionKey(q); const userAns=session.answers[key]; const source=sourceById.get(String(q.canonicalQId||''))||{};
    if(QuestionUI.getFormat(q)==='SUBJECTIVE'){unattempted++;return;}
    if(!userAns){unattempted++;return;}
    if(String(userAns).toUpperCase()===String(q.answer||'').toUpperCase()) correct++;
    else {
      wrong++;
      const sourceModule=source.moduleId||session.moduleId;
      const canonicalId=String(q.canonicalQId||q.originalQNo);
      const exists=(UserState.mistakeBook||[]).some(m=>m.moduleId===sourceModule&&(String(m.canonicalQId||'')===canonicalId||String(m.qId)===String(q.originalQNo)));
      if(!exists){
        UserState.mistakeBook.unshift({qId:q.originalQNo,canonicalQId:canonicalId,moduleId:sourceModule,sourceGroupId:source.groupId||session.groupId,topicTitle:source.topic||session.topicTitle,subtopic:q.metadata?.subtopic||source.topic||'General',subject:source.subject||q.metadata?.subject||'',chapter:source.chapter||q.metadata?.chapter||'',question:q.QUESTION_EN||q.QUESTION_HI,userAnswer:userAns,correctAnswer:q.answer,rootCause:'TEST_SIMULATION_ERROR',savedAt:'Just now'});
      }
    }
  });
  const total=session.questions.length;const accuracy=(correct+wrong)>0?Math.round((correct/(correct+wrong))*100):0;
  // The legacy single-module engine keeps its previous mastery calculation; mixed custom tests do not arbitrarily assign all results to the anchor topic.
  if(!isCustom){
    const topicSlug=session.moduleId.split('-')[1];const oldScore=UserState.masteryMap[topicSlug]?.score||0.5;
    const newScore=Math.min(1,Math.max(0,(oldScore*0.7)+((correct/Math.max(1,total))*0.3)));
    let level='learning';if(newScore<0.4)level='weak';else if(newScore<0.7)level='learning';else if(newScore<0.85)level='good';else level='mastered';
    UserState.masteryMap[topicSlug]={score:parseFloat(newScore.toFixed(2)),level};
  }
  session.submissionState='COMMITTED'; session.sessionStatus='SUBMITTED';
  const resultData={moduleId:session.moduleId,groupId:session.groupId,topicTitle:session.topicTitle,groupTitle:session.groupTitle,total,correct,wrong,unattempted,score:correct,accuracy,questions:session.questions.slice(),answers:{...session.answers},subjectiveState:{...(session.subjectiveState||{})},marked:{...(session.marked||{})},confidence:{...(session.confidence||{})},langMode:session.langMode,...(isCustom?{sessionContractVersion:1,questionIds:session.questionIds.slice(),questionSequenceFingerprint:session.questionSequenceFingerprint,sourceRefs:(session.sourceRefs||[]).map(x=>({...x}))}:{})};
  try { resultData.historyId = LearningHistory.recordTest(session, resultData); } catch (e) { console.warn('[History] test record failed', e); }
  clearCbtRecoveryState(); saveUserState(); ActiveTestSession=null; SubjectiveResultStateBuffer={}; navigate('result',{result:resultData});
}

function renderResultPage(v,res){
  if(!res) return navigate('home');
  const isCustom=res.sessionContractVersion===1;
  const sources=new Map((res.sourceRefs||[]).map(x=>[String(x.canonicalQId),x]));
  const keyFor=q=>isCustom?String(q.canonicalQId||''):String(q.originalQNo??'');
  const solutionsHtml=(res.questions||[]).map((q,idx)=>{
    const key=keyFor(q),source=sources.get(String(q.canonicalQId||''))||{};
    const sourceBits=[source.subject||q.metadata?.subject,source.chapter||q.metadata?.chapter,source.topic||q.metadata?.topic||q.metadata?.subtopic].filter(Boolean);
    const sourceHtml=sourceBits.length?`<div class="nb-result-source" style="font-size:11px;color:var(--text-muted);margin:4px 0 8px;">${escapeHtml(sourceBits.join(' › '))}${source.groupId?` · ${escapeHtml(source.groupId)}`:''}</div>`:'';
    const isSubjective=QuestionUI.getFormat(q)==='SUBJECTIVE';
    if(isSubjective){
      const attempted=(res.subjectiveState||SubjectiveResultStateBuffer||{})[key]==='ATTEMPTED';
      const statusBadge=attempted?`<span style="color:var(--success);font-weight:800;">📝 SELF-EVALUATION • ATTEMPTED</span>`:`<span style="color:var(--text-muted);font-weight:800;">📝 SELF-EVALUATION • NOT ATTEMPTED</span>`;
      return `<div class="card-btn" style="margin-bottom:12px;"><div style="display:flex;justify-content:space-between;margin-bottom:8px;"><strong>Q.${escapeHtml(q.originalQNo??idx+1)} (${idx+1}/${res.total})</strong>${statusBadge}</div>${sourceHtml}<div style="font-size:14px;font-weight:700;margin-bottom:8px;">${escapeHtml(q.QUESTION_EN||'')}</div><div style="font-size:13px;color:var(--text-muted);margin-bottom:10px;">${escapeHtml(q.QUESTION_HI||'')}</div><div class="subjective-result"><strong>📝 Attempt Status:</strong> ${attempted?'Attempted':'Not Attempted'}<br><strong>📘 Model Answer:</strong><br>${escapeHtml(q.EXPLANATION||'Model answer is not available.')}</div></div>`;
    }
    const rawAnswer=res.answers?.[key];const userAns=rawAnswer||'Not Attempted';const isCorrect=!!rawAnswer&&String(userAns).toUpperCase()===String(q.answer||'').toUpperCase();
    let statusBadge=`<span style="color:var(--text-muted);font-weight:800;">UNATTEMPTED</span>`;if(rawAnswer)statusBadge=isCorrect?`<span style="color:var(--success);font-weight:800;">✅ CORRECT</span>`:`<span style="color:var(--danger);font-weight:800;">❌ WRONG</span>`;
    return `<div class="card-btn" style="margin-bottom:12px;"><div style="display:flex;justify-content:space-between;margin-bottom:8px;"><strong>Q.${escapeHtml(q.originalQNo??idx+1)} (${idx+1}/${res.total})</strong>${statusBadge}</div>${sourceHtml}<div style="font-size:14px;font-weight:700;margin-bottom:8px;">${escapeHtml(q.QUESTION_EN||'')}</div><div style="font-size:13px;color:var(--text-muted);margin-bottom:10px;">${escapeHtml(q.QUESTION_HI||'')}</div><div style="font-size:13px;margin-bottom:6px;">Your Answer: <b style="color:${isCorrect?'var(--success)':'var(--danger)'};">${escapeHtml(userAns)}</b> • Correct Answer: <b style="color:var(--success);">${escapeHtml(q.answer||'Not available')}</b></div>${q.EXPLANATION?`<div style="margin-top:12px;padding:12px;border-radius:var(--radius-md);background:var(--primary-light);font-size:13px;color:var(--text-main);"><strong>💡 Step-by-Step Solution:</strong><br>${escapeHtml(q.EXPLANATION)}</div>`:''}</div>`;
  }).join('');
  const topicStats=new Map();
  if(isCustom){
    (res.questions||[]).forEach(q=>{
      const key=keyFor(q),source=sources.get(String(q.canonicalQId||''))||{};
      const label=[source.subject||q.metadata?.subject,source.chapter||q.metadata?.chapter,source.topic||q.metadata?.topic||q.metadata?.subtopic].filter(Boolean).join(' › ')||'Uncategorised';
      if(!topicStats.has(label))topicStats.set(label,{total:0,correct:0,wrong:0,unanswered:0});
      const stat=topicStats.get(label);stat.total++;
      if(QuestionUI.getFormat(q)==='SUBJECTIVE'){stat.unanswered++;return;}
      const answer=res.answers?.[key];if(!answer)stat.unanswered++;else if(String(answer).toUpperCase()===String(q.answer||'').toUpperCase())stat.correct++;else stat.wrong++;
    });
  }
  const topicPerformanceHtml=[...topicStats].map(([label,x])=>`<div class="nb-row"><span class="nb-row-main"><span class="nb-row-title">${escapeHtml(label)}</span><span class="nb-row-meta">${x.correct} correct · ${x.wrong} incorrect · ${x.unanswered} unanswered</span></span><span class="nb-count">${x.total} Q</span></div>`).join('');
  v.innerHTML=`<div class="nav-breadcrumb"><button onclick="navigate('home')">Home</button><span class="sep">/</span><button onclick="navigate('test_hub')">CBT Assessment</button><span class="sep">/</span><span>Result</span></div><div class="section-title"><span>📊 ${tx('RESULT','परिणाम')}</span><button class="btn-action-sm" onclick="navigate('home')">🏠 ${tx('Home','होम')}</button></div>${typeof resultSoftLanding==='function'?resultSoftLanding(res):''}<div class="student-hero-card rs-score" style="text-align:center;"><h1 style="font-size:32px;">${res.score} / ${res.total}</h1><p style="font-size:14px;font-weight:700;color:var(--text-main);">Score in ${escapeHtml(res.topicTitle||'Custom Test')} • ${escapeHtml(res.groupTitle||'')}</p></div>${typeof resultWhatIf==='function'?resultWhatIf(res, keyFor):''}<div class="goals-grid" style="margin-bottom:16px;"><div class="goal-box"><small>ACCURACY</small><strong style="color:var(--primary);">${res.accuracy}%</strong></div><div class="goal-box"><small>CORRECT</small><strong style="color:var(--success);">${res.correct}</strong></div><div class="goal-box"><small>WRONG</small><strong style="color:var(--danger);">${res.wrong}</strong></div><div class="goal-box"><small>SKIPPED</small><strong>${res.unattempted}</strong></div></div>${isCustom?`<section class="nb-panel"><h3>Performance by subject / topic</h3>${topicPerformanceHtml||'<p class="nb-row-meta">No topic performance data is available.</p>'}</section><p class="nb-row-meta">Topic-level figures come from this submitted question sequence. Mixed-topic mastery-map updates are not assigned to an arbitrary anchor topic.</p>`:''}<div class="nba-banner"><div><span style="font-size:10px;font-weight:900;color:var(--accent-cyan);text-transform:uppercase;">Next Step</span><div style="font-size:13px;font-weight:800;color:var(--text-main);">${res.wrong>0?`Revise your ${res.wrong} mistakes in the Mistake Book.`:'Review your results or create another test.'}</div></div><button class="btn-nav primary" style="min-height:38px;font-size:12px;padding:6px 12px;" onclick="${res.wrong>0?"navigate('mistakes')":"navigate('native_builder')"}">${res.wrong>0?'Review Mistakes ➔':'Create Another Test ➔'}</button></div><div class="section-title"><span>Detailed Question Solutions</span></div>${solutionsHtml}`;
  try { resultEnhance(v, res); } catch (e) { console.warn('[Result] enhance failed', e); }
}

let MistakeViewState = { allExams: false, search: '', topic: '' };
function mbSourceList() {
  const all = (UserState.mistakeBook || []);
  if (!competitiveEnabledGuard()) return all;
  // "All exams" still respects the active workspace (no cross-workspace leakage).
  return MistakeViewState.allExams ? all.filter(m => getWorkspaceModule(m.moduleId)) : getScopedCompetitiveMistakes();
}
function mbQuestionIndex(m) {
  const mod = getWorkspaceModule(m.moduleId);
  if (!mod) return 0;
  const qs = (mod.groups || []).flatMap(g => g.questions || []);
  const i = qs.findIndex(q => (m.canonicalQId && String(q.canonicalQId) === String(m.canonicalQId)) || String(q.originalQNo) === String(m.qId));
  return i >= 0 ? i : 0;
}
function setMistakeView(key, value) {
  MistakeViewState[key] = value;
  if (key === 'allExams') MistakeViewState.topic = '';
  renderView();
}
function setMistakeSearch(value) {
  const el = document.getElementById('mbSearch');
  const pos = el && typeof el.selectionStart === 'number' ? el.selectionStart : String(value || '').length;
  MistakeViewState.search = String(value || '');
  renderView();
  const next = document.getElementById('mbSearch');
  if (next) { try { next.focus({ preventScroll: true }); next.setSelectionRange(pos, pos); } catch (_) {} }
}
function resolveMistakeEntry(actualIndex) {
  const i = Number(actualIndex);
  if (!Number.isInteger(i) || i < 0 || i >= (UserState.mistakeBook || []).length) return;
  UserState.mistakeBook.splice(i, 1);
  saveUserState();
  renderView();
}
function renderMistakeBookPage(v) {
  const source = mbSourceList();
  const scopedCount = competitiveEnabledGuard() ? getScopedCompetitiveMistakes().length : source.length;
  const workspaceCount = competitiveEnabledGuard() ? (UserState.mistakeBook || []).filter(m => getWorkspaceModule(m.moduleId)).length : source.length;
  const topics = [...new Set(source.map(m => String(m.topicTitle || 'Topic')))].sort((a, b) => a.localeCompare(b));
  if (MistakeViewState.topic && !topics.includes(MistakeViewState.topic)) MistakeViewState.topic = '';
  const term = MistakeViewState.search.trim().toLowerCase();
  const list = source.filter(m => (!MistakeViewState.topic || String(m.topicTitle || 'Topic') === MistakeViewState.topic) &&
    (!term || [m.question, m.topicTitle, m.subtopic, m.qId, m.subject, m.chapter].some(x => String(x ?? '').toLowerCase().includes(term))));
  const examLabel = (UniversalExamRegistry.registry.get(UserState.selectedExam)?.examName) || UserState.selectedExam || 'selected exam';

  v.innerHTML = `
    <div class="nav-breadcrumb"><button onclick="navigate('home')">Home</button><span class="sep">/</span><button onclick="navigate('revision_hub')">Revision</button><span class="sep">/</span><span>Mistake Book</span></div>
    <div class="section-title"><span>❌ MISTAKE BOOK (${list.length})</span><button class="btn-action-sm" onclick="navigate('home')">← Home</button></div>
    ${competitiveEnabledGuard() ? `<div class="mb-scope" role="group" aria-label="Which mistakes to show">
      <button type="button" class="filter-pill ${!MistakeViewState.allExams ? 'active' : ''}" aria-pressed="${!MistakeViewState.allExams}" onclick="setMistakeView('allExams', false)">${escapeHtml(examLabel)} (${scopedCount})</button>
      <button type="button" class="filter-pill ${MistakeViewState.allExams ? 'active' : ''}" aria-pressed="${MistakeViewState.allExams}" onclick="setMistakeView('allExams', true)">All exams (${workspaceCount})</button>
    </div>` : ''}
    ${source.length ? `<div class="search-box-wrap" style="margin-bottom:8px;"><span class="search-icon">🔍</span><input type="search" id="mbSearch" class="search-input" aria-label="Search mistakes" placeholder="Search question, topic or Q number" value="${escapeHtml(MistakeViewState.search)}" oninput="setMistakeSearch(this.value)"></div>
    ${topics.length > 1 ? `<div class="filter-bar" role="group" aria-label="Filter by topic"><button type="button" class="filter-pill ${!MistakeViewState.topic ? 'active' : ''}" onclick="setMistakeView('topic','')">All topics</button>${topics.map(t => `<button type="button" class="filter-pill ${MistakeViewState.topic === t ? 'active' : ''}" onclick="setMistakeView('topic', ${nbJsAttr(t)})">${escapeHtml(t)} (${source.filter(m => String(m.topicTitle || 'Topic') === t).length})</button>`).join('')}</div>` : ''}` : ''}
    ${!MistakeViewState.allExams && workspaceCount > scopedCount ? `<div class="dc-health warn" style="margin-bottom:10px;">${workspaceCount - scopedCount} more mistake(s) are saved under other exams. <button type="button" class="sj-inline-link" onclick="setMistakeView('allExams', true)">Show all exams</button></div>` : ''}
    ${mistakeReasonSummaryHtml(source.filter(m => !sjIsSeedMistake(m)))}
    ${source.filter(m => !sjIsSeedMistake(m)).length ? `<div class="rs-actions"><button type="button" class="btn-nav primary" onclick="navigate('revision_hub')">🔄 Revise (${reviewDue().filter(x => x.kind === 'q').length} due)</button><button type="button" class="btn-nav" onclick="sbOpenMistakeTest()">🧩 Test from my mistakes</button></div>` : ''}
    ${list.length === 0 ? `<div class="card-btn" style="text-align:center; padding:30px;"><span style="font-size:32px;">${source.length ? '🔍' : '🎉'}</span><h3 style="font-size:16px; margin:8px 0;">${source.length ? 'No mistakes match this filter' : 'No mistakes in this list'}</h3><small>${source.length ? 'Clear the search or choose another topic.' : 'Wrong answers from practice and tests are saved here automatically.'}</small></div>` : `
      <div class="grid-cards">
        ${list.map(m => {
          const actual = UserState.mistakeBook.indexOf(m);
          const sample = sjIsSeedMistake(m);
          return `
          <div class="card-btn">
            <div style="display:flex; justify-content:space-between; gap:8px; margin-bottom:6px;"><span class="mistake-badge">${sample ? 'Sample entry' : (m.rootCause === 'TEST_SIMULATION_ERROR' ? 'Wrong in a test' : 'Wrong in practice')}</span><span style="font-size:11px; color:var(--text-muted); font-weight:700;">${escapeHtml(m.savedAt || '')}</span></div>
            <strong>Q.${escapeHtml(m.qId ?? '')} • ${escapeHtml(m.topicTitle || '')} (${escapeHtml(m.subtopic || 'General')})</strong>
            <p style="font-size:13px; color:var(--text-main); margin:8px 0; font-weight:600; line-height:1.4;">${escapeHtml(m.question || '')}</p>
            <div style="font-size:12px; margin-bottom:10px;">Your Attempt: <b style="color:var(--danger);">${escapeHtml(m.userAnswer || '—')}</b> • Correct: <b style="color:var(--success);">${escapeHtml(m.correctAnswer || '—')}</b></div>
            ${sample ? '' : mistakeReasonChipsHtml(m)}
            <div style="display:flex; gap:8px;">
              ${getWorkspaceModule(m.moduleId) ? `<button class="btn-nav primary" style="flex:1; min-height:40px; font-size:12px; padding:6px;" onclick="navigate('practice', {moduleId:${nbJsAttr(m.moduleId)}, qIndex:${mbQuestionIndex(m)}})">🔁 Re-Practice</button>` : `<span class="nb-row-meta" style="flex:1;">Topic not in this workspace</span>`}
              <button class="btn-action-sm" style="min-height:40px;color:var(--success);" onclick="resolveMistakeEntry(${actual})">✓ Resolved</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    `}
  `;
}
function resolveMistake(index) { const scoped = competitiveEnabledGuard() ? getScopedCompetitiveMistakes() : UserState.mistakeBook; const item = scoped[index]; if (!item) return; const actual = UserState.mistakeBook.indexOf(item); if (actual >= 0) UserState.mistakeBook.splice(actual, 1); saveUserState(); renderView(); }

/* 5.9 4-TIER MASTERY PAGE */