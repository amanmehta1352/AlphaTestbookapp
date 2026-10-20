"""Foundation checks: config files valid + schema applies twice (idempotent) on a scratch Postgres + rules hold."""
import json, glob, os, subprocess, sys, tempfile, shutil
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def ok(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: sys.exit(1)
branches = {b['slug'] for b in json.load(open(f'{R}/config/branches.json'))}
subjects = {s['slug'] for s in json.load(open(f'{R}/config/subjects.json'))}
ok(len(branches) >= 5, 'branches.json')
for f in glob.glob(f'{R}/config/exams/*.json'):
    e = json.load(open(f)); n = os.path.basename(f)
    ok(all(k in e for k in ('slug','name_en','name_hi','pattern','branches')), f'{n} keys')
    if not n.startswith('_'):
        ok(set(e['branches']) <= branches, f'{n} branches known')
        ok(set(e['pattern']['sections']) <= subjects, f'{n} sections known')
if not shutil.which('psql'): print('SKIP db (no psql)'); sys.exit(0)
d = tempfile.mkdtemp(); os.chmod(d, 0o777); bd = '/usr/lib/postgresql/16/bin'
def sh(cmd, user='postgres'): return subprocess.run(['runuser','-u',user,'--','bash','-c',cmd], capture_output=True, text=True)
sh(f'{bd}/initdb -D {d}/db -A trust >/dev/null'); sh(f'{bd}/pg_ctl -D {d}/db -o "-p 5599 -k {d}" -w start >/dev/null')
P = f'psql -h {d} -p 5599 -U postgres -v ON_ERROR_STOP=1 -q'
try:
    sh(f'{P} -d postgres -c "create database t"')
    sh(f'{P} -d t -c "create schema auth; create function auth.uid() returns uuid language sql as \\$\\$select current_setting(\'app.uid\',true)::uuid\\$\\$; create role anon; create role authenticated;"')
    for _ in range(2):  # twice = idempotent
        r = sh(f'{P} -d t -f {R}/db/migrations/0001_core.sql'); ok(r.returncode == 0, 'migration applies' + (r.stderr[-200:] if r.returncode else ''))
    q = lambda s: sh(f'{P} -d t -c "{s}"')
    q("insert into mtb.exams(slug,name_en,name_hi) values('e','E','ई'); insert into mtb.subjects(slug,name_en,name_hi) values('s','S','स'); insert into mtb.topics(subject_id,slug,name_en,name_hi) values(1,'t','T','ट');")
    ok(q("insert into mtb.questions(kind,topic_id,stem,options,answer,content_hash) values('pyq',1,'{}','[1,2]',0,'h')").returncode != 0, 'pyq without source is rejected')
    ok(q("insert into mtb.questions(kind,topic_id,stem,options,answer,content_hash) values('practice',1,'{}','[1,2]',5,'h')").returncode != 0, 'answer outside options is rejected')
    ok(q("insert into mtb.questions(kind,topic_id,stem,options,answer,content_hash) values('practice',1,'{}','[1,2]',1,'h')").returncode == 0, 'valid practice question accepted')
    r = sh(f'{P} -d t -At -c "set role authenticated; select count(*) from mtb.questions"'); ok(r.stdout.strip() == '0', 'drafts hidden from students (RLS)')
finally:
    sh(f'{bd}/pg_ctl -D {d}/db -m immediate stop >/dev/null'); shutil.rmtree(d, ignore_errors=True)
print('ALL PASS')
