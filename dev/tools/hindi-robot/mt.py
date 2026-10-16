"""English -> Hindi machine translation with IndicTrans2 (rotary, MIT, ungated copy by an IndicTrans2 author).
Keeps numbers, formulas and very short option values (e.g. '25th', 'NW', '9.8 m/s²') as they are."""
import os, re, warnings
warnings.filterwarnings('ignore')
MODEL = os.environ.get('MT_MODEL', 'prajdabre/rotary-indictrans2-en-indic-1B')
REV = os.environ.get('MT_REV', 'c44b2b145b4b1b3f324164c5a3bb4cefaf647b07' if MODEL.endswith('-1B') else None)  # pinned: remote code reviewed
_m = None


def _load():
    global _m
    if _m is None:
        import torch
        from IndicTransToolkit.processor import IndicProcessor
        from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
        torch.set_num_threads(os.cpu_count() or 2)
        tok = AutoTokenizer.from_pretrained(MODEL, revision=REV, trust_remote_code=True)
        model = AutoModelForSeq2SeqLM.from_pretrained(MODEL, revision=REV, trust_remote_code=True).eval()
        _m = (torch, IndicProcessor(inference=True), tok, model)
    return _m


def needs_translation(s):
    """Only real English words are translated; numbers, symbols, letter codes and formulas stay."""
    s = (s or '').strip()
    if not s or re.search('[ऀ-ॿ]', s): return False
    words = re.findall(r'[A-Za-z]{3,}', s)
    return len(words) >= 1 and not re.fullmatch(r'[A-Z]{1,6}(\s*[,:]\s*[A-Z]{1,6})*', s)


_KEEPA = r'(?:is|and|or|was|has|had|stands|means|can|will|sits|sat|lives|are|were|ranks|gets|got|scored|faces|facing|of|to|in|on|at|from|who|whose|said)'
_UNIT = r'(?:kN|MN|N|mm|cm|km|m|kg|g|mg|s|ms|min|hr|h|V|kV|mV|A|mA|kA|Ω|kΩ|W|kW|MW|kWh|VA|kVA|MVA|Hz|kHz|rpm|°C|°F|K|Pa|kPa|MPa|GPa|bar|J|kJ|cal|L|ml|m/s|km/h|%)'
_PROT = re.compile(r"""(?x)
   _{2,}                                                 # fill-in-the-blank ______
 | \(\?\)                                                # the question mark placeholder (?)
 | \d+(?:\.\d+)?\s*""" + _UNIT + r"""(?:/""" + _UNIT + r""")?[²³]?(?![A-Za-z])   # 10 kN/m², 4 m, 220 V
 |   [‘'"“][^‘’'"“”\n]{1,40}[’'"”]                      # quoted codes / words: 'DHE', "FMG"
 | (?<![A-Za-z])(?:[A-Z]{2,}[a-z]?|[A-Z]\d+|\d+[A-Z]+)(?![A-Za-z])   # codes, acronyms: HPJ, RCC, SI, P1, 3D
 | (?<![A-Za-z])[B-HJ-Z](?![A-Za-z])                    # single letters for persons/points: B, P, Q
 | (?<![A-Za-z])A(?=\s+""" + _KEEPA + r"""\b|[,.;:?)]|\s*$)   # 'A' as a name ("A is the father of B")
 | [\d(][\d\s+\-–−×÷=*/().:,?√^%]{3,}[\d)?]             # arithmetic: 22 – 11 × 14 + 24 ÷ 8 = 135
 | \S*[\d][\S]*/\S+|\S+[²³⁻₂₃]\S*                       # units/formulas: m/s², kN/m², CO₂
""")


def _protect(line):
    keep = []
    def sub(m):
        keep.append(m.group(0)); return f' <ID{90 + len(keep)}> '
    return re.sub(r'\s+', ' ', _PROT.sub(sub, line)).strip(), keep


def _restore(h, keep):
    for i, k in enumerate(keep):
        tag = f'<ID{91 + i}>'
        if tag not in h: return None          # placeholder lost -> unsafe, caller keeps English
        h = h.replace(tag, k)
    h = re.sub(r'ः\s*$', ':', h)                 # model writes visarga for a trailing colon
    return re.sub(r'\s+([,.?!:;।])', r'\1', re.sub(r'[ \t]+', ' ', h)).strip()


def translate(texts, batch=16, beams=4):
    """list[str] -> list[str] (same order). Each line is translated on its own; codes, names, maths and
    units are protected. A line whose protection fails stays English. Untranslatable items come back unchanged."""
    lines, owner = [], []
    for i, t in enumerate(texts):
        for j, ln in enumerate((t or '').split('\n')):
            lines.append(ln); owner.append((i, j))
    res = list(lines)
    todo = [k for k, ln in enumerate(lines) if needs_translation(ln)]
    if todo:
        torch, ip, tok, model = _load()
        prot = {k: _protect(lines[k]) for k in todo}
        todo = [k for k in todo if needs_translation(re.sub(r'<ID\d+>', '', prot[k][0]))]
        todo.sort(key=lambda k: len(lines[k]))
        for b in range(0, len(todo), batch):
            idx = todo[b:b + batch]
            pre = ip.preprocess_batch([prot[k][0] for k in idx], src_lang='eng_Latn', tgt_lang='hin_Deva')
            enc = tok(pre, padding='longest', truncation=True, max_length=512, return_tensors='pt')
            with torch.inference_mode():
                gen = model.generate(**enc, num_beams=beams, max_new_tokens=512, early_stopping=True)
            dec = ip.postprocess_batch(tok.batch_decode(gen, skip_special_tokens=True, clean_up_tokenization_spaces=True), lang='hin_Deva')
            for k, h in zip(idx, dec):
                r = _restore(h.strip(), prot[k][1])
                if r: res[k] = r
    out = [[] for _ in texts]
    for (i, j), r in zip(owner, res): out[i].append(r)
    return ['\n'.join(x) for x in out]
