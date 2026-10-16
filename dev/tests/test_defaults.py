"""V2.10.0 import-screen defaults: fill only blank fields, file wins, remembered, year checked."""
import sys
from playwright.sync_api import sync_playwright
PATH = sys.argv[1]
res = []
def rec(n, ok, d=''): res.append(ok); print('PASS' if ok else 'FAIL', n, str(d)[:300])

def blk(no, **kw):
    f = dict(SOURCE_QUESTION_NO=no, SUBJECT='Maths', CHAPTER='Arithmetic', TOPIC='Defaults Topic',
             QUESTION_EN=f'Default test {no}: {no} + 1 = ?', A_EN=str(no + 1), B_EN=str(no + 2), C_EN=str(no + 3), D_EN=str(no), ANSWER='A')
    f.update(kw)
    return '=== QUESTION START ===\n' + '\n'.join(f'{k}: {v}' for k, v in f.items() if v is not None) + '\n=== QUESTION END ===\n'

ANALYZE = """async ([t,d])=>{const r=await ImportEngine.analyzeTxt(new File([t],'f.txt'),'',d);window.__r=r;
return {ready:r.commitReady,errors:r.validationErrors,warnings:r.warnings,qs:r.questions.map(q=>({exam:q.metadata.examId,year:q.metadata.year,shift:q.metadata.shift,ch:q.metadata.chapter}))}}"""

with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 390, 'height': 844}); pg = ctx.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('file://' + PATH); pg.wait_for_selector('.sj-dash', timeout=20000)

    # 1. no exam/year in file -> without defaults it is blocked
    txt = blk(1) + blk(2)
    r = pg.evaluate(ANALYZE, [txt, {}])
    rec('without defaults: missing exam/year blocks import', not r['ready'] and any('EXAM_NAME' in str(e) for e in r['errors']), r['errors'][:2])

    # 2. defaults fill blanks
    r = pg.evaluate(ANALYZE, [txt, {'EXAM_NAME': 'SSC CGL', 'YEAR': '2023', 'SHIFT': '12 Sep Shift 1'}])
    rec('defaults fill exam/year/shift', r['ready'] and all(q['year'] == '2023' and q['shift'] == '12 Sep Shift 1' and q['exam'] for q in r['qs']), r['qs'])
    rec('summary warning lists filled fields', any('ऊपर भरे मान' in w and 'Exam 2' in w and 'Year 2' in w for w in r['warnings']), r['warnings'][:2])

    # 3. file wins over defaults, with a note
    txt2 = blk(3, EXAM_NAME='RRB NTPC', YEAR='2024') + blk(4)
    r = pg.evaluate(ANALYZE, [txt2, {'EXAM_NAME': 'SSC CGL', 'YEAR': '2023'}])
    years = [q['year'] for q in r['qs']]
    rec('file value wins, blank gets default', r['ready'] and years == ['2024', '2023'], years)
    rec('conflict noted for block 1', any('Block 1' in w and 'file वाला लिया' in w for w in r['warnings']), r['warnings'][:3])
    rec('different exams per block resolved', r['qs'][0]['exam'] != r['qs'][1]['exam'], r['qs'])

    # 4. bad default year is still caught by strict engine
    r = pg.evaluate(ANALYZE, [txt, {'EXAM_NAME': 'SSC CGL', 'YEAR': '23'}])
    rec('bad default year rejected by engine', not r['ready'], r['errors'][:1])

    # 5. UI: fields present, remembered, year check, import works end-to-end
    pg.evaluate('openImportModal()')
    rec('defaults panel shown', pg.locator('#impDef_EXAM_NAME').count() == 1 and pg.locator('#impDef_YEAR').count() == 1)
    pg.fill('#impDef_EXAM_NAME', 'SSC CGL'); pg.fill('#impDef_YEAR', '20x4')
    pg.set_input_files('#impFileInput', files=[{'name': 'q.txt', 'mimeType': 'text/plain', 'buffer': txt.encode()}])
    pg.click('#btnStartImport'); pg.wait_for_timeout(400)
    rec('UI rejects bad year before analyze', 'Year' in pg.inner_text('#importStatusReport'), pg.inner_text('#importStatusReport')[:120])
    pg.fill('#impDef_YEAR', '2022'); pg.click('#btnStartImport'); pg.wait_for_timeout(800)
    ready = pg.evaluate('PendingImportTransaction && PendingImportTransaction.commitReady')
    rec('UI analyze with defaults is ready', ready)
    pg.evaluate('closeModal()'); pg.evaluate('openImportModal()')
    rec('defaults remembered on reopen', pg.input_value('#impDef_EXAM_NAME') == 'SSC CGL' and pg.input_value('#impDef_YEAR') == '2022')
    pg.evaluate('clearImportDefaults()')
    rec('clear empties fields', pg.input_value('#impDef_YEAR') == '' and pg.evaluate("localStorage.getItem('mtb-import-defaults-v1')") == '{}')
    r = pg.evaluate("async t=>{const a=await ImportEngine.analyzeTxt(new File([t],'f.txt'),'',{EXAM_NAME:'SSC CGL',YEAR:'2022'});const c=await ImportEngine.commit(a);return c.committedQuestions}", txt)
    rec('commit with defaults', r == 2, r)
    # no horizontal overflow at phone width
    pg.evaluate('openImportModal()')
    ov = pg.evaluate("document.getElementById('modalSheetBody').scrollWidth - document.getElementById('modalSheetBody').clientWidth")
    rec('no horizontal overflow at 390px', ov <= 1, ov)
    rec('no page errors', not errs, errs[:2])
    b.close()
print(f'{sum(res)}/{len(res)} passed'); sys.exit(0 if all(res) else 1)
