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
    page.evaluate("document.body.classList.remove('dark'); navigate('me')")
    page.locator('#btnTextSize').focus()
    page.keyboard.press('Enter')
    rec('Display settings remain keyboard accessible', page.locator('#modalSheet.open .ds').count() == 1)
    page.keyboard.press('Escape')
    rec('Closing settings restores focus to its trigger', page.evaluate("document.activeElement.id==='btnTextSize'"))
    # Simulate the queued open callback arriving after Escape closed the dialog.
    page.evaluate('nbFocusModal()')
    rec('A deferred focus callback cannot focus a closed dialog',
        page.evaluate("!nbModalIsOpen() && document.activeElement.id==='btnTextSize'"))
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
    # A valid test can live after an empty group in the same module.
    page.evaluate("""() => {
        const mod = window.__savedModules.find(m => m.moduleId === 'maths-percentage-class-test');
        AppModules = [{...mod, groups: [
            {...mod.groups[0], groupId: 'empty-first', questions: []},
            {...mod.groups[0], groupId: 'ready-later', title: 'Later group', questions: mod.groups[0].questions.slice(0, 2)}
        ]}];
        synchronizeTaxonomyEngine();
        UserState.resumeState = null;
        navigate('test_hub');
    }""")
    launchers = page.locator('#mainView button[onclick^="initTestSession"]')
    rec('Test hub retains a module with an empty first group', launchers.count() == 2)
    for index, label in enumerate(('featured assessment', 'module card')):
        if launchers.count() > index:
            launchers.nth(index).click()
            rec(f'{label} launches the later nonempty group',
                page.evaluate("Route.page==='test' && ActiveTestSession.groupId==='ready-later' && ActiveTestSession.questions.length===2"))
            page.evaluate("submitTestSession();navigate('test_hub')")
        else:
            rec(f'{label} launches the later nonempty group', False, 'No launch action')
    # Synced titles are text; punctuation in IDs must stay literal in JS arguments.
    page.evaluate("""() => {
        window.__hubInjected = false;
        const mod = AppModules[0];
        mod.topicTitle = '<img src=x onerror="window.__hubInjected=true">';
        mod.moduleId = "module');window.__hubInjected=true;//";
        mod.groups[1].title = '<img src=x onerror="window.__hubInjected=true">';
        mod.groups[1].description = '<img src=x onerror="window.__hubInjected=true">';
        mod.groups[1].groupId = "group');window.__hubInjected=true;//";
        UserState.resumeState = null;
        navigate('test_hub');
        window.__originalTestLaunch = initTestSession;
        initTestSession = (...args) => { window.__capturedTestLaunch = args; };
    }""")
    try:
        rec('Synced topic titles render as text in both assessment cards',
            page.locator('#mainView img').count() == 0 and
            '<img src=x' in page.locator('.resume-title').inner_text() and
            '<img src=x' in page.locator('.grid-cards strong').first.inner_text())
        for index, label in enumerate(('featured assessment', 'module card')):
            page.evaluate('window.__capturedTestLaunch = null')
            page.locator('#mainView button[onclick^="initTestSession"]').nth(index).click()
            rec(f'{label} treats quoted IDs as literal arguments', page.evaluate("""() => {
                const args = window.__capturedTestLaunch, mod = AppModules[0];
                return !window.__hubInjected && args?.[0] === mod.moduleId && args?.[1] === mod.groups[1].groupId;
            }"""))
        rec('Assessment group titles render as literal text',
            page.locator('#mainView img').count() == 0 and
            '<img src=x' in page.locator('.grid-cards .btn-nav.primary').inner_text())
        page.evaluate("renderTopicHubPage(document.getElementById('mainView'),AppModules[0].moduleId)")
        rec('Topic titles, group titles and descriptions render as literal text',
            page.locator('#mainView img').count() == 0 and
            '<img src=x' in page.locator('.student-hero-card h1').inner_text() and
            '<img src=x' in page.locator('.grid-cards .card-btn strong').last.inner_text() and
            '<img src=x' in page.locator('.grid-cards .card-btn small').last.inner_text())
        page.locator('.intent-tile[onclick^="initTestSession"]').click()
        rec('Topic CBT shortcut selects the later nonempty group',
            page.evaluate("window.__capturedTestLaunch?.[1] === AppModules[0].groups[1].groupId"))
        page.evaluate("window.__originalNavigate=navigate;navigate=(...args)=>{window.__capturedNavigate=args;};void 0")
        try:
            navigation_actions = page.locator('.intent-tile[onclick^="navigate"]')
            literal_routes = navigation_actions.count() == 5
            for index in range(navigation_actions.count()):
                page.evaluate('window.__capturedNavigate=null')
                navigation_actions.nth(index).click()
                literal_routes = page.evaluate("!window.__hubInjected && window.__capturedNavigate?.[1]?.moduleId===AppModules[0].moduleId") and literal_routes
            rec('Topic study actions preserve quoted module IDs', literal_routes)
        finally:
            page.evaluate('navigate=window.__originalNavigate;void 0')
        topic_launchers = page.locator('#mainView [onclick^="initTestSession"]')
        topic_args_ok = topic_launchers.count() >= 2
        for index in range(topic_launchers.count()):
            page.evaluate('window.__capturedTestLaunch = null')
            topic_launchers.nth(index).click()
            topic_args_ok = page.evaluate("""() => {
                const args = window.__capturedTestLaunch, mod = AppModules[0];
                return !window.__hubInjected && args?.[0] === mod.moduleId && mod.groups.some(g => g.groupId === args?.[1]);
            }""") and topic_args_ok
        rec('Topic assessment actions preserve quoted module and group IDs', topic_args_ok)
    finally:
        page.evaluate('initTestSession = window.__originalTestLaunch;void 0')
    rec('No browser errors across hubs and the complete test/retry flow', not errors, errors)

    # Check effective text contrast, including the hint's opacity, in both dark modes.
    control = browser.new_page()
    control.set_content('<div class="cmd-q">Question <small>Command hint</small></div><button class="chip on">Active</button>')
    control.add_style_tag(path=str(Path(APP).parent / 'control' / 'cr.css'))
    for theme, system in [('light', 'light'), ('dark', 'light'), ('system', 'dark')]:
        control.emulate_media(color_scheme=system)
        control.evaluate("theme => {if(theme==='system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme=theme}", theme)
        ratios = control.evaluate("""() => {
            const rgb = value => value.match(/[0-9.]+/g).slice(0, 3).map(Number);
            const lum = color => color.map(c => {c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4})
                .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
            return ['.cmd-q small', '.chip.on'].map(selector => {
                const el = document.querySelector(selector), style = getComputedStyle(el);
                const bg = rgb(getComputedStyle(selector === '.cmd-q small' ? el.parentElement : el).backgroundColor);
                const fg = rgb(style.color).map((c, i) => c * Number(style.opacity) + bg[i] * (1 - Number(style.opacity)));
                const a = lum(fg), b = lum(bg);
                return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
            });
        }""")
        rec(f'Control {theme}: command hint and active chip contrast ≥ 4.5', min(ratios) >= 4.5, ratios)
    browser.close()
Path(OUT).write_text(json.dumps(results, indent=1), encoding='utf-8')
if any(result[1] == 'FAIL' for result in results):
    sys.exit(1)
