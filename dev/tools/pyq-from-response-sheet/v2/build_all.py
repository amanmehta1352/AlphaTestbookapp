import json, re, os, glob, sys, shutil
sys.path.insert(0, os.path.dirname(__file__))
from rfirst import rclass
from map_ga import GA
from map_eng import ENG, HOLD, CH
SHIFT = {'9:00 AM - 11:00 AM': 1, '1:00 PM - 3:00 PM': 2, '5:00 PM - 7:00 PM': 3}
MON = {'05': 'Jun', '06': 'Jun', '07': 'Jun'}
RCH = {'Series': 'Series', 'Analogy': 'Analogy & Classification', 'Coding-Decoding': 'Coding-Decoding', 'Blood Relation': 'Blood Relation',
       'Seating Arrangement & Puzzle': 'Seating Arrangement & Puzzle', 'Syllogism': 'Syllogism', 'Direction Sense': 'Direction Sense',
       'Mathematical Operations': 'Mathematical Operations', 'Alphabet & Word Order': 'Alphabet & Word Order'}
GCH = {'Polity': 'Indian Polity', 'Geography': 'Geography', 'Economy': 'Indian Economy', 'Chemistry': 'General Science', 'Biology': 'General Science',
       'Physics': 'General Science', 'History': 'History', 'Current Affairs': 'Current Affairs', 'Computer': 'Computer Awareness', 'Static GK': 'Static GK'}
MARK = re.compile(r'^(\d+\.|\(?[ivxIVX]+[.)]|\([a-dA-D1-4]\)|[A-D][.)]|[a-d]\)|\d\)|Statement|Conclusion|Assertion|Reason|Statements|Conclusions|Note|NOTE|\(NOTE|[ऀ-ॿ]+ ?:|\()')
def join_lines(t):
    out = []
    for ln in [l.strip() for l in t.split('\n') if l.strip()]:
        if out and len(out[-1]) >= 70 and not MARK.match(ln) and not out[-1].endswith((':', '?')):
            out[-1] += ' ' + ln
        else: out.append(ln)
    return '\n'.join(out)
REPL = [('दू सरे', 'दूसरे'), ('अक्टू बर', 'अक्टूबर'), ('रे ड्डी', 'रेड्डी'), ('संस्कृ त', 'संस्कृत'), ('सिकं दर', 'सिकंदर'), ('इलेक्ट्रि कल', 'इलेक्ट्रिकल'), ('तार्कि क', 'तार्किक'),
        ('C2 H6', 'C₂H₆'), ('C3 H3', 'C₃H₃'), ('C3 H6', 'C₃H₆'), ('CCl3F', 'CCl₃F'), ('C4 H10', 'C₄H₁₀'), ('Ca2O2', 'Ca₂O₂'), ('CaO2', 'CaO₂'), ('Ca2O', 'Ca₂O'), ('N2O5', 'N₂O₅'), ('and H2', 'and H₂'),
        ('½ at2', '½ at²'), ('10t3', '10t³'), ('× 10-4', '× 10⁻⁴'), ('GM/R2', 'GM/R²'), ('GMR2', 'GMR²'), ('GM2/R', 'GM²/R'), ('x2y', 'x²y'), ('xy2', 'xy²'),
        ('R= v2/', 'R = v²/'), ('efficiency2', 'efficiency²')]
def fix(s):
    s = s.replace('‍', '').replace('​', '').replace(' ̊', '°').replace('̊', '°')
    for a, b in REPL: s = s.replace(a, b)
    s = re.sub(r'(?<![A-Za-z])((?:k?N|kg|m)/)?(mm|cm|km|m|sec|s)([23])(?![0-9A-Za-z])', lambda m: (m.group(1) or '') + m.group(2) + '²³'[int(m.group(3)) - 2], s)
    for a, b in [('H2O', 'H₂O'), ('CO2', 'CO₂'), ('NH3', 'NH₃'), ('C3S', 'C₃S'), ('C2S', 'C₂S'), ('C3A', 'C₃A'), ('C4AF', 'C₄AF')]: s = re.sub(r'\b' + a + r'\b', b, s)
    return re.sub(r'[ \t]+', ' ', s).strip()
out = sys.argv[1]; shutil.rmtree(out, ignore_errors=True); os.makedirs(out)
files = {}; held = []; meta = {}
for f in sorted(glob.glob(os.path.join(os.path.dirname(__file__), '..', 'x', '*-2024-S*.json'))):
    m = re.search(r'(Civil|Electrical|Mechanical)-Question-Paper-2024-in-English-(\d\d)-(\d\d)-2024-S\d', f)
    d = json.load(open(f)); h = d['header']
    branch = m.group(1); day = h['date'][:2]; sh = SHIFT[h['time']]
    tag = branch[0] + day + 'S' + str(sh) if branch != 'Mechanical' else None
    tag = {'C': 'C', 'E': 'E', 'M': 'M'}[branch[0]] + day + 'S' + str({'Civil': sh, 'Electrical': sh, 'Mechanical': sh}[branch])
    # map keys used in map_* (Oliveboard file labels): M05S3 is really Shift 2 per the sheet header
    key = branch[0] + m.group(2) + re.search(r'S\d', f[-8:]).group(0)
    shift = f'{day} Jun 2024 Shift {sh}'
    meta[key] = dict(branch=branch, shift=shift, time=h['time'], subject=h['subject'], n=0)
    for q in d['questions']:
        if not q['usable']: continue
        subj = q['subject']
        if subj == 'Reasoning': topic = rclass(q['text'][:400]); chapter = RCH[topic]
        elif subj == 'General-Awareness': topic = GA[(key, q['qno'])]; chapter = GCH[topic]
        else:
            topic = ENG[(key, q['qno'])]; chapter = CH.get(topic, topic)
        if (key, q['qno']) in HOLD and subj.endswith('Engineering'): held.append((key, q['qno'], HOLD[(key, q['qno'])])); continue
        text = fix(join_lines(q['text']))
        hindi = bool(re.search('[ऀ-ॿ]', text)) and not re.search('[A-Za-z]{4,}', re.sub(r'\([^)]*\)', '', text))
        fl = {'SOURCE_QUESTION_NO': q['qno'], 'EXAM_NAME': 'SSC JE', 'YEAR': '2024', 'SHIFT': shift,
              'SUBJECT': subj, 'CHAPTER': chapter, 'TOPIC': topic, 'SOURCE_TYPE': 'PYQ',
              ('QUESTION_HI' if hindi else 'QUESTION_EN'): text}
        for n, L in zip('1234', 'ABCD'): fl[L + '_EN'] = fix(q['opts'][n])
        fl['ANSWER'] = q['answer']
        blk = '=== QUESTION START ===\n' + '\n'.join(f'{k}: {v}' for k, v in fl.items()) + '\n=== QUESTION END ===\n'
        files.setdefault((key, subj, topic), []).append(blk); meta[key]['n'] += 1
for (k, s, t), blks in files.items():
    open(os.path.join(out, f"{k}__{s}__{re.sub('[^A-Za-z]+', '_', t)}.txt"), 'w', encoding='utf-8').write('\n'.join(blks))
json.dump({'meta': meta, 'held': held}, open(os.path.join(out, '_meta.json'), 'w'), ensure_ascii=False, indent=1)
print('files', len(files), 'questions', sum(len(v) for v in files.values()), 'held', held)
for k, v in meta.items(): print(k, v)
