/* =========================================================================
   DATA CLEANUP (V2.9.0) — find and fix problems left by the old import
   engine (before V2.5.0): invented exam/year/shift, misread exam names,
   bad answer format, English text in Hindi options, answer always "A".
   Every fix goes through DataCore (copy → check → backup → save).
   ========================================================================= */
const CLEAN_INVENTED_EXAM = 'railway-official-pyq';
const CLEAN_KEEP_LAST = /none of (these|the above)|all of (these|the above)|both|neither|cannot be determined|इनमें से कोई नहीं|उपरोक्त सभी|इनमें से सभी|दोनों/i;
var CleanupState = { scan: null, didBackup: false, msg: '', msgKind: '' };

function cleanSubjective(q) { return String(q.metadata?.questionFormat || q.questionFormat || '').toUpperCase() === 'SUBJECTIVE'; }
function cleanModules(mods) { return WorkspaceManager.filterModules(mods || AppModules).filter(m => m.source !== 'server'); }
function cleanRef(m, q) { return { moduleId: m.moduleId, id: String(q.canonicalQId), no: q.originalQNo, topic: m.topicTitle || m.moduleId }; }
// Stable, per-question shuffle (same result every time for the same id).
function cleanPermutation(id, n) {
  const idx = [...Array(n).keys()]; let h = (parseInt(importHash(id).slice(0, 6), 36) | 0) || 1;
  const next = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0); }; // xorshift32 — exact integer maths
  for (let i = 0; i < 3; i++) next();
  for (let i = n - 1; i > 0; i--) { const j = next() % (i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return idx;
}
function cleanShuffled(q) {
  const opts = q.options || []; if (opts.length !== 4) return null;
  const movable = opts.map((o, i) => CLEAN_KEEP_LAST.test(`${o.en} ${o.hi}`) ? -1 : i).filter(i => i >= 0);
  if (movable.length < 2) return null;
  if (/\b(option|विकल्प)\s*\(?[a-d]\)?/i.test(q.EXPLANATION || '')) return null; // explanation names a letter — leave it
  const perm = cleanPermutation(String(q.canonicalQId), movable.length);
  const out = opts.map(o => ({ ...o }));
  movable.forEach((slot, k) => { const from = opts[movable[perm[k]]]; out[slot] = { ...from, letter: opts[slot].letter }; });
  const oldIdx = opts.findIndex(o => String(o.letter).toUpperCase() === String(q.answer).toUpperCase());
  const newIdx = out.findIndex(o => o.en === opts[oldIdx]?.en && o.hi === opts[oldIdx]?.hi);
  if (oldIdx < 0 || newIdx < 0) return null;
  return { options: out, answer: out[newIdx].letter };
}

/* ---------- scan ---------- */
function cleanupScan() {
  const groups = {
    answer: { title: 'उत्तर का format गलत', help: 'जैसे "(C)" या "b" — app इसे सही उत्तर नहीं मानता, इसलिए सवाल हमेशा गलत गिना जाता है।', fix: 'A–D में बदलें', items: [] },
    answerManual: { title: 'उत्तर समझ नहीं आया', help: 'इन्हें Data Control में खोलकर सही उत्तर चुनें।', items: [], manual: true },
    hindi: { title: 'Hindi option में अंग्रेज़ी/फ़ालतू text', help: 'पुराना import explanation की "A:" जैसी लाइन को Hindi option में डाल देता था।', fix: 'Hindi में English वाला option रखें', items: [] },
    examMisread: { title: 'Exam गलत पहचाना गया', help: 'पुराना engine नाम के टुकड़े मिलाता था, जैसे "SSC MTS" को "SSC JE" मान लेना।', fix: 'सही exam रखें', items: [] },
    examInvented: { title: 'Exam और year अपने-आप भरे गए', help: 'File में EXAM_NAME/YEAR नहीं था, तो पुराने engine ने "Railway Official PYQ 2024" भर दिया। हर topic के लिए सही exam और year चुनें।', items: [], perTopic: true },
    yearBad: { title: 'Year सही नहीं', help: 'Year 4 अंकों का होना चाहिए, जैसे 2023।', items: [], perTopic: true },
    shift: { title: '"Shift-I" अपने-आप भरा गया', help: 'File में shift नहीं था। गलत shift दिखाने से अच्छा है ख़ाली रखें।', fix: 'Shift ख़ाली करें', items: [] },
    subtopic: { title: '"General Subtopic" अपने-आप भरा गया', help: 'File में sub-topic नहीं था।', fix: '"General" लिखें', items: [] },
    sameLetter: { title: 'लगभग हर सही उत्तर एक ही option पर', help: 'Student अंदाज़े से वही option दबाकर नंबर ले सकता है। Options का क्रम बदलने से सही उत्तर भी साथ बदल जाता है; "None of these" जैसे options अपनी जगह रहते हैं।', fix: 'Options का क्रम बदलें', items: [], perTopicInfo: true },
    duplicates: { title: 'एक जैसा सवाल दो topics में', help: 'देखकर तय करें कि कौन सा रखना है (Data Control में delete करें)।', items: [], manual: true }
  };
  const mods = cleanModules();
  const fp = new Map();
  mods.forEach(m => {
    const qs = (m.groups || []).flatMap(g => g.questions || []);
    const letters = {};
    qs.forEach(q => {
      const md = q.metadata || {}, ref = cleanRef(m, q);
      if (!cleanSubjective(q) && !/^[A-D]$/.test(String(q.answer || ''))) {
        const a = normalizeAnswerLetter(q.answer);
        if (a.letter) groups.answer.items.push({ ...ref, from: String(q.answer), to: a.letter }); else groups.answerManual.items.push({ ...ref, from: String(q.answer || '(ख़ाली)') });
      }
      const badHi = (q.options || []).filter(o => o.hi && o.en && o.hi !== o.en && !/[ऀ-ॿ]/.test(o.hi) && /[A-Za-z]{3,}/.test(o.hi));
      if (badHi.length) groups.hindi.items.push({ ...ref, from: badHi.map(o => `${o.letter}: ${o.hi}`).join(' · ').slice(0, 80), to: badHi.map(o => `${o.letter}: ${o.en}`).join(' · ').slice(0, 80) });
      const raw = String(q.examInfo || '').trim();
      if (md.examId === CLEAN_INVENTED_EXAM && (!raw || raw === 'Railway Official PYQ')) groups.examInvented.items.push({ ...ref, from: `${md.exam || 'Railway Official PYQ'} ${md.year || ''}`.trim() });
      else if (raw && md.examId) {
        const strict = deriveExamIdStrict(raw);
        if (strict && strict !== md.examId && examDisplayName(md.examId, '') !== raw && UniversalExamRegistry.deriveExamIdLegacy(raw) === md.examId) groups.examMisread.items.push({ ...ref, from: md.exam || md.examId, to: examDisplayName(strict, raw), toId: strict, raw });
      }
      if (md.examId !== CLEAN_INVENTED_EXAM && md.year && !/^(19|20)\d{2}$/.test(String(md.year))) groups.yearBad.items.push({ ...ref, from: String(md.year) });
      if ((md.shift === 'Shift-I') && (!q.paperDate || q.paperDate === 'Shift-I')) groups.shift.items.push({ ...ref, from: 'Shift-I', to: '(ख़ाली)' });
      if (md.subtopic === 'General Subtopic') groups.subtopic.items.push({ ...ref, from: 'General Subtopic', to: 'General' });
      if (!cleanSubjective(q) && /^[A-D]$/.test(String(q.answer || ''))) letters[q.answer] = (letters[q.answer] || 0) + 1;
      const f = importFingerprint(q); if (f.length > 12) { if (fp.has(f) && fp.get(f).moduleId !== m.moduleId) groups.duplicates.items.push({ ...ref, from: `= ${fp.get(f).topic} Q.${fp.get(f).no}` }); else if (!fp.has(f)) fp.set(f, ref); }
    });
    const total = Object.values(letters).reduce((a, b) => a + b, 0), top = Object.entries(letters).sort((a, b) => b[1] - a[1])[0];
    if (total >= 8 && top && top[1] / total >= 0.85) {
      const can = qs.filter(q => cleanShuffled(q)).length;
      if (can) groups.sameLetter.items.push({ moduleId: m.moduleId, topic: m.topicTitle || m.moduleId, id: m.moduleId, no: '', from: `${top[1]} / ${total} उत्तर "${top[0]}"`, to: `${can} सवालों के options बदलेंगे` });
    }
  });
  const total = Object.values(groups).reduce((n, g) => n + g.items.length, 0);
  CleanupState.scan = { groups, total, at: Date.now() };
  return CleanupState.scan;
}

/* ---------- fixes ---------- */
function cleanApplyTo(mods, kind, extra = {}) {
  const scan = CleanupState.scan; const items = scan?.groups[kind]?.items || [];
  const byId = DataCore.questionsById(mods);
  const modById = new Map(mods.map(m => [m.moduleId, m]));
  let n = 0;
  const now = new Date().toISOString();
  const touch = q => { q.metadata = q.metadata || {}; q.metadata.cleanedAt = now; n++; };
  if (kind === 'sameLetter') {
    items.forEach(it => { const m = modById.get(it.moduleId); (m?.groups || []).forEach(g => (g.questions || []).forEach(q => { const s = cleanShuffled(q); if (s) { q.options = s.options; q.answer = s.answer; touch(q); } })); });
    return n;
  }
  if (kind === 'examInvented' || kind === 'yearBad') {
    const { moduleId, examName, year } = extra;
    const examId = deriveExamIdStrict(examName);
    if (!examId) throw new Error('Exam का नाम लिखें।');
    if (!/^(19|20)\d{2}$/.test(String(year))) throw new Error('Year 4 अंकों में लिखें, जैसे 2023।');
    const name = examDisplayName(examId, examName);
    items.filter(it => it.moduleId === moduleId).forEach(it => { const hit = byId.get(it.id); if (!hit) return; const q = hit.q; q.examInfo = name; q.year = String(year); q.metadata.examId = examId; q.metadata.exam = name; q.metadata.year = String(year); touch(q); });
    const m = modById.get(moduleId);
    if (m && (!m.examId || m.examId === CLEAN_INVENTED_EXAM || kind === 'examInvented')) { m.examId = examId; m.examYear = String(year); }
    return n;
  }
  items.forEach(it => {
    const hit = byId.get(it.id); if (!hit) return; const q = hit.q, m = hit.m;
    if (kind === 'answer') { q.answer = it.to; touch(q); }
    if (kind === 'hindi') { (q.options || []).forEach(o => { if (o.hi && o.en && o.hi !== o.en && !/[ऀ-ॿ]/.test(o.hi) && /[A-Za-z]{3,}/.test(o.hi)) o.hi = o.en; }); touch(q); }
    if (kind === 'examMisread') {
      const oldId = q.metadata.examId; q.metadata.examId = it.toId; q.metadata.exam = it.to; q.examInfo = it.to; touch(q);
      if (m.examId === oldId) m.examId = it.toId;
    }
    if (kind === 'shift') { q.paperDate = ''; q.metadata.shift = ''; touch(q); }
    if (kind === 'subtopic') { q.metadata.subtopic = 'General'; touch(q); }
  });
  return n;
}
async function cleanupFix(kind, extra) {
  const label = CleanupState.scan?.groups[kind]?.title || kind;
  try {
    const n = await DataCore.mutate('सफ़ाई: ' + label, mods => cleanApplyTo(mods, kind, extra), { snapshot: CleanupState.didBackup ? false : 'सफ़ाई से पहले', allowNewIssues: false });
    CleanupState.didBackup = true;
    cleanupScan();
    CleanupState.msg = `✓ ${n} सवाल ठीक किए: ${label}`; CleanupState.msgKind = 'good';
  } catch (e) { CleanupState.msg = 'नहीं हुआ: ' + (e.message || e); CleanupState.msgKind = 'bad'; }
  cleanupPaint();
}
async function cleanupFixTopic(kind, moduleId) {
  const name = document.getElementById('clExam-' + moduleId)?.value.trim();
  const year = document.getElementById('clYear-' + moduleId)?.value.trim();
  return cleanupFix(kind, { moduleId, examName: name, year });
}
// Questions with nothing left to fix are marked as checked, so Health Check stops counting them.
async function cleanupFinish() {
  const scan = cleanupScan();
  const open = new Set(Object.entries(scan.groups).filter(([k]) => k !== 'sameLetter' && k !== 'duplicates').flatMap(([, g]) => g.items.map(i => i.id)));
  try {
    const n = await DataCore.mutate('सफ़ाई पूरी', mods => {
      let c = 0;
      cleanModules(mods).forEach(m => (m.groups || []).forEach(g => (g.questions || []).forEach(q => { if (!open.has(String(q.canonicalQId)) && !['IMPORTED', 'SERVER', 'CLEANED'].includes(q.metadata?.status)) { q.metadata = q.metadata || {}; q.metadata.status = 'CLEANED'; c++; } })));
      return c;
    }, { allowNewIssues: false });
    CleanupState.msg = `✓ ${n} सवाल जाँचे हुए माने गए।${open.size ? ` ${open.size} में अभी भी कुछ बाकी है।` : ''}`; CleanupState.msgKind = 'good';
  } catch (e) { CleanupState.msg = 'नहीं हुआ: ' + (e.message || e); CleanupState.msgKind = 'bad'; }
  cleanupPaint();
}

/* ---------- sheet ---------- */
function cleanupPaint() { const el = document.getElementById('cleanSheet'); if (el) el.innerHTML = cleanupHtml(); }
function cleanupHtml() {
  const s = CleanupState.scan || cleanupScan();
  const msg = CleanupState.msg ? `<div class="srv-msg ${CleanupState.msgKind}" role="status">${escapeHtml(CleanupState.msg)}</div>` : '';
  const examOptions = [...new Set([...UniversalExamRegistry.getAllExams().map(e => e.examName), ...Object.values(UniversalExamRegistry.knownProfiles).map(p => p.name)])].filter(n => n && n !== 'Railway Official PYQ').sort();
  const ex = it => `<li>${it.no ? `Q.${escapeHtml(it.no)} · ` : ''}${escapeHtml(it.topic)}: <s>${escapeHtml(it.from || '')}</s>${it.to ? ` → <b>${escapeHtml(it.to)}</b>` : ''}</li>`;
  const block = (k, g) => {
    if (!g.items.length) return '';
    let body = '';
    if (g.perTopic) {
      const topics = [...new Map(g.items.map(i => [i.moduleId, i])).values()];
      body = topics.map(t => { const n = g.items.filter(i => i.moduleId === t.moduleId).length; return `<div class="cl-topic"><b>${escapeHtml(t.topic)}</b> <small>(${n} सवाल, अभी: ${escapeHtml(t.from)})</small>
        <div class="cl-pick"><input id="clExam-${escapeHtml(t.moduleId)}" list="clExamList" placeholder="Exam का नाम, जैसे RRB NTPC" aria-label="Exam"><input id="clYear-${escapeHtml(t.moduleId)}" inputmode="numeric" maxlength="4" placeholder="Year" aria-label="Year"><button type="button" class="btn-action-sm" onclick="cleanupFixTopic('${k}', ${nbJsAttr(t.moduleId)})">लागू करें</button></div></div>`; }).join('');
    } else {
      body = `<ul>${g.items.slice(0, 6).map(ex).join('')}${g.items.length > 6 ? `<li>… और ${g.items.length - 6}</li>` : ''}</ul>`;
    }
    const action = g.fix ? `<button type="button" class="btn-nav primary cl-fix" onclick="cleanupFix('${k}')">${escapeHtml(g.fix)} (${g.items.length})</button>` : (g.manual ? `<button type="button" class="btn-action-sm" onclick="closeModal();openDataControlModal()">Data Control खोलें</button>` : '');
    return `<details class="cl-group ${g.manual || g.perTopic ? 'manual' : ''}" ${g.perTopic ? 'open' : ''}><summary><span class="cl-n">${g.items.length}</span><span><b>${escapeHtml(g.title)}</b><small>${escapeHtml(g.help)}</small></span></summary>${body}${action}</details>`;
  };
  const groupsHtml = Object.entries(s.groups).map(([k, g]) => block(k, g)).join('');
  const oldStyle = cleanModules().reduce((n, m) => n + (m.groups || []).reduce((x, g) => x + (g.questions || []).filter(q => !['IMPORTED', 'SERVER', 'CLEANED'].includes(q.metadata?.status)).length, 0), 0);
  return `${msg}
    <datalist id="clExamList">${examOptions.map(n => `<option value="${escapeHtml(n)}">`).join('')}</datalist>
    <div class="hc-sum ${s.total ? 'warn' : 'ok'}"><b>${s.total ? `${s.total} जगह सुधार की ज़रूरत` : '✓ कोई पुरानी गड़बड़ी नहीं मिली'}</b><span>${WorkspaceManager.current().name} · पुराने तरीके के ${oldStyle} सवाल जाँचे। हर सुधार से पहले अपने-आप backup बनता है।</span></div>
    ${groupsHtml}
    <div class="srv-actions"><button type="button" class="btn-nav" onclick="cleanupScan();cleanupPaint()">🔄 फिर जाँचें</button><button type="button" class="btn-nav primary" onclick="cleanupFinish()">✓ जाँच पूरी</button></div>
    <p class="srv-note">सुधार के बाद students तक पहुँचाने के लिए <b>☁️ Server (Admin)</b> में "जाँचें → भेजें" करें — बदले हुए सवाल अपने-आप "बदले" में आएँगे।</p>
    ${ServerState.session && CloudState.isAdmin !== false ? `<button type="button" class="btn-action-sm" onclick="closeModal();openServerSync()">☁️ Server (Admin) खोलें</button>` : ''}`;
}
function openCleanup() {
  closeDrawer();
  CleanupState.msg = ''; cleanupScan();
  openModal('🧹 पुराने data की सफ़ाई', `<div id="cleanSheet" class="srv cl" data-no-autofocus>${cleanupHtml()}</div>`);
}
