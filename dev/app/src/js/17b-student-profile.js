/* =========================================================================
   STUDENT PROFILE (V3) — exam + branch.
   Only that track's server questions are pulled to the phone, so a Civil
   student never sees Mechanical/Electrical subjects. Common subjects (GA,
   Reasoning, Maths…) are shared. No profile = old behaviour (everything).
   Data-driven: exams and branches come from what the server actually has.
   ========================================================================= */
const ProfileRules = {
  branchOf(subject) { const m = /^([a-z]+)-engineering$/.exec(String(subject || '')); return m ? m[1] : ''; },
  branchLabel(b) { return ({ civil: 'Civil', electrical: 'Electrical', mechanical: 'Mechanical', electronics: 'Electronics', computer: 'Computer', instrumentation: 'Instrumentation', automobile: 'Automobile' })[b] || (b ? b.charAt(0).toUpperCase() + b.slice(1) : ''); },
  branchHi(b) { return ({ civil: 'सिविल', electrical: 'इलेक्ट्रिकल', mechanical: 'मैकेनिकल', electronics: 'इलेक्ट्रॉनिक्स', computer: 'कंप्यूटर', instrumentation: 'इंस्ट्रूमेंटेशन', automobile: 'ऑटोमोबाइल' })[b] || ''; },
  validExam(e) { return !!e && e !== 'not-provided-in-source' && /^[a-z0-9][a-z0-9-]{1,80}$/.test(e); }
};
function studentProfile() { return (typeof UserState !== 'undefined' && UserState && UserState.studentProfile && UserState.studentProfile.examId) ? UserState.studentProfile : null; }

const QualificationRules = {
  levels: [
    { id: '10th', en: '10th / Secondary', hi: '10वीं / सेकेंडरी' },
    { id: '12th', en: '12th / Senior Secondary', hi: '12वीं / सीनियर सेकेंडरी' },
    { id: 'iti', en: 'ITI / Industrial Training', hi: 'ITI / औद्योगिक प्रशिक्षण' },
    { id: 'diploma', en: 'Diploma / Polytechnic', hi: 'डिप्लोमा / पॉलिटेक्निक' },
    { id: 'graduate', en: 'Graduate / Bachelor', hi: 'ग्रेजुएट / स्नातक' },
    { id: 'postgraduate', en: 'Postgraduate', hi: 'पोस्ट ग्रेजुएट' }
  ],
  branches: [
    { id: 'mechanical', en: 'Mechanical Engineering', hi: 'मैकेनिकल इंजीनियरिंग' },
    { id: 'civil', en: 'Civil Engineering', hi: 'सिविल इंजीनियरिंग' },
    { id: 'electrical', en: 'Electrical Engineering', hi: 'इलेक्ट्रिकल इंजीनियरिंग' },
    { id: 'electronics', en: 'Electronics Engineering', hi: 'इलेक्ट्रॉनिक्स इंजीनियरिंग' },
    { id: 'computer', en: 'Computer Engineering', hi: 'कंप्यूटर इंजीनियरिंग' },
    { id: 'instrumentation', en: 'Instrumentation Engineering', hi: 'इंस्ट्रूमेंटेशन इंजीनियरिंग' },
    { id: 'automobile', en: 'Automobile Engineering', hi: 'ऑटोमोबाइल इंजीनियरिंग' }
  ],
  levelLabel(level) { return (this.levels.find(x => x.id === level) || {}).en || String(level || ''); },
  branchOptions() {
    const idx = CloudState.profileIndex || {};
    const known = Object.keys(idx).length > 0;
    const counts = {};
    Object.values(idx).forEach(ex => Object.entries(ex.branches || {}).forEach(([b, n]) => {
      counts[b] = (counts[b] || 0) + (Number(n) || 0);
    }));
    return this.branches.map(b => ({ ...b, count: counts[b.id] || 0 }));
  },
  needsBranch(level) { return ['iti', 'diploma', 'graduate', 'postgraduate'].includes(level); }
};
function studentQualification() {
  const q = UserState?.studentQualification || UserState?.studentProfile?.qualificationProfile || null;
  return q && q.level ? q : null;
}
function qualificationLabel(q = studentQualification()) {
  if (!q) return '';
  const level = QualificationRules.levelLabel(q.level);
  if (!q.branch) return level;
  return level + ' · ' + ProfileRules.branchLabel(q.branch);
}
let QualificationDraft = { level: '', branch: '', initialized: false };
function openQualificationSetup() {
  const q = studentQualification();
  QualificationDraft = { level: q?.level || '', branch: q?.branch || '', initialized: true };
  navigate('qualification_setup');
}
function qualificationPick(kind, value) {
  if (kind === 'level') {
    QualificationDraft.level = value;
    QualificationDraft.branch = '';
    const branches = QualificationRules.branchOptions();
    if (branches.length === 1 && QualificationRules.needsBranch(value)) QualificationDraft.branch = branches[0].id;
  } else if (kind === 'branch') QualificationDraft.branch = value;
  renderView();
}
function qualificationBranchCount(examId, branch) {
  return Number(CloudState.profileIndex?.[examId]?.branches?.[branch]) || 0;
}
function qualificationFilteredExams(exams) {
  const q = studentQualification();
  if (!q?.branch || !ServerState?.session || CloudState.isAdmin !== false) return exams || [];
  const idx = CloudState.profileIndex || {};
  if (!Object.keys(idx).length) return [];
  return (exams || []).filter(ex => qualificationBranchCount(ex.examId, q.branch) > 0);
}
function qualificationExamAction(examId) {
  if (studentQualification() && ServerState?.session && CloudState.isAdmin === false)
    return 'qualificationChooseExam(' + nbJsAttr(examId) + ')';
  return "navigate('exam_profile', {examId:" + nbJsAttr(examId) + '})';
}
async function qualificationRefreshContent() {
  if (!ServerState?.session || CloudState.isAdmin !== false) return true;
  try {
    if (CloudSyncRunning) await CloudSyncRunning;
    await cloudPullContent();
    return true;
  } catch (e) {
    openCustomToast('Question list अपडेट नहीं हो सकी। Internet जाँचें और Sync फिर चलाएँ।');
    return false;
  }
}
async function qualificationSave() {
  const level = QualificationDraft.level;
  const branch = QualificationDraft.branch || '';
  if (!level) { openCustomToast('पहले qualification चुनें।'); return; }
  if (QualificationRules.needsBranch(level) && (!branch || !QualificationRules.branchOptions().some(x => x.id === branch))) {
    openCustomToast('इस qualification के लिए उपलब्ध branch चुनें।'); return;
  }
  UserState.studentQualification = { level, branch, at: new Date().toISOString() };
  UserState.studentProfile = null;
  UserState.selectedExam = '';
  UserState.selectedYear = '';
  saveUserState();
  await qualificationRefreshContent();
  QualificationDraft.initialized = false;
  navigate('exam_hub');
}
async function qualificationChooseExam(examId) {
  const q = studentQualification();
  const ex = UniversalExamRegistry.registry.get(String(examId || ''));
  if (!ex) { openCustomToast('यह exam अभी उपलब्ध नहीं है।'); return; }
  if (!q) { navigate('qualification_setup'); return; }
  if (q.branch && qualificationBranchCount(examId, q.branch) <= 0 && Object.keys(CloudState.profileIndex || {}).length) {
    openCustomToast('इस exam में चुनी branch के प्रकाशित सवाल उपलब्ध नहीं हैं।'); return;
  }
  UserState.studentProfile = {
    examId: String(examId), branch: q.branch || '', qualification: q.level,
    qualificationProfile: { level: q.level, branch: q.branch || '' }, at: new Date().toISOString()
  };
  UserState.selectedExam = String(examId);
  UserState.selectedYear = '';
  saveUserState();
  await qualificationRefreshContent();
  navigate('exam_profile', { examId: String(examId) });
}

/* examId -> { id, name, count, branches: { civil: n, … } } from all published rows */
function profileIndex(rows, examName) {
  const idx = {};
  (rows || []).forEach(r => {
    const e = r.exam_id || ''; if (!ProfileRules.validExam(e)) return;
    const x = idx[e] || (idx[e] = { id: e, name: (examName && examName.get(e)) || e.toUpperCase(), count: 0, branches: {} });
    x.count++;
    const b = ProfileRules.branchOf(r.subject); if (b) x.branches[b] = (x.branches[b] || 0) + 1;
  });
  return idx;
}
function profileFilterRows(rows) {
  const p = studentProfile();
  const q = studentQualification();
  const profileMatchesQualification = !!(p && (!q || (p.qualification === q.level && String(p.branch || '') === String(q.branch || ''))));
  if (q && q.branch && !profileMatchesQualification) {
    return (rows || []).filter(r => {
      const b = ProfileRules.branchOf(r.subject);
      return !b || b === q.branch;
    });
  }
  if (!profileMatchesQualification) return rows || [];
  return (rows || []).filter(r => {
    if (r.exam_id !== p.examId) return false;
    const b = ProfileRules.branchOf(r.subject);
    return !p.branch || !b || b === p.branch;
  });
}
function profileLabel(p = studentProfile()) {
  if (!p) return '';
  const ex = CloudState.profileIndex?.[p.examId]?.name || p.examId.toUpperCase();
  if (p.qualification) {
    const q = { level: p.qualification, branch: p.branch || '' };
    return ex + ' · ' + qualificationLabel(q);
  }
  return p.branch ? ex + ' · ' + tx(ProfileRules.branchLabel(p.branch), ProfileRules.branchHi(p.branch) || ProfileRules.branchLabel(p.branch)) : ex;
}
function profileAvailable() { return !!(ServerState?.session && CloudState.isAdmin === false && CloudState.profileIndex && Object.keys(CloudState.profileIndex).length); }

/* Hero chip used by the Home screen; falls back to the old exam pill */
function profileHeroChip(examLine) {
  const q = studentQualification();
  const p = studentProfile();
  const label = p ? profileLabel(p) : q ? qualificationLabel(q) + ' · ' + tx('Choose exam','परीक्षा चुनें') : tx('Choose qualification','योग्यता चुनें');
  if (!profileAvailable()) {
    if (!ServerState?.session || CloudState.isAdmin !== false) return `<span class="gx-pill">🏛️ ${examLine}</span><button type="button" class="gx-link" onclick="navigate('exam_hub')">${tx('Change exam','Exam बदलें')}</button>`;
    return '<button type="button" class="pf-chip" onclick="openQualificationSetup()" aria-label="Qualification बदलें">🎓 ' + escapeHtml(q ? qualificationLabel(q) : examLine) + ' ▾</button><button type="button" class="gx-link" onclick="navigate(\'exam_hub\')">' + tx('All exams','सारे exam') + '</button>';
  }
  return '<button type="button" class="pf-chip" onclick="openQualificationSetup()" aria-label="Qualification बदलें">🎓 ' + escapeHtml(label) + ' ▾</button><button type="button" class="gx-link" onclick="navigate(\'exam_hub\')">' + tx('All exams','सारे exam') + '</button>';
}

/* ---------- sheet: step 1 exam, step 2 branch ---------- */
const ProfileDraft = { examId: '', branch: '' };
function openProfileSheet() {
  const p = studentProfile();
  ProfileDraft.examId = p?.examId || ''; ProfileDraft.branch = p?.branch || '';
  openModal(tx('🎯 Your exam','🎯 आपका exam'), '<div id="pfSheet"></div>');
  profilePaint();
}
function profilePaint() {
  const el = document.getElementById('pfSheet'); if (!el) return;
  const idx = CloudState.profileIndex || {};
  const exams = Object.values(idx).sort((a, b) => b.count - a.count);
  const ex = idx[ProfileDraft.examId];
  const branches = ex ? Object.entries(ex.branches).sort((a, b) => b[1] - a[1]) : [];
  const needBranch = branches.length > 1;
  const ready = ex && (!needBranch || ProfileDraft.branch);
  el.innerHTML = `<p class="gx-note" style="margin-top:0">${tx('Only questions for your exam and branch will appear. You can change this any time.','सिर्फ़ आपके exam और branch के सवाल दिखेंगे। इसे कभी भी बदल सकते हैं।')}</p>
    <div class="pf-step">1 · ${tx('Exam','परीक्षा')}</div>
    <div class="pf-grid">${exams.map(e => `<button type="button" class="pf-opt ${e.id === ProfileDraft.examId ? 'on' : ''}" onclick="profilePick('exam',${nbJsAttr(e.id)})"><b>${escapeHtml(e.name)}</b><small>${e.count} ${tx('questions','सवाल')}</small></button>`).join('') || `<p class="gx-note">${tx('No exams on the server yet.','Server पर अभी कोई exam नहीं।')}</p>`}</div>
    ${needBranch ? `<div class="pf-step">2 · ${tx('Branch','ब्रांच')}</div>
    <div class="pf-grid">${branches.map(([b, n]) => `<button type="button" class="pf-opt ${b === ProfileDraft.branch ? 'on' : ''}" onclick="profilePick('branch',${nbJsAttr(b)})"><b>${escapeHtml(tx(ProfileRules.branchLabel(b), ProfileRules.branchHi(b) || ProfileRules.branchLabel(b)))}</b><small>${n} ${tx('branch questions','branch सवाल')} + ${tx('common','common')}</small></button>`).join('')}</div>` : ''}
    <div class="pf-actions">
      <button type="button" class="gx-btn" ${ready ? '' : 'disabled aria-disabled="true"'} onclick="profileSave()">${tx('Save','सहेजें')}</button>
      ${studentProfile() ? `<button type="button" class="gx-btn ghost" onclick="profileClear()">${tx('Show everything','सब कुछ दिखाएँ')}</button>` : ''}
    </div>`;
}
function profilePick(kind, val) {
  if (kind === 'exam') { ProfileDraft.examId = val; ProfileDraft.branch = ''; const ex = CloudState.profileIndex?.[val]; const bs = ex ? Object.keys(ex.branches) : []; if (bs.length === 1) ProfileDraft.branch = bs[0]; }
  else ProfileDraft.branch = val;
  profilePaint();
}
async function profileApply(profile) {
  UserState.studentProfile = profile;
  if (profile?.examId) { UserState.selectedExam = profile.examId; UserState.selectedYear = ''; }
  saveUserState();
  closeModal();
  openCustomToast(tx('Updating your questions…','आपके सवाल लाए जा रहे हैं…'));
  try { await cloudSync('profile'); } catch (_) {}
  navigate('home');
}
function profileSave() { if (!ProfileDraft.examId) return; profileApply({ examId: ProfileDraft.examId, branch: ProfileDraft.branch || '', at: new Date().toISOString() }); }
function profileClear() { profileApply(null); }

/* Gentle prompt on Home for a logged-in student who has not chosen yet (never blocks the screen) */
function profileHomePrompt() {
  if (Route?.page !== 'home' || !profileAvailable() || studentProfile()) return;
  const v = document.getElementById('mainView'); if (!v || v.querySelector('.pf-prompt, [data-home-setup]')) return;
  const q = studentQualification();
  const el = document.createElement('button'); el.type = 'button'; el.className = 'pf-prompt';
  el.onclick = q ? () => navigate('exam_hub') : openQualificationSetup;
  el.innerHTML = '<span class="pf-ico" aria-hidden="true">🎯</span><span style="flex:1"><b>' +
    (q ? tx('Choose your exam','अपनी परीक्षा चुनें') : tx('Choose your qualification','अपनी qualification चुनें')) +
    '</b><small>' + tx('Your subjects and questions will follow your selected qualification and branch.','आपके विषय और सवाल चुनी qualification और branch के अनुसार दिखेंगे।') +
    '</small></span><span aria-hidden="true">›</span>';
  v.prepend(el);
}
registerViewHook('after', 'profile-prompt', profileHomePrompt);

/* After login, qualification is the first required student step; admins and Board workspaces are untouched. */
function qualificationFirstGate() {
  if (Route?.page === 'qualification_setup' || Route?.page === 'test' || Route?.page === 'result') return;
  if (!ServerState?.session || CloudState.isAdmin !== false || WorkspaceManager.current().type === 'BOARD') return;
  if (studentQualification()) return;
  navigate('qualification_setup');
}
registerViewHook('after', 'qualification-first-gate', qualificationFirstGate);
/* After a sync the login state is known: repaint Home once if the chip is not there yet */
const _pfCloudSync = cloudSync;
cloudSync = async function (...args) {
  const r = await _pfCloudSync(...args);
  try { if (Route?.page === 'home' && profileAvailable() && !document.querySelector('.pf-chip')) renderView(); } catch (_) {}
  return r;
};
/* Display filter (read-only screens): with a profile, demo/other-exam local topics are hidden */
function profileVisible(mods) {
  const source = mods || [];
  const p = studentProfile();
  const q = studentQualification();
  const profileMatchesQualification = !!(p && (!q || (p.qualification === q.level && String(p.branch || '') === String(q.branch || ''))));
  if (q && q.branch && !profileMatchesQualification) {
    return source.filter(m => {
      if (m.source === 'server') return true;
      const b = ProfileRules.branchOf(m.subject);
      return !b || b === q.branch;
    });
  }
  if (!profileMatchesQualification) return source;
  return source.filter(m => m.source === 'server' || (m.examId && m.examId === p.examId));
}
