import sys, json
from playwright.sync_api import sync_playwright
PATH, OUT = sys.argv[1], sys.argv[2]
results = []
def rec(name, ok, detail=''):
    results.append((name, 'PASS' if ok else 'FAIL', str(detail)[:220])); print('PASS' if ok else 'FAIL', name, str(detail)[:220])
def make_txt(topic, n, start, source_type=None, exam='RRB Group D', year='2024'):
    out = []
    for i in range(n):
        q = start + i
        out.append(f"""=== QUESTION START ===
SOURCE_QUESTION_NO: {q}
EXAM_NAME: {exam}
YEAR: {year}
SUBJECT: Maths
CHAPTER: Arithmetic
TOPIC: {topic}
SUB_TOPIC: {'Divisibility' if i % 2 == 0 else 'Remainders'}
{('SOURCE_TYPE: ' + source_type) if source_type else ''}
QUESTION_EN: {topic} question {q}: what is {q} + 1?
QUESTION_HI: {topic} प्रश्न {q}: {q} + 1 कितना है?
A_EN: {q+1}
B_EN: {q+2}
C_EN: {q+3}
D_EN: {q}
ANSWER: A
EXPLANATION_EN: {q} + 1 = {q+1}.
=== QUESTION END ===
""")
    return '\n'.join(out)
IMPORT = """async ([t,topic])=>{const a=await ImportEngine.analyzeTxt(new File([t],'q.txt'),topic);if(!a.commitReady)return {ok:false};const c=await ImportEngine.commit(a);return {ok:true,n:c.committedQuestions}}"""

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 390, 'height': 844})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append('console:' + m.text) if m.type == 'error' else None)
    page.on('dialog', lambda d: d.accept())
    page.goto('file://' + PATH); page.wait_for_selector('.sj-dash', timeout=15000)
    rec('import Number System', page.evaluate(IMPORT, [make_txt('Number System', 24, 5001), 'Number System'])['ok'])
    rec('import with SOURCE_TYPE: PYQ', page.evaluate(IMPORT, [make_txt('HCF LCM', 6, 9001, 'PYQ'), 'HCF LCM'])['ok'])
    rec('SOURCE_TYPE: PYQ stored as PYQ', page.evaluate("getWorkspaceModule('maths-hcf-lcm-class-test').groups[0].questions.every(q=>pyqStatusOf(q)==='PYQ')"))
    rec('questions without SOURCE_TYPE are "not marked"', page.evaluate("getWorkspaceModule('maths-number-system-class-test').groups[0].questions.every(q=>pyqStatusOf(q)==='UNCONFIRMED')"))
    rec('PYQ mark survives taxonomy re-sync', page.evaluate("synchronizeTaxonomyEngine(); getWorkspaceModule('maths-hcf-lcm-class-test').groups[0].questions.every(q=>pyqStatusOf(q)==='PYQ')"))
    rec('PYQ Test counts only marked PYQ (6)', page.evaluate("SBCache=null; sbPyqRows().length") == 6, page.evaluate("sbPyqRows().length"))

    # Topic hub
    page.evaluate("navigate('topic',{moduleId:'maths-number-system-class-test'})")
    t = page.inner_text('#mainView')
    rec('topic hub: real subtopics (Divisibility, Remainders)', 'Divisibility' in t and 'Remainders' in t and 'Price & Consumption' not in t and 'Election & Votes' not in t)
    rec('topic hub: no fake 50% mastery', 'shown after 10 answers' in t and '50% (learning)' not in t)
    rec('topic hub: no "V=IR" on unrelated topic', 'V=IR' not in t)
    rec('topic hub: Class tile says not available', 'not added for this topic yet' in t)
    page.screenshot(path=OUT + '/u4a_topic.png')
    # Learn concept check
    page.evaluate("navigate('learn',{moduleId:'maths-number-system-class-test'})")
    t = page.inner_text('#mainView')
    rec('learn: concept check is a real question from this topic', 'Number System question' in t and 'जूल' not in t)
    n0 = page.evaluate("AttemptHistory.length")
    page.locator('.lc-opt').nth(1).click()
    rec('learn: answer shows result and explanation', page.locator('.lc-opt.ok').count() == 1 and page.locator('.lc-opt.bad').count() == 1 and 'correct answer' in page.inner_text('.lc-card'))
    rec('learn: answer saved to history (mode learn)', page.evaluate("AttemptHistory.length") == n0 + 1 and page.evaluate("AttemptHistory[AttemptHistory.length-1].mode") == 'learn')
    page.locator('.lc-card .btn-nav').click()
    rec('learn: "Another question" gives a new unanswered question', page.locator('.lc-opt.ok').count() == 0 and page.locator('.lc-opt').count() == 4)
    page.screenshot(path=OUT + '/u4a_learn.png')
    # Class
    page.evaluate("navigate('class',{moduleId:'maths-number-system-class-test'})")
    t = page.inner_text('#mainView')
    rec('class: honest "no lecture video", no fake player', 'No lecture video' in t and 'Timestamp' not in t)
    # PYQ page
    page.evaluate("navigate('pyq',{moduleId:'maths-number-system-class-test'})")
    t = page.inner_text('#mainView')
    rec('PYQ page: no fake "Peer Accuracy"', 'Peer Accuracy' not in t)
    rec('PYQ page: honest empty state + link to mark', 'No questions marked as PYQ' in t and 'not marked as PYQ or practice' in t)
    page.evaluate("navigate('pyq',{moduleId:'maths-hcf-lcm-class-test'})")
    rec('PYQ page lists marked questions with own history', page.locator('#mainView .grid-cards .card-btn').count() == 6 and 'not tried yet' in page.inner_text('#mainView').lower())

    # Practice time + mastery evidence
    page.evaluate("navigate('practice',{moduleId:'maths-number-system-class-test',qIndex:0})")
    page.wait_for_timeout(1200)
    page.locator('.options-list .opt-card').first.click()
    sec = page.evaluate("AttemptHistory[AttemptHistory.length-1].sec")
    rec('practice: answering time recorded (≥1s)', isinstance(sec, int) and sec >= 1, sec)
    page.evaluate("""(()=>{const m=getWorkspaceModule('maths-number-system-class-test');const qs=m.groups.flatMap(g=>g.questions);
      for(let i=1;i<12;i++){onPracticeSelect(i%4===0?'B':qs[i].answer,qs[i].originalQNo,m.moduleId,i)}})()""")
    mx = page.evaluate("masteryFor('maths-number-system-class-test')")
    rec('mastery appears after ≥10 answers, from real accuracy', mx['enough'] and mx['answered'] >= 10 and 0 < mx['score'] < 1, mx)
    page.evaluate("navigate('mastery')")
    t = page.inner_text('#mainView')
    rec('mastery page: no "Physics"/starter entries, topics from workspace', 'Physics' not in t and 'Number System' in t and 'not enough data' in t.lower())
    rec('mastery page: links open the right topic', (page.locator('#mainView .grid-cards .card-btn', has_text='Number System').first.click() or True) and page.evaluate("Route.params.moduleId") == 'maths-number-system-class-test')
    page.evaluate("navigate('mastery')"); page.screenshot(path=OUT + '/u4a_mastery.png')
    page.evaluate("navigate('chapter',{subject:'maths',chapter:'Arithmetic'})")
    rec('chapter page badges use evidence (no fake "learning")', '/10 answers' in page.inner_text('#mainView').lower())

    # Data Control marking
    page.evaluate("navigate('home'); DataControlView={filter:'ALL',term:''}; openDataControlModal()")
    total_ws = page.evaluate("Array.from(IndexEngine.registry.values()).filter(q=>dcOwnerMap().get(String(q.canonicalQId))?.workspaceId===WorkspaceManager.current().id).length")
    rec('Data Control scoped to this workspace', f'{total_ws}' in page.inner_text('.data-control-dashboard'))
    page.locator('[data-dc-filter="UNCONFIRMED"]').click()
    page.fill('#dcSearch', 'Number System')
    page.locator('.dc-bulk .btn-action-sm', has_text='Select all shown').click()
    sel = int(page.inner_text('#dcSelCount'))
    rec('select all shown counts selection', sel == 24, sel)
    page.locator('.dc-bulk-actions .btn-action-sm', has_text='Mark PYQ').click()
    page.wait_for_timeout(300)
    rec('bulk "Mark PYQ" works', page.evaluate("SBCache=null; sbPyqRows().length") == 30, page.evaluate("sbPyqRows().length"))
    rec('filter/search kept after action', page.evaluate("DataControlView.filter") == 'UNCONFIRMED')
    rec('result message shown inside Data Control (sheet stays open)', 'updated' in page.inner_text('#dcStatus') and page.locator('#dcList').count() == 1)
    page.locator('[data-dc-filter="MISMATCH"]').click(); page.fill('#dcSearch', '')
    mm = page.locator('#dcList .dc-row').count()
    rec('mismatch filter finds exam/year conflicts', mm > 0, mm)
    page.locator('.dc-bulk .btn-action-sm', has_text='Select all shown').click()
    page.locator('.dc-bulk-actions .btn-action-sm', has_text='Fix exam/year').click()
    page.wait_for_timeout(300)
    rec('"Fix exam/year" resolves the visible conflicts', page.evaluate("(()=>{const o=dcOwnerMap();return Array.from(IndexEngine.registry.values()).filter(q=>dcIsMismatch(q,o.get(String(q.canonicalQId)))).length})()") < mm)
    rec('data integrity healthy after edits', page.evaluate("runDataIntegrityAudit().healthy"))
    page.screenshot(path=OUT + '/u4a_datacontrol.png')
    page.evaluate("closeModal()"); page.wait_for_timeout(500)
    page.reload(); page.wait_for_selector('.sj-dash', timeout=15000)
    rec('reload: PYQ marks persisted', page.evaluate("SBCache=null; sbPyqRows().length") == 30)
    rec('reload: attempts persisted', page.evaluate("AttemptHistory.length") >= 13)
    rec('no page/console errors', not errors, errors)
    b.close()
json.dump(results, open(OUT + '/u4a_results.json', 'w'), indent=1, ensure_ascii=False)
print('TOTAL', len(results), 'FAIL', sum(1 for r in results if r[1] == 'FAIL'))
