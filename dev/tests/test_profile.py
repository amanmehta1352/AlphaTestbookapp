"""Qualification-first flow: qualification → branch → Exam Hub → selected exam and branch-scoped published content.
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
        st.wait_for_function("ServerState.session && ServerState.session.user_id", timeout=15000)
        st.wait_for_selector('.qualification-setup', timeout=15000); idle()
        rec('login opens required qualification step first', st.locator('.qualification-setup').count() == 1)
        rec('qualification page keeps the existing app shell', st.locator('#appHeader').count() == 1 and st.locator('#bottomNav').count() == 1)
        rec('profile index knows SSC JE branch content', st.evaluate("Object.keys(CloudState.profileIndex['ssc-je'].branches).sort().join()") == 'civil,electrical,mechanical')
        st.locator('[data-qf-level="diploma"]').click()
        st.wait_for_function("QualificationDraft.level==='diploma'")
        rec('Diploma offers Mechanical and other available branch choices', st.locator('[data-qf-branch="mechanical"]').count() == 1 and st.locator('[data-qf-branch="civil"]').count() == 1)
        st.locator('[data-qf-branch="mechanical"]').click()
        rec('Mechanical branch is selected', st.evaluate("QualificationDraft.branch") == 'mechanical')
        rec('save is enabled for a valid qualification and branch', st.locator('#qualificationSave').is_enabled())
        st.screenshot(path=OUT + '/qualification_setup.png')
        st.locator('#qualificationSave').click(); st.wait_for_selector('.exam-hub-page', timeout=15000); idle()
        visible = st.locator('[data-exam-id]').evaluate_all("els=>els.map(e=>e.getAttribute('data-exam-id')).sort()")
        rec('Exam Hub hides exams with no Mechanical question coverage', visible == ['ssc-je'], visible)
        rec('Exam Hub identifies branch-filtered results', 'Matching Exam Frameworks' in st.inner_text('.section-title'))
        st.locator('[data-exam-id="ssc-je"]').click()
        st.wait_for_function("Route.page==='exam_profile' && UserState.studentProfile?.examId==='ssc-je'", timeout=15000); idle()
        rec('selected exam and qualification saved together', st.evaluate("UserState.studentProfile.qualification==='diploma' && UserState.studentProfile.branch==='mechanical'"))
        rec('Mechanical student receives Mechanical + common subjects only', subjects() == ['general-awareness', 'mechanical-engineering'], subjects())
        rec('Civil/Electrical question records are not loaded', st.evaluate("[...IndexEngine.registry.values()].filter(q=>/civil|electrical/.test(q.metadata?.subject||'')).length") == 0)
        rec('questions from other exams are not mixed into the selected exam', st.evaluate("AppModules.filter(m=>m.source==='server').flatMap(m=>m.groups.flatMap(g=>g.questions)).every(q=>q.metadata?.examId==='ssc-je')"))
        st.evaluate("navigate('home')"); st.wait_for_selector('.sj-dash', timeout=15000)
        rec('Home qualification chip names Diploma and Mechanical', 'Diploma' in st.inner_text('.pf-chip') and 'Mechanical' in st.inner_text('.pf-chip'), st.inner_text('.pf-chip') if st.locator('.pf-chip').count() else '')
        rec('existing header and bottom navigation remain available', st.locator('#appHeader').count() == 1 and st.locator('#bottomNav').count() == 1)
        st.screenshot(path=OUT + '/profile_home.png')
        st.reload(); st.wait_for_selector('.sj-dash', timeout=15000); idle()
        rec('qualification + selected exam persist after reload', st.evaluate("UserState.studentQualification?.level==='diploma' && UserState.studentProfile?.branch==='mechanical'") and subjects() == ['general-awareness', 'mechanical-engineering'], subjects())
        rec('no page errors', not errors, errors)
        b.close()
finally:
    srv.terminate(); F.stop()
json.dump(results, open(OUT + '/profile_results.json', 'w'), indent=1, ensure_ascii=False)
print('TOTAL', len(results), 'FAIL', sum(1 for r in results if r[1] == 'FAIL'))
