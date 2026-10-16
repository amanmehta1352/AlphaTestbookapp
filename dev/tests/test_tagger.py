"""Tag Robot logic test with fake server rows. Usage: python3 test_tagger.py"""
import os, sys, random
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tools', 'tag-robot'))
import tagger
ok = True
def check(n, c):
    global ok; print(('PASS ' if c else 'FAIL ') + n); ok &= bool(c)
random.seed(1)
W = {'ga-polity': 'constitution article parliament president lok sabha fundamental rights amendment'.split(),
     'ga-geography': 'river mountain dam plateau state located soil monsoon national park'.split(),
     'ga-history': 'mughal emperor battle dynasty revolt gandhi movement ruler founded'.split()}
rows = []
for t, ws in W.items():
    for i in range(30):
        rows.append({'id': f'{t}-{i}', 'topic_id': f'general-awareness-{t}-class-test', 'subject': 'general-awareness', 'chapter': t.upper(), 'topic': t,
                     'question_en': 'Which ' + ' '.join(random.sample(ws, 4)) + '?', 'options': [{'en': random.choice(ws)} for _ in range(4)], 'content_hash': 'h', 'is_active': True})
mixed = [{'id': 'm1', 'question_en': 'Which article of the constitution gives fundamental rights to parliament?'},
         {'id': 'm2', 'question_en': 'On which river is this dam located in the state?'},
         {'id': 'm3', 'question_en': 'zzz qqq xxx'}]
for m in mixed: rows.append({**m, 'topic_id': 'general-awareness-mixed-untagged-class-test', 'subject': 'general-awareness', 'chapter': 'Mixed (Untagged)', 'topic': 'Mixed (Untagged)', 'options': [], 'content_hash': 'h', 'is_active': True})
calls = []
tagger.api = lambda m, p, b=None, prefer=None: (rows if m == 'GET' and 'offset=0' in p else [] if m == 'GET' else calls.append((p, b)))
tagger.KEY = 't'; tagger.main([])
moved = {p.split('id=eq.')[1].split('&')[0]: b for p, b in calls}
check('polity question moved to polity', moved.get('m1', {}).get('topic_id') == 'general-awareness-ga-polity-class-test')
check('geography question moved', moved.get('m2', {}).get('chapter') == 'GA-GEOGRAPHY')
check('nonsense stays Mixed', 'm3' not in moved)
check('guarded PATCH + new hash', all('mixed-untagged' in p for p, _ in calls) and all(b['content_hash'].startswith('v1t-') for _, b in calls))
check('text/answer untouched', all(set(b) == {'topic_id', 'chapter', 'topic', 'content_hash'} for _, b in calls))
print('PASS all' if ok else 'FAIL some'); sys.exit(0 if ok else 1)
