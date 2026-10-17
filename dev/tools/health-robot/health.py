"""Health Robot — one report on the whole app: live site, GitHub robots/tests, Supabase data and students.
Runs on GitHub Actions every 2 hours (.github/workflows/health-robot.yml) — no Claude usage.
  python3 dev/tools/health-robot/health.py --out status.json [--history history.json]

READ-ONLY everywhere. Writes only:
  - status.json (+ history.json) which the workflow pushes to the `status` branch; the Control Room page (control/) reads it.
  - a GitHub issue "🚨 App health" when something is red (GitHub then notifies the owner), closed again when all is fine.
Privacy: the repo is public, so the report holds COUNTS ONLY — never a name, email, user id or answer.
Secrets come only from env (SUPABASE_SECRET_KEY, GITHUB_TOKEN) and are never printed.
"""
import json, os, re, sys, time, urllib.parse, urllib.request
from collections import Counter
from datetime import datetime, timedelta, timezone

SB_URL = os.environ.get('SUPABASE_URL', 'https://fzkvwkrbtykucjfdqiin.supabase.co').rstrip('/')
SB_KEY = os.environ.get('SUPABASE_SECRET_KEY', '').strip()
GH_TOKEN = os.environ.get('GITHUB_TOKEN', '').strip()
REPO = os.environ.get('GITHUB_REPOSITORY', 'amanmehta1352/AlphaTestbookapp')
SITE = os.environ.get('SITE_URL', 'https://amanmehta1352.github.io/AlphaTestbookapp/')
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
WORKFLOWS = [  # file, label, what it does (Hindi), needs input?
    ('tests.yml', '✅ Tests', 'हर बदलाव पर ऐप के सारे tests', False),
    ('pyq-robot.yml', '🤖 PYQ Robot', 'PDF links से नए PYQ (draft)', True),
    ('hindi-robot.yml', '🌐 Hindi Robot', 'English सवालों में Hindi', False),
    ('tag-robot.yml', '🏷️ Tag Robot', 'Mixed सवाल chapter में', False),
    ('key-check-robot.yml', '🔑 Key-check Robot', 'answer key की जाँच', False),
    ('health-robot.yml', '🩺 Health Robot', 'यह रिपोर्ट', False),
]


def http(url, headers=None, method='GET', body=None, timeout=40):
    req = urllib.request.Request(url, method=method, headers=headers or {}, data=None if body is None else json.dumps(body).encode())
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read().decode('utf-8', 'replace'), dict(r.headers), round((time.time() - t0) * 1000)


def sb_headers(extra=None):
    h = {'apikey': SB_KEY}
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


def gh(path, method='GET', body=None):
    h = {'Accept': 'application/vnd.github+json', 'User-Agent': 'mtb-health'}
    if GH_TOKEN: h['Authorization'] = 'Bearer ' + GH_TOKEN
    if body is not None: h['Content-Type'] = 'application/json'
    _, t, _, _ = http('https://api.github.com/repos/' + REPO + path, h, method, body)
    return json.loads(t or 'null')


# ---------------------------------------------------------------- collectors
def collect_site():
    out = {'url': SITE}
    try:
        st, html, _, ms = http(SITE + '?health=' + str(int(time.time())))
        m = re.search(r'name="app-version" content="([^"]+)"', html)
        out.update(ok=st == 200, ms=ms, version=m.group(1) if m else '', size_kb=round(len(html.encode()) / 1024))
        st2, sw, _, _ = http(SITE + 'sw.js?health=' + str(int(time.time())))
        m2 = re.search(r"CACHE\s*=\s*'([^']+)'", sw); out['sw_cache'] = m2.group(1) if m2 else ''
    except Exception as e:
        out.update(ok=False, error=str(e)[:160])
    try:
        src = open(os.path.join(ROOT, 'dev/app/src/html/head-01.html'), encoding='utf-8').read()
        m = re.search(r'name="app-version" content="([^"]+)"', src); out['source_version'] = m.group(1) if m else ''
    except Exception:
        out['source_version'] = ''
    return out


def collect_github():
    out = {'workflows': [], 'issues': None}
    for f, label, what, needs_input in WORKFLOWS:
        w = {'file': f, 'label': label, 'what': what, 'input': needs_input,
             'page': f'https://github.com/{REPO}/actions/workflows/{f}'}
        try:
            runs = (gh(f'/actions/workflows/{f}/runs?per_page=5') or {}).get('workflow_runs', [])
            done = [r for r in runs if r.get('status') == 'completed']
            last = runs[0] if runs else None
            w.update(last_status=(last or {}).get('status'), last_conclusion=(done[0] if done else {}).get('conclusion'),
                     last_at=(done[0] if done else {}).get('updated_at'), last_url=(done[0] if done else {}).get('html_url'),
                     running=bool(last and last.get('status') != 'completed'))
        except Exception as e:
            w['error'] = str(e)[:120]
        out['workflows'].append(w)
    try:
        out['issues'] = len([i for i in (gh('/issues?state=open&per_page=50') or []) if 'pull_request' not in i])
    except Exception:
        pass
    return out


def collect_supabase():
    out = {}
    t0 = time.time()
    try:
        qs = sb_get_all('questions', 'subject,status,is_active,question_en,question_hi,options,answer,topic_id,source_type,created_at')
    except Exception as e:
        return {'ok': False, 'error': str(e)[:160]}
    out['ok'] = True; out['ms'] = round((time.time() - t0) * 1000)
    live = [q for q in qs if q['status'] == 'published' and q['is_active']]
    out['questions'] = {
        'total': len(qs), 'live': len(live),
        'draft': sum(q['status'] == 'draft' for q in qs), 'reviewed': sum(q['status'] == 'reviewed' for q in qs),
        'hidden': sum(not q['is_active'] for q in qs),
        'pyq_live': sum(q['source_type'] == 'PYQ' for q in live), 'practice_live': sum(q['source_type'] == 'PRACTICE' for q in live),
        'no_hindi_live': sum(not (q['question_hi'] or '').strip() for q in live),
        'untagged_live': sum('mixed-untagged' in (q['topic_id'] or '') for q in live),
        'broken_live': sum(1 for q in live if (q['answer'] or '') not in ('A', 'B', 'C', 'D') or len(q['options'] or []) != 4
                           or any(not (o.get('en') or o.get('hi') or '').strip() for o in (q['options'] or []))
                           or len((q['question_en'] or q['question_hi'] or '').strip()) < 8),
        'added_7d': sum(1 for q in qs if (q['created_at'] or '') >= (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()),
        'by_subject': dict(Counter(q['subject'] for q in live).most_common()),
    }
    now = datetime.now(timezone.utc)
    d1, d7 = (now - timedelta(days=1)).isoformat(), (now - timedelta(days=7)).isoformat()
    enc = lambda s: urllib.parse.quote(s, safe='')
    try:
        att7 = sb_get_all('attempts', 'user_id,is_correct,answered_at', f'&answered_at=gte.{enc(d7)}')
        out['students'] = {
            'total': sb_count('profiles'),
            'new_7d': sb_count('profiles', f'&created_at=gte.{enc(d7)}'),
            'active_1d': len({a['user_id'] for a in att7 if a['answered_at'] >= d1}),
            'active_7d': len({a['user_id'] for a in att7}),
            'answers_1d': sum(a['answered_at'] >= d1 for a in att7), 'answers_7d': len(att7),
            'accuracy_7d': round(100 * sum(bool(a['is_correct']) for a in att7) / len(att7)) if att7 else None,
            'tests_7d': sb_count('results', f'&submitted_at=gte.{enc(d7)}'),
            'admins': sb_count('admins'),
        }
    except Exception as e:
        out['students'] = {'error': str(e)[:120]}
    return out


# ---------------------------------------------------------------- verdict
def evaluate(s):
    """Turn raw numbers into simple checks: ok / warn / bad, each with a Hindi message and what to do."""
    C = []
    add = lambda area, level, msg, todo='', link='': C.append({'area': area, 'level': level, 'msg': msg, 'todo': todo, 'link': link})
    site, g, sb = s.get('site', {}), s.get('github', {}), s.get('supabase', {})
    if not site.get('ok'): add('ऐप', 'bad', 'Live ऐप नहीं खुल रहा', 'GitHub Pages जाँचो — Claude को बताओ', SITE)
    else:
        add('ऐप', 'ok', f"Live ऐप चालू · {site.get('version')} · {site.get('ms')} ms")
        if site.get('source_version') and site.get('version') != site.get('source_version'):
            add('ऐप', 'warn', f"Live {site.get('version')} पर code में {site.get('source_version')} — release अभी पहुँचा नहीं", 'कुछ मिनट रुको; 1 घंटे बाद भी ऐसा हो तो Claude को बताओ')
    for w in g.get('workflows', []):
        if w.get('error'): add('Robots', 'warn', f"{w['label']}: हाल नहीं पता चला", '', w['page'])
        elif w.get('last_conclusion') == 'failure': add('Robots', 'bad', f"{w['label']} पिछली बार fail हुआ", 'लाल run खोलकर Claude को link भेजो', w.get('last_url') or w['page'])
        elif w.get('running'): add('Robots', 'ok', f"{w['label']} अभी चल रहा है")
    if not any(w.get('last_conclusion') == 'failure' for w in g.get('workflows', [])): add('Robots', 'ok', 'सारे robots और tests ठीक')
    if not sb.get('ok'): add('Server', 'bad', 'Supabase server से जवाब नहीं आया', 'supabase.com पर project paused तो नहीं? Claude को बताओ')
    else:
        q = sb['questions']
        add('Server', 'ok', f"Server चालू · {q['live']} सवाल live")
        if q['broken_live']: add('सवाल', 'bad', f"{q['broken_live']} live सवाल अधूरे/टूटे (answer, option या text)", 'Claude को बोलो: "टूटे सवाल ठीक करो"')
        if q['draft'] + q['reviewed']: add('सवाल', 'warn', f"{q['draft'] + q['reviewed']} सवाल publish का इंतज़ार कर रहे", 'Admin Studio में जाँचकर Publish करो', SITE + 'admin/')
        if q['untagged_live']: add('सवाल', 'warn', f"{q['untagged_live']} live सवाल अभी 'Mixed' में (chapter नहीं)", 'Tag Robot चलाओ या Claude को बोलो', f'https://github.com/{REPO}/actions/workflows/tag-robot.yml')
        if q['no_hindi_live'] > 50: add('सवाल', 'warn', f"{q['no_hindi_live']} live सवालों में Hindi नहीं", 'Hindi Robot चलाओ', f'https://github.com/{REPO}/actions/workflows/hindi-robot.yml')
        st = sb.get('students', {})
        if 'error' not in st:
            add('Students', 'ok', f"{st['total']} students · 7 दिन में {st['active_7d']} active · {st['answers_7d']} जवाब · {st['tests_7d']} टेस्ट")
    if g.get('issues'): add('GitHub', 'warn', f"{g['issues']} खुले issue", 'GitHub → Issues देखो', f'https://github.com/{REPO}/issues')
    order = {'bad': 0, 'warn': 1, 'ok': 2}
    C.sort(key=lambda c: order[c['level']])
    overall = 'bad' if any(c['level'] == 'bad' for c in C) else 'warn' if any(c['level'] == 'warn' for c in C) else 'ok'
    return overall, C


ISSUE_TITLE = '🚨 App health: ध्यान दो'


def sync_issue(overall, checks, dry):
    if dry or not GH_TOKEN: return 'skipped'
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
    s = {'at': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'repo': REPO, 'site_url': SITE}
    s['site'] = collect_site(); s['github'] = collect_github(); s['supabase'] = collect_supabase()
    s['overall'], s['checks'] = evaluate(s)
    s['issue'] = sync_issue(s['overall'], s['checks'], dry)
    json.dump(s, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    if hist:
        try: h = json.load(open(hist, encoding='utf-8'))
        except Exception: h = []
        q, st = s['supabase'].get('questions', {}), s['supabase'].get('students', {})
        h.append({'at': s['at'], 'overall': s['overall'], 'live': q.get('live'), 'students': st.get('total'),
                  'active_7d': st.get('active_7d'), 'answers_1d': st.get('answers_1d'), 'ms': s['site'].get('ms')})
        json.dump(h[-120:], open(hist, 'w', encoding='utf-8'), ensure_ascii=False)
    icon = {'ok': '🟢', 'warn': '🟡', 'bad': '🔴'}
    lines = [f"## {icon[s['overall']]} App health — {s['at']}"] + [f"- {icon[c['level']]} **{c['area']}**: {c['msg']}" + (f" → {c['todo']}" if c['todo'] else '') for c in s['checks']]
    print('\n'.join(lines))
    if os.environ.get('GITHUB_STEP_SUMMARY'): open(os.environ['GITHUB_STEP_SUMMARY'], 'a').write('\n'.join(lines) + f"\n\nControl Room: {SITE}control/\n")
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
