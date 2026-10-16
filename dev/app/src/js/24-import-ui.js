/* =========================================================================
   8. UNIVERSAL AUTO EXAM IMPORT PIPELINE
   ========================================================================= */

let PendingImportTransaction = null;
async function confirmImportCommit() {
  if (!PendingImportTransaction || isImportEngineLocked) return; const r = PendingImportTransaction;
  const s = r.stats || {};
  if (!confirm(`Import करें?\n\nFile: ${r.sourceFile}\nTopic: ${r.topicTitle}\nनए: ${s.new || 0} · बदले: ${s.changed || 0} · वही: ${s.unchanged || 0}${s.missing ? `\nपुराने ${s.missing} सवाल: ${r.removeMissing ? 'हटेंगे' : 'रहेंगे'}` : ''}\n\nImport से पहले अपने-आप backup बनेगा।`)) return;
  try {
    const c = await ImportEngine.commit(r, { removeMissing: !!r.removeMissing }); PendingImportTransaction = null;
    document.getElementById('modalSheetBody').innerHTML = `${renderImportStep(4)}
      <div class="ir-box good" style="font-size:14px;line-height:1.6;">✅ <b>Import पूरा हुआ</b><br>Topic: <b>${escapeHtml(c.topicTitle)}</b><br>नए: <b>${c.added}</b> · बदले: <b>${c.changed}</b> · वही: <b>${c.unchanged}</b>${c.removed ? ` · हटाए: <b>${c.removed}</b>` : ''}${c.keptMissing ? ` · पुराने रखे: <b>${c.keptMissing}</b>` : ''}<br>Groups: <b>${c.groupsCount}</b></div>
      <div style="display:flex;gap:8px;margin-top:12px;"><button class="btn-nav" style="flex:1;" onclick="closeModal()">ठीक है</button><button class="btn-nav primary" style="flex:1;" onclick="closeModal();openDataControlModal()">🛡️ Data Control में देखें</button></div>`;
  } catch (err) { document.getElementById('modalSheetBody').insertAdjacentHTML('beforeend', `<div class="ir-box bad" style="margin-top:10px;">❌ Import नहीं हुआ: ${escapeHtml(err.message)}। पुराना data वैसा ही है।</div>`); }
}

function runPhase4BoardAudit(){const original=WorkspaceManager.current();const result={featureFlag:PHASE4_BOARD_ENABLED,boardModules:0,boardQuestions:0,crossWorkspaceQuestions:0,subjectCount:0,pass:false};if(!PHASE4_BOARD_ENABLED)return result;WorkspaceManager.set(WorkspaceManager.BOARD,false);BoardCurriculumRegistry.sync(AppModules);const ms=WorkspaceManager.filterModules(AppModules);result.boardModules=ms.length;result.boardQuestions=ms.reduce((n,m)=>n+(m.groups||[]).reduce((a,g)=>a+(g.questions||[]).length,0),0);result.subjectCount=BoardCurriculumRegistry.subjects().length;result.crossWorkspaceQuestions=Array.from(IndexEngine.registry.values()).filter(q=>q.workspaceId==='ws-board-cbse-10'&&q.metadata?.workspaceId!=='ws-board-cbse-10').length;WorkspaceManager.set(original,false);result.pass=result.crossWorkspaceQuestions===0;return result}

/* PHASE 3 AUDIT HELPERS */
function getWorkspaceModules(){return WorkspaceManager.filterModules(AppModules)}
function runPhase3WorkspaceAudit(){const w=WorkspaceManager.current();const all=AppModules||[];const untagged=all.filter(m=>!m.workspaceId||!m.workspaceType).length;const visible=WorkspaceManager.filterModules(all);const wrong=visible.filter(m=>m.workspaceId!==w.id).length;const indexWrong=Array.from(IndexEngine.registry.values()).filter(q=>!WorkspaceManager.matches(q)).length;return{activeWorkspace:w.id,activeType:w.type,totalModules:all.length,visibleModules:visible.length,untaggedModules:untagged,airlockViolations:wrong,indexedCrossWorkspaceEntries:indexWrong,pass:untagged===0&&wrong===0&&indexWrong===0}}
