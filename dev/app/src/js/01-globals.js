/* =========================================================================
   V9.4 ADVANCED GLOBALS: Safe Locks & Transaction Managers
   ========================================================================= */
let isImportEngineLocked = false;

function generateContentFingerprint(en, hi) {
    return (String(en||'') + String(hi||'')).toLowerCase().replace(/\s+/g, '').replace(/[^\w\u0900-\u097f]/g, '');
}

function checkStorageQuota(newData) {
    if (!AppStorage.useFallback) return true;
    try {
        const testKey = '__test_quota_check__';
        const str = JSON.stringify(newData);
        localStorage.setItem(testKey, str);
        localStorage.removeItem(testKey);
        return true;
    } catch(e) {
        return false;
    }
}

// Transaction & Undo Manager
const TransactionManager = {
  // Legacy entry point; goes through DataCore like every other change.
  async undoTransaction(transactionId) {
    const history = getImportHistory();
    if (!history.find(h => h.transactionId === transactionId)) throw new Error("Transaction not found.");
    const next = DataCore.copy().map(mod => ({ ...mod, groups: (mod.groups || []).map(g => ({ ...g, questions: (g.questions || []).filter(q => q.metadata?.transactionId !== transactionId) })).filter(g => g.questions.length > 0) })).filter(m => (m.groups || []).length > 0);
    await DataCore.commit(next, { reason: 'Undo ' + transactionId, snapshot: 'Undo से पहले', importHistory: history.filter(h => h.transactionId !== transactionId), allowNewIssues: true });
    return true;
  }
};
