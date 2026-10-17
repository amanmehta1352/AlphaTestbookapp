"""⚙️ Ops Robot — the worker behind the Control Room. Runs on GitHub Actions every 10 minutes (ops-robot.yml),
after robot runs (inside the Health Robot) and by hand. No Claude usage, no personal token (GITHUB_TOKEN only).
  python3 dev/tools/ops/ops_robot.py [--dry-run] [--no-tasks] [--budget SECONDS]

1. Requests (table ops_requests, one-shot buttons):
   run            target = workflow file from ALLOWED; params = inputs; params.retry_run_id = re-run failed jobs
   cancel         target = workflow file, or "all" = Emergency stop (cancel every running/queued robot run)
   backup / verify_backup / rollback (params.sha)
   Duplicates of the same queued request are rejected ("duplicate").
2. Tasks (table ops_tasks, from the Command Console): steps run one after another with checkpoints, so a task
   continues on the next run if this one ends. A lease (ops_settings 'ops.lease') stops two workers at once.
   Step types: workflow · backup · verify_backup · verify_links · setting · cancel_runs · merge_branch · publish_passing · note
3. Auto-retry policy: low-risk robots (health, backup, key-check, tests) whose last run failed get ONE automatic
   re-run of the failed jobs (setting retry.auto, retry.max).
"""
import json, os, re, sys, time, urllib.request
from datetime import datetime, timezone, timedelta
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import opslib

REPO = os.environ.get('GITHUB_REPOSITORY', 'amanmehta1352/AlphaTestbookapp')
GH_TOKEN = os.environ.get('GITHUB_TOKEN', '').strip()
ALLOWED = {  # workflow file -> allowed input names
    'pyq-robot.yml': {'links', 'dry_run'},
    'hindi-robot.yml': {'shards'},
    'tag-robot.yml': {'dry_run'},
    'key-check-robot.yml': {'scope', 'gemini', 'limit', 'offset'},
    'health-robot.yml': set(),
    'backup-robot.yml': {'note'},
    'tests.yml': set(),
    'design-audit.yml': {'target'},
    'smoke.yml': set(),
    'selective-restore.yml': {'sha', 'paths', 'reason', 'branch'},
}
CANCELLABLE = {'pyq-robot.yml', 'hindi-robot.yml', 'tag-robot.yml', 'key-check-robot.yml', 'backup-robot.yml', 'design-audit.yml', 'selective-restore.yml'}
AUTO_RETRY = ['health-robot.yml', 'backup-robot.yml', 'key-check-robot.yml', 'tests.yml']
ACTOR = 'ops-robot'
NOW = lambda: datetime.now(timezone.utc)
ISO = lambda d=None: (d or NOW()).strftime('%Y-%m-%dT%H:%M:%SZ')


def gh(path, method='GET', body=None):
    h = {'Accept': 'application/vnd.github+json', 'User-Agent': 'mtb-ops', 'Authorization': 'Bearer ' + GH_TOKEN}
    data = None
    if body is not None: h['Content-Type'] = 'application/json'; data = json.dumps(body).encode()
    req = urllib.request.Request('https://api.github.com/repos/' + REPO + path, method=method, headers=h, data=data)
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            t = r.read().decode(); return json.loads(t) if t else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'GitHub {e.code}: {e.read().decode()[:200]}')


def clean_inputs(wf, params):
    ok = ALLOWED[wf]; out = {}
    for k, v in (params or {}).items():
        if k in ok and v not in (None, ''):
            v = str(v).lower() if isinstance(v, bool) else str(v)
            if len(v) > 3000: raise ValueError(f'input {k} too long')
            out[k] = v
    return out


def dispatch(wf, inputs, dry=False):
    if wf not in ALLOWED: raise ValueError(f'"{wf}" चलाने की अनुमति नहीं')
    inputs = clean_inputs(wf, inputs)
    if wf == 'pyq-robot.yml' and not inputs.get('links'): raise ValueError('PYQ Robot को PDF links चाहिए')
    if wf == 'selective-restore.yml' and not (re.fullmatch(r'[0-9a-f]{7,40}', inputs.get('sha', '')) and inputs.get('paths')): raise ValueError('sha और paths चाहिए')
    if not dry: gh(f'/actions/workflows/{wf}/dispatches', 'POST', {'ref': 'main', 'inputs': inputs})
    return inputs


def cancel_runs(target, dry=False):
    files = CANCELLABLE if target == 'all' else ({target} if target in CANCELLABLE else set())
    if not files: raise ValueError(f'"{target}" रोका नहीं जा सकता')
    n = 0
    for f in sorted(files):
        for st in ('in_progress', 'queued', 'waiting'):
            for run in (gh(f'/actions/workflows/{f}/runs?status={st}&per_page=20') or {}).get('workflow_runs', []):
                if not dry: gh(f"/actions/runs/{run['id']}/cancel", 'POST', {})
                n += 1
    return n


# ---------------------------------------------------------------- 1. requests
def handle(r, dry=False):
    """-> (status, result text)"""
    a, target, p = r['action'], (r.get('target') or '').strip(), r.get('params') or {}
    if a == 'run':
        if target not in ALLOWED: return 'rejected', f'"{target}" चलाने की अनुमति नहीं'
        if p.get('retry_run_id'):
            rid = int(p['retry_run_id'])
            run = gh(f'/actions/runs/{rid}')
            if run.get('path', '').split('/')[-1] != target: return 'rejected', 'run इस robot का नहीं है'
            if dry: return 'done', f'(dry) re-run failed jobs of {rid}'
            gh(f'/actions/runs/{rid}/rerun-failed-jobs', 'POST', {})
            return 'sent', f'run {rid} के fail हिस्से दोबारा चलाए'
        try: inputs = dispatch(target, p, dry)
        except ValueError as e: return 'rejected', str(e)
        return ('done' if dry else 'sent'), f'{"(dry) " if dry else ""}{target} शुरू किया'
    if a == 'cancel':
        try: n = cancel_runs(target, dry)
        except ValueError as e: return 'rejected', str(e)
        return 'done', f'{n} run रोके' + (' (Emergency stop)' if target == 'all' else '')
    if a == 'backup':
        if dry: return 'done', '(dry) backup'
        b = opslib.sb('POST', '/rest/v1/rpc/ops_backup_now', {'p_kind': 'manual', 'p_note': str(p.get('note') or 'Control Room से')[:200]}, actor=ACTOR, timeout=180)
        v = opslib.sb('POST', '/rest/v1/rpc/ops_backup_verify', {'p_id': b['id']}, actor=ACTOR, timeout=180)
        return ('done' if v == 'ok' else 'failed'), f"backup #{b['id']} बना · जाँच: {v} · सवाल {b['counts'].get('questions')}"
    if a == 'verify_backup':
        if dry: return 'done', '(dry) verify'
        v = opslib.sb('POST', '/rest/v1/rpc/ops_backup_verify', {'p_id': int(p.get('id'))}, actor=ACTOR, timeout=180)
        return ('done' if v == 'ok' else 'failed'), f"backup #{p.get('id')} जाँच: {v}"
    if a == 'rollback':
        sha = str(p.get('sha') or '')
        if not re.fullmatch(r'[0-9a-f]{7,40}', sha): return 'rejected', 'सही commit (sha) नहीं'
        if dry: return 'done', f'(dry) rollback {sha}'
        gh('/actions/workflows/rollback.yml/dispatches', 'POST', {'ref': 'main', 'inputs': {'sha': sha, 'reason': str(p.get('reason') or '')[:200]}})
        return 'sent', f'rollback robot शुरू ({sha[:7]})'
    return 'rejected', f'अनजान काम "{a}"'


def do_requests(dry, lines):
    reqs = opslib.sb('GET', '/rest/v1/ops_requests?select=*&status=eq.queued&order=id&limit=30', actor=ACTOR) or []
    seen = set(); done = 0
    for r in reqs:
        sig = json.dumps([r['action'], r.get('target'), r.get('params')], sort_keys=True)
        if sig in seen: status, result = 'rejected', 'duplicate — यही काम पहले से कतार में था'
        else:
            seen.add(sig)
            try: status, result = handle(r, dry)
            except Exception as e: status, result = 'failed', str(e)[:300]
        done += status in ('sent', 'done')
        lines.append(f"- request #{r['id']} {r['action']} {r.get('target') or ''}: **{status}** — {result}")
        if not dry:
            opslib.sb('PATCH', f"/rest/v1/ops_requests?id=eq.{r['id']}&status=eq.queued", {'status': status, 'result': result, 'handled_at': ISO()}, actor=ACTOR, prefer='return=minimal')
    return len(reqs), done


# ---------------------------------------------------------------- 2. tasks
def lease(take=True):
    """Only one worker at a time. Returns True if we hold the lease."""
    until = ISO(NOW() + timedelta(minutes=12)) if take else ISO(NOW() - timedelta(seconds=1))
    try:
        if take:
            r = opslib.sb('PATCH', f"/rest/v1/ops_settings?key=eq.ops.lease&value->>until=lt.{ISO()}", {'value': {'until': until, 'by': os.environ.get('GITHUB_RUN_ID', 'local')}}, actor=ACTOR, prefer='return=representation')
            if r: return True
            if not opslib.sb('GET', '/rest/v1/ops_settings?select=key&key=eq.ops.lease', actor=ACTOR):
                opslib.sb('POST', '/rest/v1/ops_settings', [{'key': 'ops.lease', 'value': {'until': until, 'by': os.environ.get('GITHUB_RUN_ID', 'local')}, 'label': 'Ops worker lease (internal)'}], actor=ACTOR, prefer='return=minimal')
                return True
            return False
        opslib.sb('PATCH', '/rest/v1/ops_settings?key=eq.ops.lease', {'value': {'until': until, 'by': 'released'}}, actor=ACTOR, prefer='return=minimal')
        return True
    except Exception as e:
        print('lease error:', str(e)[:120]); return False


def find_run(wf, since_iso):
    runs = (gh(f'/actions/workflows/{wf}/runs?event=workflow_dispatch&per_page=10') or {}).get('workflow_runs', [])
    cands = [r for r in runs if r.get('created_at', '') >= since_iso[:19]]
    return sorted(cands, key=lambda r: r['created_at'])[0] if cands else None


def verify_links(urls):
    out = []
    try: known = {b.get('source_url') for b in (opslib.sb('GET', '/rest/v1/import_batches?select=source_url&source_url=not.is.null', actor=ACTOR) or [])}
    except Exception: known = set()
    for u in urls[:30]:
        row = {'url': u}
        if not re.match(r'^https://[\w.-]+/', u): row.update(ok=False, why='https:// से शुरू नहीं'); out.append(row); continue
        try:
            req = urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0', 'Range': 'bytes=0-1023'})
            with urllib.request.urlopen(req, timeout=40) as r:
                head = r.read(1024); row['http'] = r.status
                row['pdf'] = head.startswith(b'%PDF-'); row['size'] = r.headers.get('Content-Range', '').split('/')[-1] or r.headers.get('Content-Length')
            row['ok'] = row['pdf']; row['why'] = 'PDF ठीक' if row['pdf'] else 'यह link PDF नहीं देता'
        except Exception as e:
            row.update(ok=False, why=f'खुला नहीं: {str(e)[:80]}')
        row['already_imported'] = u in known
        if row['already_imported']: row['why'] += ' · पहले import हो चुका'
        out.append(row)
    return out


def run_step(task, i, step, dry):
    """Advance one step. Returns 'done' | 'failed' | 'running' and mutates step."""
    t = step.get('type')
    if step.get('status') == 'running' and t == 'workflow':
        run = gh(f"/actions/runs/{step['run_id']}") if step.get('run_id') else find_run(step['file'], step['dispatched_at'])
        if not run:
            if NOW() - datetime.fromisoformat(step['dispatched_at'].replace('Z', '+00:00')) > timedelta(minutes=20):
                step['error'] = 'run 20 मिनट में शुरू नहीं हुआ'; return 'failed'
            return 'running'
        step['run_id'] = run['id']; step['url'] = run['html_url']
        if run['status'] != 'completed': return 'running'
        step['conclusion'] = run['conclusion']
        if run['conclusion'] == 'success': return 'done'
        step['error'] = f"run {run['conclusion']}"; return 'failed'
    if t == 'workflow':
        step['inputs'] = dispatch(step['file'], step.get('inputs') or {}, dry)
        step['dispatched_at'] = ISO(NOW() - timedelta(seconds=5))
        return 'done' if dry else 'running'
    if t == 'backup':
        if dry: return 'done'
        b = opslib.sb('POST', '/rest/v1/rpc/ops_backup_now', {'p_kind': 'manual', 'p_note': f"task #{task['id']}"}, actor=ACTOR, timeout=180)
        v = opslib.sb('POST', '/rest/v1/rpc/ops_backup_verify', {'p_id': b['id']}, actor=ACTOR, timeout=180)
        step['result'] = {'backup_id': b['id'], 'verify': v, 'counts': b['counts']}
        return 'done' if v == 'ok' else 'failed'
    if t == 'verify_backup':
        bid = step.get('id') or (opslib.sb('POST', '/rest/v1/rpc/ops_backup_list', {}, actor=ACTOR) or [{}])[0].get('id')
        if not bid: step['error'] = 'कोई backup नहीं'; return 'failed'
        v = 'ok' if dry else opslib.sb('POST', '/rest/v1/rpc/ops_backup_verify', {'p_id': int(bid)}, actor=ACTOR, timeout=180)
        step['result'] = {'backup_id': bid, 'verify': v}
        return 'done' if v == 'ok' else 'failed'
    if t == 'verify_links':
        res = verify_links(step.get('urls') or [])
        step['result'] = {'ok': sum(r['ok'] and not r['already_imported'] for r in res), 'bad': sum(not r['ok'] for r in res), 'already': sum(r['already_imported'] for r in res), 'links': res}
        good = [r['url'] for r in res if r['ok'] and not r['already_imported']]
        for nxt in task['steps'][i + 1:]:   # pass only verified, new links to the import step
            if nxt.get('type') == 'workflow' and nxt.get('file') == 'pyq-robot.yml' and nxt.get('use_verified'):
                nxt.setdefault('inputs', {})['links'] = '\n'.join(good)
                if not good: nxt['status'] = 'skipped'; nxt['error'] = 'कोई नया सही link नहीं'
        return 'done'
    if t == 'setting':
        if not dry: opslib.sb('PATCH', '/rest/v1/ops_settings?key=eq.' + step['key'], {'value': step['value']}, actor=ACTOR, prefer='return=minimal')
        return 'done'
    if t == 'cancel_runs':
        step['result'] = {'cancelled': cancel_runs(step.get('target', 'all'), dry)}; return 'done'
    if t == 'merge_branch':
        br = step.get('branch', '')
        if not re.fullmatch(r'restore/[\w.-]+', br): step['error'] = 'सिर्फ़ restore/* branch merge हो सकती है'; return 'failed'
        if not dry:
            r = gh('/merges', 'POST', {'base': 'main', 'head': br, 'commit_message': f"Selective restore merge ({br}) — task #{task['id']}"})
            step['result'] = {'sha': (r or {}).get('sha', 'already merged')}
        return 'done'
    if t == 'publish_passing':
        rows = opslib.sb('GET', '/rest/v1/questions?select=id,answer,options,question_en,question_hi&status=in.(draft,reviewed)&is_active=is.true&limit=2000', actor=ACTOR) or []
        def ok(q):
            o = q.get('options') or []; tx = [str(x.get('en') or x.get('hi') or '').strip().lower() for x in o]
            return q.get('answer') in ('A', 'B', 'C', 'D') and len(o) == 4 and all(tx) and len(set(tx)) == 4 and len(str(q.get('question_en') or q.get('question_hi') or '').strip()) >= 8
        ids = [q['id'] for q in rows if ok(q)]; n = 0
        if not dry:
            for k in range(0, len(ids), 500):
                n += opslib.sb('POST', '/rest/v1/rpc/ops_question_action', {'p_ids': ids[k:k + 500], 'p_action': 'publish', 'p_reason': f"task #{task['id']} (owner approved)"}, actor=ACTOR, timeout=120) or 0
        step['result'] = {'checked': len(rows), 'passed': len(ids), 'published': n, 'held_back': len(rows) - len(ids)}
        return 'done'
    if t == 'note':
        return 'done'
    step['error'] = f'अनजान step "{t}"'; return 'failed'


def save_task(t, **extra):
    body = {'steps': t['steps'], 'status': t['status'], 'current_step': t.get('current_step', 0), 'logs': t['logs'][-60:], 'updated_at': ISO(), **extra}
    opslib.sb('PATCH', f"/rest/v1/ops_tasks?id=eq.{t['id']}", body, actor=ACTOR, prefer='return=minimal')


def final_report(t):
    lines = [f"Task #{t['id']} — {t['title']}", f"Status: {t['status']}"]
    for i, s in enumerate(t['steps'], 1):
        ev = s.get('url') or (json.dumps(s.get('result'), ensure_ascii=False)[:180] if s.get('result') else '')
        lines.append(f"{i}. {s.get('label') or s.get('type')}: {s.get('status', 'pending')}" + (f" — {s.get('error')}" if s.get('error') else '') + (f" · प्रमाण: {ev}" if ev else ''))
    return '\n'.join(lines)[:8000]


def do_tasks(dry, lines, budget):
    if not lease(True): lines.append('- tasks: दूसरा worker चल रहा है, छोड़ा'); return 0
    started = time.time(); moved = 0
    try:
        while True:
            tasks = opslib.sb('GET', '/rest/v1/ops_tasks?select=*&status=in.(queued,running)&order=priority,id&limit=10', actor=ACTOR) or []
            waiting = False
            for t in tasks:
                if t['status'] == 'queued':
                    t['status'] = 'running'; t['logs'].append({'at': ISO(), 'msg': 'शुरू', 'by': ACTOR})
                    if not dry: save_task(t, started_at=ISO())
                for i, s in enumerate(t['steps']):
                    if s.get('status') in ('done', 'skipped'): continue
                    t['current_step'] = i
                    try: st = run_step(t, i, s, dry)
                    except Exception as e: st = 'failed'; s['error'] = str(e)[:300]
                    if st == 'running':
                        if s.get('status') != 'running': t['logs'].append({'at': ISO(), 'msg': f"step {i + 1} चल रहा: {s.get('label') or s.get('type')}", 'by': ACTOR})
                        s['status'] = 'running'; waiting = True; break
                    s['status'] = st; s['finished_at'] = ISO(); moved += 1
                    t['logs'].append({'at': ISO(), 'msg': f"step {i + 1} {st}: {s.get('label') or s.get('type')}" + (f" — {s['error']}" if s.get('error') else ''), 'by': ACTOR})
                    if st == 'failed' and not s.get('optional'):
                        t['status'] = 'failed'; break
                else:
                    t['status'] = 'completed'
                if t['status'] in ('completed', 'failed'):
                    ver = {'all_steps_done': all(s.get('status') in ('done', 'skipped') for s in t['steps']),
                           'evidence': [s.get('url') for s in t['steps'] if s.get('url')], 'checked_at': ISO()}
                    t['report'] = final_report(t)
                    if not dry: save_task(t, report=t['report'], verification=ver, finished_at=ISO())
                    lines.append(f"- task #{t['id']} {t['title']}: **{t['status']}**")
                elif not dry: save_task(t)
            if not waiting or time.time() - started > budget: break
            time.sleep(20)
    finally:
        if not dry: lease(False)
    return moved


# ---------------------------------------------------------------- 3. auto-retry policy
def auto_retry(dry, lines):
    try: s = opslib.settings(ACTOR)
    except Exception: return 0
    if s.get('retry.auto', True) is False or s.get('robots.paused') is True: return 0
    mx = int(s.get('retry.max', 1) or 1); n = 0
    for wf in AUTO_RETRY:
        try:
            runs = (gh(f'/actions/workflows/{wf}/runs?per_page=1&branch=main') or {}).get('workflow_runs', [])
            if not runs: continue
            r = runs[0]; age = NOW() - datetime.fromisoformat(r['updated_at'].replace('Z', '+00:00'))
            if r['status'] == 'completed' and r['conclusion'] == 'failure' and (r.get('run_attempt') or 1) <= mx and timedelta(minutes=10) < age < timedelta(hours=24):
                if not dry: gh(f"/actions/runs/{r['id']}/rerun-failed-jobs", 'POST', {})
                lines.append(f"- auto-retry: {wf} run {r['id']} (attempt {(r.get('run_attempt') or 1) + 1})"); n += 1
        except Exception as e:
            lines.append(f'- auto-retry {wf}: {str(e)[:80]}')
    return n


def main(a):
    dry = '--dry-run' in a
    budget = int(a[a.index('--budget') + 1]) if '--budget' in a else 480
    if not opslib.key(): print('❌ SUPABASE_SECRET_KEY नहीं मिला'); return 1
    if not GH_TOKEN and not dry: print('❌ GITHUB_TOKEN नहीं मिला'); return 1
    lines = ['## ⚙️ Ops Robot']
    nreq, ok = do_requests(dry, lines)
    moved = 0 if '--no-tasks' in a else do_tasks(dry, lines, budget)
    retried = auto_retry(dry, lines)
    print('\n'.join(lines))
    if os.environ.get('GITHUB_STEP_SUMMARY') and len(lines) > 1: open(os.environ['GITHUB_STEP_SUMMARY'], 'a').write('\n'.join(lines) + '\n')
    if nreq or moved or retried: opslib.write_counts(nreq + moved, ok + moved + retried, f'{nreq} requests · {moved} task steps · {retried} auto-retries')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
