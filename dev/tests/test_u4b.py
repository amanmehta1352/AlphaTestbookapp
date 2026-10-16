import sys, json
from playwright.sync_api import sync_playwright
PATH, OUT = sys.argv[1], sys.argv[2]
results = []
def rec(name, ok, detail=''):
    results.append((name, 'PASS' if ok else 'FAIL', str(detail)[:220])); print('PASS' if ok else 'FAIL', name, str(detail)[:220])
def make_txt(topic, n, start):
    out = []
    for i in range(n):
        q = start + i
        out.append(f"""=== QUESTION START ===
SOURCE_QUESTION_NO: {q}
EXAM_NAME: RRB Group D
YEAR: 2024
SUBJECT: Maths
CHAPTER: Arithmetic
TOPIC: {topic}
SUB_TOPIC: Core
DIFFICULTY: {'EASY' if i % 2 == 0 else 'HARD'}
QUESTION_EN: {topic} question {q}: what is {q} + 1?
QUESTION_HI: {topic} प्रश्न {q}: {q} + 1 कितना है?
A_EN: {q+1}
B_EN: {q+2}
C_EN: {q+3}
D_EN: {q}
ANSWER: A
EXPLANATION_EN: {q} + 1 = {q+1}.
=== QUESTION END ===
""")
    return '\n'.join(out)
IMPORT = """async ([t,topic])=>{const a=await ImportEngine.analyzeTxt(new File([t],'q.txt'),topic);if(!a.commitReady)return {ok:false};const c=await ImportEngine.commit(a);return {ok:true,n:c.committedQuestions}}"""
M = 'maths-number-system-class-test'
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 390, 'height': 844})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append('console:' + m.text) if m.type == 'error' else None)
    page.on('dialog', lambda d: d.accept())
    page.goto('file://' + PATH); page.wait_for_selector('.sj-dash', timeout=15000)
    rec('import', page.evaluate(IMPORT, [make_txt('Number System', 12, 5001), 'Number System'])['ok'])
    # make 3 mistakes in practice
    page.evaluate(f"""(()=>{{const m=getWorkspaceModule('{M}');const qs=m.groups.flatMap(g=>g.questions);[0,1,2].forEach(i=>onPracticeSelect('B',qs[i].originalQNo,m.moduleId,i));}})()""")
    page.evaluate("navigate('revision_hub')")
    t = page.inner_text('#mainView')
    rec('revision hub: honest heading (no "Spaced Repetition Engine" claim)', 'Spaced Repetition Engine' not in t and 'Live Engine' not in t)
    due = page.evaluate("reviewDue().length"); dq = page.evaluate("reviewDue().filter(x=>x.kind==='q').length")
    rec('new mistakes are due today as revision cards', dq == 3, (dq, due))
    rec('flashcards come only from real topic decks (no fake Ohm card for imports)', page.evaluate(f"reviewItems('{M}').every(x=>x.kind==='q')"))
    rec('revision hub lists only this workspace', page.evaluate("reviewItems().every(x=>WorkspaceManager.matches(x.mod))"))
    page.screenshot(path=OUT + '/u4b_hub.png')
    page.evaluate(f"navigate('revision',{{moduleId:'{M}'}})")
    rec('topic revision page shows 3 due', '3 to revise today' in page.inner_text('#mainView'))
    page.locator('.rv-start').click()
    rec('session shows a past-mistake question card', page.locator('.rv-card .lc-opt').count() == 4)
    page.screenshot(path=OUT + '/u4b_card.png')
    # Card 1: answer correctly -> rate Easy (7 days)
    page.locator('.rv-card .lc-opt').first.click()  # A is correct
    rec('correct answer shows rating buttons', page.locator('.rv-r').count() == 3)
    n_before = page.evaluate("AttemptHistory.filter(a=>a.mode==='revision').length")
    rec('revision answer saved to history', n_before == 1)
    page.locator('.rv-r.easy').click()
    k1 = page.evaluate("RevisionSession.keys[0]")
    d1 = page.evaluate(f"ReviewState.cards['{k1}'].due")
    exp7 = page.evaluate("sjAddDays(sjLocalDay(),7)")
    rec('Easy schedules 7 days later', d1 == exp7, (d1, exp7))
    # Card 2: answer wrong -> forced again tomorrow
    page.locator('.rv-card .lc-opt').nth(1).click()
    rec('wrong answer: only "review again tomorrow"', page.locator('.rv-r').count() == 0 and 'tomorrow' in page.inner_text('.rv-card'))
    page.locator('.rv-card .btn-nav.primary').click()
    k2 = page.evaluate("RevisionSession.keys[1]")
    rec('wrong → due tomorrow', page.evaluate(f"ReviewState.cards['{k2}'].due") == page.evaluate("sjAddDays(sjLocalDay(),1)"))
    # Card 3: Okay -> 3 days
    page.locator('.rv-card .lc-opt').first.click(); page.locator('.rv-r.okay').click()
    k3 = page.evaluate("RevisionSession.keys[2]")
    rec('Okay → 3 days', page.evaluate(f"ReviewState.cards['{k3}'].due") == page.evaluate("sjAddDays(sjLocalDay(),3)"))
    rec('session summary at end', 'Revision done' in page.inner_text('#mainView') and '3 reviewed' in page.inner_text('#mainView'))
    page.evaluate("revisionEnd()")
    rec('after session nothing due today', page.evaluate(f"reviewDue('{M}').length") == 0)
    # Auto-resolve: make card 1 due again and answer correctly twice
    before = page.evaluate("UserState.mistakeBook.filter(m=>!sjIsSeedMistake(m)).length")
    page.evaluate(f"ReviewState.cards['{k1}'].due=sjLocalDay(); revisionStart('{M}')")
    page.locator('.rv-card .lc-opt').first.click()
    rec('2nd correct in a row removes it from Mistake Book', page.evaluate("UserState.mistakeBook.filter(m=>!sjIsSeedMistake(m)).length") == before - 1 and 'removed from the Mistake Book' in page.inner_text('.rv-card'))
    page.locator('.rv-r.easy').click()
    page.evaluate("revisionEnd()")
    # Flashcards for built-in topic deck
    page.evaluate("navigate('revision',{moduleId:'maths-percentage-class-test'})")
    page.locator('.rv-start').click()
    rec('flashcard deck card shows', page.locator('.rv-front').count() == 1 and 'Flashcard' in page.inner_text('.rv-kind').title())
    page.locator('.rv-card .btn-nav.primary', has_text='Show answer').click()
    page.locator('.rv-r.hard').click()
    rec('flashcard rating saved (1 day)', page.evaluate("ReviewState.cards['fc:maths-percentage-class-test:0'].due") == page.evaluate("sjAddDays(sjLocalDay(),1)"))
    page.evaluate("revisionEnd()")
    page.wait_for_timeout(400); page.reload(); page.wait_for_selector('#mainView', timeout=15000)
    rec('reload: review schedule persisted', page.evaluate(f"!!ReviewState.cards['{k1}'] && !!ReviewState.cards['fc:maths-percentage-class-test:0']"))

    # Mistake reasons
    page.evaluate("MistakeViewState.allExams=true; navigate('mistakes')")
    t = page.inner_text('#mainView')
    rec('mistake label is honest (no fake root-cause code)', 'CONCEPTUAL_MISMATCH' not in t and 'Wrong in practice' in t)
    page.locator('.mr-chip', has_text='Calculation').first.click()
    rec('reason tag saved', page.evaluate("Object.values(ReviewState.reasons).includes('calc')"))
    rec('reason chart appears', 'Why mistakes happen' in page.inner_text('#mainView'))
    page.screenshot(path=OUT + '/u4b_mistakes.png')
    page.evaluate("MistakeViewState.allExams=false")

    # Bookmarks
    page.evaluate(f"navigate('practice',{{moduleId:'{M}',qIndex:5}})")
    page.locator('.bm-btn').first.click()
    rec('bookmark from practice', page.evaluate("ReviewState.bookmarks.length") == 1 and page.locator('.bm-btn.on').count() == 1)
    page.evaluate("(()=>{const m=getWorkspaceModule('maths-number-system-class-test');initTestSession(m.moduleId,m.groups[0].groupId,0)})()")
    page.locator('.cbt-bm').click()
    rec('bookmark from inside a CBT (test keeps running)', page.evaluate("ReviewState.bookmarks.length===2 && ActiveTestSession?.sessionStatus==='ACTIVE'"))
    page.evaluate("CbtExitGuard.confirmExit(); navigate('revision_hub')")
    rec('bookmarks listed in revision hub', page.locator('.bm-row').count() == 2)
    page.locator('button', has_text='Test from bookmarks').click()
    rec('test from bookmarks → builder with 2 questions', page.evaluate("Route.page==='native_builder' && SB.hist==='bookmarked' && sbCustomRows('pick').length===2"))
    page.evaluate("sbStartOver(); navigate('home')")

    # Practice filters
    page.evaluate(f"navigate('practice',{{moduleId:'{M}',qIndex:0}})")
    page.locator('.pf-bar summary').click()
    page.locator('.pf-bar .filter-pill', has_text='Hard').click()
    rec('practice filter Hard → only hard questions', page.evaluate(f"practiceFilteredQuestions(getWorkspaceModule('{M}')).every(q=>q.metadata.difficulty==='HARD')") and '/6)' in page.inner_text('.section-title'))
    page.locator('.pf-bar .filter-pill', has_text='Bookmarked').click()
    cnt = page.evaluate(f"practiceFilteredQuestions(getWorkspaceModule('{M}')).length")
    rec('filters combine (hard + bookmarked)', cnt <= 2, cnt)
    page.locator('.pf-bar .filter-pill', has_text='Not tried yet').click()
    rec('status filter switches (not tried yet)', page.evaluate("PracticeFilter.status") == 'new')
    page.evaluate("PracticeFilter={diff:'HARD',type:'THEORY',status:''}; navigate('practice',{moduleId:'maths-number-system-class-test',qIndex:0})")
    rec('no-match filters: clear empty state (not kicked to Home)', page.evaluate("Route.page") == 'practice' and 'No question matches these filters' in page.inner_text('#mainView'))
    page.locator('#mainView .sj-empty .btn-nav').click()
    rec('clear filters restores questions', page.evaluate("!PracticeFilter.diff && !PracticeFilter.type") and page.locator('.options-list .opt-card').count() >= 1)
    page.screenshot(path=OUT + '/u4b_practice.png')
    for w in [360, 1280]:
        page.set_viewport_size({'width': w, 'height': 900})
        for route in ["navigate('revision_hub')", "navigate('mistakes')", f"navigate('practice',{{moduleId:'{M}',qIndex:0}})"]:
            page.evaluate(route)
            ov = page.evaluate("(()=>{const m=document.getElementById('mainView');return m.scrollWidth-m.clientWidth})()")
            if ov > 1: rec(f'overflow {route} at {w}', False, ov)
    rec('no horizontal overflow (revision, mistakes, practice @360/1280)', True)
    rec('no page/console errors', not errors, errors)
    b.close()
json.dump(results, open(OUT + '/u4b_results.json', 'w'), indent=1, ensure_ascii=False)
print('TOTAL', len(results), 'FAIL', sum(1 for r in results if r[1] == 'FAIL'))
