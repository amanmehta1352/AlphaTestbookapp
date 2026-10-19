"""V3 design checks: CBT confidence tags, result help, no overflow at 360/412 px, tap targets, contrast, dark mode.
Usage: python3 test_v3.py APP.html OUT.json"""
import sys, json
from playwright.sync_api import sync_playwright
APP, OUT = sys.argv[1], sys.argv[2]
results = []
def rec(name, ok, detail=''):
    results.append((name, 'PASS' if ok else 'FAIL', str(detail)[:260])); print('PASS' if ok else 'FAIL', name, str(detail)[:260])
CONTRAST = """(sel)=>{const el=document.querySelector(sel); if(!el) return 0;
 const rgb=s=>{const m=s.match(/[\\d.]+/g).map(Number);return m};
 const lum=c=>{const a=c.slice(0,3).map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});return .2126*a[0]+.7152*a[1]+.0722*a[2]};
 let bg=null,n=el; while(n){const c=getComputedStyle(n).backgroundColor; const v=rgb(c); if(v.length<4||v[3]>0.9){bg=v;break} n=n.parentElement}
 bg=bg||[255,255,255]; const fg=rgb(getComputedStyle(el).color); const L1=lum(fg),L2=lum(bg); return (Math.max(L1,L2)+.05)/(Math.min(L1,L2)+.05)}"""
OVER = "document.documentElement.scrollWidth<=window.innerWidth+1"
with sync_playwright() as p:
    b = p.chromium.launch(); errors = []
    pg = b.new_page(viewport={'width': 360, 'height': 780}); pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('dialog', lambda d: d.accept())
    pg.goto('file://' + APP); pg.wait_for_selector('.sj-dash', timeout=20000); pg.wait_for_timeout(300)
    # Exam-first home launcher must only expose real, wired routes.
    expected_tiles = [
        ('Exams', 'exam_hub'), ('Mock tests', 'test_hub'), ('PYQ papers', 'pyq_hub'),
        ('Topic practice', 'subjects'), ('Test builder', 'native_builder'),
        ('Study library', 'digital_library'), ('Question bank', 'taxonomy_explorer'),
        ('Revision', 'revision_hub')
    ]
    labels = pg.locator('.gx-quick .sj-quick-btn').all_inner_texts()
    rec('home exposes eight exam-first preparation tiles',
        len(labels) == 8 and all(label in ' '.join(labels) for label, _ in expected_tiles), labels)
    for i, (label, route) in enumerate(expected_tiles):
        pg.evaluate("navigate('home')")
        pg.locator('.gx-quick .sj-quick-btn').nth(i).click()
        actual = pg.evaluate("Route.page")
        rec(f'home tile {label} → {route}', actual == route, actual)
    pg.evaluate("navigate('home'); document.getElementById('btnMenu').click()")
    drawer_sections = pg.locator('#sideDrawer .drawer-section-title').all_inner_texts()
    rec('drawer groups exam prep, learning, revision and app tools',
        all(x in ' '.join(drawer_sections) for x in ['PREPARE','LEARN & PRACTICE','REVISE & TRACK','APP TOOLS & DATA']),
        drawer_sections)
    pg.evaluate("closeDrawer(); navigate('home')")
    for w in (360, 412):
        pg.set_viewport_size({'width': w, 'height': 800})
        bad = []
        for route in ['home', 'subjects', 'test_hub', 'revision_hub', 'exam_hub']:
            pg.evaluate(f"navigate('{route}')"); pg.wait_for_timeout(250)
            if not pg.evaluate(OVER): bad.append(route)
        rec(f'no sideways scroll at {w}px (home, subjects, tests, revision, exams)', not bad, bad)
    pg.set_viewport_size({'width': 1024, 'height': 768}); pg.evaluate("navigate('home')"); pg.wait_for_timeout(250)
    rec('tablet: quick-action labels never break inside a word', pg.evaluate("[...document.querySelectorAll('.sj-quick-btn')].every(b=>b.scrollWidth<=b.clientWidth+1)"))
    pg.set_viewport_size({'width': 412, 'height': 800}); pg.evaluate("navigate('home')"); pg.wait_for_timeout(200)
    rec('dock tabs are at least 48px tall', pg.evaluate("[...document.querySelectorAll('#bottomNav .nav-tab')].every(t=>t.getBoundingClientRect().height>=48)"))
    rec('V3 fonts and tokens are active', 'Inter' in pg.evaluate("getComputedStyle(document.body).fontFamily") and pg.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()") != '')
    rec('closed drawer casts no shadow on the page', pg.evaluate("getComputedStyle(document.getElementById('sideDrawer')).visibility") == 'hidden')
    for dark in (False, True):
        pg.evaluate(f"document.body.classList.toggle('dark',{str(dark).lower()})"); pg.evaluate("navigate('home')"); pg.wait_for_timeout(200)
        c1 = pg.evaluate(f"({CONTRAST})('.gx-hero h1')"); c2 = pg.evaluate(f"({CONTRAST})('.gx-hero p')"); c3 = pg.evaluate(f"({CONTRAST})('#bottomNav .nav-tab.active')")
        rec(f'{"dark" if dark else "light"}: text contrast ≥ 4.5 (title, body, active tab)', min(c1, c2, c3) >= 4.5, (round(c1, 1), round(c2, 1), round(c3, 1)))
    pg.evaluate("document.body.classList.remove('dark')")
    # CBT confidence
    pg.evaluate("(()=>{const m=getWorkspaceModule('maths-percentage-class-test');initTestSession(m.moduleId,m.groups[0].groupId,0)})()"); pg.wait_for_timeout(400)
    rec('no "How sure?" row before answering', pg.locator('.cf-row').count() == 0)
    qs = pg.evaluate("ActiveTestSession.questions.slice(0,3).map(q=>q.answer)")
    plan = [(0, qs[0], 'sure'), (1, 'ABCD'.replace(qs[1], '')[0], 'sure'), (2, qs[2], 'guess')]
    for i, letter, lv in plan:
        pg.evaluate(f"switchQuestion({i})"); pg.wait_for_timeout(120); pg.evaluate(f"selectOption('{letter}',{i})"); pg.wait_for_timeout(120)
        pg.locator('.cf-btn').nth(['sure', 'doubt', 'guess'].index(lv)).click(); pg.wait_for_timeout(120)
    rec('"How sure?" appears after answering, buttons ≥ 44px', pg.locator('.cf-row').count() == 1 and pg.evaluate("[...document.querySelectorAll('.cf-btn')].every(b=>b.getBoundingClientRect().height>=44)"))
    rec('confidence saved per question', pg.evaluate("Object.values(ActiveTestSession.confidence).sort().join()") == 'guess,sure,sure')
    rec('confidence kept in the crash-recovery copy', 'confidence' in pg.evaluate("JSON.stringify(ActiveTestSession)"))
    rec('CBT room has no sideways scroll at 360px', pg.evaluate(OVER))
    # palette: 5 states
    pg.evaluate("switchQuestion(3)"); pg.wait_for_timeout(100); pg.evaluate("toggleMarkReview(3)"); pg.evaluate("switchQuestion(4)"); pg.wait_for_timeout(100); pg.evaluate("switchQuestion(5)"); pg.wait_for_timeout(100)
    pg.evaluate("toggleQuestionPalette()"); pg.wait_for_timeout(150)
    cl = pg.evaluate("[...document.querySelectorAll('.question-palette-grid .strip-chip')].slice(0,8).map(c=>c.className.replace('strip-chip','').trim())")
    rec('palette shows answered / review / not-answered / current / not-visited', 'answered' in cl[0] and 'marked' in cl[3] and 'skipped' in cl[4] and 'active' in cl[5] and cl[7] == '', cl)
    rec('palette legend lists 5 states', pg.locator('.question-palette-legend span').count() == 5)
    pg.evaluate("closeQuestionPalette()")
    rec('palette chips readable (contrast ≥ 4.5 on not-answered)', pg.evaluate("(()=>{toggleQuestionPalette();return 1})()") and pg.evaluate(f"({CONTRAST})('.strip-chip.skipped')") >= 4.5)
    pg.evaluate("closeQuestionPalette()")
    # timer hide + 5-minute alert + rough pad
    pg.click('.timer-badge'); pg.wait_for_timeout(1200)
    rec('timer can be hidden by tapping it', pg.evaluate("getComputedStyle(document.getElementById('testTimerDisplay')).display") == 'none')
    pg.evaluate("ActiveTestSession.durationSeconds=1200; ActiveTestSession.sessionStartedAt=Date.now()-(1200-299)*1000"); pg.wait_for_timeout(2500)
    rec('5-minute alert appears and timer re-shows', pg.locator('#cbtBanner:not([hidden])').count() == 1 and pg.evaluate("getComputedStyle(document.getElementById('testTimerDisplay')).display") != 'none')
    pg.evaluate("cbtOpenPad()"); pg.wait_for_timeout(200)
    cv = pg.locator('#cbtPadCanvas').bounding_box(); pg.mouse.move(cv['x']+40, cv['y']+80); pg.mouse.down(); pg.mouse.move(cv['x']+160, cv['y']+140, steps=8); pg.mouse.up()
    rec('rough pad draws on the canvas', pg.evaluate("(()=>{const c=document.getElementById('cbtPadCanvas');return c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4==3&&v>0)})()"))
    pg.evaluate("cbtClosePad()")
    rec('rough pad closes', pg.locator('#cbtPad').count() == 0)
    pg.evaluate("clearCbtRecoveryState(); submitTestSession()"); pg.wait_for_timeout(600)
    rec('result starts with a soft landing card', pg.locator('.rs-land').count() == 1 and pg.evaluate("document.querySelector('.rs-land').getBoundingClientRect().top < document.querySelector('.rs-score').getBoundingClientRect().top"))
    txt = pg.inner_text('.rs-whatif') if pg.locator('.rs-whatif').count() else ''
    rec('what-if: score without the lucky guess', 'would be' in txt and pg.evaluate("Number(document.querySelector('.rs-whatif').innerText.match(/would be\\s*(\\d+)/)[1])") == pg.evaluate("Route.params.result.score") - 1, txt)
    rec('"sure but wrong" is pointed out', 'Sure but wrong' in txt)
    rec('result score card readable (contrast ≥ 4.5)', pg.evaluate(f"({CONTRAST})('.rs-score p')") >= 4.5)
    rec('result has no sideways scroll at 360px', pg.evaluate(OVER))
    rec('result shows "Your time" card with per-question pace', pg.locator('.rs-pace').count() == 1 and '/' in pg.inner_text('.rs-pace'))
    # subject hub
    pg.evaluate("navigate('subject',{subject:'maths'})"); pg.wait_for_timeout(300)
    rec('subject hub: chapter accordions with Learn/Practice/Test', pg.locator('.sh-ch').count() >= 1 and pg.locator('.sh-ch[open] .sh-act').count() >= 3)
    rec('subject hub: 4 filter chips, all ≥ 44px', pg.locator('.sh-chip').count() == 4 and pg.evaluate("[...document.querySelectorAll('.sh-chip,.sh-act')].filter(b=>b.offsetParent).every(b=>b.getBoundingClientRect().height>=44)"))
    pg.locator('.sh-chip').nth(3).click(); pg.wait_for_timeout(200)
    rec('subject hub: "Unfinished" filter keeps only started topics', pg.evaluate("[...document.querySelectorAll('.sh-t-meta')].every(e=>!/^0\\//.test(e.textContent.replace(/PYQ|Weak|कमज़ोर/g,'').trim()))"))
    pg.evaluate("shSetFilter('all')"); pg.wait_for_timeout(150)
    rec('subject hub: no sideways scroll at 360px', pg.evaluate(OVER))
    pg.locator('.sh-ch[open] .sh-act[onclick^="sjTopicTest"]').first.click(); pg.wait_for_timeout(400)
    rec('subject hub: Test button opens the CBT room', pg.locator('#cbtViewport').count() == 1)
    pg.evaluate("ActiveTestSession.sessionStatus='DONE'; clearCbtRecoveryState(); ActiveTestSession=null; navigate('home')"); pg.wait_for_timeout(200)
    # Me screen
    pg.click('#btnMe'); pg.wait_for_timeout(300)
    rec('Me screen opens from header with progress tiles and shortcuts', pg.locator('.me-tile').count() == 6 and pg.locator('.me-row').count() >= 8)
    rec('Me screen: no sideways scroll, rows ≥ 48px', pg.evaluate(OVER) and pg.evaluate("[...document.querySelectorAll('.me-row')].every(b=>b.getBoundingClientRect().height>=48)"))
    rec('header fits at 360px with the Me button', pg.evaluate("(()=>{const h=document.getElementById('appHeader');return h.scrollWidth<=h.clientWidth+1})()"))
    # V3.3 maintenance banner from the Control Room
    pg.evaluate("navigate('home')"); pg.evaluate("opsApplyMaintenance({on:true,message:'Test maintenance message'})"); pg.wait_for_timeout(150)
    rec('maintenance banner shows on Home with the admin message', pg.locator('#opsMaintBanner').count() == 1 and 'Test maintenance message' in pg.inner_text('#opsMaintBanner'))
    rec('maintenance banner readable (contrast ≥ 4.5)', pg.evaluate(f"({CONTRAST})('#opsMaintBanner small')") >= 4.5)
    pg.evaluate("navigate('subjects')"); pg.wait_for_timeout(150)
    rec('maintenance banner stays on other screens', pg.locator('#opsMaintBanner').count() == 1)
    pg.evaluate("opsApplyMaintenance(null)"); pg.wait_for_timeout(100)
    rec('maintenance banner goes away when switched off', pg.locator('#opsMaintBanner').count() == 0)
    rec('error reporter never sends from a file / logged-out app', pg.evaluate("opsReportError('x')") is False)
    rec('no page errors', not errors, errors)
    b.close()
json.dump(results, open(OUT, 'w'), indent=1, ensure_ascii=False)
print('TOTAL', len(results), 'FAIL', sum(1 for r in results if r[1] == 'FAIL'))
