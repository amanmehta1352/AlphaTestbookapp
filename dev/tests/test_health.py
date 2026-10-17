"""Health Robot + Control Room test.
1. Server numbers on the REAL schema (local Postgres via fake_supabase), sb_get_all/sb_count routed to SQL.
2. evaluate(): red/yellow/green rules.
3. Report never contains personal data (no email / user id).
4. control/index.html renders a report at 360 px (no sideways scroll), light + dark, no page errors.
Usage: python3 test_health.py"""
import json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, '..', 'tools', 'health-robot'))
import fake_supabase as fs
import health

ok = True
def check(name, cond, detail=''):
    global ok; print(('PASS ' if cond else 'FAIL ') + name + (f'  {detail}' if not cond and detail else '')); ok &= bool(cond)

def sql_get_all(table, select, where=''):
    out = fs.psql_raw(f"select coalesce(json_agg(t),'[]') from (select {select} from public.{table}) t").strip()
    return json.loads(out or '[]')

def sql_count(table, where=''):
    return int(fs.psql_raw(f'select count(*) from public.{table}').strip().splitlines()[-1])

OPT = lambda txt: json.dumps([{'letter': l, 'en': f'{txt} {l}', 'hi': ''} for l in 'ABCD']).replace("'", "''")

def main():
    fs.start(fs.SCHEMA_V1, fs.SCHEMA_V2, fs.SCHEMA_V3)
    try:
        fs.psql_raw("insert into public.topics(id,subject,chapter,title) values ('civil-x','civil-engineering','Surveying','Surveying'),('civil-mixed-untagged','civil-engineering','Mixed','Mixed');")
        rows = []
        def add(i, topic, status, active, qhi, ans='A', opts=None, qen='What is the least count of a vernier?'):
            rows.append(f"('q-health-{i.lower()}','{topic}','civil-engineering','Surveying','Surveying','{qen}',{fs.q(qhi) if qhi else 'null'},'{opts or OPT('o')}','{ans}','PYQ','{status}',{str(active).lower()})")
        for i in range(6): add(f'L{i}', 'civil-x', 'published', True, 'हिंदी')
        add('U1', 'civil-mixed-untagged', 'published', True, 'हिंदी')
        add('N1', 'civil-x', 'published', True, None)
        add('B1', 'civil-x', 'published', True, 'हिंदी', opts=json.dumps([{'letter': l, 'en': ('' if l == 'C' else 'x' + l)} for l in 'ABCD']))
        add('D1', 'civil-x', 'draft', True, None); add('D2', 'civil-x', 'draft', True, None)
        add('H1', 'civil-x', 'published', False, 'हिंदी')
        fs.psql_raw('insert into public.questions(id,topic_id,subject,chapter,topic,question_en,question_hi,options,answer,source_type,status,is_active) values ' + ','.join(rows) + ';')
        health.sb_get_all = sql_get_all; health.sb_count = sql_count
        def no_rpc(*a, **k): raise RuntimeError('no rpc in this test')
        health.sb_rpc = no_rpc
        sb = health.collect_supabase()
        q = sb.get('questions', {})
        check('server read ok on real schema', sb.get('ok') is True, sb)
        check('counts: live 9, draft 2, hidden 1', (q.get('live'), q.get('draft'), q.get('hidden')) == (9, 2, 1), q)
        check('counts: broken 1, untagged 1, no-Hindi 1', (q.get('broken_live'), q.get('untagged_live'), q.get('no_hindi_live')) == (1, 1, 1), q)
        check('students block has counts (no error)', 'error' not in sb.get('students', {}), sb.get('students'))
    finally:
        fs.stop()

    s = {'site': {'ok': True, 'version': 'V3.2.1', 'source_version': 'V3.2.1', 'ms': 300},
         'github': {'workflows': [{'file': 'tests.yml', 'label': '✅ Tests', 'what': 'x', 'page': 'p', 'last_conclusion': 'success'}], 'issues': 0},
         'supabase': sb}
    overall, checks = health.evaluate(s)
    check('broken live question makes the report RED', overall == 'bad' and checks[0]['level'] == 'bad', checks[:2])
    check('drafts waiting = yellow item with an action', any(c['level'] == 'warn' and 'publish' in c['msg'] for c in checks))
    s['supabase']['questions'].update(broken_live=0, draft=0, reviewed=0, untagged_live=0)
    overall2, _ = health.evaluate(s)
    check('all clean = GREEN', overall2 == 'ok', _)
    s['github']['workflows'][0]['last_conclusion'] = 'failure'
    check('failed robot/test = RED', health.evaluate(s)[0] == 'bad')
    s['site'] = {'ok': False}
    check('site down = RED', health.evaluate(s)[0] == 'bad')
    blob = json.dumps(sb, ensure_ascii=False)
    check('report has no email or uuid', not re.search(r'@|[0-9a-f]{8}-[0-9a-f]{4}-', blob))

    # (the Control Room page itself is tested in test_ops.py)
    print('PASS all' if ok else 'FAIL some'); sys.exit(0 if ok else 1)

if __name__ == '__main__':
    main()
