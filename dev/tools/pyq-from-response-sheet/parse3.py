import json, pdfplumber, re
qs = json.load(open('qs_text.json')); g = json.load(open('geo.json'))
marks = sorted(map(tuple, g['marks']))
assert len(marks) == 800
for i, q in enumerate(qs):
    grp = marks[i*4:(i+1)*4]
    ticks = [k for k, m in enumerate(grp) if m[2] == 'tick']
    assert len(ticks) == 1, (i, grp)
    q['answer'] = 'ABCD'[ticks[0]]
    q['mark_pos'] = grp[0][:2]
# question starts: relaxed
pdf = pdfplumber.open('paper.pdf'); starts = []
for pi, page in enumerate(pdf.pages):
    for w in page.extract_words():
        m_ = re.match(r'Q\.(\d+)', w['text'])
        if m_: starts.append((pi, w['top'], int(m_.group(1)), w['x0']))
starts.sort()
print('starts', len(starts))
assert len(starts) == 200
for q, s in zip(qs, starts):
    assert q['qno'] == s[2], (q['qno'], s); q['start'] = s[:2]
for i, q in enumerate(qs):
    end = qs[i+1]['start'] if i + 1 < len(qs) else (999, 0)
    q['figs'] = [f for f in g['figs'] if tuple(q['start']) <= (f[0], f[1]) < tuple(end)]
withfig = [(q['section'][:12], q['qno'], len(q['figs']), len(q['opts'])) for q in qs if q['figs']]
print('questions with figures', len(withfig), withfig)
json.dump(qs, open('qs_full.json', 'w'), ensure_ascii=False, indent=1)
from collections import Counter; print(Counter(q['answer'] for q in qs))
