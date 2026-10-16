"""V3 student profile: exam + branch → only that track's server questions reach the phone.
Usage: python3 test_profile.py OUTDIR"""
import os, sys, json, subprocess, shutil
from playwright.sync_api import sync_playwright
import fake_supabase as F
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
results = []
def rec(name, ok, detail=''):
    results.append((name, 'PASS' if ok else 'FAIL', str(detail)[:260])); print('PASS' if ok else 'FAIL', name, str(detail)[:260])
site = '/tmp/site_mtb_profile'; shutil.rmtree(site, ignore_errors=True)
shutil.copytree(os.environ.get('MTB_SITE', os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))), site + '/AlphaTestbookapp', ignore=shutil.ignore_patterns('.git', 'dev'))
srv = subprocess.Popen(['python3', '-m', 'http.server', '8768', '--bind', '127.0.0.1'], cwd=site, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
APP = 'http://127.0.0.1:8768/AlphaTestbookapp/'
F.start(F.SCHEMA_V1, F.SCHEMA_V2, F.SCHEMA_V3); fake = F.Fake()

def seed():
    sql = ["insert into public.exams(id,name) values ('ssc-je','SSC JE'),('rrb-ntpc','RRB NTPC');"]
    plan = [('ssc-je', 'civil-engineering', 'Soil Mechanics', 6), ('ssc-je', 'mechanical-engineering', 'Thermodynamics', 5),
            ('ssc-je', 'electrical-engineering', 'Transformers', 4), ('ssc-je', 'general-awareness', 'Polity', 3), ('rrb-ntpc', 'maths', 'Percentage', 2)]
    for ex, subj, topic, n in plan:
        tid = f"{subj}-{topic.lower()}-class-test"
        sql.append(f"insert into public.topics(id,workspace,subject,chapter,title,exam_id) values ({F.q(tid)},'competitive',{F.q(subj)},{F.q(topic)},{F.q(topic)},{F.q(ex)}) on conflict do nothing;")
        for i in range(1, n + 1):
            opts = json.dumps([{'letter': L, 'en': f'opt {L}', 'hi': ''} for L in 'ABCD'])
            sql.append(f"insert into public.questions(id,topic_id,workspace,exam_id,subject,chapter,topic,question_no,format,question_en,options,answer,source_type,content_hash,status,is_active) values "
                       f"({F.q(f'Q-{ex}-{subj}-{i}')},{F.q(tid)},'competitive',{F.q(ex)},{F.q(subj)},{F.q(topic)},{F.q(topic)},{i},'MCQ',{F.q(f'{topic} question {i}?')},{F.q(opts)}::jsonb,'A','PYQ','h{i}','published',true);")
    F.psql_raw('\n'.join(sql))

try:
    seed()
    with sync_playwright() as p:
        b = p.chromium.launch(); errors = []
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, service_workers='block'); ctx.route(F.URL + '/**', fake.handle)
        st = ctx.new_page(); st.on('pageerror', lambda e: errors.append(str(e))); st.on('dialog', lambda d: d.accept())
        st.goto(APP); st.wait_for_selector('.sj-dash', timeout=15000)
        def idle(): st.wait_for_function("!CloudState.busy && !CloudSyncRunning", timeout=30000); st.wait_for_timeout(200)
        def subjects(): return sorted(set(st.evaluate("AppModules.filter(m=>m.source==='server').map(m=>m.subject)")))
        fake.google_user = F.STUDENT
        st.locator('.cl-prompt').click(); st.locator('.cl-google').click()
        st.wait_for_selector('.sj-dash', timeout=15000); st.wait_for_function("ServerState.session && ServerState.session.user_id", timeout=10000); idle()
        st.evaluate("closeModal(); navigate('home')"); st.wait_for_timeout(200)
        rec('no profile yet: every server question arrives (old behaviour)', st.evaluate("CloudState.serverQuestions") == 20 and len(subjects()) == 5, subjects())
        rec('home shows a gentle "choose your exam and branch" card', st.locator('.pf-prompt').count() == 1)
        rec('profile index knows exams and SSC JE branches', st.evaluate("Object.keys(CloudState.profileIndex['ssc-je'].branches).sort().join()") == 'civil,electrical,mechanical')
        st.locator('.pf-prompt').click(); st.wait_for_selector('#pfSheet .pf-opt')
        rec('sheet lists exams, biggest first', st.locator('#pfSheet .pf-opt').first.inner_text().startswith('SSC JE'))
        rec('save is disabled until branch chosen', (st.locator('#pfSheet .pf-opt').first.click() or True) and st.locator('#pfSheet .gx-btn').first.is_disabled())
        st.locator('#pfSheet .pf-opt', has_text='Civil').click()
        rec('sheet fits a 360px phone', (st.set_viewport_size({'width': 360, 'height': 800}) or True) and st.evaluate("document.getElementById('modalSheet').scrollWidth<=document.getElementById('modalSheet').clientWidth+1"))
        st.screenshot(path=OUT + '/profile_sheet.png')
        st.locator('#pfSheet .gx-btn').first.click(); idle(); st.wait_for_timeout(300)
        rec('Civil student gets only Civil + common subjects', subjects() == ['civil-engineering', 'general-awareness'], subjects())
        rec('no Mechanical/Electrical question anywhere on the phone', st.evaluate("[...IndexEngine.registry.values()].filter(q=>/mechanical|electrical/.test(q.metadata?.subject||'')).length") == 0)
        rec('other exam (RRB) not mixed in', st.evaluate("AppModules.filter(m=>m.source==='server').flatMap(m=>m.groups.flatMap(g=>g.questions)).filter(q=>q.metadata?.examId!=='ssc-je').length") == 0)
        rec('selected exam follows the profile', st.evaluate("UserState.selectedExam") == 'ssc-je')
        rec('home chip shows "SSC JE · Civil"', 'SSC JE · Civil' in st.inner_text('.pf-chip') and st.locator('.pf-prompt').count() == 0, st.inner_text('.pf-chip') if st.locator('.pf-chip').count() else '')
        rec('home counts only the chosen track (demo topics hidden)', st.evaluate("sjCollectDashboardData().modules.every(m=>m.source==='server')") and st.evaluate("sjCollectDashboardData().totalQuestions") == 9)
        st.screenshot(path=OUT + '/profile_home.png')
        st.reload(); st.wait_for_selector('.sj-dash', timeout=15000); idle()
        rec('profile survives reload', st.evaluate("UserState.studentProfile && UserState.studentProfile.branch") == 'civil' and subjects() == ['civil-engineering', 'general-awareness'])
        st.locator('.pf-chip').click(); st.wait_for_selector('#pfSheet .pf-opt'); st.locator('#pfSheet .gx-btn.ghost').click(); idle(); st.wait_for_timeout(300)
        rec('"show everything" brings all subjects back', len(subjects()) == 5 and st.evaluate("UserState.studentProfile") is None, subjects())
        rec('no page errors', not errors, errors)
        b.close()
finally:
    srv.terminate(); F.stop()
json.dump(results, open(OUT + '/profile_results.json', 'w'), indent=1, ensure_ascii=False)
print('TOTAL', len(results), 'FAIL', sum(1 for r in results if r[1] == 'FAIL'))
