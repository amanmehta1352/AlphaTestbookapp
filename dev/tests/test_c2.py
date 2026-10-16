import sys, json, os, subprocess, time, shutil
from playwright.sync_api import sync_playwright
import fake_supabase as F
OUT = sys.argv[1]
results = []
def rec(name, ok, detail=''):
    results.append((name, 'PASS' if ok else 'FAIL', str(detail)[:260])); print('PASS' if ok else 'FAIL', name, str(detail)[:260])
def db(sql): o = F.psql_raw(sql); return o.splitlines()[-1] if o else ''
site = '/tmp/site_mtb'; shutil.rmtree(site, ignore_errors=True); shutil.copytree('/home/claude/work/pwa290', site + '/AlphaTestbookapp')
srv = subprocess.Popen(['python3', '-m', 'http.server', '8766', '--bind', '127.0.0.1'], cwd=site, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
APP = 'http://127.0.0.1:8766/AlphaTestbookapp/'
F.start('/home/claude/work/SUPABASE_SCHEMA_V1.sql'); fake = F.Fake()
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        errors = []
        def phone():
            ctx = b.new_context(viewport={'width': 390, 'height': 844}, service_workers='block')
            ctx.route(F.URL + '/**', fake.handle)
            pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('dialog', lambda d: d.accept())
            pg.goto(APP); pg.wait_for_selector('.sj-dash', timeout=15000); return ctx, pg
        def idle(pg): pg.wait_for_function("!CloudState.busy && !CloudSyncRunning", timeout=30000); pg.wait_for_timeout(150)

        # ---- admin phone uploads the starter topics ----
        actx, admin = phone()
        admin.evaluate("openServerSync()"); admin.fill('#srvEmail', F.ADMIN[1]); admin.fill('#srvPass', F.ADMIN[2]); admin.click('#srvSheet button[type=submit]')
        admin.wait_for_function("ServerState.isAdmin===true", timeout=10000)
        admin.evaluate("ImportHistory.push({transactionId:'TEST-SEED',moduleId:'seed',sourceFile:'seed'})")  # this phone holds real admin data
        admin.locator('#srvSheet .btn-nav', has_text='जाँचें').click(); admin.wait_for_function("!ServerState.busy && ServerState.plan", timeout=30000)
        admin.locator('#srvSheet .btn-nav.primary').click(); admin.wait_for_function("!ServerState.busy && !ServerState.plan", timeout=60000)
        rec('admin uploaded 362 questions', db("select count(*) from public.questions") == '362')

        # ---- student phone 1 ----
        sctx, st = phone()
        rec('home shows "Google से login करें" before login', st.locator('.cl-prompt').count() == 1)
        st.locator('.cl-prompt').click(); st.wait_for_timeout(200)
        rec('account sheet explains why to log in', 'Google से login करें' in st.inner_text('#cloudSheet'))
        st.locator('.cl-google').click()
        st.wait_for_selector('.sj-dash', timeout=15000); st.wait_for_function("ServerState.session && ServerState.session.user_id", timeout=10000); idle(st)
        rec('Google login returns to the app, address cleaned', 'access_token' not in st.url and st.evaluate("ServerState.session.email") == F.STUDENT[1])
        rec('student is not admin; questions came from the server', st.evaluate("CloudState.isAdmin===false && CloudState.serverQuestions===362 && AppModules.filter(m=>m.source==='server').length===3"))
        rec('home prompt disappears after login', st.locator('.cl-prompt').count() == 0)
        rec('server questions work in the app (index + PYQ status)', st.evaluate("IndexEngine.registry.size") >= 362)
        st.screenshot(path=OUT + '/c2_student_account.png')
        st.evaluate("closeModal()")
        # practice 3 answers, bookmark, goal, a test result
        st.evaluate("(()=>{const m=getWorkspaceModule('maths-percentage-class-test');const qs=m.groups.flatMap(g=>g.questions);[0,1,2].forEach(i=>onPracticeSelect(qs[i].answer,qs[i].originalQNo,m.moduleId,i));toggleBookmark(qs[5].canonicalQId);StudySettings.dailyGoal=25;saveStudySettings()})()")
        st.evaluate("(()=>{const m=getWorkspaceModule('maths-percentage-class-test');const qs=m.groups[0].questions.slice(0,5);ResultHistory.unshift({v:1,id:'R-TEST-1',ts:new Date().toISOString(),day:sjLocalDay(),ws:WorkspaceManager.current().id,moduleId:m.moduleId,groupId:m.groups[0].groupId,topicTitle:'Percentage',groupTitle:'G-01',examId:m.examId,examYear:m.examYear,total:5,correct:4,wrong:1,unattempted:0,score:3.67,accuracy:80,timeUsedSec:120,questionIds:qs.map(q=>q.canonicalQId),perQuestionSec:[],answers:{},sourceRefs:[]});saveResultHistory()})()")
        st.evaluate("openAccount()"); st.locator('#cloudSheet .btn-nav.primary').click(); st.wait_for_timeout(300); idle(st)
        uid = F.STUDENT[0]
        rec('3 answers reached the server', db(f"select count(*) from public.attempts where user_id='{uid}'") == '3', st.inner_text('#cloudSheet')[:200])
        rec('test result, bookmark and daily goal reached the server', db(f"select count(*) from public.results where user_id='{uid}'") == '1' and db(f"select count(*) from public.bookmarks where user_id='{uid}'") == '1' and db(f"select daily_goal from public.profiles where id='{uid}'") == '25')
        st.evaluate("cloudSync('manual')"); idle(st)
        rec('syncing again sends nothing twice', db(f"select count(*) from public.attempts where user_id='{uid}'") == '3' and db(f"select count(*) from public.results where user_id='{uid}'") == '1')
        # offline: answer saved locally, sent later
        fake.offline = True
        st.evaluate("(()=>{const m=getWorkspaceModule('maths-percentage-class-test');const qs=m.groups.flatMap(g=>g.questions);onPracticeSelect(qs[3].answer,qs[3].originalQNo,m.moduleId,3)})()")
        st.evaluate("cloudSync('manual')"); idle(st)
        rec('no internet: friendly message, answer waits', 'Internet नहीं है' in st.evaluate("CloudState.msg") and st.evaluate("AttemptHistory.filter(a=>!a.synced&&!a.syncSkip).length") == 1)
        fake.offline = False
        st.evaluate("cloudSync('manual')"); idle(st)
        rec('…and is sent when internet returns', db(f"select count(*) from public.attempts where user_id='{uid}'") == '4')

        # ---- admin edits + hides → student gets it ----
        admin.evaluate("(()=>{const q=getWorkspaceModule('maths-percentage-class-test').groups[0].questions[0];q.QUESTION_EN='EDITED BY ADMIN: '+q.QUESTION_EN;const m=getWorkspaceModule('maths-profit-loss-class-test');window.__gone=m.groups[0].questions.pop().canonicalQId;synchronizeTaxonomyEngine();ServerState.plan=null;srvPaint()})()")
        admin.locator('#srvSheet .btn-nav', has_text='जाँचें').click(); admin.wait_for_function("!ServerState.busy && ServerState.plan", timeout=30000)
        admin.check('#srvHide'); admin.locator('#srvSheet .btn-nav.primary').click(); admin.wait_for_function("!ServerState.busy && !ServerState.plan", timeout=60000)
        gone = admin.evaluate("window.__gone")
        st.evaluate("cloudSync('manual')"); idle(st)
        rec('student gets the admin\'s edit', st.evaluate("getWorkspaceModule('maths-percentage-class-test').groups[0].questions[0].QUESTION_EN.startsWith('EDITED BY ADMIN')"))
        rec('…and the hidden question is gone for the student', not st.evaluate(f"IndexEngine.registry.has({json.dumps(gone)})"))
        rec('student keeps own history after content refresh', st.evaluate("AttemptHistory.length") == 4 and st.evaluate("ReviewState.bookmarks.length") == 1)
        # admin phone: sync does not pull content
        admin.evaluate("closeModal(); cloudSync('manual')"); idle(admin)
        rec('admin phone keeps its own questions (no pull)', admin.evaluate("CloudState.isAdmin===true && AppModules.filter(m=>m.source==='server').length===0"))

        # ---- student on a NEW phone ----
        n2ctx, st2 = phone()
        st2.locator('.cl-prompt').click(); st2.locator('.cl-google').click()
        st2.wait_for_selector('.sj-dash', timeout=15000); st2.wait_for_function("ServerState.session && ServerState.session.user_id", timeout=10000); idle(st2)
        rec('new phone: history comes back (4 answers, 1 test)', st2.evaluate("AttemptHistory.length") == 4 and st2.evaluate("ResultHistory.length") == 1, (st2.evaluate("AttemptHistory.length"), st2.evaluate("ResultHistory.length")))
        rec('new phone: bookmark and daily goal come back', st2.evaluate("ReviewState.bookmarks.length") == 1 and st2.evaluate("StudySettings.dailyGoal") == 25)
        st2.evaluate("closeModal(); navigate('home')"); st2.wait_for_timeout(300)
        rec('new phone: dashboard shows the restored goal', '25' in st2.inner_text('.gx-goal'))
        st2.evaluate("openStoredResult('R-TEST-1')"); st2.wait_for_timeout(400)
        rec('new phone: old test result opens', st2.evaluate("Route.page") == 'result')
        st2.screenshot(path=OUT + '/c2_newphone_result.png')
        # bookmark removal on phone 2 propagates
        st2.evaluate("navigate('home'); toggleBookmark(ReviewState.bookmarks[0].cid); cloudSync('manual')"); idle(st2)
        rec('removing a bookmark is synced', db(f"select count(*) from public.bookmarks where user_id='{uid}'") == '0')
        # logout
        st2.evaluate("openAccount()"); st2.locator('#cloudSheet .btn-action-sm', has_text='Logout').click(); st2.wait_for_timeout(400)
        rec('logout keeps data, shows login prompt again', st2.evaluate("!ServerState.session && AttemptHistory.length===4") and (st2.evaluate("closeModal(); navigate('home')") or True) and st2.locator('.cl-prompt').count() == 1)
        st2.set_viewport_size({'width': 360, 'height': 800}); st2.evaluate("openAccount()"); st2.wait_for_timeout(300)
        rec('account sheet fits 360px', st2.evaluate("document.getElementById('modalSheet').scrollWidth<=document.getElementById('modalSheet').clientWidth+1"))
        st2.screenshot(path=OUT + '/c2_login_360.png')
        rec('student cannot read another user\'s answers', db(f"select count(*) from public.attempts") != '0' and F.psql_raw(F.as_user(F.STUDENT[0], f"select count(*) from public.attempts where user_id<>'{uid}'")).splitlines()[-1] == '0')
        rec('no page errors', not errors, errors)
        b.close()
finally:
    srv.terminate(); F.stop()
json.dump(results, open(OUT + '/c2_results.json', 'w'), indent=1, ensure_ascii=False)
print('TOTAL', len(results), 'FAIL', sum(1 for r in results if r[1] == 'FAIL'))
