import json, re, os
qs = json.load(open('qs_full.json'))
SEC = {'General Intelligence and Reasoning': 'R', 'General Awareness': 'GA', 'General Engineering Civil and Structural': 'CE'}
SUBJ = {'R': 'Reasoning', 'GA': 'General-Awareness', 'CE': 'Civil-Engineering'}
T = {}
def put(sec, topic, chapter, nums):
    for n in nums: T[f'{sec}{n}'] = (topic, chapter)
# Reasoning
put('R', 'Series', 'Series', [1, 2, 11, 15, 18, 24, 26, 33, 41])
put('R', 'Analogy', 'Analogy & Classification', [3, 7, 10, 12, 19, 20, 22, 25, 27, 37, 46, 49, 50])
put('R', 'Coding-Decoding', 'Coding-Decoding', [5, 28, 29, 34])
put('R', 'Blood Relation', 'Blood Relation', [4, 47])
put('R', 'Seating Arrangement & Puzzle', 'Seating Arrangement & Puzzle', [6, 16, 30])
put('R', 'Syllogism', 'Syllogism', [9, 36])
put('R', 'Direction Sense', 'Direction Sense', [13, 21])
put('R', 'Mathematical Operations', 'Mathematical Operations', [31, 32, 35, 48])
put('R', 'Alphabet & Word Order', 'Alphabet & Word Order', [8, 17, 39, 42])
# General Awareness
put('GA', 'Polity', 'Indian Polity', [1, 4, 15, 26, 48])
put('GA', 'Geography', 'Geography', [2, 18, 25, 27, 43, 45, 47, 49])
put('GA', 'Economy', 'Indian Economy', [3, 10, 40])
put('GA', 'Chemistry', 'General Science', [5, 8, 12, 13, 30, 44])
put('GA', 'Biology', 'General Science', [6, 19, 21, 22, 34, 39, 41, 46])
put('GA', 'Physics', 'General Science', [24])
put('GA', 'History', 'History', [7, 32, 33, 35])
put('GA', 'Current Affairs', 'Current Affairs', [9, 11, 14, 16, 20, 28, 29, 37, 38])
put('GA', 'Computer', 'Computer Awareness', [31, 36])
put('GA', 'Static GK', 'Static GK', [17, 23, 42, 50])
# Civil
put('CE', 'Building Materials', 'Building Materials', [12, 13, 25, 38, 41, 43, 80, 92, 95, 96, 97])
put('CE', 'Concrete Technology', 'Concrete Technology', [23, 36, 37, 65, 98])
put('CE', 'RCC Design', 'Structural Design', [7, 8, 22, 30, 31, 32, 51, 62, 72])
put('CE', 'Steel Structures', 'Structural Design', [54])
put('CE', 'Strength of Materials', 'Strength of Materials', [21, 52, 70, 78])
put('CE', 'Soil Mechanics', 'Geotechnical Engineering', [5, 9, 14, 26, 63, 89, 94, 99, 100])
put('CE', 'Fluid Mechanics & Hydraulics', 'Fluid Mechanics', [3, 6, 27, 45, 46, 53, 60, 84, 87, 88, 90])
put('CE', 'Irrigation & Hydrology', 'Water Resources', [15, 19, 29, 39, 44, 47, 67])
put('CE', 'Surveying', 'Surveying', [16, 28, 34, 42, 69, 79, 91])
put('CE', 'Transportation Engineering', 'Transportation Engineering', [2, 11, 17, 35, 58, 59, 61, 66, 71, 82])
put('CE', 'Environmental Engineering', 'Environmental Engineering', [10, 33, 55, 64, 68, 73, 74, 77, 83, 85, 93])
put('CE', 'Estimating & Costing', 'Estimating & Costing', [20, 40, 49, 75, 76, 81])

MARK = re.compile(r'^(\d+\.|\(?[ivxIVX]+[.)]|\([a-dA-D1-4]\)|[A-D]\)|Statement|Conclusion|Assertion|Reason|Statements|Conclusions|Note|NOTE|\(NOTE|Compaction Test|[ऀ-ॿ]+ ?:|\()')
def join_lines(t):
    out = []
    for ln in [l.strip() for l in t.split('\n') if l.strip()]:
        if out and len(out[-1]) >= 70 and not MARK.match(ln) and not out[-1].endswith((':', '?')):
            out[-1] += ' ' + ln
        else: out.append(ln)
    return '\n'.join(out)
def fix(s):
    s = s.replace('‍', '').replace(' ̊', '°').replace('̊', '°')
    s = s.replace('तार्कि क', 'तार्किक').replace('दू सरे', 'दूसरे')
    s = re.sub(r'\b((?:k?N|kg)/)?(mm|cm|m|sec|s)([23])(?=of\b)', lambda m: (m.group(1) or '') + m.group(2) + '²³'[int(m.group(3)) - 2] + ' ', s)
    s = re.sub(r'(?<![A-Za-z])((?:k?N|kg|m)/)?(mm|cm|m|sec|s)([23])(?![0-9A-Za-z])', lambda m: (m.group(1) or '') + m.group(2) + '²³'[int(m.group(3)) - 2], s)
    for a, b in [('H2O', 'H₂O'), ('CO2', 'CO₂'), ('NH3', 'NH₃'), ('C3S', 'C₃S'), ('C2S', 'C₂S'), ('C3A', 'C₃A'), ('C4AF', 'C₄AF')]: s = re.sub(r'\b' + a + r'\b', b, s)
    s = re.sub(r'of(\d)', r'of \1', s)
    return re.sub(r'[ \t]+', ' ', s).strip()
files = {}; skipped = []
for q in qs:
    sec = SEC[q['section']]; key = f"{sec}{q['qno']}"
    if not q['text'].strip() or len(q['opts']) != 4 or (q['figs'] and key != 'R42'):
        skipped.append(key); continue
    topic, chapter = T[key]
    text = fix(join_lines(q['text']))
    hindi = bool(re.search('[ऀ-ॿ]', text)) and not re.search('[A-Za-z]{4,}', re.sub(r'\([^)]*\)', '', text))
    f = {'SOURCE_QUESTION_NO': q['qno'], 'QUESTION_ID': None, 'EXAM_NAME': 'SSC JE', 'YEAR': '2024', 'SHIFT': '05 Jun 2024 Shift 1',
         'SUBJECT': SUBJ[sec], 'CHAPTER': chapter, 'TOPIC': topic, 'SOURCE_TYPE': 'PYQ',
         ('QUESTION_HI' if hindi else 'QUESTION_EN'): text}
    for n, L in zip('1234', 'ABCD'): f[L + '_EN'] = fix(q['opts'][n])
    f['ANSWER'] = q['answer']
    blk = '=== QUESTION START ===\n' + '\n'.join(f'{k}: {v}' for k, v in f.items() if v is not None) + '\n=== QUESTION END ===\n'
    files.setdefault((SUBJ[sec], topic), []).append(blk)
os.makedirs('txt', exist_ok=True)
for (s, t), blks in files.items():
    open(f"txt/{s}__{re.sub('[^A-Za-z]+', '_', t)}.txt", 'w', encoding='utf-8').write('\n'.join(blks))
print('topics', len(files), 'questions', sum(len(v) for v in files.values()), 'skipped', len(skipped), skipped)
assert sum(len(v) for v in files.values()) == 184
