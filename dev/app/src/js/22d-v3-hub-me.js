/* =========================================================================
   V3.2 (blueprint Lane B):
   1. Subject hub — chapter accordions, each topic with Learn · Practice · Test,
      filter chips All / PYQ / Weak / Unfinished.
   2. Result — "Speed check" card (your pace vs allowed pace vs your usual pace).
   3. "Me" screen — account, exam profile, progress tiles, shortcuts, settings.
   Read-only over existing data (AttemptHistory, ResultHistory, UserState); no data-write paths changed.
   ========================================================================= */
var SubjectHubState = { filter: 'all', open: {} };

function shTopicStats(m) {
  const ws = WorkspaceManager.current().id;
  const ids = new Set();
  (m.groups || []).forEach(g => (g.questions || []).forEach(q => ids.add(String(q.canonicalQId || ''))));
  const seen = new Set(); let answered = 0, correct = 0;
  (AttemptHistory || []).forEach(a => { if (a.ws === ws && ids.has(String(a.cid || ''))) { seen.add(String(a.cid)); answered++; if (a.correct) correct++; } });
  const total = ids.size || nbModuleQCount(m);
  const pyq = (m.groups || []).some(g => (g.questions || []).some(q => pyqStatusOf(q) === 'PYQ'));
  const mx = masteryFor(m.moduleId);
  const acc = answered ? correct / answered : null;
  const weak = (mx.enough && mx.score < 0.7) || (answered >= 5 && acc < 0.6);
  return { total, done: seen.size, answered, correct, acc, pyq, weak, unfinished: seen.size > 0 && seen.size < total };
}
function shMatch(st) {
  const f = SubjectHubState.filter;
  return f === 'all' || (f === 'pyq' && st.pyq) || (f === 'weak' && st.weak) || (f === 'unfinished' && st.unfinished);
}
function shSetFilter(f) { SubjectHubState.filter = f; renderView(); }
function shToggle(key, el) { SubjectHubState.open[key] = el.open; }

function renderSubjectPage(v, subject) {
  const key = String(subject || '').trim().toLowerCase();
  const mods = (typeof profileVisible === 'function' ? profileVisible : (x => x))(CurriculumContext.filterModules(AppModules))
    .filter(m => String(m.subject || '').trim().toLowerCase() === key && nbModuleQCount(m) > 0);
  const chapters = new Map();
  mods.forEach(m => {
    const ch = String(m.chapter || m.topicTitle || '').trim() || tx('Other', 'अन्य');
    const c = chapters.get(ch.toLowerCase()) || { name: ch, items: [] };
    c.items.push({ m, st: shTopicStats(m) }); chapters.set(ch.toLowerCase(), c);
  });
  const all = Array.from(chapters.values());
  const counts = { all: mods.length, pyq: 0, weak: 0, unfinished: 0 };
  all.forEach(c => c.items.forEach(({ st }) => { if (st.pyq) counts.pyq++; if (st.weak) counts.weak++; if (st.unfinished) counts.unfinished++; }));
  const name = subjectLabel(subject);
  const chips = [['all', tx('All', 'सभी')], ['pyq', 'PYQ'], ['weak', tx('Weak', 'कमज़ोर')], ['unfinished', tx('Unfinished', 'अधूरे')]]
    .map(([id, label]) => `<button type="button" class="sh-chip ${SubjectHubState.filter === id ? 'on' : ''}" aria-pressed="${SubjectHubState.filter === id}" onclick="shSetFilter('${id}')">${label} <b>${counts[id]}</b></button>`).join('');
  const shown = all.map(c => ({ ...c, items: c.items.filter(x => shMatch(x.st)) })).filter(c => c.items.length);
  const pct = n => Math.max(0, Math.min(100, Math.round(n)));
  const chapterHtml = (c, i) => {
    const qs = c.items.reduce((n, x) => n + x.st.total, 0), done = c.items.reduce((n, x) => n + x.st.done, 0);
    const ans = c.items.reduce((n, x) => n + x.st.answered, 0), cor = c.items.reduce((n, x) => n + x.st.correct, 0);
    const k = key + '|' + c.name.toLowerCase();
    const open = SubjectHubState.open[k] ?? (i === 0 || SubjectHubState.filter !== 'all');
    const accTxt = ans ? `${Math.round(cor / ans * 100)}%` : '—';
    return `<details class="sh-ch" ${open ? 'open' : ''} ontoggle="shToggle(${nbJsAttr(k)}, this)">
      <summary><span class="sh-ch-main"><strong>${escapeHtml(c.name)}</strong>
        <small>${tx(`${qs} questions · ${c.items.length} topic${c.items.length === 1 ? '' : 's'} · accuracy ${accTxt}`, `${qs} सवाल · ${c.items.length} टॉपिक · सटीकता ${accTxt}`)}</small>
        <span class="sh-bar" role="progressbar" aria-label="${tx('Done', 'हो गए')}" aria-valuenow="${pct(done / Math.max(1, qs) * 100)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct(done / Math.max(1, qs) * 100)}%"></i></span></span>
        <span class="sh-chev" aria-hidden="true">⌄</span></summary>
      <div class="sh-topics">${c.items.map(({ m, st }) => `<div class="sh-topic">
        <div class="sh-t-head">${c.items.length === 1 && String(m.topicTitle || '').trim().toLowerCase() === c.name.toLowerCase()
          ? `<button type="button" class="sh-t-name sm" onclick="navigate('topic', {moduleId:${nbJsAttr(m.moduleId)}})">${tx('Open topic', 'टॉपिक खोलें')} ›</button>`
          : `<button type="button" class="sh-t-name" onclick="navigate('topic', {moduleId:${nbJsAttr(m.moduleId)}})">${escapeHtml(m.topicTitle || m.topic || '')}</button>`}
          <span class="sh-t-meta">${st.pyq ? '<span class="sh-tag pyq">PYQ</span>' : ''}${st.weak ? `<span class="sh-tag weak">${tx('Weak', 'कमज़ोर')}</span>` : ''}${tx(`${st.done}/${st.total} done`, `${st.done}/${st.total} हुए`)}${st.acc != null ? ` · ${Math.round(st.acc * 100)}%` : ''}</span></div>
        <div class="sh-acts">
          <button type="button" class="sh-act" onclick="navigate('learn', {moduleId:${nbJsAttr(m.moduleId)}})">📖 ${tx('Learn', 'सीखें')}</button>
          <button type="button" class="sh-act" onclick="navigate('practice', {moduleId:${nbJsAttr(m.moduleId)}, qIndex:0})">✍️ ${tx('Practice', 'अभ्यास')}</button>
          <button type="button" class="sh-act primary" onclick="sjTopicTest(${nbJsAttr(m.moduleId)})">⏱️ ${tx('Test', 'टेस्ट')}</button>
        </div></div>`).join('')}</div>
    </details>`;
  };
  v.innerHTML = `
    <div class="nav-breadcrumb"><button onclick="navigate('home')">${tx('Home', 'होम')}</button><span class="sep">/</span><button onclick="navigate('subjects')">${tx('Subjects', 'विषय')}</button><span class="sep">/</span><span>${escapeHtml(name)}</span></div>
    <div class="sc-head"><div><h1>${escapeHtml(name)}</h1><p>${tx(`${all.length} chapter${all.length === 1 ? '' : 's'} · ${mods.length} topics`, `${all.length} अध्याय · ${mods.length} टॉपिक`)}</p></div>
      <button type="button" class="btn-action-sm" onclick="navigate('subjects')">← ${tx('Subjects', 'विषय')}</button></div>
    <div class="sh-chips" role="group" aria-label="${tx('Filter topics', 'टॉपिक छाँटें')}">${chips}</div>
    ${shown.length ? `<div class="sh-list">${shown.map(chapterHtml).join('')}</div>` : studyEmptyState(all.length ? 'subject' : '')}`;
}

/* ---------- Result: time card ---------- */
function fmtSec(s) { s = Math.max(0, Math.round(Number(s) || 0)); return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`; }
function resultTimeCard(res, keyFor) {
  const t = res && res.timeSpent; if (!t || !res.questions || !res.questions.length) return '';
  const rows = res.questions.map((q, i) => { const k = keyFor(q); const a = res.answers?.[k]; return { i, sec: Number(t[i]) || 0, state: !a ? 'skip' : String(a).toUpperCase() === String(q.answer || '').toUpperCase() ? 'ok' : 'bad' }; });
  const used = rows.reduce((n, r) => n + r.sec, 0); if (used <= 0) return '';
  const n = rows.length, mine = used / n;
  const pace = Number(res.durationSeconds) > 0 ? Number(res.durationSeconds) / n : null;
  const ls = learningStats(); const usual = ls.answered >= 20 && ls.sec > 0 ? ls.sec / ls.answered : null;
  const cmp = (a, b) => b == null ? '' : a <= b ? `<em class="ok">${tx('faster', 'तेज़')}</em>` : `<em class="slow">${tx('slower', 'धीमा')}</em>`;
  return `<section class="rs-card rs-pace"><h3>🚀 ${tx('Speed check', 'रफ़्तार जाँच')}</h3>
    <div class="rs-pace-grid">
      <span><b>${fmtSec(mine)}</b>${tx('per question (you)', 'प्रति सवाल (आप)')}</span>
      ${pace ? `<span><b>${fmtSec(pace)}</b>${tx('allowed pace', 'तय रफ़्तार')} ${cmp(mine, pace)}</span>` : ''}
      ${usual ? `<span><b>${fmtSec(usual)}</b>${tx('your usual', 'आपका औसत')} ${cmp(mine, usual)}</span>` : ''}
      <span><b>${fmtSec(used)}</b>${tx('total used', 'कुल समय')}${Number(res.durationSeconds) > 0 ? ` / ${fmtSec(res.durationSeconds)}` : ''}</span>
    </div>
  </section>`;
}

/* ---------- Me screen ---------- */
function renderMePage(v) {
  const s = (typeof ServerState !== 'undefined') ? ServerState.session : null;
  const ls = learningStats();
  const tests = (typeof ResultHistory !== 'undefined' ? ResultHistory : []).filter(r => r && r.ws === WorkspaceManager.current().id);
  const st = typeof sjStreak === 'function' ? sjStreak() : { streak: 0, best: 0 };
  const acc = ls.answered ? Math.round(ls.correct / ls.answered * 100) + '%' : '—';
  const hrs = ls.sec >= 3600 ? (ls.sec / 3600).toFixed(1) + 'h' : Math.round(ls.sec / 60) + 'm';
  const p = typeof studentProfile === 'function' ? studentProfile() : null;
  const nameTxt = (typeof CloudState !== 'undefined' && CloudState.name) || (s && s.email) || tx('Guest', 'मेहमान');
  const mistakes = (UserState.mistakeBook || []).length;
  const marks = typeof bookmarkedIds === 'function' ? bookmarkedIds().size : 0;
  const tile = (b, l) => `<span class="me-tile"><b>${b}</b>${l}</span>`;
  const row = (ico, label, sub, on, id = "") =>
    `<button type="button" ${id ? `id="${id}"` : ""} class="me-row" onclick="${on}"><span class="me-ico" aria-hidden="true">${ico}</span><span class="me-row-main"><b>${label}</b>${sub ? `<small>${sub}</small>` : ""}</span><span aria-hidden="true">›</span></button>`;
  v.innerHTML = `
    <section class="me-head">
      <span class="me-avatar" aria-hidden="true">${escapeHtml(String(nameTxt).trim().charAt(0).toUpperCase() || "?")}</span>
      <div class="me-id"><h1>${escapeHtml(nameTxt)}</h1><p>${s ? escapeHtml(s.email || "") : tx("Not logged in — progress stays on this phone only", "Login नहीं — progress सिर्फ़ इस phone में")}</p></div>
      <button type="button" class="btn-action-sm" onclick="openAccount()">${s ? tx("Account", "Account") : tx("Login", "Login")}</button>
    </section>
    ${typeof profileLabel === "function" ? `<button type="button" class="me-profile" onclick="${typeof openProfileSheet === "function" ? "openProfileSheet()" : ""}">🎯 <span>${p ? escapeHtml(profileLabel(p)) : tx("Choose your exam and branch", "अपना exam और branch चुनें")}</span><b>${tx("Change", "बदलें")} ›</b></button>` : ""}
    <section class="me-tiles" aria-label="${tx("Your progress", "आपकी progress")}">
      ${tile(ls.answered, tx("answered", "सवाल हल"))}${tile(acc, tx("accuracy", "सटीकता"))}${tile(tests.length, tx("tests", "टेस्ट"))}${tile(st.streak + "🔥", tx("day streak", "दिन लगातार"))}${tile(hrs, tx("study time", "पढ़ाई का समय"))}${tile(st.best, tx("best streak", "सबसे लंबा"))}
    </section>
    <section class="me-list" aria-label="${tx("Shortcuts", "शॉर्टकट")}">
      ${row("📜", tx("Test history", "टेस्ट इतिहास"), tx(`${tests.length} saved`, `${tests.length} सहेजे`), "openTestHistoryModal()")}
      ${row("📕", tx("Mistake book", "गलतियों की किताब"), tx(`${mistakes} questions`, `${mistakes} सवाल`), "navigate('mistakes')")}
      ${row("⭐", tx("Bookmarks test", "Bookmark टेस्ट"), tx(`${marks} saved`, `${marks} सहेजे`), "sbOpenBookmarkTest()")}
      ${row("🎯", tx("Mastery", "महारत"), "", "navigate('mastery')")}
      ${row("🏁", tx("Daily goal", "रोज़ का लक्ष्य"), StudySettings && StudySettings.dailyGoal ? tx(`${StudySettings.dailyGoal} questions a day`, `रोज़ ${StudySettings.dailyGoal} सवाल`) : tx("Not set", "तय नहीं"), "sjOpenGoalSettings()")}
    </section>
    <section class="me-list" aria-label="${tx("Settings", "सेटिंग")}">
      ${row("Aa", tx("Language & text size", "भाषा और अक्षर आकार"), "", "openDisplaySettings()", "btnTextSize")}
      ${row(UserState.theme === "dark" ? "☀️" : "🌙", tx("Dark mode", "डार्क मोड"), UserState.theme === "dark" ? tx("On", "चालू") : tx("Off", "बंद"), "toggleCbtDark()")}
      ${row("🧭", tx("Workspace", "वर्कस्पेस"), escapeHtml(WorkspaceManager.current().name), "openWorkspaceSwitcher()")}
      ${row("💾", tx("Backup & restore", "Backup और Restore"), "", "openBackupCenter()")}
      ${s ? row("🔄", tx("Sync now", "अभी sync करें"), "", "cloudSync('manual')") : ""}
    </section>
    <p class="me-ver">Master TestBook ${escapeHtml(document.querySelector('meta[name="app-version"]')?.content || "")}</p>`;
}
registerRouteViewState('subject', {
  capture: () => ({ filter: SubjectHubState.filter, open: { ...SubjectHubState.open } }),
  restore: state => { SubjectHubState = state ? { filter: state.filter, open: { ...state.open } } : { filter: 'all', open: {} }; }
});
