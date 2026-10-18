"""🩺 Health Robot v2 — one report on the whole app for the Control Room.
Runs on GitHub Actions every 2 hours and after every robot/test run (.github/workflows/health-robot.yml) — no Claude usage.
  python3 dev/tools/health-robot/health.py --out status.json [--history history.json] [--dry-run]

Collects (READ-ONLY): live site · GitHub (workflows: schedule, next run, success rate, duration, retries, logs of failures,
branches, latest commit, releases, Pages, API limit) · tests per suite (artifact "test-summary") · Supabase (questions &
quality, students & analytics, ops_db_stats: size/integrity/auth/perf, backups, Control Room flags, requests, robot runs,
audit, client errors) · security probes (anon cannot read private tables, secret scan of the repo, admin count) · usage.
Writes: status.json/history.json (pushed to branch `status`), ops_incidents (open/resolve), GitHub issue "🚨 App health".
Privacy: the repo is public — the report has COUNTS ONLY. Emails are masked, no user ids, no answers.
Secrets come only from env (SUPABASE_SECRET_KEY, GITHUB_TOKEN) and are never printed.
"""
import io, json, os, re, sys, time, urllib.parse, urllib.request, zipfile
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

SB_URL = os.environ.get('SUPABASE_URL', 'https://fzkvwkrbtykucjfdqiin.supabase.co').rstrip('/')
SB_KEY = os.environ.get('SUPABASE_SECRET_KEY', '').strip()
SB_PUBLISHABLE = 'sb_publishable_o_P1uxqNhrFmOZDVVvl80A_JYQAAhB3'
GH_TOKEN = os.environ.get('GITHUB_TOKEN', '').strip()
REPO = os.environ.get('GITHUB_REPOSITORY', 'amanmehta1352/AlphaTestbookapp')
SITE = os.environ.get('SITE_URL', 'https://amanmehta1352.github.io/AlphaTestbookapp/')
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
FREE = {'db_bytes': 500 * 1024 ** 2, 'storage_bytes': 1024 ** 3}   # Supabase free plan limits
WORKFLOWS = [  # file, label, what it does (Hindi), kind, robot id (Control Room switch)
    ('tests.yml', '✅ Tests', 'हर बदलाव पर ऐप के सारे tests', 'test', None),
    ('pyq-robot.yml', '🤖 PYQ Robot', 'PDF links से नए PYQ (draft)', 'robot', 'pyq'),
    ('hindi-robot.yml', '🌐 Hindi Robot', 'English सवालों में Hindi', 'robot', 'hindi'),
    ('tag-robot.yml', '🏷️ Tag Robot', 'Mixed सवाल chapter में', 'robot', 'tag'),
    ('key-check-robot.yml', '🔑 Key-check Robot', 'answer key की जाँच', 'robot', 'keycheck'),
    ('backup-robot.yml', '💾 Backup Robot', 'रोज़ पूरा backup + जाँच', 'robot', 'backup'),
    ('health-robot.yml', '🩺 Health Robot', 'यह रिपोर्ट', 'system', 'health'),
    ('ops-robot.yml', '⚙️ Ops Robot', 'Control Room के बटनों का काम', 'system', 'ops'),
    ('rollback.yml', '⏪ Rollback', 'पुराने version पर वापस', 'system', None),
    ('design-audit.yml', '🎨 Design Audit', 'हर screen की design जाँच', 'robot', 'design'),
    ('smoke.yml', '🔥 Smoke Test', 'release के बाद live जाँच', 'test', None),
    ('selective-restore.yml', '🧩 Selective Restore', 'सिर्फ़ खराब हिस्सा वापस', 'system', None),
]
PRIVATE_TABLES = ['questions', 'profiles', 'attempts', 'results', 'bookmarks', 'review_cards', 'admins', 'ops_audit', 'ops_requests', 'ops_incidents', 'ops_client_errors', 'ops_runs', 'import_batches']
SECRET_PATTERNS = [(r'sb_secret_[A-Za-z0-9_-]{10,}', 'Supabase secret key'), (r'ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}', 'GitHub token'),
                   (r'AIza[0-9A-Za-z_-]{30,}', 'Google/Gemini API key'), (r'eyJhbGciOi[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*c2VydmljZV9yb2xl', 'service_role JWT'),
                   (r'-----BEGIN (?:RSA |EC )?PRIVATE KEY-----', 'private key')]
NOW = datetime.now(timezone.utc)
ENC = lambda s: urllib.parse.quote(s, safe='')


def http(url, headers=None, method='GET', body=None, timeout=40, raw=False):
    req = urllib.request.Request(url, method=method, headers=headers or {}, data=None if body is None else json.dumps(body).encode())
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
        return r.status, (data if raw else data.decode('utf-8', 'replace')), dict(r.headers), round((time.time() - t0) * 1000)


def sb_headers(extra=None):
    h = {'apikey': SB_KEY, 'x-actor': 'health-robot', 'Content-Type': 'application/json'}
    if SB_KEY.startswith('eyJ'): h['Authorization'] = 'Bearer ' + SB_KEY
    h.update(extra or {}); return h


def sb_get_all(table, select, where=''):
    rows, off = [], 0
    while True:
        _, t, _, _ = http(f'{SB_URL}/rest/v1/{table}?select={select}{where}&limit=1000&offset={off}', sb_headers())
        part = json.loads(t or '[]'); rows += part; off += 1000
        if len(part) < 1000: return rows


def sb_count(table, where=''):
    _, _, h, _ = http(f'{SB_URL}/rest/v1/{table}?select=*{where}&limit=1', sb_headers({'Prefer': 'count=exact', 'Range': '0-0'}))
    m = re.search(r'/(\d+)', h.get('Content-Range', '') or h.get('content-range', ''))
    return int(m.group(1)) if m else 0


def sb_rpc(fn, args=None):
    _, t, _, _ = http(f'{SB_URL}/rest/v1/rpc/{fn}', sb_headers(), 'POST', args or {}, timeout=120)
    return json.loads(t or 'null')


def sb_write(method, path, body, prefer='return=minimal'):
    http(f'{SB_URL}/rest/v1/{path}', sb_headers({'Prefer': prefer}), method, body)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None


def gh_download(path):
    """Artifact / log downloads redirect to blob storage, which must be fetched WITHOUT the GitHub token."""
    h = {'Accept': 'application/vnd.github+json', 'User-Agent': 'mtb-health'}
    if GH_TOKEN: h['Authorization'] = 'Bearer ' + GH_TOKEN
    req = urllib.request.Request('https://api.github.com/repos/' + REPO + path, headers=h)
    try:
        with urllib.request.build_opener(_NoRedirect).open(req, timeout=60) as r: return r.read()
    except urllib.error.HTTPError as e:
        loc = e.headers.get('Location')
        if e.code in (301, 302, 303, 307, 308) and loc:
            with urllib.request.urlopen(urllib.request.Request(loc, headers={'User-Agent': 'mtb-health'}), timeout=60) as r: return r.read()
        raise


def gh(path, method='GET', body=None, raw=False, full=False):
    h = {'Accept': 'application/vnd.github+json', 'User-Agent': 'mtb-health'}
    if GH_TOKEN: h['Authorization'] = 'Bearer ' + GH_TOKEN
    if body is not None: h['Content-Type'] = 'application/json'
    url = path if path.startswith('https://') else ('https://api.github.com' + path if full else 'https://api.github.com/repos/' + REPO + path)
    _, t, _, _ = http(url, h, method, body, raw=raw)
    return t if raw else json.loads(t or 'null')


def mask(s):
    return re.sub(r'[\w.+-]+@[\w-]+\.[\w.]+', 'admin', str(s or ''))


def safe(fn, default=None):
    try: return fn()
    except Exception as e: return default if default is not None else {'error': str(e)[:160]}


# ---------------------------------------------------------------- cron + workflow files
def cron_next(expr, start=None):
    """Next run time (UTC) for a 5-field cron — enough for the patterns used here."""
    f = expr.split()
    if len(f) != 5: return None
    def match(field, v, lo, hi):
        for part in field.split(','):
            step = 1
            if '/' in part: part, step = part.split('/'); step = int(step)
            if part == '*': a, b = lo, hi
            elif '-' in part: a, b = map(int, part.split('-'))
            else: a = b = int(part)
            if a <= v <= b and (v - a) % step == 0: return True
        return False
    t = (start or NOW).replace(second=0, microsecond=0) + timedelta(minutes=1)
    for _ in range(60 * 24 * 8):
        if match(f[0], t.minute, 0, 59) and match(f[1], t.hour, 0, 23) and match(f[2], t.day, 1, 31) and match(f[3], t.month, 1, 12) and match(f[4], (t.weekday() + 1) % 7, 0, 6):
            return t.isoformat(timespec='minutes')
        t += timedelta(minutes=1)
    return None


def workflow_meta(fn):
    path = os.path.join(ROOT, '.github', 'workflows', fn)
    out = {'cron': [], 'after': [], 'manual': False, 'push': False, 'concurrency': None, 'timeout': None}
    if not os.path.exists(path): return out
    try:
        import yaml
        d = yaml.safe_load(open(path, encoding='utf-8')); on = d.get('on') or d.get(True) or {}
        out['cron'] = [c['cron'] for c in on.get('schedule', []) or []]
        out['after'] = list((on.get('workflow_run') or {}).get('workflows', []) or [])
        out['manual'] = 'workflow_dispatch' in on; out['push'] = 'push' in on
        out['concurrency'] = (d.get('concurrency') or {}).get('group') if isinstance(d.get('concurrency'), dict) else d.get('concurrency')
        out['timeout'] = max([j.get('timeout-minutes') or 0 for j in (d.get('jobs') or {}).values()] or [0]) or None
    except Exception:
        txt = open(path, encoding='utf-8').read()
        out['cron'] = re.findall(r"cron:\s*'([^']+)'", txt); out['manual'] = 'workflow_dispatch' in txt
    out['next_run'] = min([x for x in (cron_next(c) for c in out['cron']) if x] or [None], key=lambda x: x or '')
    return out


# ---------------------------------------------------------------- collectors
def collect_site():
    out = {'url': SITE}
    try:
        st, html, _, ms = http(SITE + '?health=' + str(int(time.time())))
        m = re.search(r'name="app-version" content="([^"]+)"', html)
        out.update(ok=st == 200, ms=ms, version=m.group(1) if m else '', size_kb=round(len(html.encode()) / 1024))
        _, sw, _, _ = http(SITE + 'sw.js?health=' + str(int(time.time())))
        m2 = re.search(r"CACHE\s*=\s*'([^']+)'", sw); out['sw_cache'] = m2.group(1) if m2 else ''
        for sub in ('admin/', 'control/'):
            try: out[sub.strip('/') + '_ok'] = http(SITE + sub)[0] == 200
            except Exception: out[sub.strip('/') + '_ok'] = False
    except Exception as e:
        out.update(ok=False, error=str(e)[:160])
    try:
        src = open(os.path.join(ROOT, 'dev/app/src/html/head-01.html'), encoding='utf-8').read()
        m = re.search(r'name="app-version" content="([^"]+)"', src); out['source_version'] = m.group(1) if m else ''
    except Exception:
        out['source_version'] = ''
    return out


def diagnose(text, label):
    """Simple rules: root cause, fix, risk (Hindi). Real fixes are done by Claude/admin after review."""
    t = text or ''
    rules = [
        (r'SUPABASE_SECRET_KEY नहीं मिला|secret.*not found', 'GitHub secret SUPABASE_SECRET_KEY नहीं मिला', 'GitHub → Settings → Secrets में key दोबारा डालें', 'कम'),
        (r'server 401|Invalid API key|JWT', 'Supabase key गलत या बदल गई', 'नई secret key GitHub secret में डालें', 'कम'),
        (r'server 5\d\d|timed out|URLError|Connection reset|503|502', 'Server/internet अस्थायी दिक्कत', 'Retry दबाएँ; बार-बार हो तो Supabase status देखें', 'कम'),
        (r'^FAIL |✕ test_|AssertionError', 'कोई test fail — code में गड़बड़', 'Claude को run का link भेजें: "fail test ठीक करो"', 'मध्यम'),
        (r'No space left', 'Runner की disk भर गई', 'Retry; बार-बार हो तो Claude', 'कम'),
        (r'rate limit|429', 'API की सीमा (rate limit)', '1 घंटे बाद Retry', 'कम'),
        (r'ModuleNotFoundError|No matching distribution|pip', 'कोई library install नहीं हुई / version बदला', 'Claude: version pin करो', 'मध्यम'),
        (r'PDF|pdfplumber|AssertionError: 0|header incomplete', 'PDF का format अलग / scan वाला', 'दूसरा link दें या Claude को paper भेजें', 'कम'),
        (r'permission|403|Resource not accessible', 'GitHub/Supabase अनुमति की दिक्कत', 'Claude को बताएँ (workflow permissions)', 'मध्यम'),
    ]
    for pat, cause, fix, risk in rules:
        if re.search(pat, t, re.I | re.M):
            return {'cause': cause, 'fix': fix, 'risk': risk, 'ask_claude': f'{label} fail हुआ: {cause}. Control Room देखकर ठीक करो (backup लेकर, tests चलाकर).'}
    return {'cause': 'अनजान वजह', 'fix': 'Claude को run का link भेजें', 'risk': 'अज्ञात', 'ask_claude': f'{label} fail हुआ, वजह साफ़ नहीं. Log देखकर ठीक करो.'}


def failure_log(run_id):
    try:
        jobs = (gh(f'/actions/runs/{run_id}/jobs?per_page=30') or {}).get('jobs', [])
        bad = [j for j in jobs if j.get('conclusion') == 'failure'][:1]
        if not bad: return ''
        txt = gh_download(f"/actions/jobs/{bad[0]['id']}/logs").decode('utf-8', 'replace')
        lines = [re.sub(r'^\S+Z\s', '', l) for l in txt.splitlines()]
        keep = [l.strip()[:220] for l in lines if re.search(r'error|❌|FAIL|Traceback|Exception|exit code|✕', l, re.I) and 'set +e' not in l]
        return '\n'.join(keep[-12:])
    except Exception as e:
        return f'(log नहीं मिला: {str(e)[:80]})'


def collect_github():
    out = {'workflows': [], 'issues': None}
    since = (NOW - timedelta(days=30)).isoformat()
    for f, label, what, kind, robot in WORKFLOWS:
        w = {'file': f, 'label': label, 'what': what, 'kind': kind, 'robot': robot, 'page': f'https://github.com/{REPO}/actions/workflows/{f}', **workflow_meta(f)}
        try:
            runs = (gh(f'/actions/workflows/{f}/runs?per_page=40') or {}).get('workflow_runs', [])
            recent = [r for r in runs if r.get('created_at', '') >= since]
            done = [r for r in runs if r.get('status') == 'completed']
            c = Counter(r.get('conclusion') for r in recent if r.get('status') == 'completed')
            durs = []
            for r in recent:
                try:
                    a = datetime.fromisoformat(r['run_started_at'].replace('Z', '+00:00')); b = datetime.fromisoformat(r['updated_at'].replace('Z', '+00:00'))
                    if r.get('status') == 'completed': durs.append((b - a).total_seconds() / 60)
                except Exception: pass
            real = c.get('success', 0) + c.get('failure', 0)
            last = done[0] if done else {}
            w.update(runs_30d=len(recent), success=c.get('success', 0), failure=c.get('failure', 0), cancelled=c.get('cancelled', 0), skipped=c.get('skipped', 0),
                     success_rate=round(100 * c.get('success', 0) / real) if real else None, avg_min=round(sum(durs) / len(durs), 1) if durs else None,
                     minutes_30d=round(sum(durs)), retries=sum(1 for r in recent if (r.get('run_attempt') or 1) > 1),
                     last_conclusion=last.get('conclusion'), last_at=last.get('updated_at'), last_url=last.get('html_url'), last_id=last.get('id'),
                     last_event=last.get('event'), last_success_at=next((r['updated_at'] for r in done if r.get('conclusion') == 'success'), None),
                     last_failure_at=next((r['updated_at'] for r in done if r.get('conclusion') == 'failure'), None),
                     running=any(r.get('status') in ('in_progress', 'queued', 'waiting') for r in runs[:5]),
                     history=[{'c': r.get('conclusion') or r.get('status'), 'at': r.get('created_at'), 'url': r.get('html_url'), 'ev': r.get('event'), 'n': r.get('run_attempt')} for r in runs[:12]])
            if last.get('conclusion') == 'failure':
                log = failure_log(last['id']); w['error_log'] = log; w['diagnosis'] = diagnose(log, label)
        except Exception as e:
            w['error'] = str(e)[:120]
        out['workflows'].append(w)
    out['issues'] = safe(lambda: len([i for i in (gh('/issues?state=open&per_page=50') or []) if 'pull_request' not in i]), None)
    out['branches'] = safe(lambda: [b['name'] for b in gh('/branches?per_page=30')], [])
    out['latest_commit'] = safe(lambda: (lambda c: {'sha': c['sha'][:7], 'msg': c['commit']['message'].split('\n')[0][:120], 'at': c['commit']['author']['date'], 'url': c['html_url']})(gh('/commits?sha=main&per_page=1')[0]), {})
    def releases():
        rel = []
        for c in gh('/commits?sha=main&path=index.html&per_page=15') or []:
            msg = c['commit']['message'].split('\n')[0]
            m = re.search(r'V\d+\.\d+\.\d+[\w.-]*', msg)
            tr = (gh(f"/actions/workflows/tests.yml/runs?head_sha={c['sha']}&per_page=1") or {}).get('workflow_runs', [])
            rel.append({'sha': c['sha'][:7], 'full': c['sha'], 'version': m.group(0) if m else '', 'msg': msg[:110], 'at': c['commit']['author']['date'],
                        'tests': (tr[0].get('conclusion') or tr[0].get('status')) if tr else 'none', 'url': c['html_url']})
        return rel
    out['releases'] = safe(releases, [])
    out['pages'] = safe(lambda: (lambda p: {'status': p.get('status'), 'url': p.get('html_url')})(gh('/pages')), {})
    out['rate_limit'] = safe(lambda: (lambda r: {'remaining': r['rate']['remaining'], 'limit': r['rate']['limit']})(gh('/rate_limit', full=True)), {})
    return out


def collect_tests(github):
    """Per-suite results from the newest Tests run's artifact."""
    try:
        runs = (gh('/actions/workflows/tests.yml/runs?per_page=5&status=completed') or {}).get('workflow_runs', [])
        for r in runs:
            arts = (gh(f"/actions/runs/{r['id']}/artifacts") or {}).get('artifacts', [])
            a = next((x for x in arts if x['name'] == 'test-summary' and not x.get('expired')), None)
            if not a: continue
            z = zipfile.ZipFile(io.BytesIO(gh_download(f"/actions/artifacts/{a['id']}/zip")))
            data = json.loads(z.read(z.namelist()[0]))
            data.update(run_url=r['html_url'], conclusion=r.get('conclusion'), sha=r['head_sha'][:7], run_at=r['updated_at'])
            return data
        return {'note': 'अभी per-suite रिपोर्ट वाला कोई Tests run नहीं'}
    except Exception as e:
        return {'error': str(e)[:160]}


def latest_artifact(wf, name):
    """-> (json, run) of the newest completed run of `wf` that has artifact `name` (first .json inside)."""
    runs = (gh(f'/actions/workflows/{wf}/runs?per_page=6&status=completed') or {}).get('workflow_runs', [])
    for r in runs:
        arts = (gh(f"/actions/runs/{r['id']}/artifacts") or {}).get('artifacts', [])
        a = next((x for x in arts if x['name'] == name and not x.get('expired')), None)
        if not a: continue
        z = zipfile.ZipFile(io.BytesIO(gh_download(f"/actions/artifacts/{a['id']}/zip")))
        js = [n for n in z.namelist() if n.endswith('.json')]
        if js: return json.loads(z.read(js[0])), r
    return None, None


def collect_design():
    out = {}
    try:
        d, r = latest_artifact('design-audit.yml', 'design-audit')
        if d: out['audit'] = {**d.get('summary', {}), 'target': d.get('target'), 'at': d.get('at'), 'url': r['html_url'],
                              'worst': sorted([{'route': x['route'], 'size': x['size'], 'theme': x.get('theme'), 'small': len(x.get('small') or []), 'lowc': len(x.get('lowc') or []),
                                                'overflow': bool(x.get('overflow')), 'samples': (x.get('lowc') or [])[:2] + (x.get('small') or [])[:2]} for x in d.get('screens', [])],
                                              key=lambda y: -(y['small'] + y['lowc'] + 10 * y['overflow']))[:8]}
    except Exception as e:
        out['audit'] = {'note': 'अभी नहीं चला'} if '404' in str(e) else {'error': str(e)[:120]}
    try:
        d, r = latest_artifact('smoke.yml', 'smoke')
        if d: out['smoke'] = {**d, 'url': r['html_url']}
    except Exception as e:
        out['smoke'] = {'note': 'अभी नहीं चला'} if '404' in str(e) else {'error': str(e)[:120]}
    try:
        hist = []
        for c in gh('/commits?sha=main&path=dev/app/src&per_page=12') or []:
            det = gh(f"/commits/{c['sha']}") or {}
            files = [f['filename'] for f in det.get('files', []) if f['filename'].startswith(('dev/app/src/', 'control/'))]
            hist.append({'sha': c['sha'][:7], 'full': c['sha'], 'msg': c['commit']['message'].split('\n')[0][:120], 'at': c['commit']['author']['date'], 'url': c['html_url'],
                         'files': files[:20], 'sections': sorted({SECTION_OF(f) for f in files})[:8]})
        out['history'] = hist
    except Exception as e:
        out['history'] = []
    files = []
    for base in ('dev/app/src/css', 'dev/app/src/js', 'dev/app/src/html', 'control'):
        d = os.path.join(ROOT, base)
        if os.path.isdir(d): files += [f'{base}/{f}' for f in sorted(os.listdir(d)) if re.search(r'\.(css|js|html)$', f)]
    out['files'] = [{'path': f, 'section': SECTION_OF(f)} for f in files]
    return out


SECTIONS = [(r'18-v3-design|01-base|0[2-9]-v2', 'Design system / theme'), (r'22b-cbt|22c-cbt|22-study|18-cbt', 'CBT test room + result'), (r'22d-v3-hub', 'Subject hub · Me · Speed check'),
            (r'11-dashboard', 'Home dashboard'), (r'17b-student-profile', 'Exam/branch profile'), (r'17c-ops|17-cloud', 'Login, sync, maintenance'), (r'19-smart-builder|08-routing', 'Test builder + navigation'),
            (r'21-pages|12-display', 'Subjects, topics, pages'), (r'24d-admin|17-admin', 'Admin Studio'), (r'10-revision|09-learning', 'Revision + learning data'), (r'^control/', 'Control Room'), (r'head-|body', 'App shell (HTML)')]
SECTION_OF = lambda f: next((name for pat, name in SECTIONS if re.search(pat, f)), os.path.basename(f))


def collect_keycheck():
    try:
        runs = (gh('/actions/workflows/key-check-robot.yml/runs?per_page=5&status=completed') or {}).get('workflow_runs', [])
        for r in runs:
            arts = (gh(f"/actions/runs/{r['id']}/artifacts") or {}).get('artifacts', [])
            a = next((x for x in arts if x['name'] == 'keycheck-report' and not x.get('expired')), None)
            if not a: continue
            z = zipfile.ZipFile(io.BytesIO(gh_download(f"/actions/artifacts/{a['id']}/zip")))
            rep = json.loads(z.read(z.namelist()[0]))
            flags = rep.get('flags') if isinstance(rep, dict) else rep
            codes = Counter(f.get('code') for f in (flags or []) if isinstance(f, dict))
            return {'at': r['updated_at'], 'url': r['html_url'], 'by_code': dict(codes), 'total': sum(codes.values()),
                    'sample': [{'id': f.get('id'), 'code': f.get('code'), 'msg': str(f.get('why') or f.get('msg') or '')[:120]} for f in (flags or [])[:15] if isinstance(f, dict)]}
        return {'note': 'अभी कोई Key-check रिपोर्ट नहीं'}
    except Exception as e:
        return {'error': str(e)[:160]}


def collect_supabase():
    out = {}
    t0 = time.time()
    try:
        qs = sb_get_all('questions', 'id,subject,status,is_active,question_en,question_hi,options,answer,topic_id,source_type,created_at,explanation_en,explanation_hi,import_batch_id,source_ref')
    except Exception as e:
        return {'ok': False, 'error': str(e)[:160]}
    out['ok'] = True; out['ms'] = round((time.time() - t0) * 1000)
    live = [q for q in qs if q['status'] == 'published' and q['is_active']]
    min_text = 8
    def broken(q):
        return ((q['answer'] or '') not in ('A', 'B', 'C', 'D') or len(q['options'] or []) != 4
                or any(not (o.get('en') or o.get('hi') or '').strip() for o in (q['options'] or []))
                or len((q['question_en'] or q['question_hi'] or '').strip()) < min_text)
    def dup_opts(q):
        t = [re.sub(r'\s+', ' ', (o.get('en') or o.get('hi') or '').strip().lower()) for o in (q['options'] or [])]
        return len(t) != len(set(t))
    by_subj = defaultdict(lambda: Counter())
    for q in qs:
        s = by_subj[q['subject']]
        if q['status'] == 'published' and q['is_active']:
            s['live'] += 1
            if not (q['question_hi'] or '').strip(): s['no_hindi'] += 1
            if 'mixed-untagged' in (q['topic_id'] or ''): s['untagged'] += 1
            if not ((q.get('explanation_en') or '') or (q.get('explanation_hi') or '')): s['no_expl'] += 1
            if broken(q): s['broken'] += 1
        elif q['is_active']: s['pending'] += 1
        else: s['hidden'] += 1
    d7 = (NOW - timedelta(days=7)).isoformat()
    out['questions'] = {
        'total': len(qs), 'live': len(live),
        'draft': sum(q['status'] == 'draft' for q in qs), 'reviewed': sum(q['status'] == 'reviewed' for q in qs),
        'hidden': sum(not q['is_active'] for q in qs),
        'pyq_live': sum(q['source_type'] == 'PYQ' for q in live), 'practice_live': sum(q['source_type'] == 'PRACTICE' for q in live),
        'no_hindi_live': sum(not (q['question_hi'] or '').strip() for q in live),
        'untagged_live': sum('mixed-untagged' in (q['topic_id'] or '') for q in live),
        'broken_live': sum(1 for q in live if broken(q)),
        'dup_options_live': sum(1 for q in live if dup_opts(q)),
        'no_expl_live': sum(1 for q in live if not ((q.get('explanation_en') or '') or (q.get('explanation_hi') or ''))),
        'added_7d': sum(1 for q in qs if (q['created_at'] or '') >= d7),
        'by_subject': dict(Counter(q['subject'] for q in live).most_common()),
        'problem_ids': {'broken': [q['id'] for q in live if broken(q)][:300], 'dup_options': [q['id'] for q in live if dup_opts(q)][:300]},
        'quality_by_subject': {k: dict(v) for k, v in sorted(by_subj.items(), key=lambda x: -x[1]['live'])},
    }
    subj_of = {q['id']: q['subject'] for q in qs}
    d1, d14 = (NOW - timedelta(days=1)).isoformat(), (NOW - timedelta(days=14)).isoformat()
    try:
        att = sb_get_all('attempts', 'user_id,question_id,is_correct,answered_at', f'&answered_at=gte.{ENC(d14)}')
        att7 = [a for a in att if a['answered_at'] >= d7]
        res14 = sb_get_all('results', 'submitted_at,correct,wrong,skipped', f'&submitted_at=gte.{ENC(d14)}')
        days = [(NOW - timedelta(days=i)).date().isoformat() for i in range(13, -1, -1)]
        dau = {d: set() for d in days}; ans = Counter(); tests = Counter()
        for a in att:
            d = a['answered_at'][:10]
            if d in dau: dau[d].add(a['user_id']); ans[d] += 1
        for r in res14: tests[(r['submitted_at'] or '')[:10]] += 1
        sacc = defaultdict(lambda: [0, 0])
        for a in att7:
            s = subj_of.get(a['question_id'], '?'); sacc[s][0] += 1; sacc[s][1] += bool(a['is_correct'])
        out['students'] = {
            'total': sb_count('profiles'), 'new_7d': sb_count('profiles', f'&created_at=gte.{ENC(d7)}'),
            'active_1d': len({a['user_id'] for a in att if a['answered_at'] >= d1}), 'active_7d': len({a['user_id'] for a in att7}),
            'answers_1d': sum(a['answered_at'] >= d1 for a in att), 'answers_7d': len(att7),
            'accuracy_7d': round(100 * sum(bool(a['is_correct']) for a in att7) / len(att7)) if att7 else None,
            'tests_7d': sum(1 for r in res14 if (r['submitted_at'] or '') >= d7), 'admins': sb_count('admins'),
            'trend': [{'day': d, 'active': len(dau[d]), 'answers': ans[d], 'tests': tests[d]} for d in days],
            'subject_accuracy_7d': {k: {'answers': v[0], 'accuracy': round(100 * v[1] / v[0]) if v[0] else None} for k, v in sorted(sacc.items(), key=lambda x: -x[1][0])},
        }
    except Exception as e:
        out['students'] = {'error': str(e)[:120]}
    # Control Room (V4) data — tolerated if V4 is not applied yet
    db = safe(lambda: sb_rpc('ops_db_stats'), {})
    if isinstance(db, dict) and 'tables' in db:
        db['tables'] = {k: v for k, v in db['tables'].items()}
    out['db'] = db
    out['settings'] = safe(lambda: {r['key']: r['value'] for r in sb_get_all('ops_settings', 'key,value,updated_at,updated_by')}, {})
    out['settings_meta'] = safe(lambda: {r['key']: {'label': r.get('label'), 'note': r.get('note'), 'at': r.get('updated_at'), 'by': mask(r.get('updated_by'))}
                                         for r in sb_get_all('ops_settings', 'key,label,note,updated_at,updated_by')}, {})
    out['backups'] = safe(lambda: [{'id': b['id'], 'at': b['taken_at'], 'kind': b['kind'], 'note': mask(b.get('note')), 'questions': (b.get('counts') or {}).get('questions'),
                                    'students': (b.get('counts') or {}).get('profiles'), 'size_kb': b.get('size_kb'), 'verified': b.get('verify_result'), 'verified_at': b.get('verified_at')}
                                   for b in (sb_rpc('ops_backup_list') or [])[:10]], [])
    out['requests'] = safe(lambda: [{'id': r['id'], 'action': r['action'], 'target': r['target'], 'status': r['status'], 'result': mask(r.get('result'))[:160],
                                     'at': r['requested_at'], 'done_at': r.get('handled_at')} for r in sb_get_all('ops_requests', 'id,action,target,status,result,requested_at,handled_at', '&order=id.desc')[:15]], [])
    def runs():
        rs = sb_get_all('ops_runs', 'robot,run_id,finished_at,ok,processed,changed,note', f'&finished_at=gte.{ENC((NOW - timedelta(days=30)).isoformat())}&order=id.desc')
        agg = {}
        for r in rs:
            a = agg.setdefault(r['robot'], {'runs': 0, 'ok': 0, 'processed': 0, 'changed': 0, 'last': None})
            a['runs'] += 1; a['ok'] += bool(r['ok']); a['processed'] += r['processed'] or 0; a['changed'] += r['changed'] or 0
            if not a['last']: a['last'] = {'at': r['finished_at'], 'ok': r['ok'], 'processed': r['processed'], 'changed': r['changed'], 'note': mask(r.get('note'))[:160]}
        return agg
    out['robot_runs'] = safe(runs, {})
    out['audit'] = safe(lambda: [{'id': a['id'], 'at': a['at'], 'table': a['table_name'], 'row': 'admin' if a['table_name'] == 'admins' else mask(a['row_id']), 'action': a['action'], 'actor': mask(a.get('actor')),
                                  'reason': mask(a.get('reason'))[:120], 'fields': list((a.get('changed') or {}).keys())[:6]}
                                 for a in sb_get_all('ops_audit', 'id,at,table_name,row_id,action,actor,reason,changed', '&order=id.desc')[:25]], [])
    def batches():
        bs = sb_get_all('import_batches', 'id,file_name,source_url,added,report,created_at', '&order=created_at.desc')[:25]
        per = defaultdict(Counter)
        for q in qs:
            if q.get('import_batch_id'):
                c = per[q['import_batch_id']]; c['total'] += 1
                c['live' if q['status'] == 'published' and q['is_active'] else 'hidden' if not q['is_active'] else 'pending'] += 1
                if not (q['question_hi'] or '').strip(): c['no_hindi'] += 1
                if 'mixed-untagged' in (q['topic_id'] or ''): c['untagged'] += 1
                if broken(q): c['broken'] += 1
        return [{'id': b['id'], 'title': b.get('file_name'), 'url': b.get('source_url'), 'at': b.get('created_at'), 'added': b.get('added'), 'report': b.get('report'), 'now': dict(per.get(b['id'], {}))} for b in bs]
    out['imports'] = safe(batches, [])
    def sources():
        agg = defaultdict(Counter)
        for q in qs:
            k = (q.get('source_ref') or 'Unknown').split(' · ')[0][:90]; c = agg[k]; c['total'] += 1
            c['live' if q['status'] == 'published' and q['is_active'] else 'hidden' if not q['is_active'] else 'pending'] += 1
            if not (q['question_hi'] or '').strip(): c['no_hindi'] += 1
        return sorted([{'source': k, **dict(v)} for k, v in agg.items()], key=lambda x: -x['total'])[:60]
    out['sources'] = safe(sources, [])
    def tasks():
        ts = sb_get_all('ops_tasks', 'id,title,intent,status,risk,mode,created_at,updated_at,started_at,finished_at,retry_count', '&order=id.desc')[:40]
        c = Counter(t['status'] for t in ts)
        stuck = [t['id'] for t in ts if t['status'] == 'running' and t.get('updated_at') and NOW - datetime.fromisoformat(t['updated_at'].replace('Z', '+00:00')) > timedelta(minutes=60)]
        return {'by_status': dict(c), 'recent': ts[:15], 'failed_recent': [t for t in ts if t['status'] == 'failed'], 'stuck': stuck}
    out['tasks'] = safe(tasks, {})
    out['usage_stats'] = safe(lambda: sb_rpc('ops_usage_stats', {'p_days': 14}), {})
    out['roles'] = safe(lambda: dict(Counter(a['role'] for a in (sb_rpc('ops_admin_list') or []))), {})
    def queue():
        rq = sb_get_all('ops_requests', 'id,status,requested_at,handled_at', '&order=id.desc')[:60]
        waits = [(datetime.fromisoformat(r['handled_at'].replace('Z', '+00:00')) - datetime.fromisoformat(r['requested_at'].replace('Z', '+00:00'))).total_seconds() / 60 for r in rq if r.get('handled_at')]
        old = [r['id'] for r in rq if r['status'] == 'queued' and NOW - datetime.fromisoformat(r['requested_at'].replace('Z', '+00:00')) > timedelta(minutes=30)]
        return {'avg_wait_min': round(sum(waits) / len(waits), 1) if waits else None, 'max_wait_min': round(max(waits), 1) if waits else None, 'stuck': old, 'queued': sum(r['status'] == 'queued' for r in rq)}
    out['queue'] = safe(queue, {})
    out['incidents'] = safe(lambda: sb_get_all('ops_incidents', 'id,key,severity,area,title,suggestion,status,opened_at,last_seen,resolved_at,seen_count', '&order=id.desc')[:30], [])
    out['client_errors'] = safe(lambda: [{'at': e['at'], 'v': e.get('app_version'), 'page': e.get('page'), 'msg': mask(e['message'])[:160]}
                                         for e in sb_get_all('ops_client_errors', 'at,app_version,page,message', f'&at=gte.{ENC(d7)}&order=id.desc')[:20]], [])
    return out


def collect_security():
    out = {'anon': {}, 'secrets': []}
    for t in PRIVATE_TABLES:
        try:
            st, body, _, _ = http(f'{SB_URL}/rest/v1/{t}?select=*&limit=1', {'apikey': SB_PUBLISHABLE})
            rows = json.loads(body or '[]'); out['anon'][t] = 'खुला!' if rows else 'बंद'
        except urllib.error.HTTPError as e:
            out['anon'][t] = 'बंद' if e.code in (401, 403, 404) else f'HTTP {e.code}'
        except Exception as e:
            out['anon'][t] = 'जाँच नहीं हुई'
    for base, dirs, files in os.walk(ROOT):
        if any(x in base for x in ('/.git', 'node_modules', '__pycache__')): continue
        for f in files:
            p = os.path.join(base, f)
            if os.path.getsize(p) > 3_000_000 or not re.search(r'\.(html|js|py|json|yml|yaml|sql|md|txt|sh|css|env)$', f): continue
            try: txt = open(p, encoding='utf-8', errors='ignore').read()
            except Exception: continue
            for pat, name in SECRET_PATTERNS:
                if re.search(pat, txt): out['secrets'].append({'file': os.path.relpath(p, ROOT), 'kind': name})
    out['publishable_only'] = not out['secrets']
    return out


def collect_usage(s):
    db = (s.get('supabase') or {}).get('db') or {}
    wf = (s.get('github') or {}).get('workflows') or []
    u = {'db_bytes': db.get('db_bytes'), 'storage_bytes': db.get('storage_bytes'), 'backup_bytes': db.get('backup_bytes'),
         'db_pct': round(100 * db['db_bytes'] / FREE['db_bytes'], 1) if db.get('db_bytes') else None,
         'storage_pct': round(100 * db['storage_bytes'] / FREE['storage_bytes'], 1) if db.get('storage_bytes') is not None else None,
         'actions_minutes_30d': sum(w.get('minutes_30d') or 0 for w in wf), 'actions_runs_30d': sum(w.get('runs_30d') or 0 for w in wf),
         'actions_by_workflow': {w['label']: w.get('minutes_30d') or 0 for w in wf},
         'api': (s.get('github') or {}).get('rate_limit'),
         'cost_note': 'Public repo: GitHub Actions मुफ़्त · Supabase Free plan (500 MB DB, 1 GB storage) · Gemini free tier · अनुमानित खर्च ₹0/महीना'}
    return u


# ---------------------------------------------------------------- verdict
def evaluate(s):
    C = []
    SRC = {'ऐप': 'live site (HTTP)', 'Robots': 'GitHub Actions API', 'Tests': 'test-summary artifact', 'Server': 'Supabase (service key)', 'सवाल': 'Supabase questions',
           'Database': 'ops_db_stats()', 'Backup': 'backup.snapshots', 'Students': 'Supabase attempts/results', 'Security': 'anon probe + repo scan', 'Control': 'ops_settings',
           'GitHub': 'GitHub API', 'Usage': 'ops_db_stats()', 'Tasks': 'ops_tasks', 'Design': 'design-audit artifact', 'Deploy': 'smoke artifact'}
    def add(cid, area, level, msg, todo='', link='', diag=None):
        C.append({'id': cid, 'area': area, 'level': level, 'msg': msg, 'todo': todo, 'link': link, 'source': SRC.get(area, area), 'checked_at': NOW.isoformat(timespec='seconds'),
                  **({'diagnosis': diag} if diag else {})})
    site, g, sb = s.get('site', {}), s.get('github', {}), s.get('supabase', {})
    sec, tests = s.get('security') or {}, s.get('tests') or {}
    if not site.get('ok'): add('site-down', 'ऐप', 'bad', 'Live ऐप नहीं खुल रहा', 'GitHub Pages जाँचो — Claude को बताओ', SITE)
    else:
        add('site-up', 'ऐप', 'ok', f"Live ऐप चालू · {site.get('version')} · {site.get('ms')} ms")
        if site.get('source_version') and site.get('version') != site.get('source_version'):
            add('site-version', 'ऐप', 'warn', f"Live {site.get('version')} पर code में {site.get('source_version')} — release अभी पहुँचा नहीं या rollback हुआ है", '1 घंटे बाद भी ऐसा हो तो Claude को बताओ')
        if site.get('admin_ok') is False: add('admin-down', 'ऐप', 'warn', 'Admin Studio नहीं खुल रहा', 'Claude को बताओ', SITE + 'admin/')
    for w in g.get('workflows', []):
        if w.get('error'): add('wf-' + w['file'], 'Robots', 'warn', f"{w['label']}: हाल नहीं पता चला", '', w['page'])
        elif w.get('last_conclusion') == 'failure':
            add('wf-' + w['file'], 'Robots' if w.get('kind') != 'test' else 'Tests', 'bad', f"{w['label']} पिछली बार fail हुआ" + (f" — {w['diagnosis']['cause']}" if w.get('diagnosis') else ''),
                (w.get('diagnosis') or {}).get('fix', 'लाल run खोलकर Claude को link भेजो'), w.get('last_url') or w['page'], w.get('diagnosis'))
        elif w.get('running'): add('wf-run-' + w['file'], 'Robots', 'ok', f"{w['label']} अभी चल रहा है")
    if not any(w.get('last_conclusion') == 'failure' for w in g.get('workflows', [])): add('robots-ok', 'Robots', 'ok', 'सारे robots और tests ठीक')
    if tests.get('failed_suites'): add('tests-failed', 'Tests', 'bad', f"{len(tests['failed_suites'])} test suite fail: {', '.join(tests['failed_suites'][:4])}", 'Claude: "fail tests ठीक करो"', tests.get('run_url', ''))
    elif tests.get('suites'): add('tests-ok', 'Tests', 'ok', f"{len(tests['suites'])} test suites · {tests.get('passed')} checks पास")
    if not sb.get('ok'): add('db-down', 'Server', 'bad', 'Supabase server से जवाब नहीं आया', 'supabase.com पर project paused तो नहीं? Claude को बताओ')
    else:
        q = sb['questions']; st = sb.get('settings') or {}
        add('db-up', 'Server', 'ok', f"Server चालू · {q['live']} सवाल live · {sb.get('ms')} ms")
        if q['broken_live']: add('q-broken', 'सवाल', 'bad', f"{q['broken_live']} live सवाल अधूरे/टूटे (answer, option या text)", 'Control Room → सवाल → "टूटे" → Hide करो या Claude से ठीक कराओ')
        if q.get('dup_options_live'): add('q-dupopt', 'सवाल', 'warn', f"{q['dup_options_live']} live सवालों में दो options एक जैसे", 'Control Room → सवाल → "Options एक जैसे" देखो')
        if q['draft'] + q['reviewed']: add('q-pending', 'सवाल', 'warn', f"{q['draft'] + q['reviewed']} सवाल publish का इंतज़ार कर रहे", 'Control Room → Publish queue', SITE + 'control/#publish')
        if q['untagged_live']: add('q-untagged', 'सवाल', 'warn', f"{q['untagged_live']} live सवाल अभी 'Mixed' में (chapter नहीं)", 'Tag Robot चलाओ या Claude को बोलो')
        if q['no_hindi_live'] > 50: add('q-hindi', 'सवाल', 'warn', f"{q['no_hindi_live']} live सवालों में Hindi नहीं", 'Hindi Robot चलाओ')
        if st.get('robots.paused') is True: add('paused', 'Control', 'warn', 'सारे robots रुके हुए हैं (Global pause)', 'Control Room → Emergency → Resume')
        if st.get('data.frozen') is True: add('frozen', 'Control', 'warn', 'Data बदलना बंद (Freeze) है', 'Control Room → Emergency → Unfreeze')
        if (st.get('maintenance') or {}).get('on'): add('maint', 'Control', 'warn', 'ऐप Maintenance mode में है', 'Control Room → Emergency → Maintenance बंद')
        stu = sb.get('students', {})
        if 'error' not in stu: add('students', 'Students', 'ok', f"{stu['total']} students · 7 दिन में {stu['active_7d']} active · {stu['answers_7d']} जवाब · {stu['tests_7d']} टेस्ट")
        db = sb.get('db') or {}
        if 'integrity' in db:
            i = db['integrity']
            if i.get('orphan_questions'): add('db-orphan', 'Database', 'bad', f"{i['orphan_questions']} सवालों का topic गायब", 'Claude को बताओ')
            if i.get('duplicate_live'): add('db-dupe', 'Database', 'warn', f"{i['duplicate_live']} live सवाल duplicate (एक जैसा text + options)", 'Control Room → सवाल → Duplicate')
            b = db.get('backups') or {}
            last = b.get('last_at')
            if not last: add('backup-none', 'Backup', 'bad', 'अभी तक कोई backup नहीं', 'Control Room → Backup → "अभी backup लो"')
            else:
                age = (NOW - datetime.fromisoformat(last.replace('Z', '+00:00'))).total_seconds() / 3600
                if age > 36: add('backup-old', 'Backup', 'bad', f'आख़िरी backup {round(age)} घंटे पुराना', 'Backup Robot चलाओ')
                else: add('backup-ok', 'Backup', 'ok', f"Backup {round(age)} घंटे पहले · कुल {b.get('count')} · आख़िरी जाँच {'ठीक' if b.get('last_verified') else 'बाकी'}")
            if (db.get('client_errors_24h') or 0) > 20: add('client-errors', 'ऐप', 'warn', f"24 घंटे में {db['client_errors_24h']} app errors (students के phone पर)", 'Control Room → Alerts → App errors देखो')
            pct = 100 * (db.get('db_bytes') or 0) / FREE['db_bytes']
            if pct > 80: add('db-size', 'Usage', 'bad' if pct > 95 else 'warn', f'Database {round(pct)}% भर गया (free 500 MB)', 'पुराने backup कम करो (backup.keep) या Claude को बताओ')
            if (db.get('auth') or {}).get('admins', 1) > 1: add('admins', 'Security', 'warn', f"{db['auth']['admins']} admins हैं — क्या सब आपके हैं?", 'Supabase में admins table जाँचो')
        elif isinstance(db, dict) and db.get('error'): add('db-stats', 'Database', 'warn', 'Database stats नहीं मिले', 'Claude: V4 schema जाँचो')
    tk = (sb.get('tasks') or {})
    if tk.get('stuck'): add('tasks-stuck', 'Tasks', 'warn', f"{len(tk['stuck'])} task 1 घंटे से अटके: #{', #'.join(map(str, tk['stuck'][:5]))}", 'Control Room → Tasks → Pause/Retry')
    if (tk.get('by_status') or {}).get('waiting_approval'): add('tasks-approval', 'Tasks', 'warn', f"{tk['by_status']['waiting_approval']} task आपकी मंज़ूरी का इंतज़ार कर रहे", 'Control Room → Tasks → Approve / Reject', SITE + 'control/#tasks')
    failed_tasks = tk.get('failed_recent')
    if isinstance(failed_tasks, list):
        # A later successful PYQ Robot run supersedes older failed Control Room import attempts.
        # Keep unrelated failed tasks visible; never mutate task records from the health audit.
        pyq = next((w for w in g.get('workflows', []) if w.get('file') == 'pyq-robot.yml'), {})
        success_at = pyq.get('last_success_at')
        unresolved = []
        for task in failed_tasks:
            superseded = False
            if task.get('intent') == 'import' and 'pyq import' in (task.get('title') or '').lower() and success_at and task.get('updated_at'):
                try:
                    task_at = datetime.fromisoformat(task['updated_at'].replace('Z', '+00:00'))
                    success_time = datetime.fromisoformat(success_at.replace('Z', '+00:00'))
                    superseded = success_time > task_at
                except (TypeError, ValueError):
                    superseded = False
            if not superseded:
                unresolved.append(task)
        failed_count = len(unresolved)
    else:
        failed_count = (tk.get('by_status') or {}).get('failed', 0)
    if failed_count: add('tasks-failed', 'Tasks', 'warn', f"{failed_count} unresolved task fail हुए (हाल के 40 में; बाद की सफल PYQ import से पुराने import failures अलग)", 'Control Room → Tasks → Retry')
    qu = sb.get('queue') or {}
    if qu.get('stuck'): add('queue-stuck', 'Robots', 'warn', f"{len(qu['stuck'])} request 30 मिनट से कतार में", 'Ops Robot का schedule देर से चल रहा — Robots → Ops Robot → Run')
    for w in g.get('workflows', []):
        if w.get('running') and w.get('timeout') and w.get('history'):
            r0 = w['history'][0]
            try:
                age = (NOW - datetime.fromisoformat(r0['at'].replace('Z', '+00:00'))).total_seconds() / 60
                if r0['c'] in ('in_progress', 'queued') and age > w['timeout'] + 15: add('stuck-' + w['file'], 'Robots', 'warn', f"{w['label']} {round(age)} मिनट से चल रहा (timeout {w['timeout']})", 'Robots → रोको, फिर Retry', w['page'])
            except Exception: pass
    de = s.get('design') or {}
    sm = de.get('smoke') or {}
    if sm.get('ok') is False: add('smoke-fail', 'Deploy', 'bad', 'Deploy के बाद smoke test fail: ' + '; '.join(c['name'] for c in sm.get('checks', []) if not c['ok']), 'Rollback पर विचार करें / Claude को बताओ', sm.get('url', ''))
    elif sm.get('ok'): add('smoke-ok', 'Deploy', 'ok', f"Deploy के बाद smoke test पास ({sm.get('want')})")
    au = de.get('audit') or {}
    if au.get('overflow'): add('design-overflow', 'Design', 'warn', f"{len(au['overflow'])} screens पर sideways scroll", 'Control Room → Design', SITE + 'control/#design')
    if au.get('page_errors'): add('design-errors', 'Design', 'warn', f"Design audit में {len(au['page_errors'])} page errors", 'Control Room → Design')
    open_tables = [t for t, v in (sec.get('anon') or {}).items() if v == 'खुला!']
    if open_tables: add('sec-anon', 'Security', 'bad', f"बिना login के दिख रहा है: {', '.join(open_tables)}", 'तुरंत Claude को बताओ (RLS)')
    elif sec.get('anon'): add('sec-anon-ok', 'Security', 'ok', f"{len(sec['anon'])} private tables बिना login के बंद")
    if sec.get('secrets'): add('sec-secret', 'Security', 'bad', f"Repo में secret जैसा कुछ मिला: {', '.join(x['file'] for x in sec['secrets'][:3])}", 'तुरंत key बदलो और Claude को बताओ')
    if g.get('issues'): add('gh-issues', 'GitHub', 'warn', f"{g['issues']} खुले issue", 'GitHub → Issues देखो', f'https://github.com/{REPO}/issues')
    order = {'bad': 0, 'warn': 1, 'ok': 2}
    C.sort(key=lambda c: order[c['level']])
    overall = 'bad' if any(c['level'] == 'bad' for c in C) else 'warn' if any(c['level'] == 'warn' for c in C) else 'ok'
    return overall, C


# ---------------------------------------------------------------- incidents + issue
def sync_incidents(checks, dry):
    if dry or not SB_KEY: return 'skipped'
    try:
        bad = {c['id']: c for c in checks if c['level'] == 'bad'}
        open_ = {i['key']: i for i in sb_get_all('ops_incidents', 'id,key,seen_count', '&status=eq.open')}
        for k, c in bad.items():
            if k in open_: sb_write('PATCH', f"ops_incidents?id=eq.{open_[k]['id']}", {'last_seen': NOW.isoformat(), 'seen_count': (open_[k]['seen_count'] or 1) + 1, 'detail': c['msg'][:500]})
            else: sb_write('POST', 'ops_incidents', [{'key': k, 'severity': 'critical' if c['area'] in ('ऐप', 'Server', 'Security') else 'major', 'area': c['area'], 'title': c['msg'][:200],
                                                     'detail': c['msg'][:500], 'suggestion': c.get('todo', '')[:300]}])
        for k, i in open_.items():
            if k not in bad: sb_write('PATCH', f"ops_incidents?id=eq.{i['id']}", {'status': 'resolved', 'resolved_at': NOW.isoformat()})
        return f'{len(bad)} open'
    except Exception as e:
        return 'error: ' + str(e)[:80]


ISSUE_TITLE = '🚨 App health: ध्यान दो'


def sync_issue(overall, checks, dry, enabled=True):
    if dry or not GH_TOKEN or not enabled: return 'skipped'
    try:
        open_issues = [i for i in (gh('/issues?state=open&per_page=50') or []) if i.get('title') == ISSUE_TITLE]
        bad = [c for c in checks if c['level'] == 'bad']
        if bad:
            body = 'Health Robot को ये दिक्कतें मिलीं:\n\n' + '\n'.join(f"- **{c['area']}**: {c['msg']}" + (f" — {c['todo']}" if c['todo'] else '') + (f" ([खोलो]({c['link']}))" if c['link'] else '') for c in bad)
            body += f"\n\nपूरी रिपोर्ट: {SITE}control/\n\n_यह issue अपने-आप बंद हो जाएगा जब सब ठीक होगा।_"
            if open_issues: gh(f"/issues/{open_issues[0]['number']}", 'PATCH', {'body': body})
            else: gh('/issues', 'POST', {'title': ISSUE_TITLE, 'body': body})
            return 'open'
        for i in open_issues:
            gh(f"/issues/{i['number']}/comments", 'POST', {'body': '✅ सब ठीक हो गया — Health Robot ने issue बंद किया।'})
            gh(f"/issues/{i['number']}", 'PATCH', {'state': 'closed'})
        return 'closed' if open_issues else 'none'
    except Exception as e:
        return 'error: ' + str(e)[:80]


def main(a):
    out = a[a.index('--out') + 1] if '--out' in a else 'status.json'
    hist = a[a.index('--history') + 1] if '--history' in a else None
    dry = '--dry-run' in a
    if not SB_KEY: print('❌ SUPABASE_SECRET_KEY नहीं मिला'); return 1
    s = {'at': NOW.isoformat(timespec='seconds'), 'repo': REPO, 'site_url': SITE, 'schema': 2}
    s['site'] = collect_site(); s['github'] = collect_github(); s['tests'] = collect_tests(s['github'])
    s['keycheck'] = collect_keycheck(); s['supabase'] = collect_supabase(); s['security'] = collect_security()
    s['design'] = collect_design()
    s['usage'] = collect_usage(s)
    s['overall'], s['checks'] = evaluate(s)
    s['incidents_sync'] = sync_incidents(s['checks'], dry)
    s['issue'] = sync_issue(s['overall'], s['checks'], dry, (s['supabase'].get('settings') or {}).get('alerts.issue', True) is not False)
    s['next_check'] = cron_next('23 */2 * * *')
    json.dump(s, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    if hist:
        try: h = json.load(open(hist, encoding='utf-8'))
        except Exception: h = []
        q, st = s['supabase'].get('questions', {}), s['supabase'].get('students', {})
        db = s['supabase'].get('db') or {}
        h.append({'at': s['at'], 'overall': s['overall'], 'live': q.get('live'), 'pending': (q.get('draft') or 0) + (q.get('reviewed') or 0), 'untagged': q.get('untagged_live'),
                  'students': st.get('total'), 'active_7d': st.get('active_7d'), 'answers_1d': st.get('answers_1d'), 'ms': s['site'].get('ms'),
                  'db_mb': round((db.get('db_bytes') or 0) / 1024 ** 2, 1), 'bad': sum(c['level'] == 'bad' for c in s['checks'])})
        json.dump(h[-240:], open(hist, 'w', encoding='utf-8'), ensure_ascii=False)
    icon = {'ok': '🟢', 'warn': '🟡', 'bad': '🔴'}
    lines = [f"## {icon[s['overall']]} App health — {s['at']}"] + [f"- {icon[c['level']]} **{c['area']}**: {c['msg']}" + (f" → {c['todo']}" if c['todo'] else '') for c in s['checks']]
    print('\n'.join(lines))
    if os.environ.get('GITHUB_STEP_SUMMARY'): open(os.environ['GITHUB_STEP_SUMMARY'], 'a').write('\n'.join(lines) + f"\n\nControl Room: {SITE}control/\n")
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
