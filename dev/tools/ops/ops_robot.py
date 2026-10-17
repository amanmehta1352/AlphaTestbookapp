"""⚙️ Ops Robot — carries out what the admin asked in the Control Room (table ops_requests).
Runs on GitHub Actions every 10 minutes (.github/workflows/ops-robot.yml) and by hand.
  python3 dev/tools/ops/ops_robot.py [--dry-run]
Actions (anything else is rejected):
  run            target = workflow file from ALLOWED; params = inputs (only the keys that workflow accepts);
                 params.retry_run_id = re-run only the failed jobs of that run
  cancel         target = workflow file, or "all" = Emergency stop (cancel every running/queued robot run)
  backup         params.note -> ops_backup_now('manual') + verify
  verify_backup  params.id   -> ops_backup_verify(id)
  rollback       params.sha  -> starts rollback.yml (puts the live app files of that commit back)
Uses GITHUB_TOKEN (actions: write) — no personal token anywhere. Secrets are never printed.
"""
import json, os, re, sys, time, urllib.request
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
    'backup-robot.yml': set(),
    'tests.yml': set(),
}
CANCELLABLE = {'pyq-robot.yml', 'hindi-robot.yml', 'tag-robot.yml', 'key-check-robot.yml', 'backup-robot.yml'}
ACTOR = 'ops-robot'


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
        inputs = clean_inputs(target, p)
        if target == 'pyq-robot.yml' and not inputs.get('links'): return 'rejected', 'PYQ Robot को PDF links चाहिए'
        if dry: return 'done', f'(dry) dispatch {target} {inputs}'
        gh(f'/actions/workflows/{target}/dispatches', 'POST', {'ref': 'main', 'inputs': inputs})
        return 'sent', f'{target} शुरू किया'
    if a == 'cancel':
        files = CANCELLABLE if target == 'all' else ({target} if target in CANCELLABLE else set())
        if not files: return 'rejected', f'"{target}" रोका नहीं जा सकता'
        n = 0
        for f in sorted(files):
            for st in ('in_progress', 'queued', 'waiting'):
                for run in (gh(f'/actions/workflows/{f}/runs?status={st}&per_page=20') or {}).get('workflow_runs', []):
                    if not dry: gh(f"/actions/runs/{run['id']}/cancel", 'POST', {})
                    n += 1
        return 'done', f'{n} run रोके' + (' (Emergency stop)' if target == 'all' else '')
    if a == 'backup':
        if dry: return 'done', '(dry) backup'
        b = opslib.sb('POST', '/rest/v1/rpc/ops_backup_now', {'p_kind': 'manual', 'p_note': str(p.get('note') or 'Control Room से')[:200]}, actor=ACTOR)
        v = opslib.sb('POST', '/rest/v1/rpc/ops_backup_verify', {'p_id': b['id']}, actor=ACTOR)
        return ('done' if v == 'ok' else 'failed'), f"backup #{b['id']} बना · जाँच: {v} · सवाल {b['counts'].get('questions')}"
    if a == 'verify_backup':
        if dry: return 'done', '(dry) verify'
        v = opslib.sb('POST', '/rest/v1/rpc/ops_backup_verify', {'p_id': int(p.get('id'))}, actor=ACTOR)
        return ('done' if v == 'ok' else 'failed'), f"backup #{p.get('id')} जाँच: {v}"
    if a == 'rollback':
        sha = str(p.get('sha') or '')
        if not re.fullmatch(r'[0-9a-f]{7,40}', sha): return 'rejected', 'सही commit (sha) नहीं'
        if dry: return 'done', f'(dry) rollback {sha}'
        gh('/actions/workflows/rollback.yml/dispatches', 'POST', {'ref': 'main', 'inputs': {'sha': sha, 'reason': str(p.get('reason') or '')[:200]}})
        return 'sent', f'rollback robot शुरू ({sha[:7]})'
    return 'rejected', f'अनजान काम "{a}"'


def main(a):
    dry = '--dry-run' in a
    if not opslib.key(): print('❌ SUPABASE_SECRET_KEY नहीं मिला'); return 1
    if not GH_TOKEN and not dry: print('❌ GITHUB_TOKEN नहीं मिला'); return 1
    reqs = opslib.sb('GET', '/rest/v1/ops_requests?select=*&status=eq.queued&order=id&limit=20', actor=ACTOR) or []
    lines = [f'## ⚙️ Ops Robot — {len(reqs)} काम']
    for r in reqs:
        try: status, result = handle(r, dry)
        except Exception as e: status, result = 'failed', str(e)[:300]
        lines.append(f"- #{r['id']} {r['action']} {r.get('target') or ''}: **{status}** — {result}")
        if not dry:
            opslib.sb('PATCH', f"/rest/v1/ops_requests?id=eq.{r['id']}&status=eq.queued",
                      {'status': status, 'result': result, 'handled_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}, actor=ACTOR, prefer='return=minimal')
    print('\n'.join(lines))
    if os.environ.get('GITHUB_STEP_SUMMARY') and reqs: open(os.environ['GITHUB_STEP_SUMMARY'], 'a').write('\n'.join(lines) + '\n')
    if reqs: opslib.write_counts(len(reqs), sum(1 for l in lines[1:] if '**sent**' in l or '**done**' in l), '')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
