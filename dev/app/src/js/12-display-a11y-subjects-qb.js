/* =========================================================================
   V2.4.1 — Update 5: language, text size, accessibility, honest subjects,
   Question Bank
   ========================================================================= */
/* ---------- display settings (language / text size / theme) ---------- */
const UI_SIZES = { s: 0.9, m: 1, l: 1.12, xl: 1.25 };
function uiLang() { return StudySettings?.ui?.lang === 'hi' ? 'hi' : 'en'; }
function uiSize() { const s = StudySettings?.ui?.size; return Object.prototype.hasOwnProperty.call(UI_SIZES, s) ? s : 'm'; }
// tx(english, hindi): one place that picks the interface language.
function tx(en, hi) { return uiLang() === 'hi' && hi ? hi : en; }
const SUBJECT_NAMES_HI = { maths: 'गणित', mathematics: 'गणित', science: 'सामान्य विज्ञान', 'general science': 'सामान्य विज्ञान', reasoning: 'तर्कशक्ति', english: 'अंग्रेज़ी', gk: 'सामान्य ज्ञान', 'general-awareness': 'सामान्य जागरूकता', hindi: 'हिंदी', computer: 'कंप्यूटर' };
function subjectLabel(key) { const hi = SUBJECT_NAMES_HI[String(key || '').trim().toLowerCase()]; return tx(subjectDisplayName(key), hi || ''); }
function applyDisplaySettings() {
  const root = document.documentElement;
  root.style.setProperty('--ui-zoom', String(UI_SIZES[uiSize()]));
  root.lang = uiLang();
  document.body.classList.toggle('ui-zoomed', uiSize() !== 'm');
  nbLocalizeShell();
}
function nbLocalizeShell() {
  document.querySelectorAll('[data-en]').forEach(el => { const t = tx(el.dataset.en, el.dataset.hi); if (el.textContent !== t) el.textContent = t; });
  const tb = document.getElementById('btnTextSize'); if (tb) tb.setAttribute('aria-label', tx('Display settings: language, text size, theme', 'डिस्प्ले सेटिंग: भाषा, अक्षर आकार, थीम'));
}
function setDisplaySetting(key, val) {
  StudySettings.ui = { ...(StudySettings.ui || {}), [key]: val };
  saveStudySettings();
  applyDisplaySettings();
  renderView();
  openDisplaySettings();
}
function setDisplayTheme(t) {
  if ((UserState.theme === 'dark') !== (t === 'dark')) toggleCbtDark();
  openDisplaySettings();
}
function openDisplaySettings() {
  closeDrawer();
  const L = uiLang(), S = uiSize(), dark = UserState.theme === 'dark';
  const seg = (name, items) => `<div class="ds-seg" role="radiogroup" aria-label="${escapeHtml(name)}">${items.map(it => `<button type="button" role="radio" aria-checked="${it.on}" class="ds-opt ${it.on ? 'on' : ''}" onclick="${it.call}" aria-label="${escapeHtml(it.aria || it.text)}">${it.html || escapeHtml(it.text)}</button>`).join('')}</div>`;
  const sizes = [['s', 12, tx('Small', 'छोटा')], ['m', 15, tx('Normal', 'सामान्य')], ['l', 18, tx('Large', 'बड़ा')], ['xl', 21, tx('Extra large', 'बहुत बड़ा')]];
  openModal(tx('Display', 'डिस्प्ले'), `<div class="ds">
    <div class="ds-row"><h4>${tx('Language', 'भाषा')}</h4>${seg(tx('Language', 'भाषा'), [
      { on: L === 'en', call: "setDisplaySetting('lang','en')", text: 'English' },
      { on: L === 'hi', call: "setDisplaySetting('lang','hi')", text: 'हिंदी' }])}
      <p class="ds-note">${tx('Menus, titles and the dashboard. Question language is chosen inside each test.', 'मेनू, शीर्षक और डैशबोर्ड। सवालों की भाषा हर टेस्ट में अलग से चुनी जाती है।')}</p></div>
    <div class="ds-row"><h4>${tx('Text size', 'अक्षर का आकार')}</h4>${seg(tx('Text size', 'अक्षर का आकार'), sizes.map(([k, px, name]) => ({ on: S === k, call: `setDisplaySetting('size','${k}')`, aria: name, html: `<span style="font-size:${px}px;font-weight:900">A</span><small>${escapeHtml(name)}</small>` })))}
      <p class="ds-note">${tx('Applies to every page, the builder and the test screen.', 'हर पेज, बिल्डर और टेस्ट स्क्रीन पर लागू।')}</p></div>
    <div class="ds-row"><h4>${tx('Theme', 'थीम')}</h4>${seg(tx('Theme', 'थीम'), [
      { on: !dark, call: "setDisplayTheme('light')", text: tx('☀️ Light', '☀️ लाइट') },
      { on: dark, call: "setDisplayTheme('dark')", text: tx('🌙 Dark', '🌙 डार्क') }])}</div>
    <div class="ds-actions"><button type="button" class="btn-nav primary" onclick="closeModal()">${tx('Done', 'ठीक है')}</button></div>
  </div>`);
}

/* ---------- route titles ---------- */
function nbRouteTitle(page) {
  if (page === 'home' && WorkspaceManager.current().type === 'BOARD') return null;
  const title = AppRoutes[page]?.title;
  return title ? tx(...title) : null;
}

/* ---------- accessibility ---------- */
let A11yQueued = false, ModalReturnFocus = null;
function nbA11yEnhance() {
  A11yQueued = false;
  document.querySelectorAll('[onclick]:not(button):not(a):not(input):not(select):not(textarea):not(label):not(summary):not([role])').forEach(el => {
    el.setAttribute('role', 'button');
    if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
  });
  document.querySelectorAll('.nav-tab').forEach(t => { if (t.classList.contains('active')) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
}
function nbQueueA11y() { if (A11yQueued) return; A11yQueued = true; setTimeout(nbA11yEnhance, 0); }
function nbModalIsOpen() { return document.getElementById('modalSheet')?.classList.contains('open'); }
function nbFocusModal() {
  const sheet = document.getElementById('modalSheet'); if (!sheet) return;
  // A form field gets focus directly; otherwise the dialog itself (no stray focus ring on a button).
  // Sheets marked data-no-autofocus (long lists with inputs) should not pop the phone keyboard open.
  const first = sheet.querySelector('[data-no-autofocus]') ? null : sheet.querySelector('#modalSheetBody input:not([type=hidden]):not([disabled]), #modalSheetBody select, #modalSheetBody textarea');
  try { (first || sheet).focus({ preventScroll: true }); } catch (_) {}
}
const _u5OpenModal = openModal, _u5CloseModal = closeModal;
openModal = function (title, contentHtml) {
  const wasOpen = nbModalIsOpen();
  if (!wasOpen) ModalReturnFocus = document.activeElement;
  _u5OpenModal(title, contentHtml);
  nbQueueA11y();
  if (!wasOpen || !document.getElementById('modalSheet').contains(document.activeElement)) setTimeout(nbFocusModal, 0);
};
closeModal = function () {
  const wasOpen = nbModalIsOpen();
  _u5CloseModal();
  if (wasOpen && ModalReturnFocus && document.contains(ModalReturnFocus) && ModalReturnFocus !== document.body) { try { ModalReturnFocus.focus({ preventScroll: true }); } catch (_) {} }
  if (wasOpen) ModalReturnFocus = null;
};
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (nbModalIsOpen()) { e.preventDefault(); closeModal(); return; }
    if (document.getElementById('sideDrawer')?.classList.contains('open')) { e.preventDefault(); closeDrawer(); try { document.getElementById('btnMenu').focus(); } catch (_) {} }
    return;
  }
  if ((e.key === 'Enter' || e.key === ' ') && e.target instanceof HTMLElement && e.target.getAttribute('role') === 'button' && e.target.tagName !== 'BUTTON' && e.target.hasAttribute('onclick') && e.target === document.activeElement) {
    e.preventDefault(); e.target.click();
  }
});
try {
  const a11yObs = new MutationObserver(nbQueueA11y);
  ['mainView', 'modalSheetBody', 'sideDrawer'].forEach(id => { const el = document.getElementById(id); if (el) a11yObs.observe(el, { childList: true, subtree: true }); });
} catch (_) {}

registerViewHook('after', 'display', () => {
  const title = document.getElementById('txtHeaderTitle');
  const text = nbRouteTitle(Route.page);
  if (title && text) title.textContent = text;
  nbLocalizeShell();
  nbQueueA11y();
});

/* ---------- honest subject catalog ---------- */
const SUBJECT_ICONS = { maths: '📐', mathematics: '📐', science: '🔬', 'general science': '🔬', reasoning: '🧠', english: '📝', gk: '🌍', 'general-awareness': '🌍', hindi: '🅷', computer: '💻' };
function nbModuleQCount(m) { return (m.groups || []).reduce((n, g) => n + (g.questions || []).length, 0); }
function nbSubjectAccuracy(key) {
  const k = String(key || '').trim().toLowerCase(); let answered = 0, correct = 0;
  learningStats().bySubject.forEach((v, s) => { if (String(s || '').trim().toLowerCase() === k) { answered += v.answered; correct += v.correct; } });
  return { answered, correct };
}
function nbChapterAccuracy(mods) {
  const st = learningStats().byModule; let answered = 0, correct = 0;
  mods.forEach(m => { const x = st.get(m.moduleId); if (x) { answered += x.answered; correct += x.correct; } });
  return { answered, correct };
}
function nbAccuracyLine(a) {
  if (!a.answered) return `<span class="sc-acc none">${tx('Not practised yet', 'अभी अभ्यास नहीं किया')}</span>`;
  if (a.answered < MASTERY_MIN_ANSWERS) return `<span class="sc-acc none">${tx(`${a.answered} answered — accuracy after ${MASTERY_MIN_ANSWERS}`, `${a.answered} हल किए — ${MASTERY_MIN_ANSWERS} के बाद सटीकता`)}</span>`;
  const pct = Math.round(a.correct / a.answered * 100);
  return `<span class="sc-acc ${masteryLevelFor(pct / 100)}">${tx(`Accuracy ${pct}% · ${a.answered} answered`, `सटीकता ${pct}% · ${a.answered} हल किए`)}</span>`;
}
function nbSubjectGroups() {
  const map = new Map();
  (typeof profileVisible==='function'?profileVisible:(x=>x))(CurriculumContext.filterModules(AppModules)).forEach(m => {
    const raw = String(m.subject || '').trim(); if (!raw) return;
    const k = raw.toLowerCase();
    const g = map.get(k) || { key: raw, mods: [], chapters: new Map(), qs: 0 };
    g.mods.push(m); g.qs += nbModuleQCount(m);
    const ch = String(m.chapter || '').trim() || tx('Other', 'अन्य');
    g.chapters.set(ch.toLowerCase(), ch);
    map.set(k, g);
  });
  return Array.from(map.values()).filter(g => g.qs > 0).sort((a, b) => b.qs - a.qs);
}
/* Subject navigation redesign — scoped only to the Subjects catalog. */
let SubjectNavState = { selected: '', expanded: '' };
function shSelectCatalogSubject(key) {
  SubjectNavState.selected = String(key || '');
  SubjectNavState.expanded = '';
  renderView();
}
function shToggleCatalogChapter(key) {
  SubjectNavState.expanded = SubjectNavState.expanded === key ? '' : key;
  renderView();
}
function renderSubjectsCatalog(v) {
  const groups = nbSubjectGroups();
  const total = groups.reduce((n, g) => n + g.qs, 0);
  if (!groups.some(g => g.key === SubjectNavState.selected)) SubjectNavState.selected = groups[0]?.key || '';
  const selected = groups.find(g => g.key === SubjectNavState.selected) || null;
  const chapters = selected ? Array.from(selected.chapters.entries()).map(([id, name]) => {
    const mods = selected.mods.filter(m => String(m.chapter || '').trim().toLowerCase() === String(name).trim().toLowerCase());
    return { id: String(id), name, mods, qs: mods.reduce((n, m) => n + nbModuleQCount(m), 0) };
  }) : [];
  const subjectTabs = groups.map(g => {
    const active = selected && g.key === selected.key;
    const k = g.key.toLowerCase();
    return `<button type="button" class="sn-tab ${active ? "on" : ""}" aria-pressed="${!!active}" onclick="shSelectCatalogSubject(${nbJsAttr(g.key)})">
      <span class="sn-tab-icon" aria-hidden="true">${uiIcon("book")}</span>
      <span>${escapeHtml(subjectLabel(g.key))}</span><small>${g.qs} ${tx("Qs", "सवाल")}</small>
    </button>`;
  }).join('');
  const chapterRows = chapters.map(c => {
    const open = SubjectNavState.expanded === c.id;
    const topicRows = c.mods.map(m => {
      const topic = String(m.topicTitle || m.topic || '').trim();
      const subtopic = String(m.subtopic || '').trim();
      const label = [topic, subtopic].filter((x, i, a) => x && a.indexOf(x) === i).join(' › ') || tx('Open topic', 'टॉपिक खोलें');
      return `<button type="button" class="sn-topic" onclick="navigate('chapter', {subject:${nbJsAttr(selected.key)}, chapter:${nbJsAttr(c.name)}})">
        <span class="sn-topic-dot" aria-hidden="true">•</span><span class="sn-topic-label">${escapeHtml(label)}</span><span class="sn-topic-count">${nbModuleQCount(m)} ${tx('Qs', 'सवाल')}</span><span aria-hidden="true">›</span>
      </button>`;
    }).join('');
    return `<section class="sn-chapter ${open ? 'open' : ''}">
      <button type="button" class="sn-chapter-toggle" aria-expanded="${!!open}" onclick="shToggleCatalogChapter(${nbJsAttr(c.id)})">
        <span class="sn-chapter-mark" aria-hidden="true">${open ? '−' : '+'}</span>
        <span class="sn-chapter-main"><strong>${escapeHtml(c.name)}</strong><small>${c.mods.length} ${tx('topics', 'टॉपिक')} · ${c.qs} ${tx('questions', 'सवाल')}</small></span>
        <span class="sn-chevron" aria-hidden="true">${open ? '⌄' : '›'}</span>
      </button>
      ${open ? `<div class="sn-topic-list">${topicRows || `<p class="sn-empty-topic">${tx('No topics available yet.', 'अभी कोई टॉपिक उपलब्ध नहीं है।')}</p>`}</div><div class="sn-chapter-action"><button type="button" class="btn-action-sm" onclick="navigate('chapter', {subject:${nbJsAttr(selected.key)}, chapter:${nbJsAttr(c.name)}})">${tx('Open chapter', 'अध्याय खोलें')} →</button></div>` : ''}
    </section>`;
  }).join('');
  v.innerHTML = `
    <div class="sc-head"><div><h1>${tx('Subjects', 'विषय')}</h1><p>${groups.length ? tx(`${groups.length} subjects · ${total} questions in this workspace`, `${groups.length} विषय · इस workspace में ${total} सवाल`) : tx('No questions available yet', 'अभी सवाल उपलब्ध नहीं हैं')}</p></div>
      <button type="button" class="btn-action-sm" onclick="navigate('taxonomy_explorer')">🔎 ${tx('Question Bank', 'प्रश्न बैंक')}</button>
    </div>
    ${groups.length ? `<nav class="sn-subject-tabs" aria-label="${tx('Main subjects', 'मुख्य विषय')}" role="tablist">${subjectTabs}</nav>
      <section class="sn-topic-panel"><div class="sn-panel-head"><div><h2>${selected ? escapeHtml(subjectLabel(selected.key)) : tx('Choose a subject', 'विषय चुनें')}</h2><p>${selected ? tx('Choose a chapter to expand its topics.', 'टॉपिक्स देखने के लिए अध्याय खोलें।') : ''}</p></div>${selected ? `<span class="sn-total">${selected.qs} ${tx('questions', 'सवाल')}</span>` : ''}</div>
        ${chapters.length ? `<div class="sn-chapter-list">${chapterRows}</div>` : studyEmptyState()}
      </section>` : studyEmptyState()}`;
}

/* ---------- Question Bank ---------- */
let QBState = { q: '', show: 20, pyq: false };
function qbBaseFilters(extra = {}) { const f = { ...ActiveTaxonomyFilters, ...extra }; Object.keys(f).forEach(k => { if (!f[k]) delete f[k]; }); return f; }
function qbQuery(f) { return CurriculumContext.isActive() ? CurriculumContext.query(f) : IndexEngine.query(f); }
function qbText(q) { const m = q.metadata || {}; return [q.QUESTION_EN, q.QUESTION_HI, m.subject, m.chapter, m.topic, m.subtopic, m.exam, m.year, q.originalQNo].join(' ').toLowerCase(); }
function qbFiltered() {
  let rows = qbQuery(qbBaseFilters());
  if (QBState.pyq) rows = rows.filter(q => pyqStatusOf(q) === 'PYQ');
  const terms = QBState.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length) rows = rows.filter(q => { const t = qbText(q); return terms.every(w => t.includes(w)); });
  return rows;
}
function qbCardHtml(q) {
  const m = q.metadata || {}; const cid = String(q.canonicalQId || '');
  const ans = String(q.answer || '').toUpperCase(); const pyq = pyqStatusOf(q) === 'PYQ';
  const path = [m.chapter, m.topic, m.subtopic].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' › ');
  const diff = m.difficultySource === 'DEFAULT' ? '' : String(m.difficulty || '').toUpperCase();
  const opts = (q.options || []).map(o => { const L = String(o.letter || '').toUpperCase(); return `<li class="${L === ans ? 'ok' : ''}"><b>${escapeHtml(L)}</b><span>${escapeHtml(o.en || o.hi || '')}${o.hi && o.en && o.hi !== o.en ? `<small>${escapeHtml(o.hi)}</small>` : ''}</span>${L === ans ? `<em>✓ ${tx('Answer', 'उत्तर')}</em>` : ''}</li>`; }).join('');
  return `<article class="qb-card">
    <div class="qb-meta"><span class="qb-sub">${escapeHtml(subjectLabel(m.subject))}</span>${pyq ? `<span class="qb-pyq">PYQ</span>` : ''}${diff ? `<span class="qb-diff ${diff.toLowerCase()}">${escapeHtml(diff.charAt(0) + diff.slice(1).toLowerCase())}</span>` : ''}<span class="qb-src">${escapeHtml([m.exam, m.year].filter(Boolean).join(' '))}${q.originalQNo ? ` · Q${escapeHtml(q.originalQNo)}` : ''}</span></div>
    ${path ? `<div class="qb-path">${escapeHtml(path)}</div>` : ''}
    <div class="qb-q">${escapeHtml(q.QUESTION_EN || q.QUESTION_HI || '')}${q.QUESTION_EN && q.QUESTION_HI ? `<small>${escapeHtml(q.QUESTION_HI)}</small>` : ''}</div>
    <details class="qb-more"><summary>${tx('Show options & answer', 'विकल्प और उत्तर देखें')}</summary><ol class="qb-opts">${opts}</ol>${q.EXPLANATION ? `<div class="qb-exp">${escapeHtml(q.EXPLANATION)}</div>` : ''}</details>
    <div class="qb-actions">${bookmarkButtonHtml(cid)}<button type="button" class="btn-action-sm qb-practice" onclick="startSinglePractice(${nbJsAttr(cid)})">${tx('Practice', 'अभ्यास')} ➔</button></div>
  </article>`;
}
function qbRenderList() {
  const box = document.getElementById('qbList'); if (!box) return;
  const rows = qbFiltered(); const shown = rows.slice(0, QBState.show);
  const c = document.getElementById('qbCount'); if (c) c.textContent = tx(`${rows.length} question${rows.length === 1 ? '' : 's'}`, `${rows.length} सवाल`);
  box.innerHTML = rows.length ? `${shown.map(qbCardHtml).join('')}
    ${rows.length > shown.length ? `<button type="button" class="qb-moreBtn" onclick="QBState.show+=20; qbRenderList()">${tx(`Show 20 more (${rows.length - shown.length} left)`, `20 और दिखाएँ (${rows.length - shown.length} बाकी)`)}</button>` : `<p class="qb-end">${tx('End of list', 'सूची समाप्त')}</p>`}`
    : studyEmptyState(QBState.q || QBState.pyq || Object.values(ActiveTaxonomyFilters).some(Boolean) ? 'bank' : '');
  const s = document.getElementById('qbStart'); if (s) s.disabled = !rows.length;
}
let QBSearchTimer = null;
function qbSearch(val) { QBState.q = String(val || ''); QBState.show = 20; clearTimeout(QBSearchTimer); QBSearchTimer = setTimeout(qbRenderList, 150); }
function qbSet(key, val) { if (key === 'pyq') QBState.pyq = !QBState.pyq; else ActiveTaxonomyFilters[key] = ActiveTaxonomyFilters[key] === val ? '' : val; QBState.show = 20; renderView(); }
function qbClear() { ActiveTaxonomyFilters = { subject: '', type: '', difficulty: '', length: '', examId: '' }; QBState = { q: '', show: 20, pyq: false }; renderView(); }
function qbStartPractice() { const rows = qbFiltered(); if (rows.length) startSinglePractice(rows[0].canonicalQId); }
function renderTaxonomyExplorer(v, params = {}) {
  if (params.filter) { ActiveTaxonomyFilters = { ...ActiveTaxonomyFilters, ...params.filter }; }
  const chip = (key, val, label, n) => `<button type="button" class="mr-chip ${(key === 'pyq' ? QBState.pyq : ActiveTaxonomyFilters[key] === val) ? 'on' : ''}" aria-pressed="${key === 'pyq' ? QBState.pyq : ActiveTaxonomyFilters[key] === val}" onclick="qbSet('${key}', ${nbJsAttr(val)})">${escapeHtml(label)}${n != null ? ` <small>${n}</small>` : ''}</button>`;
  const countBy = (rows, fn) => { const m = new Map(); rows.forEach(q => { const k = fn(q); if (k) m.set(k, (m.get(k) || 0) + 1); }); return Array.from(m.entries()).sort((a, b) => b[1] - a[1]); };
  const noSubject = qbQuery(qbBaseFilters({ subject: '' }));
  const subjects = countBy(noSubject, q => String(q.metadata?.subject || '').trim());
  const noExam = qbQuery(qbBaseFilters({ examId: '' }));
  const exams = countBy(noExam, q => String(q.metadata?.examId || '').trim());
  const examName = id => UniversalExamRegistry.registry.get(id)?.examName || id;
  const base = qbQuery(qbBaseFilters());
  const pyqN = base.filter(q => pyqStatusOf(q) === 'PYQ').length;
  const extraOn = !!(ActiveTaxonomyFilters.type || ActiveTaxonomyFilters.difficulty);
  const anyFilter = !!(ActiveTaxonomyFilters.subject || ActiveTaxonomyFilters.examId || extraOn || QBState.pyq || QBState.q);
  v.innerHTML = `
    <div class="nav-breadcrumb"><button onclick="navigate('home')">${tx('Home', 'होम')}</button><span class="sep">/</span><span>${tx('Question Bank', 'प्रश्न बैंक')}</span></div>
    <div class="sc-head"><div><h1>${tx('Question Bank', 'प्रश्न बैंक')}</h1><p>${tx('Search, read and bookmark every question in this workspace.', 'इस workspace के हर सवाल को खोजें, पढ़ें और bookmark करें।')}</p></div></div>
    <div class="qb-search"><span aria-hidden="true">🔎</span><input id="qbSearch" type="search" value="${escapeHtml(QBState.q)}" placeholder="${tx('Search question, topic, exam, year…', 'सवाल, टॉपिक, परीक्षा, वर्ष खोजें…')}" aria-label="${tx('Search questions', 'सवाल खोजें')}" oninput="qbSearch(this.value)" autocomplete="off"></div>
    ${subjects.length > 1 || ActiveTaxonomyFilters.subject ? `<div class="mr-chips qb-row" role="group" aria-label="${tx('Subject', 'विषय')}"><span class="mr-label">${tx('Subject', 'विषय')}</span>${subjects.map(([s, n]) => chip('subject', s, subjectLabel(s), n)).join('')}</div>` : ''}
    ${exams.length > 1 || ActiveTaxonomyFilters.examId ? `<div class="mr-chips qb-row" role="group" aria-label="${tx('Exam', 'परीक्षा')}"><span class="mr-label">${tx('Exam', 'परीक्षा')}</span>${exams.map(([e, n]) => chip('examId', e, examName(e), n)).join('')}</div>` : ''}
    <details class="pf-bar" ${extraOn ? 'open' : ''}><summary>${tx('More filters', 'और फ़िल्टर')}${extraOn ? ' •' : ''}</summary>
      <div class="mr-chips qb-row">${chip('pyq', '', tx('PYQ only', 'केवल PYQ'), pyqN)}${chip('type', 'numerical', tx('Numerical', 'संख्यात्मक'))}${chip('type', 'theory', tx('Theory', 'थ्योरी'))}${chip('difficulty', 'easy', tx('Easy', 'आसान'))}${chip('difficulty', 'moderate', tx('Moderate', 'मध्यम'))}${chip('difficulty', 'hard', tx('Hard', 'कठिन'))}</div></details>
    <div class="qb-bar"><strong id="qbCount" aria-live="polite"></strong>
      <span>${anyFilter ? `<button type="button" class="btn-action-sm" onclick="qbClear()">${tx('Clear', 'हटाएँ')} ✕</button>` : ''}<button type="button" id="qbStart" class="btn-nav primary qb-start" onclick="qbStartPractice()">${tx('Start practice', 'अभ्यास शुरू')} ➔</button></span></div>
    <div id="qbList" class="qb-list"></div>`;
  qbRenderList();
}

registerRouteViewState('subjects', {
  capture: () => ({ ...SubjectNavState }),
  restore: state => { SubjectNavState = state ? { ...state } : { selected: '', expanded: '' }; }
});
let QBWorkspaceId = '';
registerRouteViewState('taxonomy_explorer', {
  capture: () => ({ filters: { ...ActiveTaxonomyFilters }, bank: { ...QBState } }),
  restore: (state, fromHistory) => {
    const workspaceId = WorkspaceManager.current().id;
    const switchedWorkspace = QBWorkspaceId && QBWorkspaceId !== workspaceId;
    if (switchedWorkspace) {
      ActiveTaxonomyFilters = { subject: '', type: '', difficulty: '', length: '', examId: '' };
      QBState = { q: '', show: 20, pyq: false };
    }
    // Explicit exam/topic entry points take precedence over remembered filters.
    if (state && (fromHistory || switchedWorkspace)) {
      ActiveTaxonomyFilters = { ...state.filters }; QBState = { ...state.bank };
    }
    QBWorkspaceId = workspaceId;
  }
});
