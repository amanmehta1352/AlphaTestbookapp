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

/* Keep the existing Exam Hub markup and card design; temporarily supply the filtered exam list. */
const renderUniversalExamHubBeforeQualification = renderUniversalExamHub;
renderUniversalExamHub = function(v) {
  const q = studentQualification();
  const isStudent = !!(q && ServerState?.session && CloudState.isAdmin === false);
  if (!isStudent) return renderUniversalExamHubBeforeQualification(v);

  const originalGetAllExams = UniversalExamRegistry.getAllExams;
  const allExams = originalGetAllExams.call(UniversalExamRegistry);
  const filteredExams = qualificationFilteredExams(allExams);
  try {
    UniversalExamRegistry.getAllExams = () => filteredExams;
    renderUniversalExamHubBeforeQualification(v);
  } finally {
    UniversalExamRegistry.getAllExams = originalGetAllExams;
  }

  const breadcrumb = v.querySelector('.nav-breadcrumb');
  if (breadcrumb) breadcrumb.classList.add('exam-hub-page');
  const hero = v.querySelector('.student-hero-card');
  if (hero) {
    const note = document.createElement('p');
    note.className = 'gx-note';
    note.textContent = q.branch
      ? '🎓 ' + qualificationLabel(q) + ' · ' + tx('Showing exams with published questions for your selected branch.', 'आपकी चुनी branch के प्रकाशित सवाल वाले exams दिख रहे हैं।')
      : '🎓 ' + qualificationLabel(q) + ' · ' + tx('Check the official notification for final eligibility.', 'अंतिम पात्रता आधिकारिक notification से जाँचें।');
    hero.appendChild(note);
    const change = document.createElement('button');
    change.type = 'button';
    change.className = 'gx-link';
    change.textContent = '✎ ' + tx('Change qualification', 'Qualification बदलें');
    change.onclick = openQualificationSetup;
    hero.appendChild(change);
  }

  const title = v.querySelector('.section-title > span');
  if (title && q.branch) {
    const count = filteredExams.reduce((n, ex) => n + qualificationBranchCount(ex.examId, q.branch), 0);
    title.textContent = tx('Exams matching', 'आपकी branch से मेल खाते exams') + ' ' + qualificationLabel(q) +
      ' (' + filteredExams.length + ' Exams · ' + count + ' ' + tx('branch questions', 'branch सवाल') + ')';
  }

  const grid = v.querySelector('.grid-cards');
  const cards = grid ? Array.from(grid.querySelectorAll(':scope > .card-btn')) : [];
  filteredExams.forEach((ex, i) => {
    const card = cards[i];
    if (!card) return;
    card.setAttribute('data-exam-id', ex.examId);
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.onclick = () => qualificationChooseExam(ex.examId);
    card.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        qualificationChooseExam(ex.examId);
      }
    };
    const countBadge = card.querySelector('span');
    if (countBadge && q.branch) {
      countBadge.textContent = qualificationBranchCount(ex.examId, q.branch) + ' ' + tx('Branch Questions', 'branch सवाल');
    }
  });
  if (!filteredExams.length && grid) {
    const empty = document.createElement('div');
    empty.className = 'card-btn';
    empty.innerHTML = '<strong>' + tx('No matching published branch questions found.', 'इस branch के लिए प्रकाशित सवाल नहीं मिले।') +
      '</strong><small>' + tx('Try another branch or return after the relevant question pack is published.', 'दूसरी branch चुनें या संबंधित प्रश्न प्रकाशित होने के बाद लौटें।') + '</small>';
    grid.appendChild(empty);
  }
};
/* The qualification setup is a route within the existing app shell. */
AppRoutes.qualification_setup = {
  nav: 'exams',
  title: ['🎓 Qualification', '🎓 योग्यता'],
  render: v => renderQualificationSetup(v)
};
