"""V2.11.0 Admin Studio end-to-end on the fake server (real schema V1+V2 + RLS):
login, import → Draft, students don't see drafts, publish, re-import keeps status, unpublish,
non-admin blocked, studio never writes the phone's app data, student menu hides admin tools."""
import os, sys, shutil, subprocess
from playwright.sync_api import sync_playwright
import fake_supabase as F
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
res = []
def rec(n, ok, d=''): res.append(ok); print('PASS' if ok else 'FAIL', n, str(d)[:300])
def db(sql): o = F.psql_raw(sql); return o.splitlines()[-1] if o else ''

def blk(no, topic='Studio Topic', text=None, **kw):
    f = dict(SOURCE_QUESTION_NO=no, EXAM_NAME='SSC CGL', YEAR='2023', SUBJECT='Maths', CHAPTER='Arithmetic', TOPIC=topic,
             QUESTION_EN=text or f'Studio question {no}: {no} x 2 = ?', A_EN=str(no * 2), B_EN=str(no * 2 + 1), C_EN=str(no * 2 + 2), D_EN=str(no * 2 + 3), ANSWER='A')
    f.update(kw)
    return '=== QUESTION START ===\n' + '\n'.join(f'{k}: {v}' for k, v in f.items() if v is not None) + '\n=== QUESTION END ===\n'
FILE1 = ''.join(blk(i) for i in range(1, 7))
FILE2 = ''.join(blk(i, text='Studio question 3 (fixed): 3 x 2 = ?' if i == 3 else None) for i in range(1, 7))

site = '/tmp/site_mtb_studio'; shutil.rmtree(site, ignore_errors=True)
shutil.copytree(os.environ.get('MTB_SITE', os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))), site + '/AlphaTestbookapp', ignore=shutil.ignore_patterns('.git', 'dev'))
srv = subprocess.Popen(['python3', '-m', 'http.server', '8767', '--bind', '127.0.0.1'], cwd=site, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
APP = 'http://127.0.0.1:8767/AlphaTestbookapp/'; STUDIO = APP + 'admin/'
F.start(F.SCHEMA_V1, F.SCHEMA_V2, F.SCHEMA_V3); fake = F.Fake()
try:
    with sync_playwright() as p:
        b = p.chromium.launch(); errors = []
        def ctx_new():
            c = b.new_context(viewport={'width': 390, 'height': 844}, service_workers='block'); c.route(F.URL + '/**', fake.handle); return c
        def page(c, url, sel):
            pg = c.new_page(); pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('dialog', lambda d: d.accept())
            pg.goto(url); pg.wait_for_selector(sel, timeout=20000); return pg
        def settle(pg): pg.wait_for_function("!Studio.busy && !Studio.review.loading", timeout=30000); pg.wait_for_timeout(150)

        # ---- admin opens the Studio ----
        fake.google_user = F.ADMIN
        ac = ctx_new(); st = page(ac, STUDIO, '#studioRoot')
        rec('studio shows login first', 'Google से login करें' in st.inner_text('#studioRoot'))
        rec('student app shell hidden in studio', st.evaluate("getComputedStyle(document.getElementById('mainView')).display") == 'none')
        st.click('a.st-btn.primary'); st.wait_for_function("ServerState.isAdmin===true && Studio.loadedAt>0", timeout=20000); settle(st)
        rec('Google login returns to studio as admin', 'access_token' not in st.url and 'Admin Studio' in st.inner_text('.st-head'))
        rec('home shows zero questions', st.locator('.st-stat.draft b').inner_text() == '0' and st.locator('.st-stat.published b').inner_text() == '0')

        # ---- import → Draft ----
        st.click('.st-tabs button:has-text("Import")')
        st.set_input_files('#stFile', files=[{'name': 'studio.txt', 'mimeType': 'text/plain', 'buffer': FILE1.encode()}])
        rec('chosen file name shown', 'studio.txt' in st.inner_text('.st-file'))
        st.click('button:has-text("जाँचें")'); settle(st)
        rec('plan: 6 new', st.evaluate("Studio.imp.plan && Studio.imp.plan.fresh.length") == 6, st.inner_text('#studioRoot')[:300])
        st.screenshot(path=OUT + '/studio_import.png', full_page=True)
        st.click('button:has-text("Server पर भेजें")'); settle(st)
        rec('6 questions on server as draft', db("select count(*) from public.questions where status='draft'") == '6')
        rec('after send, review opens on drafts', st.evaluate("Studio.tab") == 'review' or 'Review' in st.evaluate("Studio.msg"), st.evaluate("Studio.msg"))
        rec('studio wrote nothing to the phone app storage', st.evaluate("AppModules.length===0 && ImportHistory.length===0"))
        dbs = st.evaluate("indexedDB.databases ? indexedDB.databases().then(d=>d.map(x=>x.name)) : []")
        rec('no IndexedDB created by studio', not dbs, dbs)

        # ---- student does not see drafts ----
        fake.google_user = F.STUDENT
        sc = ctx_new(); sp = page(sc, APP, '.sj-dash')
        sp.locator('.cl-prompt').click(); sp.locator('.cl-google').click(); sp.wait_for_selector('.sj-dash', timeout=15000)
        sp.wait_for_function("ServerState.session && CloudState.isAdmin===false && !CloudState.busy", timeout=20000); sp.wait_for_timeout(300)
        rec('student gets 0 server questions while all are draft', sp.evaluate("CloudState.serverQuestions") == 0, sp.evaluate("CloudState.serverQuestions"))
        sp.evaluate("closeModal()"); sp.click('#btnMenu'); sp.wait_for_timeout(200)
        rec('student menu hides Import / Cleanup / Server / Studio', sp.locator('#sideDrawer .admin-only:visible').count() == 0)
        rec('student menu keeps Backup and Health', sp.locator('#sideDrawer .drawer-item:visible', has_text='Backup').count() == 1 and sp.locator('#sideDrawer .drawer-item:visible', has_text='Health').count() == 1)

        # ---- review: one reviewed, publish all ----
        st.click('.st-tabs button:has-text("Review")'); settle(st)
        if st.evaluate("!Studio.review.rows.length"): st.evaluate("studioPickTopic(Studio.topics[0].id)"); settle(st)
        rec('review lists 6 draft cards with answer marked', st.locator('.st-q.draft').count() == 6 and st.locator('.st-q.draft .st-opts li.ok').count() == 6)
        st.screenshot(path=OUT + '/studio_review.png', full_page=True)
        st.locator('.st-q.draft').first.locator('button:has-text("Reviewed")').click(); settle(st)
        rec('single question → reviewed (stamped)', db("select count(*) from public.questions where status='reviewed' and reviewed_at is not null") == '1')
        st.click('.st-bulk button:has-text("सब Publish")'); settle(st)
        rec('bulk publish drafts (5)', db("select count(*) from public.questions where status='published'") == '5')
        st.evaluate("Studio.review.filter='reviewed';studioPaint()"); st.click('.st-bulk button:has-text("सब Publish")'); settle(st)
        rec('all 6 published', db("select count(*) from public.questions where status='published' and published_at is not null") == '6')
        sp.evaluate("cloudSync('manual')"); sp.wait_for_function("!CloudState.busy", timeout=20000); sp.wait_for_timeout(300)
        rec('student now gets the 6 published', sp.evaluate("CloudState.serverQuestions") == 6, sp.evaluate("CloudState.serverQuestions"))

        # ---- re-import with one fix: same IDs, 1 changed, status kept ----
        st.click('.st-tabs button:has-text("Import")')
        st.set_input_files('#stFile', files=[{'name': 'studio-v2.txt', 'mimeType': 'text/plain', 'buffer': FILE2.encode()}])
        st.click('button:has-text("जाँचें")'); settle(st)
        pl = st.evaluate("Studio.imp.plan && [Studio.imp.plan.fresh.length, Studio.imp.plan.changed.length, Studio.imp.plan.same]")
        rec('re-import: 0 new, 1 changed, 5 same', pl == [0, 1, 5], pl)
        st.click('button:has-text("Server पर भेजें")'); settle(st)
        rec('fix saved, still published', db("select status from public.questions where question_en like '%fixed%'") == 'published')
        rec('still 6 questions (no duplicates)', db("select count(*) from public.questions") == '6')

        # ---- unpublish one → student loses it ----
        st.evaluate("Studio.review.filter='published';studioPaint()"); settle(st)
        if st.evaluate("!Studio.review.rows.length"): st.evaluate("studioLoadTopic(Studio.review.topicId)"); settle(st)
        st.locator('.st-q.published').first.locator('button:has-text("Draft")').click(); settle(st)
        rec('one back to draft', db("select count(*) from public.questions where status='draft'") == '1')
        sp.evaluate("cloudSync('manual')"); sp.wait_for_function("!CloudState.busy", timeout=20000); sp.wait_for_timeout(300)
        rec('student now has 5', sp.evaluate("CloudState.serverQuestions") == 5)

        # ---- file with mistakes is stopped ----
        st.click('.st-tabs button:has-text("Import")')
        st.set_input_files('#stFile', files=[{'name': 'bad.txt', 'mimeType': 'text/plain', 'buffer': (blk(1, topic='Bad', ANSWER='Z') + blk(2, topic='Bad', YEAR=None)).encode()}])
        st.click('button:has-text("जाँचें")'); settle(st)
        rec('bad file: errors shown, no send button', 'गलती' in st.inner_text('#studioRoot') and st.locator('button:has-text("Server पर भेजें")').count() == 0)
        st.set_input_files('#stFile', files=[{'name': 'noyear.txt', 'mimeType': 'text/plain', 'buffer': ''.join(blk(i, topic='Defaults', YEAR=None) for i in range(1, 3)).encode()}])
        st.fill('#impDef_YEAR', '2021'); st.click('button:has-text("जाँचें")'); settle(st)
        rec('defaults box works in studio', st.evaluate("Studio.imp.plan && Studio.imp.plan.fresh.length") == 2)
        ov = st.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        rec('studio fits 390px (no sideways scroll)', ov <= 1, ov)

        # ---- home counts ----
        st.click('.st-tabs button:has-text("सारांश")'); st.evaluate("studioLoad()"); settle(st)
        rec('home counts draft 1 / published 5', st.locator('.st-stat.draft b').inner_text() == '1' and st.locator('.st-stat.published b').inner_text() == '5')
        st.screenshot(path=OUT + '/studio_home.png', full_page=True)

        # ---- admin in the student app sees the Studio link ----
        ap = page(ac, APP, '.sj-dash'); ap.wait_for_function("CloudState.isAdmin===true", timeout=20000)
        ap.click('#btnMenu'); ap.wait_for_timeout(200)
        rec('admin menu shows Admin Studio, Control Room + tools', ap.locator('#drwStudio:visible').count() == 1 and ap.locator('#drwControl:visible').count() == 1 and ap.locator('#sideDrawer .admin-only:visible').count() == 5)

        # ---- a student opening the studio is refused ----
        s2 = page(sc, STUDIO, '#studioRoot'); s2.wait_for_function("ServerState.isAdmin===false", timeout=20000); s2.wait_for_timeout(200)
        rec('student blocked from studio', 'अनुमति नहीं' in s2.inner_text('#studioRoot'))
        rec('no page errors', not errors, errors[:3])
        b.close()
finally:
    srv.terminate(); F.stop()
print(f'{sum(res)}/{len(res)} passed'); sys.exit(0 if all(res) else 1)
