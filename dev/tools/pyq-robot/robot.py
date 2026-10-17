"""PYQ Robot — SSC JE response-sheet PDF links -> server questions as DRAFT.

Runs on GitHub Actions (.github/workflows/pyq-robot.yml), so it costs no Claude usage.
  python3 dev/tools/pyq-robot/robot.py [--dry-run] URL [URL ...]

Steps per PDF: download -> v2/extract.py + v2/gaps.py -> app TXT -> the app's own ImportEngine
(built index.html, same IDs/hash as Admin Studio) -> insert into Supabase as status='draft'.
Safety:
- Only official data: text/options + answer from the SSC green tick (exactly 4 marks, 1 tick).
- Questions with a figure / big blank gap / no clear answer are skipped (app can't show images).
- Existing rows are never changed (insert with ignore-duplicates). A paper whose source_ref is
  already on the server is skipped, so running the same link twice is harmless.
- Reasoning gets its chapter by rules; other sections go to topic "Mixed (Untagged)" for later tagging.
- The secret key comes only from env SUPABASE_SECRET_KEY (GitHub secret). It is never printed.
"""
import json, os, re, subprocess, sys, tempfile, time, urllib.parse, urllib.request
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
V2 = os.path.join(REPO, 'dev', 'tools', 'pyq-from-response-sheet', 'v2')
sys.path.insert(0, V2)
from rfirst import rclass  # noqa: E402

SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://fzkvwkrbtykucjfdqiin.supabase.co').rstrip('/')
KEY = os.environ.get('SUPABASE_SECRET_KEY', '').strip()
MON = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split()
RCH = {'Series': 'Series', 'Analogy': 'Analogy & Classification', 'Coding-Decoding': 'Coding-Decoding', 'Blood Relation': 'Blood Relation',
       'Seating Arrangement & Puzzle': 'Seating Arrangement & Puzzle', 'Syllogism': 'Syllogism', 'Direction Sense': 'Direction Sense',
       'Mathematical Operations': 'Mathematical Operations', 'Alphabet & Word Order': 'Alphabet & Word Order'}
UNTAGGED = 'Mixed (Untagged)'
SUMMARY = []


def say(line=''):
    print(line, flush=True); SUMMARY.append(line)


# ---------- text cleanup (same rules as v2/build_all.py) ----------
MARK = re.compile(r'^(\d+\.|\(?[ivxIVX]+[.)]|\([a-dA-D1-4]\)|[A-D][.)]|[a-d]\)|\d\)|Statement|Conclusion|Assertion|Reason|Statements|Conclusions|Note|NOTE|\(NOTE|[ऀ-ॿ]+ ?:|\()')


def join_lines(t):
    out = []
    for ln in [l.strip() for l in t.split('\n') if l.strip()]:
        if out and len(out[-1]) >= 70 and not MARK.match(ln) and not out[-1].endswith((':', '?')):
            out[-1] += ' ' + ln
        else:
            out.append(ln)
    return '\n'.join(out)


LIG = {'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st'}


def fix(s):
    for a, b in LIG.items(): s = s.replace(a, b)
    s = s.replace('‍', '').replace('​', '').replace(' ̊', '°').replace('̊', '°')
    s = re.sub(r'(?<![A-Za-z])((?:k?N|kg|m)/)?(mm|cm|km|m|sec|s)([23])(?![0-9A-Za-z])', lambda m: (m.group(1) or '') + m.group(2) + '²³'[int(m.group(3)) - 2], s)
    for a, b in [('H2O', 'H₂O'), ('CO2', 'CO₂'), ('NH3', 'NH₃'), ('C3S', 'C₃S'), ('C2S', 'C₂S'), ('C3A', 'C₃A'), ('C4AF', 'C₄AF')]:
        s = re.sub(r'\b' + a + r'\b', b, s)
    return re.sub(r'[ \t]+', ' ', s).strip()


# ---------- server ----------
def api(method, path, body=None, prefer=None):
    h = {'apikey': KEY, 'Content-Type': 'application/json', 'x-actor': 'pyq-robot'}
    if KEY.startswith('eyJ'): h['Authorization'] = 'Bearer ' + KEY
    if prefer: h['Prefer'] = prefer
    req = urllib.request.Request(SUPABASE_URL + path, method=method, headers=h,
                                 data=None if body is None else json.dumps(body, ensure_ascii=False).encode())
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                txt = r.read().decode()
                return json.loads(txt) if txt else None
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:300]
            if e.code >= 500 and attempt < 2: time.sleep(3); continue
            raise RuntimeError(f'server {e.code}: {msg}')


def server_count(filt):
    rows = api('GET', '/rest/v1/questions?select=id&' + filt + '&limit=1000')
    return len(rows or [])


# ---------- one paper ----------
def section_subject(sec, branch):
    s = sec.lower()
    if 'reason' in s or 'intelligence' in s: return 'Reasoning'
    if 'awareness' in s: return 'General-Awareness'
    if 'engineering' in s: return f'{branch}-Engineering'
    return None


def shift_of(time_txt):
    m = re.match(r'\s*(\d{1,2}):(\d\d)\s*([AP]M)', time_txt or '')
    if not m: return None
    h = int(m.group(1)) % 12 + (12 if m.group(3) == 'PM' else 0)
    return 1 if h < 12 else 2 if h < 16 else 3


def paper_to_txt(pdf, work):
    js = os.path.join(work, 'paper.json')
    r = subprocess.run([sys.executable, '-I', os.path.join(V2, 'extract.py'), pdf, js], capture_output=True, text=True)
    if r.returncode: raise RuntimeError('PDF का format नहीं पहचाना (शायद SSC response sheet नहीं है): ' + (r.stderr.strip().splitlines() or ['?'])[-1][:200])
    subprocess.run([sys.executable, '-I', os.path.join(V2, 'gaps.py'), pdf, js], check=True, capture_output=True)
    d = json.load(open(js, encoding='utf-8')); h = d['header']
    m = re.search(r'(?:(\d{4})\s+)?(Civil|Electrical|Mechanical)', h.get('subject') or '')
    year = (m and m.group(1)) or h.get('exam_year')  # 2021 sheets: "Examination,2020" in the title
    sh = shift_of(h.get('time'))
    if not (m and year and h.get('date') and sh): raise RuntimeError(f'Paper header अधूरा: {h}')
    branch = m.group(2)
    alltext = ' '.join(q['text'] for q in d['questions'])
    if len(re.findall(r'\b(?:t he|t o|o f|io n|at io|ent ly)\b', alltext)) > 30:
        raise RuntimeError('PDF का text टूटा हुआ है (जैसे "t he co rrect") — import नहीं किया')
    dd, mm, yy = h['date'].split('/')
    shift = f'{dd} {MON[int(mm) - 1]} {yy} Shift {sh}'
    src = f"SSC JE {year} {branch} Paper I · {shift} ({h['time'].split('-')[0].strip()}) · official SSC response sheet (PDF via Oliveboard) · answer = SSC key"
    blocks, skip = {}, Counter()
    for q in d['questions']:
        subj = section_subject(q['section'] or '', branch)
        if not subj: skip['अनजान section'] += 1; continue
        if q['figs'] or q.get('gap', 0) > 30: skip['चित्र वाला'] += 1; continue
        if not q['answer']: skip['answer साफ़ नहीं'] += 1; continue
        if re.search('[ऀ-ॿ]', q['text']): skip['टूटा Hindi text'] += 1; continue  # Hindi from these PDFs loses matras
        if len(q['opts']) != 4 or not all(q['opts'].get(n, '').strip() for n in '1234'): skip['options अधूरे'] += 1; continue
        if subj == 'Reasoning':
            t = rclass(q['text'][:400]); topic = t if t in RCH else UNTAGGED; chapter = RCH.get(t, UNTAGGED)
        else:
            topic = chapter = UNTAGGED
        text = fix(join_lines(q['text']))
        hindi = bool(re.search('[ऀ-ॿ]', text)) and not re.search('[A-Za-z]{4,}', re.sub(r'\([^)]*\)', '', text))
        fl = {'SOURCE_QUESTION_NO': q['qno'], 'EXAM_NAME': 'SSC JE', 'YEAR': year, 'SHIFT': shift,
              'SUBJECT': subj, 'CHAPTER': chapter, 'TOPIC': topic, 'SOURCE_TYPE': 'PYQ',
              ('QUESTION_HI' if hindi else 'QUESTION_EN'): text}
        for n, L in zip('1234', 'ABCD'): fl[L + '_EN'] = fix(q['opts'][n])
        fl['ANSWER'] = q['answer']
        blocks.setdefault((subj, topic), []).append('=== QUESTION START ===\n' + '\n'.join(f'{k}: {v}' for k, v in fl.items()) + '\n=== QUESTION END ===\n')
    files = []
    for (s, t), b in blocks.items():
        p = os.path.join(work, f"{s}__{re.sub('[^A-Za-z]+', '_', t)}.txt")
        open(p, 'w', encoding='utf-8').write('\n'.join(b)); files.append(p)
    return dict(src=src, title=f'SSC JE {year} {branch} · {shift}', files=files, skip=skip)


def analyze(files):
    """Run the app's own ImportEngine (built index.html) -> server rows, exactly like Admin Studio."""
    from playwright.sync_api import sync_playwright
    out = {'topics': {}, 'rows': [], 'exams': {}}
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page()
        pg.goto('file://' + os.path.join(REPO, 'index.html')); pg.wait_for_selector('.sj-dash', timeout=30000)
        for f in files:
            r = pg.evaluate("""async ([t,name])=>{AppModules=[];const a=await ImportEngine.analyzeTxt(new File([t],name),'',{});
              if(!a.commitReady) return {ok:false, errors:a.validationErrors};
              const mod=studioModFromAnalysis(a); const rows=[], probs=[];
              a.questions.forEach(q=>{const r=srvQuestionRow(q,mod); if(r.problems.length) probs.push([q.originalQNo,r.problems]); else rows.push(r.row);});
              const exams={}; [srvTopicRow(mod).exam_id,...rows.map(r=>r.exam_id)].filter(Boolean).forEach(e=>{exams[e]=srvExamRow(e,a.questions[0].metadata.exam)});
              return {ok:true, topic:srvTopicRow(mod), rows, probs, exams};}""", [open(f, encoding='utf-8').read(), os.path.basename(f)])
            if not r['ok']: raise RuntimeError(f'ऐप ने file नहीं माना {os.path.basename(f)}: {str(r["errors"])[:300]}')
            if r['probs']: raise RuntimeError(f'सवालों में कमी: {str(r["probs"])[:300]}')
            out['topics'][r['topic']['id']] = r['topic']; out['rows'] += r['rows']; out['exams'].update(r['exams'])
        b.close()
    return out


def upload(paper, data, dry):
    rows = data['rows']
    ids = [r['id'] for r in rows]
    have = set()
    for i in range(0, len(ids), 60):
        q = ','.join(urllib.parse.quote('"' + x + '"') for x in ids[i:i + 60])
        have |= {x['id'] for x in api('GET', f'/rest/v1/questions?select=id&id=in.({q})') or []}
    fresh = [r for r in rows if r['id'] not in have]
    if dry or not fresh: return len(fresh), len(have)
    batch = f"ROBOT-{int(time.time() * 1000)}-{os.urandom(3).hex().upper()}"
    ign = 'resolution=ignore-duplicates,return=minimal'
    api('POST', '/rest/v1/exams?on_conflict=id', list(data['exams'].values()), ign)
    api('POST', '/rest/v1/topics?on_conflict=id', list(data['topics'].values()), ign)
    report = {'extracted': len(rows), 'already_on_server': len(have), 'added': len(fresh), 'skipped': paper.get('skip') or {},
              'subjects': dict(Counter(r.get('subject') for r in rows)), 'source_ref': paper.get('src'), 'title': paper.get('title')}
    api('POST', '/rest/v1/import_batches', [{'id': batch, 'file_name': paper['title'][:120], 'added': len(fresh), 'source_url': paper.get('url'), 'report': report}], 'return=minimal')
    for i in range(0, len(fresh), 200):
        chunk = [{**r, 'status': 'draft', 'source_ref': paper['src'], 'import_batch_id': batch} for r in fresh[i:i + 200]]
        api('POST', '/rest/v1/questions?on_conflict=id', chunk, ign)
    got = server_count('import_batch_id=eq.' + batch)
    if got != len(fresh): raise RuntimeError(f'Server जाँच fail: भेजे {len(fresh)}, मिले {got}')
    return len(fresh), len(have)


def _ops_counts(processed=None, changed=None, note=''):
    p = os.environ.get('OPS_COUNTS')
    if p:
        import json as _j
        _j.dump({'processed': processed, 'changed': changed, 'note': note}, open(p, 'w'), ensure_ascii=False)


def main(argv):
    dry = '--dry-run' in argv
    urls = [u for u in re.split(r'[\s,]+', ' '.join(a for a in argv if a != '--dry-run')) if u]
    if not urls: say('❌ कोई link नहीं मिला।'); return 1
    if not dry and not KEY: say('❌ GitHub secret SUPABASE_SECRET_KEY नहीं मिला। Settings → Secrets में डालें।'); return 1
    say(f"## 🤖 PYQ Robot {'(सिर्फ़ जाँच — server पर कुछ नहीं भेजा)' if dry else ''}")
    total, bad = 0, 0
    for n, url in enumerate(urls, 1):
        say(f'\n### {n}. {url.rsplit("/", 1)[-1]}')
        try:
            if not re.match(r'^https://[\w.-]+/', url): raise RuntimeError('link https:// से शुरू होना चाहिए')
            with tempfile.TemporaryDirectory() as work:
                pdf = os.path.join(work, 'paper.pdf')
                req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36', 'Accept': 'application/pdf,*/*;q=0.8', 'Accept-Language': 'en-IN,en;q=0.9,hi;q=0.8'})
                with urllib.request.urlopen(req, timeout=120) as r, open(pdf, 'wb') as f: f.write(r.read())
                if open(pdf, 'rb').read(5) != b'%PDF-': raise RuntimeError('यह link PDF नहीं देता')
                paper = paper_to_txt(pdf, work)
                # uploaded files come as a temporary signed link: store only the file name, never the token
                paper['url'] = ('upload:' + url.split('?')[0].rsplit('/', 1)[-1]) if '/object/sign/' in url else url
                say(f"- Paper: **{paper['title']}**")
                if KEY and server_count('source_ref=eq.' + urllib.parse.quote(paper['src'])):
                    say('- ⏭️ यह paper पहले से server पर है — छोड़ दिया।'); continue
                data = analyze(paper['files'])
                added, existed = upload(paper, data, dry) if KEY else (len(data['rows']), 0)
                total += added
                say(f"- ✅ {'भेजने लायक' if dry else 'Draft में भेजे'}: **{added}** सवाल" + (f' (पहले से थे: {existed})' if existed else ''))
                c = Counter(r['subject'] for r in data['rows'])
                say('- Subject: ' + ', '.join(f'{k} {v}' for k, v in c.items()))
                if paper['skip']: say('- छोड़े: ' + ', '.join(f'{k} {v}' for k, v in paper['skip'].items()))
        except Exception as e:
            bad += 1; say(f'- ❌ नहीं हुआ: {e}')
    say(f"\n**कुल {'भेजने लायक' if dry else 'नए draft'}: {total}**" + (f' · ❌ fail papers: {bad}' if bad else ''))
    if not dry and total: say('\nअब Admin Studio → Review में देखकर Publish करें। तब तक students को नहीं दिखेंगे।')
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8').write('\n'.join(SUMMARY) + '\n')
    _ops_counts(len(urls), 0 if dry else total, f'{len(urls)} papers, {bad} failed' + (' (dry run)' if dry else ''))
    return 1 if bad and not total else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
