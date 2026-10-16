import re
RULES = [
 ('Analogy', r'word-pair|pair of words|शब्द-युग्'),
 ('Series', r'series|come next'),
 ('Alphabet & Word Order', r'meaningful|logical order|dictionary|according to their|letters will remain|how many letters|शब्दकोश'),
 ('Blood Relation', r"means ['‘]?A is the|mother|father|brother|sister|daughter|husband|wife|grandson|uncle|माता|पिता|भाई|बहन"),
 ('Coding-Decoding', r'code language|coded as|कूट भाषा'),
 ('Syllogism', r'statements?|conclusions?|कथन|निष्कर्ष'),
 ('Analogy', r'is related to|are related to|related in the same way|related to each other|word-pair|pair of words|number-pairs|odd one|does not belong|similar relationship|share the same relationship|युग्म|संबंध'),
 ('Direction Sense', r'\bkm\b|towards the|direction|metres|to the (west|east|north|south) of|दिशा'),
 ('Seating Arrangement & Puzzle', r'facing|sitting|seated|born|different age|weights|heights|floor|live in|younger|older|taller|shorter|heavier|ranks?|from the (left|right)|in a row|puzzle|bus stops|days of'),
 ('Mathematical Operations', r'means|stands for|interchang|mathematical|signs|equation|balance|[×÷]'),
]
def rclass(stem):
    for n, p in RULES:
        if re.search(p, stem, re.I): return n
    return '??'
