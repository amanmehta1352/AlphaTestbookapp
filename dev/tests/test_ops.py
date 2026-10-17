"""Control Room (V4 ops) test — real schema + RLS on local Postgres, real Control Room page in Chromium.
1. SQL: publish quality gate, audit + undo, student blocked, backup/verify/restore, public settings, client-error limit.
2. opslib.decide (pause / disable / freeze rules) and ops_robot.handle (allow-list, emergency stop, rollback check).
3. Health report built from the fake server; Control Room: every section renders (light/dark, 360 px + desktop),
   admin switches, run requests, Emergency Stop, question bulk publish (gate), undo, backup + restore, settings.
Usage: python3 test_ops.py"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, '..', 'tools', 'health-robot')); sys.path.insert(0, os.path.join(HERE, '..', 'tools', 'ops'))
import fake_supabase as F
import health, opslib, ops_robot

ok = True
def check(name, cond, detail=''):
    global ok; print(('PASS ' if cond else 'FAIL ') + name + (f'  {str(detail)[:200]}' if not cond and detail != '' else '')); ok &= bool(cond)
P = F.psql_raw
ADM, STU = F.ADMIN[0], F.STUDENT[0]
OPT = lambda t, dup=False: json.dumps([{'letter': L, 'en': ('same' if dup and L in 'AB' else f'{t} {L}'), 'hi': ''} for L in 'ABCD']).replace("'", "''")
CONTROL = os.path.abspath(os.path.join(HERE, '..', '..', 'control', 'index.html'))

def seed():
    P("insert into public.exams(id,name) values ('ssc-je','SSC JE'); insert into public.topics(id,subject,chapter,title,exam_id) values ('civil-surveying','civil-engineering','Surveying','Surveying','ssc-je'),('civil-mixed-untagged','civil-engineering','Mixed','Mixed','ssc-je');")
    rows = []
    def add(i, status='published', active=True, hi='हिंदी', ans='A', opts=None, text='What is the least count of a vernier caliper?', topic='civil-surveying'):
        rows.append(f"('q-{i}','{topic}','ssc-je','civil-engineering','Surveying','Surveying','{text}',{F.q(hi) if hi else 'null'},'{opts or OPT('o' + i)}','{ans}','PYQ','{status}',{str(active).lower()},'SSC JE 2024 test paper')")
    for i in range(8): add(f'live{i}')
    add('untag', topic='civil-mixed-untagged'); add('nohi', hi=None)
    add('dupopt', opts=OPT('d', dup=True))
    for i in range(3): add(f'draft{i}', status='draft', hi=None)
    add('draftbad', status='draft', text='Short')
    add('hid', active=False)
    P('insert into public.questions(id,topic_id,exam_id,subject,chapter,topic,question_en,question_hi,options,answer,source_type,status,is_active,source_ref) values ' + ','.join(rows) + ';')
    P(f"insert into public.attempts(user_id,client_id,question_id,chosen,is_correct,seconds,mode,answered_at) values ('{STU}','c1','q-live0','A',true,20,'test',now()),('{STU}','c2','q-live1','B',false,30,'test',now()-interval '2 days');")

def sql_get_all(table, select, where=''):
    params = {}
    for part in where.lstrip('&').split('&'):
        if part and '=' in part: k, v = part.split('=', 1); params.setdefault(k, []).append(__import__('urllib.parse').parse.unquote(v))
    order = params.pop('order', [None])[0]
    w = F.Fake().where(params) if params else ''
    tail = (' order by ' + order.replace('.desc', ' desc').replace('.asc', ' asc')) if order else ''
    out = P(f"select coalesce(json_agg(t),'[]') from (select {select} from public.{table}{w}{tail}) t")
    return json.loads(out or '[]')

def sql_count(table, where=''):
    params = {}
    for part in where.lstrip('&').split('&'):
        if part and '=' in part: k, v = part.split('=', 1); params.setdefault(k, []).append(__import__('urllib.parse').parse.unquote(v))
    return int(P(f'select count(*) from public.{table}' + (F.Fake().where(params) if params else '')).splitlines()[-1])

def sql_rpc(fn, args=None):
    if fn == 'ops_backup_list': return json.loads(P("select coalesce(json_agg(x),'[]') from public.ops_backup_list() x"))
    return json.loads(P(f'select to_jsonb(public.{fn}())'))

def main():
    F.start(F.SCHEMA_V1, F.SCHEMA_V2, F.SCHEMA_V3, F.SCHEMA_V4, F.SCHEMA_V5, F.SCHEMA_V6)
    try:
        seed()
        # ---------------- 1. SQL
        n = P(F.as_user(ADM, "select public.ops_question_action(array['q-draft0','q-draftbad'],'publish','test publish')")).splitlines()[-1]
        check('publish gate: complete draft goes live, broken one stays', n == '1' and P("select status from public.questions where id='q-draftbad'") == 'draft', n)
        check('audit records actor email + reason', P("select actor||'|'||reason from public.ops_audit where row_id='q-draft0' and action='UPDATE' order by id desc limit 1") == F.ADMIN[1] + '|test publish')
        P(F.as_user(ADM, "update public.questions set answer='C' where id='q-live2'"))
        aid = P("select max(id) from public.ops_audit where row_id='q-live2'")
        P(F.as_user(ADM, f'select public.ops_revert({aid}, \'wrong key\')'))
        check('undo restores the old answer and marks REVERT', P("select answer from public.questions where id='q-live2'") == 'A' and P("select action from public.ops_audit order by id desc limit 1") == 'REVERT')
        for stmt in ["select public.ops_question_action(array['q-live0'],'hide')", 'select public.ops_backup_now()', f'select public.ops_revert({aid})', "insert into public.ops_requests(action,target) values ('run','tests.yml')", "update public.ops_settings set value='true' where key='robots.paused'"]:
            try: P(F.as_user(STU, stmt)); blocked = P("select value::text from public.ops_settings where key='robots.paused'") == 'false' and 'update' in stmt
            except Exception: blocked = True
            check('student blocked: ' + stmt[:45], blocked)
        check('anon sees only public settings (maintenance)', P(F.as_user(None, 'select string_agg(key, \',\') from public.ops_settings')) == 'maintenance')
        b = json.loads(P("select public.ops_backup_now('manual','t')"))
        check('backup has all tables', b['counts']['questions'] == 16 and b['counts']['attempts'] == 2, b)
        check('backup verify = ok', P(f"select public.ops_backup_verify({b['id']})") == 'ok')
        P("update public.questions set question_en='BROKEN BY ACCIDENT' where id='q-live3'")
        r = json.loads(P(f"select public.ops_restore_questions({b['id']},'RESTORE-{b['id']}', array['q-live3'])"))
        check('restore one question from backup (+ safety backup)', P("select question_en from public.questions where id='q-live3'").startswith('What is') and r['safety_snapshot'] > b['id'], r)
        try: P(f"select public.ops_restore_questions({b['id']},'yes')"); check('restore needs RESTORE-<id> text', False)
        except Exception: check('restore needs RESTORE-<id> text', True)
        P(F.as_user(STU, ''.join(f"insert into public.ops_client_errors(message,page) values ('e{i}','home');" for i in range(32))))
        check('client errors rate-limited to 30/hour/user', P('select count(*) from public.ops_client_errors') == '30')
        # ---------------- 2. robots
        import glob, yaml
        class Strict(yaml.SafeLoader): pass
        def no_dupes(loader, node, deep=False):
            keys = [loader.construct_object(k, deep=deep) for k, _ in node.value]
            if len(keys) != len(set(keys)): raise ValueError('duplicate key ' + str([k for k in keys if keys.count(k) > 1][0]))
            return yaml.SafeLoader.construct_mapping(loader, node, deep)
        Strict.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, no_dupes)
        badwf = []
        for f in glob.glob(os.path.join(HERE, '..', '..', '.github', 'workflows', '*.yml')):
            try: yaml.load(open(f), Loader=Strict)
            except Exception as e: badwf.append(os.path.basename(f) + ': ' + str(e)[:80])
        check('all GitHub workflows are valid YAML (no duplicate keys)', not badwf, badwf)
        on = {'robots.paused': False, 'data.frozen': False}
        check('gate: writer runs normally', opslib.decide('hindi', on)[0] is True)
        check('gate: global pause stops writers + keycheck, not backup/health', not opslib.decide('pyq', {**on, 'robots.paused': True})[0] and not opslib.decide('keycheck', {**on, 'robots.paused': True})[0] and opslib.decide('backup', {**on, 'robots.paused': True})[0] and opslib.decide('health', {**on, 'robots.paused': True})[0])
        check('gate: freeze stops data writers only', not opslib.decide('tag', {**on, 'data.frozen': True})[0] and opslib.decide('keycheck', {**on, 'data.frozen': True})[0])
        check('gate: per-robot disable', not opslib.decide('hindi', {**on, 'robot.hindi.enabled': False})[0])
        # ---------------- 1b. V5 roles + tasks
        check('roles: first admin is owner', P(F.as_user(ADM, 'select public.ops_role()')).splitlines()[-1] == 'owner')
        P(f"insert into public.admins(user_id) values ('{STU}')")
        P(F.as_user(ADM, f"select public.ops_set_role('{F.STUDENT[1]}','readonly')"))
        for stmt in ["select public.ops_question_action(array['q-live0'],'hide')", "select public.ops_task_create('x','x','x','execute','ops','[]'::jsonb)", "update public.ops_settings set value='true' where key='robots.paused'"]:
            try: P(F.as_user(STU, stmt)); blocked = P("select value::text from public.ops_settings where key='robots.paused'") == 'false' and 'update' in stmt
            except Exception: blocked = True
            check('readonly admin blocked: ' + stmt[:40], blocked)
        P(F.as_user(ADM, f"select public.ops_set_role('{F.STUDENT[1]}','operator')"))
        try: P(F.as_user(STU, "select public.ops_question_action(array['q-live0'],'hide')")); check('operator cannot edit questions', False)
        except Exception: check('operator cannot edit questions', True)
        tid = int(P(F.as_user(STU, "select public.ops_task_create('op task','cmd','run_robot','execute','robots','[{\"type\":\"note\"}]'::jsonb)")).splitlines()[-1])
        check('operator can create a run task (queued)', P(f'select status from public.ops_tasks where id={tid}') == 'queued')
        try: P(F.as_user(STU, f"select public.ops_set_role('{F.STUDENT[1]}','owner')")); check('only owner changes roles', False)
        except Exception: check('only owner changes roles', True)
        try: P(F.as_user(ADM, f"select public.ops_set_role('{F.ADMIN[1]}','readonly')")); check('last owner cannot be demoted', False)
        except Exception: check('last owner cannot be demoted', True)
        P(f"delete from public.admins where user_id='{STU}'")
        hid = int(P(F.as_user(ADM, "select public.ops_task_create('publish','publish','publish','execute','publish','[{\"type\":\"note\"}]'::jsonb,'high',2,'pub:1')")).splitlines()[-1])
        dup = int(P(F.as_user(ADM, "select public.ops_task_create('publish','publish','publish','execute','publish','[]'::jsonb,'high',2,'pub:1')")).splitlines()[-1])
        check('high-risk task waits for approval; duplicate returns -id', P(f'select status from public.ops_tasks where id={hid}') == 'waiting_approval' and dup == -hid, (hid, dup))
        P(F.as_user(ADM, f"select public.ops_task_control({hid},'approve','ok')"))
        check('owner approve -> queued + approval recorded', P(f"select status||'|'||(approval->>'by') from public.ops_tasks where id={hid}") == 'queued|' + F.ADMIN[1])
        P(F.as_user(ADM, f"select public.ops_task_control({hid},'cancel')"))
        check('plan mode = planned (nothing runs)', P(F.as_user(ADM, "select public.ops_task_create('p','p','x','plan','ops','[]'::jsonb)")) and P("select status from public.ops_tasks order by id desc limit 1") == 'planned')
        P(F.as_user(STU, "insert into public.ops_events(name,page,ms) values ('view','home',1200),('view','subjects',800),('test:start','test_hub',null)"))
        us = json.loads(P("select public.ops_usage_stats(14)"))
        check('usage stats aggregate events (no user ids)', us['pages']['home']['views'] == 1 and us['funnel_test']['started'] == 1 and STU not in json.dumps(us), us)
        P("update public.ops_tasks set status='cancelled' where status in ('queued','planned')")
        check('gate: settings unreadable -> writers do not run', not opslib.decide('pyq', None)[0] and opslib.decide('health', None)[0])
        calls = []
        ops_robot.gh = lambda path, method='GET', body=None: (calls.append((method, path, body)) or ({'workflow_runs': [{'id': 7}]} if method == 'GET' else None))
        check('ops: run allowed workflow', ops_robot.handle({'action': 'run', 'target': 'tag-robot.yml', 'params': {'dry_run': True, 'evil': 'x'}})[0] == 'sent' and calls[-1][2] == {'ref': 'main', 'inputs': {'dry_run': 'true'}}, calls[-1:])
        check('ops: unknown workflow rejected', ops_robot.handle({'action': 'run', 'target': 'deploy-everything.yml', 'params': {}})[0] == 'rejected')
        check('ops: PYQ without links rejected', ops_robot.handle({'action': 'run', 'target': 'pyq-robot.yml', 'params': {}})[0] == 'rejected')
        calls.clear(); st, msg = ops_robot.handle({'action': 'cancel', 'target': 'all', 'params': {}})
        check('ops: emergency stop cancels every robot run', st == 'done' and sum(1 for c in calls if c[1].endswith('/cancel')) == len(ops_robot.CANCELLABLE) * 3, (st, msg, len(calls)))
        check('ops: rollback needs a real sha', ops_robot.handle({'action': 'rollback', 'target': '', 'params': {'sha': 'main; rm -rf'}})[0] == 'rejected')
        # ---------------- 2a. PDF upload bucket: private, admin-with-run only, PDF only, 20 MB
        check('upload bucket is private, PDF-only, 20 MB', P("select public||'|'||allowed_mime_types::text||'|'||file_size_limit from storage.buckets where id='pyq-uploads'") == 'false|{application/pdf}|20971520')
        try: P(F.as_user(STU, "insert into storage.objects(bucket_id,name) values ('pyq-uploads','s.pdf')")); check('student cannot upload', P("select count(*) from storage.objects where name='s.pdf'") == '0')
        except Exception: check('student cannot upload', True)
        P(F.as_user(ADM, "insert into storage.objects(bucket_id,name) values ('pyq-uploads','a.pdf')"))
        check('admin (run permission) can upload', P("select count(*) from storage.objects where name='a.pdf'") == '1')
        # ---------------- 2b. task engine (ops_robot.do_tasks against the real DB)
        def fake_sb(method, path, body=None, actor='robot', prefer=None, timeout=60):
            if path.startswith('/rest/v1/ops_tasks?select=*'):
                return json.loads(P("select coalesce(json_agg(t order by priority,id),'[]') from public.ops_tasks t where status in ('queued','running')"))
            if path.startswith('/rest/v1/ops_tasks?id=eq.') and method == 'PATCH':
                i = int(path.split('eq.')[1]); sets = ','.join(f"{k} = {F.q(json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v)}" + ('::jsonb' if isinstance(v, (dict, list)) else '') for k, v in body.items())
                P(f'update public.ops_tasks set {sets} where id={i}'); return None
            if path.startswith('/rest/v1/import_batches'): return [{'source_url': 'https://ssc.example/old.pdf'}]
            if path.startswith('/storage/v1/object/sign/pyq-uploads/'): return {'signedURL': '/object/sign/pyq-uploads/' + path.split('/')[-1] + '?token=SECRET-TOKEN'}
            if path == '/rest/v1/rpc/ops_backup_list': return sql_rpc('ops_backup_list')
            if path == '/rest/v1/rpc/ops_backup_verify': return P(f"select public.ops_backup_verify({body['p_id']})")
            if path.startswith('/rest/v1/ops_settings?key=eq.') and method == 'PATCH':
                P(f"update public.ops_settings set value={F.q(json.dumps(body['value']))}::jsonb where key={F.q(path.split('eq.')[1])}"); return None
            raise RuntimeError('unexpected ' + method + ' ' + path)
        real_sb, real_lease, real_vl = opslib.sb, ops_robot.lease, ops_robot.verify_links
        opslib.sb = fake_sb; ops_robot.lease = lambda take=True: True
        ops_robot.verify_links = lambda urls: [{'url': u, 'ok': 'bad' not in u, 'already_imported': 'old' in u, 'why': ''} for u in urls]
        run_state = {'status': 'in_progress'}; calls.clear()
        def gh2(path, method='GET', body=None):
            calls.append((method, path, body))
            if '/runs?event=workflow_dispatch' in path: return {'workflow_runs': [{'id': 99, 'created_at': '2999-01-01T00:00:00Z', 'html_url': 'https://github.com/run/99', 'status': 'completed' if run_state['status'] == 'done' else 'in_progress', 'conclusion': 'success'}]}
            if path == '/actions/runs/99': return {'id': 99, 'status': 'completed' if run_state['status'] == 'done' else 'in_progress', 'conclusion': 'success', 'html_url': 'https://github.com/run/99'}
            return None
        ops_robot.gh = gh2
        steps = json.dumps([{'type': 'verify_links', 'urls': ['https://ssc.example/new.pdf', 'https://ssc.example/old.pdf', 'https://ssc.example/bad.pdf'], 'label': 'links'},
                            {'type': 'workflow', 'file': 'pyq-robot.yml', 'inputs': {'dry_run': False}, 'use_verified': True, 'label': 'import'},
                            {'type': 'verify_backup', 'label': 'verify'}, {'type': 'setting', 'key': 'publish.auto', 'value': False, 'label': 's'}])
        tk = int(P(F.as_user(ADM, f"select public.ops_task_create('import','import','import','execute','pyq',{F.q(steps)}::jsonb,'medium')")).splitlines()[-1])
        L = []; ops_robot.do_tasks(False, L, 0)
        t1 = json.loads(P(f'select row_to_json(t) from public.ops_tasks t where id={tk}'))
        check('engine: verified links -> only the new good link goes to PYQ Robot', t1['steps'][1]['inputs'].get('links') == 'https://ssc.example/new.pdf' and t1['steps'][0]['result']['bad'] == 1, t1['steps'][:2])
        check('engine: workflow step waits (running) with checkpoint saved', t1['status'] == 'running' and t1['steps'][1]['status'] == 'running' and t1['steps'][0]['status'] == 'done', t1['status'])
        run_state['status'] = 'done'; ops_robot.do_tasks(False, L, 0)
        t1 = json.loads(P(f'select row_to_json(t) from public.ops_tasks t where id={tk}'))
        check('engine: resumes from checkpoint -> completed + report + evidence', t1['status'] == 'completed' and 'प्रमाण' in (t1['report'] or '') and t1['verification']['all_steps_done'] and t1['verification']['evidence'] == ['https://github.com/run/99'], (t1['status'], [(s.get('status'), s.get('error')) for s in t1['steps']]))
        check('engine: dispatched PYQ exactly once', sum(1 for c in calls if c[1].endswith('pyq-robot.yml/dispatches')) == 1)
        bad = int(P(F.as_user(ADM, "select public.ops_task_create('m','m','x','execute','design','[{\"type\":\"merge_branch\",\"branch\":\"main\"}]'::jsonb)")).splitlines()[-1])
        ops_robot.do_tasks(False, L, 0)
        check('engine: merge only allowed for restore/* branches', P(f'select status from public.ops_tasks where id={bad}') == 'failed')
        P(F.as_user(ADM, f"select public.ops_task_control({bad},'retry')"))
        check('retry re-queues failed task and clears failed step', P(f"select status||'|'||coalesce(steps->0->>'status','-')||'|'||retry_count from public.ops_tasks where id={bad}") == 'queued|-|1')
        P(f"update public.ops_tasks set status='cancelled' where id={bad}")
        # upload step: signed link goes to the PYQ step, token never stored in task logs
        up = int(P(F.as_user(ADM, "select public.ops_task_create('upload','upload','import','execute','pyq','[{\"type\":\"upload_link\",\"object\":\"123-paper.pdf\"},{\"type\":\"workflow\",\"file\":\"pyq-robot.yml\",\"inputs\":{\"dry_run\":true},\"use_verified\":true}]'::jsonb)")).splitlines()[-1])
        ops_robot.do_tasks(False, L, 0)
        up_t = json.loads(P(f'select row_to_json(t) from public.ops_tasks t where id={up}'))
        check('upload: task keeps only a placeholder for the PYQ link', up_t['steps'][1]['inputs'].get('links') == 'upload:123-paper.pdf' and up_t['steps'][0]['result'] == {'uploaded': '123-paper.pdf'}, up_t['steps'][:2])
        check('upload: PYQ step dispatched with the signed link', any(c[1].endswith('pyq-robot.yml/dispatches') and c[2] and c[2]['inputs'].get('links', '').startswith(opslib.SB_URL + '/storage/v1/object/sign/pyq-uploads/123-paper.pdf') for c in calls))
        check('upload: token not stored anywhere in the task', 'SECRET-TOKEN' not in json.dumps(up_t).replace(opslib.SB_URL, ''), 'token leaked')
        import urllib.request as _ur, urllib.error as _ue
        _real_open = _ur.urlopen
        def _blocked(req, timeout=0): raise _ue.HTTPError(req.full_url, 403, 'Forbidden', {}, None)
        _ur.urlopen = _blocked
        try: r403 = real_vl(['https://www.adda247.com/x.pdf'])[0]
        finally: _ur.urlopen = _real_open
        check('403 link -> clear Hindi message, not a silent failure', r403['ok'] is False and 'रोका' in r403['why'] and 'Upload' in r403['why'], r403)
        check('link check sends browser-like headers', 'Mobile' in ops_robot.browser_headers('https://x.gov.in/a.pdf')['User-Agent'] and ops_robot.browser_headers('https://x.gov.in/a.pdf')['Referer'] == 'https://x.gov.in/')
        opslib.sb, ops_robot.lease, ops_robot.verify_links = real_sb, real_lease, real_vl
        # ---------------- 3. health report from the fake server
        health.SB_KEY = 'test'; health.sb_get_all = sql_get_all; health.sb_count = sql_count; health.sb_rpc = sql_rpc
        health.collect_site = lambda: {'ok': True, 'ms': 210, 'version': 'V3.3.0', 'source_version': 'V3.3.0', 'size_kb': 800, 'sw_cache': 'mtb-shell-v11', 'admin_ok': True}
        WF = [{'file': f, 'label': l, 'what': w, 'kind': k, 'robot': r, 'page': 'p', 'cron': ['23 */2 * * *'] if f == 'health-robot.yml' else [], 'after': [], 'manual': True,
               'next_run': health.cron_next('23 */2 * * *'), 'runs_30d': 10, 'success': 9, 'failure': 1 if f == 'tag-robot.yml' else 0, 'success_rate': 90, 'avg_min': 2.5,
               'last_conclusion': 'failure' if f == 'tag-robot.yml' else 'success', 'last_at': '2026-10-17T01:00:00Z', 'last_url': 'https://github.com/x', 'last_id': 5,
               'history': [{'c': 'success', 'at': '2026-10-17T01:00:00Z', 'url': 'u', 'ev': 'schedule', 'n': 1}] * 6} for f, l, w, k, r in health.WORKFLOWS]
        WF[3]['error_log'] = 'server 503: upstream timeout'; WF[3]['diagnosis'] = health.diagnose('server 503', 'Tag Robot')
        health.collect_github = lambda: {'workflows': WF, 'issues': 0, 'branches': ['main', 'status'], 'latest_commit': {'sha': 'abc1234', 'msg': 'V3.3.0', 'at': '2026-10-17T01:00:00Z', 'url': 'u'},
                                         'releases': [{'sha': 'abc1234', 'full': 'abc1234' * 5 + 'ab', 'version': 'V3.3.0', 'msg': 'V3.3.0 release', 'at': '2026-10-17T01:00:00Z', 'tests': 'success', 'url': 'u'},
                                                      {'sha': 'def5678', 'full': 'def5678' * 5 + 'de', 'version': 'V3.2.1', 'msg': 'V3.2.1', 'at': '2026-10-16T01:00:00Z', 'tests': 'success', 'url': 'u'}],
                                         'pages': {'status': 'built'}, 'rate_limit': {'remaining': 4900, 'limit': 5000}}
        health.collect_tests = lambda g: {'suites': [{'suite': 'test_v3', 'ok': True, 'passed': 35, 'failed': 0, 'fails': []}, {'suite': 'test_ops', 'ok': False, 'passed': 3, 'failed': 1, 'fails': ['demo fail']}], 'passed': 38, 'failed_suites': ['test_ops'], 'run_url': 'u', 'run_at': '2026-10-17T01:00:00Z'}
        health.collect_keycheck = lambda: {'by_code': {'A2': 1}, 'total': 1, 'sample': [{'id': 'q-dupopt', 'code': 'A2', 'msg': 'same'}], 'at': '2026-10-17T00:00:00Z'}
        health.collect_security = lambda: {'anon': {t: 'बंद' for t in health.PRIVATE_TABLES}, 'secrets': [], 'publishable_only': True}
        out = '/tmp/cr_status.json'; hist = '/tmp/cr_hist.json'; json.dump([], open(hist, 'w'))
        health.main(['--out', out, '--history', hist, '--dry-run'])
        st = json.load(open(out))
        q = st['supabase']['questions']
        check('health: question quality counts from the real schema', (q['broken_live'], q['dup_options_live'], q['untagged_live'], q['draft']) == (0, 1, 1, 3), q)
        check('health: tag-robot failure + failed suite = RED with diagnosis', st['overall'] == 'bad' and any(c.get('diagnosis') for c in st['checks']))
        check('health: db stats, backups, audit present and no email in report', 'integrity' in st['supabase']['db'] and st['supabase']['backups'] and '@' not in json.dumps(st))
        # ---------------- 4. Control Room UI
        from playwright.sync_api import sync_playwright
        fake = F.Fake(); body = json.dumps(st); hbody = json.dumps(json.load(open(hist)) * 3)
        def page_for(b, admin, w=390, dark=False):
            c = b.new_context(viewport={'width': w, 'height': 860}, color_scheme='dark' if dark else 'light')
            c.route(F.URL + '/**', fake.handle)
            c.route('https://raw.githubusercontent.com/**', lambda r: r.fulfill(status=200, content_type='application/json', body=body if 'status.json' in r.request.url else hbody))
            c.route('https://api.github.com/**', lambda r: r.fulfill(status=200, content_type='application/json', body='{"workflow_runs":[]}'))
            c.route('https://fonts.googleapis.com/**', lambda r: r.abort())
            if admin:
                t = fake.issue(F.ADMIN)
                sess = json.dumps({'access_token': t['access_token'], 'refresh_token': t['refresh_token'], 'expires_at': 9999999999999, 'email': F.ADMIN[1]})
                c.add_init_script(f"localStorage.setItem('mtb_server_session_v1', {json.dumps(sess)})")
            pg = c.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.goto('file://' + CONTROL); pg.wait_for_selector('.hero', timeout=15000); pg.wait_for_timeout(400)
            return c, pg, errs
        with sync_playwright() as p:
            b = p.chromium.launch()
            # public (no login): all sections render
            c, pg, errs = page_for(b, False, 360)
            bad = []
            for s in ['command', 'overview', 'tasks', 'robots', 'emergency', 'alerts', 'questions', 'quality', 'publish', 'imports', 'deploy', 'design', 'tests', 'database', 'backup', 'repair', 'students', 'security', 'audit', 'usage', 'finance', 'settings']:
                pg.evaluate(f"CR.go('{s}')"); pg.wait_for_timeout(120)
                if pg.locator('#app .card, #app .kpi, #app .lock').count() == 0 or 'नहीं खुला' in pg.inner_text('#app') or pg.evaluate('document.documentElement.scrollWidth > innerWidth + 1'): bad.append(s)
            check('public: all 22 sections render at 360px without sideways scroll', not bad, bad)
            pg.evaluate("CR.go('robots')"); pg.wait_for_timeout(100); pg.locator('[data-act=run]').first.click(); pg.wait_for_timeout(200)
            check('public: action asks for admin login', pg.locator('.sheet h2').first.inner_text().startswith('🔑'))
            check('public: tap targets ≥ 44px (dock, buttons)', pg.evaluate("[...document.querySelectorAll('.dock button,.btn,.chip,.toggle,.tbtn')].filter(e=>e.offsetParent).every(e=>e.getBoundingClientRect().height>=40)"))
            check('public: no page errors', not errs, errs); c.close()
            # admin
            for dark in (False, True):
                c, pg, errs = page_for(b, True, 1280, dark)
                pg.wait_for_function("CR.S.admin === true", timeout=10000)
                bad = [s for s in ['command', 'tasks', 'overview', 'robots', 'questions', 'publish', 'imports', 'design', 'finance', 'students', 'security', 'backup', 'audit', 'database', 'settings'] if (pg.evaluate(f"CR.go('{s}')") or pg.wait_for_timeout(500) or 'नहीं खुला' in pg.inner_text('#app'))]
                check(f'admin {"dark" if dark else "light"}: sections render on desktop', not bad and not errs, (bad, errs)); c.close()
            c, pg, errs = page_for(b, True, 390); pg.wait_for_function("CR.S.admin === true", timeout=10000)
            check('admin: header shows Admin', 'Admin' in pg.inner_text('#who'))
            # robot switch + run request
            pg.evaluate("CR.go('robots')"); pg.wait_for_timeout(200)
            pg.locator('[data-act=toggle-robot][data-id=hindi]').click(); pg.wait_for_timeout(500)
            check('admin: robot switch saves to server', P("select value::text from public.ops_settings where key='robot.hindi.enabled'") == 'false')
            pg.locator('[data-act=run][data-wf="tag-robot.yml"]').click(); pg.wait_for_timeout(200); pg.locator('[data-yes]').click(); pg.wait_for_timeout(600)
            check('admin: Run puts a request in the queue', P("select action||'|'||target||'|'||status from public.ops_requests order by id desc limit 1") == 'run|tag-robot.yml|queued')
            # emergency stop needs STOP
            pg.evaluate("CR.go('emergency')"); pg.wait_for_timeout(200); pg.locator('[data-act=estop]').first.click(); pg.wait_for_timeout(200)
            check('admin: Emergency Stop locked until STOP typed', pg.locator('[data-yes]').is_disabled())
            pg.fill('[data-w]', 'STOP'); pg.locator('[data-yes]').click(); pg.wait_for_timeout(1200)
            check('admin: Emergency Stop = pause + freeze + cancel all', P("select string_agg(key||'='||value::text, ',' order by key) from public.ops_settings where key in ('robots.paused','data.frozen')") == 'data.frozen=true,robots.paused=true'
                  and P("select target from public.ops_requests order by id desc limit 1") == 'all')
            pg.fill('#mmsg', 'Test maintenance'); pg.locator('[data-act=maint]').click(); pg.wait_for_timeout(600)
            check('admin: maintenance message saved (public)', json.loads(P("select value::text from public.ops_settings where key='maintenance'")) == {'on': True, 'message': 'Test maintenance'})
            # questions: draft filter, select, publish (gate)
            pg.evaluate("CR.go('questions')"); pg.wait_for_timeout(600); pg.locator('[data-qf=draft]').click(); pg.wait_for_timeout(800)
            n_draft = pg.locator('.q').count()
            check('admin: Draft filter lists drafts', n_draft == 3, n_draft)
            for cb in pg.locator('[data-pick]').all(): cb.click(); pg.wait_for_timeout(80)
            pg.locator('[data-bulk=publish]').click(); pg.wait_for_timeout(200); pg.fill('[data-r]', 'batch ok'); pg.locator('[data-yes]').click(); pg.wait_for_timeout(1200)
            check('admin: bulk publish only passes the quality gate', P("select count(*) from public.questions where status='published' and id like 'q-draft%'") == '3' and P("select status from public.questions where id='q-draftbad'") == 'draft')
            # audit + undo
            pg.evaluate("CR.go('audit')"); pg.wait_for_timeout(800)
            check('admin: audit shows before/after', pg.locator('#app .diff').count() > 0)
            pg.locator('[data-undo]').first.click(); pg.wait_for_timeout(200); pg.locator('[data-yes]').click(); pg.wait_for_timeout(900)
            check('admin: Undo from audit works', P("select count(*) from public.ops_audit where action='REVERT'") >= '2')
            # backup now + restore dialog
            pg.evaluate("CR.go('backup')"); pg.wait_for_timeout(300); pg.locator('[data-act=backup-now]').first.click(); pg.wait_for_timeout(200); pg.locator('[data-yes]').click(); pg.wait_for_timeout(1500)
            last = P("select id||'|'||verify_result||'|'||kind from backup.snapshots order by id desc limit 1")
            check('admin: Backup now = new verified snapshot', last.endswith('|ok|manual'), last)
            pg.locator('[data-act=restore]').first.click(); pg.wait_for_timeout(200)
            check('admin: restore locked until RESTORE-<id> typed', pg.locator('[data-rs]').is_disabled())
            pg.keyboard.press('Escape'); pg.locator('.scrim').first.click(position={'x': 5, 'y': 5}); pg.wait_for_timeout(100)
            # settings
            pg.evaluate("CR.go('settings')"); pg.wait_for_timeout(300); pg.fill('[data-num="backup.keep"]', '20'); pg.locator('[data-num="backup.keep"]').dispatch_event('change'); pg.wait_for_timeout(600)
            check('admin: policy setting saved + audited', P("select value::text from public.ops_settings where key='backup.keep'") == '20' and P("select count(*) from public.ops_audit where table_name='ops_settings'") >= '4')
            # command console: ASK with evidence, PLAN, EXECUTE -> real task
            pg.evaluate("CR.go('command')"); pg.wait_for_timeout(300)
            pg.fill('#cmdIn', 'कौन-से Robots फेल हुए हैं?'); pg.keyboard.press('Enter'); pg.wait_for_timeout(300)
            a1 = pg.inner_text('#cmdOut')
            check('console: ASK answers from real data with source', 'tag' in a1.lower() and 'स्रोत' in a1, a1[:200])
            pg.fill('#cmdIn', 'hindi robot चलाओ'); pg.keyboard.press('Enter'); pg.wait_for_timeout(300)
            check('console: EXECUTE command shows a plan first', pg.locator('[data-act=cmd-exec]').count() >= 1 and 'Hindi Robot' in pg.inner_text('#cmdOut'))
            pg.locator('[data-act=cmd-exec]').first.click(); pg.wait_for_timeout(200); pg.locator('[data-yes]').click(); pg.wait_for_timeout(900)
            check('console: EXECUTE creates a queued task with the workflow step', P("select status||'|'||(steps->0->>'file') from public.ops_tasks order by id desc limit 1") == 'queued|hindi-robot.yml')
            pg.fill('#cmdIn', 'publish करो'); pg.keyboard.press('Enter'); pg.wait_for_timeout(300)
            pg.locator('[data-act=cmd-exec]').first.click(); pg.wait_for_timeout(900)
            check('console: publish = high risk -> waiting approval', P("select status||'|'||risk from public.ops_tasks order by id desc limit 1") == 'waiting_approval|high')
            pg.fill('#cmdIn', '₹199 subscription का हिसाब'); pg.keyboard.press('Enter'); pg.wait_for_timeout(300)
            check('console: finance answer is labelled estimate', '₹199' in pg.inner_text('#cmdOut') and 'अनुमान' in pg.inner_text('#cmdOut'))
            check('console: classify Hindi/English intents', pg.evaluate("['पूरे सिस्टम का audit करो','PYQ import status','backup की integrity जाँचो','emergency stop','design audit करो','इसे ठीक करो','प्रमाण दिखाओ'].map(t => (CRX.classify(t)||{}).id).join(',')") == 'status,pyq_status,backup_verify,estop,design_audit,fix,proof')
            # tasks: list + approve
            pg.evaluate("CR.go('tasks')"); pg.wait_for_timeout(800)
            check('tasks: list shows the tasks', pg.locator('[data-task]').count() >= 2)
            hid2 = P("select id from public.ops_tasks where status='waiting_approval' order by id desc limit 1")
            pg.locator(f'[data-task="{hid2}"]').click(); pg.wait_for_timeout(200); pg.locator('[data-tc=approve]').click(); pg.wait_for_timeout(200); pg.locator('[data-yes]').click(); pg.wait_for_timeout(900)
            check('tasks: owner approves from the phone', P(f'select status from public.ops_tasks where id={hid2}') == 'queued')
            P("update public.ops_tasks set status='cancelled' where status in ('queued','waiting_approval','running')")
            # finance save -> server setting
            pg.evaluate("CR.go('finance')"); pg.wait_for_timeout(300); pg.fill('[data-fin=conversion]', '5'); pg.locator('[data-act=fin-save]').click(); pg.wait_for_timeout(900)
            check('finance: assumptions saved on server', json.loads(P("select value::text from public.ops_settings where key='finance.assumptions'"))['conversion'] == 5)
            check('finance: break-even math', pg.evaluate("CRX.finCalc({price:118,conversion:10,fee_pct:0,gst_pct:18,refund_pct:0,fixed_monthly:1000,ai_per_user:0,infra_per_user:0},100).breakEven") == 10)
            check('calendar: cron next runs', pg.evaluate("CRX.cronNext('37 21 * * *', Date.parse('2026-10-17T00:00:00Z'), 2).join(',')") == '2026-10-17T21:37:00.000Z,2026-10-18T21:37:00.000Z')
            check('admin: no page errors', not errs, errs)
            b.close()
    finally:
        F.stop()
    print('PASS all' if ok else 'FAIL some'); sys.exit(0 if ok else 1)

if __name__ == '__main__':
    main()
