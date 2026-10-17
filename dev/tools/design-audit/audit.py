"""🎨 Design Audit Robot + 🔥 Smoke Test — real browser checks of the app and the Control Room (Playwright, free).
  python3 dev/tools/design-audit/audit.py --target live|build --out design-audit.json [--shots DIR]
  python3 dev/tools/design-audit/audit.py --smoke --out smoke.json      (after a deploy: is the new version really live?)

Design audit, per screen × size (phone 360, phone 412, tablet 768, desktop 1280), light + dark:
  sideways scroll (overflow) · tap targets < 40 px · text contrast < 4.5 (sampled) · Hindi font rendering ·
  overlapping buttons · page errors.  Screenshots go to --shots (uploaded as artifact).
The robot only REPORTS. It never changes design; repairs go through Selective Restore / Claude with approval.
"""
import json, os, re, sys, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
SITE = os.environ.get('SITE_URL', 'https://amanmehta1352.github.io/AlphaTestbookapp/')
ROUTES = ['home', 'subjects', 'test_hub', 'revision_hub', 'exam_hub', 'native_builder', 'me', 'taxonomy_explorer', 'mastery']
SIZES = [(360, 780, 'phone-360'), (412, 900, 'phone-412'), (768, 1024, 'tablet'), (1280, 860, 'desktop')]
CHECK_JS = r"""() => {
 const W = innerWidth, out = {overflow: document.documentElement.scrollWidth > W + 1, small: [], lowc: [], overlap: 0, hindi: null};
 const vis = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.top < innerHeight * 3; };
 const taps = [...document.querySelectorAll('button, a[href], [role=button], input, select')].filter(vis);
 taps.forEach(e => { const r = e.getBoundingClientRect(); if (r.height < 40 && r.width < 40) out.small.push((e.className || e.tagName) + ':' + (e.textContent || '').trim().slice(0, 18)); });
 const rgb = s => (s.match(/[\d.]+/g) || []).map(Number);
 const lum = c => { const a = c.slice(0, 3).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * a[0] + .7152 * a[1] + .0722 * a[2]; };
 const bgOf = el => { let n = el; while (n) { const v = rgb(getComputedStyle(n).backgroundColor); if (v.length < 4 || v[3] > .9) return v; n = n.parentElement; } return [255, 255, 255]; };
 const texts = [...document.querySelectorAll('h1,h2,h3,p,small,span,b,strong,button,a,li,td')].filter(e => vis(e) && e.childElementCount === 0 && (e.textContent || '').trim().length > 1).slice(0, 220);
 texts.forEach(e => { const fg = rgb(getComputedStyle(e).color); if ((fg[3] ?? 1) < .5) return; const L1 = lum(fg), L2 = lum(bgOf(e)); const cr = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05);
   const big = parseFloat(getComputedStyle(e).fontSize) >= 18.5; if (cr < (big ? 3 : 4.5)) out.lowc.push(e.textContent.trim().slice(0, 24) + ' ' + cr.toFixed(1)); });
 const rects = taps.slice(0, 120).map(e => e.getBoundingClientRect());
 for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) { const a = rects[i], b = rects[j];
   const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
   if (ix > 6 && iy > 6 && !(a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom) && !(b.left >= a.left && b.right <= a.right && b.top >= a.top && b.bottom <= a.bottom)) out.overlap++; }
 const hasHi = /[ऀ-ॿ]/.test(document.body.innerText);
 if (hasHi) out.hindi = document.fonts ? document.fonts.check('16px "Noto Sans Devanagari"') || document.fonts.check('16px "Noto Devanagari"') || 'system-font' : 'unknown';
 out.small = out.small.slice(0, 8); out.lowc = out.lowc.slice(0, 8); return out; }"""


def app_url(target):
    return SITE if target == 'live' else 'file://' + os.path.join(ROOT, 'index.html')


def audit(target, shots):
    res = {'target': target, 'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'screens': [], 'summary': {}}
    with sync_playwright() as p:
        b = p.chromium.launch()
        for dark in (False, True):
            for w, h, name in SIZES:
                c = b.new_context(viewport={'width': w, 'height': h}, color_scheme='dark' if dark else 'light', service_workers='block')
                pg = c.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)[:160])); pg.on('dialog', lambda d: d.dismiss())
                pg.goto(app_url(target)); pg.wait_for_selector('.sj-dash, #mainView', timeout=30000); pg.wait_for_timeout(1500)
                if dark: pg.evaluate("document.body.classList.add('dark')")
                for r in ROUTES:
                    try:
                        pg.evaluate(f"navigate('{r}')"); pg.wait_for_timeout(350)
                        x = pg.evaluate(CHECK_JS)
                    except Exception as e:
                        x = {'error': str(e)[:160]}
                    x.update(route=r, size=name, theme='dark' if dark else 'light', errors=list(errs)); errs.clear()
                    res['screens'].append(x)
                    if shots and name in ('phone-360', 'desktop') and not dark:
                        os.makedirs(shots, exist_ok=True); pg.screenshot(path=os.path.join(shots, f'{r}-{name}.png'))
                c.close()
        # Control Room (public view)
        c = b.new_context(viewport={'width': 360, 'height': 800}); pg = c.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)[:160]))
        cr = (SITE + 'control/') if target == 'live' else 'file://' + os.path.join(ROOT, 'control', 'index.html')
        try:
            pg.goto(cr); pg.wait_for_selector('.hero, .card', timeout=30000); pg.wait_for_timeout(1500)
            x = pg.evaluate(CHECK_JS); x.update(route='control-room', size='phone-360', theme='light', errors=errs); res['screens'].append(x)
        except Exception as e:
            res['screens'].append({'route': 'control-room', 'size': 'phone-360', 'error': str(e)[:160]})
        b.close()
    S = res['screens']
    res['summary'] = {'screens': len(S), 'overflow': [f"{s['route']}@{s['size']}/{s['theme']}" for s in S if s.get('overflow')],
                      'small_taps': sum(len(s.get('small') or []) for s in S), 'low_contrast': sum(len(s.get('lowc') or []) for s in S),
                      'overlap': sum(s.get('overlap') or 0 for s in S), 'page_errors': sorted({e for s in S for e in (s.get('errors') or [])})[:10],
                      'hindi_font': sorted({str(s.get('hindi')) for s in S if s.get('hindi') is not None}), 'broken': [s['route'] for s in S if s.get('error')]}
    sm = res['summary']; sm['ok'] = not sm['overflow'] and not sm['page_errors'] and not sm['broken']
    return res


def smoke(timeout_min=12):
    """After a release: wait until the live site shows the version in the code, then open app, admin and control."""
    src = open(os.path.join(ROOT, 'dev/app/src/html/head-01.html'), encoding='utf-8').read()
    want = re.search(r'name="app-version" content="([^"]+)"', src).group(1)
    res = {'want': want, 'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'checks': []}
    live = ''; t0 = time.time()
    while time.time() - t0 < timeout_min * 60:
        try:
            html = urllib.request.urlopen(urllib.request.Request(SITE + f'?smoke={int(time.time())}', headers={'Cache-Control': 'no-cache'}), timeout=30).read().decode()
            live = (re.search(r'name="app-version" content="([^"]+)"', html) or [None, ''])[1]
            if live == want: break
        except Exception:
            pass
        time.sleep(30)
    res['checks'].append({'name': 'live version = code version', 'ok': live == want, 'detail': f'live {live} · code {want}'})
    with sync_playwright() as p:
        b = p.chromium.launch()
        for name, url, sel in [('app opens', SITE, '.sj-dash'), ('admin studio opens', SITE + 'admin/', 'body'), ('control room opens', SITE + 'control/', '.hero, .card')]:
            c = b.new_context(viewport={'width': 390, 'height': 844}, service_workers='block'); pg = c.new_page(); errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)[:160]))
            try:
                pg.goto(url + f'?smoke={int(time.time())}'); pg.wait_for_selector(sel, timeout=30000); pg.wait_for_timeout(1200)
                if name == 'app opens':
                    pg.evaluate("navigate('subjects')"); pg.wait_for_timeout(300); pg.evaluate("navigate('test_hub')"); pg.wait_for_timeout(300)
                res['checks'].append({'name': name, 'ok': not errs, 'detail': '; '.join(errs)[:300] or 'ठीक'})
            except Exception as e:
                res['checks'].append({'name': name, 'ok': False, 'detail': str(e)[:200]})
            c.close()
        b.close()
    res['ok'] = all(c['ok'] for c in res['checks'])
    return res


def main(a):
    out = a[a.index('--out') + 1] if '--out' in a else 'design-audit.json'
    if '--smoke' in a:
        r = smoke()
        lines = ['## 🔥 Smoke test (deploy के बाद)'] + [f"- {'✅' if c['ok'] else '❌'} {c['name']}: {c['detail']}" for c in r['checks']]
    else:
        target = a[a.index('--target') + 1] if '--target' in a else 'live'
        shots = a[a.index('--shots') + 1] if '--shots' in a else None
        r = audit(target, shots); s = r['summary']
        lines = [f"## 🎨 Design audit ({target}) — {s['screens']} screens", f"- Sideways scroll: {len(s['overflow'])} {s['overflow'][:6]}",
                 f"- छोटे बटन (<40px): {s['small_taps']} · कम contrast: {s['low_contrast']} · overlap: {s['overlap']}",
                 f"- Hindi font: {s['hindi_font']} · Page errors: {len(s['page_errors'])} · टूटे: {s['broken']}"]
    json.dump(r, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('\n'.join(lines))
    if os.environ.get('GITHUB_STEP_SUMMARY'): open(os.environ['GITHUB_STEP_SUMMARY'], 'a').write('\n'.join(lines) + '\n')
    if os.environ.get('OPS_COUNTS'): json.dump({'processed': len(r.get('screens') or r.get('checks') or []), 'changed': 0, 'note': lines[1][:200]}, open(os.environ['OPS_COUNTS'], 'w'), ensure_ascii=False)
    return 0 if r.get('ok', r.get('summary', {}).get('ok', True)) else 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
