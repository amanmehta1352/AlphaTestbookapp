/* =========================================================================
   V3 CBT extras (blueprint): confidence tag per answer + honest result help.
   - "How sure?"  ✅ sure · 🤔 50-50 · 🎲 guess  (optional, one tap, practice & mock)
   - Result: soft landing (improvement first) + "what if no guesses" + "sure but wrong"
   Only reads/writes ActiveTestSession.confidence; scoring is unchanged.
   ========================================================================= */
const CONF_LEVELS = [
  { id: 'sure', icon: '✅', en: 'Sure', hi: 'पक्का' },
  { id: 'doubt', icon: '🤔', en: '50-50', hi: '50-50' },
  { id: 'guess', icon: '🎲', en: 'Guess', hi: 'अंदाज़ा' }
];
function cbtConfidenceRow(q, qIndex) {
  const s = ActiveTestSession; if (!s || QuestionUI.getFormat(q) === 'SUBJECTIVE') return '';
  const key = nbQuestionKey(q); if (!s.answers[key]) return '';
  const cur = (s.confidence || {})[key] || '';
  return `<div class="cf-row" role="group" aria-label="${tx('How sure are you?','कितना पक्का?')}"><span class="cf-label">${tx('How sure?','कितना पक्का?')}</span>${CONF_LEVELS.map(c => `<button type="button" class="cf-btn ${cur === c.id ? 'on ' + c.id : ''}" aria-pressed="${cur === c.id}" onclick="setConfidence(${Number(qIndex)},'${c.id}')"><span aria-hidden="true">${c.icon}</span>${tx(c.en, c.hi)}</button>`).join('')}</div>`;
}
function setConfidence(qIndex, level) {
  const s = ActiveTestSession; if (!s) return;
  const q = s.questions[Number(qIndex)]; if (!q) return;
  const key = nbQuestionKey(q); s.confidence = s.confidence || {};
  if (s.confidence[key] === level) delete s.confidence[key]; else s.confidence[key] = level;
  saveCbtRecoveryState(); renderView();
}
function resultConfStats(res, keyFor) {
  const st = { guess: { right: 0, wrong: 0 }, doubt: { right: 0, wrong: 0 }, sure: { right: 0, wrong: 0 }, tagged: 0 };
  const conf = res.confidence || {}; if (!Object.keys(conf).length) return st;
  (res.questions || []).forEach(q => {
    const k = keyFor(q), lv = conf[k], a = res.answers?.[k]; if (!lv || !a || !st[lv]) return;
    st.tagged++; (String(a).toUpperCase() === String(q.answer || '').toUpperCase() ? st[lv].right++ : st[lv].wrong++);
  });
  return st;
}
function resultWhatIf(res, keyFor) {
  const st = resultConfStats(res, keyFor); if (!st.tagged) return '';
  const g = st.guess, sw = st.sure.wrong;
  const lines = [];
  if (g.right + g.wrong) lines.push(`<li><b>🎲 ${tx('Guesses','अंदाज़े')}:</b> ${g.right} ${tx('right','सही')} · ${g.wrong} ${tx('wrong','गलत')} — ${tx('without guesses your score would be','बिना अंदाज़े आपका score होता')} <b>${Math.max(0, (Number(res.score) || 0) - g.right)}</b></li>`);
  if (st.doubt.right + st.doubt.wrong) lines.push(`<li><b>🤔 50-50:</b> ${st.doubt.right} ${tx('right','सही')} · ${st.doubt.wrong} ${tx('wrong','गलत')}</li>`);
  if (sw) lines.push(`<li><b>✅ ${tx('Sure but wrong','पक्का था पर गलत')}:</b> ${sw} — ${tx('these show a concept gap; revise them first.','यह concept की कमी दिखाते हैं; इन्हें पहले दोहराएँ।')}</li>`);
  return `<section class="rs-card rs-whatif"><h3>${tx('What your confidence tells','आपका भरोसा क्या बताता है')}</h3><ul>${lines.join('')}</ul></section>`;
}
function resultSoftLanding(res) {
  const prev = (typeof ResultHistory !== 'undefined' ? ResultHistory : []).filter(r => r && r.moduleId === res.moduleId && r.historyId !== res.historyId && r.id !== res.historyId).slice(1, 2)[0]
    || (typeof ResultHistory !== 'undefined' ? ResultHistory : []).filter(r => r && r.moduleId === res.moduleId)[1];
  const acc = Number(res.accuracy) || 0;
  let head, sub;
  if (prev && Number(prev.accuracy) < acc) { head = tx(`Up ${acc - Number(prev.accuracy)}% from last time`, `पिछली बार से ${acc - Number(prev.accuracy)}% बेहतर`); sub = tx('Keep this rhythm.','यही रफ़्तार रखें।'); }
  else if (acc >= 80) { head = tx('Strong work','बहुत बढ़िया'); sub = tx('You are close to mastery here.','यहाँ आप महारत के करीब हैं।'); }
  else if ((Number(res.correct) || 0) > 0) { head = tx(`${res.correct} right — a base to build on`, `${res.correct} सही — आगे बढ़ने की नींव`); sub = tx('Look at the mistakes below; each one is a quick win.','नीचे गलतियाँ देखें; हर एक जल्दी सुधर सकती है।'); }
  else { head = tx('Every attempt counts','हर कोशिश गिनती है'); sub = tx('Read the solutions, then try 10 easy questions.','Solutions पढ़ें, फिर 10 आसान सवाल करें।'); }
  return `<section class="rs-card rs-land"><span class="rs-land-ico" aria-hidden="true">🌱</span><div><strong>${head}</strong><small>${sub}</small></div></section>`;
}
