"""One-time: split the single-file app into a source tree (src/) + manifest.json.
build.py joins it back. Pieces are stored verbatim, so the build is byte-identical."""
import json, os, re, sys
src_html = sys.argv[1]
lines = open(src_html, encoding='utf-8').read().split('\n')
parts = []
def emit(kind, name, chunk, **kw):
    path = f'src/{kind}/{name}'
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, 'w', encoding='utf-8').write('\n'.join(chunk))
    parts.append({'file': path, **kw})
# locate script
s_open = lines.index('<script>'); s_close = max(i for i, l in enumerate(lines) if l == '</script>')
head_end = lines.index('</head>')
# ---- head: raw bits and style blocks
i, raw, n = 0, [], 0
def flush_raw(tag):
    global raw
    if raw: emit('html', f'{tag}.html', raw); raw = []
style_no = 0
while i <= head_end:
    l = lines[i]
    m = re.match(r'^<style(?: id="([^"]+)")?>$', l)
    if m:
        flush_raw(f'head-{style_no:02d}')
        j = lines.index('</style>', i)
        style_no += 1
        name = f'{style_no:02d}-{m.group(1) or "base"}.css'
        emit('css', name, lines[i + 1:j], wrap=[l, '</style>'])
        i = j + 1; continue
    raw.append(l); i += 1
flush_raw(f'head-{style_no:02d}')
emit('html', 'body.html', lines[head_end + 1:s_open])
# ---- script: split at section headers
heads = [k for k in range(s_open + 1, s_close) if lines[k].startswith('/* ===') and k + 1 < s_close and lines[k + 1].startswith(' ')]
names = ['globals', 'taxonomy-core', 'workspace', 'builtin-dataset', 'storage', 'sync-index', 'competitive-context', 'routing', 'learning-data', 'revision', 'dashboard',
         'display-a11y-subjects-qb', 'import-engine', 'data-safety', 'server-admin', 'pwa', 'cloud-account', 'cbt-subjects-results', 'smart-builder', 'competitive-hierarchy',
         'pages', 'study-engines', 'search', 'import-ui', 'modals-boot']
# headers that are sub-sections of the previous file
skip = {'V2.3.7 — LEARNING HISTORY (additive)'}
cuts = [k for k in heads if lines[k + 1].strip() not in skip]
assert len(cuts) == len(names), (len(cuts), [lines[k + 1].strip() for k in cuts])
bounds = [s_open + 1] + cuts + [s_close]
for idx in range(len(bounds) - 1):
    a, b = bounds[idx], bounds[idx + 1]
    nm = 'boot-navigate' if idx == 0 else names[idx - 1]
    emit('js', f'{idx:02d}-{nm}.js', lines[a:b], script=True)
emit('html', 'tail.html', lines[s_close + 1:])
json.dump({'note': 'Build order. Each part is joined with newlines; css parts get their <style> wrapper; js parts go inside one <script>.', 'parts': parts}, open('manifest.json', 'w'), indent=1, ensure_ascii=False)
print(len(parts), 'parts')
