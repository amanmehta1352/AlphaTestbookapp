/* =========================================================================
   DATA CORE — the one way to change questions (V2.8.0)
   Every feature that adds, edits, moves or removes questions goes through
   DataCore.commit / DataCore.mutate. One place that:
     1. builds the new data on a copy (the live data is never half-changed),
     2. checks it — a change may not ADD problems (old ones never block),
     3. keeps an automatic backup first when asked,
     4. saves it in one step (questions + import history together),
     5. rebuilds the indexes, and rolls everything back if anything fails.
   Rule for new features: do not assign AppModules or call saveModules()
   for content changes — call DataCore.
   ========================================================================= */
const DataCore = {
  log: [],
  listeners: [],
  onChange(fn) { this.listeners.push(fn); },
  copy() { return JSON.parse(JSON.stringify(AppModules)); },
  async commit(next, opts = {}) {
    if (!Array.isArray(next)) throw new Error('DataCore.commit: module list required');
    if (typeof DataHealth !== 'undefined' && DataHealth.readOnly) throw new Error('यह ऐप दूसरे tab में खुला है — यहाँ बदलाव save नहीं होंगे।');
    const before = AppModules, beforeHistory = ImportHistory;
    const issuesBefore = runDataIntegrityAudit().issueCount;
    AppModules = next;
    synchronizeTaxonomyEngine();
    const after = runDataIntegrityAudit();
    if (!opts.allowNewIssues && after.issueCount > issuesBefore) {
      AppModules = before; synchronizeTaxonomyEngine();
      const e = new Error(`Data जाँच में नई गड़बड़ी (duplicate ID: ${after.duplicateIds.length}, खाली सवाल: ${after.missingStem.length}, गलत options/उत्तर: ${after.malformedOptions.length})। पुराना data नहीं बदला गया।`);
      e.audit = after; throw e;
    }
    if (opts.snapshot) {
      try { await DataSafety.snapshot(typeof opts.snapshot === 'string' ? opts.snapshot : (opts.reason || 'बदलाव से पहले'), { modules: before, importHistory: beforeHistory }); }
      catch (e) { console.warn('[DataCore] backup before change failed', e); }
    }
    try {
      if (opts.importHistory) await AppStorage.commitValidatedImport({ modules: next, importHistory: opts.importHistory });
      else await StorageWriteQueue.enqueue(() => AppStorage.setRawDirect(STORAGE_KEY, JSON.stringify(next)));
    } catch (e) {
      AppModules = before; ImportHistory = beforeHistory; synchronizeTaxonomyEngine();
      throw e;
    }
    if (opts.importHistory) ImportHistory = opts.importHistory;
    try { SBCache = null; } catch (_) {}
    const entry = { at: new Date().toISOString(), reason: String(opts.reason || 'change').slice(0, 80), questions: after.total, issues: after.issueCount };
    this.log.unshift(entry); this.log.length = Math.min(this.log.length, 30);
    this.listeners.forEach(fn => { try { fn(entry); } catch (_) {} });
    return after;
  },
  // Change a copy with fn(modules) and commit it. Returns whatever fn returns.
  async mutate(reason, fn, opts = {}) {
    const next = this.copy();
    const result = fn(next);
    await this.commit(next, { reason, ...opts });
    return result;
  },
  // Questions of the active workspace in a module list, by id.
  questionsById(mods, ws = WorkspaceManager.current()) {
    const map = new Map();
    (mods || []).forEach(m => { if (m.workspaceId !== ws.id || m.workspaceType !== ws.type) return; (m.groups || []).forEach(g => (g.questions || []).forEach(q => map.set(String(q.canonicalQId), { q, m }))); });
    return map;
  }
};
