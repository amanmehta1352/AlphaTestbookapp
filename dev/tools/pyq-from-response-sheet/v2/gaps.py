"""gaps.py <paper.pdf> <x.json>  -> adds q['gap'] = largest blank vertical gap (pt) inside the question's left column.
Catches figures that are missing/vector (Mechanical PDFs) as big empty space."""
import json, sys, pdfplumber
pdf_path, js = sys.argv[1], sys.argv[2]
d = json.load(open(js)); qs = d['questions']
pdf = pdfplumber.open(pdf_path)
lines = []  # (page, top, bottom)
for pi, pg in enumerate(pdf.pages):
    for w in pg.extract_words():
        if w['x0'] < 330: lines.append((pi, w['top'], w['bottom']))
    for im in pg.images:
        if tuple(im['srcsize']) in ((16, 16), (31, 21)): lines.append((pi, im['top'], im['bottom'], 'm'))
lines.sort()
for i, q in enumerate(qs):
    end = tuple(qs[i+1]['start']) if i + 1 < len(qs) else (999, 0)
    ls = [l for l in lines if tuple(q['start']) <= (l[0], l[1]) < end]
    mk = [k for k, l in enumerate(ls) if len(l) == 4]
    ls = ls[:mk[-1] + 1] if mk else ls
    gap = 0
    for a, b in zip(ls, ls[1:]):
        if a[0] == b[0]: gap = max(gap, b[1] - a[2])
    # trailing gap of the last line of the last question in the region is ignored (page bottoms vary)
    q['gap'] = round(gap)
json.dump(d, open(js, 'w'), ensure_ascii=False, indent=1)
