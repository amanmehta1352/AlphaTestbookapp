"""Action-oriented navigation and responsive study-flow regression checks.

Usage: python3 dev/tests/test_design.py /absolute/index.html report.json
"""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

APP, OUT = sys.argv[1:3]
results = []


def rec(name, ok, detail=''):
    results.append((name, 'PASS' if ok else 'FAIL', str(detail)[:300]))
    print('PASS' if ok else 'FAIL', name, detail)


ROUTES = ['home', 'subjects', 'exam_hub', 'test_hub', 'pyq_hub',
          'revision_hub', 'taxonomy_explorer', 'native_builder',
          'digital_library', 'mastery', 'mistakes', 'me', 'competitive_hub']
FITS = """() => {
    const main = document.getElementById('mainView');
    return document.documentElement.scrollWidth <= innerWidth + 1 &&
        main.scrollWidth <= main.clientWidth + 1;
}"""
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 360, 'height': 780})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('https://**/*', lambda route: route.abort())
    page.goto(Path(APP).as_uri())
    page.wait_for_selector('.ao-home')
    # Returning to practice must retain the exact topic and question position.
    page.evaluate("navigate('practice',{moduleId:'maths-percentage-class-test',qIndex:3}); navigate('home')")
    resume = page.locator('.ao-next .gx-btn')
    rec('Home presents a single resume action before exploration',
        page.locator('.ao-home button', has_text='Resume').count() == 1 and
        page.evaluate("document.querySelector('.ao-next').getBoundingClientRect().top < document.querySelector('.gx-quick').getBoundingClientRect().top"))
    resume.click()
    rec('Resume returns to the original question',
        page.evaluate("Route.page==='practice' && Route.params.moduleId==='maths-percentage-class-test' && Route.params.qIndex===3"))
    page.evaluate("navigate('home')")
    for width, height in [(360, 780), (412, 900), (768, 1024), (1280, 860)]:
        page.set_viewport_size({'width': width, 'height': height})
        for dark in (False, True):
            page.evaluate('(dark) => document.body.classList.toggle("dark", dark)', dark)
            bad = []
            for route in ROUTES:
                page.evaluate('(route) => navigate(route)', route)
                if not page.evaluate(FITS):
                    bad.append(route)
            rec(f'{width}px {"dark" if dark else "light"}: content fits every hub', not bad, bad)
    # Reading settings remain available with keyboard access in the simpler shell.
    page.set_viewport_size({'width': 360, 'height': 780})
    page.evaluate("document.body.classList.remove('dark'); navigate('subjects')")
    page.locator('#btnTextSize').focus()
    page.keyboard.press('Enter')
    rec('Display settings remain keyboard accessible', page.locator('#modalSheet.open .ds').count() == 1)
    page.keyboard.press('Escape')
    rec('Closing settings restores focus to its trigger', page.evaluate("document.activeElement.id==='btnTextSize'"))
    # Active exam chrome must fit small/landscape screens and keep a useful reading area.
    page.evaluate("initTestSession('maths-percentage-class-test',getWorkspaceModule('maths-percentage-class-test').groups[0].groupId,0)")
    for width, height in [(360, 780), (412, 900), (844, 390)]:
        page.set_viewport_size({'width': width, 'height': height})
        metrics = page.evaluate("""() => {
            const footer = document.querySelector('.test-fixed-footer').getBoundingClientRect();
            const body = document.querySelector('.test-scrollable-body').getBoundingClientRect();
            const controls = [...document.querySelectorAll('.test-fixed-header button,.timer-badge,.test-fixed-footer button')];
            return {fits: document.documentElement.scrollWidth <= innerWidth + 1,
                readable: body.height >= 100 && body.bottom <= footer.top + 1,
                small: controls.filter(el => {const r=el.getBoundingClientRect();return r.width>0 && r.height>0 && r.height<43.8}).map(el=>el.className)};
        }""")
        rec(f'{width}×{height}: test controls are tappable and question scrolls above footer',
            metrics['fits'] and metrics['readable'] and not metrics['small'], metrics)
    page.set_viewport_size({'width': 360, 'height': 780})
    key = page.evaluate('ActiveTestSession.questions[0].answer')
    wrong = next(x for x in 'ABCD' if x != key)
    page.evaluate('(answer)=>selectOption(answer,0)', wrong)
    page.locator('.btn-nav-next').click()
    rec('Primary exam action saves the selected answer and advances',
        page.evaluate("Route.params.qIndex===1 && Object.keys(ActiveTestSession.answers).length===1"))
    page.evaluate('submitTestSession()')
    rec('Result has one next-step panel before detailed analysis',
        page.locator('.rs-next-step').count() == 1 and
        'Retry 1 wrong answer' in page.locator('.rs-next-step .btn-nav.primary').inner_text())
    page.locator('.rs-next-step .btn-nav.primary').click()
    rec('Retry wrong starts a test containing only missed questions',
        page.evaluate("Route.page==='test' && ActiveTestSession.questions.length===1"))
    page.evaluate('submitTestSession()')
    # Empty-state actions must lead to account/content setup, not student imports.
    page.evaluate("navigate('home');window.__savedModules=AppModules;AppModules=[];synchronizeTaxonomyEngine();renderView()")
    rec('Empty student Home offers sign-in instead of admin import',
        page.locator('.ao-next .gx-btn').get_attribute('onclick') == 'openAccount()')
    page.locator('.ao-next .gx-btn').click()
    rec('Empty-state CTA opens the account flow', page.locator('#modalSheet.open').count() == 1)
    page.evaluate("closeModal();navigate('test_hub')")
    rec('Empty test hub explains availability without a broken start action',
        page.locator('#mainView .btn-nav.primary').count() == 1 and
        page.locator('#mainView .btn-nav.primary').get_attribute('onclick') == "navigate('me')")
    rec('No browser errors across hubs and the complete test/retry flow', not errors, errors)
    browser.close()
Path(OUT).write_text(json.dumps(results, indent=1), encoding='utf-8')
if any(result[1] == 'FAIL' for result in results):
    sys.exit(1)
