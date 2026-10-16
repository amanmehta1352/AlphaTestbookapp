"""Key-check Robot test: the checks (A structure, B conflict, C skew, D Gemini second opinion) on in-memory rows.
No database, no network. Usage: python3 test_keycheck.py"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'tools', 'key-check-robot'))
import keycheck as kc

ok = True
def check(name, cond):
    global ok; print(('PASS ' if cond else 'FAIL ') + name); ok &= bool(cond)

def row(i, q, texts, ans, ref=None):
    return {'id': i, 'question_en': q, 'question_hi': None, 'answer': ans, 'source_ref': ref,
            'options': [{'letter': l, 'en': t} for l, t in zip('ABCD', texts)]}

def codes(flags, i): return sorted(f['code'] for f in flags if f['id'] == i)

good = row('g1', 'What is the unit of force?', ['Newton', 'Joule', 'Watt', 'Pascal'], 'A')
flags, warns = kc.audit([good])
check('good question has no flag', flags == [] and warns == [])
check('answer missing -> A1', codes(kc.audit([row('x', 'Q one?', ['a', 'b', 'c', 'd'], None)])[0], 'x') == ['A1'])
check('answer outside A-D -> A1', codes(kc.audit([row('x', 'Q one?', ['a', 'b', 'c', 'd'], 'E')])[0], 'x') == ['A1'])
check('empty option -> A1', codes(kc.audit([row('x', 'Q one?', ['a', 'b', '', 'd'], 'A')])[0], 'x') == ['A1'])
check('3 options -> A1', codes(kc.audit([{'id': 'x', 'question_en': 'Q?', 'answer': 'A', 'options': [{'letter': 'A', 'en': 'a'}] * 3}])[0], 'x') == ['A1'])
check('two same options -> A2', codes(kc.audit([row('x', 'Q one?', ['Same', 'same.', 'c', 'd'], 'C')])[0], 'x') == ['A2'])

# symbols and Hindi matras are real differences (Mathematical Operations / Hindi options must NOT be flagged)
check('math-sign options are different', kc.audit([row('m1', 'Which sign replaces * in 6 * 2 = 8?', ['+', '\u2212', '\u00d7', '\u00f7'], 'A')])[0] == [])
check('same digits, different signs are different', kc.audit([row('m2', 'Pick the true statement', ['6 + 2 = 8', '6 \u00d7 2 = 8', '6 \u2212 2 = 8', '6 \u00f7 2 = 8'], 'A')])[0] == [])
check('Hindi matra options are different', kc.audit([row('h1', 'सही रूप चुनिए', ['का', 'की', 'के', 'को'], 'B')])[0] == [])
check('ligature/case/space/end-dot are the same option', codes(kc.audit([row('x', 'Q one?', ['Office', 'Of\ufb01ce.', 'c', 'd'], 'C')])[0], 'x') == ['A2'])
check('questions differing only by a sign are NOT a conflict', kc.audit([row('s1', 'Value of 6 + 2?', ['8', '4', '12', '3'], 'A'), row('s2', 'Value of 6 \u2212 2?', ['8', '4', '12', '3'], 'B')])[0] == [])

check('cut-off question text ("A") -> A3', codes(kc.audit([row('c1', 'A', ['10%', '20%', '30%', '40%'], 'B')])[0], 'c1') == ['A3'])
g1 = row('n1', 'Which of the following is NOT a noble gas?', ['Argon', 'Boron', 'Krypton', 'Neon'], 'B')
g2 = row('n2', 'Which of the following is NOT a noble gas?', ['Argon', 'Helium', 'Hydrogen', 'Xenon'], 'C')
check('same stem but different options is NOT a conflict', kc.audit([g1, g2])[0] == [])

# same question in two papers: options shuffled but SAME answer text -> fine; different answer text -> B
p1 = row('p1', 'Unit of power is?', ['Watt', 'Joule', 'Newton', 'Pascal'], 'A')
p2 = row('p2', 'Unit of power is?', ['Joule', 'Pascal', 'Watt', 'Newton'], 'C')
check('shuffled options, same answer text -> no B', kc.audit([p1, p2])[0] == [])
p3 = row('p3', 'Unit of power is?', ['Watt', 'Joule', 'Newton', 'Pascal'], 'B')
fl = kc.audit([p1, p3])[0]
check('different answer text -> B on both', codes(fl, 'p1') == ['B'] and codes(fl, 'p3') == ['B'])

# skew: 20 questions of one paper, 12 with answer B (60 %)
rows = [row(f's{i}', f'Skew question number {i}?', ['a1', 'b2', 'c3', 'd4'], 'B' if i < 12 else 'ACD'[i % 3], 'Paper X') for i in range(20)]
fl, wn = kc.audit(rows)
check('skewed paper -> one C warning', len(wn) == 1 and wn[0]['code'] == 'C' and 'B: 12/20' in wn[0]['why'])
fair = [row(f'f{i}', f'Fair question number {i}?', ['a1', 'b2', 'c3', 'd4'], 'ABCD'[i % 4], 'Paper Y') for i in range(20)]
check('balanced paper -> no warning', kc.audit(fair)[1] == [])
check('under 20 questions -> no skew warning', kc.audit(rows[:10])[1] == [])

# D: Gemini second opinion (mocked)
qs = [row('d1', 'Q d1?', ['a', 'b', 'c', 'd'], 'A'), row('d2', 'Q d2?', ['a', 'b', 'c', 'd'], 'B'),
      row('d3', 'Q d3?', ['a', 'b', 'c', 'd'], 'C'), row('d4', 'Q d4?', ['a', 'b', 'c', 'd'], 'D')]
answers = {'d1': ('A', True), 'd2': ('C', True), 'd3': ('D', False), 'd4': (None, False)}
f, n, quota = kc.second_opinion(qs, ask=lambda r: answers[r['id']], pause=0)
check('Gemini flags only confident disagreement', [x['id'] for x in f] == ['d2'] and f[0]['code'] == 'D')
check('checked 4, no quota stop', n == 4 and quota is False)
def boom(r):
    if r['id'] == 'd3': raise RuntimeError('quota')
    return ('A', True)
f, n, quota = kc.second_opinion(qs, ask=boom, pause=0)
check('free quota hit -> stops, reports it', quota is True and n == 2)
leak = row('leak', 'Which planet is largest?', ['Mars', 'Jupiter', 'Venus', 'Earth'], 'B'); leak['source_ref'] = 'SECRET-PAPER-REF'
leak['id'] = 'SECRET-ID'
pr = kc.gemini_prompt(leak)
check('prompt has question and options only (no key, id or source)', 'Which planet' in pr and 'B) Jupiter' in pr and 'SECRET' not in pr and 'key' not in pr.lower().split('reply as json')[0])

# the tool must never write: only GET requests exist in the file
src = open(os.path.join(HERE, '..', 'tools', 'key-check-robot', 'keycheck.py'), encoding='utf-8').read()
check('server access is read-only (no POST/PATCH/DELETE to Supabase)', not any(m in src for m in ("'PATCH'", "'DELETE'", "/rest/v1/questions', 'POST'")))
check('secrets never printed', 'print(KEY' not in src and 'print(GEMINI_KEY' not in src and 'say(KEY' not in src)
print('PASS all' if ok else 'FAIL some'); sys.exit(0 if ok else 1)
