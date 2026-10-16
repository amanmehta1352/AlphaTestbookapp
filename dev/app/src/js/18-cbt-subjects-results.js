/* =========================================================================
   V2.3.9 — Update 3: CBT subject strip + result improvements
   Display-only on top of the existing CBT session; answers, timer and scoring
   are untouched.
   ========================================================================= */
const SJ_SUBJECT_NAMES = { maths: 'Mathematics', science: 'General Science', reasoning: 'Reasoning', english: 'English', gk: 'General Knowledge', 'general-awareness': 'General Awareness' };
function subjectDisplayName(key) {
  const k = String(key || '').trim();
  if (!k) return 'Subject';
  if (SJ_SUBJECT_NAMES[k.toLowerCase()]) return SJ_SUBJECT_NAMES[k.toLowerCase()];
  return k.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\p{L}/gu, c => c.toUpperCase());
}
function subjectShortName(key) {
  const full = subjectDisplayName(key);
  if (full.length <= 11) return full;
  const words = full.split(/\s+/).filter(w => !/^(and|&|of|the)$/i.test(w));
  if (words.length > 1) return words.map(w => w[0]).join('').toUpperCase();
  return full.slice(0, 10) + '…';
}
function cbtQuestionSubject(i) {
  const s = ActiveTestSession;
  const q = s?.questions?.[i];
  if (!q) return '';
  const ref = (s.sourceRefs || []).find(x => String(x.canonicalQId) === String(q.canonicalQId));
  return String(ref?.subject || q.metadata?.subject || getWorkspaceModule(s.moduleId)?.subject || 'subject');
}
function cbtSubjectsInfo() {
  const s = ActiveTestSession;
  const groups = [];
  const byKey = new Map();
  (s?.questions || []).forEach((q, i) => {
    const key = cbtQuestionSubject(i);
    let g = byKey.get(key);
    if (!g) { g = { key, label: subjectDisplayName(key), short: subjectShortName(key), indices: [], answered: 0, marked: 0 }; byKey.set(key, g); groups.push(g); }
    g.indices.push(i);
    const k = nbQuestionKey(q);
    if (s.answers[k] || s.subjectiveState?.[k] === 'ATTEMPTED') g.answered++;
    if (s.marked[k]) g.marked++;
  });
  return groups;
}
function cbtSubjectStripHtml(qIndex) {
  const groups = cbtSubjectsInfo();
  if (groups.length < 2) return '';
  const cur = cbtQuestionSubject(qIndex);
  const g = groups.find(x => x.key === cur);
  const pos = g ? g.indices.indexOf(qIndex) + 1 : 0;
  return `<div class="cbt-subject-row">
      <div class="cbt-subjects" id="cbtSubjects" role="tablist" aria-label="Subjects">${groups.map((x, i) => `<button type="button" role="tab" class="cbt-subj ${x.key === cur ? 'on' : ''}" aria-selected="${x.key === cur}" title="${escapeHtml(x.label)}" onclick="cbtJumpSubject(${i})"><span>${escapeHtml(x.short)}</span><b>${x.answered}/${x.indices.length}</b></button>`).join('')}</div>
      <button type="button" class="cbt-subj-all" aria-label="All subjects" title="All subjects" onclick="cbtOpenSubjectSheet()">▾</button>
    </div>
    <div class="cbt-subject-now">${escapeHtml(g ? g.label : '')} · Q ${pos} / ${g ? g.indices.length : 0}</div>`;
}
function cbtJumpSubject(i) {
  const g = cbtSubjectsInfo()[i];
  if (!g || !ActiveTestSession) return;
  const last = ActiveTestSession.subjectLastIndex?.[g.key];
  const target = Number.isInteger(last) && g.indices.includes(last) ? last : g.indices[0];
  closeModal();
  switchQuestion(target);
}
function cbtOpenSubjectSheet() {
  const groups = cbtSubjectsInfo();
  const cur = cbtQuestionSubject(Number(Route?.params?.qIndex) || 0);
  openModal('Subjects', `<div class="sj-recent">${groups.map((g, i) => `<button type="button" class="sj-action ${g.key === cur ? 'cbt-sheet-on' : ''}" onclick="cbtJumpSubject(${i})"><span aria-hidden="true">${g.key === cur ? '▶' : '📘'}</span><span class="sj-action-copy"><strong>${escapeHtml(g.label)}</strong><small>${g.answered} of ${g.indices.length} answered${g.marked ? ` · ${g.marked} marked for review` : ''}</small></span><span class="sj-action-go" aria-hidden="true">›</span></button>`).join('')}</div>`);
}
function cbtPaletteHtml(qIndex, flatHtml) {
  const groups = cbtSubjectsInfo();
  if (groups.length < 2) return flatHtml;
  const s = ActiveTestSession;
  return groups.map(g => `<div class="palette-section-head">${escapeHtml(g.label)} <span>${g.answered}/${g.indices.length}</span></div>` + g.indices.map(idx => {
    const item = s.questions[idx];
    const isCurrent = idx === qIndex;
    const isAnswered = !!s.answers[nbQuestionKey(item)] || s.subjectiveState?.[nbQuestionKey(item)] === 'ATTEMPTED';
    const isItemMarked = !!s.marked[nbQuestionKey(item)];
    let cls = 'strip-chip';
    if (isCurrent) cls += ' active'; else if (isItemMarked) cls += ' marked'; else if (isAnswered) cls += ' answered';
    const status = isCurrent ? 'current question' : isItemMarked ? 'marked for review' : isAnswered ? 'answered' : 'not answered';
    return `<button type="button" class="${cls}" onclick="switchQuestion(${idx})" aria-label="Question ${idx + 1}, ${escapeHtml(g.label)}, ${status}" ${isCurrent ? 'aria-current="step"' : ''}>${idx + 1}</button>`;
  }).join('')).join('');
}
function cbtInlineToast(text) {
  const vp = document.getElementById('cbtViewport');
  if (!vp) return;
  let t = document.getElementById('cbtToast');
  if (!t) { t = document.createElement('div'); t.id = 'cbtToast'; t.className = 'cbt-toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); vp.appendChild(t); }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(cbtInlineToast._h);
  cbtInlineToast._h = setTimeout(() => t.classList.remove('show'), 1800);
}
function cbtAfterRender(qIndex) {
  const s = ActiveTestSession;
  if (!s) return;
  const cur = cbtQuestionSubject(qIndex);
  s.subjectLastIndex = s.subjectLastIndex || {};
  const prev = s.__lastRenderedIndex;
  if (Number.isInteger(prev) && qIndex === prev + 1 && cbtQuestionSubject(prev) !== cur && cbtSubjectsInfo().length > 1) cbtInlineToast(`Next section: ${subjectDisplayName(cur)}`);
  s.subjectLastIndex[cur] = qIndex;
  s.__lastRenderedIndex = qIndex;
  const strip = document.getElementById('cbtSubjects');
  const on = strip?.querySelector('.cbt-subj.on');
  if (strip && on) {
    const left = on.offsetLeft - (strip.clientWidth - on.offsetWidth) / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: "instant" });
    strip.classList.toggle('more-right', strip.scrollWidth - strip.scrollLeft - strip.clientWidth > 4);
    strip.classList.toggle('more-left', strip.scrollLeft > 4);
    strip.onscroll = () => { strip.classList.toggle('more-right', strip.scrollWidth - strip.scrollLeft - strip.clientWidth > 4); strip.classList.toggle('more-left', strip.scrollLeft > 4); };
  }
}

/* ---------- Result page additions ---------- */
let ResultViewState = null;
function resultRecordFor(res) {
  if (res?.historyId) return ResultHistory.find(r => r.id === res.historyId) || null;
  if (res?.fromHistory && res.id) return ResultHistory.find(r => r.id === res.id) || res;
  return null;
}
function resultKeyFor(res, q) { return res.sessionContractVersion === 1 ? String(q.canonicalQId || '') : String(q.originalQNo ?? ''); }
function resultSubjectOf(res, q) {
  const ref = (res.sourceRefs || []).find(x => String(x.canonicalQId) === String(q.canonicalQId));
  return String(ref?.subject || q.metadata?.subject || getWorkspaceModule(res.moduleId)?.subject || 'subject');
}
function resultFormatSec(sec) {
  const n = Math.max(0, Math.round(Number(sec) || 0));
  return n >= 60 ? `${Math.floor(n / 60)}m ${String(n % 60).padStart(2, '0')}s` : `${n}s`;
}
function resultWrongIds(res) {
  return (res.questions || []).filter(q => {
    if (QuestionUI.getFormat(q) === 'SUBJECTIVE') return false;
    const a = res.answers?.[resultKeyFor(res, q)];
    return a && String(a).toUpperCase() !== String(q.answer || '').toUpperCase();
  }).map(q => String(q.canonicalQId || ''));
}
function resultRetake() {
  const res = ResultViewState;
  if (!res) return;
  const rec = resultRecordFor(res);
  if (res.sessionContractVersion === 1) {
    const ids = (res.questions || []).map(q => String(q.canonicalQId || ''));
    const minutes = Math.round((Number(rec?.durationSeconds) || ids.length * 60) / 60);
    sbLaunch(ids, minutes, res.langMode || 'both', res.topicTitle || 'Custom Test');
  } else {
    initTestSession(res.moduleId, res.groupId, 0);
  }
}
function resultRetryWrong() {
  const res = ResultViewState;
  if (!res) return;
  const ids = resultWrongIds(res);
  if (!ids.length) { openCustomToast('There are no wrong answers in this test.'); return; }
  sbLaunch(ids, ids.length, res.langMode || 'both', 'Retry: wrong answers');
}
function resultEnhance(v, res) {
  ResultViewState = res;
  const rec = resultRecordFor(res);
  const qs = res.questions || [];
  // Subject-wise
  const subj = new Map();
  qs.forEach(q => {
    const key = resultSubjectOf(res, q);
    const x = subj.get(key) || { key, total: 0, correct: 0, wrong: 0, skipped: 0 };
    x.total++;
    const a = res.answers?.[resultKeyFor(res, q)];
    if (QuestionUI.getFormat(q) === 'SUBJECTIVE' || !a) x.skipped++;
    else if (String(a).toUpperCase() === String(q.answer || '').toUpperCase()) x.correct++; else x.wrong++;
    subj.set(key, x);
  });
  const subjRows = [...subj.values()];
  const subjHtml = `<section class="rs-card"><h3>Score by subject</h3><div class="rs-table" role="table" aria-label="Score by subject">
    <div class="rs-tr rs-th" role="row"><span role="columnheader">Subject</span><span role="columnheader">Score</span><span role="columnheader">✓</span><span role="columnheader">✗</span><span role="columnheader">Skip</span><span role="columnheader">Accuracy</span></div>
    ${subjRows.map(x => { const acc = x.correct + x.wrong ? Math.round(x.correct / (x.correct + x.wrong) * 100) : null; return `<div class="rs-tr" role="row"><span role="cell">${escapeHtml(subjectDisplayName(x.key))}</span><span role="cell"><b>${x.correct}/${x.total}</b></span><span role="cell" class="rs-ok">${x.correct}</span><span role="cell" class="rs-bad">${x.wrong}</span><span role="cell">${x.skipped}</span><span role="cell">${acc === null ? '—' : acc + '%'}</span></div>`; }).join('')}
  </div><p class="sj-note sj-muted">Accuracy = correct ÷ answered. Skipped questions are not counted as wrong.</p></section>`;
  // Compare with the previous attempt of the same test
  let compareHtml = '';
  if (rec) {
    const sameTest = r => r.id !== rec.id && r.ws === rec.ws && (rec.questionSequenceFingerprint ? r.questionSequenceFingerprint === rec.questionSequenceFingerprint : (!r.questionSequenceFingerprint && r.moduleId === rec.moduleId && r.groupId === rec.groupId)) && String(r.ts) < String(rec.ts);
    const prev = ResultHistory.find(sameTest);
    if (prev) {
      const d = (Number(rec.score) || 0) - (Number(prev.score) || 0);
      compareHtml = `<section class="rs-card rs-compare"><h3>Compared with your last attempt</h3><div class="rs-cmp"><div><small>Last time · ${escapeHtml(sjFormatWhen(prev.ts))}</small><b>${Number(prev.score) || 0}/${Number(prev.total) || 0}</b><span>${Number(prev.accuracy) || 0}% accuracy</span></div><div class="rs-arrow ${d > 0 ? 'up' : d < 0 ? 'down' : ''}" aria-hidden="true">${d > 0 ? '▲' : d < 0 ? '▼' : '='}</div><div><small>This time</small><b>${Number(rec.score) || 0}/${Number(rec.total) || 0}</b><span>${Number(rec.accuracy) || 0}% accuracy</span></div></div><p class="sj-note">${d > 0 ? `${d} more correct than last time.` : d < 0 ? `${-d} fewer correct than last time.` : 'Same score as last time.'}</p></section>`;
    }
  }
  // Time per question
  let timeHtml = '';
  const secs = Array.isArray(rec?.perQuestionSec) ? rec.perQuestionSec : null;
  if (secs && secs.some(x => Number(x) > 0)) {
    const used = secs.reduce((a, b) => a + (Number(b) || 0), 0);
    const items = qs.map((q, i) => ({ i, q, sec: Number(secs[i]) || 0 })).filter(x => x.sec > 0).sort((a, b) => b.sec - a.sec).slice(0, 3);
    timeHtml = `<section class="rs-card"><h3>Time</h3><p class="sj-note">Total time on questions: <b>${resultFormatSec(used)}</b> · average <b>${resultFormatSec(used / Math.max(1, qs.length))}</b> per question.</p>
      <div class="sb-label" style="margin-top:10px;">Slowest questions</div>
      <div class="sj-recent">${items.map(x => { const a = res.answers?.[resultKeyFor(res, x.q)]; const st = !a ? 'Skipped' : String(a).toUpperCase() === String(x.q.answer || '').toUpperCase() ? 'Correct' : 'Wrong'; return `<div class="sj-action" style="cursor:default"><span aria-hidden="true">⏱️</span><span class="sj-action-copy"><strong>Q.${x.i + 1} · ${resultFormatSec(x.sec)}</strong><small>${st} · ${escapeHtml((x.q.QUESTION_EN || x.q.QUESTION_HI || '').slice(0, 80))}</small></span></div>`; }).join('')}</div></section>`;
  }
  const wrongN = resultWrongIds(res).length;
  const actionsHtml = `<div class="rs-actions"><button type="button" class="btn-nav primary" onclick="resultRetake()">↻ Retake this test</button>${wrongN ? `<button type="button" class="btn-nav" onclick="resultRetryWrong()">✗ Retry ${wrongN} wrong answer${wrongN === 1 ? '' : 's'}</button>` : ''}</div>`;
  const anchor = v.querySelector('.goals-grid');
  if (anchor) anchor.insertAdjacentHTML('afterend', actionsHtml + compareHtml + (subjRows.length > 1 || res.sessionContractVersion === 1 ? subjHtml : '') + timeHtml);
  // Time chip on each solution card
  if (secs) {
    const title = [...v.querySelectorAll('.section-title')].find(x => /Detailed Question Solutions/.test(x.textContent));
    let el = title?.nextElementSibling, i = 0;
    while (el && i < qs.length) {
      if (el.classList.contains('card-btn')) {
        const head = el.firstElementChild;
        if (head && Number(secs[i]) > 0) head.insertAdjacentHTML('beforeend', `<span class="rs-time">⏱ ${resultFormatSec(secs[i])}</span>`);
        i++;
      }
      el = el.nextElementSibling;
    }
  }
}
function sbGroupBySubject(rows) {
  const order = [...new Set(rows.map(r => r.subject))].sort((a, b) => subjectDisplayName(a).localeCompare(subjectDisplayName(b)));
  if (order.length < 2) return rows;
  return order.flatMap(s => rows.filter(r => r.subject === s));
}
