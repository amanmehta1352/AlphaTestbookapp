import sys, json, os
from playwright.sync_api import sync_playwright
import fake_supabase as F
PATH, OUT = sys.argv[1], sys.argv[2]
results = []
def rec(name, ok, detail=''):
    results.append((name, 'PASS' if ok else 'FAIL', str(detail)[:260])); print('PASS' if ok else 'FAIL', name, str(detail)[:260])
def db(sql): return F.psql_raw(sql).splitlines()[-1] if F.psql_raw(sql) else ''

F.start(F.SCHEMA_V1, F.SCHEMA_V2)
fake = F.Fake()
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 390, 'height': 844})
        ctx.route(F.URL + '/**', fake.handle)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('dialog', lambda d: d.accept())
        page.goto('file://' + PATH); page.wait_for_selector('.sj-dash', timeout=15000)
        def sheet(): return page.inner_text('#srvSheet')
        def wait_idle(ms=15000): page.wait_for_function("!ServerState.busy", timeout=ms); page.wait_for_timeout(100)

        page.click('#btnMenu'); page.locator('#sideDrawer .drawer-item', has_text='Server (Admin)').click(); page.wait_for_timeout(200)
        rec('menu opens the Server sheet with a login form', page.locator('#srvEmail').count() == 1 and page.locator('#srvPass').count() == 1)
        page.fill('#srvEmail', F.ADMIN[1]); page.fill('#srvPass', 'wrong'); page.click('#srvSheet button[type=submit]'); wait_idle()
        rec('wrong password: clear Hindi message', 'Email या password गलत है' in sheet())
        page.fill('#srvEmail', F.ADMIN[1]); page.fill('#srvPass', F.ADMIN[2]); page.click('#srvSheet button[type=submit]')
        page.wait_for_function("ServerState.isAdmin===true", timeout=10000); page.wait_for_timeout(100)
        rec('admin login works and is recognised as admin', 'Admin' in sheet() and page.locator('.srv-mod').count() == 3)
        rec('password is not stored anywhere in the app', 'admin-pass' not in page.evaluate("JSON.stringify(localStorage)+JSON.stringify(ServerState)"))
        page.screenshot(path=OUT + '/c1_admin.png')

        page.evaluate("ImportHistory.push({transactionId:'TEST-SEED',moduleId:'seed',sourceFile:'seed'})")  # this phone holds real admin data
        page.locator('#srvSheet .btn-nav', has_text='जाँचें').click(); wait_idle()
        t = page.evaluate("ServerState.plan.totals")
        rec('check: all 362 built-in questions are new (nothing skipped)', t['new'] == 362 and t['skipped'] == 0 and t['changed'] == 0, t)
        page.screenshot(path=OUT + '/c1_plan.png')
        page.locator('#srvSheet .btn-nav.primary').click(); wait_idle(60000)
        rec('send: success message', 'भेज दिया: 362' in sheet(), sheet()[-200:])
        rec('server has 362 questions, 3 topics, exams present', db("select count(*) from public.questions") == '362' and db("select count(*) from public.topics") == '3' and int(db("select count(*) from public.exams")) >= 1)
        rec('server rows keep answers, options and Hindi text', db("select count(*) from public.questions where answer in ('A','B','C','D') and jsonb_array_length(options)=4") == '362' and int(db("select count(*) from public.questions where question_hi is not null")) > 300)
        rec('an import batch is recorded', db("select added from public.import_batches") == '362')
        sample = page.evaluate("(()=>{const q=getWorkspaceModule('maths-percentage-class-test').groups[0].questions[0];return {id:q.canonicalQId,en:q.QUESTION_EN,ans:q.answer}})()")
        srv = json.loads(db(f"select json_build_object('en',question_en,'ans',answer) from public.questions where id={F.q(sample['id'])}"))
        rec('a question on the server matches the app exactly', srv['en'] == sample['en'].strip() and srv['ans'] == sample['ans'], (srv, sample['id']))

        page.locator('#srvSheet .btn-nav', has_text='जाँचें').click(); wait_idle()
        t = page.evaluate("ServerState.plan.totals")
        rec('second check: 362 unchanged, nothing to send', t['same'] == 362 and t['new'] == 0 and t['changed'] == 0 and page.locator('#srvSheet .btn-nav.primary').is_disabled(), t)

        page.evaluate("(()=>{const q=getWorkspaceModule('maths-percentage-class-test').groups[0].questions[1];q.metadata.sourceType='PYQ';const q2=getWorkspaceModule('maths-percentage-class-test').groups[0].questions[2];q2.QUESTION_EN=q2.QUESTION_EN+' (edited)';synchronizeTaxonomyEngine();ServerState.plan=null;srvPaint()})()")
        page.locator('#srvSheet .btn-nav', has_text='जाँचें').click(); wait_idle()
        t = page.evaluate("ServerState.plan.totals")
        rec('PYQ mark + text edit = 2 changed, only those are sent', t['changed'] == 2 and t['same'] == 360, t)
        before_calls = len([c for c in fake.calls if c[1] == '/rest/v1/questions' and c[0] == 'POST'])
        page.locator('#srvSheet .btn-nav.primary').click(); wait_idle()
        rec('server got the PYQ mark and the edited text', db("select count(*) from public.questions where source_type='PYQ'") == '1' and db("select count(*) from public.questions where question_en like '%(edited)'") == '1')

        gone = page.evaluate("(()=>{const m=getWorkspaceModule('maths-profit-loss-class-test');const q=m.groups[0].questions.pop();synchronizeTaxonomyEngine();ServerState.plan=null;srvPaint();return q.canonicalQId})()")
        page.locator('#srvSheet .btn-nav', has_text='जाँचें').click(); wait_idle()
        rec('question removed in app shows as "only on server"', page.evaluate("ServerState.plan.totals.serverOnly") == 1 and page.locator('#srvHide').count() == 1)
        page.check('#srvHide'); page.locator('#srvSheet .btn-nav.primary').click(); wait_idle()
        rec('…and can be hidden from students (not deleted)', db(f"select is_active from public.questions where id={F.q(gone)}") == 'f' and db("select count(*) from public.questions") == '362')

        # broken local question is skipped, not sent
        page.evaluate("(()=>{const q=getWorkspaceModule('science-physics-electricity-class-test').groups[0].questions[0];q.answer='(B)';ServerState.plan=null;srvPaint()})()")
        page.locator('#srvSheet .btn-nav', has_text='जाँचें').click(); wait_idle()
        rec('a question with a bad answer is held back and listed', page.evaluate("ServerState.plan.totals.skipped") == 1 and 'A–D नहीं' in page.evaluate("document.getElementById('srvSheet').textContent"), page.evaluate("ServerState.plan.totals"))
        page.evaluate("(()=>{const q=getWorkspaceModule('science-physics-electricity-class-test').groups[0].questions[0];q.answer='A'})()")

        # id already used by another topic on the server
        F.psql_raw("insert into public.topics(id,subject,chapter,title) values ('other-topic','maths','X','Other'); insert into public.questions(id,topic_id,subject,chapter,topic,question_en,options,answer) values ('CLASH-1','other-topic','maths','X','Other','q','[{},{},{},{}]','A');")
        page.evaluate("(()=>{const m=getWorkspaceModule('maths-profit-loss-class-test');const q=JSON.parse(JSON.stringify(m.groups[0].questions[0]));q.canonicalQId='CLASH-1';q.metadata.canonicalQId='CLASH-1';q.originalQNo=99;m.groups[0].questions.push(q);synchronizeTaxonomyEngine();ServerState.plan=null;srvPaint()})()")
        page.locator('#srvSheet .btn-nav', has_text='जाँचें').click(); wait_idle()
        rec('ID clash with another server topic is reported, not overwritten', page.evaluate("ServerState.plan.totals.conflict") == 1 and 'other-topic' in page.evaluate("document.getElementById('srvSheet').textContent"), page.evaluate("ServerState.plan.totals"))
        if not page.locator('#srvSheet .btn-nav.primary').is_disabled(): page.locator('#srvSheet .btn-nav.primary').click(); wait_idle()
        rec('server copy of the clashing question was left alone', db("select topic_id from public.questions where id='CLASH-1'") == 'other-topic')

        # a fresh import goes up as a new topic + new exam
        txt = ''.join(f"=== QUESTION START ===\nEXAM_NAME: SSC CGL\nYEAR: 2023\nSUBJECT: Reasoning\nCHAPTER: Verbal\nTOPIC: Analogy\nSOURCE_QUESTION_NO: {i}\nSOURCE_TYPE: PYQ\nQUESTION_EN: Analogy question {i}?\nA_EN: a{i}\nB_EN: b{i}\nC_EN: c{i}\nD_EN: d{i}\nANSWER: C\n=== QUESTION END ===\n" for i in range(1, 6))
        r = page.evaluate("async t=>{const a=await ImportEngine.analyzeTxt(new File([t],'a.txt'));const c=await ImportEngine.commit(a);return c.committedQuestions}", txt)
        page.evaluate("closeModal(); openServerSync()"); page.wait_for_function("ServerState.isAdmin===true", timeout=10000); page.wait_for_timeout(200)
        rec('login is remembered after closing the sheet', page.locator('.srv-mod').count() == 4)
        page.locator('#srvSheet .btn-nav', has_text='जाँचें').click(); wait_idle()
        page.locator('#srvSheet .btn-nav.primary').click(); wait_idle()
        rec('new topic + exam reach the server (5 PYQ)', db("select count(*) from public.questions where topic_id='reasoning-analogy-class-test' and source_type='PYQ'") == '5' and db("select name from public.exams where id='ssc-cgl'") == 'SSC CGL')

        # expired token refreshes silently
        page.evaluate("ServerState.session.expires_at=Date.now()-1000; ServerState.plan=null; srvPaint()")
        page.locator('#srvSheet .btn-nav', has_text='जाँचें').click(); wait_idle()
        rec('expired login refreshes silently', page.evaluate("!!ServerState.plan && ServerState.session.expires_at>Date.now()"))
        # reload keeps the session
        page.reload(); page.wait_for_selector('.sj-dash', timeout=15000)
        page.evaluate("openServerSync()"); page.wait_for_function("ServerState.isAdmin===true", timeout=10000)
        rec('after reload the admin stays logged in', True)
        # offline
        fake.offline = True
        page.locator('#srvSheet .btn-nav', has_text='जाँचें').click(); wait_idle()
        rec('no internet: friendly message, nothing breaks', 'Internet नहीं है' in sheet())
        fake.offline = False
        # logout
        page.locator('#srvSheet .btn-action-sm', has_text='Logout').click(); page.wait_for_timeout(300)
        rec('logout clears the saved login', page.locator('#srvEmail').count() == 1 and page.evaluate("localStorage.getItem('mtb_server_session_v1')") is None)

        # student cannot upload
        page.fill('#srvEmail', F.STUDENT[1]); page.fill('#srvPass', F.STUDENT[2]); page.click('#srvSheet button[type=submit]')
        page.wait_for_function("ServerState.isAdmin===false", timeout=10000); page.wait_for_timeout(100)
        rec('student login is told it is not admin', 'admin नहीं है' in sheet())
        res = page.evaluate("Server.upsert('questions',[{id:'HACK',topic_id:'maths-percentage-class-test',subject:'x',chapter:'x',topic:'x',question_en:'x',options:[{},{},{},{}],answer:'A'}],'id').then(()=>'ok',e=>e.message)")
        rec('server itself refuses a student write', 'अनुमति नहीं' in res and db("select count(*) from public.questions where id='HACK'") == '0', res)
        page.evaluate("srvLogout()")
        page.set_viewport_size({'width': 360, 'height': 800}); page.wait_for_timeout(200)
        rec('sheet fits 360px', page.evaluate("document.getElementById('modalSheet').scrollWidth<=document.getElementById('modalSheet').clientWidth+1"))
        page.screenshot(path=OUT + '/c1_login_360.png')
        rec('no page errors', not errors, errors)
        b.close()
finally:
    F.stop()
json.dump(results, open(OUT + '/c1_results.json', 'w'), indent=1, ensure_ascii=False)
print('TOTAL', len(results), 'FAIL', sum(1 for r in results if r[1] == 'FAIL'))
