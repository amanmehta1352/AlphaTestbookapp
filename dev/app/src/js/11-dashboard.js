/* =========================================================================
   V2.4.0 — Update 4 · Stage C: Glass bento dashboard + Pomodoro
   Every number comes from AttemptHistory / ResultHistory / ReviewState /
   StudySettings. Nothing is estimated or invented.
   ========================================================================= */
const STUDY_SETTINGS_KEY = 'master_student_journey_v90_study_settings';
let StudySettings = { v: 1, dailyGoal: null, examDate: '', lastBackupAt: '', pomo: { focus: 25, brk: 5 }, focusLog: {}, pomoState: null };
async function hydrateStudySettings() {
  try {
    const s = parseStored(await AppStorage.getRaw(STUDY_SETTINGS_KEY), null, STUDY_SETTINGS_KEY);
    if (s && s.v === 1) StudySettings = { ...StudySettings, ...s, pomo: { focus: 25, brk: 5, ...(s.pomo || {}) }, focusLog: s.focusLog || {} };
  } catch (e) { console.warn('[Settings] unreadable; defaults used', e); }
  pomoTick();
}
function saveStudySettings() {
  const s = JSON.stringify(StudySettings);
  return StorageWriteQueue.enqueue(() => AppStorage.setRawDirect(STUDY_SETTINGS_KEY, s)).catch(e => console.warn('[Settings] save failed', e));
}

/* ---------- derived metrics ---------- */
function sjDayDiff(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }
function sjStreak() {
  const days = learningStats().byDay;
  const today = sjLocalDay();
  let cur = days.has(today) ? today : sjAddDays(today, -1);
  let streak = 0;
  while (days.has(cur)) { streak++; cur = sjAddDays(cur, -1); }
  const sorted = [...days.keys()].filter(Boolean).sort();
  let best = 0, run = 0, prev = '';
  sorted.forEach(d => { run = prev && sjDayDiff(prev, d) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = d; });
  return { streak, best, activeToday: days.has(today) };
}
function sjWeekStart(day) { const d = new Date(day + 'T00:00:00'); const wd = (d.getDay() + 6) % 7; return sjAddDays(day, -wd); }
function sjWeekly() {
  const st = learningStats(); const today = sjLocalDay();
  const thisStart = sjWeekStart(today), lastStart = sjAddDays(thisStart, -7);
  const sum = (from, to) => { let a = 0, c = 0, s = 0; st.byDay.forEach((v, k) => { if (k >= from && k <= to) { a += v.answered; c += v.correct; s += v.sec; } }); return { a, c, s, acc: a ? Math.round(c / a * 100) : null }; };
  const ws = WorkspaceManager.current().id;
  const tests = (from, to) => ResultHistory.filter(r => r.ws === ws && r.day >= from && r.day <= to).length;
  return { thisW: { ...sum(thisStart, today), t: tests(thisStart, today) }, lastW: { ...sum(lastStart, sjAddDays(thisStart, -1)), t: tests(lastStart, sjAddDays(thisStart, -1)) } };
}
function sjCoverage() {
  const ws = WorkspaceManager.current().id;
  const bank = new Set();
  WorkspaceManager.filterModules(AppModules || []).forEach(m => (m.groups || []).forEach(g => (g.questions || []).forEach(q => bank.add(String(q.canonicalQId || '')))));
  let done = 0; learningStats(ws).unique.forEach(id => { if (bank.has(id)) done++; });
  return { done, total: bank.size };
}
function sjFmtMin(sec) { const m = Math.round((Number(sec) || 0) / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; }

/* ---------- goal / exam date ---------- */
function sjOpenGoalSettings() {
  openModal('🎯 Daily goal & exam date', `
    <label class="sb-label" for="gxGoal" style="margin-top:0;">Questions per day</label>
    <div class="sb-chips">${[20, 30, 50, 75, 100].map(n => `<button type="button" class="sb-chip ${StudySettings.dailyGoal === n ? 'on' : ''}" onclick="document.getElementById('gxGoal').value=${n}">${n}</button>`).join('')}</div>
    <input id="gxGoal" type="number" inputmode="numeric" min="1" max="500" class="search-input" style="padding-left:14px;margin:8px 0 0;" value="${StudySettings.dailyGoal || ''}" placeholder="e.g. 50">
    <label class="sb-label" for="gxExamDate">Exam date (optional)</label>
    <input id="gxExamDate" type="date" class="search-input" style="padding-left:14px;margin:0;" value="${escapeHtml(StudySettings.examDate || '')}">
    <p class="sj-note sj-muted">Goal counts every question you answer in Practice, Tests, Learn and Revision.</p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap;"><button class="btn-nav" onclick="closeModal()">Cancel</button>${StudySettings.dailyGoal ? '<button class="btn-nav" onclick="sjSaveGoal(true)">Remove goal</button>' : ''}<button class="btn-nav primary" onclick="sjSaveGoal(false)">Save</button></div>`);
}
function sjSaveGoal(remove) {
  if (remove) { StudySettings.dailyGoal = null; }
  else {
    const n = Math.round(Number(document.getElementById('gxGoal')?.value));
    StudySettings.dailyGoal = Number.isFinite(n) && n >= 1 ? Math.min(500, n) : null;
    const d = String(document.getElementById('gxExamDate')?.value || '');
    StudySettings.examDate = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
  }
  saveStudySettings(); closeModal(); renderView();
}

/* ---------- Pomodoro (real timer; only completed focus sessions count) ---------- */
let PomoInterval = null;
function pomoState() {
  if (!StudySettings.pomoState) StudySettings.pomoState = { phase: 'focus', running: false, endAt: 0, remaining: (StudySettings.pomo.focus || 25) * 60 };
  return StudySettings.pomoState;
}
function pomoPhaseLength(phase) { return (phase === 'focus' ? (StudySettings.pomo.focus || 25) : (StudySettings.pomo.brk || 5)) * 60; }
function pomoRemaining() { const p = pomoState(); return p.running ? Math.max(0, Math.ceil((p.endAt - Date.now()) / 1000)) : Math.max(0, p.remaining); }
function pomoStart() { const p = pomoState(); if (p.running) return; p.endAt = Date.now() + pomoRemaining() * 1000; p.running = true; saveStudySettings(); pomoEnsureTimer(); pomoPaint(); }
function pomoPause() { const p = pomoState(); if (!p.running) return; p.remaining = pomoRemaining(); p.running = false; saveStudySettings(); pomoPaint(); }
function pomoReset() { const p = pomoState(); p.running = false; p.remaining = pomoPhaseLength(p.phase); saveStudySettings(); pomoPaint(); }
function pomoSwitch(phase) { const p = pomoState(); p.phase = phase; p.running = false; p.remaining = pomoPhaseLength(phase); saveStudySettings(); renderView(); }
function pomoSetLength(kind, min) { StudySettings.pomo[kind] = min; const p = pomoState(); if (!p.running && ((kind === 'focus' && p.phase === 'focus') || (kind === 'brk' && p.phase === 'break'))) p.remaining = min * 60; saveStudySettings(); renderView(); }
function pomoComplete() {
  const p = pomoState();
  const finished = p.phase;
  if (finished === 'focus') { const day = sjLocalDay(new Date(p.endAt || Date.now())); StudySettings.focusLog[day] = (Number(StudySettings.focusLog[day]) || 0) + pomoPhaseLength('focus'); }
  p.phase = finished === 'focus' ? 'break' : 'focus'; p.running = false; p.remaining = pomoPhaseLength(p.phase);
  saveStudySettings();
  try { navigator.vibrate && navigator.vibrate([180, 80, 180]); } catch (_) {}
  const msg = finished === 'focus' ? tx('Focus session complete — take a short break.','Focus session पूरा — थोड़ा आराम करें।') : tx('Break over — ready for the next focus session?','आराम पूरा — अगले focus session के लिए तैयार?');
  if (Route?.page === 'test') cbtInlineToast(msg); else if (Route?.page === 'home') { renderView(); sjFlash(msg); } else openCustomToast(msg);
}
function pomoTick() {
  const p = pomoState();
  if (p.running && Date.now() >= p.endAt) pomoComplete();
  pomoPaint();
  if (p.running) pomoEnsureTimer(); else if (PomoInterval) { clearInterval(PomoInterval); PomoInterval = null; }
}
function pomoEnsureTimer() { if (!PomoInterval) PomoInterval = setInterval(pomoTick, 1000); }
function pomoPaint() {
  const el = document.getElementById('gxPomoTime'); if (!el) return;
  const p = pomoState(); const r = pomoRemaining(); const len = pomoPhaseLength(p.phase);
  el.textContent = `${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`;
  const ring = document.getElementById('gxPomoRing'); if (ring) ring.style.strokeDashoffset = String(264 * (r / Math.max(1, len)));
  const btn = document.getElementById('gxPomoBtn'); if (btn) { btn.textContent = p.running ? tx('Pause','रोकें') : (r < len ? tx('Resume','जारी रखें') : tx('Start','शुरू')); btn.onclick = p.running ? pomoPause : pomoStart; }
}
function sjFlash(text) {
  const host = document.querySelector('.gx'); if (!host) return;
  let t = document.getElementById('gxFlash');
  if (!t) { t = document.createElement('div'); t.id = 'gxFlash'; t.className = 'gx-flash'; t.setAttribute('role', 'status'); host.prepend(t); }
  t.textContent = text; t.classList.add('show'); clearTimeout(sjFlash._h); sjFlash._h = setTimeout(() => t.classList.remove('show'), 4000);
}

/* ---------- one-tap tests ---------- */
function sjPickIds(rows, n) {
  const ws = WorkspaceManager.current().id;
  const seen = new Set(AttemptHistory.filter(a => a.ws === ws).map(a => a.cid));
  const wrong = sbWrongIds();
  const score = r => (wrong.has(r.id) ? 0 : !seen.has(r.id) ? 1 : 2);
  return sbShuffle(rows).sort((a, b) => score(a) - score(b)).slice(0, n).map(r => r.id);
}
function sjTopicTest(moduleId) {
  SBCache = null;
  const rows = sbAll().filter(r => r.mod.moduleId === moduleId);
  if (!rows.length) { openCustomToast('This topic has no questions available for a test.'); return; }
  const ctx = sbContexts(rows)[0];
  const ids = sjPickIds(rows.filter(r => r.examId === ctx.examId && r.year === ctx.year), 10);
  sbLaunch(ids, ids.length, 'both', `Topic test · ${getWorkspaceModule(moduleId)?.topicTitle || 'Topic'}`);
}
function sjMiniTestRows() {
  SBCache = null;
  const all = sbAll(); if (!all.length) return [];
  const wrong = sbWrongIds();
  const weakMods = new Set(WorkspaceManager.filterModules(AppModules || []).map(m => ({ m, x: masteryFor(m.moduleId) })).filter(o => o.x.enough && o.x.score < 0.7).map(o => o.m.moduleId));
  const pref = all.filter(r => wrong.has(r.id) || weakMods.has(r.mod.moduleId));
  const base = pref.length >= 5 ? pref : all;
  const ctx = sbContexts(base)[0];
  return base.filter(r => r.examId === ctx.examId && r.year === ctx.year);
}
function sjMiniTest() {
  const rows = sjMiniTestRows();
  if (!rows.length) { openCustomToast('No questions available yet.'); return; }
  const ids = sjPickIds(rows, 10);
  sbLaunch(ids, ids.length, 'both', 'Daily mini test');
}

/* ---------- widgets ---------- */
function gxRing(pct, size, id, label, sub) {
  const r = 42, c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, pct)));
  return `<svg class="gx-ring" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="${escapeHtml(label)} ${escapeHtml(sub || '')}">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--gx-blue)"/><stop offset="1" stop-color="var(--gx-purple)"/></linearGradient></defs>
    <circle cx="50" cy="50" r="${r}" class="gx-ring-track"/>
    <circle cx="50" cy="50" r="${r}" class="gx-ring-val" stroke="url(#${id})" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
    <text x="50" y="49" class="gx-ring-big">${escapeHtml(label)}</text><text x="50" y="64" class="gx-ring-small">${escapeHtml(sub || '')}</text></svg>`;
}
function gxGoalWidget(d) {
  const goal = StudySettings.dailyGoal;
  if (!goal) return `<section class="gx-card gx-goal"><div class="gx-head"><h2>${tx('Daily goal','दैनिक लक्ष्य')}</h2></div><div class="gx-empty"><strong>${tx('No goal set','कोई लक्ष्य नहीं')}</strong><span>${tx('Choose how many questions you want to answer each day.','चुनें कि आप रोज़ कितने सवाल हल करना चाहते हैं।')}</span><button type="button" class="gx-btn" onclick="sjOpenGoalSettings()">${tx('Set a goal','लक्ष्य रखें')}</button></div></section>`;
  const pct = d.answered / goal;
  return `<section class="gx-card gx-goal"><div class="gx-head"><h2>${tx('Daily goal','दैनिक लक्ष्य')}</h2><button type="button" class="gx-link" onclick="sjOpenGoalSettings()">${tx('Edit','बदलें')}</button></div>
    <div class="gx-goal-body">${gxRing(pct, 128, 'gxGoalGrad', `${Math.round(Math.min(1, pct) * 100)}%`, `${d.answered} / ${goal}`)}
    <p>${d.answered >= goal ? tx('🎉 Goal reached today!','🎉 आज का लक्ष्य पूरा!') : tx(`${goal - d.answered} more question${goal - d.answered === 1 ? '' : 's'} today`, `आज ${goal - d.answered} सवाल और`)}</p></div></section>`;
}
function gxStreakWidget() {
  const s = sjStreak(); const days = learningStats().byDay; const today = sjLocalDay();
  const start = sjAddDays(sjWeekStart(today), -49); // 8 weeks, Monday-first
  let cells = '';
  for (let w = 0; w < 8; w++) for (let dd = 0; dd < 7; dd++) {
    const day = sjAddDays(start, w * 7 + dd);
    const n = days.get(day)?.answered || 0;
    const lvl = day > today ? 'f' : n === 0 ? 0 : n < 10 ? 1 : n < 30 ? 2 : 3;
    cells += `<span class="gx-cell l${lvl}" style="grid-column:${w + 1};grid-row:${dd + 1}" title="${escapeHtml(new Date(day + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}: ${n} ${tx('answered','हल किए')}"></span>`;
  }
  return `<section class="gx-card gx-streak"><div class="gx-head"><h2>${tx('Daily streak','लगातार दिन')}</h2><span class="gx-chip">${tx(`Best ${s.best} day${s.best === 1 ? '' : 's'}`,`सबसे ज़्यादा ${s.best} दिन`)}</span></div>
    <div class="gx-streak-top"><b>${s.streak}</b><span>${tx(`day${s.streak === 1 ? '' : 's'} in a row`,'दिन लगातार')}${s.streak && !s.activeToday ? tx(' · answer a question today to keep it',' · इसे बनाए रखने के लिए आज एक सवाल हल करें') : ''}</span></div>
    <div class="gx-cal" role="img" aria-label="${tx('Activity calendar for the last 8 weeks','पिछले 8 हफ़्तों का calendar')}">${cells}</div>
    <div class="gx-legend"><span>${tx('Less','कम')}</span><i class="gx-cell l0"></i><i class="gx-cell l1"></i><i class="gx-cell l2"></i><i class="gx-cell l3"></i><span>${tx('More','ज़्यादा')}</span></div></section>`;
}
function gxTrendWidget(results) {
  const pts = results.slice(0, 10).reverse();
  if (pts.length < 2) return `<section class="gx-card gx-trend"><div class="gx-head"><h2>${tx('Score trend','Score की रेखा')}</h2></div><div class="gx-empty"><strong>${pts.length ? tx('One test so far','अभी एक ही test') : tx('No tests yet','अभी कोई test नहीं')}</strong><span>${tx('Submit at least two tests to see your accuracy trend.','Accuracy की रेखा देखने के लिए कम से कम दो test दें।')}</span><button type="button" class="gx-btn" onclick="navigate('native_builder')">${tx('Build a test','Test बनाएँ')}</button></div></section>`;
  const W = 320, H = 140, L = 30, R = 10, T = 12, B = 22;
  const x = i => L + (W - L - R) * (i / (pts.length - 1));
  const y = v => T + (H - T - B) * (1 - v / 100);
  const line = pts.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(Number(r.accuracy) || 0).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const last = pts[pts.length - 1];
  const dots = pts.map((r, i) => `<g class="gx-pt" tabindex="0" role="button" aria-label="${escapeHtml(r.topicTitle || 'Test')}: ${Number(r.accuracy) || 0}% on ${escapeHtml(sjFormatWhen(r.ts))}" onclick="gxTrendInfo(${i})" onkeydown="if(event.key==='Enter')gxTrendInfo(${i})"><circle cx="${x(i).toFixed(1)}" cy="${y(Number(r.accuracy) || 0).toFixed(1)}" r="14" class="gx-hit"/><circle cx="${x(i).toFixed(1)}" cy="${y(Number(r.accuracy) || 0).toFixed(1)}" r="4.5" class="gx-dot"/><title>${escapeHtml(r.topicTitle || 'Test')} · ${Number(r.accuracy) || 0}% · ${escapeHtml(sjFormatWhen(r.ts))}</title></g>`).join('');
  gxTrendInfo.pts = pts;
  return `<section class="gx-card gx-trend"><div class="gx-head"><h2>${tx('Score trend','Score की रेखा')}</h2><span class="gx-chip">${tx(`Last ${pts.length} tests · accuracy`,`पिछले ${pts.length} test · accuracy`)}</span></div>
    <svg class="gx-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Accuracy of your last ${pts.length} tests">
      <defs><linearGradient id="gxArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--gx-blue)" stop-opacity=".35"/><stop offset="1" stop-color="var(--gx-purple)" stop-opacity="0"/></linearGradient></defs>
      ${[0, 50, 100].map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="gx-grid"/><text x="${L - 6}" y="${y(v) + 3}" class="gx-axis" text-anchor="end">${v}%</text>`).join('')}
      <path d="${area}" fill="url(#gxArea)"/><path d="${line}" class="gx-line"/>${dots}
      <text x="${x(pts.length - 1) - 6}" y="${y(Number(last.accuracy) || 0) - 10}" class="gx-lastlabel" text-anchor="end">${Number(last.accuracy) || 0}%</text>
    </svg><p class="gx-note" id="gxTrendNote">${tx('Tap a point for details.','जानकारी के लिए किसी बिंदु पर tap करें।')}</p></section>`;
}
function gxTrendInfo(i) {
  const r = (gxTrendInfo.pts || [])[i];
  const el = document.getElementById("gxTrendNote");
  if (r && el)
    el.textContent = `${r.topicTitle || "Test"} · ${Number(r.score) || 0}/${Number(r.total) || 0} · ${Number(r.accuracy) || 0}% · ${sjFormatWhen(r.ts)}`;
}
function gxRevisionWidget() {
  const due = reviewDue();
  return `<section class="gx-card gx-rev"><div class="gx-head"><h2>${tx("Spaced revision", "दोहराई (Revision)")}</h2><span class="gx-chip">${tx(`${due.length} due today`, `आज ${due.length} बाकी`)}</span></div>
    ${
      due.length
        ? `<ul class="gx-tasks">${due
            .slice(0, 4)
            .map(
              (it) =>
                `<li><span class="gx-task-dot ${it.kind}" aria-hidden="true"></span><span class="gx-task-txt"><strong>${escapeHtml(it.kind === "q" ? (it.q.QUESTION_EN || it.q.QUESTION_HI || "").slice(0, 70) : it.fc.front.slice(0, 70))}</strong><small>${it.kind === "q" ? tx("Past mistake", "पुरानी गलती") : "Flashcard"} · ${escapeHtml(it.mod.topicTitle || "")}${it.isNew ? tx(" · new", " · नया") : ""}</small></span></li>`,
            )
            .join(
              "",
            )}</ul>${due.length > 4 ? `<p class="gx-note">+${due.length - 4} ${tx("more", "और")}</p>` : ""}<button type="button" class="gx-btn" onclick="navigate('revision_hub');revisionStart(null)">${tx("Start revision →", "दोहराई शुरू करें →")}</button>`
        : `<div class="gx-empty"><strong>${tx("All caught up", "सब पूरा")}</strong><span>${reviewUpcoming(7) ? tx(`${reviewUpcoming(7)} card(s) come back in the next 7 days.`, `अगले 7 दिनों में ${reviewUpcoming(7)} card लौटेंगे।`) : tx("Wrong answers become revision cards automatically.", "गलत जवाब अपने-आप revision cards बन जाते हैं।")}</span></div>`
    }</section>`;
}
function gxPomodoroWidget() {
  const p = pomoState();
  const r = pomoRemaining();
  const len = pomoPhaseLength(p.phase);
  const focusToday = Number(StudySettings.focusLog[sjLocalDay()]) || 0;
  const lenChip = (kind, m) =>
    `<button type="button" class="gx-mini ${StudySettings.pomo[kind] === m ? "on" : ""}" ${p.running ? "disabled" : ""} onclick="pomoSetLength('${kind}', ${m})">${m}m</button>`;
  return `<section class="gx-card gx-pomo"><div class="gx-head"><h2>Pomodoro</h2><span class="gx-chip">${tx("Focus today", "आज focus")} ${sjFmtMin(focusToday)}</span></div>
    <div class="gx-seg" role="group" aria-label="Timer mode"><button type="button" class="${p.phase === "focus" ? "on" : ""}" ${p.running ? "disabled" : ""} onclick="pomoSwitch('focus')">${tx("Focus", "पढ़ाई")}</button><button type="button" class="${p.phase === "break" ? "on" : ""}" ${p.running ? "disabled" : ""} onclick="pomoSwitch('break')">${tx("Break", "आराम")}</button></div>
    <div class="gx-pomo-body">
      <svg viewBox="0 0 100 100" width="132" height="132" class="gx-ring" aria-hidden="true"><defs><linearGradient id="gxPomoGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--gx-purple)"/><stop offset="1" stop-color="var(--gx-blue)"/></linearGradient></defs><circle cx="50" cy="50" r="42" class="gx-ring-track"/><circle id="gxPomoRing" cx="50" cy="50" r="42" class="gx-ring-val" stroke="url(#gxPomoGrad)" stroke-dasharray="264" stroke-dashoffset="${((264 * r) / Math.max(1, len)).toFixed(1)}"/></svg>
      <div class="gx-pomo-time" id="gxPomoTime" role="timer" aria-live="off">${String(Math.floor(r / 60)).padStart(2, "0")}:${String(r % 60).padStart(2, "0")}</div>
    </div>
    <div class="gx-pomo-ctl"><button type="button" class="gx-btn" id="gxPomoBtn" onclick="${p.running ? "pomoPause()" : "pomoStart()"}">${p.running ? tx("Pause", "रोकें") : r < len ? tx("Resume", "जारी रखें") : tx("Start", "शुरू")}</button><button type="button" class="gx-btn ghost" onclick="pomoReset()">${tx("Reset", "दोबारा")}</button></div>
    <div class="gx-pomo-len"><span>${tx("Focus", "पढ़ाई")}</span>${[15, 25, 50].map((m) => lenChip("focus", m)).join("")}<span>${tx("Break", "आराम")}</span>${[5, 10].map((m) => lenChip("brk", m)).join("")}</div>
    <p class="gx-note">${tx("Only completed focus sessions are added to your focus time.", "सिर्फ़ पूरे हुए focus sessions ही focus time में जुड़ते हैं।")}</p></section>`;
}
function gxTodayWidget(d) {
  const st = learningStats();
  const today = st.byDay.get(sjLocalDay()) || { sec: 0 };
  const focus = Number(StudySettings.focusLog[sjLocalDay()]) || 0;
  return `<section class="gx-card gx-today"><div class="gx-head"><h2>${tx("Today", "आज")}</h2><span class="gx-chip">${escapeHtml(new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" }))}</span></div>
    <div class="sj-hero-stats gx-stats" role="list">
      <div role="listitem"><b>${d.answered}</b><span>${tx("Answered today", "आज हल किए")}</span></div>
      <div role="listitem"><b>${d.accuracy === null ? "—" : d.accuracy + "%"}</b><span>${tx("Accuracy today", "आज की accuracy")}</span></div>
      <div role="listitem"><b>${d.resultsToday.length}</b><span>${tx("Tests today", "आज के test")}</span></div>
      <div role="listitem"><b>${sjFmtMin(today.sec)}</b><span>${tx("Answering time", "जवाब का समय")}</span></div>
      <div role="listitem"><b>${sjFmtMin(focus)}</b><span>${tx("Focus time", "Focus समय")}</span></div>
      <div role="listitem"><b>${d.realMistakes.length + d.otherExamMistakes}</b><span>${tx("Mistakes saved", "सहेजी गलतियाँ")}</span></div>
    </div>
    <p class="gx-note">${tx("Accuracy = correct ÷ answered. Answering time counts at most 10 minutes per question.", "Accuracy = सही ÷ हल किए। हर सवाल पर अधिकतम 10 मिनट ही गिने जाते हैं।")}</p></section>`;
}
function gxSubjectWidget() {
  const st = learningStats();
  const rows = [...st.bySubject.values()]
    .filter((x) => x.answered > 0)
    .sort((a, b) => b.answered - a.answered)
    .slice(0, 6);
  if (!rows.length)
    return `<section class="gx-card gx-subj"><div class="gx-head"><h2>${tx("Accuracy by subject", "विषय-वार accuracy")}</h2></div><div class="gx-empty"><strong>${tx("No answers yet", "अभी कोई जवाब नहीं")}</strong><span>${tx("Practice or take a test to see accuracy by subject.", "विषय-वार accuracy देखने के लिए practice करें या test दें।")}</span></div></section>`;
  return `<section class="gx-card gx-subj"><div class="gx-head"><h2>${tx("Accuracy by subject", "विषय-वार accuracy")}</h2><span class="gx-chip">${tx("All time", "अब तक")}</span></div><div class="gx-bars">${rows
    .map((r) => {
      const acc = Math.round((r.correct / r.answered) * 100);
      const few = r.answered < 5;
      return `<div class="gx-bar"><span class="gx-bar-l">${escapeHtml(subjectDisplayName(r.subject))}</span><span class="gx-bar-t" aria-hidden="true"><span style="width:${Math.max(3, acc)}%"></span></span><span class="gx-bar-v">${acc}%<small>${r.answered} ${tx("ans", "जवाब")}${few ? tx(" · few", " · कम") : ""}</small></span></div>`;
    })
    .join(
      "",
    )}</div><p class="gx-note">${tx('"few" = under 5 answers, not enough to judge.', '"कम" = 5 से कम जवाब, अभी अंदाज़ा लगाना ठीक नहीं।')}</p></section>`;
}
function gxWeeklyWidget() {
  const w = sjWeekly();
  const delta = (a, b, unit = "") => {
    if (b === null || a === null) return "";
    const d = a - b;
    return d === 0
      ? '<em class="eq">=</em>'
      : `<em class="${d > 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"} ${Math.abs(d)}${unit}</em>`;
  };
  return `<section class="gx-card gx-week"><div class="gx-head"><h2>${tx("This week", "इस हफ़्ते")}</h2><span class="gx-chip">${tx("vs last week", "पिछले हफ़्ते से")}</span></div>
    <div class="gx-kv"><span>${tx("Answered", "हल किए")}</span><b>${w.thisW.a}</b>${delta(w.thisW.a, w.lastW.a)}</div>
    <div class="gx-kv"><span>Accuracy</span><b>${w.thisW.acc === null ? "—" : w.thisW.acc + "%"}</b>${delta(w.thisW.acc, w.lastW.acc, "%")}</div>
    <div class="gx-kv"><span>${tx("Tests", "Test")}</span><b>${w.thisW.t}</b>${delta(w.thisW.t, w.lastW.t)}</div>
    <div class="gx-kv"><span>${tx("Answering time", "जवाब का समय")}</span><b>${sjFmtMin(w.thisW.s)}</b></div></section>`;
}
function gxCoverageWidget() {
  const c = sjCoverage();
  const pct = c.total ? c.done / c.total : 0;
  return `<section class="gx-card gx-cov"><div class="gx-head"><h2>${tx("Coverage", "कवरेज")}</h2></div><div class="gx-cov-body">${gxRing(pct, 108, "gxCovGrad", `${Math.round(pct * 100)}%`, `${c.done} / ${c.total}`)}<p>${tx("questions answered at least once", "सवाल कम से कम एक बार हल किए")}</p></div></section>`;
}
function gxBackupBanner() {
  const has = AttemptHistory.length || ResultHistory.length;
  if (!has) return "";
  const last = StudySettings.lastBackupAt
    ? new Date(StudySettings.lastBackupAt)
    : null;
  const days =
    last && !isNaN(last) ? Math.floor((Date.now() - last) / 86400000) : null;
  if (days !== null && days < 7) return "";
  return `<section class="gx-card gx-backup" role="status"><span aria-hidden="true">💾</span><div><strong>${days === null ? tx("Your progress is not backed up yet", "आपकी progress का backup अभी नहीं है") : tx(`Last backup ${days} days ago`, `आख़िरी backup ${days} दिन पहले`)}</strong><small>${tx("All your answers live only on this device. Save a backup file so a phone change or cleared data never erases your work.", "आपके सारे जवाब सिर्फ़ इसी phone में हैं। Backup file बचाएँ, ताकि phone बदलने या data साफ़ होने पर मेहनत न खोए।")}</small></div><button type="button" class="gx-btn" onclick="downloadDataSnapshot()">${tx("Back up", "Backup लें")}</button></section>`;
}
function sjNextActions(d) {
  const actions = [];
  const firstModule = d.modules[0] || null;
  const due = reviewDue();
  if (d.resume)
    actions.push({
      icon: "▶",
      title: tx(
        `Resume ${d.resume.module.topicTitle}`,
        `${d.resume.module.topicTitle} जारी रखें`,
      ),
      why: tx(
        `You were at question ${d.resume.qIndex + 1} in practice this session.`,
        `आप practice में सवाल ${d.resume.qIndex + 1} पर थे।`,
      ),
      cta: tx("Resume", "जारी रखें"),
      call: `navigate('practice',{moduleId:${nbJsAttr(d.resume.module.moduleId)},qIndex:${d.resume.qIndex}})`,
    });
  if (due.length)
    actions.push({
      icon: "🔄",
      title: tx(
        `Revise ${due.length} card${due.length === 1 ? "" : "s"}`,
        `${due.length} card दोहराएँ`,
      ),
      why: tx(
        "They are due today on your spaced schedule.",
        "आपके revision schedule के हिसाब से आज बाकी हैं।",
      ),
      cta: tx("Revise", "दोहराएँ"),
      call: `navigate('revision_hub');revisionStart(null)`,
    });
  const weak = (
    typeof profileVisible === "function" ? profileVisible : (x) => x
  )(WorkspaceManager.filterModules(AppModules || []))
    .map((m) => ({ m, x: masteryFor(m.moduleId) }))
    .filter((o) => o.x.enough && o.x.score < 0.7)
    .sort((a, b) => a.x.score - b.x.score)[0];
  if (weak)
    actions.push({
      icon: "🎯",
      title: tx(
        `10-question test: ${weak.m.topicTitle}`,
        `10 सवाल का test: ${weak.m.topicTitle}`,
      ),
      why: tx(
        `Your recent accuracy here is ${Math.round(weak.x.score * 100)}% — your weakest topic.`,
        `यहाँ हाल की accuracy ${Math.round(weak.x.score * 100)}% है — सबसे कमज़ोर topic।`,
      ),
      cta: tx("Start", "शुरू"),
      call: `sjTopicTest(${nbJsAttr(weak.m.moduleId)})`,
    });
  else {
    const wt = d.weakTopics.find(
      (t) => t.count >= 2 && getWorkspaceModule(t.moduleId),
    );
    if (wt)
      actions.push({
        icon: "🎯",
        title: tx(
          `10-question test: ${wt.topic}`,
          `10 सवाल का test: ${wt.topic}`,
        ),
        why: tx(
          `${wt.count} unresolved mistakes in this topic.`,
          `इस topic में ${wt.count} गलतियाँ बाकी।`,
        ),
        cta: tx("Start", "शुरू"),
        call: `sjTopicTest(${nbJsAttr(wt.moduleId)})`,
      });
  }
  if (!d.totalQuestions)
    actions.push({
      icon: "📥",
      title: tx("Add questions", "सवाल जोड़ें"),
      why: tx(
        "This workspace has no questions yet. Import a question file to begin.",
        "इस workspace में अभी सवाल नहीं हैं। शुरू करने के लिए सवालों की file import करें।",
      ),
      cta: "Import",
      call: `openImportModal()`,
    });
  else if (StudySettings.dailyGoal && d.answered < StudySettings.dailyGoal)
    actions.push({
      icon: "⚡",
      title: tx("Daily mini test (10 questions)", "आज का mini test (10 सवाल)"),
      why: tx(
        `${StudySettings.dailyGoal - d.answered} questions left for today's goal.`,
        `आज के लक्ष्य के ${StudySettings.dailyGoal - d.answered} सवाल बाकी।`,
      ),
      cta: tx("Start", "शुरू"),
      call: `sjMiniTest()`,
    });
  else if (!d.resultsToday.length)
    actions.push({
      icon: "⚡",
      title: tx("Daily mini test (10 questions)", "आज का mini test (10 सवाल)"),
      why: tx(
        "Mistakes and weak topics first, then new questions.",
        "पहले गलतियाँ और कमज़ोर topics, फिर नए सवाल।",
      ),
      cta: tx("Start", "शुरू"),
      call: `sjMiniTest()`,
    });
  if (firstModule && !d.resume && !d.answered)
    actions.push({
      icon: "✍️",
      title: tx(
        `Practise ${firstModule.topicTitle}`,
        `${firstModule.topicTitle} की practice`,
      ),
      why: tx("No answers yet today.", "आज अभी कोई जवाब नहीं।"),
      cta: tx("Start", "शुरू"),
      call: `navigate('practice',{moduleId:${nbJsAttr(firstModule.moduleId)},qIndex:0})`,
    });
  if (d.results.length)
    actions.push({
      icon: "📜",
      title: tx("Open your test history", "अपनी test history खोलें"),
      why: tx(
        `${d.results.length} submitted test${d.results.length === 1 ? "" : "s"} saved on this device.`,
        `इस phone में ${d.results.length} test सहेजे हैं।`,
      ),
      cta: tx("Open", "खोलें"),
      call: `openTestHistoryModal()`,
    });
  return actions.slice(0, 3);
}
function renderHomePage(v) {
  const d = sjCollectDashboardData();
  const actions = sjNextActions(d);
  const primary = actions[0];
  const firstModule = d.modules[0] || null;
  const practiceCall = d.resume
    ? `navigate('practice',{moduleId:${nbJsAttr(d.resume.module.moduleId)},qIndex:${d.resume.qIndex}})`
    : firstModule
      ? `navigate('practice',{moduleId:${nbJsAttr(firstModule.moduleId)},qIndex:0})`
      : "";
  const hour = new Date().getHours();
  const greeting =
    hour < 12
      ? tx("Good morning", "सुप्रभात")
      : hour < 17
        ? tx("Good afternoon", "नमस्ते")
        : tx("Good evening", "शुभ संध्या");
  const examLine = d.examName
    ? `${escapeHtml(d.examName)}${d.examYear ? " · " + escapeHtml(d.examYear) : ""}`
    : tx("No exam selected", "कोई exam नहीं चुना");
  const daysLeft = StudySettings.examDate
    ? sjDayDiff(sjLocalDay(), StudySettings.examDate)
    : null;
  const cov = sjCoverage();
  const perDay =
    daysLeft && daysLeft > 0
      ? Math.ceil((cov.total - cov.done) / daysLeft)
      : null;
  const s = sjStreak();
  const masteredCount = (
    typeof profileVisible === "function" ? profileVisible : (x) => x
  )(WorkspaceManager.filterModules(AppModules || [])).filter(
    (m) => masteryFor(m.moduleId).level === "mastered",
  ).length;
  const stages = [
    {
      icon: uiIcon("book"),
      label: tx("Learn", "सीखें"),
      evidence: d.modules.length
        ? `${d.modules.length} topic${d.modules.length === 1 ? "" : "s"}`
        : tx("No topics", "कोई topic नहीं"),
      active: false,
      call: firstModule
        ? `navigate('learn',{moduleId:${nbJsAttr(firstModule.moduleId)}})`
        : "",
    },
    {
      icon: "✍️",
      label: "Practice",
      evidence: d.practiceToday
        ? tx(`${d.practiceToday} today`, `आज ${d.practiceToday}`)
        : tx("None today", "आज नहीं"),
      active: d.practiceToday > 0,
      call: practiceCall,
    },
    {
      icon: "⏱️",
      label: "Test",
      evidence: d.results.length
        ? tx(`${d.results.length} saved`, `${d.results.length} सहेजे`)
        : tx("No tests", "कोई test नहीं"),
      active: d.results.length > 0,
      call: `navigate('test_hub')`,
    },
    {
      icon: uiIcon("review"),
      label: tx("Review", "दोहराई"),
      evidence: reviewDue().length
        ? tx(`${reviewDue().length} due`, `${reviewDue().length} बाकी`)
        : tx("Caught up", "पूरा"),
      active: reviewDue().length > 0,
      call: `navigate('revision_hub')`,
    },
    {
      icon: "🏆",
      label: tx("Master", "महारत"),
      evidence: tx(`${masteredCount} mastered`, `${masteredCount} पक्के`),
      active: masteredCount > 0,
      call: `navigate('mastery')`,
    },
  ];
  const weakTopics = (
    typeof profileVisible === "function" ? profileVisible : (x) => x
  )(WorkspaceManager.filterModules(AppModules || []))
    .map((m) => ({
      m,
      x: masteryFor(m.moduleId),
      mis: d.weakTopics.find((t) => t.moduleId === m.moduleId)?.count || 0,
    }))
    .filter((o) => (o.x.enough && o.x.score < 0.7) || o.mis > 0)
    .sort(
      (a, b) =>
        (a.x.enough ? a.x.score : 1) - (b.x.enough ? b.x.score : 1) ||
        b.mis - a.mis,
    )
    .slice(0, 4);
  const recent = [];
  d.results
    .slice(0, 3)
    .forEach((r) =>
      recent.push({
        icon: "⏱️",
        title: `Test · ${r.topicTitle || "Custom Test"}`,
        meta: `Score ${Number(r.score) || 0}/${Number(r.total) || 0} · ${Number(r.accuracy) || 0}% · ${sjFormatWhen(r.ts)}`,
        call: `openStoredResult(${nbJsAttr(r.id)})`,
      }),
    );
  d.imports.slice(0, 2).forEach((h) => {
    const w = h.committedAt ? new Date(h.committedAt) : null;
    recent.push({
      icon: "📥",
      title: `Imported · ${h.topicTitle || h.sourceFile || "Questions"}`,
      meta: `${Number(h.committedQuestions) || 0} questions · ${w && !isNaN(w) ? w.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "date unknown"}`,
      call: `openDataControlModal()`,
    });
  });
  // Testbook-inspired exam-first navigation; every tile targets an existing, working route.
  // Features without a real data source (live classes/current affairs/AI doubt chat) are intentionally not faked.
  const quick = [
    {
      icon: uiIcon("exam"),
      label: tx("Exams", "परीक्षाएँ"),
      call: `navigate('exam_hub')`,
    },
    {
      icon: uiIcon("timer"),
      label: tx("Tests", "टेस्ट"),
      call: `navigate('test_hub')`,
    },
    {
      icon: uiIcon("file"),
      label: tx("PYQ papers", "PYQ पेपर"),
      call: `navigate('pyq_hub')`,
    },
    {
      icon: uiIcon("edit"),
      label: tx("Topic practice", "टॉपिक अभ्यास"),
      call: `navigate('subjects')`,
    },
    {
      icon: uiIcon("plus"),
      label: tx("Create Test", "टेस्ट बनाएँ"),
      call: `navigate('native_builder')`,
    },
    {
      icon: uiIcon("book"),
      label: tx("Study library", "स्टडी लाइब्रेरी"),
      call: `navigate('digital_library')`,
    },
    {
      icon: uiIcon("search"),
      label: tx("Question Bank", "प्रश्न बैंक"),
      call: `navigate('taxonomy_explorer')`,
    },
    {
      icon: uiIcon("review"),
      label: tx("Revision", "दोहराई"),
      call: `navigate('revision_hub')`,
    },
  ];

  v.innerHTML = `<div class="sj-dash gx">
    <section class="gx-card gx-hero" aria-labelledby="sjHeroTitle">
      <div class="gx-hero-top">${typeof profileHeroChip === "function" ? profileHeroChip(examLine) : `<span class="gx-pill">🏛️ ${examLine}</span>`}</div>
      <h1 id="sjHeroTitle">${greeting}</h1>
      <p>${d.totalQuestions ? tx(`${d.totalQuestions} questions · ${d.subjects.length} subject${d.subjects.length === 1 ? "" : "s"} · ${d.modules.length} topic${d.modules.length === 1 ? "" : "s"} in ${escapeHtml(d.workspace.name)}`, `${d.totalQuestions} सवाल · ${d.subjects.length} विषय · ${d.modules.length} topic — ${escapeHtml(d.workspace.name)}`) : tx(`No questions in ${escapeHtml(d.workspace.name)} yet. Import a question file to start.`, `${escapeHtml(d.workspace.name)} में अभी सवाल नहीं हैं। शुरू करने के लिए file import करें।`)}</p>
      <div class="gx-hero-facts">
        <span>🔥 <b>${s.streak}</b> ${tx("day streak", "दिन लगातार")}</span>
        ${daysLeft !== null ? (daysLeft >= 0 ? `<span>📅 <b>${daysLeft}</b> ${tx(`day${daysLeft === 1 ? "" : "s"} to exam`, "दिन exam में")}${perDay ? tx(` · ~${perDay} new questions/day covers the bank`, ` · रोज़ ~${perDay} नए सवाल से पूरा bank हो जाएगा`) : ""}</span>` : `<span>📅 ${tx("Exam date has passed", "Exam की तारीख निकल गई")}</span>`) : `<button type="button" class="gx-link" onclick="sjOpenGoalSettings()">📅 ${tx("Add exam date", "Exam की तारीख जोड़ें")}</button>`}
      </div>
    </section>
    <section class="gx-card gx-continue" aria-labelledby="sjContinueH"><div class="gx-head"><h2 id="sjContinueH">${d.resume ? tx("Continue", "जारी रखें") : tx("Start studying", "पढ़ाई शुरू करें")}</h2></div>
      ${
        d.resume
          ? `<div class="sj-resume"><div><strong>${escapeHtml(d.resume.module.topicTitle)}</strong><span>${escapeHtml(subjectDisplayName(d.resume.module.subject))} · ${tx("Practice", "अभ्यास")} · ${tx("Question", "सवाल")} ${d.resume.qIndex + 1} / ${sjModuleQuestionCount(d.resume.module)}</span></div><button type="button" class="gx-btn" onclick="${practiceCall}">${tx("Resume →", "जारी रखें →")}</button></div>`
          : !d.totalQuestions && d.workspace.type === "COMPETITIVE"
            ? studyEmptyState()
            : primary
              ? `<div class="sj-resume"><div><strong>${escapeHtml(primary.title)}</strong><span>${escapeHtml(primary.why)}</span></div><button type="button" class="gx-btn" onclick="${primary.call}">${escapeHtml(primary.cta)} →</button></div>`
              : ""
      }
      ${
        actions.length > 1 && d.totalQuestions
          ? `<details class="gx-suggestions"><summary>${tx("More suggestions", "और सुझाव")}</summary><div class="sj-actions-list">${actions
              .slice(1)
              .map(
                (a) =>
                  `<button type="button" class="sj-action" onclick="${a.call}"><span class="sj-action-copy"><strong>${escapeHtml(a.title)}</strong><small>${escapeHtml(a.why)}</small></span><span aria-hidden="true">›</span></button>`,
              )
              .join("")}</div></details>`
          : ""
      }
    </section>
    ${gxGoalWidget(d)}
    <section class="gx-card gx-quick" aria-labelledby="sjExploreHeading"><div class="gx-head"><h2 id="sjExploreHeading">${tx("Explore preparation", "तैयारी के विकल्प")}</h2><span class="gx-explore-note">${tx("Choose what you want to do next", "अगला कदम चुनें")}</span></div><div class="sj-quick">${quick.map((q) => `<button type="button" class="sj-quick-btn" onclick="${q.call}"><span aria-hidden="true">${q.icon}</span><span>${escapeHtml(q.label)}</span></button>`).join("")}</div></section>
    <section class="gx-card gx-search"><div class="search-box-wrap" style="margin:0;"><span class="search-icon">🔍</span><input type="search" class="search-input" id="inpGlobalSearch" aria-label="${tx("Search questions", "सवाल खोजें")}" placeholder="${tx("Search questions, exams or topics…", "सवाल, परीक्षा या टॉपिक खोजें…")}" oninput="onGlobalSearch(this.value)"></div><div id="globalSearchResults"></div></section>
    ${gxSubjectWidget()}
    ${gxTodayWidget(d)}
    ${gxRevisionWidget()}
    <section class="gx-card gx-attn"><div class="gx-head"><h2>${tx("Needs attention", "ध्यान दें")}</h2><button type="button" class="gx-link" onclick="navigate('mastery')">${tx("Mastery", "महारत")}</button></div>
      ${
        weakTopics.length
          ? `<div class="sj-recent">${weakTopics.map((o) => `<div class="gx-attn-row"><span class="gx-attn-txt"><strong>${escapeHtml(o.m.topicTitle)}</strong><small>${o.x.enough ? tx(`${Math.round(o.x.score * 100)}% recent accuracy`, `हाल की accuracy ${Math.round(o.x.score * 100)}%`) : tx(`${o.x.answered} answers`, `${o.x.answered} जवाब`)}${o.mis ? tx(` · ${o.mis} mistake${o.mis === 1 ? "" : "s"}`, ` · ${o.mis} गलतियाँ`) : ""}</small></span><button type="button" class="gx-btn ghost" onclick="sjTopicTest(${nbJsAttr(o.m.moduleId)})">${tx("10-Q test", "10 सवाल test")}</button></div>`).join("")}</div>`
          : `<div class="gx-empty"><strong>${tx("Nothing flagged", "सब ठीक")}</strong><span>${tx(`Topics appear here when recent accuracy drops below 70% (after ${MASTERY_MIN_ANSWERS} answers) or mistakes pile up.`, `जब किसी topic की accuracy 70% से नीचे जाए (${MASTERY_MIN_ANSWERS} जवाबों के बाद) या गलतियाँ बढ़ें, वह यहाँ दिखेगा।`)}</span></div>`
      }
      ${d.otherExamMistakes ? `<p class="gx-note">${tx(`${d.otherExamMistakes} more mistake(s) belong to other exams.`, `${d.otherExamMistakes} गलतियाँ दूसरे exams की हैं।`)} <button type="button" class="sj-inline-link" onclick="sjOpenAllExamMistakes()">${tx("Show all exams", "सारे exams दिखाएँ")}</button></p>` : ""}
    </section>
    ${gxTrendWidget(d.results)}
    ${gxStreakWidget()}
    ${gxWeeklyWidget()}
    ${gxCoverageWidget()}
    ${gxPomodoroWidget()}
    <section class="gx-card gx-journey"><div class="gx-head"><h2>${tx("Your learning journey", "आपकी पढ़ाई का सफ़र")}</h2></div><ol class="sj-journey">${stages.map((x) => `<li class="sj-stage ${x.active ? "has-evidence" : ""}">${x.call ? `<button type="button" onclick="${x.call}">` : "<div>"}<span class="sj-stage-dot" aria-hidden="true">${x.icon}</span><strong>${x.label}</strong><small>${escapeHtml(x.evidence)}</small>${x.call ? "</button>" : "</div>"}</li>`).join("")}</ol></section>
    <section class="gx-card gx-recent"><div class="gx-head"><h2>${tx("Recent activity", "हाल की गतिविधि")}</h2>${d.results.length ? `<button type="button" class="gx-link" onclick="openTestHistoryModal()">${tx("All tests", "सारे test")}</button>` : ""}</div>
      ${recent.length ? `<div class="sj-recent">${recent.map((r) => `<button type="button" class="sj-action" onclick="${r.call}"><span aria-hidden="true">${r.icon}</span><span class="sj-action-copy"><strong>${escapeHtml(r.title)}</strong><small>${escapeHtml(r.meta)}</small></span><span class="sj-action-go" aria-hidden="true">›</span></button>`).join("")}</div>` : `<div class="gx-empty"><strong>${tx("Nothing yet", "अभी कुछ नहीं")}</strong><span>${tx("Imports and submitted tests appear here.", "Import और दिए गए test यहाँ दिखेंगे।")}</span></div>`}
    </section>
    ${gxBackupBanner()}
  </div>`;
  pomoPaint();
}
