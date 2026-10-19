"""Student navigation and feedback regressions. Usage: test_navigation.py APP.html OUT.json"""
import json
import sys
from playwright.sync_api import sync_playwright

APP, OUT = sys.argv[1:3]
results = []


def rec(name, ok, detail=''):
    """Record and print a navigation regression result with bounded diagnostic details."""
    results.append((name, 'PASS' if ok else 'FAIL', str(detail)[:260]))
    print('PASS' if ok else 'FAIL', name, str(detail)[:260], flush=True)


with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={'width': 360, 'height': 800})
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('https://**/*', lambda route: route.abort())
    page.goto('file://' + APP)
    page.wait_for_selector('.sj-dash')
    page.wait_for_timeout(200)
    rec('one renderer with explicit feature hooks', page.evaluate(
        "ViewHooks.after.has('display') && ViewHooks.after.has('account-prompt') && "
        "ViewHooks.after.has('profile-prompt') && ViewHooks.after.has('maintenance')"))
    page.evaluate("opsApplyMaintenance({on:true,message:'Scheduled update'});navigate('me')")
    rec('Me participates in shared maintenance and navigation hooks',
        page.locator('#opsMaintBanner').count() == 1 and
        page.locator('#drwMe').get_attribute('aria-current') == 'page')
    page.evaluate("opsApplyMaintenance(null);navigate('subjects')")
    # Use the actual subject and chapter IDs rather than fixture-specific labels.
    page.evaluate("(()=>{const g=nbSubjectGroups()[0];shSelectCatalogSubject(g.key);shToggleCatalogChapter([...g.chapters.keys()][0]);})()")
    catalog = page.evaluate('JSON.stringify(SubjectNavState)')
    page.evaluate("navigate('me');appNavigateBack()")
    rec('subject selection and expanded chapter survive app Back',
        page.evaluate('JSON.stringify(SubjectNavState)') == catalog and page.evaluate('Route.page') == 'subjects')
    page.evaluate("navigate('subject',{subject:'maths'});shSetFilter('pyq')")
    page.evaluate("navigate('me');appNavigateBack()")
    rec('subject filter survives Back', page.evaluate('SubjectHubState.filter') == 'pyq')
    page.evaluate("shSetFilter('all');document.querySelector('.sh-ch').open=false")
    page.wait_for_timeout(80)
    page.evaluate("navigate('me');appNavigateBack()")
    rec('chapter accordion survives Back', not page.locator('.sh-ch').first.evaluate('(el)=>el.open'))
    page.evaluate("navigate('taxonomy_explorer');qbSearch('percentage')")
    page.wait_for_timeout(250)
    page.evaluate("QBState.show=40;qbRenderList();document.getElementById('mainView').scrollTop=850")
    scroll = page.evaluate("document.getElementById('mainView').scrollTop")
    bank = page.evaluate('JSON.stringify(QBState)')
    page.evaluate("navigate('me')")
    page.go_back()
    page.wait_for_timeout(150)
    rec('browser Back restores bank search and pagination',
        page.evaluate('Route.page') == 'taxonomy_explorer' and page.evaluate('JSON.stringify(QBState)') == bank and
        page.locator('#qbSearch').input_value() == 'percentage')
    rec('browser Back restores scroll position', scroll > 100 and
        abs(page.evaluate("document.getElementById('mainView').scrollTop") - scroll) <= 2, scroll)
    page.evaluate("renderView()")
    page.wait_for_timeout(50)
    rec('same-route refresh preserves scroll position',
        abs(page.evaluate("document.getElementById('mainView').scrollTop") - scroll) <= 2)
    page.evaluate("navigate('me');navigate('taxonomy_explorer')")
    page.wait_for_timeout(50)
    rec('forward entry starts at the top while preserving bank filters',
        page.evaluate("document.getElementById('mainView').scrollTop") == 0 and
        page.evaluate('JSON.stringify(QBState)') == bank and
        page.locator('#qbSearch').input_value() == 'percentage')
    page.evaluate("navigate('me');navigate('home');appNavigateBack();navigate('subjects');appNavigateBack()")
    rec('forward navigation after Back keeps the immediate previous page', page.evaluate('Route.page') == 'me')
    page.evaluate("navigate('topic',{moduleId:'maths-percentage-class-test'})")
    rec('topic route keeps Subjects navigation selected', page.locator('#tabSubjects').get_attribute('aria-current') == 'page')
    page.evaluate("navigate('taxonomy_explorer');qbSearch('zz_no_matching_question_zz')")
    page.wait_for_timeout(200)
    rec('filtered empty state offers clear filters', page.locator('[data-state="filtered"]').count() == 1)
    page.locator('[data-state="filtered"] button').click()
    rec('clear filters returns the real question list', page.locator('.qb-card').count() > 0 and page.locator('#qbSearch').input_value() == '')
    page.evaluate("navigate('home');setTaxonomyFilter('examId','ssc-je');navigate('taxonomy_explorer')")
    rec('explicit exam entry overrides remembered bank filters', page.evaluate('ActiveTaxonomyFilters.examId') == 'ssc-je')
    page.evaluate("qbClear()")
    page.evaluate("navigate('subject',{subject:'unavailable-subject'})")
    rec('guest empty screen offers sign-in instead of import',
        page.locator('[data-state="guest"]').count() == 1 and 'Import' not in page.locator('#mainView').inner_text())
    context.set_offline(True)
    page.wait_for_timeout(100)
    rec('offline status updates without a route change', page.locator('[data-state="offline"]').count() == 1)
    context.set_offline(False)
    page.evaluate("ServerState.session={user_id:'test-student'};CloudState.busy=true;refreshStudyFeedback()")
    rec('loading feedback is announced as busy', page.locator('[data-state="loading"]').get_attribute('aria-busy') == 'true')
    page.evaluate("CloudState.busy=false;CloudState.msgKind='bad';refreshStudyFeedback()")
    rec('sync failure offers retry', page.locator('[data-state="error"] button').inner_text() == 'Retry sync')
    page.evaluate("CloudState.msgKind='';CloudState.lastContentAt='';refreshStudyFeedback()")
    rec('unsynced state asks to download questions', page.locator('[data-state="pending"]').count() == 1)
    page.evaluate("CloudState.lastContentAt='2026-10-19T00:00:00Z';refreshStudyFeedback()")
    rec('successful sync with no content offers exam change', page.locator('[data-state="empty"]').count() == 1)
    page.evaluate("ServerState.session=null;UserState.studentProfile={examId:'ssc-je',branch:'civil'};UserState.selectedExam='ssc-je';UserState.selectedYear='2024';navigate('subjects')")
    rec('study context shows exam, branch, and selected year', all(
        text in page.locator('.study-context').inner_text() for text in ['SSC', 'Civil', '2024']))
    page.evaluate("UserState.studentProfile=null;navigate('native_builder');sbStartMode('quick')")
    rec('builder registry renders active step and one context bar', page.locator('.sb-shell[data-step="quick"]').count() == 1 and page.locator('.study-context').count() == 1)
    before = page.evaluate('JSON.stringify(studentProfile())')
    page.locator('.study-context button').click()
    page.locator('#modalSheetBody .sb-choice').last.click()
    rec('builder exam change updates its selection without changing the downloaded profile',
        page.locator('.sb-shell[data-step="quick"]').count() == 1 and
        page.evaluate('JSON.stringify(studentProfile())') == before and
        page.evaluate('sbQuickContextKey() === SB.quickCtx'))
    page.evaluate("setDisplaySetting('lang','hi');closeModal()")
    rec('builder title and Back control respect Hindi',
        'झटपट' in page.locator('.sb-title').inner_text() and 'वापस' in page.locator('.sb-back').inner_text())
    for width in [360, 412, 768, 1280]:
        page.set_viewport_size({'width': width, 'height': 900})
        for route in ['subjects', 'taxonomy_explorer', 'native_builder']:
            page.evaluate('(route)=>navigate(route)', route)
            rec(f'{route} has no horizontal overflow at {width}px', page.evaluate(
                "document.getElementById('mainView').scrollWidth<=document.getElementById('mainView').clientWidth+1"))
    page.set_viewport_size({'width': 360, 'height': 800})
    for dark in [False, True]:
        page.evaluate('(dark)=>document.body.classList.toggle("dark",dark)', dark)
        page.evaluate("navigate('subjects')")
        rec(f'context actions have 44px tap targets (dark={dark})', page.locator('.study-context button').evaluate('(el)=>el.getBoundingClientRect().height>=44'))
    # Exercise the actual instructions -> launched session title in both UI languages.
    for lang in ['en', 'hi']:
        for mode, history, expected in [
            ('custom', 'all', 'Custom Test' if lang == 'en' else 'अपना टेस्ट'),
            ('custom', 'wrong', 'Mistakes Test' if lang == 'en' else 'गलतियों का टेस्ट'),
            ('custom', 'bookmarked', 'Bookmarks Test' if lang == 'en' else 'बुकमार्क टेस्ट'),
            ('pyq', 'all', 'SSC practice paper'),
        ]:
            page.evaluate('''([lang, mode, history]) => {
                StudySettings.ui={lang,size:'m'}; applyDisplaySettings();
                SB=sbFresh(); SB.mode=mode; SB.hist=history;
                const row=sbAll()[0];
                SB.examId=row.examId; SB.year=row.year;
                SB.previewIds=[row.id]; SB.title='SSC practice paper'; SB.step='instructions';
                navigate('native_builder');
            }''', [lang, mode, history])
            shown_title = page.locator('.sb-paper strong').inner_text()
            page.locator('[onclick="sbStartFromInstructions()"]').click()
            rec(f'{mode}/{history} instructions and launched title agree ({lang})',
                shown_title == expected and page.evaluate('ActiveTestSession?.topicTitle') == expected and
                page.evaluate('Route.page') == 'test', shown_title)
            page.evaluate("if(ActiveTestSession) ActiveTestSession.sessionStatus='DONE';"
                          "clearCbtRecoveryState();ActiveTestSession=null;navigate('home')")
    rec('no JavaScript errors', not errors, errors)
    browser.close()

with open(OUT, 'w') as f:
    json.dump(results, f, indent=2)
sys.exit(1 if any(result[1] == 'FAIL' for result in results) else 0)
