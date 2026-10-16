"""Key-check Robot — checks the ANSWERS of questions on the server. READ-ONLY: it never changes a question.

Runs on GitHub Actions (.github/workflows/key-check-robot.yml), so it costs no Claude usage.
  python3 dev/tools/key-check-robot/keycheck.py [--scope draft|published|all] [--gemini] [--limit N] [--offset N] [--strict]

Checks (the official SSC key stays the truth; these only RAISE A FLAG for a human/Claude to look at):
  A  Structure   : answer is A-D, exactly 4 non-empty options, no two options identical (else "answer ambiguous").
  B  Conflict    : the same question (same text AND same set of options) appears in two papers with a DIFFERENT answer text.
  C  Skew        : one paper where a single letter is the answer for > 45 % of >= 20 questions (key may be shifted).
  D  Second opinion (only with --gemini and env GEMINI_API_KEY): Gemini answers the question alone;
                 if it disagrees with the key -> "जाँचो" flag. A disagreement is NOT proof the key is wrong.
Only question text + options go to Gemini. No student data ever leaves the server.
Secrets come only from env (SUPABASE_SECRET_KEY, GEMINI_API_KEY) and are never printed.
Exit code: 0 normally; with --strict, 2 if any hard flag (A/B) exists, so a later auto-publish step can stop.
"""
import json, os, re, sys, time, unicodedata, urllib.parse, urllib.request
from collections import Counter, defaultdict

SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://fzkvwkrbtykucjfdqiin.supabase.co').rstrip('/')
KEY = os.environ.get('SUPABASE_SECRET_KEY', '').strip()
GEMINI_KEY = os.environ.get('GEMINI_API_KEY', '').strip()
GEMINI_MODEL = os.environ.get('GEMINI_MODEL', 'gemini-2.5-flash')
SUMMARY = []
HARD = {'A1', 'A2', 'A3', 'B'}
LABEL = {
    'A1': 'सवाल अधूरा (answer या options ठीक नहीं)',
    'A3': 'सवाल का text बहुत छोटा/कटा हुआ',
    'A2': 'दो options एक जैसे — जवाब साफ़ नहीं',
    'B': 'यही सवाल दूसरे paper में है, पर जवाब अलग',
    'C': 'इस paper में एक ही option बहुत बार सही — key खिसकी हो सकती है',
    'D': 'Gemini का जवाब key से अलग — जाँचो',
}


def say(line=''):
    print(line, flush=True); SUMMARY.append(line)


def norm(s):
    """Compare text ignoring case, spaces and end punctuation ONLY. Math signs (+ − × ÷ < >) and Hindi matras must
    stay: options like "6 + 2" / "6 × 2" or "का" / "की" are different answers."""
    s = re.sub(r'\s+', '', unicodedata.normalize('NFKC', s or '').lower())
    return s.strip('.,;:।?!')


def opt_text(o):
    return (o.get('en') or o.get('hi') or '') if isinstance(o, dict) else ''


def qtext(r):
    return r.get('question_en') or r.get('question_hi') or ''


# ---------- the checks (pure functions, tested in dev/tests/test_keycheck.py) ----------
def audit(rows):
    """rows -> (flags, paper_warnings). flags = [{id, code, why}]."""
    flags, seen = [], defaultdict(list)
    per_paper = defaultdict(list)
    for r in rows:
        opts = r.get('options') or []
        ans = (r.get('answer') or '').strip()
        texts = [norm(opt_text(o)) for o in opts] if isinstance(opts, list) else []
        if ans not in ('A', 'B', 'C', 'D') or len(texts) != 4 or not all(texts) or not norm(qtext(r)):
            flags.append({'id': r['id'], 'code': 'A1', 'why': LABEL['A1']}); continue
        if len(norm(qtext(r))) < 8:
            flags.append({'id': r['id'], 'code': 'A3', 'why': LABEL['A3']})
        if len(set(texts)) < 4:
            flags.append({'id': r['id'], 'code': 'A2', 'why': LABEL['A2']})
        by_letter = {(o.get('letter') or 'ABCD'[i]): norm(opt_text(o)) for i, o in enumerate(opts)}
        key_text = by_letter.get(ans) or texts['ABCD'.index(ans)]
        seen[(norm(qtext(r)), tuple(sorted(texts)))].append((r['id'], key_text))
        if r.get('source_ref'): per_paper[r['source_ref']].append(ans)
    for qt, items in seen.items():
        if len({t for _, t in items}) > 1:
            for rid, _ in items:
                flags.append({'id': rid, 'code': 'B', 'why': LABEL['B']})
    warns = []
    for ref, answers in per_paper.items():
        if len(answers) >= 20:
            letter, n = Counter(answers).most_common(1)[0]
            if n / len(answers) > 0.45:
                warns.append({'paper': ref, 'code': 'C', 'why': f'{LABEL["C"]} ({letter}: {n}/{len(answers)})'})
    return flags, warns


def gemini_prompt(r):
    opts = '\n'.join(f"{o.get('letter') or 'ABCD'[i]}) {opt_text(o)}" for i, o in enumerate(r['options']))
    return ('You are checking a competitive-exam multiple-choice question (SSC JE). Choose the single best option.\n'
            f'Question:\n{qtext(r)}\n\nOptions:\n{opts}\n\n'
            'Reply as JSON only: {"answer":"A|B|C|D","confident":true|false}. confident=false if the question is unclear, '
            'needs a figure, or you are not sure.')


def ask_gemini(r):
    """Returns (letter or None, confident bool). Raises RuntimeError('quota') when the free limit is hit."""
    body = {'contents': [{'parts': [{'text': gemini_prompt(r)}]}],
            'generationConfig': {'temperature': 0, 'responseMimeType': 'application/json'}}
    req = urllib.request.Request(
        f'https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent', method='POST',
        headers={'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY}, data=json.dumps(body).encode())
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                txt = json.load(resp)['candidates'][0]['content']['parts'][0]['text']
            d = json.loads(txt)
            a = str(d.get('answer', '')).strip().upper()[:1]
            return (a if a in 'ABCD' and a else None), bool(d.get('confident'))
        except urllib.error.HTTPError as e:
            if e.code == 429:
                if attempt < 2: time.sleep(20); continue
                raise RuntimeError('quota')
            if e.code >= 500 and attempt < 2: time.sleep(5); continue
            return None, False
        except (KeyError, IndexError, ValueError):
            return None, False
    return None, False


def second_opinion(rows, ask=ask_gemini, pause=4.5):
    """Flag D = Gemini confident AND different from key. Returns (flags, checked, skipped_by_quota)."""
    flags, checked = [], 0
    for r in rows:
        try:
            a, sure = ask(r)
        except RuntimeError:
            return flags, checked, True
        checked += 1
        if a and sure and a != r['answer']:
            flags.append({'id': r['id'], 'code': 'D', 'why': f"{LABEL['D']} (key {r['answer']}, Gemini {a})"})
        time.sleep(pause)
    return flags, checked, False


# ---------- server (GET only) ----------
def fetch(scope, offset=0):
    if not KEY: raise RuntimeError('GitHub secret SUPABASE_SECRET_KEY नहीं मिला')
    flt = {'draft': '&status=in.(draft,reviewed)', 'published': '&status=eq.published', 'all': ''}[scope]
    cols = 'id,status,source_type,source_ref,question_en,question_hi,options,answer'
    h = {'apikey': KEY}
    if KEY.startswith('eyJ'): h['Authorization'] = 'Bearer ' + KEY
    out, off = [], offset
    while True:
        url = f'{SUPABASE_URL}/rest/v1/questions?select={cols}{flt}&order=id&limit=1000&offset={off}'
        with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=60) as r:
            part = json.load(r)
        out += part; off += 1000
        if len(part) < 1000: return out


def main(argv):
    scope = argv[argv.index('--scope') + 1] if '--scope' in argv else 'draft'
    limit = int(argv[argv.index('--limit') + 1]) if '--limit' in argv else 150
    offset = int(argv[argv.index('--offset') + 1]) if '--offset' in argv else 0
    use_g, strict = '--gemini' in argv, '--strict' in argv
    if scope not in ('draft', 'published', 'all'): say('❌ scope: draft / published / all'); return 1
    say(f'## 🔑 Key-check Robot (scope: {scope}) — सिर्फ़ जाँच, कुछ बदला नहीं गया')
    try:
        rows = fetch(scope)
    except Exception as e:
        say(f'❌ Server से सवाल नहीं मिले: {e}'); return 1
    say(f'- जाँचे गए सवाल: **{len(rows)}**')
    flags, warns = audit(rows)
    if use_g:
        if not GEMINI_KEY:
            say('- ⚠️ GEMINI_API_KEY secret नहीं मिला — दूसरी राय (Gemini) छोड़ दी।')
        else:
            pool = [r for r in rows if r.get('source_type') == 'PYQ'][offset:offset + limit]
            f2, n, quota = second_opinion(pool)
            flags += f2
            say(f'- Gemini ने जाँचे: **{n}** PYQ सवाल' + (' (free सीमा भर गई — बाकी अगली बार, --offset बढ़ाकर)' if quota else ''))
    c = Counter(f['code'] for f in flags)
    say('- नतीजा: ' + (', '.join(f'{LABEL[k]}: **{v}**' for k, v in sorted(c.items())) if c else '✅ कोई flag नहीं'))
    for w in warns: say(f"- ⚠️ {w['why']} — {w['paper'][:90]}")
    for f in flags[:80]: say(f"  - `{f['id']}` — {f['why']}")
    if len(flags) > 80: say(f'  - … और {len(flags) - 80} (पूरी list report.json में)')
    say('\nयह robot Official key को नहीं बदलता। Flag वाले सवाल Studio में देखकर तय करें, या Claude से कहें: "key-check flags देखो"।')
    json.dump({'scope': scope, 'checked': len(rows), 'flags': flags, 'paper_warnings': warns},
              open(os.environ.get('KEYCHECK_REPORT', 'keycheck-report.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8').write('\n'.join(SUMMARY) + '\n')
    return 2 if strict and any(f['code'] in HARD for f in flags) else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
