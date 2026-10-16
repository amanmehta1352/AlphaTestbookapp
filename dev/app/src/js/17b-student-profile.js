/* =========================================================================
   STUDENT PROFILE (V3) — exam + branch.
   Only that track's server questions are pulled to the phone, so a Civil
   student never sees Mechanical/Electrical subjects. Common subjects (GA,
   Reasoning, Maths…) are shared. No profile = old behaviour (everything).
   Data-driven: exams and branches come from what the server actually has.
   ========================================================================= */
const ProfileRules = {
  branchOf(subject) { const m = /^([a-z]+)-engineering$/.exec(String(subject || '')); return m ? m[1] : ''; },
  branchLabel(b) { return ({ civil: 'Civil', electrical: 'Electrical', mechanical: 'Mechanical' })[b] || (b ? b.charAt(0).toUpperCase() + b.slice(1) : ''); },
  branchHi(b) { return ({ civil: 'सिविल', electrical: 'इलेक्ट्रिकल', mechanical: 'मैकेनिकल' })[b] || ''; },
  validExam(e) { return !!e && e !== 'not-provided-in-source' && /^[a-z0-9][a-z0-9-]{1,80}$/.test(e); }
};
function studentProfile() { return (typeof UserState !== 'undefined' && UserState && UserState.studentProfile && UserState.studentProfile.examId) ? UserState.studentProfile : null; }

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
  const p = studentProfile(); if (!p) return rows;
  return (rows || []).filter(r => {
    if (r.exam_id !== p.examId) return false;
    const b = ProfileRules.branchOf(r.subject);
    return !p.branch || !b || b === p.branch;
  });
}
function profileLabel(p = studentProfile()) {
  if (!p) return '';
  const ex = CloudState.profileIndex?.[p.examId]?.name || p.examId.toUpperCase();
  return p.branch ? `${ex} · ${tx(ProfileRules.branchLabel(p.branch), ProfileRules.branchHi(p.branch) || ProfileRules.branchLabel(p.branch))}` : ex;
}
function profileAvailable() { return !!(ServerState?.session && CloudState.isAdmin === false && CloudState.profileIndex && Object.keys(CloudState.profileIndex).length); }

/* Hero chip used by the Home screen; falls back to the old exam pill */
function profileHeroChip(examLine) {
  if (!profileAvailable()) return `<span class="gx-pill">🏛️ ${examLine}</span><button type="button" class="gx-link" onclick="navigate('exam_hub')">${tx('Change exam','Exam बदलें')}</button>`;
  const p = studentProfile();
  return `<button type="button" class="pf-chip" onclick="openProfileSheet()" aria-label="${tx('Change exam and branch','Exam और branch बदलें')}">🎯 ${escapeHtml(p ? profileLabel(p) : tx('Choose your exam','अपना exam चुनें'))} ▾</button><button type="button" class="gx-link" onclick="navigate('exam_hub')">${tx('All exams','सारे exam')}</button>`;
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
  const v = document.getElementById('mainView'); if (!v || v.querySelector('.pf-prompt')) return;
  const el = document.createElement('button'); el.type = 'button'; el.className = 'pf-prompt'; el.onclick = openProfileSheet;
  el.innerHTML = `<span class="pf-ico" aria-hidden="true">🎯</span><span style="flex:1"><b>${tx('Choose your exam and branch','अपना exam और branch चुनें')}</b><small>${tx('Then only your questions appear — no other branch mixed in.','फिर सिर्फ़ आपके सवाल दिखेंगे — दूसरी branch के नहीं।')}</small></span><span aria-hidden="true">›</span>`;
  v.prepend(el);
}
const _pfRenderView = renderView;
renderView = function () { _pfRenderView(); try { profileHomePrompt(); } catch (_) {} };
/* After a sync the login state is known: repaint Home once if the chip is not there yet */
const _pfCloudSync = cloudSync;
cloudSync = async function (...args) {
  const r = await _pfCloudSync(...args);
  try { if (Route?.page === 'home' && profileAvailable() && !document.querySelector('.pf-chip')) renderView(); } catch (_) {}
  return r;
};
/* Display filter (read-only screens): with a profile, demo/other-exam local topics are hidden */
function profileVisible(mods) {
  const p = studentProfile(); if (!p) return mods || [];
  return (mods || []).filter(m => m.source === 'server' || (m.examId && m.examId === p.examId));
}
