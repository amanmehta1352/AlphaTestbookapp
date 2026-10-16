/* =========================================================================
   1. UNIVERSAL AUTO EXAM MODULE & COMMON-CORE TAXONOMY ARCHITECTURE
   ========================================================================= */

function slugify(v) {
  return String(v || '').trim().toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\u0900-\u097f]+/g, '-')
    .replace(/^-+|-+$/g, '') || '';
}

// 1.1 UNIVERSAL EXAM REGISTRY & AUTO-DETECTION ENGINE
const UniversalExamRegistry = {
  version: '3.5-UNIVERSAL-AUTO-EXAM-PRO',
  registry: new Map(),

  knownProfiles: {
    'ssc-cgl': { name: 'SSC CGL', board: 'SSC', category: 'Central Govt', marking: '+2 / -0.5', syllabus: ['Quantitative Aptitude', 'General Intelligence', 'English Comprehension', 'General Awareness'] },
    'ssc-chsl': { name: 'SSC CHSL', board: 'SSC', category: 'Central Govt', marking: '+2 / -0.5', syllabus: ['Quantitative Aptitude', 'General Intelligence', 'English Language', 'General Awareness'] },
    'ssc-je': { name: 'SSC JE', board: 'SSC', category: 'Engineering', marking: '+1 / -0.25', syllabus: ['General Engineering', 'General Intelligence', 'General Awareness'] },
    'rrb-ntpc': { name: 'RRB NTPC', board: 'RRB', category: 'Railway', marking: '+1 / -0.33', syllabus: ['Mathematics', 'General Intelligence & Reasoning', 'General Awareness'] },
    'rrb-group-d': { name: 'RRB Group D', board: 'RRC/RRB', category: 'Railway', marking: '+1 / -0.33', syllabus: ['Mathematics', 'General Science', 'General Intelligence', 'Current Affairs'] },
    'rrb-alp': { name: 'RRB ALP CBT-1', board: 'RRB', category: 'Railway Technical', marking: '+1 / -0.33', syllabus: ['Mathematics', 'General Science', 'General Intelligence', 'General Awareness'] },
    'rrb-je': { name: 'RRB JE', board: 'RRB', category: 'Railway Engineering', marking: '+1 / -0.33', syllabus: ['Mathematics', 'General Science', 'General Intelligence', 'General Awareness'] },
    'rpf-si': { name: 'RPF S.I.', board: 'Railway Police', category: 'Police & Defense', marking: '+1 / -0.33', syllabus: ['Basic Arithmetic', 'General Intelligence', 'General Awareness'] },
    'rpf-constable': { name: 'RPF Constable', board: 'Railway Police', category: 'Police & Defense', marking: '+1 / -0.33', syllabus: ['Arithmetic', 'General Intelligence', 'General Awareness'] },
    'upsc-cse': { name: 'UPSC CSE (Prelims)', board: 'UPSC', category: 'Civil Services', marking: '+2 / -0.66', syllabus: ['GS Paper-I', 'CSAT Paper-II'] },
    'bpsc-cce': { name: 'BPSC CCE', board: 'BPSC', category: 'State PSC', marking: '+1 / -0.33', syllabus: ['General Studies', 'General Science', 'Mental Ability'] },
    'dpsc': { name: 'DPSC / State Commission', board: 'State Govt', category: 'State PSC', marking: '+1 / -0.33', syllabus: ['General Studies', 'State Special'] }
  },

  deriveExamId(rawExamName, rawBoard = '') {
    const raw = String(rawExamName || '').trim();
    if (!raw) return 'general-exam';

    const s = slugify(raw);
    if (s.includes('ssc') && s.includes('je')) return 'ssc-je';
    if (s.includes('ssc') && s.includes('cgl')) return 'ssc-cgl';
    if (s.includes('ssc') && s.includes('chsl')) return 'ssc-chsl';
    if (s.includes('ssc')) return 'ssc-general';
    if (s.includes('ntpc')) return 'rrb-ntpc';
    if (s.includes('alp')) return 'rrb-alp';
    if (s.includes('group-d') || s.includes('groupd')) return 'rrb-group-d';
    if (s.includes('rrb') && s.includes('je')) return 'rrb-je';
    if (s.includes('rpf') && (s.includes('si') || s.includes('s-i'))) return 'rpf-si';
    if (s.includes('rpf') && s.includes('constable')) return 'rpf-constable';
    if (s.includes('upsc')) return 'upsc-cse';
    if (s.includes('bpsc')) return 'bpsc-cce';
    if (s.includes('dpsc')) return 'dpsc';

    return s;
  },

  getOrRegisterExam(rawExamName, rawBoard = '', rawYear = '', forcedId = '') {
    const examId = forcedId || this.deriveExamId(rawExamName, rawBoard);
    
    if (this.registry.has(examId)) {
      const existing = this.registry.get(examId);
      if (rawYear) existing.years.add(String(rawYear).trim());
      existing.questionCount++;
      return existing;
    }

    const preset = this.knownProfiles[examId] || {};
    const autoProfile = {
      examId,
      examName: preset.name || String(rawExamName || examId).trim(),
      examBoard: preset.board || String(rawBoard || 'Official Exam Board').trim(),
      category: preset.category || 'Competitive Exam',
      markingScheme: preset.marking || '+1 / -0.33',
      defaultDurationMinutes: 30,
      years: new Set(rawYear ? [String(rawYear).trim()] : []),
      subjects: new Set(),
      syllabus: preset.syllabus || ['Mathematics', 'General Intelligence', 'General Science', 'General Awareness'],
      questionCount: 1,
      autoCreated: true,
      createdAt: new Date().toISOString()
    };

    this.registry.set(examId, autoProfile);
    return autoProfile;
  },

  getAllExams() {
    return Array.from(this.registry.values()).sort((a, b) => b.questionCount - a.questionCount);
  }
};

// 1.2 METADATA ENGINE: Extracts and normalizes high-resolution dimensions
const MetadataEngine = {
  version: '3.5-UNIVERSAL-AUTO-EXAM-PRO',
  
  extract(rawItem, fallbackDefaults = {}) {
    const raw = rawItem || {};
    
    // 1. Subject Normalization
    let subject = fallbackDefaults.subjectFixed ? String(fallbackDefaults.subjectFixed) : (normalizeSubjectKey(raw.SUBJECT || raw.subject || fallbackDefaults.subject || 'maths') || 'maths');
    
    // 2. Course, Chapter, Topic, Subtopic & Concept
    const course = raw.COURSE || raw.course || fallbackDefaults.course || 'Universal Exam Prep';
    const chapter = raw.CHAPTER || raw.chapter || fallbackDefaults.chapter || 'General Chapter';
    const topic = raw.TOPIC || raw.topic || fallbackDefaults.topic || chapter;
    const subtopic = raw.SUB_TOPIC || raw.subTopic || raw.SUB_CONCEPT || fallbackDefaults.subtopic || 'General Subtopic';
    const concept = raw.CONCEPT || raw.concept || raw.FORMULA || fallbackDefaults.concept || 'Core Concept';
    
    // 3. Exam DNA Extraction & Dynamic Registration
    const rawExamName = raw.EXAM_NAME || raw.examInfo || raw.EXAM || fallbackDefaults.exam || 'Railway Official PYQ';
    const rawBoard = raw.EXAM_BOARD || raw.board || '';
    const year = String(raw.YEAR || raw.year || fallbackDefaults.year || '2024').trim();
    const shift = raw.PAPER || raw.paperDate || raw.SHIFT || (fallbackDefaults.shift ?? 'Shift-I'); // V2.9.0: a cleared shift stays cleared
    
    const examProfile = UniversalExamRegistry.getOrRegisterExam(rawExamName, rawBoard, year, fallbackDefaults.examId || '');
    examProfile.subjects.add(subject);

    // 4. Numerical vs Theory Detection
    let type = (raw.TYPE || raw.QUESTION_BASE || raw.CATEGORY || fallbackDefaults.type || '').toUpperCase().trim();
    let theoryOrNumerical = 'NUMERICAL';
    const stemCombined = (raw.QUESTION_EN || raw.QUESTION || raw.QUESTION_HI || '').toLowerCase();
    
    if (type.includes('THEOR') || type.includes('CONCEPT') || raw.QUESTION_BASE === 'THEORY') {
      theoryOrNumerical = 'THEORY';
    } else if (type.includes('NUM') || raw.QUESTION_BASE === 'NUMERICAL') {
      theoryOrNumerical = 'NUMERICAL';
    } else {
      const hasMathSignals = /[₹%$=×÷+\-/*Ω]|(\d+\s*(?:kg|km|m\/s|g|litre|dozen|ohm|v)\b)/i.test(stemCombined);
      theoryOrNumerical = hasMathSignals ? 'NUMERICAL' : 'THEORY';
    }
    
    // 5. Difficulty Tier
    let difficulty = (raw.DIFFICULTY || fallbackDefaults.difficulty || 'MODERATE').toUpperCase().trim();
    if (difficulty.includes('EASY')) difficulty = 'EASY';
    else if (difficulty.includes('HARD') || difficulty.includes('TOUGH') || difficulty.includes('DIFFICULT')) difficulty = 'HARD';
    else difficulty = 'MODERATE';
    
    // 6. Question Length
    const charCount = (raw.QUESTION_EN || raw.QUESTION || raw.QUESTION_HI || '').length;
    let questionLength = 'MEDIUM';
    if (charCount < 120) questionLength = 'SHORT';
    else if (charCount > 280) questionLength = 'LONG';
    
    // 7. Language Mode
    const hasEn = !!(raw.QUESTION_EN || raw.QUESTION);
    const hasHi = !!raw.QUESTION_HI;
    let language = 'BILINGUAL';
    if (hasEn && !hasHi) language = 'ENGLISH_ONLY';
    else if (!hasEn && hasHi) language = 'HINDI_ONLY';
    
    // 8. Canonical Question Number & ID
    let rawQNo = String(raw.SOURCE_QUESTION_NO || raw.originalQNo || raw.QUESTION_ID || '').replace(/\D/g, '');
    const qNumber = rawQNo ? parseInt(rawQNo, 10) : (fallbackDefaults.qIndex ? fallbackDefaults.qIndex + 1 : 1);
    const canonicalQId = raw.canonicalQId || raw.metadata?.canonicalQId || raw.QUESTION_ID || `Q-${examProfile.examId}-${slugify(subject)}-${slugify(chapter)}-${qNumber}`;
    
    // Phase 2 safety boundary: only an explicit SUBJECTIVE marker can opt a
    // question out of the legacy MCQ renderer. Everything else defaults to MCQ.
    const existingQuestionFormat = raw.metadata?.questionFormat || raw.questionFormat || '';
    const explicitQuestionFormat = String(existingQuestionFormat || raw.TYPE || '').toUpperCase().trim();
    const questionFormat = explicitQuestionFormat === 'SUBJECTIVE' ? 'SUBJECTIVE' : 'MCQ';

    const tags = new Set([
      slugify(subject),
      slugify(chapter),
      slugify(topic),
      slugify(subtopic),
      slugify(theoryOrNumerical),
      slugify(difficulty),
      slugify(questionLength),
      slugify(year),
      examProfile.examId,
      slugify(examProfile.examName)
    ]);
    
    return {
      canonicalQId,
      originalQNo: qNumber,
      subject,
      course,
      chapter,
      topic,
      subtopic,
      concept,
      theoryOrNumerical,
      difficulty,
      questionLength,
      examId: examProfile.examId,
      exam: examProfile.examName,
      examBoard: examProfile.examBoard,
      year,
      shift,
      language,
      questionFormat,
      status: raw.metadata?.status || fallbackDefaults.status || 'VERIFIED',
      tags: Array.from(tags).filter(Boolean)
    };
  }
};

// 1.3 AUTO PATH ENGINE: Generates clean, logical hierarchical paths
const AutoPathEngine = {
  version: '3.5-UNIVERSAL-AUTO-EXAM-PRO',
  
  // Master Subject Taxonomy Path: /subjects/{subject}/{chapter}/{topic}/{subtopic}/{type}/{difficulty}/q-{qno}/
  generateCanonicalHierarchy(meta) {
    const segments = [
      'subjects',
      slugify(meta.subject),
      slugify(meta.chapter),
      slugify(meta.topic),
      slugify(meta.subtopic),
      slugify(meta.theoryOrNumerical),
      slugify(meta.difficulty),
      `q-${meta.originalQNo}`
    ].filter(s => s && s !== 'undefined' && s !== 'null' && s !== 'unknown');
    
    return '/' + segments.join('/') + '/';
  },

  // Universal Exam Path: /exams/{examId}/{year}/{subject}/{chapter}/{topic}/q-{qno}/
  generateExamHierarchy(meta) {
    const segments = [
      'exams',
      slugify(meta.examId),
      slugify(meta.year),
      slugify(meta.subject),
      slugify(meta.chapter),
      slugify(meta.topic),
      `q-${meta.originalQNo}`
    ].filter(s => s && s !== 'undefined' && s !== 'null');
    
    return '/' + segments.join('/') + '/';
  },

  // Faceted PYQ Path: /pyq/{examId}/{year}/{shift}/q-{qno}/
  generatePyqHierarchy(meta) {
    const segments = [
      'pyq',
      slugify(meta.examId),
      slugify(meta.year),
      slugify(meta.shift),
      `q-${meta.originalQNo}`
    ].filter(s => s && s !== 'undefined' && s !== 'null');
    
    return '/' + segments.join('/') + '/';
  }
};

// 1.4 VALIDATION ENGINE
const ValidationEngine = {
  validate(item) {
    const errors = [];
    const en = (item.QUESTION_EN || item.QUESTION || '').trim();
    const hi = (item.QUESTION_HI || '').trim();
    if (!en && !hi) errors.push('Question stem (EN or HI) is missing.');
    const rawFormat = String(item.questionFormat || item.TYPE || '').toUpperCase().trim();
    const isSubjective = rawFormat === 'SUBJECTIVE';
    if (!isSubjective) {
      const ans = String(item.ANSWER || item.SOURCE_ANSWER || item.answer || 'A').toUpperCase().trim();
      if (!['A', 'B', 'C', 'D'].includes(ans)) {
        item.answer = 'A';
      }
    }
    return { isValid: errors.length === 0, errors };
  }
};
