"""PYQ Robot — SSC JE response sheets + bilingual RRB JE CBT PDFs -> ImportEngine draft questions.

Runs on GitHub Actions (.github/workflows/pyq-robot.yml), so it costs no Claude usage.
  python3 dev/tools/pyq-robot/robot.py [--dry-run] URL [URL ...]

Steps per PDF: download -> v2/extract.py + v2/gaps.py -> app TXT -> the app's own ImportEngine
(built index.html, same IDs/hash as Admin Studio) -> insert into Supabase as status='draft'.
Safety:
- Only explicit answer keys / SSC green ticks are used. Bilingual question and all A-D options are required before ImportEngine.
- Questions with a figure / big blank gap / no clear answer are skipped (app can't show images).
- Existing rows are never changed (insert with ignore-duplicates). A paper whose source_ref is
  already on the server is skipped, so running the same link twice is harmless.
- Reasoning gets its chapter by rules; other sections go to topic "Mixed (Untagged)" for later tagging.
- The secret key comes only from env SUPABASE_SECRET_KEY (GitHub secret). It is never printed.
"""
import json, os, re, subprocess, sys, tempfile, time, urllib.parse, urllib.request
from collections import Counter
import unicodedata
from html import unescape
from html.parser import HTMLParser
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
V2 = os.path.join(REPO, 'dev', 'tools', 'pyq-from-response-sheet', 'v2')
sys.path.insert(0, REPO)
sys.path.insert(0, V2)
sys.path.insert(0, HERE)

from rfirst import rclass  # noqa: E402
from safe_http import safe_download_file  # noqa: E402

SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://fzkvwkrbtykucjfdqiin.supabase.co').rstrip('/')
KEY = os.environ.get('SUPABASE_SECRET_KEY', '').strip()
MON = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split()
RCH = {'Series': 'Series', 'Analogy': 'Analogy & Classification', 'Coding-Decoding': 'Coding-Decoding', 'Blood Relation': 'Blood Relation',
       'Seating Arrangement & Puzzle': 'Seating Arrangement & Puzzle', 'Syllogism': 'Syllogism', 'Direction Sense': 'Direction Sense',
       'Mathematical Operations': 'Mathematical Operations', 'Alphabet & Word Order': 'Alphabet & Word Order'}
UNTAGGED = 'Mixed (Untagged)'
SUMMARY = []

def say(line=''):
    print(line, flush=True)
    SUMMARY.append(line)

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
    for a, b in LIG.items():
        s = s.replace(a, b)
    s = s.replace('‍', '').replace('​', '').replace(' ̊', '°').replace('̊', '°')
    s = re.sub(r'(?<![A-Za-z])((?:k?N|kg|m)/)?(mm|cm|km|m|sec|s)([23])(?![0-9A-Za-z])', lambda m: (m.group(1) or '') + m.group(2) + '²³'[int(m.group(3)) - 2], s)
    for a, b in [('H2O', 'H₂O'), ('CO2', 'CO₂'), ('NH3', 'NH₃'), ('C3S', 'C₃S'), ('C2S', 'C₂S'), ('C3A', 'C₃A'), ('C4AF', 'C₄AF')]:
        s = re.sub(r'\b' + a + r'\b', b, s)
    return re.sub(r'[ \t]+', ' ', s).strip()

# ---------- server ----------
def api(method, path, body=None, prefer=None):
    h = {'apikey': KEY, 'Content-Type': 'application/json', 'x-actor': 'pyq-robot'}
    if KEY.startswith('eyJ'):
        h['Authorization'] = 'Bearer ' + KEY
    if prefer:
        h['Prefer'] = prefer
    req = urllib.request.Request(
        SUPABASE_URL + path,
        method=method,
        headers=h,
        data=None if body is None else json.dumps(body, ensure_ascii=False).encode()
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                txt = r.read().decode()
                return json.loads(txt) if txt else None
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:300]
            if e.code >= 500 and attempt < 2:
                time.sleep(3)
                continue
            raise RuntimeError(f'server {e.code}: {msg}')

def server_count(filt):
    rows = api('GET', '/rest/v1/questions?select=id&' + filt + '&limit=1000')
    return len(rows or [])

# ---------- one paper ----------
def section_subject(sec, branch):
    s = sec.lower()
    if 'reason' in s or 'intelligence' in s:
        return 'Reasoning'
    if 'awareness' in s:
        return 'General-Awareness'
    if 'engineering' in s:
        return f'{branch}-Engineering'
    return None

def shift_of(time_txt):
    m = re.match(r'\s*(\d{1,2}):(\d\d)\s*([AP]M)', time_txt or '')
    if not m:
        return None
    h = int(m.group(1)) % 12 + (12 if m.group(3) == 'PM' else 0)
    return 1 if h < 12 else 2 if h < 16 else 3

class _PageLinkParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title_parts = []
        self.links = []
        self.in_title = False

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "title":
            self.in_title = True
        if tag.lower() == "a":
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)

    def handle_endtag(self, tag):
        if tag.lower() == "title":
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title_parts.append(data)


def download_pdf_or_page(url, pdf, headers):
    """Accept a direct PDF URL or a public document page that links to a PDF."""
    safe_download_file(
        url, pdf, headers=headers, timeout=120, retries=3, backoff_factor=0.5,
        debug=(os.environ.get("DEBUG_PYQ") == "1"),
    )
    with open(pdf, "rb") as fh:
        if fh.read(5) == b"%PDF-":
            return None

    with open(pdf, "rb") as fh:
        page = fh.read(3 * 1024 * 1024).decode("utf-8", "ignore")
    if "<html" not in page.lower() and "<!doctype html" not in page.lower():
        raise RuntimeError("यह link PDF नहीं देता और HTML document page भी नहीं है")

    parser = _PageLinkParser()
    parser.feed(page)
    title = unescape(" ".join(" ".join(parser.title_parts).split())).strip()
    candidates = []
    for href in parser.links:
        lower = href.lower()
        if "single-doc-download" in lower or ".pdf" in lower or "download" in lower:
            full = urllib.parse.urljoin(url, href)
            if full not in candidates:
                candidates.append(full)
    candidates.sort(key=lambda x: (0 if "single-doc-download" in x.lower() else 1 if ".pdf" in x.lower() else 2))
    last_error = None
    for candidate in candidates[:8]:
        try:
            safe_download_file(
                candidate, pdf, headers=headers, timeout=120, retries=3, backoff_factor=0.5,
                debug=(os.environ.get("DEBUG_PYQ") == "1"),
            )
            with open(pdf, "rb") as fh:
                if fh.read(5) == b"%PDF-":
                    return title or None
        except Exception as exc:
            last_error = exc
    detail = f" ({title})" if title else ""
    if last_error:
        detail += f" · download error: {str(last_error)[:160]}"
    raise RuntimeError("Webpage मिली, लेकिन उसमें downloadable PDF नहीं मिला" + detail)


def rrb_je_paper_to_txt(pdf, work, source_name, source_title, source_url, original_error=None):
    """Convert a bilingual RRB JE CBT paper to ImportEngine TXT; uncertain questions stay out."""
    from rrb_je_extract import parse_text, pdf_text as rrb_pdf_text

    text = rrb_pdf_text(Path(pdf))
    title_hint = " ".join(x for x in [source_name or "", source_title or "", source_url or ""] if x)
    if not re.search(r"\bRRB\b|Railway Recruitment Board", title_hint, re.I):
        if original_error:
            raise RuntimeError(original_error)
        raise RuntimeError("PDF RRB JE जैसा है, लेकिन exam title नहीं मिला; document page/title वाला link दें")
    data = parse_text(text, source_name or os.path.basename(pdf))
    if not data.get("question_count"):
        raise RuntimeError("RRB JE PDF से कोई numbered question नहीं निकला")

    year = data.get("year") or (re.search(r"\b(20\d{2})\b", title_hint) or [None, None])[1]
    if not year:
        raise RuntimeError("RRB JE PDF में year नहीं मिला; import रोक दिया")
    date_match = re.search(r"Exam Date\s*:\s*(\d{2})-(\d{2})-(\d{4})", text[:10000], re.I)
    title_date = re.search(r"\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(20\d{2})\b", title_hint, re.I)
    shift_match = re.search(r"\bshift\s*(\d+)\b", title_hint, re.I)
    shift_no = int(shift_match.group(1)) if shift_match else None
    if not shift_no:
        tm = re.search(r"Exam Time\s*:\s*(\d{1,2}):(\d{2})", text[:10000], re.I)
        if tm:
            hour = int(tm.group(1))
            shift_no = 1 if hour < 12 else 2 if hour < 16 else 3
    shift_no = shift_no or 1
    if date_match:
        dd, mm, yy = date_match.groups()
        shift = f"{dd} {MON[int(mm) - 1]} {yy} Shift {shift_no}"
    elif title_date:
        dd, mon, yy = title_date.groups()
        shift = f"{int(dd):02d} {mon.title()} {yy} Shift {shift_no}"
    else:
        shift = f"{year} Shift {shift_no}"

    src = f"RRB JE {year} {shift} · {source_title or source_name or 'CBT paper'} · bilingual answer-key PDF"[:220]
    title = f"RRB JE {year} · {shift}"
    blocks, skip = {}, Counter()
    seen_question_numbers, seen_fingerprints = set(), set()
    def fingerprint_text(value):
        # Match ImportEngine.importNormText exactly: NFKC, lowercase, collapse whitespace.
        value = unicodedata.normalize("NFKC", str(value or "")).lower()
        return " ".join(value.split())
    for q in data["questions"]:
        reasons = q.get("review_reasons") or []
        if q.get("status") != "EXTRACTED":
            skip["review required: " + ",".join(reasons or ["unknown"])] += 1
            continue
        if not q.get("question_en", "").strip() or not q.get("question_hi", "").strip():
            skip["bilingual question missing"] += 1
            continue
        if any(not q.get("options_en", {}).get(k, "").strip() or not q.get("options_hi", {}).get(k, "").strip() for k in "ABCD"):
            skip["bilingual options missing"] += 1
            continue
        if q.get("answer") not in set("ABCD"):
            skip["answer key missing"] += 1
            continue
        qno = q.get("source_question_no")
        if qno in seen_question_numbers:
            skip["duplicate question number"] += 1
            continue
        fp = "|".join([fingerprint_text(q.get("question_en"))] + [fingerprint_text(q.get("options_en", {}).get(k)) for k in "ABCD"])
        if fp in seen_fingerprints:
            skip["duplicate question fingerprint"] += 1
            continue
        seen_question_numbers.add(qno)
        seen_fingerprints.add(fp)

        fields = {
            "SOURCE_QUESTION_NO": q["source_question_no"],
            "EXAM_NAME": "RRB JE",
            "YEAR": year,
            "SHIFT": shift,
            "SUBJECT": UNTAGGED,
            "CHAPTER": UNTAGGED,
            "TOPIC": UNTAGGED,
            "SOURCE_TYPE": "PYQ",
            "QUESTION_EN": fix(q["question_en"]),
            "QUESTION_HI": fix(q["question_hi"]),
        }
        for letter in "ABCD":
            fields[letter + "_EN"] = fix(q["options_en"][letter])
            fields[letter + "_HI"] = fix(q["options_hi"][letter])
        fields["ANSWER"] = q["answer"]
        blocks.setdefault((UNTAGGED, UNTAGGED), []).append(
            "=== QUESTION START ===\n" + "\n".join(f"{k}: {v}" for k, v in fields.items()) + "\n=== QUESTION END ===\n"
        )

    files = []
    for (subject, topic), entries in blocks.items():
        path = os.path.join(work, "RRB_JE_Mixed_Untagged.txt")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("\n".join(entries))
        files.append(path)
    if not files:
        top_reasons = ", ".join(f"{k} {v}" for k, v in skip.most_common(5))
        raise RuntimeError(f"RRB JE PDF से bilingual + answer-key QA पास करने वाला सवाल नहीं मिला. Extracted={data['question_count']}; skipped: {top_reasons}")
    return dict(src=src, title=title, files=files, skip=dict(skip))


def paper_to_txt(pdf, work, source_name=None, source_title=None, source_url=None):
    hint = " ".join(x for x in [source_name or "", source_title or "", source_url or ""] if x)
    if re.search(r"\bRRB\b|Railway Recruitment Board", hint, re.I):
        return rrb_je_paper_to_txt(pdf, work, source_name, source_title, source_url)
    js = os.path.join(work, 'paper.json')
    r = subprocess.run(
        [sys.executable, '-I', os.path.join(V2, 'extract.py'), pdf, js],
        capture_output=True,
        text=True
    )
    if r.returncode:
        reason = 'PDF का format नहीं पहचाना (शायद SSC response sheet नहीं है): ' + (r.stderr.strip().splitlines() or ['?'])[-1][:200]
        return rrb_je_paper_to_txt(pdf, work, source_name, source_title, source_url, original_error=reason)

    try:
        subprocess.run([sys.executable, '-I', os.path.join(V2, 'gaps.py'), pdf, js], check=True, capture_output=True)
    except subprocess.CalledProcessError:
        return rrb_je_paper_to_txt(pdf, work, source_name, source_title, source_url, original_error='SSC PDF gap detection failed; generic fallback unavailable')
    d = json.load(open(js, encoding='utf-8'))
    h = d['header']
    m = re.search(r'(?:(\d{4})\s+)?(Civil|Electrical|Mechanical)', h.get('subject') or '')
    year = (m and m.group(1)) or h.get('exam_year')
    sh = shift_of(h.get('time'))
    if not (m and year and h.get('date') and sh):
        return rrb_je_paper_to_txt(pdf, work, source_name, source_title, source_url, original_error=f'Paper header अधूरा: {h}')
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
        if not subj:
            skip['अनजान section'] += 1
            continue
        if q['figs'] or q.get('gap', 0) > 30:
            skip['चित्र वाला'] += 1
            continue
        if not q['answer']:
            skip['answer साफ़ नहीं'] += 1
            continue
        if re.search('[ऀ-ॿ]', q['text']):
            skip['टूटा Hindi text'] += 1
            continue
        if len(q['opts']) != 4 or not all(q['opts'].get(n, '').strip() for n in '1234'):
            skip['options अधूरे'] += 1
            continue
        if subj == 'Reasoning':
            t = rclass(q['text'][:400])
            topic = t if t in RCH else UNTAGGED
            chapter = RCH.get(t, UNTAGGED)
        else:
            topic = chapter = UNTAGGED

        text = fix(join_lines(q['text']))
        hindi = bool(re.search('[ऀ-ॿ]', text)) and not re.search('[A-Za-z]{4,}', re.sub(r'\([^)]*\)', '', text))
        fl = {
            'SOURCE_QUESTION_NO': q['qno'],
            'EXAM_NAME': 'SSC JE',
            'YEAR': year,
            'SHIFT': shift,
            'SUBJECT': subj,
            'CHAPTER': chapter,
            'TOPIC': topic,
            'SOURCE_TYPE': 'PYQ',
            ('QUESTION_HI' if hindi else 'QUESTION_EN'): text,
        }
        for n, L in zip('1234', 'ABCD'):
            fl[L + '_EN'] = fix(q['opts'][n])
        fl['ANSWER'] = q['answer']
        blocks.setdefault((subj, topic), []).append(
            '=== QUESTION START ===\n' + '\n'.join(f'{k}: {v}' for k, v in fl.items()) + '\n=== QUESTION END ===\n'
        )

    files = []
    for (s, t), b in blocks.items():
        p = os.path.join(work, f"{s}__{re.sub('[^A-Za-z]+', '_', t)}.txt")
        with open(p, 'w', encoding='utf-8') as f:
            f.write('\n'.join(b))
        files.append(p)

    return dict(src=src, title=f'SSC JE {year} {branch} · {shift}', files=files, skip=skip)

def assert_bilingual_txt(text, filename="input.txt"):
    """Do not let ImportEngine silently duplicate English into missing Hindi fields."""
    blocks = re.findall(r"=== QUESTION START ===(.*?)=== QUESTION END ===", text, re.S)
    if not blocks:
        raise RuntimeError(f"{filename}: कोई question block नहीं मिला")
    required = ["QUESTION_EN", "QUESTION_HI"] + [f"{letter}_{lang}" for letter in "ABCD" for lang in ("EN", "HI")]
    bad = []
    for index, block in enumerate(blocks, 1):
        missing = [field for field in required if not re.search(rf"(?m)^{re.escape(field)}:\s*\S", block)]
        if missing:
            bad.append(f"Q{index}: {','.join(missing)}")
    if bad:
        raise RuntimeError(f"{filename}: bilingual gate ने {len(bad)}/{len(blocks)} सवाल रोके; English को Hindi की जगह duplicate नहीं किया जाएगा. " + "; ".join(bad[:4]))


def analyze(files):
    """Run the app's own ImportEngine (built index.html) -> server rows, exactly like Admin Studio."""
    from playwright.sync_api import sync_playwright

    out = {'topics': {}, 'rows': [], 'exams': {}}
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        pg.goto('file://' + os.path.join(REPO, 'index.html'))
        pg.wait_for_selector('.sj-dash', timeout=30000)

        for f in files:
            with open(f, encoding='utf-8') as fh:
                t = fh.read()
            assert_bilingual_txt(t, os.path.basename(f))
            r = pg.evaluate(
                """async ([t,name])=>{
                    AppModules=[];
                    const a=await ImportEngine.analyzeTxt(new File([t],name),'',{});
                    if(!a.commitReady) return {ok:false, errors:a.validationErrors, duplicates:a.duplicateBatch, external:a.duplicateExternal, total:a.totalQuestions};
                    const mod=studioModFromAnalysis(a); const rows=[], probs=[];
                    a.questions.forEach(q=>{const r=srvQuestionRow(q,mod); if(r.problems.length) probs.push([q.originalQNo,r.problems]); else rows.push(r.row);});
                    const exams={}; [srvTopicRow(mod).exam_id,...rows.map(r=>r.exam_id)].filter(Boolean).forEach(e=>{exams[e]=srvExamRow(e,a.questions[0].metadata.exam)});
                    return {ok:true, topic:srvTopicRow(mod), rows, probs, exams};
                }""",
                [t, os.path.basename(f)]
            )
            if not r['ok']:
                detail = {'errors': r.get('errors'), 'duplicates': r.get('duplicates'), 'external': r.get('external'), 'total': r.get('total')}
                raise RuntimeError(f'ऐप ने file नहीं माना {os.path.basename(f)}: {str(detail)[:500]}')
            if r['probs']:
                raise RuntimeError(f'सवालों में कमी: {str(r["probs"])[:300]}')
            out['topics'][r['topic']['id']] = r['topic']
            out['rows'] += r['rows']
            out['exams'].update(r['exams'])
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
    if dry or not fresh:
        return len(fresh), len(have)

    batch = f"ROBOT-{int(time.time() * 1000)}-{os.urandom(3).hex().upper()}"
    ign = 'resolution=ignore-duplicates,return=minimal'

    api('POST', '/rest/v1/exams?on_conflict=id', list(data['exams'].values()), ign)
    api('POST', '/rest/v1/topics?on_conflict=id', list(data['topics'].values()), ign)

    report = {
        'extracted': len(rows),
        'already_on_server': len(have),
        'added': len(fresh),
        'skipped': paper.get('skip') or {},
        'subjects': dict(Counter(r.get('subject') for r in rows)),
        'source_ref': paper.get('src'),
        'title': paper.get('title')
    }
    api('POST', '/rest/v1/import_batches', [{
        'id': batch,
        'file_name': paper['title'][:120],
        'added': len(fresh),
        'source_url': paper.get('url'),
        'report': report
    }], 'return=minimal')

    for i in range(0, len(fresh), 200):
        chunk = [{**r, 'status': 'draft', 'source_ref': paper['src'], 'import_batch_id': batch} for r in fresh[i:i + 200]]
        api('POST', '/rest/v1/questions?on_conflict=id', chunk, ign)

    got = server_count('import_batch_id=eq.' + batch)
    if got != len(fresh):
        raise RuntimeError(f'Server जाँच fail: भेजे {len(fresh)}, मिले {got}')
    return len(fresh), len(have)

def _ops_counts(processed=None, changed=None, note=''):
    p = os.environ.get('OPS_COUNTS')
    if p:
        import json as _j
        _j.dump({'processed': processed, 'changed': changed, 'note': note}, open(p, 'w'), ensure_ascii=False)

def split_pdf_links(argv):
    """Accept links separated by spaces, commas, or newlines."""
    raw = " ".join(a for a in argv if a != "--dry-run")
    return [u.strip() for u in re.split(r"[\s,]+", raw) if u.strip()]


def validate_pdf_url(url):
    """Validate a user-supplied HTTPS URL without a brittle hostname regex."""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme.lower() != "https" or not parts.hostname:
        raise RuntimeError("link https:// से शुरू होना चाहिए और उसमें valid hostname होना चाहिए")
    if parts.username or parts.password:
        raise RuntimeError("URL में embedded username/password स्वीकार नहीं है")
    return parts
def exit_code_for_results(total, failed_papers):
    """Fail the workflow whenever any supplied PDF failed, even after partial success."""
    return 1 if failed_papers else 0
def main(argv):
    dry = '--dry-run' in argv
    urls = split_pdf_links(argv)
    if not urls:
        say('❌ कोई link नहीं मिला।')
        return 1
    if not dry and not KEY:
        say('❌ GitHub secret SUPABASE_SECRET_KEY नहीं मिला। Settings → Secrets में डालें।')
        return 1

    say(f"## 🤖 PYQ Robot {'(सिर्फ़ जाँच — server पर कुछ नहीं भेजा)' if dry else ''}")
    total, bad = 0, 0

    for n, url in enumerate(urls, 1):
        say(f'\n### {n}. {url.rsplit("/", 1)[-1]}')
        try:
            validate_pdf_url(url)

            with tempfile.TemporaryDirectory() as work:
                pdf = os.path.join(work, 'paper.pdf')
                headers = {
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
                    'Accept': 'application/pdf,*/*;q=0.8',
                    'Accept-Language': 'en-IN,en;q=0.9,hi;q=0.8'
                }
                source_name = urllib.parse.urlsplit(url).path.rsplit('/', 1)[-1] or 'paper.pdf'
                page_title = download_pdf_or_page(url, pdf, headers)
                paper = paper_to_txt(pdf, work, source_name=source_name, source_title=page_title, source_url=url)
                paper['url'] = ('upload:' + url.split('?')[0].rsplit('/', 1)[-1]) if '/object/sign/' in url else url
                say(f"- Paper: **{paper['title']}**")

                if KEY and server_count('source_ref=eq.' + urllib.parse.quote(paper['src'])):
                    say('- ⏭️ यह paper पहले से server पर है — छोड़ दिया।')
                    continue

                data = analyze(paper['files'])
                added, existed = upload(paper, data, dry) if KEY else (len(data['rows']), 0)
                total += added
                say(f"- ✅ {'भेजने लायक' if dry else 'Draft में भेजे'}: **{added}** सवाल" + (f' (पहले से थे: {existed})' if existed else ''))
                c = Counter(r['subject'] for r in data['rows'])
                say('- Subject: ' + ', '.join(f'{k} {v}' for k, v in c.items()))
                if paper['skip']:
                    say('- छोड़े: ' + ', '.join(f'{k} {v}' for k, v in paper['skip'].items()))
        except Exception as e:
            bad += 1
            say(f'- ❌ नहीं हुआ: {e}')

    say(f"\n**कुल {'भेजने लायक' if dry else 'नए draft'}: {total}**" + (f' · ❌ fail papers: {bad}' if bad else ''))
    if not dry and total:
        say('\nअब Admin Studio → Review में देखकर Publish करें। तब तक students को नहीं दिखेंगे।')
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8').write('\n'.join(SUMMARY) + '\n')

    _ops_counts(len(urls), 0 if dry else total, f'{len(urls)} papers, {bad} failed' + (' (dry run)' if dry else ''))
    return exit_code_for_results(total, bad)

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
