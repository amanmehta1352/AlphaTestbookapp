"""Shared helpers for all robots: Control Room settings (pause / enable / freeze), robot identity, run records.
CLI (used as the first and last step of every robot workflow):
  python3 dev/tools/ops/opslib.py gate <robot>           -> writes run=true|false to $GITHUB_OUTPUT, explains why
  python3 dev/tools/ops/opslib.py record <robot> <job-status> [counts.json]
Robots: pyq, hindi, tag, keycheck, backup, health, ops.
Rules (also shown in the Control Room):
  - "data writers" (pyq, hindi, tag) stop when robots.paused OR data.frozen OR robot.<id>.enabled = false
  - keycheck stops when robots.paused OR disabled;  backup / health / ops stop only when disabled (they protect the app)
  - if settings cannot be read, data writers do NOT run (safe side); others run.
Secrets come only from env (SUPABASE_SECRET_KEY) and are never printed.
"""
import json, os, sys, time, urllib.parse, urllib.request

SB_URL = os.environ.get('SUPABASE_URL', 'https://fzkvwkrbtykucjfdqiin.supabase.co').rstrip('/')
WRITERS = {'pyq', 'hindi', 'tag'}
PAUSABLE = WRITERS | {'keycheck'}


def key():
    return os.environ.get('SUPABASE_SECRET_KEY', '').strip()


def headers(actor, extra=None):
    k = key(); h = {'apikey': k, 'Content-Type': 'application/json', 'x-actor': actor}
    if k.startswith('eyJ'): h['Authorization'] = 'Bearer ' + k
    h.update(extra or {}); return h


def sb(method, path, body=None, actor='robot', prefer=None, timeout=60):
    h = headers(actor, {'Prefer': prefer} if prefer else None)
    req = urllib.request.Request(SB_URL + path, method=method, headers=h, data=None if body is None else json.dumps(body, ensure_ascii=False).encode())
    for a in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                t = r.read().decode(); return json.loads(t) if t else None
        except urllib.error.HTTPError as e:
            if e.code >= 500 and a < 2: time.sleep(4); continue
            raise RuntimeError(f'server {e.code}: {e.read().decode()[:300]}')
        except urllib.error.URLError:
            if a < 2: time.sleep(4); continue
            raise


def settings(actor='robot'):
    rows = sb('GET', '/rest/v1/ops_settings?select=key,value', actor=actor) or []
    return {r['key']: r['value'] for r in rows}


def setting(name, default=None, actor='robot'):
    try: return settings(actor).get(name, default)
    except Exception: return default


def decide(robot, s):
    """-> (run: bool, reason: str)"""
    if s is None:
        return (robot not in WRITERS, 'settings पढ़ नहीं पाए' + (' — data robot सुरक्षा के लिए नहीं चलेगा' if robot in WRITERS else ''))
    if s.get(f'robot.{robot}.enabled', True) is False: return False, f'{robot} robot Control Room से बंद (disabled) है'
    if robot in PAUSABLE and s.get('robots.paused') is True: return False, 'सारे robots रुके हुए हैं (Global pause)'
    if robot in WRITERS and s.get('data.frozen') is True: return False, 'Data बदलना बंद है (Freeze)'
    return True, 'चालू'


def gate(robot):
    try: s = settings(robot + '-robot')
    except Exception as e: s = None; print('settings error:', str(e)[:160])
    run, why = decide(robot, s)
    print(('▶ चलेगा: ' if run else '⏸ नहीं चलेगा: ') + why)
    out = os.environ.get('GITHUB_OUTPUT')
    if out: open(out, 'a').write(f'run={"true" if run else "false"}\n')
    summ = os.environ.get('GITHUB_STEP_SUMMARY')
    if summ and not run: open(summ, 'a').write(f'### ⏸ {robot} robot नहीं चला: {why}\n')
    return run


def record(robot, status, counts_path=None, note=''):
    c = {}
    if counts_path and os.path.exists(counts_path):
        try: c = json.load(open(counts_path))
        except Exception: c = {}
    row = {'robot': robot, 'run_id': os.environ.get('GITHUB_RUN_ID', ''), 'finished_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
           'ok': status == 'success', 'processed': c.get('processed'), 'changed': c.get('changed'),
           'note': (c.get('note') or note or status)[:1000]}
    try: sb('POST', '/rest/v1/ops_runs', [row], actor=robot + '-robot', prefer='return=minimal'); print('run recorded:', row['ok'], row['processed'], row['changed'])
    except Exception as e: print('could not record run:', str(e)[:160])


def write_counts(processed=None, changed=None, note=''):
    """Robots call this at the end; the workflow's record step sends it to ops_runs."""
    p = os.environ.get('OPS_COUNTS')
    if p: json.dump({'processed': processed, 'changed': changed, 'note': note}, open(p, 'w'), ensure_ascii=False)


if __name__ == '__main__':
    a = sys.argv[1:]
    if not a: print(__doc__); sys.exit(1)
    if a[0] == 'gate': gate(a[1]); sys.exit(0)
    if a[0] == 'record': record(a[1], a[2] if len(a) > 2 else 'unknown', a[3] if len(a) > 3 else os.environ.get('OPS_COUNTS')); sys.exit(0)
    print(__doc__); sys.exit(1)
