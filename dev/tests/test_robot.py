"""PYQ Robot upload test on the real schema (local Postgres via fake_supabase.start).
Builds rows with the app's ImportEngine from a tiny generated paper,
then sends them through robot.upload() with robot.api() routed to SQL (service role = no RLS).
Usage: python3 test_robot.py"""
import json, os, re, sys, tempfile, urllib.parse
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, '..', 'tools', 'pyq-robot'))
import fake_supabase as fs
import robot

ok = True
def check(name, cond):
    global ok; print(('PASS ' if cond else 'FAIL ') + name); ok &= bool(cond)

def sql_api(method, path, body=None, prefer=None):
    p = urllib.parse.urlparse(path); table = p.path.rsplit('/', 1)[-1]; qs = urllib.parse.parse_qs(p.query)
    if method == 'GET':
        where = []
        for k, v in qs.items():
            if k in ('select', 'limit'): continue
            op, val = v[0].split('.', 1)
            if op == 'eq': where.append(f'{k} = {fs.q(val)}')
            elif op == 'in': where.append(f"{k} in ({','.join(fs.q(x.strip(chr(34))) for x in val.strip('()').split(','))})")
        out = fs.psql_raw(f"select coalesce(json_agg(json_build_object('id', id)),'[]') from public.{table}" + (' where ' + ' and '.join(where) if where else ''))
        return json.loads(out.strip().splitlines()[-1] if out.strip() else '[]')
    rows = body
    conflict = ' on conflict (id) do nothing' if prefer and 'ignore-duplicates' in prefer else ''
    js = json.dumps(rows, ensure_ascii=False).replace("'", "''")
    cols = ','.join(sorted({k for r in rows for k in r}))
    fs.psql_raw(f"insert into public.{table} ({cols}) select {cols} from jsonb_populate_recordset(null::public.{table}, '{js}'::jsonb){conflict};")
    return None

def main():
    fs.start(fs.SCHEMA_V1, fs.SCHEMA_V2, fs.SCHEMA_V3)
    try:
        robot.api = sql_api; robot.KEY = 'test'
        work = tempfile.mkdtemp()
        blk = lambda n, subj, topic, q, a: ('=== QUESTION START ===\n' + '\n'.join(f'{k}: {v}' for k, v in {
            'SOURCE_QUESTION_NO': n, 'EXAM_NAME': 'SSC JE', 'YEAR': '2023', 'SHIFT': '09 Oct 2023 Shift 1', 'SUBJECT': subj,
            'CHAPTER': topic, 'TOPIC': topic, 'SOURCE_TYPE': 'PYQ', 'QUESTION_EN': q, 'A_EN': 'one', 'B_EN': 'two', 'C_EN': 'three', 'D_EN': 'four', 'ANSWER': a}.items()) + '\n=== QUESTION END ===\n')
        f1 = os.path.join(work, 'a.txt'); open(f1, 'w').write('\n'.join(blk(i, 'General-Awareness', robot.UNTAGGED, f'Robot test question number {i}?', 'ABCD'[i % 4]) for i in range(1, 6)))
        f2 = os.path.join(work, 'b.txt'); open(f2, 'w').write('\n'.join(blk(i, 'Reasoning', 'Series', f'Find the next term in series test {i}?', 'B') for i in range(51, 54)))
        data = robot.analyze([f1, f2])
        check('analyze gives 8 rows', len(data['rows']) == 8)
        paper = {'title': 'SSC JE 2023 Civil · test', 'src': 'SSC JE 2023 Civil Paper I · test source'}
        added, existed = robot.upload(paper, data, dry=False)
        check('first upload adds 8', (added, existed) == (8, 0))
        st = fs.psql_raw("select string_agg(distinct status||'|'||source_type||'|'||source_ref, ';') from public.questions").strip()
        check('rows are draft PYQ with source_ref', st == 'draft|PYQ|SSC JE 2023 Civil Paper I · test source')
        check('batch row exists', fs.psql_raw("select count(*) from public.import_batches where id like 'ROBOT-%'").strip() == '1')
        fs.psql_raw("update public.questions set status='published', question_en='edited by admin' where question_no=1")
        added2, existed2 = robot.upload(paper, data, dry=False)
        check('second run adds 0, sees 8', (added2, existed2) == (0, 8))
        check('existing edited row untouched', fs.psql_raw("select status||question_en from public.questions where question_no=1").strip() == 'publishededited by admin')
        check('source_ref duplicate guard finds paper', robot.server_count('source_ref=eq.' + urllib.parse.quote(paper['src'])) == 8)
        d, e = robot.upload(paper, data, dry=True)
        check('dry run sends nothing', (d, e) == (0, 8))
    finally:
        fs.stop()
    print('PASS all' if ok else 'FAIL some'); sys.exit(0 if ok else 1)

if __name__ == '__main__':
    main()
