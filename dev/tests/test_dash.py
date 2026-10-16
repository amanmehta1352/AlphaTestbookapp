import sys, json, hashlib
from playwright.sync_api import sync_playwright

PATH = sys.argv[1]
OUT = sys.argv[2]
results = []
def rec(name, ok, detail=''):
    results.append((name, 'PASS' if ok else 'FAIL', detail)); print(('PASS' if ok else 'FAIL'), name, detail)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844})
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append('console:' + m.text) if m.type == 'error' else None)
    page.goto('file://' + PATH)
    page.wait_for_selector('.sj-dash', timeout=15000)
    rec('hydration gate released', page.evaluate("!document.getElementById('hydrationGate')"))
    rec('dashboard renders on Home', page.evaluate("Route.page==='home' && !!document.querySelector('.sj-dash')"))
    txt = page.inner_text('#mainView')
    for fake in ['78% Avg', '35m / 45m', '8d 🔥', '24 Solved', 'decayed to 35%', '376+ Questions']:
        rec(f'no fabricated metric "{fake}"', fake not in txt)
    rec('honest untracked notice shown', 'not tracked by this version' in txt)

    def snap():
        return page.evaluate("JSON.stringify(AppModules)+'|'+IndexEngine.registry.size+'|'+JSON.stringify(ImportHistory)")
    before = hashlib.sha256(snap().encode()).hexdigest()
    usBefore = page.evaluate("JSON.stringify({m:UserState.mistakeBook,mm:UserState.masteryMap,r:UserState.resumeState,s:UserState.studyMinutesToday})")
    for _ in range(3): page.evaluate("navigate('home')")
    rec('Home renders do not mutate modules/index/import history', hashlib.sha256(snap().encode()).hexdigest() == before)
    rec('Home renders do not mutate UserState records', page.evaluate("JSON.stringify({m:UserState.mistakeBook,mm:UserState.masteryMap,r:UserState.resumeState,s:UserState.studyMinutesToday})") == usBefore)

    # Hero stats baseline
    hero = page.evaluate("[...document.querySelectorAll('.sj-hero-stats b')].map(x=>x.textContent)")
    rec('fresh session hero: 0 answered, accuracy —', hero[0] == '0' and hero[1] == '—', str(hero))
    seedCount = page.evaluate("(competitiveEnabledGuard()?getScopedCompetitiveMistakes():UserState.mistakeBook).filter(m=>!sjIsSeedMistake(m)).length")
    rec('mistakes stat equals real (non-starter) scoped mistakes', hero[2] == str(seedCount), f'{hero[2]} vs {seedCount}')

    # Quick actions route
    expected = ['practice', 'native_builder', 'taxonomy_explorer', 'revision_hub', 'test_hub', 'mistakes', 'mastery', 'subjects']
    for i, exp in enumerate(expected):
        page.evaluate("navigate('home')")
        page.locator('.sj-quick-btn').nth(i).click()
        got = page.evaluate("Route.page")
        if got == 'practice':
            page.evaluate("PracticeAnswerState && 0")
        rec(f'quick action {i+1} → {exp}', got == exp, got)
        # leave practice cleanly (practice back triggers dialog, so use navigate directly)
    page.evaluate("closeModal(); navigate('home')")

    # Journey stage buttons
    stage_targets = ['learn', 'practice', 'test_hub', 'mistakes', 'mastery']
    for i, exp in enumerate(stage_targets):
        page.evaluate("navigate('home')")
        page.locator('.sj-stage button').nth(i).click()
        rec(f'journey stage {i+1} → {exp}', page.evaluate("Route.page") == exp)
    page.evaluate("navigate('home')")

    # Practice metrics: answer one correct, one wrong in percentage module (unique qNos)
    info = page.evaluate("""(()=>{const m=getWorkspaceModule('maths-percentage-class-test');const qs=m.groups.flatMap(g=>g.questions);
      return {q0:qs[0].originalQNo,a0:qs[0].answer,q1:qs[1].originalQNo,a1:qs[1].answer};})()""")
    wrong = 'B' if info['a1'] != 'B' else 'C'
    page.evaluate(f"""(()=>{{for(const k in PracticeAnswerState) delete PracticeAnswerState[k];
      navigate('practice',{{moduleId:'maths-percentage-class-test',qIndex:0}});
      onPracticeSelect('{info['a0']}',{info['q0']},'maths-percentage-class-test',0);
      navigate('practice',{{moduleId:'maths-percentage-class-test',qIndex:1}});
      onPracticeSelect('{wrong}',{info['q1']},'maths-percentage-class-test',1);
      navigate('home');}})()""")
    d = page.evaluate("(()=>{const d=sjCollectDashboardData();return {pa:d.practiceAnswered,pc:d.practiceCorrect,acc:d.accuracy,amb:d.practiceAmbiguous,resume:d.resume&&{m:d.resume.module.moduleId,q:d.resume.qIndex}}})()")
    rec('practice answered/correct counted (2 answered, 1 correct)', d['pa'] == 2 and d['pc'] == 1, json.dumps(d))
    rec('accuracy = correct ÷ answered = 50%', d['acc'] == 50)
    rec('resume points to last practice position (Q2)', d['resume'] == {'m': 'maths-percentage-class-test', 'q': 1})
    hero = page.evaluate("[...document.querySelectorAll('.sj-hero-stats b')].map(x=>x.textContent)")
    rec('hero shows 2 answered / 50%', hero[0] == '2' and hero[1] == '50%', str(hero))
    page.locator('.sj-resume .btn-nav').click()
    rec('Resume button opens practice at Q2', page.evaluate("Route.page==='practice' && Number(Route.params.qIndex)===1"))
    page.evaluate("navigate('home')")
    primary = page.inner_text('.sj-next-primary')
    rec('next best action = resume (rule 1)', 'Resume' in primary, primary.replace('\n', ' | ')[:120])

    # CBT submission feeds session stats; scoring untouched
    page.evaluate("""(()=>{const m=getWorkspaceModule('science-physics-electricity-class-test');initTestSession(m.moduleId,m.groups[0].groupId,0);
      const qs=ActiveTestSession.questions; selectOption(qs[0].answer,0); selectOption(qs[1].answer==='A'?'B':'A',1);
      submitTestSession();})()""")
    res = page.evaluate("Route.params.result && {c:Route.params.result.correct,w:Route.params.result.wrong,t:Route.params.result.total}")
    rec('CBT submit produces result (1 correct, 1 wrong)', res and res['c'] == 1 and res['w'] == 1, json.dumps(res))
    page.evaluate("navigate('home')")
    d = page.evaluate("(()=>{const d=sjCollectDashboardData();return {n:d.sessionResults.length,ans:d.answered,cor:d.correct,acc:d.accuracy}})()")
    rec('session test counted; combined accuracy 2/4=50%', d == {'n': 1, 'ans': 4, 'cor': 2, 'acc': 50}, json.dumps(d))
    page.evaluate("navigate('home')"); page.evaluate("navigate('home')")
    rec('result not double-counted after re-renders', page.evaluate("sjCollectDashboardData().sessionResults.length") == 1)
    btn = page.locator('.sj-recent .sj-action').first
    btn.click()
    rec('recent test opens its result page', page.evaluate("Route.page==='result' && Route.params.result && Route.params.result.correct===1"))
    page.evaluate("navigate('home')")
    rec('reopened result not duplicated', page.evaluate("sjCollectDashboardData().sessionResults.length") == 1)

    # Overflow checks + screenshots
    def overflow():
        return page.evaluate("(()=>{const m=document.getElementById('mainView');return m.scrollWidth-m.clientWidth})()")
    for w in [360, 390, 768, 1280]:
        page.set_viewport_size({'width': w, 'height': 900}); page.evaluate("navigate('home')")
        rec(f'no horizontal overflow at {w}px', overflow() <= 1, str(overflow()))
    page.set_viewport_size({'width': 390, 'height': 844}); page.evaluate("navigate('home')")
    page.screenshot(path=OUT + '/mobile_light.png', full_page=False)
    page.locator('#mainView').evaluate("e=>e.scrollTo(0,99999)")
    page.screenshot(path=OUT + '/mobile_light_bottom.png')
    page.evaluate("toggleCbtDark(); navigate('home')")
    rec('dark theme applied', page.evaluate("document.body.classList.contains('dark')"))
    page.screenshot(path=OUT + '/mobile_dark.png')
    page.evaluate("toggleCbtDark(); navigate('home')")
    page.set_viewport_size({'width': 1280, 'height': 900}); page.evaluate("navigate('home')")
    page.screenshot(path=OUT + '/desktop_light.png')

    # Empty workspace
    page.evaluate("switchWorkspace('ws-comp-ssc')")
    page.set_viewport_size({'width': 390, 'height': 844}); page.evaluate("navigate('home')")
    t = page.inner_text('#mainView')
    rec('empty workspace: honest empty states', 'No questions in' in t and 'No questions yet' in t)
    rec('empty workspace: other-workspace results excluded', page.evaluate("sjCollectDashboardData().sessionResults.length") == 0 and page.evaluate("sjCollectDashboardData().answered") == 0)
    rec('empty workspace: Practice quick action disabled', page.evaluate("document.querySelector('.sj-quick-btn').disabled"))
    page.screenshot(path=OUT + '/mobile_empty.png')
    page.evaluate("switchWorkspace('ws-board-cbse-10')")
    rec('Board workspace keeps its own dashboard', page.evaluate("!document.querySelector('.sj-dash') && !!document.querySelector('.board-shell')"))
    page.evaluate("switchWorkspace('ws-comp-legacy')")
    rec('back to legacy workspace dashboard', page.evaluate("!!document.querySelector('.sj-dash')"))

    # Search still works
    page.fill('#inpGlobalSearch', 'Ohm')
    rec('global search still works', 'प्रश्न मिले' in page.inner_text('#globalSearchResults'))

    # Persistence: reload, data intact
    page.wait_for_timeout(500)
    count_before = page.evaluate("IndexEngine.registry.size")
    page.reload(); page.wait_for_selector('.sj-dash', timeout=15000)
    rec('reload: registry size preserved', page.evaluate("IndexEngine.registry.size") == count_before)
    rec('no page/console errors', not errors, '; '.join(errors)[:300])
    b.close()

json.dump(results, open(OUT + '/results.json', 'w'), indent=1, ensure_ascii=False)
print('TOTAL', len(results), 'FAIL', sum(1 for r in results if r[1] == 'FAIL'))
