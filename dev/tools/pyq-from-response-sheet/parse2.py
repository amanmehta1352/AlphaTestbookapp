import re, json
txt = open('paper.txt', encoding='utf-8').read().replace('\f', '\n')
lines = txt.split('\n')
qs = []; section = None; cur = None; mode = None
def flush():
    if cur: qs.append(cur)
for raw in lines:
    s = raw.rstrip()
    m = re.match(r'\s*Section\s*:\s*(.+)', s)
    if m: section = m.group(1).strip(); continue
    m = re.match(r'Q\.(\d+)\s*(.*)', s)
    if m:
        flush(); cur = {'section': section, 'qno': int(m.group(1)), 'text': [m.group(2)], 'opts': {}, 'ids': {}}; mode = 'q'; continue
    if cur is None: continue
    side = re.search(r'(Question ID|Option (\d) ID|Status|Chosen Option)\s*:\s*(\S+)', s)
    left = s[:side.start()] if side else s
    if side:
        if side.group(1) == 'Question ID': cur['ids']['q'] = side.group(3)
        elif side.group(2): cur['ids']['o' + side.group(2)] = side.group(3)
    m = re.match(r'(Ans)?\s+([1-4])\.\s(.*)', left) if mode in ('q', 'o') else None
    if m and (m.group(1) or mode == 'o'):
        mode = 'o'; cur['last'] = m.group(2); cur['opts'][m.group(2)] = [m.group(3).strip()]; continue
    t = left.strip()
    if not t: continue
    if mode == 'q': cur['text'].append(t)
    elif mode == 'o' and not side and len(cur['ids']) == 0: cur['opts'][cur['last']].append(t)
flush()
for q in qs:
    q['text'] = '\n'.join(x for x in q['text'] if x.strip()).strip()
    q['opts'] = {k: ' '.join(v).strip() for k, v in q['opts'].items()}
    q.pop('last', None)
print(len(qs))
from collections import Counter
print(Counter(q['section'] for q in qs))
bad = [ (q['section'], q['qno'], list(q['opts'].keys()), q['ids'].get('q')) for q in qs if len(q['opts']) != 4 or 'q' not in q['ids']]
print('incomplete', len(bad), bad[:20])
json.dump(qs, open('qs_text.json', 'w'), ensure_ascii=False, indent=1)
