/* =========================================================================
   7. UNIVERSAL SEARCH (CONNECTED TO TAXONOMY ENGINE)
   ========================================================================= */
function onGlobalSearch(query) {
  const qTerm = String(query || '').trim();
  const searchResultsDiv = document.getElementById('globalSearchResults');
  if (!searchResultsDiv) return;

  if (!qTerm) { searchResultsDiv.innerHTML = ''; return; }
  const results = (() => {
    const activeResults = CurriculumContext.isActive()
      ? CurriculumContext.search(qTerm)
      : SearchEngine.search(qTerm);
    const curriculumResults = CurriculumContext.isActive()
      ? []
      : CurriculumContext.search(qTerm);
    const merged = [];
    const seen = new Set();
    [...activeResults, ...curriculumResults].forEach(q => {
      const key = String(q.canonicalQId || `${q.workspaceId || q.metadata?.workspaceId || ''}:${q.originalQNo || ''}`);
      if (!seen.has(key)) { seen.add(key); merged.push(q); }
    });
    return merged;
  })();

  if (!results.length) { searchResultsDiv.innerHTML = `<div class="card-btn" style="color:var(--text-muted); font-size:13px;">कोई सवाल, टॉपिक या परीक्षा नहीं मिली।</div>`; return; }

  searchResultsDiv.innerHTML = `
    <div style="font-size:12px; font-weight:800; color:var(--primary); margin-bottom:8px;">🔍 ${results.length} प्रश्न मिले:</div>
    <div style="display:flex; flex-direction:column; gap:8px;">
      ${results.slice(0, 10).map(q => {
        const m = q.metadata || {};
        return `
          <div class="card-btn" onclick="startSinglePractice('${q.canonicalQId}')" style="padding:12px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
              <strong style="color:var(--primary); font-size:13px;">Q.${q.originalQNo} • ${m.topic || 'Question'}</strong>
              <div style="display:flex; gap:4px; flex-wrap:wrap;">
                <span class="tax-badge exam">${m.exam}</span>
                <span class="tax-badge ${m.theoryOrNumerical === 'NUMERICAL' ? 'num' : 'theory'}">${m.theoryOrNumerical}</span>
                <span class="tax-badge ${m.difficulty === 'EASY' ? 'easy' : (m.difficulty === 'HARD' ? 'hard' : 'moderate')}">${m.difficulty}</span>
              </div>
            </div>
            <div style="font-size:13px; line-height:1.4; color:var(--text-main); font-weight:600;">${q.QUESTION_EN || q.QUESTION_HI}</div>
            <div style="margin:4px 0; display:flex; flex-direction:column; gap:2px;"><span class="path-pill">${q.canonicalPath}</span><span class="path-pill" style="color:var(--primary);">${q.examPath}</span></div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${q.examInfo ? `📌 ${q.examInfo}` : ''}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}
