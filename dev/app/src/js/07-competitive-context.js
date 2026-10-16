/* =========================================================================
   PHASE 5A — COMPETITIVE EXAM CONTEXT
   Single authoritative context adapter; does not replace existing engines.
   ========================================================================= */
const CompetitiveContext = {
  current(examId = null, examYear = null, moduleId = null) {
    const mod = moduleId ? getWorkspaceModule(moduleId) : null;
    const exam = examId || mod?.examId || UserState?.selectedExam || '';
    const year = String(examYear || mod?.examYear || mod?.year || UserState?.selectedYear || '').trim();
    const profile = exam ? (UniversalExamRegistry.registry.get(exam) || null) : null;
    return {
      workspaceId: WorkspaceManager.current().id,
      workspaceType: WorkspaceManager.current().type,
      examId: exam || '',
      examCategoryId: slugify(profile?.category || mod?.category || 'competitive-exam'),
      examYear: year || '',
      subject: mod?.subject || mod?.subjectTitle || '',
      chapter: mod?.chapter || '',
      topic: mod?.topicTitle || ''
    };
  },
  matchesModule(mod, ctx = this.current()) {
    if (!mod || mod.workspaceId !== ctx.workspaceId || mod.workspaceType === 'BOARD') return false;
    if (ctx.examId && mod.examId && mod.examId !== ctx.examId) return false;
    if (ctx.examYear && mod.examYear && String(mod.examYear) !== String(ctx.examYear)) return false;
    return true;
  },
  stampModule(mod, ctx = this.current()) {
    if (!mod || ctx.workspaceType !== 'COMPETITIVE') return mod;
    mod.workspaceId = ctx.workspaceId;
    mod.workspaceType = 'COMPETITIVE';
    if (ctx.examId) mod.examId = ctx.examId;
    if (ctx.examYear) mod.examYear = String(ctx.examYear);
    if (ctx.examCategoryId) mod.examCategoryId = ctx.examCategoryId;
    return mod;
  },
  stampQuestion(q, ctx = this.current()) {
    if (!q || ctx.workspaceType !== 'COMPETITIVE') return q;
    q.workspaceId = ctx.workspaceId;
    q.workspaceType = 'COMPETITIVE';
    q.metadata = { ...(q.metadata || {}), workspaceId: ctx.workspaceId, workspaceType: 'COMPETITIVE', examId: q.metadata?.examId || ctx.examId, year: q.metadata?.year || ctx.examYear, examCategoryId: ctx.examCategoryId };
    return q;
  }
};
