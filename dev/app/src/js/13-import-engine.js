/* =========================================================================
   V2.5.0 — Phase A1: strict import, stable IDs, exact exam/subject mapping
   Rules: nothing is guessed. A required field that is missing stops that
   question with its line number. Existing question IDs never change.
   ========================================================================= */
function importHash(str) {
  // cyrb53 — short, stable, non-cryptographic content hash
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) { const ch = s.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
function importNormText(v) { return String(v || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim(); }
// Same stem + same options = same question. Symbols, digits and decimals count.
function importFingerprint(q) {
  return importNormText(q.QUESTION_EN || q.QUESTION_HI) + '|' + (q.options || []).map(o => importNormText(o.en || o.hi)).join('|');
}
function importContentHash(q) {
  return importHash([importNormText(q.QUESTION_EN), importNormText(q.QUESTION_HI), ...(q.options || []).map(o => importNormText(o.en) + '/' + importNormText(o.hi)), String(q.answer || ''), importNormText(q.EXPLANATION)].join('§'));
}

/* ---------- exact subject / exam mapping ---------- */
function normalizeSubjectKey(raw) {
  const s = String(raw || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const w = s.split(/[^a-z0-9\u0900-\u097f]+/).filter(Boolean);
  const has = x => w.includes(x);
  if (has('computer')) return 'computer';
  if (has('math') || has('maths') || has('mathematics') || has('quant') || has('quantitative') || has('arithmetic') || s.includes('गणित')) return 'maths';
  if (has('political')) return s;
  if (has('science') || has('physics') || has('chemistry') || has('biology') || s.includes('विज्ञान')) return 'science';
  if (has('reasoning') || has('intelligence') || s === 'mental ability' || s.includes('तर्क')) return 'reasoning';
  if (has('english')) return 'english';
  return s;
}
function deriveExamIdStrict(rawExamName) {
  const raw = String(rawExamName || '').trim();
  if (!raw) return '';
  const s = slugify(raw);
  const t = s.split('-').filter(Boolean);
  const has = x => t.includes(x);
  const pair = (a, b) => t.some((x, i) => x === a && t[i + 1] === b);
  if (has('ssc') && has('cgl')) return 'ssc-cgl';
  if (has('ssc') && has('chsl')) return 'ssc-chsl';
  if (has('ssc') && has('je')) return 'ssc-je';
  if (t.length === 1 && has('ssc')) return 'ssc-general';
  if (has('ntpc')) return 'rrb-ntpc';
  if (has('alp')) return 'rrb-alp';
  if (pair('group', 'd') || has('groupd')) return 'rrb-group-d';
  if (has('rrb') && has('je')) return 'rrb-je';
  if (has('rpf') && (has('si') || pair('s', 'i') || pair('sub', 'inspector'))) return 'rpf-si';
  if (has('rpf') && has('constable')) return 'rpf-constable';
  if (has('upsc') && (t.length === 1 || has('cse') || has('ias') || has('civil') || has('prelims'))) return 'upsc-cse';
  if (has('bpsc') && (t.length === 1 || has('cce'))) return 'bpsc-cce';
  if (t.length === 1 && has('dpsc')) return 'dpsc';
  return s;
}
function examDisplayName(examId, raw) { return UniversalExamRegistry.knownProfiles[examId]?.name || String(raw || examId).trim(); }
UniversalExamRegistry.deriveExamIdLegacy = UniversalExamRegistry.deriveExamId.bind(UniversalExamRegistry);
// Keep a stored exam id unless the question's exam name was really changed (e.g. by "Fix exam/year").
function syncKeepExamId(q, priorMeta) {
  const id = priorMeta?.examId; if (!id) return '';
  const nameNow = String(q.EXAM_NAME || q.examInfo || priorMeta.exam || '').trim();
  if (!nameNow || nameNow === priorMeta.exam || examDisplayName(id, priorMeta.exam) === nameNow) return id;
  try { if (UniversalExamRegistry.deriveExamIdLegacy(nameNow) === id) return id; } catch (_) {}
  return '';
}
UniversalExamRegistry.deriveExamId = function (rawExamName) { return deriveExamIdStrict(rawExamName) || 'general-exam'; };
UniversalExamRegistry.rebuildFromIndex = function () {
  this.registry.clear();
  for (const q of IndexEngine.registry.values()) {
    const m = q.metadata || {};
    const p = this.getOrRegisterExam(m.exam || m.examId, m.examBoard || '', m.year || '', m.examId || '');
    if (m.subject) p.subjects.add(m.subject);
  }
};

/* ---------- block parser ---------- */
// Import-screen defaults (V2.10.0): values the admin types once on the import
// screen fill only the fields a block leaves empty. The file always wins.
const IMPORT_DEFAULT_KEYS = ['EXAM_NAME', 'YEAR', 'SHIFT', 'SUBJECT', 'CHAPTER', 'TOPIC'];
const IMPORT_DEFAULT_LABEL = { EXAM_NAME: 'Exam', YEAR: 'Year', SHIFT: 'Shift', SUBJECT: 'Subject', CHAPTER: 'Chapter', TOPIC: 'Topic' };
function importApplyDefaults(f, defaults, bi, warnings, filledCount) {
  const alias = { EXAM_NAME: ['EXAM_NAME', 'EXAM'], SHIFT: ['SHIFT', 'PAPER', 'PAPER_DATE'] };
  IMPORT_DEFAULT_KEYS.forEach(k => {
    const def = String((defaults || {})[k] || '').trim(); if (!def) return;
    const keys = alias[k] || [k];
    const have = keys.map(x => String(f[x] || '').trim()).find(Boolean);
    if (!have) { f[k] = def; filledCount[k] = (filledCount[k] || 0) + 1; }
    else if (k !== 'TOPIC' && importNormText(have) !== importNormText(def)) warnings.push(`Block ${bi + 1}: file में ${IMPORT_DEFAULT_LABEL[k]} "${have.slice(0, 40)}" है, ऊपर "${def.slice(0, 40)}" भरा — file वाला लिया`);
  });
}
const IMPORT_FIELDS = new Set(['SOURCE_QUESTION_NO', 'QUESTION_NO', 'Q_NO', 'QUESTION_ID', 'EXAM_NAME', 'EXAM', 'EXAM_BOARD', 'YEAR', 'SHIFT', 'PAPER', 'PAPER_DATE',
  'SUBJECT', 'CHAPTER', 'TOPIC', 'SUB_TOPIC', 'SUBTOPIC', 'SUB_CONCEPT', 'CONCEPT', 'FORMULA', 'COURSE', 'TYPE', 'QUESTION_BASE', 'CATEGORY', 'DIFFICULTY',
  'SOURCE_TYPE', 'QUESTION_SOURCE', 'SOURCE', 'QUESTION_EN', 'QUESTION_HI', 'QUESTION', 'A_EN', 'B_EN', 'C_EN', 'D_EN', 'A_HI', 'B_HI', 'C_HI', 'D_HI', 'A', 'B', 'C', 'D',
  'ANSWER', 'SOURCE_ANSWER', 'EXPLANATION_EN', 'EXPLANATION_HI', 'EXPLANATION', 'SOLUTION', 'SOLUTION_EN', 'SOLUTION_HI', 'CALCULATION', 'HINT', 'HINT_1', 'HINT_2', 'NOTE',
  'CURRICULUM_ID', 'BOARD_ID', 'CLASS_ID', 'STREAM_ID', 'SUBJECT_ID', 'CHAPTER_ID', 'TOPIC_ID', 'LEARNING_OUTCOME_ID', 'LEARNING_OUTCOME', 'TAGS', 'MARKS']);
const IMPORT_LONG = /^(QUESTION|QUESTION_EN|QUESTION_HI|EXPLANATION|EXPLANATION_EN|EXPLANATION_HI|SOLUTION|SOLUTION_EN|SOLUTION_HI|CALCULATION|HINT|HINT_1|HINT_2|NOTE)$/;
const IMPORT_AFTER_ANSWER = /^(EXPLANATION|EXPLANATION_EN|EXPLANATION_HI|SOLUTION|SOLUTION_EN|SOLUTION_HI|CALCULATION|HINT|HINT_1|HINT_2|NOTE)$/;
function importParseBlock(text, firstLine) {
  const lines = String(text).split(/\r?\n/);
  const suffixed = lines.some(l => /^\s*[A-D]_(EN|HI)\s*:/i.test(l));
  const fields = {}, lineOf = {}, warnings = [];
  let cur = null;
  lines.forEach((line, i) => {
    const ln = firstLine + i;
    const m = line.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*:\s?(.*)$/);
    if (m) {
      const key = m[1].toUpperCase();
      const letter = /^[A-D]$/.test(key);
      let starts = false;
      if (IMPORT_FIELDS.has(key)) {
        // A:/B:/C:/D: are options only in old-style blocks, never inside an explanation.
        starts = letter ? (m[1] === key && !suffixed && !(cur && IMPORT_AFTER_ANSWER.test(cur))) : true;
      } else if (/^[A-Z][A-Z0-9_]{2,}$/.test(m[1]) && !(cur && IMPORT_LONG.test(cur))) {
        starts = true; // unknown CAPS field: kept separately, ignored
      }
      if (starts && fields[key] !== undefined) {
        warnings.push(`Line ${ln}: ${key} दोबारा लिखा है — इसे पिछले हिस्से का text माना`);
        starts = false;
      }
      if (starts) { cur = key; fields[key] = m[2]; lineOf[key] = ln; return; }
    }
    const t = line.trim();
    if (!cur) { if (t) warnings.push(`Line ${ln}: field के बिना लिखा text छोड़ा गया`); return; }
    if (!t && !IMPORT_LONG.test(cur)) return;
    fields[cur] += '\n' + t;
  });
  Object.keys(fields).forEach(k => { fields[k] = String(fields[k]).replace(/\n{3,}/g, '\n\n').trim(); });
  return { fields, lineOf, warnings, suffixed };
}
function normalizeAnswerLetter(raw) {
  const s = String(raw || '').normalize('NFKC').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!s) return { letter: '', note: '' };
  let m = s.match(/^(?:OPTION|OPT|ANS|ANSWER|विकल्प|उत्तर)?\s*[:\-.]?\s*\(?\s*([A-D])\s*\)?\s*\.?$/);
  if (m) return { letter: m[1], note: '' };
  m = s.match(/^(?:OPTION|OPT|ANS|ANSWER|विकल्प|उत्तर)?\s*[:\-.]?\s*\(?\s*([1-4])\s*\)?\s*\.?$/);
  if (m) return { letter: 'ABCD'[Number(m[1]) - 1], note: `ANSWER ${m[1]} को ${'ABCD'[Number(m[1]) - 1]} माना` };
  return { letter: '', note: '' };
}
function importQuestionIdFor({ examId, year, shift, subject, topicSlug, qno, fp, boardPrefix }) {
  const parts = ['Q', examId || 'board', year || 'na'];
  if (shift) parts.push(slugify(shift));
  parts.push(slugify(subject) || 'subject', topicSlug || 'topic', qno ? String(qno) : 'h' + importHash(fp));
  const id = parts.filter(Boolean).join('-');
  return boardPrefix ? `${boardPrefix}-${id}` : id;
}

/* ---------- import engine ---------- */
const ImportEngine = {
  version: '4.0-STRICT-MERGE',

  async analyzeTxt(file, manualTopicOverride = '', defaults = {}) {
    if (isImportEngineLocked) throw new Error('दूसरा import अभी चल रहा है। थोड़ी देर बाद कोशिश करें।');
    isImportEngineLocked = true;
    try {
      const text = await file.text();
      const ws = WorkspaceManager.current();
      const isBoard = ws.type === 'BOARD';
      const startRe = /===\s*QUESTION START\s*===/ig;
      const starts = []; let mm;
      while ((mm = startRe.exec(text))) starts.push({ index: mm.index, end: startRe.lastIndex });
      if (!starts.length) throw new Error('File में "=== QUESTION START ===" वाला कोई block नहीं मिला।');
      const lineAt = idx => text.slice(0, idx).split('\n').length;
      const manualTopic = String(manualTopicOverride || '').trim();
      const errors = [], warnings = [], items = [];
      const filledCount = {};

      starts.forEach((s, bi) => {
        const nextStart = bi + 1 < starts.length ? starts[bi + 1].index : text.length;
        let body = text.slice(s.end, nextStart);
        const endM = body.match(/===\s*QUESTION END\s*===/i);
        if (endM) body = body.slice(0, endM.index); else warnings.push(`Block ${bi + 1}: "=== QUESTION END ===" नहीं मिला — अगले block तक का text लिया`);
        const blockLine = lineAt(s.index);
        const { fields: f, warnings: w } = importParseBlock(body, lineAt(s.end));
        w.forEach(x => warnings.push(`Block ${bi + 1} — ${x}`));
        importApplyDefaults(f, defaults, bi, warnings, filledCount);
        const errs = [];
        const need = (ok, msg) => { if (!ok) errs.push(msg); };
        const examRaw = f.EXAM_NAME || f.EXAM || '';
        const yearRaw = String(f.YEAR || '').trim();
        const subjectRaw = f.SUBJECT || '';
        const topicRaw = f.TOPIC || manualTopic || '';
        if (!isBoard) { need(examRaw, 'EXAM_NAME नहीं है'); need(/^(19|20)\d{2}$/.test(yearRaw), yearRaw ? `YEAR "${yearRaw}" सही नहीं (जैसे 2024 लिखें)` : 'YEAR नहीं है'); }
        need(subjectRaw, 'SUBJECT नहीं है');
        need(f.CHAPTER, 'CHAPTER नहीं है');
        need(topicRaw, 'TOPIC नहीं है');
        const stemEn = f.QUESTION_EN || f.QUESTION || '', stemHi = f.QUESTION_HI || '';
        need(stemEn || stemHi, 'सवाल का text (QUESTION_EN / QUESTION_HI) नहीं है');
        const subjective = String(f.TYPE || '').toUpperCase().trim() === 'SUBJECTIVE';
        const options = ['A', 'B', 'C', 'D'].map(L => { const en = f[L + '_EN'] || f[L] || ''; const hi = f[L + '_HI'] || ''; return { letter: L, en, hi: hi || en }; });
        let answer = '';
        if (!subjective) {
          const missing = options.filter(o => !o.en && !o.hi).map(o => o.letter);
          need(!missing.length, `Option ${missing.join(', ')} नहीं है`);
          const a = normalizeAnswerLetter(f.ANSWER || f.SOURCE_ANSWER);
          if (!f.ANSWER && !f.SOURCE_ANSWER) errs.push('ANSWER नहीं है');
          else if (!a.letter) errs.push(`ANSWER "${String(f.ANSWER || f.SOURCE_ANSWER).slice(0, 20)}" समझ नहीं आया (A, B, C या D लिखें)`);
          else { answer = a.letter; if (a.note) warnings.push(`Block ${bi + 1}: ${a.note}`); }
        }
        const qnoDigits = String(f.SOURCE_QUESTION_NO || f.QUESTION_NO || f.Q_NO || '').replace(/\D/g, '');
        const qno = qnoDigits ? parseInt(qnoDigits, 10) : null;
        let explicitId = String(f.QUESTION_ID || '').trim();
        if (explicitId && !/^[A-Za-z0-9._:-]{3,120}$/.test(explicitId)) { errs.push('QUESTION_ID में सिर्फ़ अक्षर, अंक और - _ . : चल सकते हैं'); explicitId = ''; }
        items.push({ bi, blockLine, f, errs, examRaw, yearRaw, subjectRaw, topicRaw, stemEn, stemHi, options, answer, subjective, qno, explicitId });
      });

      const filledMsg = Object.entries(filledCount).map(([k, n]) => `${IMPORT_DEFAULT_LABEL[k]} ${n}`).join(', ');
      if (filledMsg) warnings.unshift(`ऊपर भरे मान से लिया (file में खाली था): ${filledMsg} सवाल`);
      const firstOk = items.find(x => !x.errs.length) || items[0];
      const moduleSubject = normalizeSubjectKey(firstOk.subjectRaw) || 'general';
      const topicTitle = manualTopic || String(firstOk.topicRaw || '').trim() || file.name.replace(/\.[^.]+$/, '');
      const topicSlug = slugify(topicTitle) || 'topic';
      const moduleId = isBoard ? `board-cbse-class10-${topicSlug}` : `${moduleSubject}-${topicSlug}-class-test`;
      const existingModule = AppModules.find(m => WorkspaceManager.matches(m) && m.moduleId === moduleId) || null;
      const existingQs = existingModule ? (existingModule.groups || []).flatMap(g => g.questions || []) : [];
      const exById = new Map(existingQs.map(q => [String(q.canonicalQId), q]));
      const qnoCount = new Map(); existingQs.forEach(q => qnoCount.set(q.originalQNo, (qnoCount.get(q.originalQNo) || 0) + 1));
      const exByQno = new Map(existingQs.filter(q => qnoCount.get(q.originalQNo) === 1).map(q => [q.originalQNo, q]));
      const exByFp = new Map(existingQs.map(q => [importFingerprint(q), q]));
      const ownerOf = new Map();
      AppModules.forEach(m => (m.groups || []).forEach(g => (g.questions || []).forEach(q => ownerOf.set(String(q.canonicalQId), m))));
      const wsFp = new Map();
      WorkspaceManager.filterModules(AppModules).forEach(m => { if (m.moduleId === moduleId) return; (m.groups || []).forEach(g => (g.questions || []).forEach(q => wsFp.set(importFingerprint(q), m))); });

      const questions = [], seenIds = new Map(), seenFp = new Map(), matched = new Set();
      const subjects = new Set(), topics = new Set(), examYears = new Set();
      const duplicateExternal = [], duplicateBatch = [], stats = { new: 0, changed: 0, unchanged: 0 };
      const boardPrefix = isBoard ? `B-${BoardCurriculumRegistry.PROFILE.boardId}-${BoardCurriculumRegistry.PROFILE.classId}` : '';

      items.forEach((it, idx) => {
        const f = it.f;
        const subjectKey = normalizeSubjectKey(it.subjectRaw);
        const examId = isBoard ? '' : deriveExamIdStrict(it.examRaw);
        const examName = isBoard ? '' : examDisplayName(examId, it.examRaw);
        const shift = String(f.SHIFT || f.PAPER || f.PAPER_DATE || '').trim();
        const difficultyRaw = String(f.DIFFICULTY || '').toUpperCase();
        const difficulty = /EASY/.test(difficultyRaw) ? 'EASY' : /HARD|TOUGH|DIFFICULT/.test(difficultyRaw) ? 'HARD' : /MODERATE|MEDIUM/.test(difficultyRaw) ? 'MODERATE' : '';
        const originalQNo = it.qno || idx + 1;
        if (!it.qno) warnings.push(`Block ${it.bi + 1}: question number नहीं — क्रम से Q${originalQNo} माना`);
        const raw = { SUBJECT: subjectKey, CHAPTER: f.CHAPTER, TOPIC: it.topicRaw, SUB_TOPIC: f.SUB_TOPIC || f.SUBTOPIC || f.SUB_CONCEPT || '', CONCEPT: f.CONCEPT || f.FORMULA || '', COURSE: f.COURSE || '',
          EXAM_NAME: examName || 'Board', EXAM_BOARD: f.EXAM_BOARD || '', YEAR: it.yearRaw, PAPER: shift, TYPE: f.TYPE || f.QUESTION_BASE || f.CATEGORY || '', DIFFICULTY: difficulty || 'MODERATE',
          QUESTION_EN: it.stemEn, QUESTION_HI: it.stemHi, SOURCE_QUESTION_NO: String(originalQNo) };
        const meta = MetadataEngine.extract(raw, { subjectFixed: subjectKey, examId: examId || 'board', qIndex: idx, status: 'IMPORTED' });
        meta.subject = subjectKey; meta.shift = shift; meta.year = it.yearRaw; meta.status = 'IMPORTED';
        meta.difficultySource = difficulty ? 'FILE' : 'DEFAULT';
        if (!f.SUB_TOPIC && !f.SUBTOPIC && !f.SUB_CONCEPT) meta.subtopic = 'General';
        { const st = normalizeSourceType(f.SOURCE_TYPE || f.QUESTION_SOURCE || f.SOURCE); if (st) meta.sourceType = st; }
        if (isBoard) {
          meta.curriculumId = f.CURRICULUM_ID || BoardCurriculumRegistry.PROFILE.curriculumId; meta.boardId = f.BOARD_ID || BoardCurriculumRegistry.PROFILE.boardId;
          meta.classId = f.CLASS_ID || BoardCurriculumRegistry.PROFILE.classId; meta.streamId = f.STREAM_ID || null;
          meta.subjectId = f.SUBJECT_ID || `sub-${slugify(meta.subject)}`; meta.chapterId = f.CHAPTER_ID || `chap-${slugify(meta.subject)}-${slugify(meta.chapter)}`;
          meta.topicId = f.TOPIC_ID || `topic-${slugify(meta.subject)}-${slugify(meta.chapter)}-${slugify(meta.topic)}`;
          if (f.LEARNING_OUTCOME_ID) { meta.learningOutcomeId = f.LEARNING_OUTCOME_ID; meta.learningOutcome = f.LEARNING_OUTCOME || f.LEARNING_OUTCOME_ID; }
        }
        const explanation = f.EXPLANATION_EN || f.EXPLANATION || f.SOLUTION_EN || f.SOLUTION || f.EXPLANATION_HI || f.SOLUTION_HI || f.CALCULATION || '';
        const q = {
          originalQNo, metadata: meta, examInfo: examName, year: it.yearRaw, paperDate: shift,
          QUESTION_EN: it.stemEn, QUESTION_HI: it.stemHi, options: it.subjective ? [] : it.options, answer: it.answer,
          EXPLANATION: explanation, EXPLANATION_HI: f.EXPLANATION_HI || '',
          hints: [f.HINT_1 || f.HINT || '', f.HINT_2 || '', explanation].filter(Boolean),
          importState: it.errs.length ? 'ERROR' : 'READY', version: 'v1', sourceLine: it.blockLine
        };
        if (it.subjective) q.metadata.questionFormat = 'SUBJECTIVE';
        q.fingerprint = importFingerprint(q);
        q.contentHash = importContentHash(q);
        // Stable ID: explicit QUESTION_ID, else the existing ID of the same slot in this topic, else a readable natural key.
        let id = it.explicitId, match = null;
        if (!id) {
          const natural = importQuestionIdFor({ examId, year: it.yearRaw, shift, subject: subjectKey, topicSlug, qno: it.qno, fp: q.fingerprint, boardPrefix });
          match = [exById.get(natural), it.qno ? exByQno.get(it.qno) : null, exByFp.get(q.fingerprint)].find(c => c && !matched.has(String(c.canonicalQId))) || null;
          id = match ? String(match.canonicalQId) : natural;
        } else match = exById.get(id) || null;
        q.canonicalQId = id; q.metadata.canonicalQId = id;
        q.canonicalPath = AutoPathEngine.generateCanonicalHierarchy(q.metadata);
        q.examPath = AutoPathEngine.generateExamHierarchy(q.metadata);
        q.pyqPath = AutoPathEngine.generatePyqHierarchy(q.metadata);

        if (it.errs.length) errors.push({ index: it.bi + 1, qNo: originalQNo, line: it.blockLine, errors: it.errs });
        if (seenIds.has(id)) { duplicateBatch.push({ index: it.bi + 1, qNo: originalQNo, line: it.blockLine, reason: `ID ${id} file में दो बार (block ${seenIds.get(id)} और ${it.bi + 1})` }); q.importState = 'ERROR'; }
        else if (seenFp.has(q.fingerprint)) { duplicateBatch.push({ index: it.bi + 1, qNo: originalQNo, line: it.blockLine, reason: `यही सवाल और options block ${seenFp.get(q.fingerprint)} में भी हैं` }); q.importState = 'ERROR'; }
        seenIds.set(id, it.bi + 1); seenFp.set(q.fingerprint, it.bi + 1);
        const owner = ownerOf.get(id);
        if (owner && !(owner.moduleId === moduleId && WorkspaceManager.matches(owner))) {
          duplicateExternal.push({ index: it.bi + 1, qNo: originalQNo, id, ownerModule: owner.moduleId, ownerTopic: owner.topicTitle || owner.moduleId, otherWorkspace: !WorkspaceManager.matches(owner) });
          q.importState = 'ERROR';
        }
        const elsewhere = wsFp.get(q.fingerprint);
        if (elsewhere && !owner) warnings.push(`Block ${it.bi + 1}: यही सवाल topic "${elsewhere.topicTitle || elsewhere.moduleId}" में भी है`);
        const old = match || exById.get(id) || null;
        if (old) { matched.add(String(old.canonicalQId)); const same = (old.contentHash || importContentHash(old)) === q.contentHash; q.diffStatus = same ? 'UNCHANGED' : 'CHANGED'; stats[same ? 'unchanged' : 'changed']++; if (old.metadata?.firstImportedAt) q.metadata.firstImportedAt = old.metadata.firstImportedAt; }
        else { q.diffStatus = 'NEW'; stats.new++; }
        q.metadata.firstImportedAt = q.metadata.firstImportedAt || new Date().toISOString();
        subjects.add(subjectKey); topics.add(String(it.topicRaw).trim()); if (!isBoard) examYears.add(`${examName} ${it.yearRaw}`);
        questions.push(q);
      });
      if (subjects.size > 1) warnings.push(`File में ${subjects.size} subjects हैं (${[...subjects].join(', ')}) — सब "${topicTitle}" topic में जाएँगे`);
      if (topics.size > 1 && !manualTopic) warnings.push(`File में ${topics.size} अलग TOPIC हैं — सब "${topicTitle}" में जाएँगे`);
      if (examYears.size > 1) warnings.push(`File में कई exam/year हैं (${[...examYears].slice(0, 4).join(', ')}) — एक टेस्ट में एक ही exam/year के सवाल आते हैं`);
      const missing = existingQs.filter(q => !matched.has(String(q.canonicalQId)));
      const sequenceBreaks = [];
      for (let i = 1; i < questions.length; i++) if (questions[i].originalQNo !== questions[i - 1].originalQNo + 1) sequenceBreaks.push(`Q.${questions[i - 1].originalQNo} → Q.${questions[i].originalQNo}`);

      const first = questions.find(q => q.importState !== 'ERROR') || questions[0];
      const groupsPreview = Math.ceil((questions.length + missing.length) / 20);
      const analysis = {
        transactionId: `IMP-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, sourceFile: file.name, sourceSize: file.size, analyzedAt: new Date().toISOString(),
        workspaceId: ws.id, totalQuestions: questions.length, validQuestions: questions.filter(q => q.importState !== 'ERROR').length, invalidQuestions: errors.length,
        validationErrors: errors, warnings, duplicateBatch, duplicateExternal, duplicateExisting: questions.filter(q => q.diffStatus !== 'NEW'), scopedIdResolutions: [],
        stats: { ...stats, missing: missing.length }, missingQuestions: missing, existingModuleId: existingModule ? existingModule.moduleId : null,
        sequenceBreaks, groupsCount: groupsPreview, topicTitle, moduleId, detectedSubject: moduleSubject, detectedChapter: first?.metadata?.chapter || '',
        samplePath: first?.canonicalPath || '', sampleExamPath: first?.examPath || '', examsRegistered: [...new Set(questions.map(q => q.metadata.exam).filter(Boolean))],
        examId: first?.metadata?.examId || '', examYear: first?.metadata?.year || '',
        questions, replacesExistingModule: !!existingModule,
        commitReady: questions.length > 0 && !errors.length && !duplicateBatch.length && !duplicateExternal.length
      };
      return analysis;
    } finally {
      // Analysis never leaves exams behind in the registry.
      try { UniversalExamRegistry.rebuildFromIndex(); } catch (_) {}
      isImportEngineLocked = false;
    }
  },

  async commit(analysis, opts = {}) {
    if (isImportEngineLocked) throw new Error('System अभी दूसरा काम कर रहा है। थोड़ी देर बाद कोशिश करें।');
    if (!analysis || !analysis.questions?.length) throw new Error('पहले file analyze करें।');
    if (analysis.commitReady !== true) throw new Error('Import रुका हुआ है: पहले गलतियाँ ठीक करें।');
    if (analysis.workspaceId && analysis.workspaceId !== WorkspaceManager.current().id) throw new Error('Workspace बदल गया है। File दोबारा analyze करें।');
    isImportEngineLocked = true;
    const originalModules = AppModules, originalHistory = ImportHistory;
    try {
      const ws = WorkspaceManager.requireActive();
      const removeMissing = !!(opts.removeMissing ?? analysis.removeMissing);
      const existingIdx = AppModules.findIndex(m => WorkspaceManager.matches(m) && m.moduleId === analysis.moduleId);
      if ((existingIdx >= 0 ? AppModules[existingIdx].moduleId : null) !== analysis.existingModuleId) throw new Error('इस topic का data analyze के बाद बदल गया। File दोबारा analyze करें।');
      const before = existingIdx >= 0 ? JSON.parse(JSON.stringify(AppModules[existingIdx])) : null;
      const now = new Date().toISOString();
      const incoming = analysis.questions.map(q => { const c = JSON.parse(JSON.stringify(q)); delete c.diffStatus; delete c.sourceLine; c.importState = 'READY'; c.metadata.transactionId = analysis.transactionId; c.metadata.updatedAt = now; return c; });
      const kept = removeMissing ? [] : (analysis.missingQuestions || []).map(q => JSON.parse(JSON.stringify(q)));
      const all = [...incoming, ...kept];
      const groups = [];
      for (let i = 0; i < all.length; i += 20) {
        const chunk = all.slice(i, i + 20), n = String(Math.floor(i / 20) + 1).padStart(2, '0');
        groups.push({ groupId: `${analysis.moduleId}-g${n}`, title: `G-${n}`, description: `${chunk.length} Questions • Q${chunk[0].originalQNo}–Q${chunk[chunk.length - 1].originalQNo}`, questions: chunk });
      }
      const base = before ? JSON.parse(JSON.stringify(before)) : {};
      const isComp = ws.type === 'COMPETITIVE';
      const mod = {
        ...base, workspaceId: ws.id, workspaceType: ws.type, moduleId: analysis.moduleId,
        examId: isComp ? (base.examId || analysis.examId) : undefined, examYear: isComp ? (base.examYear || analysis.examYear) : undefined,
        examCategoryId: isComp ? slugify(UniversalExamRegistry.knownProfiles[analysis.examId]?.category || 'competitive-exam') : undefined,
        curriculumId: ws.type === 'BOARD' ? BoardCurriculumRegistry.PROFILE.curriculumId : undefined, boardId: ws.type === 'BOARD' ? BoardCurriculumRegistry.PROFILE.boardId : undefined,
        classId: ws.type === 'BOARD' ? BoardCurriculumRegistry.PROFILE.classId : undefined, streamId: ws.type === 'BOARD' ? BoardCurriculumRegistry.PROFILE.streamId : undefined,
        subject: base.subject || analysis.detectedSubject,
        subjectTitle: base.subjectTitle || (analysis.detectedSubject === 'maths' ? '📐 Mathematics' : analysis.detectedSubject === 'science' ? '🔬 General Science' : analysis.detectedSubject === 'reasoning' ? '🧠 Reasoning' : '📘 ' + subjectDisplayName(analysis.detectedSubject)),
        topic: slugify(analysis.topicTitle), topicTitle: base.topicTitle || analysis.topicTitle, chapter: base.chapter || analysis.detectedChapter,
        testType: 'class-test', testTypeTitle: 'Class Test', groups
      };
      if (isComp && (!mod.examId || !mod.examYear)) throw new Error('Competitive import के लिए EXAM_NAME और YEAR ज़रूरी हैं।');
      WorkspaceManager.stampM(mod, ws);
      const nextModules = AppModules.slice();
      if (existingIdx >= 0) nextModules[existingIdx] = mod; else nextModules.push(mod);
      if (!checkStorageQuota(nextModules)) throw new Error('Phone storage में जगह नहीं है। पुराना data नहीं बदला गया।');
      const s = analysis.stats || {};
      const audit = {
        transactionId: analysis.transactionId, sourceFile: analysis.sourceFile, topicTitle: analysis.topicTitle, moduleId: analysis.moduleId, workspaceId: ws.id,
        committedQuestions: incoming.length, groupsCount: groups.length, committedAt: now, action: before ? 'MERGED_MODULE' : 'CREATED_MODULE',
        added: s.new || 0, changed: s.changed || 0, unchanged: s.unchanged || 0, removed: removeMissing ? (s.missing || 0) : 0, keptMissing: removeMissing ? 0 : (s.missing || 0),
        beforeModule: before
      };
      const nextHistory = [audit, ...ImportHistory.map((h, i) => (i >= 2 && h.beforeModule !== undefined ? { ...h, beforeModule: undefined, undoUnavailable: true } : h))].slice(0, 20);
      await DataCore.commit(nextModules, { reason: 'Import: ' + analysis.topicTitle, snapshot: 'Import से पहले: ' + analysis.topicTitle, importHistory: nextHistory });
      const { beforeModule, ...publicAudit } = audit;
      return { ...publicAudit, totalQuestions: incoming.length, samplePath: analysis.samplePath, sampleExamPath: analysis.sampleExamPath };
    } catch (err) {
      AppModules = originalModules; ImportHistory = originalHistory; synchronizeTaxonomyEngine();
      throw err;
    } finally { isImportEngineLocked = false; }
  }
};

/* ---------- integrity audit: duplicates are counted from the modules themselves ---------- */
function runDataIntegrityAudit() {
  const seen = new Set(), duplicateIds = [], missingStem = [], malformedOptions = [], missingPath = [];
  let total = 0;
  (AppModules || []).forEach(m => (m.groups || []).forEach(g => (g.questions || []).forEach(q => {
    total++;
    const id = String(q.canonicalQId || '');
    if (!id || seen.has(id)) duplicateIds.push(id || '(no id)'); else seen.add(id);
    if (!(q.QUESTION_EN || q.QUESTION_HI || '').trim()) missingStem.push(id);
    const subjective = String(q.metadata?.questionFormat || q.questionFormat || '').toUpperCase() === 'SUBJECTIVE';
    if (!subjective && (!Array.isArray(q.options) || q.options.length !== 4 || q.options.some(o => !o || !o.letter || !(o.en || o.hi)) || !/^[A-D]$/.test(String(q.answer || '')))) malformedOptions.push(id);
    if (!q.canonicalPath || !q.examPath || !q.pyqPath) missingPath.push(id);
  })));
  const orphanCount = Array.from(IndexEngine.registry.keys()).filter(id => !seen.has(String(id))).length;
  const issueCount = duplicateIds.length + missingStem.length + malformedOptions.length + missingPath.length + orphanCount;
  return { total, duplicateIds, missingStem, malformedOptions, missingPath, orphanCount, issueCount, healthy: issueCount === 0 };
}

/* ---------- import review UI ---------- */
function renderImportReview(r) {
  const blocked = !r.commitReady;
  const s = r.stats || { new: 0, changed: 0, unchanged: 0, missing: 0 };
  const list = (arr, fn, n = 8) => arr.slice(0, n).map(fn).join('') + (arr.length > n ? `<li>… और ${arr.length - n}</li>` : '');
  const errHtml = r.validationErrors.length ? `<div class="ir-box bad"><b>❌ ${r.validationErrors.length} सवाल में गलती — ठीक करके file दोबारा चुनें</b><ul>${list(r.validationErrors, e => `<li>Block ${e.index} (line ${e.line}, Q.${escapeHtml(e.qNo)}): ${escapeHtml(e.errors.join(' · '))}</li>`)}</ul></div>` : '';
  const dupHtml = r.duplicateBatch.length ? `<div class="ir-box bad"><b>❌ File के अंदर duplicate</b><ul>${list(r.duplicateBatch, d => `<li>Block ${d.index} (line ${d.line}): ${escapeHtml(d.reason)}</li>`)}</ul></div>` : '';
  const extHtml = r.duplicateExternal.length ? `<div class="ir-box bad"><b>❌ ${r.duplicateExternal.length} सवाल की ID पहले से दूसरे topic में है</b><ul>${list(r.duplicateExternal, d => `<li>Q.${escapeHtml(d.qNo)}: ${escapeHtml(d.id)} → ${escapeHtml(d.ownerTopic)}${d.otherWorkspace ? ' (दूसरा workspace)' : ''}</li>`)}</ul></div>` : '';
  const warnHtml = r.warnings.length ? `<details class="ir-box warn"><summary>⚠️ ${r.warnings.length} ध्यान देने वाली बातें</summary><ul>${list(r.warnings, w => `<li>${escapeHtml(w)}</li>`, 30)}</ul></details>` : '';
  const missingHtml = s.missing ? `<label class="ir-remove"><input type="checkbox" id="irRemoveMissing" onchange="irToggleRemove(this.checked)"> <span>इस topic के <b>${s.missing}</b> पुराने सवाल इस file में नहीं हैं। <b>उन्हें हटाएँ</b> (टिक न करें तो वे रहेंगे)</span></label>` : '';
  const rows = r.questions.slice(0, 30).map(q => `<div class="import-q-row"><div style="display:flex;justify-content:space-between;gap:8px;"><b>Q.${escapeHtml(q.originalQNo)} • ${escapeHtml(q.metadata.topic)}</b><span class="ir-tag ${String(q.diffStatus || '').toLowerCase()}">${q.importState === 'ERROR' ? 'ERROR' : q.diffStatus === 'NEW' ? 'नया' : q.diffStatus === 'CHANGED' ? 'बदला' : 'वही'}</span></div><div style="margin-top:3px;">${escapeHtml(q.QUESTION_EN || q.QUESTION_HI || '')}</div><div style="font-size:11px;color:var(--text-muted);margin-top:3px;">उत्तर: ${escapeHtml(q.answer || '—')} · ${escapeHtml([q.metadata.exam, q.metadata.year].filter(Boolean).join(' ') || '—')} · ID ${escapeHtml(q.canonicalQId)}</div></div>`).join('');
  document.getElementById('modalSheetBody').innerHTML = `
    ${renderImportStep(2)}
    <div class="import-preview">
      <div class="import-preview-head"><div><b>🔍 जाँच का नतीजा</b><div style="font-size:11px;color:var(--text-muted);">${escapeHtml(r.sourceFile)}</div></div><span class="tax-badge ${blocked ? 'hard' : 'easy'}">${blocked ? 'रुका' : 'तैयार'}</span></div>
      <div class="import-stat-grid"><div class="import-stat"><b>${r.totalQuestions}</b><span>FILE में</span></div><div class="import-stat"><b>${s.new}</b><span>नए</span></div><div class="import-stat"><b>${s.changed}</b><span>बदले</span></div><div class="import-stat"><b>${s.unchanged}</b><span>वही</span></div></div>
      <div style="padding:0 10px 8px;font-size:12px;"><b>Topic:</b> ${escapeHtml(r.topicTitle)} · <b>Subject:</b> ${escapeHtml(subjectDisplayName(r.detectedSubject))} · <b>Exam:</b> ${escapeHtml(r.examsRegistered.join(', ') || '—')}${r.replacesExistingModule ? ' · <b>यह topic पहले से है — सवाल जुड़ेंगे/अपडेट होंगे</b>' : ''}</div>
      ${errHtml}${dupHtml}${extHtml}${missingHtml}${warnHtml}
      ${!blocked ? `<div class="ir-box good">✓ सब ज़रूरी fields मौजूद हैं, हर सवाल का उत्तर A–D में है।</div>` : ''}
      <div style="padding:8px 10px 4px;font-size:11px;font-weight:900;">सवाल ${r.totalQuestions > 30 ? '(पहले 30)' : ''}</div><div class="import-q-list">${rows}</div>
    </div>
    <div style="display:flex;gap:8px;margin-top:10px;">
      <button class="btn-nav" style="flex:1;" onclick="PendingImportTransaction=null;openImportModal()">↩️ वापस</button>
      <button class="btn-nav primary" style="flex:2;" ${blocked ? 'disabled' : ''} onclick="confirmImportCommit()">✅ Import करें</button>
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin-top:8px;text-align:center;">अभी तक कुछ save नहीं हुआ है। Import से पहले अपने-आप एक backup बनेगा।</div>`;
}
function irToggleRemove(on) { if (PendingImportTransaction) PendingImportTransaction.removeMissing = !!on; }
