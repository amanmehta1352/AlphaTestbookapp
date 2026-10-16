import sys, json, hashlib
from playwright.sync_api import sync_playwright

PATH, OUT = sys.argv[1], sys.argv[2]
results = []
def rec(name, ok, detail=''):
    results.append((name, 'PASS' if ok else 'FAIL', str(detail)[:200])); print('PASS' if ok else 'FAIL', name, str(detail)[:200])

def make_txt(topic, sub, n, exam='RRB Group D', year='2024', start=5001):
    out = []
    for i in range(n):
        q = start + i
        out.append(f"""=== QUESTION START ===
SOURCE_QUESTION_NO: {q}
EXAM_NAME: {exam}
YEAR: {year}
SUBJECT: Maths
CHAPTER: Arithmetic
TOPIC: {topic}
SUB_TOPIC: {sub}
DIFFICULTY: {'EASY' if i%3==0 else 'MODERATE'}
QUESTION_EN: {topic} question number {q}: what is {q} + 1?
QUESTION_HI: {topic} प्रश्न {q}: {q} + 1 कितना है?
A_EN: {q+1}
A_HI: {q+1}
B_EN: {q+2}
B_HI: {q+2}
C_EN: {q+3}
C_HI: {q+3}
D_EN: {q}
D_HI: {q}
ANSWER: A
EXPLANATION_EN: {q} + 1 = {q+1}.
=== QUESTION END ===
""")
    return '\n'.join(out)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, accept_downloads=True)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append('console:' + m.text) if m.type == 'error' else None)
    page.goto('file://' + PATH)
    page.wait_for_selector('.sj-dash', timeout=15000)
    rec('app boots, dashboard renders', page.evaluate("Route.page==='home' && !!document.querySelector('.sj-dash')"))
    rec('history starts empty on fresh profile', page.evaluate("AttemptHistory.length===0 && ResultHistory.length===0"))
    txt = page.inner_text('#mainView')
    for fake in ['78% Avg', '35m / 45m', '8d 🔥', '24 Solved', 'decayed to 35%']:
        rec(f'no fabricated metric "{fake}"', fake not in txt)

    # ---------- Import two modules through the existing import pipeline ----------
    for topic, sub, n, start in [('Number System', 'Divisibility Rules', 25, 5001), ('Time Speed Distance and Boats & Streams', 'Upstream Downstream', 6, 6001)]:
        r = page.evaluate("""async ([t,topic])=>{const f=new File([t],'q.txt',{type:'text/plain'});const a=await ImportEngine.analyzeTxt(f,topic);
          if(!a.commitReady) return {ok:false,a:{err:a.validationErrors,ext:a.duplicateExternal}}; const c=await ImportEngine.commit(a); return {ok:true,n:c.committedQuestions}}""", [make_txt(topic, sub, n, start=start), topic])
        rec(f'import pipeline commits "{topic}"', r.get('ok') and r.get('n') == n, r)
    rec('data integrity audit healthy after imports', page.evaluate("runDataIntegrityAudit().healthy"))

    # ---------- Bug 1/2: Builder exam context now matches CBT host ----------
    ctxs = page.evaluate("""(()=>{const rows=nbSourceRows();return rows.every(r=>r.examId===String(r.mod.examId||r.q.metadata?.examId||'') && r.year===String(r.mod.examYear||r.q.metadata?.year||''))})()""")
    rec('Builder exam/year = module assignment (same rule as CBT host)', ctxs)
    out = page.evaluate("""(()=>{navigate('native_builder');nbSelectBuilderMode('custom');
      NativeBuilderState.examId='rrb-group-d';NativeBuilderState.year='2024';NativeBuilderState.subjects.add('maths');
      const pool=nbFilteredRows();NativeBuilderState.requestedCount=Math.min(40,pool.length);
      nbPreparePreview();const err=NativeBuilderState.error;const ids=NativeBuilderState.previewIds.slice();
      const mods=[...new Set(pool.map(r=>r.mod.moduleId))];
      nbStartTest();return {pool:pool.length,mods,err,ids:ids.length,startErr:NativeBuilderState.error,active:ActiveTestSession?.sessionStatus,seq:ActiveTestSession?.questionIds?.join('|')===ids.join('|')}})()""")
    rec('multi-module custom test (same exam) starts — no HOST_START_REJECTED', out['active'] == 'ACTIVE' and out['startErr'] == '' and len(out['mods']) >= 2 and out['seq'], out)
    page.evaluate("CbtExitGuard.confirmExit(); navigate('home')")
    out = page.evaluate("""(()=>{navigate('native_builder');nbSelectBuilderMode('custom');NativeBuilderState.examId='';NativeBuilderState.year='';NativeBuilderState.subjects.clear();
      ['maths','science'].forEach(s=>NativeBuilderState.subjects.add(s));NativeBuilderState.requestedCount=10;
      nbPreparePreview();return {err:NativeBuilderState.error,ids:NativeBuilderState.previewIds.length}})()""")
    rec('mixed exam contexts blocked at preview with clear message (not at start)', out['err'] == 'CHOOSE_EXAM_CONTEXT' and out['ids'] == 0, out)
    page.evaluate("navigate('home')")

    page.evaluate("navigate('home')")
    # ---------- History: practice ----------
    info = page.evaluate("""(()=>{const m=getWorkspaceModule('maths-percentage-class-test');const qs=m.groups.flatMap(g=>g.questions);return {q0:qs[0].originalQNo,a0:qs[0].answer,q1:qs[1].originalQNo,a1:qs[1].answer}})()""")
    wrong = 'B' if info['a1'] != 'B' else 'C'
    page.evaluate(f"""(()=>{{navigate('practice',{{moduleId:'maths-percentage-class-test',qIndex:0}});
      onPracticeSelect('{info['a0']}',{info['q0']},'maths-percentage-class-test',0);
      onPracticeSelect('{wrong}',{info['q0']},'maths-percentage-class-test',0);
      navigate('practice',{{moduleId:'maths-percentage-class-test',qIndex:1}});
      onPracticeSelect('{wrong}',{info['q1']},'maths-percentage-class-test',1);navigate('home');}})()""")
    h = page.evaluate("AttemptHistory.map(a=>({m:a.mode,ok:a.correct,day:a.day,cid:a.cid,ws:a.ws}))")
    rec('practice: first answer per question recorded (2 records, re-click ignored)', len(h) == 2 and h[0]['ok'] is True and h[1]['ok'] is False, h)
    hero = page.evaluate("[...document.querySelectorAll('.sj-hero-stats b')].map(x=>x.textContent)")
    rec('dashboard: answered today 2, accuracy 50%', hero[:2] == ['2', '50%'], hero)

    # ---------- History: CBT ----------
    page.evaluate("""(()=>{const m=getWorkspaceModule('science-physics-electricity-class-test');initTestSession(m.moduleId,m.groups[0].groupId,0);
      const qs=ActiveTestSession.questions;selectOption(qs[0].answer,0);})()""")
    page.wait_for_timeout(1300)
    page.evaluate("switchQuestion(1);selectOption(ActiveTestSession.questions[1].answer==='A'?'B':'A',1)")
    page.wait_for_timeout(1300)
    page.evaluate("switchQuestion(2)")
    page.evaluate("submitTestSession()")
    res = page.evaluate("({page:Route.page,c:Route.params.result?.correct,w:Route.params.result?.wrong,id:Route.params.result?.historyId})")
    rec('CBT scoring unchanged (1 correct, 1 wrong) and result saved with id', res['page'] == 'result' and res['c'] == 1 and res['w'] == 1 and str(res['id']).startswith('R-'), res)
    rh = page.evaluate("ResultHistory.length===1 && ResultHistory[0].correct===1 && ResultHistory[0].total===4")
    rec('result history stores summary', rh)
    ta = page.evaluate("AttemptHistory.filter(a=>a.mode==='test').map(a=>({ok:a.correct,sec:a.sec,rid:a.resultId}))")
    rec('test attempts: only answered questions, linked to result, time recorded', len(ta) == 2 and all(x['rid'] == res['id'] for x in ta) and all(isinstance(x['sec'], int) for x in ta) and ta[0]['sec'] >= 1, ta)

    # Auto-submit (timer path) also records
    page.evaluate("""(()=>{navigate('home');const m=getWorkspaceModule('maths-profit-loss-class-test');initTestSession(m.moduleId,m.groups[0].groupId,0);
      selectOption(ActiveTestSession.questions[0].answer,0);ActiveTestSession.sessionStartedAt=Date.now()-ActiveTestSession.durationSeconds*1000-2000;})()""")
    page.wait_for_timeout(2500)
    rec('timer auto-submit path also saves the result', page.evaluate("Route.page==='result' && ResultHistory.length===2"))

    # Persistence across reload
    page.evaluate("navigate('home')"); page.wait_for_timeout(600)
    page.reload(); page.wait_for_selector('.sj-dash', timeout=15000)
    rec('reload: attempts persisted', page.evaluate("AttemptHistory.length") == 5, page.evaluate("AttemptHistory.length"))
    rec('reload: results persisted', page.evaluate("ResultHistory.length") == 2)
    rec('reload: imported modules intact', page.evaluate("!!getWorkspaceModule('maths-number-system-class-test') && runDataIntegrityAudit().healthy"))
    hero = page.evaluate("[...document.querySelectorAll('.sj-hero-stats b')].map(x=>x.textContent)")
    rec('dashboard after reload: 5 answered today, 60% accuracy', hero[:2] == ['5', '60%'], hero)  # 1+0 practice, 1+0 test, 1 profit-loss = 3/5

    # Test History modal and reopen
    page.evaluate("openTestHistoryModal()")
    rows = page.locator('#modalSheetBody .sj-action').count()
    rec('Test History modal lists 2 tests', rows == 2, rows)
    page.locator('#modalSheetBody .sj-action').nth(1).click()
    r2 = page.evaluate("({p:Route.page,c:Route.params.result?.correct,t:Route.params.result?.total,q:Route.params.result?.questions?.length})")
    rec('stored result reopens with questions and same score', r2['p'] == 'result' and r2['c'] == 1 and r2['t'] == 4 and r2['q'] == 4, r2)
    txt = page.inner_text('#mainView')
    rec('reopened result shows solutions', 'Detailed Question Solutions' in txt and 'CORRECT' in txt)
    page.evaluate("navigate('home')")
    page.locator('.sj-recent .sj-action').first.click()
    rec('dashboard recent test opens stored result', page.evaluate("Route.page==='result'"))
    page.evaluate("navigate('test_hub')")
    rec('CBT hub shows Test History entry with count', 'Test History (2)' in page.inner_text('#mainView'))
    page.evaluate("navigate('home')")

    # ---------- CBT header: no test-exiting dropdown ----------
    page.evaluate("""(()=>{const m=getWorkspaceModule('maths-percentage-class-test');initTestSession(m.moduleId,m.groups[0].groupId,0)})()""")
    rec('CBT header has no section dropdown', page.evaluate("!document.querySelector('#cbtViewport select')"))
    rec('CBT header shows test label', page.evaluate("!!document.querySelector('#cbtViewport .cbt-test-label')"))
    page.screenshot(path=OUT + '/u1_cbt_header.png')
    page.evaluate("CbtExitGuard.confirmExit(); navigate('home')")

    # ---------- Mistake Book ----------
    page.evaluate("navigate('mistakes')")
    scoped = page.evaluate("getScopedCompetitiveMistakes().length")
    allws = page.evaluate("UserState.mistakeBook.filter(m=>getWorkspaceModule(m.moduleId)).length")
    cards = page.locator('#mainView .grid-cards .card-btn').count()
    rec('Mistake Book default = selected exam list', cards == scoped, (cards, scoped))
    rec('hidden-mistakes notice shown when others exist', (allws > scoped) == ('more mistake(s) are saved under other exams' in page.inner_text('#mainView')))
    page.locator('.mb-scope .filter-pill').nth(1).click()
    cards2 = page.locator('#mainView .grid-cards .card-btn').count()
    rec('"All exams" shows every mistake in this workspace', cards2 == allws and allws >= 2, (cards2, allws))
    page.fill('#mbSearch', 'zzzz-no-match')
    rec('search with no match shows clear empty state', 'No mistakes match this filter' in page.inner_text('#mainView'))
    rec('search keeps keyboard focus', page.evaluate("document.activeElement && document.activeElement.id==='mbSearch'"))
    page.fill('#mbSearch', '')
    topics = page.locator('#mainView .filter-bar .filter-pill').count()
    if topics > 1:
        page.locator('#mainView .filter-bar .filter-pill').nth(1).click()
        tname = page.evaluate("MistakeViewState.topic")
        ok = page.evaluate("[...document.querySelectorAll('#mainView .grid-cards .card-btn strong')].every(s=>s.textContent.includes(MistakeViewState.topic))")
        rec('topic filter shows only that topic', ok, tname)
        target = page.evaluate("(()=>{const s=document.querySelector('#mainView .grid-cards .card-btn strong').textContent;return s})()")
        before = page.evaluate("UserState.mistakeBook.length")
        snapshot = page.evaluate("JSON.stringify(UserState.mistakeBook)")
        page.locator('#mainView .grid-cards .card-btn').first.locator('text=Resolved').click()
        after = page.evaluate("UserState.mistakeBook.length")
        removed = page.evaluate(f"(()=>{{const old=JSON.parse({json.dumps(snapshot)});const now=JSON.stringify(UserState.mistakeBook);return old.filter(x=>!now.includes(JSON.stringify(x))).map(x=>'Q.'+x.qId+' • '+x.topicTitle)}})()")
        rec('Resolved removes exactly the clicked mistake (filtered view)', after == before - 1 and len(removed) == 1 and target.startswith(removed[0]), (target, removed))
    else:
        rec('topic filter available', False, 'need >1 topic')
    page.evaluate("MistakeViewState={allExams:false,search:'',topic:''};navigate('home')")

    # ---------- Backup includes history ----------
    with page.expect_download() as dl:
        page.evaluate("downloadDataSnapshot()")
    data = json.loads(open(dl.value.path(), encoding='utf-8').read())
    rec('backup snapshot includes attempt + result history', len(data.get('attemptHistory', [])) == 5 and len(data.get('resultHistory', [])) == 2 and 'modules' in data and 'userState' in data)

    # ---------- Regression: quick actions / journey / layout ----------
    expected = ['practice', 'native_builder', 'taxonomy_explorer', 'revision_hub', 'test_hub', 'mistakes', None, 'mastery']
    for i, e in enumerate(expected):
        page.evaluate("closeModal();navigate('home')")
        page.locator('.sj-quick-btn').nth(i).click()
        if e is None:
            rec('quick action Test History opens modal', page.evaluate("document.getElementById('modalSheet').classList.contains('open') && document.getElementById('modalSheetTitle').textContent.includes('Test History')"))
        else:
            rec(f'quick action {i+1} → {e}', page.evaluate("Route.page") == e)
    page.evaluate("closeModal();navigate('home')")
    for w in [360, 390, 768, 1280]:
        page.set_viewport_size({'width': w, 'height': 900}); page.evaluate("navigate('home')")
        ov = page.evaluate("(()=>{const m=document.getElementById('mainView');return m.scrollWidth-m.clientWidth})()")
        rec(f'home: no horizontal overflow at {w}px', ov <= 1, ov)
    page.set_viewport_size({'width': 390, 'height': 844}); page.evaluate("navigate('home')")
    page.screenshot(path=OUT + '/u1_home.png')
    page.evaluate("navigate('mistakes')"); page.screenshot(path=OUT + '/u1_mistakes.png'); page.evaluate("navigate('home')")
    page.evaluate("switchWorkspace('ws-comp-ssc')")
    rec('empty workspace: no history leaks from other workspace', page.evaluate("sjCollectDashboardData().answered===0 && sjCollectDashboardData().results.length===0"))
    page.evaluate("switchWorkspace('ws-board-cbse-10')")
    rec('Board workspace keeps its own dashboard', page.evaluate("!!document.querySelector('.board-shell')"))
    page.evaluate("switchWorkspace('ws-comp-legacy')")
    page.fill('#inpGlobalSearch', 'Ohm')
    rec('global search still works', 'प्रश्न मिले' in page.inner_text('#globalSearchResults'))

    # ---------- Reset clears history keys ----------
    page.evaluate("confirmResetAppData()")
    page.wait_for_selector('.sj-dash', timeout=15000)
    rec('reset app data also clears history', page.evaluate("AttemptHistory.length===0 && ResultHistory.length===0"))
    rec('no page/console errors', not errors, errors)
    b.close()
json.dump(results, open(OUT + '/u1_results.json', 'w'), indent=1, ensure_ascii=False)
print('TOTAL', len(results), 'FAIL', sum(1 for r in results if r[1] == 'FAIL'))
