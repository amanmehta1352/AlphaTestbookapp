"""extract.py <paper.pdf> <out.json>
One SSC response-sheet PDF -> list of questions with text, options, SSC IDs, official answer (green tick), figure flags.
Combines parse.py + parse2.py + parse3.py."""
import json, re, subprocess, sys
import pdfplumber

pdf_path, out_path = sys.argv[1], sys.argv[2]
txt = subprocess.run(['pdftotext', '-layout', pdf_path, '-'], capture_output=True, text=True, check=True).stdout

# header
hdr = {}
for k, pat in [('date', r'(?:Exam|Test) Date\s+(\d\d/\d\d/\d{4})'), ('time', r'(?:Exam|Test) Time\s+(.+?)\s*\n'), ('subject', r'Subject\s+(.+?)\s*\n'),
               ('exam_year', r'Examination\s*,?\s*(\d{4})')]:
    m = re.search(pat, txt); hdr[k] = m.group(1).strip() if m else None

# text layout parse (parse2)
lines = txt.replace('\f', '\n').split('\n')
if 'ssc.digialm.com' in txt:  # browser-printed sheets (2018): drop page header/footer (date + URL + page no.)
    lines = [l for l in lines if not l.strip() or not re.match(r'^\s*(\d{1,2}/\d{1,2}/\d{4}\s*)?(https://ssc\.digialm\.com\S*.*)?$', l)]
    lines = [re.sub(r'\s*https://ssc\.digialm\.com\S*.*$', '', l) for l in lines]
qs = []; section = None; cur = None; mode = None
for raw in lines:
    s = raw.rstrip()
    m = re.match(r'\s*Section\s*:\s*(.+)', s)
    if m: section = m.group(1).strip(); continue
    m = re.match(r'\s*Q\.(\d+)\s*(.*)', s)
    if m:
        if cur: qs.append(cur)
        cur = {'section': section, 'qno': int(m.group(1)), 'text': [m.group(2)], 'opts': {}, 'ids': {}}; mode = 'q'; continue
    if cur is None: continue
    side = re.search(r'(Question ID|Option (\d) ID|Status|Chosen Option)\s*:\s*(\S+)', s)
    left = s[:side.start()] if side else s
    if side:
        if side.group(1) == 'Question ID': cur['ids']['q'] = side.group(3)
        elif side.group(2): cur['ids']['o' + side.group(2)] = side.group(3)
    m = re.match(r'(\s*Ans)?\s+([1-4])\.\s(.*)', left) if mode in ('q', 'o') else None
    if m and (m.group(1) or mode == 'o'):
        mode = 'o'; cur['last'] = m.group(2); cur['opts'][m.group(2)] = [m.group(3).strip()]; continue
    t = left.strip()
    if not t: continue
    if mode == 'q': cur['text'].append(t)
    elif mode == 'o' and not side and len(cur['ids']) == 0: cur['opts'][cur['last']].append(t)
if cur: qs.append(cur)
for q in qs:
    q['text'] = '\n'.join(x for x in q['text'] if x.strip()).strip()
    q['opts'] = {k: ' '.join(v).strip() for k, v in q['opts'].items()}
    q.pop('last', None)
assert len(qs) == 200, len(qs)

# geometry (parse + parse3)
pdf = pdfplumber.open(pdf_path)
marks, figs, starts = [], [], []
import hashlib
mark_hash = {}  # older sheets (2018): tick and cross are both 31x21, told apart by image content
for page in pdf.pages:
    for im in page.images:
        if tuple(im['srcsize']) == (31, 21): mark_hash.setdefault(hashlib.md5(im['stream'].get_data()).hexdigest(), []).append(1)
has_small_tick = any(tuple(im['srcsize']) == (16, 16) for page in pdf.pages for im in page.images)
tick_hash = None
if not has_small_tick:
    one = [h for h, v in mark_hash.items() if len(v) == len(qs)]
    if len(one) == 1 and any(len(v) == 3 * len(qs) for v in mark_hash.values()): tick_hash = one[0]
for pi, page in enumerate(pdf.pages):
    for im in page.images:
        w, h = im['srcsize']
        if (w, h) == (16, 16): marks.append((pi, im['top'], 'tick'))
        elif (w, h) == (31, 21):
            marks.append((pi, im['top'], 'tick' if tick_hash and hashlib.md5(im['stream'].get_data()).hexdigest() == tick_hash else 'cross'))
        elif (w, h) == (411, 488): pass
        else: figs.append((pi, im['top'], im['bottom'], im['x0'], im['x1'], (w, h)))
    for w in page.extract_words():
        m_ = re.match(r'Q\.(\d+)', w['text'])
        if m_ and w['x0'] < 120: starts.append((pi, w['top'], int(m_.group(1))))
marks.sort(); starts.sort()
assert len(starts) == 200, len(starts)
for i, q in enumerate(qs):
    assert q['qno'] == starts[i][2], (q['qno'], starts[i])
    q['start'] = starts[i][:2]
for i, q in enumerate(qs):
    end = qs[i+1]['start'] if i + 1 < len(qs) else (999, 0)
    q['figs'] = [f for f in figs if tuple(q['start']) <= (f[0], f[1]) < tuple(end)]
    grp = [m for m in marks if tuple(q['start']) <= (m[0], m[1]) < tuple(end)]
    ticks = [k for k, m in enumerate(grp) if m[2] == 'tick']
    # answer only when the sheet shows exactly 4 marks with exactly one green tick
    q['answer'] = 'ABCD'[ticks[0]] if len(grp) == 4 and len(ticks) == 1 else None
bad = [(q['section'][:10], q['qno']) for q in qs if len(q['opts']) != 4 or 'q' not in q['ids']]
json.dump({'header': hdr, 'questions': qs}, open(out_path, 'w'), ensure_ascii=False, indent=1)
from collections import Counter
print(hdr, 'figs-q', sum(1 for q in qs if q['figs']), 'incomplete', bad, dict(Counter(q['answer'] for q in qs)))
