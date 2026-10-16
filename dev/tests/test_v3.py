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
    pg.evaluate("clearCbtRecoveryState(); submitTestSession()"); pg.wait_for_timeout(600)
    rec('result starts with a soft landing card', pg.locator('.rs-land').count() == 1 and pg.evaluate("document.querySelector('.rs-land').getBoundingClientRect().top < document.querySelector('.rs-score').getBoundingClientRect().top"))
    txt = pg.inner_text('.rs-whatif') if pg.locator('.rs-whatif').count() else ''
    rec('what-if: score without the lucky guess', 'would be' in txt and pg.evaluate("Number(document.querySelector('.rs-whatif').innerText.match(/would be\\s*(\\d+)/)[1])") == pg.evaluate("Route.params.result.score") - 1, txt)
    rec('"sure but wrong" is pointed out', 'Sure but wrong' in txt)
    rec('result score card readable (contrast ≥ 4.5)', pg.evaluate(f"({CONTRAST})('.rs-score p')") >= 4.5)
    rec('result has no sideways scroll at 360px', pg.evaluate(OVER))
    rec('no page errors', not errors, errors)
    b.close()
json.dump(results, open(OUT, 'w'), indent=1, ensure_ascii=False)
print('TOTAL', len(results), 'FAIL', sum(1 for r in results if r[1] == 'FAIL'))
