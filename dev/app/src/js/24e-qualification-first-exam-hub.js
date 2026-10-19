/* =========================================================================
   Qualification-first onboarding + Exam Hub branch filter.
   Reuses current app classes, routes, question index and profile filter.
   No new CSS system, question schema, or question-data writer is introduced.
   ========================================================================= */
function renderQualificationSetup(v) {
  if (!QualificationDraft.initialized) {
    const q = studentQualification();
    QualificationDraft = { level: q?.level || '', branch: q?.branch || '', initialized: true };
  }
  const levels = QualificationRules.levels;
  const branchOptions = QualificationRules.branchOptions();
  const levelHtml = levels.map(level =>
    '<button type="button" class="pf-opt ' + (level.id === QualificationDraft.level ? 'on' : '') +
    '" data-qf-level="' + escapeHtml(level.id) + '" onclick="qualificationPick(\'level\',' + nbJsAttr(level.id) + ')"><b>' +
    escapeHtml(tx(level.en, level.hi)) + '</b><small>' + escapeHtml(level.id.toUpperCase()) + '</small></button>'
  ).join('');
  const branchHtml = branchOptions.map(item =>
    '<button type="button" class="pf-opt ' + (item.id === QualificationDraft.branch ? 'on' : '') +
    '" data-qf-branch="' + escapeHtml(item.id) + '" onclick="qualificationPick(\'branch\',' + nbJsAttr(item.id) + ')"><b>' +
    escapeHtml(tx(item.en, item.hi)) + '</b><small>' +
    (item.count ? item.count + ' ' + tx('published branch questions', 'प्रकाशित branch सवाल') : tx('No branch questions indexed yet', 'अभी branch के सवाल index नहीं हुए')) +
    '</small></button>'
  ).join('');
  const needsBranch = QualificationRules.needsBranch(QualificationDraft.level);
  const ready = !!QualificationDraft.level && (!needsBranch || (!!QualificationDraft.branch && branchOptions.some(x => x.id === QualificationDraft.branch)));
  v.innerHTML =
    '<div class="nav-breadcrumb"><button type="button" onclick="navigate(\'home\')">Home</button><span class="sep">/</span><span>Qualification</span></div>' +
    '<div id="qualificationSetup" class="qualification-setup">' +
      '<div class="student-hero-card ao-page-head">' +
        '<span class="journey-pill">🎓 ' + tx('Step 1 · Qualification', 'चरण 1 · योग्यता') + '</span>' +
        '<h1>' + tx('Choose your qualification', 'अपनी qualification चुनें') + '</h1>' +
        '<p>' + tx('Select your education level first. Matching branch-based preparation content will be shown next.', 'पहले अपनी शिक्षा चुनें। इसके बाद संबंधित branch की तैयारी सामग्री दिखाई जाएगी।') + '</p>' +
      '</div>' +
      '<div class="section-title ao-page-head"><span>1 · ' + tx('Education level', 'शिक्षा स्तर') + '</span></div>' +
      '<div class="pf-grid">' + levelHtml + '</div>' +
      (needsBranch ?
        '<div class="section-title ao-page-head"><span>2 · ' + tx('Branch / Specialization', 'ब्रांच / विशेषज्ञता') + '</span></div>' +
        (branchOptions.length ? '<div class="pf-grid">' + branchHtml + '</div>' :
          '<div class="card-btn"><strong>' + tx('Branch-wise question content is not indexed yet.', 'अभी branch-wise सवाल उपलब्ध नहीं हैं।') + '</strong><small>' + tx('Continue after the relevant published question pack is available.', 'संबंधित प्रकाशित प्रश्न उपलब्ध होने के बाद आगे बढ़ें।') + '</small></div>')
        : '') +
      '<div class="pf-actions"><button type="button" id="qualificationSave" class="gx-btn" ' + (ready ? '' : 'disabled aria-disabled="true"') + ' onclick="qualificationSave()">' +
      tx('Save & Continue to Exam Hub', 'सहेजें और Exam Hub खोलें') + ' →</button></div>' +
      '<p class="gx-note">' + tx('Exam cards match indexed question content. Final recruitment eligibility must be checked in the current official notification.', 'Exam cards उपलब्ध question content से मिलाए जाते हैं। अंतिम पात्रता नवीन आधिकारिक notification से जाँचें।') + '</p>' +
    '</div>';
}

/* Keep the existing Exam Hub layout; only its exam list is filtered for the selected technical branch. */
const renderUniversalExamHubBeforeQualification = renderUniversalExamHub;
renderUniversalExamHub = function(v) {
  const q = studentQualification();
  const isStudent = !!(q && ServerState?.session && CloudState.isAdmin === false);
  if (!isStudent) return renderUniversalExamHubBeforeQualification(v);
  const allExams = UniversalExamRegistry.getAllExams();
  const exams = qualificationFilteredExams(allExams);
  const totalQuestions = IndexEngine.registry.size;
  const list = exams.map(ex => {
    const n = q.branch ? qualificationBranchCount(ex.examId, q.branch) : ex.questionCount;
    const action = qualificationExamAction(ex.examId);
    return '<div class="card-btn" role="button" tabindex="0" data-exam-id="' + escapeHtml(ex.examId) + '" onclick="' + action + '" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();this.click();}">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;"><strong>' + escapeHtml(ex.examName) + '</strong>' +
      '<span style="font-size:11px;font-weight:800;background:var(--primary-light);color:var(--primary);padding:2px 8px;border-radius:999px;">' +
      n + (q.branch ? ' Branch Questions' : ' Questions') + '</span></div>' +
      '<small>🏛️ Board: <b>' + escapeHtml(ex.examBoard || '—') + '</b> • ' + escapeHtml(ex.category || 'Exam') + '</small>' +
      '<div style="margin-top:6px;font-size:11px;color:var(--text-muted);">Years: <b>' + escapeHtml(Array.from(ex.years || []).join(', ') || '—') + '</b> • Marking: <b>' + escapeHtml(ex.markingScheme || '—') + '</b></div>' +
      '<div style="margin-top:12px;display:flex;gap:6px;"><span class="btn-action-sm" style="background:var(--primary);color:var(--on-primary);width:100%;justify-content:center;">Open Exam Profile ➔</span></div></div>';
  }).join('');
  v.innerHTML =
    '<div class="nav-breadcrumb exam-hub-page"><button type="button" onclick="navigate(\'home\')">Home</button><span class="sep">/</span><span>Universal Exam Hub</span></div>' +
    '<div class="student-hero-card ao-page-head"><span class="journey-pill">🎯 ' + tx('Qualification matched', 'Qualification के अनुसार') + '</span>' +
      '<h1>' + tx('Your Exam Hub', 'आपका Exam Hub') + '</h1>' +
      '<p>' + escapeHtml(qualificationLabel(q)) + ' · ' + tx('Choose an exam to open its subjects, PYQs and practice tests.', 'Subjects, PYQ और practice tests के लिए परीक्षा चुनें।') + '</p>' +
      '<p class="gx-note">' + (q.branch ? tx('Showing exams with published questions for your selected branch.', 'आपकी चुनी branch के प्रकाशित सवाल वाले exams दिख रहे हैं।') : tx('Exam list uses indexed app content; check official eligibility in each notification.', 'Exam list ऐप में उपलब्ध content पर आधारित है; पात्रता notification में जाँचें।')) + '</p>' +
      '<button type="button" class="gx-link" onclick="openQualificationSetup()">✎ ' + tx('Change qualification', 'Qualification बदलें') + '</button></div>' +
    '<div class="section-title ao-page-head"><span>' + tx('Matching Exam Frameworks', 'आपकी तैयारी से संबंधित परीक्षाएँ') + ' (' + exams.length + ' Exams · ' + totalQuestions + ' Indexed Questions)</span>' +
      '<div style="display:flex;gap:6px;"><button class="btn-action-sm" onclick="navigate(\'competitive_hub\')">🏆 Competitive Hub</button>' +
      (ServerState?.isAdmin === true ? '<button class="btn-action-sm" onclick="openImportModal()">+ Import New Exam</button>' : '') + '</div></div>' +
    '<div class="grid-cards" style="margin-bottom:20px;">' +
      (list || ('<div class="card-btn"><strong>' + tx('No matching published questions found for this branch.', 'इस branch के लिए प्रकाशित सवाल नहीं मिले।') + '</strong><small>' + tx('Try another branch or return after its question pack is reviewed and published.', 'दूसरी branch चुनें या उसके प्रश्न प्रकाशित होने के बाद लौटें।') + '</small></div>')) +
    '</div>';
};

/* Legacy dashboard setup button now opens qualification first, then Exam Hub on subsequent visits. */
const openProfileSheetBeforeQualification = openProfileSheet;
openProfileSheet = function() {
  if (studentQualification()) return navigate('exam_hub');
  return openQualificationSetup();
};

/* The qualification setup is a route within the existing app shell. */
AppRoutes.qualification_setup = {
  nav: 'exams',
  title: ['🎓 Qualification', '🎓 योग्यता'],
  render: v => renderQualificationSetup(v)
};
