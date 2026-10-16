"""Hindi Robot logic test without the model (translation is faked). Usage: python3 test_hindi.py"""
import os, sys, json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tools', 'hindi-robot'))
import mt, hindi
ok = True
def check(n, c):
    global ok; print(('PASS ' if c else 'FAIL ') + n); ok &= bool(c)
p, keep = mt._protect("In a code language, 'DHE' is written as 'HPJ'. A is the father of B. 22 – 11 × 14 = 135, load 10 kN/m² (?)")
check('codes/names/maths/units protected', keep == ["'DHE'", "'HPJ'", 'A', 'B', '22 – 11 × 14 = 135', '10 kN/m²', '(?)'])
check('restore puts originals back', mt._restore(p, keep).count("'DHE'") == 1)
check('lost placeholder -> None', mt._restore('कुछ नहीं', keep) is None)
check('numbers / codes not translated', not mt.needs_translation('9.8 m/s²') and not mt.needs_translation('JRL') and mt.needs_translation('Planning Commission'))
# fake model: prefix lines with Devanagari
mt._load = lambda: (_ for _ in ()).throw(AssertionError('model must not load'))
mt.translate = lambda texts: ['हिंदी ' + t for t in texts]
rows = [{'id': 'Q1', 'subject': 'general-awareness', 'question_en': 'Who was first?', 'question_hi': None,
         'options': [{'letter': 'A', 'en': 'Nehru Ji', 'hi': 'Nehru Ji'}, {'letter': 'B', 'en': '1952', 'hi': '1952'}, {'letter': 'C', 'en': 'Patel', 'hi': 'पटेल'}, {'letter': 'D', 'en': 'Bose', 'hi': ''}],
         'content_hash': 'v1-a', 'source_ref': 'SSC JE 2023'},
        {'id': 'Q2', 'subject': 'civil-engineering', 'question_en': 'Bearing capacity is:', 'question_hi': None,
         'options': [{'letter': L, 'en': 'Strength', 'hi': 'Strength'} for L in 'ABCD'], 'content_hash': 'v1-b', 'source_ref': None}]
calls = []
hindi.api = lambda m, path, b=None, prefer=None: rows if m == 'GET' else calls.append((path, b))
hindi.KEY = 'test'; hindi.main([])
b1, b2 = calls[0][1], calls[1][1]
check('question Hindi set', b1['question_hi'] == 'हिंदी Who was first?')
check('existing option Hindi kept', b1['options'][2]['hi'] == 'पटेल')
check('empty / copied option Hindi filled', b1['options'][0]['hi'].startswith('हिंदी') and b1['options'][3]['hi'].startswith('हिंदी'))
check('engineering options stay English', all(o['hi'] == 'Strength' for o in b2['options']))
check('hash changed + MT mark', b1['content_hash'].startswith('v1h-') and b1['source_ref'].endswith('(IndicTrans2)'))
check('PATCH only when Hindi still empty', 'question_hi.is.null' in calls[0][0])
print('PASS all' if ok else 'FAIL some'); sys.exit(0 if ok else 1)
