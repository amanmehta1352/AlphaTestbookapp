"""Join src/ (manifest.json order) into one app file: python3 build.py out.html [version] [--studio]
--studio builds the Admin Studio page (admin/index.html): same code, boots studioBoot() instead of the app."""
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
if len(sys.argv) > 2 and not sys.argv[2].startswith('--'):
    html = re.sub(r'(<meta name="app-version" content=")[^"]*(")', r'\g<1>' + sys.argv[2] + r'\2', html)
if '--studio' in sys.argv:
    html = html.replace('<head>', '<head>\n<script>window.MTB_STUDIO = true;</script>\n<meta name="robots" content="noindex">', 1)
    html = html.replace('<title>TestBook</title>', '<title>TestBook Admin Studio</title>', 1)
    html = html.replace('<link rel="manifest" href="manifest.webmanifest">', '', 1)
    html = re.sub(r'href="(icon-192\.png|apple-touch-icon\.png)"', r'href="../\1"', html)
open(sys.argv[1], 'w', encoding='utf-8').write(html)
print('built', sys.argv[1], len(html), 'chars')
