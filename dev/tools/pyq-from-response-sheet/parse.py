import pdfplumber, re, json, sys
pdf = pdfplumber.open('paper.pdf')
Q = []  # questions in order
cur_section = None
marks = []  # (page, top, kind)
figs = []   # (page, top, bottom, x0, x1, bbox)
qstarts = []  # (page, top, label)
for pi, page in enumerate(pdf.pages):
    for im in page.images:
        w, h = im['srcsize']
        if (w, h) == (16, 16): marks.append((pi, im['top'], 'tick'))
        elif (w, h) == (31, 21): marks.append((pi, im['top'], 'cross'))
        elif (w, h) == (411, 488): pass  # watermark
        else: figs.append((pi, im['top'], im['bottom'], im['x0'], im['x1'], (w, h)))
    words = page.extract_words(keep_blank_chars=False)
    for w in words:
        if re.fullmatch(r'Q\.\d+', w['text']) and w['x0'] < 80: qstarts.append((pi, w['top'], w['text']))
marks.sort(); qstarts.sort()
print('questions', len(qstarts), 'marks', len(marks), 'ticks', sum(1 for m in marks if m[2]=='tick'), 'figs', len(figs))
json.dump({'marks': marks, 'qstarts': qstarts, 'figs': figs}, open('geo.json', 'w'))
