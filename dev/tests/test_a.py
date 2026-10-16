import sys, json, os
from playwright.sync_api import sync_playwright
PATH, OUT = sys.argv[1], sys.argv[2]
results = []
def rec(name, ok, detail=''):
    results.append((name, 'PASS' if ok else 'FAIL', str(detail)[:260])); print('PASS' if ok else 'FAIL', name, str(detail)[:260])

def blk(no, **kw):
    f = dict(SOURCE_QUESTION_NO=no, EXAM_NAME='RRB NTPC', YEAR='2024', SUBJECT='Maths', CHAPTER='Arithmetic', TOPIC='Audit Topic',
             QUESTION_EN=f'Audit question {no}: what is {no} + 1?', A_EN=str(no + 1), B_EN=str(no + 2), C_EN=str(no + 3), D_EN=str(no), ANSWER='A')
    f.update(kw)
    lines = [f'{k}: {v}' for k, v in f.items() if v is not None]
    return '=== QUESTION START ===\n' + '\n'.join(lines) + '\n=== QUESTION END ===\n'
ANALYZE = """async ([t,topic])=>{const r=await ImportEngine.analyzeTxt(new File([t],'f.txt'),topic||'');window.__r=r;return {ready:r.commitReady,errors:r.validationErrors,warnings:r.warnings,dupB:r.duplicateBatch,dupE:r.duplicateExternal,stats:r.stats,moduleId:r.moduleId,qs:r.questions.map(q=>({id:q.canonicalQId,no:q.originalQNo,ans:q.answer,opts:q.options.map(o=>o.en+'|'+o.hi),exp:q.EXPLANATION,exam:q.metadata.examId,year:q.metadata.year,subject:q.metadata.subject,status:q.diffStatus}))}}"""
COMMIT = """async (opts)=>{try{const c=await ImportEngine.commit(window.__r,opts||{});return {ok:true,c}}catch(e){return {ok:false,err:e.message}}}"""
def analyze(page, txt, topic=''): return page.evaluate(ANALYZE, [txt, topic])
def mod_count(page, mid): return page.evaluate(f"(()=>{{const m=AppModules.find(x=>x.moduleId==={json.dumps(mid)}&&WorkspaceManager.matches(x));return m?m.groups.reduce((n,g)=>n+g.questions.length,0):-1}})()")

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, accept_downloads=True)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('dialog', lambda d: d.accept())
    page.goto('file://' + PATH); page.wait_for_selector('.sj-dash', timeout=15000)

    # ---------------- fresh install ----------------
    rec('fresh install: no invented streak / minutes / sample mistake', page.evaluate("UserState.dailyStreak===undefined && UserState.studyMinutesToday===undefined && UserState.mistakeBook.length===0 && !Object.keys(UserState.masteryMap||{}).length"))
    rec('exam counts equal real question count, stable after re-sync', page.evaluate("(()=>{const sum=()=>UniversalExamRegistry.getAllExams().reduce((n,e)=>n+e.questionCount,0);const a=sum();synchronizeTaxonomyEngine();synchronizeTaxonomyEngine();return a===IndexEngine.registry.size&&sum()===a})()"))

    # ---------------- strict import ----------------
    r = analyze(page, blk(1, ANSWER=None) + blk(2, YEAR=None) + blk(3, EXAM_NAME=None, SUBJECT=None) + blk(4, CHAPTER=None, ANSWER='XYZ') + blk(5, C_EN=None))
    errs = {e['index']: ' · '.join(e['errors']) for e in r['errors']}
    rec('missing ANSWER is an error (no silent "A")', 'ANSWER नहीं है' in errs.get(1, ''), errs.get(1))
    rec('missing YEAR is an error (no silent 2024)', 'YEAR नहीं है' in errs.get(2, ''), errs.get(2))
    rec('missing EXAM and SUBJECT are errors', 'EXAM_NAME' in errs.get(3, '') and 'SUBJECT' in errs.get(3, ''), errs.get(3))
    rec('unreadable ANSWER is an error', 'समझ नहीं आया' in errs.get(4, '') and 'CHAPTER' in errs.get(4, ''), errs.get(4))
    rec('missing option is an error', 'Option C' in errs.get(5, ''), errs.get(5))
    rec('errors carry line numbers; import blocked', all(e['line'] > 0 for e in r['errors']) and not r['ready'])

    r = analyze(page, blk(1, ANSWER='(B)') + blk(2, ANSWER='b') + blk(3, ANSWER='Option C') + blk(4, ANSWER='4') + blk(5, ANSWER='Ans: D'))
    rec('answers normalised: (B) b "Option C" 4 "Ans: D"', [q['ans'] for q in r['qs']] == ['B', 'B', 'C', 'D', 'D'] and r['ready'], [q['ans'] for q in r['qs']])
    rec('numeric answer is reported as a note', any('ANSWER 4 को D माना' in w for w in r['warnings']))

    multi = blk(1).replace('ANSWER: A', 'ANSWER: A\nEXPLANATION_EN: Step one.\nStep two continues.\nA: this line belongs to the explanation\nRatio: 3:4 also stays')
    r = analyze(page, multi)
    q = r['qs'][0]
    rec('multi-line explanation kept in full', q['exp'].count('\n') == 3 and 'Ratio: 3:4' in q['exp'], q['exp'])
    rec('"A:" line inside explanation does not touch option A (EN or HI)', q['opts'][0] == '2|2', q['opts'][0])

    r = analyze(page, blk(1, EXAM_NAME='SSC MTS Objective') + blk(2, EXAM_NAME='RPF Constable Assistant') + blk(3, SUBJECT='General Engineering') + blk(4, SUBJECT='Computer Science') + blk(5, EXAM_NAME='Alpha Bank PO') + blk(6, EXAM_NAME='RPF S.I.'))
    ex = [(x['exam'], x['subject']) for x in r['qs']]
    rec('exam mapping exact: SSC MTS ≠ SSC JE, RPF Constable Assistant ≠ RPF SI, Alpha ≠ ALP', ex[0][0] == 'ssc-mts-objective' and ex[1][0] == 'rpf-constable' and ex[4][0] == 'alpha-bank-po' and ex[5][0] == 'rpf-si', ex)
    rec('subject mapping exact: General Engineering ≠ English, Computer Science ≠ Science', ex[2][1] == 'general engineering' and ex[3][1] == 'computer', ex)
    rec('cancelled analysis leaves no phantom exams', page.evaluate("!UniversalExamRegistry.registry.has('ssc-mts-objective') && !UniversalExamRegistry.registry.has('alpha-bank-po')"))

    r = analyze(page, blk(1, QUESTION_EN='If x+y = 5 and k = 2.5, find x', ANSWER='A') + blk(2, QUESTION_EN='If x-y = 5 and k = 25, find x') +
                blk(3, QUESTION_EN='Select the odd one out.', A_EN='Cat', B_EN='Dog', C_EN='Cow', D_EN='Car') + blk(4, QUESTION_EN='Select the odd one out.', A_EN='Red', B_EN='Blue', C_EN='Green', D_EN='Run'))
    rec('symbols/decimals and options count: 4 different questions accepted', r['ready'] and not r['dupB'], r['dupB'])
    r = analyze(page, blk(1) + blk(2, SOURCE_QUESTION_NO=9, QUESTION_EN='Audit question 1: what is 1 + 1?', A_EN='2', B_EN='3', C_EN='4', D_EN='1'))
    rec('true duplicate inside a file is caught with block number', not r['ready'] and r['dupB'] and 'block 1' in r['dupB'][0]['reason'], r['dupB'])

    # cross-subject same topic name must not touch Maths Percentage
    before = mod_count(page, 'maths-percentage-class-test')
    r = analyze(page, ''.join(blk(i, SUBJECT='Reasoning', TOPIC='Percentage', QUESTION_EN=f'Reasoning pct {i}?') for i in range(1, 4)))
    c = page.evaluate(COMMIT)
    rec('Reasoning "Percentage" import creates its own topic', c['ok'] and r['moduleId'] == 'reasoning-percentage-class-test' and mod_count(page, 'reasoning-percentage-class-test') == 3, c)
    rec('Maths Percentage untouched (356 questions)', mod_count(page, 'maths-percentage-class-test') == before == 356, (before, mod_count(page, 'maths-percentage-class-test')))
    rec('auto backup made before import', page.evaluate("(async()=>{const i=await DataSafety.readIndex();return i.some(x=>x.reason.startsWith('Import से पहले'))})()"))

    # merge on re-import
    base = ''.join(blk(i) for i in range(1, 6))
    analyze(page, base); c = page.evaluate(COMMIT)
    ids1 = page.evaluate("AppModules.find(m=>m.moduleId==='maths-audit-topic-class-test').groups.flatMap(g=>g.questions.map(q=>q.canonicalQId))")
    rec('first import: readable stable IDs', c['ok'] and ids1[0] == 'Q-rrb-ntpc-2024-maths-audit-topic-1', ids1[:2])
    r = analyze(page, base)
    rec('same file again: 5 unchanged, IDs identical', r['stats'] == {'new': 0, 'changed': 0, 'unchanged': 5, 'missing': 0} and [q['id'] for q in r['qs']] == ids1, r['stats'])
    r = analyze(page, blk(1) + blk(2, QUESTION_EN='Audit question 2 (corrected): what is 2 + 1?') + blk(3) + blk(4) + blk(6))
    rec('edited file: 1 new, 1 changed, 3 unchanged, 1 missing', r['stats'] == {'new': 1, 'changed': 1, 'unchanged': 3, 'missing': 1}, r['stats'])
    c = page.evaluate(COMMIT)
    rec('by default missing questions are kept (6 total)', c['ok'] and mod_count(page, 'maths-audit-topic-class-test') == 6 and c['c']['keptMissing'] == 1, c)
    rec('changed question keeps its ID', page.evaluate("IndexEngine.registry.get('Q-rrb-ntpc-2024-maths-audit-topic-2').QUESTION_EN.includes('corrected')"))
    r = analyze(page, blk(1) + blk(2, QUESTION_EN='Audit question 2 (corrected): what is 2 + 1?') + blk(3) + blk(4) + blk(6))
    c = page.evaluate(COMMIT, {'removeMissing': True})
    rec('"remove missing" removes only that question (5 total)', c['ok'] and mod_count(page, 'maths-audit-topic-class-test') == 5 and c['c']['removed'] == 1, c)
    # undo
    page.evaluate("window.confirm=()=>true")
    page.evaluate("undoLastImportUI()"); page.wait_for_timeout(600)
    rec('undo last import brings the removed question back (6)', mod_count(page, 'maths-audit-topic-class-test') == 6)
    # legacy IDs are reused (attempt history stays linked)
    page.evaluate("(()=>{const m=AppModules.find(x=>x.moduleId==='maths-audit-topic-class-test');m.groups.forEach(g=>g.questions.forEach(q=>{q.canonicalQId='OLD-'+q.originalQNo;q.metadata.canonicalQId=q.canonicalQId}));synchronizeTaxonomyEngine()})()")
    r = analyze(page, base)
    rec('legacy IDs re-used by question number on re-import', all(q['id'] == f"OLD-{q['no']}" for q in r['qs']), [q['id'] for q in r['qs']])
    # cross-workspace duplicate ID is visible to the audit
    page.evaluate("(()=>{const src=AppModules.find(m=>m.moduleId==='maths-audit-topic-class-test');const c=JSON.parse(JSON.stringify(src));c.moduleId='dup-ws';c.workspaceId='ws-comp-ssc';c.groups.forEach(g=>g.questions.forEach(q=>{q.workspaceId='ws-comp-ssc';q.metadata.workspaceId='ws-comp-ssc'}));AppModules.push(c);synchronizeTaxonomyEngine()})()")
    a = page.evaluate("runDataIntegrityAudit()")
    rec('audit now sees duplicate IDs across workspaces', not a['healthy'] and len(a['duplicateIds']) == 6, len(a['duplicateIds']))
    page.evaluate("AppModules=AppModules.filter(m=>m.moduleId!=='dup-ws');synchronizeTaxonomyEngine();saveModules()")

    # import review UI
    page.evaluate("openImportModal()")
    tmp = os.path.join(OUT, 'a_import.txt'); open(tmp, 'w', encoding='utf-8').write(blk(1) + blk(2, ANSWER=None))
    page.set_input_files('#impFileInput', tmp); page.click('#btnStartImport'); page.wait_for_timeout(500)
    t = page.inner_text('#modalSheetBody')
    rec('review shows the error with block and line', 'Block 2' in t and 'line' in t and 'ANSWER नहीं है' in t and page.locator('#modalSheetBody .btn-nav.primary').is_disabled())
    page.screenshot(path=OUT + '/a_import_review.png')
    page.evaluate("closeModal()")

    # ---------------- storage safety ----------------
    page.evaluate("(async()=>{await StorageWriteQueue.flush();const o=IDBDatabase.prototype.transaction;let n=1;IDBDatabase.prototype.transaction=function(s,m){if(m==='readwrite'&&n>0){n--;throw new DOMException('sim','UnknownError')}return o.apply(this,arguments)};})()")
    cid = page.evaluate("Array.from(IndexEngine.registry.keys())[0]")
    page.evaluate(f"toggleBookmark({json.dumps(cid)})"); page.wait_for_timeout(600)
    rec('one IDB write error: retried, storage mode unchanged', not page.evaluate("AppStorage.useFallback") and page.locator('#dsBanner').count() == 0)
    page.reload(); page.wait_for_selector('.sj-dash', timeout=15000)
    rec('…and the change survives reload (no split-brain)', page.evaluate(f"ReviewState.bookmarks.some(b=>b.cid==={json.dumps(cid)})"))

    page.evaluate("(()=>{const o=IDBDatabase.prototype.transaction;window.__o=o;IDBDatabase.prototype.transaction=function(s,m){if(m==='readwrite')throw new DOMException('sim','UnknownError');return o.apply(this,arguments)}})()")
    page.evaluate("toggleCbtDark()"); page.wait_for_timeout(800)
    rec('persistent save failure shows a red banner', page.locator('#dsBanner').count() == 1 and 'save नहीं हुआ' in page.inner_text('#dsBanner'))
    page.screenshot(path=OUT + '/a_banner.png')
    page.evaluate("(()=>{IDBDatabase.prototype.transaction=window.__o})()")
    page.locator('#dsBanner button', has_text='फिर कोशिश करें').click(); page.wait_for_timeout(800)
    rec('"फिर कोशिश करें" saves and the banner goes', page.locator('#dsBanner').count() == 0)
    page.evaluate("toggleCbtDark()"); page.wait_for_timeout(300)

    # corrupt data
    page.evaluate("(async()=>{await StorageWriteQueue.flush();await AppStorage.setRawDirect(USER_KEY,'{broken user');})()"); page.wait_for_timeout(200)
    page.reload(); page.wait_for_selector('.sj-dash', timeout=15000); page.wait_for_timeout(300)
    rec('corrupt progress: app opens with clean values, no fake streak', page.evaluate("UserState.dailyStreak===undefined && UserState.mistakeBook.length===0"))
    rec('corrupt progress: banner tells the student', page.locator('#dsBanner').count() == 1 and 'पढ़ा नहीं जा सका' in page.inner_text('#dsBanner'))
    kept = page.evaluate("(async()=>{const c=DataHealth.corrupt[0];return c&&c.savedAs?await AppStorage.getRaw(c.savedAs):null})()")
    rec('damaged copy kept safely in storage', kept == '{broken user', kept)
    page.evaluate("openBackupCenter()"); page.wait_for_timeout(300)
    with page.expect_download() as d:
        page.locator('#modalSheetBody button', has_text='खराब copy download').click()
    rec('damaged copy can be downloaded', d.value.suggested_filename.startswith('MASTER_TESTBOOK_DAMAGED_progress'))
    page.evaluate("closeModal()")

    # backup + restore
    with page.expect_download() as d:
        page.evaluate("downloadDataSnapshot()")
    bpath = os.path.join(OUT, 'a_backup.json'); d.value.save_as(bpath)
    bj = json.load(open(bpath, encoding='utf-8'))
    rec('backup file has schema + all parts', bj.get('schema') == 'mtb-backup-2' and all(k in bj for k in ['modules', 'attemptHistory', 'resultHistory', 'reviewState', 'studySettings']))
    nb = page.evaluate("ReviewState.bookmarks.length")
    page.evaluate(f"toggleBookmark({json.dumps(cid)})"); page.wait_for_timeout(300)
    page.evaluate("openBackupCenter()"); page.wait_for_timeout(300)
    bad = os.path.join(OUT, 'a_bad.json'); open(bad, 'w').write('{"hello": 1}')
    page.set_input_files('#modalSheetBody input[type=file]', bad); page.wait_for_timeout(300)
    rec('wrong file is refused with a reason', 'इस्तेमाल नहीं हो सकता' in page.inner_text('#bkRestore'))
    page.set_input_files('#modalSheetBody input[type=file]', bpath); page.wait_for_timeout(300)
    rec('restore preview shows counts before changing anything', 'सवाल' in page.inner_text('#bkRestore') and 'बदल जाएगा' in page.inner_text('#bkRestore'))
    page.screenshot(path=OUT + '/a_restore_preview.png')
    with page.expect_navigation():
        page.locator('#bkRestore .btn-nav.primary').click()
    page.wait_for_selector('.sj-dash', timeout=15000); page.wait_for_timeout(300)
    rec('restore brings back the backup state', page.evaluate("ReviewState.bookmarks.length") == nb)
    rec('a "Restore से पहले" auto backup exists', page.evaluate("(async()=>(await DataSafety.readIndex()).some(x=>x.reason==='Restore से पहले'))()"))
    rec('only 3 auto backups kept', page.evaluate("(async()=>(await DataSafety.readIndex()).length)()") <= 3)

    # delete through Data Control is scoped, backed up, persisted
    victim = page.evaluate("WorkspaceManager.filterModules(AppModules).find(m=>m.moduleId==='maths-audit-topic-class-test').groups[0].questions[0].canonicalQId")
    page.evaluate(f"deleteQuestionDNA({json.dumps(victim)})"); page.wait_for_timeout(600)
    page.reload(); page.wait_for_selector('.sj-dash', timeout=15000)
    rec('single delete is saved (survives reload) with a backup first', not page.evaluate(f"IndexEngine.registry.has({json.dumps(victim)})") and page.evaluate("(async()=>(await DataSafety.readIndex()).some(x=>x.reason.startsWith('Delete से पहले')))()"))

    # two tabs
    t2 = ctx.new_page(); t2.goto('file://' + PATH); t2.wait_for_selector('.sj-dash', timeout=15000); page.wait_for_timeout(400)
    rec('opening a 2nd tab makes the 1st read-only with a clear message', page.evaluate("DataHealth.readOnly") and 'दूसरे tab' in page.inner_text('#dsBanner'))
    res = page.evaluate("saveUserState().then(()=>'saved',e=>e.message)")
    rec('read-only tab cannot overwrite data', res == 'READ_ONLY_TAB', res)
    page.locator('#dsBanner button').click(); page.wait_for_selector('.sj-dash', timeout=15000); t2.wait_for_timeout(500)
    rec('"यहीं इस्तेमाल करें" moves control to this tab', t2.evaluate("DataHealth.readOnly") and not page.evaluate("DataHealth.readOnly"))
    t2.close()

    # reset keeps a recovery point
    page.evaluate("confirmResetAppData()"); page.wait_for_selector('.sj-dash', timeout=15000)
    idx = page.evaluate("(async()=>await DataSafety.readIndex())()")
    rec('reset keeps a "Reset से पहले" auto backup', any(x['reason'] == 'Reset से पहले' for x in idx))
    slot = [x for x in idx if x['reason'] == 'Reset से पहले'][0]['slot']
    page.evaluate(f"(async()=>{{await openBackupCenter();await restoreFromSlot({slot})}})()"); page.wait_for_timeout(400)
    with page.expect_navigation():
        page.locator('#bkRestore .btn-nav.primary').click()
    page.wait_for_selector('.sj-dash', timeout=15000)
    rec('…and restoring it brings the imported topic back', mod_count(page, 'maths-audit-topic-class-test') > 0)

    page.set_viewport_size({'width': 360, 'height': 800})
    page.evaluate("openBackupCenter()"); page.wait_for_timeout(400); page.screenshot(path=OUT + '/a_backup_360.png')
    rec('backup centre fits 360px', page.evaluate("document.getElementById('modalSheet').scrollWidth<=document.getElementById('modalSheet').clientWidth+1"))
    page.evaluate("closeModal(); toggleCbtDark(); openBackupCenter()"); page.wait_for_timeout(400); page.screenshot(path=OUT + '/a_backup_dark_360.png'); page.evaluate("closeModal(); toggleCbtDark()")
    rec('no page errors', not errors, errors)
    b.close()
json.dump(results, open(OUT + '/a_results.json', 'w'), indent=1, ensure_ascii=False)
print('TOTAL', len(results), 'FAIL', sum(1 for r in results if r[1] == 'FAIL'))
