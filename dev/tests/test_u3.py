import sys, json
from playwright.sync_api import sync_playwright
PATH, OUT = sys.argv[1], sys.argv[2]
results = []
def rec(name, ok, detail=''):
    results.append((name, 'PASS' if ok else 'FAIL', str(detail)[:220])); print('PASS' if ok else 'FAIL', name, str(detail)[:220])

SUBJECTS = ['History', 'Geography', 'Polity', 'Economics', 'Computer', 'Hindi', 'General Awareness', 'Current Affairs', 'English', 'Reasoning']
def make_txt(subject, n, start):
    out = []
    for i in range(n):
        q = start + i
        out.append(f"""=== QUESTION START ===
SOURCE_QUESTION_NO: {q}
EXAM_NAME: SSC CGL
YEAR: 2023
SUBJECT: {subject}
CHAPTER: Basics
TOPIC: {subject} Basics
SUB_TOPIC: Core
DIFFICULTY: MODERATE
QUESTION_EN: {subject} question {q}: what is {q} + 1?
QUESTION_HI: {subject} प्रश्न {q}: {q} + 1 कितना है?
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
    page = b.new_page(viewport={'width': 360, 'height': 780})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append('console:' + m.text) if m.type == 'error' else None)
    page.goto('file://' + PATH); page.wait_for_selector('.sj-dash', timeout=15000)
    for i, s in enumerate(SUBJECTS):
        r = page.evaluate("""async ([t,topic])=>{const a=await ImportEngine.analyzeTxt(new File([t],'q.txt'),topic);if(!a.commitReady)return {ok:false};const c=await ImportEngine.commit(a);return {ok:true,n:c.committedQuestions}}""", [make_txt(s, 3, 8000 + i * 10), s + ' Basics'])
        if not r.get('ok'): rec(f'import {s}', False, r)
    subs = page.evaluate("[...new Set(nbSourceRows().filter(r=>r.examId==='ssc-cgl').map(r=>r.subject))]")
    rec('10 subjects imported into SSC CGL 2023', len(subs) == 10, subs)
    labels = page.evaluate("[...new Set(nbSourceRows().filter(r=>r.examId==='ssc-cgl').map(r=>sbSubjectLabel(r.subject)))].sort()")
    rec('subject names are correct (no "Reasoning" mislabel)', labels == sorted(['History', 'Geography', 'Polity', 'Economics', 'Computer', 'Hindi', 'General Awareness', 'Current Affairs', 'English', 'Reasoning']), labels)
    rec('new imports store a correct subject title', page.evaluate("getWorkspaceModule('history-history-basics-class-test')?.subjectTitle") == '📘 History', page.evaluate("getWorkspaceModule('history-history-basics-class-test')?.subjectTitle"))

    # Build 10-subject test through the Builder UI
    page.evaluate("navigate('native_builder'); sbStartOver(); sbStartMode('custom')")
    page.locator('.sb-item', has_text='SSC').first.click()
    st = page.evaluate("SB.step")
    if st == 'exam': page.locator('.sb-item').first.click()
    rec('drill-down reaches subject level', page.evaluate("SB.step") == 'subject', page.evaluate("SB.step"))
    rec('10 subjects to choose', page.locator('.sb-list .sb-item').count() == 10)
    while page.evaluate("SB.step") not in ('settings',):
        page.locator('.sb-bar .btn-nav').click()
    page.locator('.sb-chip', has_text='All 30').click()
    page.locator('.sb-bar .btn-nav').click()
    order = page.evaluate("SB.previewIds.map(id=>nbSourceRows().find(r=>r.id===id).subject)")
    blocks = [order[0]] + [s for i, s in enumerate(order[1:], 1) if s != order[i - 1]]
    rec('preview grouped subject-wise (10 contiguous sections)', len(blocks) == 10 and len(set(blocks)) == 10, blocks)
    page.locator('.sb-bar .btn-nav').click(); page.locator('.sb-bar .btn-nav').click()
    rec('10-subject CBT started', page.evaluate("ActiveTestSession?.sessionStatus==='ACTIVE' && ActiveTestSession.questions.length===30"))
    page.wait_for_timeout(300)
    tabs = page.locator('#cbtSubjects .cbt-subj')
    rec('subject strip shows 10 horizontal tabs', tabs.count() == 10)
    rec('first tab active with 0/3', 'on' in tabs.nth(0).get_attribute('class') and '0/3' in tabs.nth(0).inner_text())
    sizes = page.evaluate("[...document.querySelectorAll('#cbtSubjects .cbt-subj, .cbt-subj-all')].map(b=>Math.round(b.getBoundingClientRect().height))")
    rec('subject tabs are ≥44px tall (easy to tap)', min(sizes) >= 44, sizes[:3])
    rec('strip scrolls sideways; edge fade shows more tabs', page.evaluate("(()=>{const s=document.getElementById('cbtSubjects');return s.scrollWidth>s.clientWidth && s.classList.contains('more-right')})()"))
    vo = page.evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth")
    rec('no page-level horizontal overflow at 360px', vo <= 1, vo)
    page.screenshot(path=OUT + '/u3_cbt_strip_360.png')
    # Jump to tab 6, answer, check counts update
    tabs.nth(5).click()
    idx = page.evaluate("Number(Route.params.qIndex)")
    exp_first = page.evaluate("cbtSubjectsInfo()[5].indices[0]")
    rec('tap tab 6 → first question of that subject', idx == exp_first, (idx, exp_first))
    rec('active tab scrolled into view', page.evaluate("(()=>{const s=document.getElementById('cbtSubjects');const on=s.querySelector('.on');const a=on.getBoundingClientRect(),b=s.getBoundingClientRect();return a.left>=b.left-1&&a.right<=b.right+1})()"))
    page.locator('.opt-card').first.click()
    rec('answering updates tab count (1/3)', '1/3' in page.locator('#cbtSubjects .cbt-subj.on').inner_text())
    page.locator('.btn-nav-next').click()  # second question of subject 6
    second = page.evaluate("Number(Route.params.qIndex)")
    tabs = page.locator('#cbtSubjects .cbt-subj'); tabs.nth(0).click()
    tabs = page.locator('#cbtSubjects .cbt-subj'); tabs.nth(5).click()
    rec('coming back to a subject reopens where you left it', page.evaluate("Number(Route.params.qIndex)") == second, (page.evaluate("Number(Route.params.qIndex)"), second))
    page.screenshot(path=OUT + '/u3_cbt_tab6.png')
    # Auto next section with toast
    last_of_1 = page.evaluate("cbtSubjectsInfo()[0].indices.slice(-1)[0]")
    page.evaluate(f"switchQuestion({last_of_1})")
    page.locator('.btn-nav-next').click()
    page.wait_for_timeout(150)
    toast = page.evaluate("(()=>{const t=document.getElementById('cbtToast');return t&&t.classList.contains('show')?t.textContent:''})()")
    rec('Save & Next at end of a subject moves on and shows "Next section"', toast.startswith('Next section:') and 'on' in page.locator('#cbtSubjects .cbt-subj').nth(1).get_attribute('class'), toast)
    rec('toast does not block (no modal opened)', not page.evaluate("document.getElementById('modalSheet').classList.contains('open')"))
    page.screenshot(path=OUT + '/u3_cbt_toast.png')
    # ▾ all-subjects sheet
    page.locator('.cbt-subj-all').click()
    rec('▾ opens list of all 10 subjects', page.locator('#modalSheetBody .sj-action').count() == 10)
    page.screenshot(path=OUT + '/u3_cbt_sheet.png')
    page.locator('#modalSheetBody .sj-action').nth(9).click()
    rec('tap in sheet jumps to that subject', page.evaluate("cbtQuestionSubject(Number(Route.params.qIndex))") == page.evaluate("cbtSubjectsInfo()[9].key") and not page.evaluate("document.getElementById('modalSheet').classList.contains('open')"))
    # Palette grouped
    page.locator('#questionPaletteToggle').click()
    rec('question palette grouped by subject (10 headings)', page.locator('.palette-section-head').count() == 10)
    page.screenshot(path=OUT + '/u3_palette.png')
    page.evaluate("closeQuestionPalette()")
    # Answer some: right on first 2 of each subject? answer every question; wrong on 3rd of each
    page.evaluate("""(()=>{const s=ActiveTestSession;s.questions.forEach((q,i)=>{const k=nbQuestionKey(q);s.answers[k]=(i%3===2)?'B':q.answer;});saveCbtRecoveryState();renderView();})()""")
    page.wait_for_timeout(1100)
    page.evaluate("submitTestSession()")
    t = page.inner_text('#mainView')
    rec('result: score by subject table with 10 rows', page.locator('.rs-tr:not(.rs-th)').count() == 10)
    rec('result: subject rows show 2/3 and 67%', '2/3' in t and '67%' in t)
    rec('result: Retake + Retry wrong buttons', 'Retake this test' in t and 'Retry 10 wrong answers' in t)
    rec('result: time section with slowest questions', 'slowest questions' in t.lower())
    rec('result: time chip on solution cards', page.locator('.rs-time').count() >= 1)
    rec('no "compare" card on first attempt', page.locator('.rs-compare').count() == 0)
    page.screenshot(path=OUT + '/u3_result.png', full_page=False)
    page.locator('#mainView').evaluate("e=>e.scrollTo(0,520)"); page.screenshot(path=OUT + '/u3_result_2.png')
    first_ids = page.evaluate("Route.params.result.questions.map(q=>q.canonicalQId)")
    page.locator('.rs-actions .btn-nav', has_text='Retake').click()
    rec('Retake starts same questions in same order', page.evaluate("ActiveTestSession?.questionIds") == first_ids)
    page.evaluate("""(()=>{const s=ActiveTestSession;s.questions.forEach((q,i)=>{s.answers[nbQuestionKey(q)]=q.answer});renderView()})()""")
    page.wait_for_timeout(400)
    page.evaluate("submitTestSession()")
    rec('second attempt: compare card shows improvement', page.locator('.rs-compare').count() == 1 and '10 more correct' in page.inner_text('.rs-compare'), page.inner_text('#mainView')[:0])
    page.screenshot(path=OUT + '/u3_compare.png')
    # Retry wrong from first result (open from history)
    page.evaluate("openStoredResult(ResultHistory[1].id)")
    page.locator('.rs-actions .btn-nav', has_text='Retry').click()
    rec('Retry wrong: test of only the 10 wrong questions', page.evaluate("ActiveTestSession?.questions.length===10 && ActiveTestSession.topicTitle==='Retry: wrong answers'"))
    page.evaluate("CbtExitGuard.confirmExit(); navigate('home')")

    # Single-subject test: no strip
    page.evaluate("(()=>{const m=getWorkspaceModule('maths-percentage-class-test');initTestSession(m.moduleId,m.groups[0].groupId,0)})()")
    rec('single-subject test: no subject strip (clean header)', page.locator('#cbtSubjects').count() == 0)
    page.evaluate("selectOption(ActiveTestSession.questions[0].answer,0)")
    page.wait_for_timeout(300)
    page.evaluate("submitTestSession()")
    rec('legacy group result still renders with actions', 'Retake this test' in page.inner_text('#mainView') and page.evaluate("Route.params.result.correct") == 1)
    page.locator('.rs-actions .btn-nav', has_text='Retake').click()
    rec('legacy Retake restarts the same group', page.evaluate("ActiveTestSession?.groupId") == 'percentage-class-test-g01')
    page.evaluate("CbtExitGuard.confirmExit(); navigate('home')")
    # Dark mode CBT
    page.evaluate("toggleCbtDark(); (()=>{const ids=nbSourceRows().filter(r=>r.examId==='ssc-cgl').map(r=>r.id);sbLaunch(ids,30,'both','Dark check')})()")
    page.screenshot(path=OUT + '/u3_cbt_dark.png')
    page.evaluate("CbtExitGuard.confirmExit(); toggleCbtDark(); navigate('home')")
    rec('no page/console errors', not errors, errors)
    b.close()
json.dump(results, open(OUT + '/u3_results.json', 'w'), indent=1, ensure_ascii=False)
print('TOTAL', len(results), 'FAIL', sum(1 for r in results if r[1] == 'FAIL'))
