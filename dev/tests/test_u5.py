import sys, json
from playwright.sync_api import sync_playwright
PATH, OUT = sys.argv[1], sys.argv[2]
results = []
def rec(name, ok, detail=''):
    results.append((name, 'PASS' if ok else 'FAIL', str(detail)[:220])); print('PASS' if ok else 'FAIL', name, str(detail)[:220])
OVER = "(()=>{const m=document.getElementById('mainView');return Math.max(m.scrollWidth-m.clientWidth,document.documentElement.scrollWidth-document.documentElement.clientWidth)})()"
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844})
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append('console:' + m.text) if m.type == 'error' else None)
    page.goto('file://' + PATH); page.wait_for_selector('.sj-dash', timeout=15000)

    # --- Display sheet + dialog a11y
    page.locator('#btnTextSize').focus(); page.keyboard.press('Enter')
    rec('Aa button opens Display sheet', page.evaluate("document.getElementById('modalSheet').classList.contains('open')") and 'Text size' in page.inner_text('#modalSheetBody'))
    rec('sheet is a modal dialog', page.evaluate("(()=>{const s=document.getElementById('modalSheet');return s.getAttribute('role')==='dialog'&&s.getAttribute('aria-modal')==='true'})()"))
    page.wait_for_timeout(50)
    rec('focus moves into the sheet', page.evaluate("document.getElementById('modalSheet').contains(document.activeElement)"))
    page.keyboard.press('Escape')
    rec('Escape closes sheet and focus returns to Aa', not page.evaluate("document.getElementById('modalSheet').classList.contains('open')") and page.evaluate("document.activeElement.id") == 'btnTextSize')

    # --- Hindi
    page.evaluate("openDisplaySettings()")
    page.locator('#modalSheetBody .ds-opt', has_text='हिंदी').click()
    rec('language switch keeps sheet open, now in Hindi', 'भाषा' in page.inner_text('#modalSheetBody') and page.locator('#modalSheetBody .ds-opt.on', has_text='हिंदी').count() == 1)
    page.evaluate("closeModal()")
    t = page.inner_text('#mainView')
    rec('dashboard in Hindi', 'दैनिक लक्ष्य' in t and 'Daily goal' not in t)
    rec('bottom nav in Hindi', page.inner_text('#tabHome') .strip().endswith('होम') and 'रिवीज़न' in page.inner_text('#tabRevision'))
    rec('header title in Hindi', 'स्टूडेंट हब' in page.inner_text('#txtHeaderTitle'))
    rec('html lang = hi', page.evaluate("document.documentElement.lang") == 'hi')
    page.wait_for_timeout(300); page.reload(); page.wait_for_selector('.sj-dash', timeout=15000); page.wait_for_timeout(300)
    rec('Hindi survives reload', 'दैनिक लक्ष्य' in page.inner_text('#mainView') and 'होम' in page.inner_text('#tabHome'))
    page.evaluate("navigate('home')")
    page.screenshot(path=OUT + '/u5_home_hi.png')
    page.evaluate("setDisplaySetting('lang','en'); closeModal()")
    rec('back to English', 'Daily goal' in page.inner_text('#mainView') and 'HOME' in page.inner_text('#tabHome').upper())

    # --- Text size
    page.evaluate("setDisplaySetting('size','xl'); closeModal()")
    z = page.evaluate("getComputedStyle(document.querySelector('#mainView > *')).zoom")
    rec('XL text size zooms page content (1.25)', z == '1.25', z)
    worst = {}
    for wd in [360, 1280]:
        page.set_viewport_size({'width': wd, 'height': 900})
        for r in ['home', 'subjects', 'taxonomy_explorer', 'test_hub', 'revision_hub']:
            page.evaluate(f"navigate('{r}')"); worst[f'{r}{wd}'] = page.evaluate(OVER)
    rec('XL: no horizontal overflow on main pages (360/1280)', max(worst.values()) <= 1, {k: v for k, v in worst.items() if v > 1})
    page.set_viewport_size({'width': 360, 'height': 800})
    page.evaluate("navigate('home')"); page.screenshot(path=OUT + '/u5_home_xl_360.png')
    page.evaluate("navigate('native_builder')"); page.wait_for_timeout(200)
    zb = page.evaluate("(()=>{const e=document.querySelector('.sb-body');return e?getComputedStyle(e).zoom:'none'})()")
    rec('XL applies inside the Builder', zb == '1.25', zb)
    rec('XL Builder: no horizontal overflow at 360', page.evaluate(OVER) <= 1, page.evaluate(OVER))
    page.screenshot(path=OUT + '/u5_builder_xl_360.png')
    page.evaluate("navigate('home')")
    page.evaluate("(()=>{const m=getWorkspaceModule('maths-percentage-class-test');initTestSession(m.moduleId,m.groups[0].groupId,0,null)})()")
    page.wait_for_timeout(300)
    zc = page.evaluate("(()=>{const e=document.querySelector('.test-scrollable-body');return e?getComputedStyle(e).zoom:'none'})()")
    rec('XL applies to the CBT question area only', zc == '1.25' and page.evaluate("getComputedStyle(document.querySelector('#mainView > *')).zoom") == '1', zc)
    rec('XL CBT: no horizontal overflow at 360', page.evaluate(OVER) <= 1)
    page.screenshot(path=OUT + '/u5_cbt_xl_360.png')
    page.evaluate("CbtExitGuard.confirmExit(); navigate('home')")
    page.evaluate("setDisplaySetting('size','m'); closeModal()")
    page.set_viewport_size({'width': 390, 'height': 844})
    rec('Normal size resets zoom', page.evaluate("getComputedStyle(document.querySelector('#mainView > *')).zoom") == '1')

    # --- Keyboard access
    page.evaluate("navigate('exam_hub')"); page.wait_for_timeout(100)
    info = page.evaluate("(()=>{const els=[...document.querySelectorAll('#mainView [onclick]:not(button):not(a):not(input)')];return {n:els.length,bad:els.filter(e=>e.getAttribute('role')!=='button'||e.tabIndex<0).length}})()")
    rec('clickable cards get role=button + tabindex', info['n'] > 0 and info['bad'] == 0, info)
    page.evaluate("navigate('subjects')"); page.evaluate("navigate('exam_hub')"); page.wait_for_timeout(50)
    card = page.locator("#mainView [role=button][onclick*='exam_profile']").first
    if card.count():
        card.focus(); page.keyboard.press('Enter'); page.wait_for_timeout(100)
        rec('Enter on a card opens it', page.evaluate("Route.page") == 'exam_profile', page.evaluate("Route.page"))
    else:
        rec('Enter on a card opens it', False, 'no exam card')
    rec('active tab has aria-current', page.evaluate("document.querySelector('.nav-tab[aria-current=page]')?.id") == 'tabPYQ')
    page.evaluate("navigate('syllabus',{examId:Route.params.examId})")
    rec('syllabus has no fake "Mapped" claim', 'Mapped' not in page.inner_text('#mainView'))
    page.click('#btnMenu'); page.keyboard.press('Escape')
    rec('Escape closes the menu', not page.evaluate("document.getElementById('sideDrawer').classList.contains('open')"))
    rec('menu labels are clear', 'Question bank' in page.evaluate("document.getElementById('sideDrawer').textContent") and 'ALL DATA CONTROL' not in page.evaluate("document.getElementById('sideDrawer').textContent"))

    # --- Subjects from data
    page.evaluate("navigate('subjects')")
    t = page.inner_text('#mainView')
    exp = page.evaluate("""(()=>{const m=new Map();CurriculumContext.filterModules(AppModules).forEach(x=>{const k=String(x.subject||'').trim().toLowerCase();if(!k)return;m.set(k,(m.get(k)||0)+x.groups.reduce((n,g)=>n+g.questions.length,0))});return [...m.entries()].filter(e=>e[1]>0)})()""")
    rec('subject cards = subjects that have questions', page.locator('.sc-card').count() == len(exp), (page.locator('.sc-card').count(), exp))
    rec('counts come from data', all(f"{n} questions" in t for _, n in exp), exp)
    rec('no hard-coded claims', '356 Qs' not in t and 'Mapped' not in t)
    page.screenshot(path=OUT + '/u5_subjects_390.png')
    page.locator('.sc-card').first.click()
    chs = page.locator('.sh-ch summary')
    zero = [c for c in chs.all_inner_texts() if ' 0 questions' in ' ' + c]
    rec('subject page lists only chapters with questions', chs.count() > 0 and not zero, chs.all_inner_texts()[:3])
    rec('no placeholder chapters', all(x not in page.inner_text('#mainView') for x in ['Number System', 'Non-Verbal Reasoning']) or page.evaluate("CurriculumContext.filterModules(AppModules).some(m=>/number system/i.test(m.chapter))"))
    page.locator('.sh-ch[open] .sh-t-name').first.click()
    rec('chapter accordion opens its topic', page.evaluate("Route.page") == 'topic')

    # --- Question Bank
    page.evaluate("navigate('taxonomy_explorer')")
    total = page.evaluate("qbFiltered().length")
    rec('Question Bank: first 20 shown', page.locator('.qb-card').count() == min(20, total), total)
    if total > 20:
        page.locator('.qb-moreBtn').click()
        rec('"Show 20 more" adds 20', page.locator('.qb-card').count() == min(40, total))
    word = page.evaluate("(()=>{const q=qbFiltered()[0];return String(q.metadata.topic||'').split(/\\s+/)[0]})()")
    page.locator('#qbSearch').fill(word); page.wait_for_timeout(300)
    n = page.evaluate("qbFiltered().length")
    rec('search narrows the list and keeps focus', 0 < n <= total and page.evaluate("document.activeElement.id") == 'qbSearch' and str(n) in page.inner_text('#qbCount'), (word, n, total))
    page.locator('#qbSearch').fill('zzqqxx'); page.wait_for_timeout(300)
    rec('no-match message', 'No questions match' in page.inner_text('#qbList'))
    page.locator('#qbSearch').fill(''); page.wait_for_timeout(300)
    first = page.locator('.qb-card').first
    rec('options hidden until asked', not first.locator('.qb-opts').is_visible())
    first.locator('summary').click()
    rec('opening shows options with the answer marked', first.locator('.qb-opts li').count() >= 2 and first.locator('.qb-opts li.ok').count() == 1)
    first.locator('.bm-btn').click()
    rec('bookmark from Question Bank', page.evaluate("ReviewState.bookmarks.length") == 1 and page.locator('.qb-card').first.locator('.bm-btn.on').count() == 1)
    subs = page.locator('.qb-row[aria-label=Subject] .mr-chip')
    if subs.count() > 1:
        subs.nth(1).click()
        s = page.evaluate("ActiveTaxonomyFilters.subject")
        rec('subject chip filters', bool(s) and page.evaluate(f"qbFiltered().every(q=>String(q.metadata.subject).trim()==={json.dumps(s)})"), s)
    else:
        rec('subject chip filters (single subject: chips hidden)', subs.count() == 0)
    page.evaluate("qbSet('pyq','')")
    pn = page.evaluate("qbFiltered().length")
    rec('PYQ-only filter = questions marked PYQ', pn == page.evaluate("qbQuery(qbBaseFilters()).filter(q=>pyqStatusOf(q)==='PYQ').length"))
    page.evaluate("qbClear()")
    page.screenshot(path=OUT + '/u5_qb_390.png')
    page.locator('.qb-card .qb-practice').first.click()
    rec('Practice opens the question', page.evaluate("Route.page") == 'practice')
    page.evaluate("navigate('home')")

    # --- Themes / widths screenshots
    for theme in ['light', 'dark']:
        if theme == 'dark': page.evaluate("toggleCbtDark()")
        for wd in [360, 1280]:
            page.set_viewport_size({'width': wd, 'height': 900})
            for r in ['subjects', 'taxonomy_explorer']:
                page.evaluate(f"navigate('{r}')"); page.screenshot(path=OUT + f'/u5_{r}_{theme}_{wd}.png')
                worst[f'{theme}{r}{wd}'] = page.evaluate(OVER)
            page.evaluate("openDisplaySettings()"); page.screenshot(path=OUT + f'/u5_display_{theme}_{wd}.png'); page.evaluate("closeModal()")
    rec('no overflow, light & dark, 360/1280', max(worst.values()) <= 1, {k: v for k, v in worst.items() if v > 1})
    page.evaluate("toggleCbtDark()")
    rec('no page/console errors', not errors, errors)
    b.close()
json.dump(results, open(OUT + '/u5_results.json', 'w'), indent=1, ensure_ascii=False)
print('TOTAL', len(results), 'FAIL', sum(1 for r in results if r[1] == 'FAIL'))
