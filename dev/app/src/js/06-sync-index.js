/* =========================================================================
   3. SEEDING & SYNCHRONIZING UNIVERSAL EXAM REGISTRY & INDEX ENGINE
   ========================================================================= */

function synchronizeTaxonomyEngine() {
  IndexEngine.clear();
  UniversalExamRegistry.registry.clear();
  
  AppModules.forEach(mod => {
    (mod.groups || []).forEach(grp => {
      (grp.questions || []).forEach((q, idx) => {
        const priorMeta = q.metadata || {};
        const meta = MetadataEngine.extract(q, {
          subjectFixed: priorMeta.subject || '',
          examId: syncKeepExamId(q, priorMeta),
          subject: priorMeta.subject || mod.subject,
          chapter: priorMeta.chapter || mod.chapter || mod.topicTitle,
          topic: priorMeta.topic || mod.topicTitle,
          subtopic: priorMeta.subtopic || priorMeta.subTopic,
          concept: priorMeta.concept,
          exam: priorMeta.exam || q.examInfo || mod.examId,
          year: priorMeta.year || q.year || mod.examYear,
          shift: priorMeta.shift ?? q.paperDate,
          difficulty: priorMeta.difficulty,
          type: priorMeta.theoryOrNumerical,
          qIndex: idx
        });
        q.metadata = { ...priorMeta, ...meta, canonicalQId: q.canonicalQId || priorMeta.canonicalQId || meta.canonicalQId, workspaceId: q.workspaceId, workspaceType: q.workspaceType, curriculumId: priorMeta.curriculumId, boardId: priorMeta.boardId, classId: priorMeta.classId, streamId: priorMeta.streamId, subjectId: priorMeta.subjectId, chapterId: priorMeta.chapterId, topicId: priorMeta.topicId, learningOutcomeId: priorMeta.learningOutcomeId, learningOutcome: priorMeta.learningOutcome, examCategoryId: priorMeta.examCategoryId || (q.workspaceType === 'COMPETITIVE' ? slugify(meta.exam || 'competitive-exam') : undefined) };
        if (q.workspaceType === "BOARD") BoardCurriculumRegistry.associateQuestion(q, WorkspaceManager.BOARD);
        q.canonicalQId = String(q.canonicalQId || priorMeta.canonicalQId || meta.canonicalQId);
        
        q.canonicalPath = AutoPathEngine.generateCanonicalHierarchy(meta);
        q.examPath = AutoPathEngine.generateExamHierarchy(meta);
        q.pyqPath = AutoPathEngine.generatePyqHierarchy(meta);
        if (q.workspaceType === 'COMPETITIVE') {
          const owner = AppModules.find(m => (m.groups || []).some(g => (g.questions || []).includes(q)));
          if (owner) { owner.workspaceId = owner.workspaceId || WorkspaceManager.current().id; owner.workspaceType = 'COMPETITIVE'; owner.examId = owner.examId || meta.examId; owner.examYear = owner.examYear || meta.year; }
          q.metadata.examCategoryId = q.metadata.examCategoryId || slugify(meta.exam || 'competitive-exam');
        }
        IndexEngine.register(q);
      });
    });
  });
  
  TaxonomyEngine.buildTree();
}

