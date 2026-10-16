import sys, json
from playwright.sync_api import sync_playwright
import fake_supabase as F
PATH, OUT, OLD = sys.argv[1], sys.argv[2], sys.argv[3]
results = []
def rec(name, ok, detail=''):
    results.append((name, 'PASS' if ok else 'FAIL', str(detail)[:300])); print('PASS' if ok else 'FAIL', name, str(detail)[:300])
def counts(pg): return pg.evaluate("Object.fromEntries(Object.entries(cleanupScan().groups).map(([k,g])=>[k,g.items.length]).filter(x=>x[1]))")
F.start('/home/claude/work/SUPABASE_SCHEMA_V1.sql'); fake = F.Fake()
try:
    with sync_playwright() as p:
        b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 390, 'height': 844}); ctx.route(F.URL + '/**', fake.handle)
        pg = ctx.new_page(); errors = []
        pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('dialog', lambda d: d.accept())
        pg.goto('file://' + PATH); pg.wait_for_selector('.sj-dash', timeout=15000)
        c = counts(pg)
        rec('starter data: no false alarms (only the "always A" note)', set(c) == {'sameLetter'} and c['sameLetter'] == 1, c)
        # load REAL old-engine data through Restore
        pg.evaluate("openBackupCenter()"); pg.wait_for_timeout(300)
        pg.set_input_files('#modalSheetBody input[type=file]', OLD); pg.wait_for_timeout(300)
        with pg.expect_navigation(): pg.locator('#bkRestore .btn-nav.primary').click()
        pg.wait_for_selector('.sj-dash', timeout=15000)
        c = counts(pg)
        rec('old data: finds bad answer "(C)"', c.get('answer') == 1, c)
        rec('old data: finds English text in Hindi option', c.get('hindi') == 1, c)
        rec('old data: finds misread exam (SSC MTS → was SSC JE)', c.get('examMisread') == 3, c)
        rec('old data: finds invented exam/year (Average Old)', c.get('examInvented') == 3, c)
        rec('old data: finds invented Shift-I and General Subtopic', c.get('shift') == 11 and c.get('subtopic') == 11, c)
        pg.click('#btnMenu'); pg.locator('#sideDrawer .drawer-item', has_text='Data cleanup').click(); pg.wait_for_timeout(300)
        rec('cleanup sheet opens from the menu', pg.locator('#cleanSheet .cl-group').count() >= 6)
        pg.screenshot(path=OUT + '/clean_sheet.png', full_page=False)
        # apply fixes one by one through the UI
        for k in ['answer', 'hindi', 'examMisread', 'shift', 'subtopic']:
            pg.evaluate(f"document.querySelector('.cl-fix[onclick*=\"{k}\"]').click()"); pg.wait_for_timeout(500)
            rec(f'fix "{k}" applied', '✓' in pg.inner_text('#cleanSheet .srv-msg') and not counts(pg).get(k), pg.inner_text('#cleanSheet .srv-msg'))
        rec('a backup was made before the first fix', pg.evaluate("(async()=>(await DataSafety.readIndex()).some(x=>x.reason==='सफ़ाई से पहले'))()"))
        q = pg.evaluate("(()=>{const m=getWorkspaceModule('maths-ratio-old-class-test');return m.groups[0].questions.map(q=>({a:q.answer,hi:q.options[0].hi,shift:q.metadata.shift,sub:q.metadata.subtopic}))})()")
        rec('answers now A–D, Hindi fixed, shift empty, subtopic General', [x['a'] for x in q] == ['B', 'C', 'B', 'B', 'B'] and all(x['shift'] == '' and x['sub'] == 'General' for x in q) and q[2]['hi'] == '3', q)
        mx = pg.evaluate("(()=>{const m=getWorkspaceModule('maths-mixture-old-class-test');return {mod:m.examId,q:m.groups[0].questions[0].metadata.examId,name:m.groups[0].questions[0].metadata.exam}})()")
        rec('misread exam corrected on questions and topic', mx == {'mod': 'ssc-mts-objective', 'q': 'ssc-mts-objective', 'name': 'SSC MTS Objective'}, mx)
        # per-topic chooser for invented exam/year
        pg.fill('#clExam-maths-average-old-class-test', 'RRB Group D'); pg.fill('#clYear-maths-average-old-class-test', '2022')
        pg.locator('.cl-topic .btn-action-sm').first.click(); pg.wait_for_timeout(500)
        av = pg.evaluate("(()=>{const m=getWorkspaceModule('maths-average-old-class-test');const q=m.groups[0].questions[0];return {mod:m.examId,yr:m.examYear,q:q.metadata.examId,qy:q.metadata.year}})()")
        rec('invented exam/year replaced by the admin\'s choice', av == {'mod': 'rrb-group-d', 'yr': '2022', 'q': 'rrb-group-d', 'qy': '2022'}, av)
        pg.fill('#clExam-maths-average-old-class-test', '') if pg.locator('#clExam-maths-average-old-class-test').count() else None
        # shuffle "always A"
        before = pg.evaluate("(()=>{const q=getWorkspaceModule('maths-percentage-class-test').groups[0].questions[0];return q.options.find(o=>o.letter===q.answer).en})()")
        pg.evaluate("document.querySelector('.cl-fix[onclick*=\"sameLetter\"]').click()"); pg.wait_for_timeout(800)
        dist = pg.evaluate("(()=>{const c={};getWorkspaceModule('maths-percentage-class-test').groups.flatMap(g=>g.questions).forEach(q=>c[q.answer]=(c[q.answer]||0)+1);return c})()")
        after = pg.evaluate("(()=>{const q=getWorkspaceModule('maths-percentage-class-test').groups[0].questions[0];return q.options.find(o=>o.letter===q.answer).en})()")
        rec('answers spread over A–D after shuffle', len(dist) == 4 and max(dist.values()) < 140, dist)
        rec('the correct answer text stays correct', before == after, (before, after))
        nt = pg.evaluate("(()=>{const q=getWorkspaceModule('maths-percentage-class-test').groups.flatMap(g=>g.questions).find(q=>q.options.some(o=>/none of these/i.test(o.en)));return q?q.options[3].en:'n/a'})()")
        rec('"None of these" stays the last option', nt in ('None of these', 'n/a'), nt)
        pg.evaluate("cleanupFinish()"); pg.wait_for_timeout(600)
        rec('finish marks the checked questions', 'जाँचे हुए माने गए' in pg.inner_text('#cleanSheet .srv-msg'))
        pg.reload(); pg.wait_for_selector('.sj-dash', timeout=15000)
        c = counts(pg)
        rec('after reload all fixes are still there (Shift-I not re-added)', not c.get('shift') and not c.get('answer') and not c.get('examMisread') and not c.get('examInvented'), c)
        h = pg.evaluate("healthCollect().items.map(i=>i.title).join('|')")
        rec('Health Check no longer counts these as old-style', 'पुराने तरीके से import' not in h, h)
        # fixes reach the server as "changed"
        pg.evaluate("openServerSync()"); pg.fill('#srvEmail', F.ADMIN[1]); pg.fill('#srvPass', F.ADMIN[2]); pg.click('#srvSheet button[type=submit]')
        pg.wait_for_function("ServerState.isAdmin===true", timeout=10000)
        pg.locator('#srvSheet .btn-nav', has_text='जाँचें').click(); pg.wait_for_function("!ServerState.busy && !!ServerState.plan", timeout=30000)
        t = pg.evaluate("ServerState.plan.totals")
        rec('cleaned questions upload without anything held back', t['skipped'] == 0 and t['new'] > 0, t)
        pg.locator('#srvSheet .btn-nav.primary').click(); pg.wait_for_function("!ServerState.busy && !ServerState.plan", timeout=60000)
        srv = F.psql_raw("select count(*) filter (where shift='Shift-I'), count(*) filter (where exam_id='railway-official-pyq'), count(*) filter (where exam_id='ssc-je') from public.questions").splitlines()[-1]
        rec('server has no invented shift / invented exam / misread exam', srv == '0|0|0', srv)
        pg.evaluate("closeModal()")
        pg.set_viewport_size({'width': 360, 'height': 800}); pg.evaluate("openCleanup()"); pg.wait_for_timeout(300)
        rec('cleanup sheet fits 360px', pg.evaluate("document.getElementById('modalSheet').scrollWidth<=document.getElementById('modalSheet').clientWidth+1"))
        pg.screenshot(path=OUT + '/clean_done_360.png')
        rec('no page errors', not errors, errors)
        b.close()
finally:
    F.stop()
json.dump(results, open(OUT + '/clean_results.json', 'w'), indent=1, ensure_ascii=False)
print('TOTAL', len(results), 'FAIL', sum(1 for r in results if r[1] == 'FAIL'))
