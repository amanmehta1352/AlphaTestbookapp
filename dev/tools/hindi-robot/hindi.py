"""Hindi Robot — fills missing Hindi for server questions (runs on GitHub Actions, no Claude usage).
  python3 dev/tools/hindi-robot/hindi.py --shard 0 --of 8 [--dry-run] [--limit N]

Rules (safe by design):
- Only rows with an empty question_hi and a non-empty question_en; existing Hindi is never overwritten.
- Option Hindi is filled only where it is empty or equal to English. Engineering options stay English
  (technical terms); question stem is still translated.
- Numbers/formulas/letter codes stay as they are (mt.needs_translation).
- source_ref gets "· Hindi = machine translation (IndicTrans2)" so it is clear the Hindi is not from SSC.
- content_hash changes, so students' apps pick up the new Hindi on next sync.
"""
import hashlib, json, os, re, sys, time, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mt

URL = os.environ.get('SUPABASE_URL', 'https://fzkvwkrbtykucjfdqiin.supabase.co').rstrip('/')
KEY = os.environ.get('SUPABASE_SECRET_KEY', '').strip()
MARK = ' · Hindi = machine translation (IndicTrans2)'


def api(method, path, body=None, prefer=None):
    h = {'apikey': KEY, 'Content-Type': 'application/json', 'x-actor': 'hindi-robot'}
    if KEY.startswith('eyJ'): h['Authorization'] = 'Bearer ' + KEY
    if prefer: h['Prefer'] = prefer
    req = urllib.request.Request(URL + path, method=method, headers=h, data=None if body is None else json.dumps(body, ensure_ascii=False).encode())
    for a in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                t = r.read().decode(); return json.loads(t) if t else None
        except urllib.error.HTTPError as e:
            if e.code >= 500 and a < 3: time.sleep(5); continue
            raise RuntimeError(f'server {e.code}: {e.read().decode()[:300]}')
        except urllib.error.URLError:
            if a < 3: time.sleep(5); continue
            raise


def fetch_todo():
    rows, off = [], 0
    while True:
        q = ('/rest/v1/questions?select=id,subject,question_en,question_hi,options,content_hash,source_ref'
             '&or=(question_hi.is.null,question_hi.eq.)&question_en=not.is.null&order=id&limit=1000&offset=' + str(off))
        part = api('GET', q) or []; rows += part; off += 1000
        if len(part) < 1000: return rows


def fix_hi(h):
    h = re.sub(r"\s*'([^'\n]{1,40})'\s*", r" '\1' ", h)   # 'DHE'को -> 'DHE' को
    h = re.sub(r'हैः|हैंः', lambda m: m.group(0)[:-1] + ':', h)   # visarga mistaken for colon
    return re.sub(r'[ \t]+', ' ', h).strip()


def _ops_counts(processed=None, changed=None, note=''):
    p = os.environ.get('OPS_COUNTS')
    if p:
        import json as _j
        _j.dump({'processed': processed, 'changed': changed, 'note': note}, open(p, 'w'), ensure_ascii=False)


def main(a):
    shard = int(a[a.index('--shard') + 1]) if '--shard' in a else 0
    of = int(a[a.index('--of') + 1]) if '--of' in a else 1
    limit = int(a[a.index('--limit') + 1]) if '--limit' in a else 0
    dry = '--dry-run' in a
    if not KEY: print('❌ SUPABASE_SECRET_KEY नहीं मिला'); return 1
    todo = [r for r in fetch_todo() if int(hashlib.md5(r['id'].encode()).hexdigest(), 16) % of == shard]
    if limit: todo = todo[:limit]
    print(f'shard {shard}/{of}: {len(todo)} questions', flush=True)
    done = 0; t0 = time.time()
    for k in range(0, len(todo), 40):
        chunk = todo[k:k + 40]
        texts, where = [], []
        for i, r in enumerate(chunk):
            texts.append(r['question_en']); where.append((i, 'q', None))
            if not r['subject'].endswith('engineering'):
                for j, o in enumerate(r['options'] or []):
                    if (not o.get('hi') or o.get('hi') == o.get('en')) and mt.needs_translation(o.get('en')):
                        texts.append(o['en']); where.append((i, 'o', j))
        out = mt.translate(texts)
        upd = [{'question_hi': None, 'options': [dict(o) for o in (r['options'] or [])]} for r in chunk]
        for (i, kind, j), en, hi in zip(where, texts, out):
            hi = fix_hi(hi)
            if hi == en or not re.search('[ऀ-ॿ]', hi): continue
            if kind == 'q': upd[i]['question_hi'] = hi
            else: upd[i]['options'][j]['hi'] = hi
        for r, u in zip(chunk, upd):
            if not u['question_hi']: continue
            body = {'question_hi': u['question_hi'], 'options': u['options'],
                    'content_hash': 'v1h-' + hashlib.sha1((r['content_hash'] or '') .encode() + json.dumps(u, ensure_ascii=False).encode()).hexdigest()[:20]}
            src = r['source_ref'] or ''
            if MARK not in src and len(src) + len(MARK) <= 300: body['source_ref'] = src + MARK
            if dry: print(json.dumps({'id': r['id'], **body}, ensure_ascii=False)[:400]); continue
            # guard: only if Hindi is still empty (never overwrite someone's edit made meanwhile)
            api('PATCH', '/rest/v1/questions?id=eq.' + urllib.parse.quote(r['id']) + '&or=(question_hi.is.null,question_hi.eq.)', body, 'return=minimal')
            done += 1
        print(f'  {min(k + 40, len(todo))}/{len(todo)} · {done} saved · {int(time.time() - t0)}s', flush=True)
    print(f'✅ shard {shard}: Hindi जोड़ा {done} सवालों में')
    _ops_counts(len(todo), done, f'shard {shard}/{of}')
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        open(os.environ['GITHUB_STEP_SUMMARY'], 'a').write(f'### 🌐 Hindi Robot shard {shard}/{of}: {done} सवालों में Hindi जोड़ा\n')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
