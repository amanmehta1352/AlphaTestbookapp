"""Tag Robot — moves "Mixed (Untagged)" questions into real chapters/topics (runs on GitHub Actions, no Claude usage).
  python3 dev/tools/tag-robot/tagger.py [--dry-run] [--min-prob 0.55]

Learns from questions already tagged by hand (same subject, topic != Mixed) with TF-IDF + logistic regression.
- Reports cross-validated accuracy per subject first; a subject is tagged only if accuracy >= 80 %.
- A question moves only when the model is confident (prob >= --min-prob); otherwise it stays in Mixed.
- Only the topic_id / chapter / topic fields change (+ content_hash so students resync). Text/answer never change.
- Only rows still in a "mixed-untagged" topic are touched (guarded PATCH).
"""
import hashlib, json, os, re, sys, time, urllib.parse, urllib.request
from collections import Counter, defaultdict

URL = os.environ.get('SUPABASE_URL', 'https://fzkvwkrbtykucjfdqiin.supabase.co').rstrip('/')
KEY = os.environ.get('SUPABASE_SECRET_KEY', '').strip()
OUT = []


def say(s=''):
    print(s, flush=True); OUT.append(s)


def api(method, path, body=None, prefer=None):
    h = {'apikey': KEY, 'Content-Type': 'application/json', 'x-actor': 'tag-robot'}
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


def pull():
    rows, off = [], 0
    while True:
        part = api('GET', '/rest/v1/questions?select=id,topic_id,subject,chapter,topic,question_en,options,content_hash,is_active'
                   f'&question_en=not.is.null&order=id&limit=1000&offset={off}') or []
        rows += part; off += 1000
        if len(part) < 1000: return rows


def text_of(r):
    t = (r['question_en'] or '') + ' || ' + ' | '.join(o.get('en', '') for o in (r['options'] or []))
    return re.sub(r'\s+', ' ', t.lower())


def _ops_counts(processed=None, changed=None, note=''):
    p = os.environ.get('OPS_COUNTS')
    if p:
        import json as _j
        _j.dump({'processed': processed, 'changed': changed, 'note': note}, open(p, 'w'), ensure_ascii=False)


def _setting(name, default):
    try:
        r = api('GET', '/rest/v1/ops_settings?select=value&key=eq.' + name) or []
        return float(r[0]['value']) if r else default
    except Exception:
        return default


def main(a):
    dry = '--dry-run' in a
    minp = float(a[a.index('--min-prob') + 1]) if '--min-prob' in a else (_setting('tag.min_prob', 0.55) if KEY else 0.55)
    mincv = _setting('tag.min_cv', 0.80) if KEY else 0.80
    if not KEY: say('❌ SUPABASE_SECRET_KEY नहीं मिला'); return 1
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline, make_union
    from sklearn.model_selection import cross_val_score
    rows = pull()
    say(f"## 🏷️ Tag Robot {'(सिर्फ़ जाँच)' if dry else ''}")
    by_subj = defaultdict(list)
    for r in rows: by_subj[r['subject']].append(r)
    total_moved = 0
    for subj, rs in sorted(by_subj.items()):
        mixed = [r for r in rs if 'mixed-untagged' in (r['topic_id'] or '')]
        train = [r for r in rs if 'mixed-untagged' not in (r['topic_id'] or '') and r['is_active']]
        if not mixed: continue
        labels = Counter(r['topic_id'] for r in train)
        train = [r for r in train if labels[r['topic_id']] >= 5]          # need a few examples per topic
        if len(set(r['topic_id'] for r in train)) < 2:
            say(f'- {subj}: {len(mixed)} Mixed — सीखने को tagged सवाल कम हैं, छोड़ा'); continue
        meta = {r['topic_id']: (r['chapter'], r['topic']) for r in train}
        X, y = [text_of(r) for r in train], [r['topic_id'] for r in train]
        model = make_pipeline(make_union(TfidfVectorizer(ngram_range=(1, 2), min_df=1, sublinear_tf=True),
                                         TfidfVectorizer(analyzer='char_wb', ngram_range=(3, 5), sublinear_tf=True)),
                              LogisticRegression(max_iter=2000, C=8, class_weight='balanced'))
        folds = min(5, min(Counter(y).values()))
        acc = cross_val_score(model, X, y, cv=folds).mean() if folds >= 2 else 0
        model.fit(X, y)
        P = model.predict_proba([text_of(r) for r in mixed]); cls = model.classes_
        # accuracy of confident predictions only (what we actually apply), estimated on training folds
        moves = []
        for r, p in zip(mixed, P):
            k = p.argmax()
            if p[k] >= minp: moves.append((r, cls[k], p[k]))
        ok = acc >= mincv
        say(f"- **{subj}**: tagged {len(train)} से सीखा · accuracy {acc:.0%} · Mixed {len(mixed)} → पक्के {len(moves)}" + ('' if ok else ' · ⚠️ accuracy कम, नहीं बदला'))
        if not ok: continue
        cnt = Counter(meta[t][0] for _, t, _ in moves)
        say('  ' + ', '.join(f'{c} {n}' for c, n in cnt.most_common(8)))
        if dry: continue
        for r, t, p in moves:
            ch, tp = meta[t]
            body = {'topic_id': t, 'chapter': ch, 'topic': tp,
                    'content_hash': 'v1t-' + hashlib.sha1(((r['content_hash'] or '') + t).encode()).hexdigest()[:20]}
            api('PATCH', '/rest/v1/questions?id=eq.' + urllib.parse.quote(r['id']) + '&topic_id=like.*mixed-untagged*', body, 'return=minimal')
            total_moved += 1
    say(f"\n**कुल chapter में गए: {total_moved}**" if not dry else '')
    _ops_counts(sum(len([r for r in rs if 'mixed-untagged' in (r['topic_id'] or '')]) for rs in by_subj.values()), total_moved, 'dry run' if dry else '')
    if os.environ.get('GITHUB_STEP_SUMMARY'): open(os.environ['GITHUB_STEP_SUMMARY'], 'a').write('\n'.join(OUT) + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
