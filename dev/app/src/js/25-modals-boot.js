/* =========================================================================
   9. MODAL & DIALOG CONTROLLERS
   ========================================================================= */
function openModal(title, contentHtml) { document.getElementById('modalSheetTitle').textContent = title; const mb = document.getElementById('modalSheetBody'); mb.innerHTML = contentHtml; delete mb.dataset.toastToken; document.getElementById('modalOverlay').classList.add('open'); document.getElementById('modalSheet').classList.add('open'); }
function closeModal() { document.getElementById('modalOverlay').classList.remove('open'); document.getElementById('modalSheet').classList.remove('open'); }
function openCustomToast(msg) { const token = (openCustomToast._n = (openCustomToast._n || 0) + 1); openModal('🔔 Notification', `<div style="font-size:14px; font-weight:700; color:var(--text-main);">${msg}</div>`); const body = document.getElementById('modalSheetBody'); if (body) body.dataset.toastToken = String(token); setTimeout(() => { const b = document.getElementById('modalSheetBody'); if (b && b.dataset.toastToken === String(token)) closeModal(); }, 1800); }
function openScratchpad() { openModal('📝 Scratchpad / Rough Work', `<textarea style="width:100%; height:200px; padding:12px; border-radius:var(--radius-md); border:1px solid var(--border); font-family:monospace; font-size:14px;" placeholder="यहाँ अपनी रफ कैलकुलेशन करें..."></textarea><div style="display:flex; justify-content:flex-end; margin-top:10px;"><button onclick="closeModal()" class="btn-nav primary">Done</button></div>`); }
function escapeHtml(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
function renderImportStep(step) { const labels = ['1 • FILE','2 • ANALYZE','3 • REVIEW','4 • COMMIT']; return `<div class="import-stepper">${labels.map((x,i) => `<div class="import-step ${i < step ? 'done' : ''} ${i === step ? 'active' : ''}">${i < step ? '✓ ' : ''}${x}</div>`).join('')}</div>`; }

function openImportModal() {
  closeDrawer(); PendingImportTransaction = null;
  const html = `
    ${renderImportStep(0)}
    <div class="import-dropzone" id="importDropZone">
      <div style="font-size:28px;">📥</div><div style="font-weight:900;font-size:14px;margin:4px 0;">Import Source File</div><div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;">TXT • Question blocks with === QUESTION START ===</div>
      <input type="file" id="impFileInput" accept=".txt" style="width:100%;font-size:12px;"><div id="selectedFileInfo" style="margin-top:8px;font-size:11px;color:var(--text-muted);"></div>
    </div>
    ${renderImportDefaults()}
    <div style="padding:10px 12px;background:var(--surface-alt);border-radius:var(--radius-md);border:1px solid var(--border);font-size:11px;color:var(--text-muted);line-height:1.45;">🔐 <b>Safe Transaction Mode:</b> File पहले analyze होगा. Analyze के बाद preview में दिखेगा कि कितने questions, groups, duplicates और validation issues हैं. <b>Confirm & Commit</b> दबाए बिना permanent storage नहीं बदलेगा।</div>
    <button id="btnStartImport" class="btn-nav primary" style="width:100%;margin-top:12px;">🔎 Analyze File — Do Not Import Yet</button>
    <div id="importStatusReport" style="margin-top:10px;"></div>
  `;
  openModal('📥 Universal Import Engine — Safe Transaction', html);
  document.getElementById('impFileInput').onchange = e => { const f=e.target.files?.[0]; document.getElementById('selectedFileInfo').textContent = f ? `Selected: ${f.name} • ${(f.size/1024).toFixed(1)} KB` : ''; document.getElementById('importDropZone').classList.toggle('ready', !!f); };
  document.getElementById('btnStartImport').onclick = executeSmartImport;
}

const IMPORT_DEFAULTS_STORE = 'mtb-import-defaults-v1';
function loadImportDefaults() { try { return JSON.parse(localStorage.getItem(IMPORT_DEFAULTS_STORE) || '{}') || {}; } catch (_) { return {}; } }
function saveImportDefaults(d) { try { localStorage.setItem(IMPORT_DEFAULTS_STORE, JSON.stringify(d)); } catch (_) {} }
function readImportDefaults() { const d = {}; IMPORT_DEFAULT_KEYS.forEach(k => { const v = document.getElementById('impDef_' + k)?.value.trim(); if (v) d[k] = v; }); return d; }
function clearImportDefaults() { IMPORT_DEFAULT_KEYS.forEach(k => { const el = document.getElementById('impDef_' + k); if (el) el.value = ''; }); saveImportDefaults({}); }
function renderImportDefaults() {
  const d = loadImportDefaults();
  const isBoard = WorkspaceManager.current().type === 'BOARD';
  const exams = Array.from(new Set(Object.values(UniversalExamRegistry.knownProfiles || {}).map(p => p && p.name).filter(Boolean))).sort();
  const f = (k, label, ph, extra = '') => `<label class="imp-def-f"><span>${label}</span><input id="impDef_${k}" value="${escapeHtml(d[k] || '')}" placeholder="${escapeHtml(ph)}" ${extra} autocomplete="off"></label>`;
  return `<details class="imp-def" open>
    <summary>📝 सब सवालों के लिए एक बार भरें <small>(file में खाली हो तो यही लगेगा)</small></summary>
    <div class="imp-def-grid">
      ${isBoard ? '' : f('EXAM_NAME', 'Exam', 'जैसे SSC CGL', 'list="impExamList"') + f('YEAR', 'Year', 'जैसे 2024', 'inputmode="numeric" maxlength="4"') + f('SHIFT', 'Shift / Paper', 'जैसे 12 Sep Shift 1')}
      ${f('SUBJECT', 'Subject', 'जैसे Maths')}${f('CHAPTER', 'Chapter', 'जैसे Arithmetic')}${f('TOPIC', 'Topic', 'जैसे Profit & Loss')}
    </div>
    <datalist id="impExamList">${exams.map(n => `<option value="${escapeHtml(n)}">`).join('')}</datalist>
    <p class="imp-def-note">File में जो लिखा है वही माना जाएगा; ये मान सिर्फ़ खाली जगह भरते हैं। अगली बार के लिए याद रहते हैं। <button type="button" class="imp-def-clear" onclick="clearImportDefaults()">साफ़ करें</button></p>
  </details>`;
}

async function executeSmartImport() {
  const file = document.getElementById('impFileInput')?.files?.[0]; const reportBox = document.getElementById('importStatusReport');
  if (!file) { reportBox.innerHTML = `<div class="dc-health bad">⚠️ पहले source TXT file select करें.</div>`; return; }
  reportBox.innerHTML = `<div class="dc-health">⏳ File analyze हो रही है… अभी storage में कुछ commit नहीं हुआ है.</div>`;
  try { const defaults = readImportDefaults(); if (defaults.YEAR && !/^(19|20)\d{2}$/.test(defaults.YEAR)) throw new Error(`ऊपर भरा Year "${defaults.YEAR}" सही नहीं (जैसे 2024 लिखें)`); saveImportDefaults(defaults); const result = await ImportEngine.analyzeTxt(file, '', defaults); PendingImportTransaction = result; renderImportReview(result); } 
  catch(err) { reportBox.innerHTML = `<div class="dc-health bad">❌ ${escapeHtml(err.message)}</div>`; }
}

function viewQuestionDetails(canonicalQId) {
  const q = IndexEngine.registry.get(canonicalQId); if(!q) return;
  const optsHtml = (q.options||[]).map(o => `<div><b>${o.letter}:</b> ${escapeHtml(o.en)} ${o.hi && o.hi !== o.en ? ' / '+escapeHtml(o.hi) : ''}</div>`).join('');
  openModal('👁️ Question Details', `<div style="font-size:13px; color:var(--text-main); line-height:1.5;"><div style="margin-bottom:10px;"><b>Question:</b><br>${escapeHtml(q.QUESTION_EN || q.QUESTION_HI)}</div><div style="margin-bottom:10px; background:var(--surface-alt); padding:10px; border-radius:8px;">${optsHtml}</div><div style="margin-bottom:10px;"><b>Correct Answer:</b> <span style="color:var(--success); font-weight:bold;">${q.answer}</span></div><div style="margin-bottom:10px;"><b>Explanation:</b><br>${escapeHtml(q.EXPLANATION || 'N/A')}</div></div>`);
}

function editQuestionDNA(canonicalQId) {
  const q=IndexEngine.registry.get(canonicalQId);if(!q)return openCustomToast('Question not found in active registry.');
  const m=q.metadata||{},opts=Array.isArray(q.options)?q.options:[];
  const field=(id,label,value,rows=1)=>`<label style="display:block;margin:9px 0 4px;font-weight:800;font-size:12px;" for="${id}">${label}</label>${rows>1?`<textarea id="${id}" rows="${rows}" style="width:100%;padding:10px;border:1px solid var(--border-strong);border-radius:10px;background:var(--surface);color:var(--text-main);">${escapeHtml(value||'')}</textarea>`:`<input id="${id}" value="${escapeHtml(value||'')}" style="width:100%;padding:10px;border:1px solid var(--border-strong);border-radius:10px;background:var(--surface);color:var(--text-main);">`}`;
  const optionsHtml=['A','B','C','D'].map(letter=>{const o=opts.find(x=>String(x.letter).toUpperCase()===letter)||{};return `<fieldset style="border:1px solid var(--border);border-radius:12px;padding:10px;margin:10px 0;"><legend style="font-weight:900;">Option ${letter}</legend>${field('dcOpt'+letter+'En','English',o.en,2)}${field('dcOpt'+letter+'Hi','Hindi',o.hi,2)}</fieldset>`;}).join('');
  openModal('✏️ Edit Question — full record',`<div class="dc-edit-form"><div class="dc-health warn">Canonical ID and workspace ownership are locked. Content and metadata are editable.</div>${field('dcEditQEn','Question (English)',q.QUESTION_EN,3)}${field('dcEditQHi','Question (Hindi)',q.QUESTION_HI,3)}${optionsHtml}${field('dcEditAnswer','Correct answer (A/B/C/D)',q.answer)}${field('dcEditExplanation','Explanation / solution',q.EXPLANATION,4)}${field('dcEditSubject','Subject',m.subject||'')}${field('dcEditChapter','Chapter',m.chapter||'')}${field('dcEditTopic','Topic',m.topic||'')}${field('dcEditSubtopic','Subtopic / tag',m.subtopic||'')}<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;"><button class="btn-nav" onclick="closeModal()">Cancel</button><button class="btn-nav primary" onclick="saveQuestionDNAChanges('${escapeHtml(canonicalQId)}')">Validate & Save</button></div></div>`);
}
async function saveQuestionDNAChanges(canonicalQId){
  const q=IndexEngine.registry.get(canonicalQId);if(!q)return openCustomToast('Question no longer exists.');
  const get=id=>document.getElementById(id)?.value??'';
  const next={QUESTION_EN:get('dcEditQEn').trim(),QUESTION_HI:get('dcEditQHi').trim(),answer:get('dcEditAnswer').trim().toUpperCase(),EXPLANATION:get('dcEditExplanation').trim()};
  if(!next.QUESTION_EN&&!next.QUESTION_HI)return openCustomToast('At least one question language is required.');
  if(!['A','B','C','D'].includes(next.answer))return openCustomToast('Correct answer must be A, B, C or D.');
  const options=['A','B','C','D'].map(letter=>({letter,en:get('dcOpt'+letter+'En').trim(),hi:get('dcOpt'+letter+'Hi').trim()}));
  if(options.some(o=>!o.en&&!o.hi))return openCustomToast('Every option must contain English or Hindi text.');
  const owners=[];for(const mod of AppModules)for(const group of mod.groups||[])for(const item of group.questions||[])if(item.canonicalQId===canonicalQId)owners.push(item);
  if(owners.length!==1||owners[0]!==q)return openCustomToast('Edit blocked: ownership is missing or ambiguous.');
  const meta={subject:get('dcEditSubject').trim(),chapter:get('dcEditChapter').trim(),topic:get('dcEditTopic').trim(),subtopic:get('dcEditSubtopic').trim()};
  try{
    await DataCore.mutate('Edit '+canonicalQId,mods=>{
      const hit=DataCore.questionsById(mods).get(String(canonicalQId));if(!hit)throw new Error('Question not in this workspace.');
      const c=hit.q;c.QUESTION_EN=next.QUESTION_EN;c.QUESTION_HI=next.QUESTION_HI;c.answer=next.answer;c.EXPLANATION=next.EXPLANATION;c.options=options;
      c.metadata={...(c.metadata||{}),subject:meta.subject||c.metadata?.subject,chapter:meta.chapter||c.metadata?.chapter,topic:meta.topic||c.metadata?.topic,subtopic:meta.subtopic||c.metadata?.subtopic,canonicalQId};
      c.fingerprint=generateContentFingerprint(c.QUESTION_EN,c.QUESTION_HI);
    });
    closeModal();openDataControlModal();openCustomToast('Question saved; index rebuilt.');
  }catch(e){openCustomToast('Save blocked; previous data kept. '+String(e.message||e));}
}

function viewQuestionMeta(canonicalQId) {
  const q = IndexEngine.registry.get(canonicalQId); if(!q) return; const m = q.metadata || {};
  openModal('🧬 DNA / Meta Log', `<div style="font-size:12px; color:var(--text-main); line-height:1.6;"><div><b>Canonical ID:</b> ${canonicalQId}</div><div><b>Fingerprint:</b> ${escapeHtml(q.fingerprint || 'Missing')}</div><div><b>Transaction ID:</b> ${escapeHtml(m.transactionId || 'Pre-installed Database')}</div><div><b>Version:</b> ${escapeHtml(q.version || 'v1')}</div><div><b>State:</b> <span class="tax-badge ${q.importState === 'ERROR' ? 'hard' : 'easy'}">${escapeHtml(q.importState || 'VERIFIED')}</span></div><hr style="border:0; border-top:1px solid var(--border); margin:10px 0;"><div><b>Tags:</b> ${(m.tags||[]).map(t => `<span class="tax-badge">${t}</span>`).join(' ')}</div></div>`);
}

function renderDataControlRows(items) {
  if (!items.length) return `<div class="data-empty">कोई matching question नहीं मिला.</div>`;
  return items.map(q => {
    const m=q.metadata||{};
    return `<div class="dc-row">
      <input class="dc-check" type="checkbox" value="${escapeHtml(q.canonicalQId)}">
      <div class="dc-main">
        <div class="dc-main-title">Q.${escapeHtml(q.originalQNo)} • ${escapeHtml(m.topic||'Question')} • <span class="tax-badge exam">${escapeHtml(m.exam||'—')}</span> ${pyqStatusOf(q)==='PYQ'?'<span class="tax-badge easy">PYQ</span>':pyqStatusOf(q)==='NOT_PYQ'?'<span class="tax-badge theory">PRACTICE</span>':'<span class="tax-badge moderate">NOT MARKED</span>'}</div>
        <div class="dc-main-text">${escapeHtml(q.QUESTION_EN||q.QUESTION_HI||'Question text missing')}</div>${q.QUESTION_EN&&q.QUESTION_HI?`<div class="dc-main-text" style="color:var(--text-muted);margin-top:4px;">${escapeHtml(q.QUESTION_HI)}</div>`:''}<div class="dc-paths"><span class="path-pill">A: ${escapeHtml(q.options?.find(o=>o.letter==='A')?.en||q.options?.find(o=>o.letter==='A')?.hi||'—')}</span><span class="path-pill">B: ${escapeHtml(q.options?.find(o=>o.letter==='B')?.en||q.options?.find(o=>o.letter==='B')?.hi||'—')}</span><span class="path-pill">C: ${escapeHtml(q.options?.find(o=>o.letter==='C')?.en||q.options?.find(o=>o.letter==='C')?.hi||'—')}</span><span class="path-pill">D: ${escapeHtml(q.options?.find(o=>o.letter==='D')?.en||q.options?.find(o=>o.letter==='D')?.hi||'—')}</span><span class="path-pill">Correct: ${escapeHtml(q.answer||'—')}</span></div>
        <div class="dc-paths"><span class="path-pill">${escapeHtml(q.canonicalPath||'—')}</span><span class="path-pill" style="color:var(--primary);">${escapeHtml(q.examPath||'—')}</span></div>
        <div class="dc-actions">
          <button class="btn-action-sm" onclick="viewQuestionDetails('${escapeHtml(q.canonicalQId)}')">👁️ View</button>
          <button class="btn-action-sm" onclick="editQuestionDNA('${escapeHtml(q.canonicalQId)}')">✏️ Edit</button>
          <button class="btn-action-sm" onclick="startSinglePractice('${escapeHtml(q.canonicalQId)}')">🧪 Test</button>
          <button class="btn-action-sm" onclick="viewQuestionMeta('${escapeHtml(q.canonicalQId)}')">🧬 Meta</button>
          <button class="btn-action-sm" style="color:var(--danger); border-color:var(--danger);" onclick="deleteQuestionDNA('${escapeHtml(q.canonicalQId)}')">🗑️ Delete DNA</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function runAndShowDataAudit() { const a=runDataIntegrityAudit(); openCustomToast(a.healthy ? `🟢 Data जाँच पास — ${a.total} सवाल ठीक हैं।` : `⚠️ Data जाँच: ${a.duplicateIds.length} duplicate ID, ${a.missingStem.length} खाली सवाल, ${a.malformedOptions.length} गलत options/उत्तर, ${a.missingPath.length} path नहीं, ${a.orphanCount} बेघर।`); }
function resetAppData() {
  closeDrawer();
  openModal('🗑️ Reset Application', `<div style="font-size:14px; color:var(--text-main); line-height:1.5;">क्या आप वाकई ऐप को डिफ़ॉल्ट स्थिति पर रीसेट करना चाहते हैं? सभी इम्पोर्टेड सवाल और प्रोग्रेस रीसेट हो जाएंगे। (Reset से पहले एक auto-backup रखा जाएगा, जिसे "Backup और Restore" से वापस ला सकते हैं।)</div><div style="display:flex; gap:10px; margin-top:20px;"><button onclick="closeModal()" class="btn-nav">Cancel</button><button onclick="confirmResetAppData()" class="btn-nav danger">Confirm Reset</button></div>`);
}

async function confirmResetAppData() {
  try {
    await StorageWriteQueue.flush();
    try { await DataSafety.snapshot('Reset से पहले'); } catch (_) {}
    await Promise.all([AppStorage.deleteKey(STORAGE_KEY), AppStorage.deleteKey(USER_KEY), AppStorage.deleteKey(IMPORT_HISTORY_KEY), AppStorage.deleteKey(ATTEMPT_HISTORY_KEY), AppStorage.deleteKey(RESULT_HISTORY_KEY), AppStorage.deleteKey(BUILDER_TEMPLATE_KEY), AppStorage.deleteKey(REVIEW_STATE_KEY), AppStorage.deleteKey(STUDY_SETTINGS_KEY)]);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(IMPORT_HISTORY_KEY);
    localStorage.removeItem(ATTEMPT_HISTORY_KEY);
    localStorage.removeItem(RESULT_HISTORY_KEY);
    localStorage.removeItem(BUILDER_TEMPLATE_KEY);
    localStorage.removeItem(REVIEW_STATE_KEY);
    localStorage.removeItem(STUDY_SETTINGS_KEY);
    try { sessionStorage.removeItem(BUILDER_DRAFT_KEY); } catch (_) {}
  } finally { location.reload(); }
}

/* Drawer Controls */
function syncDrawerVisibility(){
  const board=WorkspaceManager.current().type==='BOARD';
  const setVisible=(id,visible)=>{const el=document.getElementById(id);if(el)el.hidden=!visible;};
  // Keep tools/data controls available; hide only Competitive-specific global destinations in Board context.
  ['drwExams','drwPYQ','drwTest','drwRevision'].forEach(id=>setVisible(id,!board));
  const sections=document.querySelectorAll('#sideDrawer .drawer-section-title');
  if(sections[0]) sections[0].hidden=false;
}
function closeDrawer() { document.getElementById('sideDrawer').classList.remove('open'); document.getElementById('drawerOverlay').classList.remove('open'); }
document.getElementById('btnMenu').onclick = () => { syncDrawerVisibility(); document.getElementById('sideDrawer').classList.add('open'); document.getElementById('drawerOverlay').classList.add('open'); };
document.getElementById('btnCloseDrawer').onclick = closeDrawer; document.getElementById('drawerOverlay').onclick = closeDrawer; document.getElementById('modalOverlay').onclick = closeModal;

/* Boot Application — Phase 1A hydration gate */
initApp();