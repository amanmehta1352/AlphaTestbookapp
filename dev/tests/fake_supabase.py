"""Small Supabase stand-in for tests: Auth (password/refresh/logout) + a PostgREST subset,
executed against a real local PostgreSQL that has the real schema and RLS rules."""
import json, subprocess, re, os, urllib.parse, itertools
SERVER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'server'))
SCHEMA_V1 = os.path.join(SERVER_DIR, 'SUPABASE_SCHEMA_V1.sql'); SCHEMA_V2 = os.path.join(SERVER_DIR, 'SUPABASE_SCHEMA_V2.sql'); SCHEMA_V3 = os.path.join(SERVER_DIR, 'SUPABASE_SCHEMA_V3.sql')

PG = '/usr/lib/postgresql/16/bin'
D = '/tmp/pgtest_mtb'
URL = 'https://fzkvwkrbtykucjfdqiin.supabase.co'
KEY = 'sb_publishable_o_P1uxqNhrFmOZDVVvl80A_JYQAAhB3'
ADMIN = ('11111111-1111-1111-1111-111111111111', 'helloamanmehta@gmail.com', 'admin-pass')
STUDENT = ('22222222-2222-2222-2222-222222222222', 'student@gmail.com', 'student-pass')
PK = {'exams': 'id', 'topics': 'id', 'questions': 'id', 'import_batches': 'id', 'profiles': 'id', 'admins': 'user_id'}

def sh(cmd):
    return subprocess.run(['su', 'postgres', '-s', '/bin/bash', '-c', cmd], capture_output=True, text=True)

def start(*schema_paths):
    sh(f'{PG}/pg_ctl -D {D}/data stop >/dev/null 2>&1'); subprocess.run(['rm', '-rf', D]); os.makedirs(D); subprocess.run(['chown', 'postgres', D])
    r = sh(f"{PG}/initdb -D {D}/data -A trust -U postgres >/dev/null && {PG}/pg_ctl -D {D}/data -o '-k {D} -c listen_addresses=' -l {D}/log start >/dev/null && sleep 1.5")
    assert r.returncode == 0, r.stderr
    psql_raw('create database mtb', db='postgres')
    psql_raw(open(os.path.join(os.path.dirname(__file__), 'stub.sql')).read())
    for sp in schema_paths: psql_raw(open(sp).read())
    psql_raw(f"insert into auth.users(id,email,raw_user_meta_data) values ('{ADMIN[0]}','{ADMIN[1]}','{{}}'),('{STUDENT[0]}','{STUDENT[1]}','{{}}'); insert into public.admins(user_id) values ('{ADMIN[0]}');")

def stop():
    sh(f'{PG}/pg_ctl -D {D}/data stop >/dev/null 2>&1'); subprocess.run(['rm', '-rf', D])

def psql_raw(sql, db='mtb'):
    r = subprocess.run([f'{PG}/psql', '-h', D, '-U', 'postgres', '-d', db, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
    if r.returncode != 0: raise RuntimeError(r.stderr.strip())
    return r.stdout.strip()

def q(s): return "'" + str(s).replace("'", "''") + "'"
def as_user(uid, stmt):
    role = 'authenticated' if uid else 'anon'
    sub = f"select set_config('request.jwt.claim.sub', {q(uid)}, true);" if uid else ''
    return f"begin; set local role {role}; {sub} {stmt}; commit;"

class Fake:
    def __init__(self):
        self.tokens = {}; self.refresh = {}; self.n = itertools.count(1); self.calls = []; self.offline = False
    def issue(self, user):
        n = next(self.n); a, r = f'tok-{n}', f'ref-{n}'
        self.tokens[a] = user; self.refresh[r] = user
        return {'access_token': a, 'refresh_token': r, 'expires_in': 3600, 'token_type': 'bearer', 'user': {'id': user[0], 'email': user[1]}}
    def where(self, params):
        conds = []
        for k, vs in params.items():
            if k in ('select', 'on_conflict', 'order', 'limit', 'offset'): continue
            v = vs[0]
            if v.startswith('eq.'): conds.append(f"{k} = {q(v[3:])}")
            elif v.startswith('in.('):
                items = [x.strip().strip('"').replace('\\"', '"') for x in re.findall(r'"(?:[^"\\]|\\.)*"|[^,()]+', v[4:-1])]
                conds.append(f"{k} in ({','.join(q(x) for x in items)})")
            else: raise ValueError('filter ' + k + '=' + v)
        return (' where ' + ' and '.join(conds)) if conds else ''
    def handle(self, route, request):
        if self.offline: return route.abort()
        u = urllib.parse.urlparse(request.url); path = u.path; params = urllib.parse.parse_qs(u.query)
        hdr = {k.lower(): v for k, v in request.headers.items()}
        body = request.post_data
        self.calls.append((request.method, path, u.query))
        cors = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'}
        def reply(status, data=None):
            return route.fulfill(status=status, headers={**cors, 'content-type': 'application/json'}, body='' if data is None else json.dumps(data))
        if request.method == 'OPTIONS': return route.fulfill(status=204, headers=cors)
        if path == '/auth/v1/authorize':
            if self.offline: return route.abort()
            user = getattr(self, 'google_user', STUDENT)
            t = self.issue(user)
            target = params['redirect_to'][0] + f"#access_token={t['access_token']}&refresh_token={t['refresh_token']}&expires_in=3600&token_type=bearer"
            return route.fulfill(status=302, headers={'location': target})
        if hdr.get('apikey') != KEY: return reply(401, {'message': 'Invalid API key'})
        if path == '/auth/v1/token':
            b = json.loads(body or '{}')
            if params.get('grant_type') == ['password']:
                for u_ in (ADMIN, STUDENT):
                    if b.get('email') == u_[1] and b.get('password') == u_[2]: return reply(200, self.issue(u_))
                return reply(400, {'error': 'invalid_grant', 'error_description': 'Invalid login credentials'})
            if params.get('grant_type') == ['refresh_token']:
                user = self.refresh.pop(b.get('refresh_token'), None)
                return reply(200, self.issue(user)) if user else reply(400, {'error': 'invalid_grant', 'error_description': 'Invalid Refresh Token'})
        if path == '/auth/v1/logout': return route.fulfill(status=204, headers=cors)
        if path == '/auth/v1/user':
            user = self.tokens.get(hdr.get('authorization', '')[7:])
            return reply(200, {'id': user[0], 'email': user[1], 'user_metadata': {'full_name': 'Test ' + user[1].split('@')[0]}}) if user else reply(401, {'message': 'JWT expired'})
        auth = hdr.get('authorization', '')
        uid = None
        if auth.startswith('Bearer '):
            user = self.tokens.get(auth[7:])
            if not user: return reply(401, {'code': 'PGRST301', 'message': 'JWT expired'})
            uid = user[0]
        try:
            if path == '/rest/v1/rpc/is_admin':
                return reply(200, psql_raw(as_user(uid, 'select public.is_admin()')).splitlines()[-1] == 't')
            m = re.match(r'^/rest/v1/(\w+)$', path)
            if not m: return reply(404, {'message': 'not found'})
            t = m.group(1)
            if request.method == 'GET':
                cols = params.get('select', ['*'])[0]
                tail = ''
                if 'order' in params: tail += ' order by ' + ','.join(o.replace('.desc', ' desc').replace('.asc', ' asc') for o in params['order'][0].split(','))
                if 'limit' in params: tail += ' limit ' + str(int(params['limit'][0]))
                if 'offset' in params: tail += ' offset ' + str(int(params['offset'][0]))
                out = psql_raw(as_user(uid, f"select coalesce(jsonb_agg(x),'[]'::jsonb) from (select {cols} from public.{t}{self.where(params)}{tail}) x"))
                return reply(200, json.loads(out.splitlines()[-1] if out else '[]'))
            data = json.loads(body or '[]'); rows = data if isinstance(data, list) else [data]
            j = '$J$' + json.dumps(rows, ensure_ascii=False) + '$J$'
            if request.method == 'POST':
                cols = list(rows[0].keys())
                c = ','.join(cols)
                stmt = f"insert into public.{t} ({c}) select {c} from json_populate_recordset(null::public.{t}, {j})"
                if 'ignore-duplicates' in hdr.get('prefer', ''):
                    stmt += f" on conflict ({params.get('on_conflict', [PK.get(t, 'id')])[0]}) do nothing"
                elif 'merge-duplicates' in hdr.get('prefer', ''):
                    oc = params.get('on_conflict', [PK.get(t, 'id')])[0]
                    upd = ','.join(f'{x}=excluded.{x}' for x in cols if x != oc)
                    stmt += f" on conflict ({oc}) do update set {upd}"
                psql_raw(as_user(uid, stmt)); return reply(201)
            if request.method == 'DELETE':
                psql_raw(as_user(uid, f"delete from public.{t}{self.where(params)}")); return reply(204)
            if request.method == 'PATCH':
                sets = ','.join(f'{x}=r.{x}' for x in rows[0].keys())
                psql_raw(as_user(uid, f"update public.{t} set {sets} from json_populate_record(null::public.{t}, {j[:3]}{json.dumps(rows[0], ensure_ascii=False)}{j[:3]}) r{self.where(params).replace(' where ', ' where public.' + t + '.', 1).replace(' and ', ' and public.' + t + '.')}"))
                return reply(204)
        except RuntimeError as e:
            msg = str(e)
            if 'row-level security' in msg or 'permission denied' in msg: return reply(403, {'code': '42501', 'message': msg})
            return reply(400, {'code': 'PGRST', 'message': msg})
        return reply(405, {'message': 'method'})
