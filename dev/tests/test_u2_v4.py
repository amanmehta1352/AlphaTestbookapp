import sys, json
from playwright.sync_api import sync_playwright
sys.path.insert(0, '.')
PATH, OUT = sys.argv[1], sys.argv[2]
results = []
def rec(name, ok, detail=''):
    results.append((name, 'PASS' if ok else 'FAIL', str(detail)[:220])); print('PASS' if ok else 'FAIL', name, str(detail)[:220])

def make_txt(topic, sub, n, exam, year, subject, start):
    out = []
    for i in range(n):
        q = start + i
        out.append(f"""=== QUESTION START ===
SOURCE_QUESTION_NO: {q}
EXAM_NAME: {exam}
YEAR: {year}
SUBJECT: {subject}
CHAPTER: General
TOPIC: {topic}
SUB_TOPIC: {sub if i % 2 == 0 else sub + ' II'}
DIFFICULTY: {'EASY' if i%3==0 else 'MODERATE'}
SOURCE_TYPE: PYQ
QUESTION_EN: {topic} question {q}: what is {q} + 1?
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

def step(page): return page.evaluate("SB.step")
def bar(page): return page.inner_text('.sb-bar')

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844})
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append('console:' + m.text) if m.type == 'error' else None)
    page.goto('file://' + PATH); page.wait_for_selector('.sj-dash', timeout=15000)
    for args in [('Number System', 'Divisibility', 25, 'RRB Group D', '2024', 'Maths', 5001),
                 ('Boats and Streams', 'Upstream', 6, 'RRB Group D', '2024', 'Maths', 6001),
                 ('Coding Decoding', 'Letter Coding', 12, 'SSC CGL', '2023', 'Reasoning', 7001)]:
        r = page.evaluate("""async ([t,topic])=>{const a=await ImportEngine.analyzeTxt(new File([t],'q.txt'),topic);if(!a.commitReady)return {ok:false};const c=await ImportEngine.commit(a);return {ok:true,n:c.committedQuestions}}""", [make_txt(*args), args[0]])
        rec(f'import {args[0]}', r.get('ok') and r.get('n') == args[2], r)

    # ---- Mode screen ----
    page.evaluate("navigate('native_builder')")
    t = page.inner_text('#mainView')
    rec('mode screen: 3 modes with fixed meaning', all(x in t for x in ['Quick Test', 'PYQ Test', 'Custom Test', 'Start in one tap']))
    rec('mode screen: Full Mock shown as small unavailable line', 'Full Mock: available once a verified exam pattern is added' in t)
    rec('old wizard UI is gone', page.evaluate("!document.querySelector('.nb-wizard-progress')"))
    rec('global header/bottom nav hidden in builder', page.evaluate("getComputedStyle(document.getElementById('appHeader')).display==='none' && getComputedStyle(document.getElementById('bottomNav')).display==='none'"))
    page.screenshot(path=OUT + '/u2_mode.png')

    # ---- Quick ----
    page.locator('.sb-mode').nth(0).click()
    rec('Quick opens one screen', step(page) == 'quick')
    page.screenshot(path=OUT + '/u2_quick.png')
    page.locator('.sb-preset').nth(0).click()
    q = page.evaluate("({a:ActiveTestSession?.sessionStatus,n:ActiveTestSession?.questions.length,t:ActiveTestSession?.topicTitle,ctx:new Set(ActiveTestSession?.questions.map(q=>{const r=nbSourceRows().find(x=>x.id===q.canonicalQId);return r.examId+'|'+r.year})).size,route:Route.page})")
    rec('Quick Daily 10: one tap starts a 10-question CBT', q['a'] == 'ACTIVE' and q['n'] == 10 and q['route'] == 'test', q)
    rec('Quick test title is meaningful', q['t'] == 'Quick Test · Daily 10', q['t'])
    rec('Quick test uses one exam/year', q['ctx'] == 1)
    rec('Quick test minutes = 10', page.evaluate("ActiveTestSession.durationSeconds") == 600)
    # recovery keeps title
    page.wait_for_timeout(400); page.reload(); page.wait_for_selector('#cbtViewport', timeout=15000)
    rec('reload: CBT recovered with same title', page.evaluate("ActiveTestSession?.sessionStatus==='ACTIVE' && ActiveTestSession.topicTitle==='Quick Test · Daily 10'"))
    rec('CBT marks text is truthful (+1, no negative)', '0 neg' in page.inner_text('#cbtViewport .q-marks'))
    page.evaluate("CbtExitGuard.confirmExit(); navigate('native_builder')")
    rec('after start, builder resets to mode screen', step(page) == 'mode')
    # Quick: unattempted first
    first10 = page.evaluate("ResultHistory.length")  # nothing submitted; use attempts instead
    page.evaluate("""(()=>{SB=sbFresh();SB.mode='quick';SB.step='quick';SB.stack=['mode'];const ctxRows=nbSourceRows().filter(r=>r.examId+'\\u241f'+r.year===sbQuickContextKey());
      const seenIds=ctxRows.slice(0,ctxRows.length-5).map(r=>r.id);seenIds.forEach(id=>AttemptHistory.push({v:1,ws:WorkspaceManager.current().id,cid:id,day:'2020-01-01',mode:'practice',correct:true}));window.__fresh=ctxRows.slice(-5).map(r=>r.id);renderView();})()""")
    page.locator('.sb-preset').nth(0).click()
    fr = page.evaluate("ActiveTestSession.questionIds.slice(0,5).every(id=>window.__fresh.includes(id))")
    rec('Quick puts not-attempted questions first', fr)
    page.evaluate("CbtExitGuard.confirmExit(); AttemptHistory.length=0; navigate('native_builder')")
    # Quick shortage (profit-loss context: 2 questions)
    page.evaluate("""(()=>{SB=sbFresh();SB.mode='quick';SB.step='quick';SB.stack=['mode'];const c=sbContexts().find(c=>c.count<10);SB.quickCtx=c.key;window.__n=c.count;renderView();})()""")
    page.locator('.sb-preset').nth(0).click()
    rec('Quick with few questions: starts with all available, time scaled', page.evaluate("ActiveTestSession?.questions.length===window.__n && ActiveTestSession.durationSeconds===Math.max(1,Math.round(10*window.__n/10))*60"))
    page.evaluate("CbtExitGuard.confirmExit(); navigate('native_builder')")

    # ---- Custom drill-down ----
    page.locator('.sb-mode').nth(2).click()
    rec('Custom starts at Board', step(page) == 'board', step(page))
    boards = page.evaluate("[...document.querySelectorAll('.sb-list .sb-item strong')].map(x=>x.textContent)")
    rec('Boards listed (RRB, SSC)', 'RRB' in boards and 'SSC' in boards, boards)
    page.screenshot(path=OUT + '/u2_board.png')
    page.locator('.sb-item', has_text='RRB').first.click()
    rec('tap board → exam level', step(page) == 'exam')
    page.locator('.sb-item', has_text='RRB Group D').first.click()
    rec('single-year and single-subject levels auto-skipped → topic', step(page) == 'topic', (step(page), page.evaluate("SB.stack")))
    crumbs = page.inner_text('.sb-crumbs')
    rec('crumb trail shows Board › Exam › Year', 'RRB' in crumbs and 'RRB Group D' in crumbs and '2024' in crumbs, crumbs)
    page.screenshot(path=OUT + '/u2_topic.png')
    page.locator('.sb-item', has_text='Percentage').first.click()
    b1 = bar(page)
    rec('unticking a topic updates live count (31)', '31' in b1, b1)
    page.locator('.sb-bar .btn-nav').click()
    rec('topic → subtopic', step(page) == 'subtopic')
    subs = page.locator('.sb-list .sb-item').count()
    rec('subtopics listed for chosen topics only (4)', subs == 4, subs)
    page.locator('.sb-bar .btn-nav').click()
    rec('subtopic → type', step(page) == 'type')
    page.locator('.sb-chip', has_text='Easy').click()
    b2 = bar(page)
    exp = page.evaluate("sbCustomRows('type').length")
    rec('turning off Easy updates count', str(exp) in b2 and exp == 20, (b2, exp))
    page.screenshot(path=OUT + '/u2_type.png')
    page.locator('.sb-bar .btn-nav').click()
    rec('type → questions', step(page) == 'questions')
    page.locator('.sb-bar .btn-nav').click()
    rec('questions → settings', step(page) == 'settings')
    rec('settings default count = min(20, pool) and minutes = count', page.evaluate("SB.count===20 && SB.minutes===20"))
    page.fill('#sbCountIn', '25')
    rec('asking more than available shows "Use N" and blocks Preview', page.locator('.sb-warn').count() == 1 and page.locator('.sb-bar .btn-nav').is_disabled())
    page.locator('.sb-warn .btn-nav').click()
    rec('"Use 20" fixes count', page.evaluate("SB.count") == 20 and not page.locator('.sb-bar .btn-nav').is_disabled())
    page.locator('#sbBody .sb-seg button').nth(2).click()
    rec('language choice saved', page.evaluate("SB.lang") == 'hi')
    rec('Hindi availability shown', '20 of 20 eligible questions have Hindi text' in page.inner_text('#sbBody'))
    page.screenshot(path=OUT + '/u2_settings.png')
    # crumb jump
    page.locator('.sb-crumbs button', has_text='RRB Group D').click()
    rec('tap crumb jumps back to that level', step(page) == 'exam')
    page.locator('.sb-item', has_text='RRB Group D').first.click()
    rec('re-choosing same exam keeps topic selections', page.evaluate("SB.exTopic.size") == 1 and step(page) == 'topic')
    for _ in range(4): page.locator('.sb-bar .btn-nav').click()
    rec('back at settings', step(page) == 'settings')
    page.locator('.sb-bar .btn-nav').click()
    rec('settings → preview with 20 questions', step(page) == 'preview' and page.evaluate("SB.previewIds.length") == 20)
    page.screenshot(path=OUT + '/u2_preview.png')
    page.locator('.sb-pq-actions button[title=Replace]').first.click()
    rec('replace with no spare question shows message (all 20 used)', 'No other eligible question' in page.inner_text('#modalSheetBody'))
    page.evaluate("closeModal()")
    page.locator('.sb-pq-actions button[title=Remove]').first.click()
    rec('remove question → 19, minutes follow', page.evaluate("SB.previewIds.length===19 && SB.minutes===19"))
    page.locator('.sb-pq-actions button[title=Replace]').first.click()
    rec('replace now works (spare question exists)', page.evaluate("SB.previewIds.length===19 && new Set(SB.previewIds).size===19"))
    ids = page.evaluate("SB.previewIds.slice()")
    page.locator('.sb-bar .btn-nav').click()
    rec('preview → instructions', step(page) == 'instructions')
    t = page.inner_text('#sbBody')
    rec('instructions state true marking & rules', 'no negative marking' in t and 'submits itself' in t and 'restored' in t)
    page.screenshot(path=OUT + '/u2_instructions.png')
    page.locator('.sb-bar .btn-nav').click()
    s = page.evaluate("({a:ActiveTestSession?.sessionStatus,ids:ActiveTestSession?.questionIds,lang:ActiveTestSession?.langMode,dur:ActiveTestSession?.durationSeconds})")
    rec('Start runs exactly the previewed questions in order', s['a'] == 'ACTIVE' and s['ids'] == ids, s['a'])
    rec('chosen language and time reach the CBT', s['lang'] == 'hi' and s['dur'] == 19 * 60)
    page.evaluate("CbtExitGuard.confirmExit(); navigate('native_builder')")

    # Back chain
    page.evaluate("sbStartMode('custom')"); page.locator('.sb-item', has_text='RRB').first.click(); page.locator('.sb-item', has_text='RRB Group D').first.click()
    page.locator('.sb-bar .btn-nav').click(); page.locator('.sb-bar .btn-nav').click()
    chain = []
    for _ in range(4):
        page.locator('.sb-back').click(); chain.append(step(page))
    rec('Back walks shown steps only (skipped ones not revisited)', chain == ['subtopic', 'topic', 'exam', 'board'], chain)
    # Browser/Android back
    page.locator('.sb-item', has_text='RRB').first.click()
    page.go_back(); page.wait_for_timeout(200)
    rec('browser/Android Back goes one builder step back', page.evaluate("Route.page") == 'native_builder' and step(page) == 'board', (page.evaluate("Route.page"), step(page)))

    # Choose myself
    page.evaluate("sbStartMode('custom')"); page.locator('.sb-item', has_text='RRB').first.click(); page.locator('.sb-item', has_text='RRB Group D').first.click()
    for _ in range(3): page.locator('.sb-bar .btn-nav').click()
    page.locator('.sb-seg button', has_text="I'll choose myself").click()
    page.fill('#sbQSearch', '5003')
    rec('question search keeps focus', page.evaluate("document.activeElement?.id==='sbQSearch'"))
    page.locator('.sb-q').first.click()
    page.fill('#sbQSearch', '')
    page.locator('.sb-q').nth(0).click(); page.locator('.sb-q').nth(1).click()
    page.locator('.sb-bar .btn-nav').click()
    rec('"choose myself": settings use picked count', step(page) == 'settings' and page.evaluate("SB.count") == page.evaluate("SB.picked.size") and page.evaluate("SB.picked.size") >= 2, page.evaluate("SB.picked.size"))

    # Template save/apply
    page.locator('#sbBody .btn-nav', has_text='template').click()
    page.fill('#sbTplName', 'Daily NS test'); page.locator('#modalSheetBody .btn-nav.primary').click()
    page.evaluate("navigate('native_builder');sbStartOver()")
    rec('template appears on mode screen', 'Daily NS test' in page.inner_text('#sbBody'))
    page.locator('.sb-tpl .sb-item').first.click()
    rec('template opens at settings with saved filters', step(page) == 'settings' and page.evaluate("SB.examId") == 'rrb-group-d')
    page.wait_for_timeout(400); page.reload(); page.wait_for_selector('.sb-shell', timeout=15000)
    rec('reload: builder draft restored at same step', step(page) == 'settings', step(page))
    rec('reload: template persisted', page.evaluate("BuilderTemplates.length") == 1)
    page.evaluate("sbStartOver()")
    page.on('dialog', lambda d: d.accept())
    page.locator('.sb-tpl-del').first.click()
    rec('template delete', page.evaluate("BuilderTemplates.length") == 0)

    # PYQ
    page.evaluate("sbStartOver()")
    pyqN = page.evaluate("sbPyqRows().length")
    rec('PYQ mode enabled when verified questions exist', pyqN > 0 and not page.locator('.sb-mode').nth(1).is_disabled(), pyqN)
    page.locator('.sb-mode').nth(1).click()
    page.screenshot(path=OUT + '/u2_pyq.png')
    page.locator('.sb-item', has_text='RRB Group D').first.click()
    st = step(page)
    if st == 'pyq_shift':
        page.locator('.sb-item').first.click()
    rec('PYQ reaches paper screen', step(page) == 'pyq_scope', step(page))
    page.locator('.sb-bar .btn-nav').click()
    rec('PYQ → instructions', step(page) == 'instructions')
    page.locator('.sb-bar .btn-nav').click()
    pq = page.evaluate("(()=>{const q=ActiveTestSession.questions.map(x=>Number(x.originalQNo));return {a:ActiveTestSession.sessionStatus,t:ActiveTestSession.topicTitle,sorted:q.every((v,i)=>!i||q[i-1]<=v)}})()")
    rec('PYQ runs in original question order with PYQ title', pq['a'] == 'ACTIVE' and pq['sorted'] and pq['t'].startswith('PYQ ·'), pq)
    page.evaluate("CbtExitGuard.confirmExit(); navigate('home')")

    # Entry points
    page.evaluate("navigate('topic',{moduleId:'maths-number-system-class-test'})")
    page.locator('.intent-tile', has_text='BUILD TEST').click()
    rec('Topic hub "Build Test" opens builder at settings for that topic only', page.evaluate("Route.page==='native_builder' && SB.step==='settings' && sbCustomRows('pick').every(r=>r.mod.moduleId==='maths-number-system-class-test') && sbCustomRows('pick').length===25 && SB.count===10"))
    page.evaluate("sbStartOver(); navigate('home')")
    info = page.evaluate("(()=>{const m=getWorkspaceModule('maths-number-system-class-test');const qs=m.groups.flatMap(g=>g.questions);return qs.slice(0,3).map(q=>q.originalQNo)})()")
    for qno in info:
        page.evaluate(f"onPracticeSelect('B',{qno},'maths-number-system-class-test',0)")
    page.evaluate("MistakeViewState.allExams=true; navigate('mistakes')")
    page.locator('button', has_text='Test from my mistakes').click()
    rec('Mistake Book → builder with only wrong questions', page.evaluate("Route.page==='native_builder' && SB.hist==='wrong' && sbCustomRows('pick').length===3"), page.evaluate("sbCustomRows('pick').length"))
    page.locator('.sb-bar .btn-nav').click(); page.locator('.sb-bar .btn-nav').click(); page.locator('.sb-bar .btn-nav').click()
    rec('mistakes test starts with title', page.evaluate("ActiveTestSession?.topicTitle==='Mistakes Test' && ActiveTestSession.questions.length===3"))
    page.evaluate("CbtExitGuard.confirmExit(); MistakeViewState.allExams=false; navigate('home')")

    # Practice renderer fix
    page.evaluate("navigate('practice',{moduleId:'maths-number-system-class-test',qIndex:0})")
    cls = page.evaluate("[...document.querySelectorAll('.options-list .opt-card')].map(e=>({c:e.className,s:e.getAttribute('style')||''}))")
    rec('practice: no "style=" junk inside class attribute', all('style' not in x['c'] for x in cls), cls[:2])
    rec('practice: wrong choice shown red, correct green', any('danger' in x['s'] for x in cls) and any('success' in x['s'] for x in cls))
    page.evaluate("navigate('home')")

    # Layout per step at 360px
    page.set_viewport_size({'width': 360, 'height': 760})
    page.evaluate("navigate('native_builder');sbStartOver()")
    worst = 0
    for s in ['mode', 'quick', 'board', 'topic', 'type', 'settings', 'preview']:
        page.evaluate(f"""(()=>{{if('{s}'==='quick'){{sbStartMode('quick');return}} if('{s}'==='mode'){{sbStartOver();return}}
          SB=sbFresh();SB.mode='custom';SB.board='RRB';SB.examId='rrb-group-d';SB.year='2024';SB.stack=['mode'];SB.step='{s}';renderView();}})()""")
        ov = page.evaluate("(()=>{const b=document.getElementById('sbBody');return Math.max(b.scrollWidth-b.clientWidth, document.documentElement.scrollWidth-document.documentElement.clientWidth)})()")
        worst = max(worst, ov)
        page.screenshot(path=OUT + f'/u2_360_{s}.png')
    rec('no horizontal overflow on any builder step at 360px', worst <= 1, worst)
    page.evaluate("toggleCbtDark(); renderView()"); page.screenshot(path=OUT + '/u2_dark_preview.png'); page.evaluate("toggleCbtDark()")
    small = page.evaluate("[...document.querySelectorAll('.sb-shell button')].filter(b=>b.offsetParent&&b.getBoundingClientRect().height<36).map(b=>b.textContent.trim()).slice(0,8)")
    rec('builder tap targets ≥ 36px tall', not small, small)


    # ---- App-wide Android/browser Back (now actually wired to window) ----
    page.evaluate("closeModal(); AppBackConfirmationOpen=false; navigate('home'); navigate('subjects')")
    page.go_back(); page.wait_for_timeout(250)
    rec('Back from Subjects returns Home', page.evaluate("Route.page") == 'home', page.evaluate("Route.page"))
    page.evaluate("AppRouteStack=[]; persistAppRoute()")
    page.go_back(); page.wait_for_timeout(250)
    rec('Back on Home asks before leaving (app stays open)', page.evaluate("Route.page==='home' && document.getElementById('modalSheet').classList.contains('open')") and 'Leave Master TestBook' in page.inner_text('#modalSheetTitle'))
    page.locator('#modalSheetBody button', has_text='CANCEL').click()
    page.evaluate("navigate('practice',{moduleId:'maths-number-system-class-test',qIndex:0})")
    page.go_back(); page.wait_for_timeout(250)
    rec('Back in Practice shows Submit/Exit/Cancel options', page.evaluate("Route.page") == 'practice' and 'Practice is in progress' in page.inner_text('#modalSheetTitle'))
    page.evaluate("cancelAppBack()")
    page.evaluate("navigate('home');(()=>{const m=getWorkspaceModule('maths-number-system-class-test');initTestSession(m.moduleId,m.groups[0].groupId,0)})()")
    page.go_back(); page.wait_for_timeout(250)
    rec('Back in CBT shows confirmation, test keeps running', page.evaluate("ActiveTestSession?.sessionStatus==='ACTIVE' && Route.page==='test'") and 'Test is in progress' in page.inner_text('#modalSheetTitle'))
    page.go_back(); page.wait_for_timeout(250)
    rec('repeated Back in CBT cannot bypass the guard', page.evaluate("ActiveTestSession?.sessionStatus==='ACTIVE' && Route.page==='test'"))
    page.evaluate("cancelCbtExit(); CbtExitGuard.confirmExit(); closeModal(); AppBackConfirmationOpen=false; navigate('home')")
    # Board workspace
    page.evaluate("switchWorkspace('ws-board-cbse-10'); navigate('native_builder')")
    rec('Board workspace: clear message instead of empty builder', 'competitive exam workspaces' in page.inner_text('#mainView'))
    page.evaluate("switchWorkspace('ws-comp-legacy')")
    rec('no page/console errors', not errors, errors)
    b.close()
json.dump(results, open(OUT + '/u2_results.json', 'w'), indent=1, ensure_ascii=False)
print('TOTAL', len(results), 'FAIL', sum(1 for r in results if r[1] == 'FAIL'))
