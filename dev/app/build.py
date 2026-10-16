"""Join src/ (manifest.json order) into one app file: python3 build.py out.html [version]"""
import json, sys, re
m = json.load(open('manifest.json', encoding='utf-8'))
out, script_open = [], False
for p in m['parts']:
    body = open(p['file'], encoding='utf-8').read()
    if p.get('script') and not script_open: out.append('<script>'); script_open = True
    if not p.get('script') and script_open: out.append('</script>'); script_open = False
    if 'wrap' in p: out += [p['wrap'][0], body, p['wrap'][1]]
    else: out.append(body)
html = '\n'.join(out)
if len(sys.argv) > 2:
    html = re.sub(r'(<meta name="app-version" content=")[^"]*(")', r'\g<1>' + sys.argv[2] + r'\2', html)
open(sys.argv[1], 'w', encoding='utf-8').write(html)
print('built', sys.argv[1], len(html), 'chars')
