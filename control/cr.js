/* =========================================================================
   Master TestBook · Control Room (admin control centre)
   - Public, read-only: status.json + history.json (branch `status`, written by the Health Robot) + live GitHub runs.
   - Admin (same login as the app / Admin Studio, kept in localStorage `mtb_server_session_v1`):
     live Supabase — settings & switches, request queue (Ops Robot runs them), question bank actions,
     publish queue, audit + undo, backups + verify + restore, incidents, client errors.
   Every write is checked again on the server (RLS + ops_* functions). No secret key in this page.
   ========================================================================= */
'use strict';
const CFG = {
  repo: 'amanmehta1352/AlphaTestbookapp',
  raw: 'https://raw.githubusercontent.com/amanmehta1352/AlphaTestbookapp/status/',
  sb: { url: 'https://fzkvwkrbtykucjfdqiin.supabase.co', key: 'sb_publishable_o_P1uxqNhrFmOZDVVvl80A_JYQAAhB3' },
  sessionKey: 'mtb_server_session_v1',
  supabaseDash: 'https://supabase.com/dashboard/project/fzkvwkrbtykucjfdqiin',
};
const GH = `https://github.com/${CFG.repo}`;
const S = { status: null, hist: [], runs: null, route: 'overview', admin: false, email: '', live: {}, err: '',
  q: { text: '', filter: 'all', subject: '', status: '', source: '', sort: 'updated_at.desc', page: 0, rows: [], total: 0, loading: false },
  sel: new Set(), pub: { rows: [], loading: false }, auditFilter: '', lastLoad: 0 };

/* ---------------------------------------------------------------- utils */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = v => (v === null || v === undefined || v === '') ? '—' : (typeof v === 'number' ? v.toLocaleString('en-IN') : v);
const ago = iso => { if (!iso) return '—'; const m = Math.round((Date.now() - new Date(iso)) / 60000); if (isNaN(m)) return '—'; if (m < 0) { const f = -m; return f < 60 ? `${f} मिनट में` : f < 1440 ? `${Math.round(f / 60)} घंटे में` : `${Math.round(f / 1440)} दिन में`; } return m < 1 ? 'अभी' : m < 60 ? `${m} मिनट पहले` : m < 1440 ? `${Math.round(m / 60)} घंटे पहले` : `${Math.round(m / 1440)} दिन पहले`; };
const when = iso => iso ? new Date(iso).toLocaleString('hi-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const bytes = b => b == null ? '—' : b > 1024 ** 3 ? (b / 1024 ** 3).toFixed(2) + ' GB' : b > 1024 ** 2 ? (b / 1024 ** 2).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB';
const pretty = k => String(k || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const ICON = { ok: '🟢', warn: '🟡', bad: '🔴' };
const PILL = { success: ['ok', '✓ ठीक'], failure: ['bad', '✕ fail'], cancelled: ['none', 'रोका'], skipped: ['none', 'छोड़ा'], in_progress: ['run', '⏳ चल रहा'], queued: ['run', '⏳ कतार'] };
const pill = c => { const p = PILL[c] || ['none', c || 'कभी नहीं']; return `<span class="pill ${p[0]}">${esc(p[1])}</span>`; };
function toast(msg, ms = 2600) { const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), ms); }
function sheet(title, html, mount) {
  const sc = document.createElement('div'); sc.className = 'scrim';
  sc.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2>${esc(title)}<button class="tbtn" data-x aria-label="बंद करें">✕</button></h2>${html}</div>`;
  const close = () => sc.remove();
  sc.addEventListener('click', e => { if (e.target === sc || e.target.closest('[data-x]')) close(); });
  document.body.appendChild(sc); if (mount) mount(sc.querySelector('.sheet'), close); return close;
}
function ask(title, text, opts = {}) {
  return new Promise(res => {
    const word = opts.word;
    sheet(title, `<p>${text}</p>${word ? `<div class="field"><label>पक्का करने के लिए लिखें: <b class="mono">${esc(word)}</b></label><input class="input" data-w autocomplete="off"></div>` : ''}
      ${opts.reason ? `<div class="field"><label>कारण (audit में दर्ज होगा)</label><input class="input" data-r placeholder="जैसे: गलत answer key"></div>` : ''}
      <div class="row" style="justify-content:flex-end"><button class="btn" data-no>रद्द करें</button><button class="btn ${opts.danger ? 'danger' : 'pri'}" data-yes ${word ? 'disabled' : ''}>${esc(opts.ok || 'हाँ, करें')}</button></div>`,
      (el, close) => {
        const yes = el.querySelector('[data-yes]'), w = el.querySelector('[data-w]');
        if (w) w.addEventListener('input', () => { yes.disabled = w.value.trim() !== word; });
        el.querySelector('[data-no]').onclick = () => { close(); res(false); };
        yes.onclick = () => { const r = el.querySelector('[data-r]'); close(); res(opts.reason ? { reason: (r && r.value.trim()) || '' } : true); };
      });
  });
}

/* ---------------------------------------------------------------- auth (shared with app / Admin Studio) */
const Auth = {
  get() { try { const s = JSON.parse(localStorage.getItem(CFG.sessionKey) || 'null'); return s && s.refresh_token ? s : null; } catch (_) { return null; } },
  set(d, email) { const s = { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + (Number(d.expires_in) || 3600) * 1000, email: d.user?.email || email || '', user_id: d.user?.id || '' }; try { localStorage.setItem(CFG.sessionKey, JSON.stringify(s)); } catch (_) {} return s; },
  async fresh() {
    let s = this.get(); if (!s) return null;
    if (Date.now() < Number(s.expires_at) - 60000) return s;
    const r = await fetch(CFG.sb.url + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: CFG.sb.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token }) });
    if (!r.ok) { const again = this.get(); if (again && again.expires_at > s.expires_at) return again; return null; }
    return this.set(await r.json(), s.email);
  },
  async login(email, password) {
    const r = await fetch(CFG.sb.url + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: CFG.sb.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(/invalid/i.test(d.error_description || d.msg || '') ? 'Email या password गलत है' : (d.error_description || d.msg || 'Login नहीं हुआ'));
    return this.set(d, email);
  },
  logout() { try { localStorage.removeItem(CFG.sessionKey); } catch (_) {} },
};
async function api(path, { method = 'GET', body, prefer, count } = {}) {
  const s = await Auth.fresh(); if (!s) throw new Error('पहले login करें');
  const h = { apikey: CFG.sb.key, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' };
  if (prefer || count) h.Prefer = [prefer, count ? 'count=exact' : ''].filter(Boolean).join(',');
  const r = await fetch(CFG.sb.url + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let d = null; try { d = t ? JSON.parse(t) : null; } catch (_) { d = t; }
  if (!r.ok) { const m = (d && (d.message || d.hint)) || ('HTTP ' + r.status); throw new Error(/admin only|42501|row-level/i.test(m) ? 'यह काम सिर्फ़ admin कर सकता है' : m); }
  if (count) { const cr = r.headers.get('content-range') || ''; return { rows: d || [], total: Number((cr.split('/')[1]) || 0) }; }
  return d;
}
const rpc = (fn, args = {}) => api('/rest/v1/rpc/' + fn, { method: 'POST', body: args });
async function checkAdmin() {
  const s = Auth.get(); S.email = s?.email || '';
  if (!s) { S.admin = false; return; }
  try { S.admin = (await rpc('is_admin')) === true; } catch (_) { S.admin = false; }
}

/* ---------------------------------------------------------------- data */
async function loadPublic(force) {
  const t = force ? '?t=' + Date.now() : '?t=' + Math.floor(Date.now() / 60000);
  const [st, h, runs] = await Promise.all([
    fetch(CFG.raw + 'status.json' + t).then(r => { if (!r.ok) throw new Error('status ' + r.status); return r.json(); }),
    fetch(CFG.raw + 'history.json' + t).then(r => r.ok ? r.json() : []).catch(() => []),
    fetch(`https://api.github.com/repos/${CFG.repo}/actions/runs?per_page=50`).then(r => r.ok ? r.json() : null).then(d => d && d.workflow_runs).catch(() => null)]);
  S.status = st; S.hist = Array.isArray(h) ? h : []; S.runs = runs; S.lastLoad = Date.now();
}
async function loadLive() {
  if (!S.admin) return;
  const jobs = {
    settings: () => api('/rest/v1/ops_settings?select=*&order=key'),
    requests: () => api('/rest/v1/ops_requests?select=*&order=id.desc&limit=30'),
    db: () => rpc('ops_db_stats'),
    backups: () => rpc('ops_backup_list'),
    incidents: () => api('/rest/v1/ops_incidents?select=*&order=id.desc&limit=50'),
    errors: () => api('/rest/v1/ops_client_errors?select=at,app_version,page,message,stack&order=id.desc&limit=40'),
    runs: () => api('/rest/v1/ops_runs?select=*&order=id.desc&limit=80'),
  };
  const out = await Promise.all(Object.entries(jobs).map(([k, f]) => f().then(v => [k, v]).catch(e => [k, { error: e.message }])));
  out.forEach(([k, v]) => { S.live[k] = v; });
}
const settingsMap = () => { const m = {}; const l = S.live.settings; if (Array.isArray(l)) l.forEach(r => { m[r.key] = r.value; }); else Object.assign(m, S.status?.supabase?.settings || {}); return m; };
const settingRow = k => (Array.isArray(S.live.settings) ? S.live.settings.find(r => r.key === k) : null) || { key: k, value: settingsMap()[k], ...(S.status?.supabase?.settings_meta?.[k] || {}) };
async function setSetting(k, v, msg) {
  await api('/rest/v1/ops_settings?key=eq.' + encodeURIComponent(k), { method: 'PATCH', body: { value: v }, prefer: 'return=minimal' });
  const r = Array.isArray(S.live.settings) && S.live.settings.find(x => x.key === k); if (r) { r.value = v; r.updated_at = new Date().toISOString(); r.updated_by = S.email; }
  toast(msg || 'सेव हो गया'); render();
}
async function request(action, target = '', params = {}, msg) {
  await api('/rest/v1/ops_requests', { method: 'POST', body: [{ action, target, params }], prefer: 'return=minimal' });
  toast(msg || 'कतार में डाला — Ops Robot 10 मिनट के अंदर करेगा'); S.live.requests = await api('/rest/v1/ops_requests?select=*&order=id.desc&limit=30').catch(() => S.live.requests); render();
}
const needAdmin = () => { if (!S.admin) { openLogin(); return true; } return false; };

/* ---------------------------------------------------------------- charts */
function lineChart(series, labels, h = 150) {
  const W = 600, H = h, P = 26; const all = series.flatMap(s => s.values).filter(v => typeof v === 'number'); if (!all.length) return '<div class="empty">अभी data कम है</div>';
  const max = Math.max(1, ...all), xs = i => P + i * (W - P * 2) / Math.max(1, labels.length - 1), ys = v => H - P - (v / max) * (H - P * 2);
  const grid = [0, .5, 1].map(f => `<line x1="${P}" x2="${W - P}" y1="${ys(max * f)}" y2="${ys(max * f)}" stroke="var(--border)" stroke-dasharray="3 4"/><text x="2" y="${ys(max * f) + 4}" font-size="10" fill="var(--faint)">${Math.round(max * f)}</text>`).join('');
  const lines = series.map(s => { const pts = s.values.map((v, i) => typeof v === 'number' ? `${xs(i)},${ys(v)}` : null).filter(Boolean);
    return `<polyline fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" points="${pts.join(' ')}"/>` + s.values.map((v, i) => typeof v === 'number' ? `<circle cx="${xs(i)}" cy="${ys(v)}" r="3" fill="${s.color}"><title>${esc(labels[i])}: ${v}</title></circle>` : '').join(''); }).join('');
  const lab = labels.map((l, i) => (i % Math.ceil(labels.length / 7) === 0 || i === labels.length - 1) ? `<text x="${xs(i)}" y="${H - 6}" font-size="10" text-anchor="middle" fill="var(--faint)">${esc(l)}</text>` : '').join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(series.map(s => s.name).join(', '))}">${grid}${lines}${lab}</svg><div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
}
function bars(entries, color) {
  const max = Math.max(1, ...entries.map(e => e[1] || 0));
  return `<div class="bars">${entries.map(([k, v, extra]) => `<div class="bar" style="--k:${color || 'var(--primary)'}"><span title="${esc(k)}">${esc(k)}</span><span class="track"><i style="width:${Math.max(2, (v || 0) / max * 100)}%"></i></span><em>${n(v)}${extra ? esc(extra) : ''}</em></div>`).join('')}</div>`;
}
function gauge(label, used, total, unit) {
  const pct = total ? Math.min(100, used / total * 100) : 0;
  return `<div class="gauge"><div class="lbl"><span>${esc(label)}</span><b>${unit === 'bytes' ? bytes(used) + ' / ' + bytes(total) : n(used) + ' / ' + n(total)} · ${pct.toFixed(1)}%</b></div><div class="track"><i class="${pct > 80 ? 'warn' : ''}" style="width:${Math.max(1, pct)}%"></i></div></div>`;
}
const kpi = (ic, v, label, k = 'k1', cls = '') => `<div class="kpi ${k} ${cls}"><span class="ki" aria-hidden="true">${ic}</span><b>${n(v)}</b><small>${esc(label)}</small></div>`;

/* ---------------------------------------------------------------- sections */
const SECTIONS = [
  { id: 'overview', ico: '🏠', label: 'Dashboard', group: 'मुख्य' },
  { id: 'robots', ico: '🤖', label: 'Robots + Scheduler', group: 'मुख्य' },
  { id: 'emergency', ico: '🛑', label: 'Emergency', group: 'मुख्य' },
  { id: 'alerts', ico: '🚨', label: 'Alerts + Incidents', group: 'मुख्य' },
  { id: 'questions', ico: '📚', label: 'Question Bank', group: 'सवाल' },
  { id: 'quality', ico: '🔬', label: 'Quality + Verification', group: 'सवाल' },
  { id: 'publish', ico: '🚀', label: 'Publish Queue', group: 'सवाल' },
  { id: 'deploy', ico: '🐙', label: 'GitHub + Deploy', group: 'सिस्टम' },
  { id: 'tests', ico: '✅', label: 'Tests + QA', group: 'सिस्टम' },
  { id: 'database', ico: '🗄️', label: 'Supabase + DB', group: 'सिस्टम' },
  { id: 'backup', ico: '💾', label: 'Backup + Recovery', group: 'सिस्टम' },
  { id: 'repair', ico: '🧠', label: 'Diagnosis + Repair', group: 'सिस्टम' },
  { id: 'students', ico: '👥', label: 'Students', group: 'Insights' },
  { id: 'security', ico: '🔐', label: 'Security', group: 'Insights' },
  { id: 'audit', ico: '📜', label: 'Audit Log', group: 'Insights' },
  { id: 'usage', ico: '📈', label: 'Usage + Cost', group: 'Insights' },
  { id: 'settings', ico: '⚙️', label: 'Policies + Settings', group: 'Insights' },
];
const DOCK = ['overview', 'command', 'robots', 'tasks', 'more'];

function wfList() {
  const st = S.status || {}; const wf = (st.github?.workflows || []).map(w => ({ ...w }));
  const byFile = {}; (S.runs || []).forEach(r => { const f = (r.path || '').split('/').pop(); if (f && !byFile[f]) byFile[f] = r; });
  wf.forEach(w => { const r = byFile[w.file]; if (r) { w.live_status = r.status; w.live_conclusion = r.conclusion; w.live_at = r.updated_at; w.live_url = r.html_url; w.live_id = r.id; } });
  return wf;
}
const badCount = () => (S.status?.checks || []).filter(c => c.level === 'bad').length;
const score = () => { const c = S.status?.checks || []; return Math.max(0, Math.min(100, 100 - 22 * c.filter(x => x.level === 'bad').length - 5 * c.filter(x => x.level === 'warn').length)); };

function itemHtml(c) {
  return `<li class="item ${c.level}"><span class="ic">${ICON[c.level]}</span><span><span class="area">${esc(c.area)}</span><div class="msg">${esc(c.msg)}</div></span><span></span>
    ${(c.todo || c.link) ? `<span class="todo">${c.todo ? '👉 ' + esc(c.todo) : ''}${c.link ? `<a href="${esc(c.link)}" ${c.link.startsWith('http') ? 'target="_blank" rel="noopener"' : ''}>खोलो ›</a>` : ''}</span>` : ''}</li>`;
}

function vOverview() {
  const st = S.status; const q = st.supabase?.questions || {}, stu = st.supabase?.students || {}, db = st.supabase?.db || {};
  const todo = (st.checks || []).filter(c => c.level !== 'ok'), good = (st.checks || []).filter(c => c.level === 'ok');
  const sc = score(), C = 2 * Math.PI * 40;
  const sett = settingsMap(); const flags = [];
  if (sett['robots.paused'] === true) flags.push('⏸ Robots रुके'); if (sett['data.frozen'] === true) flags.push('🧊 Data freeze'); if (sett['maintenance']?.on) flags.push('🛠 Maintenance');
  const wf = wfList(); const nexts = wf.filter(w => w.next_run).sort((a, b) => a.next_run.localeCompare(b.next_run));
  const H = S.hist.slice(-36);
  return `<div class="grid">
  <section class="card hero ${st.overall} s12"><div class="hero-in">
    <div class="ring" aria-label="Health score ${sc}"><svg viewBox="0 0 96 96"><circle cx="48" cy="48" r="40" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="10"/><circle cx="48" cy="48" r="40" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - sc / 100)}"/></svg><b>${sc}</b><small>HEALTH</small></div>
    <div style="flex:1;min-width:220px"><h1>${{ ok: 'सब ठीक चल रहा है', warn: 'चल रहा है — कुछ काम बाकी', bad: 'ध्यान दो — कुछ खराब है' }[st.overall]}</h1>
      <p>आख़िरी जाँच ${ago(st.at)} · अगली ${ago(st.next_check)} · ऐप ${esc(st.site?.version || '?')}</p>
      <div class="chips"><span class="hchip">${ICON[st.overall]} ${todo.length} काम</span><span class="hchip">📚 ${n(q.live)} live</span><span class="hchip">👥 ${n(stu.total)} students</span>${flags.map(f => `<span class="hchip">${f}</span>`).join('')}</div>
      <div class="hbtns"><button class="hbtn solid" data-act="health-now">🩺 अभी जाँच करवाओ</button><button class="hbtn" data-go="emergency">🛑 Emergency</button><a class="hbtn" href="../" >📱 ऐप</a></div></div>
  </div></section>
  <section class="card s8"><h2>👉 क्या करना है <small>${todo.length ? todo.length + ' काम' : 'कुछ नहीं'}</small></h2>
    <ul class="list">${todo.length ? todo.map(itemHtml).join('') : '<li class="item ok"><span class="ic">🎉</span><span class="msg">अभी कोई काम बाकी नहीं</span><span></span></li>'}</ul>
    <details style="margin-top:10px"><summary class="muted">ठीक चल रही चीज़ें (${good.length})</summary><ul class="list" style="margin-top:8px">${good.map(itemHtml).join('')}</ul></details></section>
  <section class="card s4"><h2>🗓️ आगे क्या चलेगा</h2><ul class="list">${nexts.slice(0, 5).map(w => `<li class="item ok"><span class="ic">${esc(w.label.split(' ')[0])}</span><span><div class="msg">${esc(w.label.replace(/^\S+\s/, ''))}</div><span class="faint">${when(w.next_run)} · ${ago(w.next_run)}</span></span><span></span></li>`).join('') || '<div class="empty">कोई schedule नहीं</div>'}
    <li class="item ok"><span class="ic">🔗</span><span><div class="msg">PYQ आते ही</div><span class="faint">Hindi → Tag → Key-check अपने-आप</span></span><span></span></li></ul></section>
  <div class="kpis s12">
    ${kpi('📚', q.live, 'Live सवाल', 'k1')}${kpi('🚀', (q.draft || 0) + (q.reviewed || 0), 'Publish बाकी', 'k3', (q.draft + q.reviewed) ? 'warn' : '')}
    ${kpi('🧩', q.broken_live, 'टूटे सवाल', 'k4', q.broken_live ? 'bad' : '')}${kpi('🏷️', q.untagged_live, 'बिना chapter', 'k6', q.untagged_live ? 'warn' : '')}
    ${kpi('👥', stu.active_7d, '7 दिन active', 'k2')}${kpi('💾', db.backups?.count ?? (st.supabase?.backups || []).length, 'Backups', 'k5')}
  </div>
  <section class="card s6"><h2>📈 सवाल (समय के साथ)</h2>${lineChart([{ name: 'Live', color: 'var(--c1)', values: H.map(h => h.live) }, { name: 'Publish बाकी', color: 'var(--c3)', values: H.map(h => h.pending) }], H.map(h => when(h.at).split(',')[0]))}</section>
  <section class="card s6"><h2>⚡ Students (14 दिन)</h2>${stu.trend ? lineChart([{ name: 'Active students', color: 'var(--c2)', values: stu.trend.map(d => d.active) }, { name: 'टेस्ट', color: 'var(--c4)', values: stu.trend.map(d => d.tests) }], stu.trend.map(d => d.day.slice(5))) : '<div class="empty">Health Robot की अगली जाँच के बाद</div>'}</section>
  <section class="card s12"><h2>🤖 Robots एक नज़र में <button class="btn sm soft" data-go="robots">सब देखो ›</button></h2>
    <div class="kpis">${wf.slice(0, 6).map(w => { const c = w.live_status && w.live_status !== 'completed' ? 'in_progress' : (w.live_conclusion || w.last_conclusion);
      return `<div class="kpi ${c === 'failure' ? 'bad' : ''}" style="--k:${c === 'failure' ? 'var(--bad)' : c === 'success' ? 'var(--ok)' : 'var(--primary)'}"><span class="ki">${esc(w.label.split(' ')[0])}</span><small style="margin-top:6px">${esc(w.label.replace(/^\S+\s/, ''))}</small><div style="margin-top:6px">${pill(c)}</div><small>${ago(w.live_at || w.last_at)}</small></div>`; }).join('')}</div></section>
  </div>`;
}

function robotCard(w) {
  const sett = settingsMap(); const id = w.robot; const enabled = id ? sett[`robot.${id}.enabled`] !== false : true;
  const c = w.live_status && w.live_status !== 'completed' ? 'in_progress' : (w.live_conclusion || w.last_conclusion);
  const rr = (S.status?.supabase?.robot_runs || {})[id] || null;
  const liveRuns = Array.isArray(S.live.runs) ? S.live.runs.filter(r => r.robot === id) : [];
  const last = liveRuns[0] || rr?.last;
  const k = { test: 'var(--c2)', robot: 'var(--c1)', system: 'var(--c6)' }[w.kind] || 'var(--c1)';
  const trig = [w.cron?.length ? w.cron.map(c => '⏰ ' + c).join(', ') : '', w.after?.length ? '🔗 ' + w.after.join(', ') + ' के बाद' : '', w.push ? '📤 हर push पर' : '', w.manual ? '👆 हाथ से' : ''].filter(Boolean).join(' · ');
  return `<article class="card rb" style="--k:${k}">
    <div class="rb-head"><span class="rb-ic">${esc(w.label.split(' ')[0])}</span><span style="flex:1;min-width:0"><b>${esc(w.label.replace(/^\S+\s/, ''))}</b><small>${esc(w.what)}</small></span>${pill(c)}</div>
    <div class="rb-stats"><span><b>${w.success_rate != null ? w.success_rate + '%' : '—'}</b>सफलता (30 दिन)</span><span><b>${n(w.runs_30d)}</b>runs · ${n(w.failure)} fail</span><span><b>${w.avg_min != null ? w.avg_min + 'm' : '—'}</b>औसत समय</span></div>
    <div class="dots" aria-label="पिछले runs">${(w.history || []).map(h => `<a class="${esc(h.c)}" href="${esc(h.url)}" target="_blank" rel="noopener" title="${esc(h.c)} · ${when(h.at)} · ${esc(h.ev)}${h.n > 1 ? ' · retry ' + h.n : ''}"></a>`).join('')}</div>
    <div class="sched"><span>Trigger: <b>${esc(trig || '—')}</b></span><span>अगली run: <b>${w.next_run ? when(w.next_run) + ' (' + ago(w.next_run) + ')' : 'schedule नहीं'}</b> · आख़िरी सफल: <b>${ago(w.last_success_at)}</b></span>
      <span>Concurrency: <b>${esc(w.concurrency || '—')}</b> · Timeout: <b>${w.timeout ? w.timeout + ' मिनट' : '—'}</b> · Retries: <b>${n(w.retries)}</b></span>
      ${last && (last.processed != null || last.changed != null) ? `<span>पिछला काम: <b>${n(last.processed)} देखे · ${n(last.changed)} बदले</b> ${last.note ? '· ' + esc(String(last.note).slice(0, 80)) : ''}</span>` : ''}
      ${rr ? `<span>30 दिन: <b>${n(rr.runs)} runs · ${n(rr.changed)} बदलाव</b></span>` : ''}</div>
    ${w.diagnosis ? `<div class="diag"><b>🧠 ${esc(w.diagnosis.cause)}</b><span>👉 ${esc(w.diagnosis.fix)} · जोखिम: ${esc(w.diagnosis.risk)}</span></div>` : ''}
    ${w.error_log ? `<details><summary class="muted">Error log</summary><pre class="log">${esc(w.error_log)}</pre></details>` : ''}
    <div class="row">
      ${id && id !== 'ops' || w.file === 'tests.yml' ? `<button class="btn sm pri" data-act="run" data-wf="${esc(w.file)}">▶ Run</button>` : ''}
      ${c === 'failure' && (w.live_id || w.last_id) ? `<button class="btn sm" data-act="retry" data-wf="${esc(w.file)}" data-run="${w.live_id || w.last_id}">↻ Retry</button>` : ''}
      ${c === 'in_progress' && w.kind === 'robot' ? `<button class="btn sm" data-act="cancel" data-wf="${esc(w.file)}">⏹ रोको</button>` : ''}
      <a class="btn sm" href="${esc(w.live_url || w.last_url || w.page)}" target="_blank" rel="noopener">📄 Logs</a>
      ${id ? `<span style="margin-left:auto" class="row"><span class="faint" style="font-size:12px">${enabled ? 'चालू' : 'बंद'}</span><button class="toggle" role="switch" aria-checked="${enabled}" aria-label="${esc(w.label)} चालू/बंद" data-act="toggle-robot" data-id="${esc(id)}"></button></span>` : ''}
    </div></article>`;
}
function vRobots() {
  const sett = settingsMap(); const wf = wfList();
  const reqs = Array.isArray(S.live.requests) ? S.live.requests : (S.status?.supabase?.requests || []);
  return `<div class="ph"><div><h1>🤖 Robot Control Center</h1><p>हर robot की हालत, schedule, सफलता, logs — और Run / Retry / रोको / चालू-बंद।</p></div>
    <div class="acts"><button class="btn ${sett['robots.paused'] ? 'pri' : ''}" data-act="pause-all">${sett['robots.paused'] ? '▶ सब Resume' : '⏸ सब Pause'}</button><button class="btn danger" data-act="estop">🛑 Emergency Stop</button></div></div>
  ${sett['robots.paused'] ? `<div class="lock"><span>⏸</span><span><b>सारे robots रुके हुए हैं</b><small>Tests, Health, Backup और Ops चलते रहेंगे। Resume दबाओ।</small></span></div>` : ''}
  <div class="robots">${wf.map(robotCard).join('')}</div>
  <section class="card" style="margin-top:12px"><h2>📮 Request queue <small>Ops Robot हर 10 मिनट में करता है</small></h2>${reqTable(reqs)}
    <p class="note">⚙️ Run / Cancel / Backup / Rollback पहले कतार में जाते हैं; Ops Robot GitHub पर चलाता है। जल्दी चाहिए तो robot card में 📄 → GitHub पर "Run workflow"।</p></section>`;
}
function reqTable(reqs) {
  if (!reqs || reqs.error || !reqs.length) return `<div class="empty">${reqs?.error ? esc(reqs.error) : 'अभी कोई request नहीं'}</div>`;
  return `<div class="tbl-wrap"><table><thead><tr><th>#</th><th>काम</th><th>हाल</th><th>नतीजा</th><th>कब</th></tr></thead><tbody>${reqs.slice(0, 20).map(r => `<tr><td class="mono">${r.id}</td><td>${esc(r.action)} <span class="faint">${esc(r.target || '')}</span></td><td>${pill({ queued: 'queued', sent: 'success', done: 'success', failed: 'failure', rejected: 'cancelled' }[r.status])}</td><td>${esc(r.result || '')}</td><td>${ago(r.requested_at || r.at)}</td></tr>`).join('')}</tbody></table></div>`;
}

function vEmergency() {
  const sett = settingsMap(); const m = sett['maintenance'] || { on: false, message: '' };
  const sw = (key, title, desc, danger) => { const v = sett[key] === true; const r = settingRow(key);
    return `<div class="sw"><span class="t"><b>${esc(title)}</b><small>${esc(desc)}${r.updated_at ? ` · बदला ${ago(r.updated_at)}${r.updated_by ? ' (' + esc(r.updated_by) + ')' : ''}` : ''}</small></span><button class="toggle ${danger ? 'danger' : ''}" role="switch" aria-checked="${v}" aria-label="${esc(title)}" data-act="flag" data-key="${key}"></button></div>`; };
  return `<div class="ph"><div><h1>🛑 Emergency & Maintenance</h1><p>गड़बड़ी में सब रोको, ठीक होने पर सँभलकर चालू करो। हर बदलाव audit में दर्ज होता है।</p></div></div>
  <div class="grid">
    <section class="card s6"><h2>🛑 Emergency Stop</h2><p class="muted">एक बटन: सारे robots रुकेंगे, data बदलना बंद होगा, और चल रहे robot runs रद्द होंगे। App और students चलते रहेंगे; Tests, Health और Backup भी चलते रहेंगे।</p>
      <div class="row"><button class="btn danger" data-act="estop">🛑 Emergency Stop</button><button class="btn pri" data-act="resume">✅ Controlled Resume</button></div>
      <p class="note">Resume पहले Health जाँच करवाता है; फिर robots फिर से चालू।</p></section>
    <section class="card s6"><h2>🎚️ Switches</h2><div class="list">
      ${sw('robots.paused', 'सारे robots रोको (Global pause)', 'PYQ / Hindi / Tag / Key-check नहीं चलेंगे', true)}
      ${sw('data.frozen', 'Data बदलना बंद (Freeze)', 'कोई robot server पर सवाल नहीं बदलेगा', true)}
      <div class="sw"><span class="t"><b>Auto-publish</b><small>हमेशा बंद — हर publish आप करते हैं (Publish Queue)</small></span><button class="toggle" role="switch" aria-checked="false" disabled aria-label="Auto-publish (बंद)"></button></div>
    </div></section>
    <section class="card s12"><h2>🛠️ Maintenance mode <small>${m.on ? '<span class="pill warn">चालू</span>' : '<span class="pill ok">बंद</span>'}</small></h2>
      <p class="muted">चालू करने पर students के ऐप में ऊपर संदेश दिखेगा (ऐप काम करता रहेगा)।</p>
      <div class="field"><label for="mmsg">संदेश</label><input id="mmsg" class="input" maxlength="160" value="${esc(m.message || '')}" placeholder="जैसे: आज रात 11 बजे 10 मिनट के लिए नए सवाल जुड़ रहे हैं"></div>
      <div class="row"><button class="btn ${m.on ? '' : 'pri'}" data-act="maint" data-on="${m.on ? 0 : 1}">${m.on ? 'Maintenance बंद करो' : 'Maintenance चालू करो'}</button>${m.on ? '<button class="btn" data-act="maint-save">संदेश सेव</button>' : ''}</div></section>
  </div>`;
}

function vAlerts() {
  const st = S.status; const inc = Array.isArray(S.live.incidents) ? S.live.incidents : (st.supabase?.incidents || []);
  const errs = Array.isArray(S.live.errors) ? S.live.errors : (st.supabase?.client_errors || []);
  const open = inc.filter(i => i.status === 'open'), shut = inc.filter(i => i.status !== 'open');
  const sev = { critical: 'bad', major: 'warn', minor: 'info' };
  const row = i => `<li class="item ${i.status === 'open' ? (i.severity === 'critical' ? 'bad' : 'warn') : 'ok'}"><span class="ic">${i.status === 'open' ? '🚨' : '✅'}</span><span><span class="area">${esc(i.area || '')} · <span class="pill ${sev[i.severity] || 'none'}">${esc(i.severity)}</span></span><div class="msg">${esc(i.title)}</div><span class="faint">खुला ${when(i.opened_at)} · ${n(i.seen_count)} बार देखा${i.resolved_at ? ' · ठीक हुआ ' + when(i.resolved_at) : ''}</span></span><span></span>${i.suggestion ? `<span class="todo">👉 ${esc(i.suggestion)}</span>` : ''}</li>`;
  return `<div class="ph"><div><h1>🚨 Alerts & Incidents</h1><p>हर गंभीर गड़बड़ी incident बनती है; ठीक होते ही अपने-आप बंद। लाल होने पर GitHub issue + email।</p></div>
    <div class="acts"><a class="btn" href="${GH}/issues" target="_blank" rel="noopener">🐙 GitHub Issues (${n(st.github?.issues)})</a></div></div>
  <div class="grid"><section class="card s6"><h2>🔥 खुले incidents <small>${open.length}</small></h2><ul class="list">${open.map(row).join('') || '<div class="empty">कोई खुला incident नहीं 🎉</div>'}</ul>
    <details style="margin-top:10px"><summary class="muted">पुराने (${shut.length})</summary><ul class="list" style="margin-top:8px">${shut.slice(0, 20).map(row).join('')}</ul></details></section>
  <section class="card s6"><h2>📱 App errors (students के phone) <small>7 दिन</small></h2>${errs.length ? `<div class="tbl-wrap"><table><thead><tr><th>कब</th><th>Version</th><th>Page</th><th>Error</th></tr></thead><tbody>${errs.slice(0, 25).map(e => `<tr><td>${ago(e.at)}</td><td class="mono">${esc(e.app_version || e.v || '')}</td><td>${esc(e.page || '')}</td><td>${esc(e.message || e.msg || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">कोई error नहीं मिला</div>'}
    <p class="note">ऐप हर JavaScript error यहाँ भेजता है (हर student के लिए घंटे में अधिकतम 30)।</p></section>
  <section class="card s12"><h2>🔔 Notifications</h2>${(() => { const v = settingsMap()['alerts.issue'] !== false; return `<div class="sw"><span class="t"><b>लाल होने पर GitHub issue खोलो</b><small>GitHub app / email पर सूचना आती है</small></span><button class="toggle" role="switch" aria-checked="${v}" data-act="flag" data-key="alerts.issue" aria-label="GitHub issue alerts"></button></div>`; })()}</section></div>`;
}

/* ---------- question bank ---------- */
const QF = [['all', 'सभी'], ['live', 'Live'], ['draft', 'Draft'], ['reviewed', 'Reviewed'], ['hidden', 'छिपे'], ['broken', 'टूटे'], ['dupopt', 'Options एक जैसे'], ['keycheck', 'Key-check flag'], ['nohindi', 'बिना Hindi'], ['untagged', 'बिना chapter'], ['noexpl', 'बिना explanation']];
function qQuery() {
  const f = S.q; const p = ['select=id,subject,chapter,topic,topic_id,status,is_active,source_type,question_en,question_hi,options,answer,explanation_en,explanation_hi,source_ref,exam_id,year,shift,updated_at,content_hash'];
  const ids = l => `id=in.(${l.slice(0, 250).map(x => '"' + x.replace(/"/g, '') + '"').join(',')})`;
  const pr = S.status?.supabase?.questions?.problem_ids || {};
  if (f.filter === 'live') p.push('status=eq.published', 'is_active=is.true');
  if (f.filter === 'draft') p.push('status=eq.draft', 'is_active=is.true');
  if (f.filter === 'reviewed') p.push('status=eq.reviewed');
  if (f.filter === 'hidden') p.push('is_active=is.false');
  if (f.filter === 'nohindi') p.push('or=(question_hi.is.null,question_hi.eq.)', 'is_active=is.true');
  if (f.filter === 'untagged') p.push('topic_id=like.*mixed-untagged*', 'is_active=is.true');
  if (f.filter === 'noexpl') p.push('explanation_en=is.null', 'explanation_hi=is.null', 'status=eq.published', 'is_active=is.true');
  if (f.filter === 'broken') p.push(ids(pr.broken?.length ? pr.broken : ['-']));
  if (f.filter === 'dupopt') p.push(ids(pr.dup_options?.length ? pr.dup_options : ['-']));
  if (f.filter === 'keycheck') { const l = (S.status?.keycheck?.sample || []).map(x => x.id); p.push(ids(l.length ? l : ['-'])); }
  if (f.subject) p.push('subject=eq.' + encodeURIComponent(f.subject));
  if (f.source) p.push('source_type=eq.' + f.source);
  if (f.text.trim()) { const t = f.text.trim().replace(/[(),*]/g, ' ').slice(0, 60); p.push(`or=(question_en.ilike.*${encodeURIComponent(t)}*,question_hi.ilike.*${encodeURIComponent(t)}*,id.ilike.*${encodeURIComponent(t)}*,source_ref.ilike.*${encodeURIComponent(t)}*)`); }
  p.push('order=' + f.sort, 'limit=30', 'offset=' + f.page * 30);
  return '/rest/v1/questions?' + p.join('&');
}
async function loadQuestions() {
  if (!S.admin) return; S.q.loading = true; render();
  try { const r = await api(qQuery(), { count: true }); S.q.rows = r.rows; S.q.total = r.total; } catch (e) { S.q.rows = []; S.q.total = 0; toast(e.message); }
  S.q.loading = false; render();
}
function validate(q) {
  const o = q.options || [], probs = [];
  if (!['A', 'B', 'C', 'D'].includes(q.answer)) probs.push('answer A–D नहीं');
  if (o.length !== 4) probs.push(`${o.length} options`);
  if (o.some(x => !String(x.en || x.hi || '').trim())) probs.push('खाली option');
  if (String(q.question_en || q.question_hi || '').trim().length < 8) probs.push('text छोटा/कटा');
  const t = o.map(x => String(x.en || x.hi || '').trim().toLowerCase().replace(/\s+/g, ' ')); if (new Set(t).size !== t.length) probs.push('options एक जैसे');
  if ((S.status?.keycheck?.sample || []).some(x => x.id === q.id)) probs.push('key-check flag');
  const warns = []; if (!String(q.question_hi || '').trim()) warns.push('Hindi नहीं'); if (/mixed-untagged/.test(q.topic_id || '')) warns.push('chapter नहीं');
  return { ok: !probs.length, probs, warns };
}
function qCard(q) {
  const v = validate(q); const sel = S.sel.has(q.id);
  const st = !q.is_active ? '<span class="pill none">छिपा</span>' : q.status === 'published' ? '<span class="pill ok">Live</span>' : q.status === 'reviewed' ? '<span class="pill info">Reviewed</span>' : '<span class="pill warn">Draft</span>';
  return `<div class="q ${sel ? 'sel' : ''}"><input type="checkbox" aria-label="चुनें ${esc(q.id)}" data-pick="${esc(q.id)}" ${sel ? 'checked' : ''}>
    <div><div class="qt" data-open="${esc(q.id)}">${esc(String(q.question_en || q.question_hi || '').slice(0, 220))}</div>${q.question_hi && q.question_en ? `<div class="qh">${esc(q.question_hi.slice(0, 160))}</div>` : ''}
    <div class="meta">${st}<span class="pill none">${esc(pretty(q.subject))}</span><span class="pill none">${esc(q.chapter || '')}</span><span class="pill none">${esc(q.source_type || '')}</span><span class="pill none mono">Ans ${esc(q.answer || '?')}</span>
      ${v.probs.map(p => `<span class="pill bad">⚠ ${esc(p)}</span>`).join('')}${v.warns.map(p => `<span class="pill warn">${esc(p)}</span>`).join('')}</div></div></div>`;
}
function vQuestions() {
  const qs = S.status?.supabase?.questions || {}; const subj = Object.keys(qs.by_subject || qs.quality_by_subject || {});
  const counts = { all: qs.total, live: qs.live, draft: qs.draft, reviewed: qs.reviewed, hidden: qs.hidden, broken: qs.broken_live, dupopt: qs.dup_options_live, keycheck: S.status?.keycheck?.total, nohindi: qs.no_hindi_live, untagged: qs.untagged_live, noexpl: qs.no_expl_live };
  const lock = !S.admin ? loginLock('सवाल देखने, बदलने और publish करने के लिए admin login चाहिए।') : '';
  return `<div class="ph"><div><h1>📚 Question Bank Control</h1><p>खोजो, छाँटो, चुनो — फिर Approve / Publish / Hide / Unhide / Edit। हर बदलाव audit में, Undo के साथ।</p></div></div>
  ${lock}
  <div class="search" style="margin-bottom:10px"><input class="input" id="qsearch" placeholder="ID, text (English/हिंदी) या paper से खोजो" value="${esc(S.q.text)}" ${S.admin ? '' : 'disabled'}></div>
  <div class="filters" role="group" aria-label="Filter">${QF.map(([k, l]) => `<button class="chip ${S.q.filter === k ? 'on' : ''}" data-qf="${k}" aria-pressed="${S.q.filter === k}">${l}${counts[k] != null ? `<b>${n(counts[k])}</b>` : ''}</button>`).join('')}</div>
  <div class="row" style="margin:10px 0">
    <select class="input" style="width:auto" id="qsubj" aria-label="Subject"><option value="">सारे subjects</option>${subj.map(s => `<option value="${esc(s)}" ${S.q.subject === s ? 'selected' : ''}>${esc(pretty(s))}</option>`).join('')}</select>
    <select class="input" style="width:auto" id="qsrc" aria-label="Source"><option value="">PYQ + Practice</option><option value="PYQ" ${S.q.source === 'PYQ' ? 'selected' : ''}>सिर्फ़ PYQ</option><option value="PRACTICE" ${S.q.source === 'PRACTICE' ? 'selected' : ''}>सिर्फ़ Practice</option></select>
    <select class="input" style="width:auto" id="qsort" aria-label="Sort"><option value="updated_at.desc">नए बदले पहले</option><option value="updated_at.asc" ${S.q.sort === 'updated_at.asc' ? 'selected' : ''}>पुराने पहले</option><option value="id.asc" ${S.q.sort === 'id.asc' ? 'selected' : ''}>ID</option><option value="subject.asc,chapter.asc" ${S.q.sort.startsWith('subject') ? 'selected' : ''}>Subject → Chapter</option></select>
    <span class="muted" style="margin-left:auto">${S.admin ? `${n(S.q.total)} मिले` : ''}</span></div>
  ${S.q.loading ? '<div class="qlist">' + '<div class="card"><div class="skel"></div></div>'.repeat(4) + '</div>' : `<div class="qlist">${S.q.rows.map(qCard).join('') || (S.admin ? '<div class="empty">कुछ नहीं मिला</div>' : '')}</div>`}
  ${S.admin && S.q.total > 30 ? `<div class="row" style="justify-content:center;margin-top:10px"><button class="btn" data-qpage="-1" ${S.q.page ? '' : 'disabled'}>‹ पिछले</button><span class="muted">पेज ${S.q.page + 1} / ${Math.ceil(S.q.total / 30)}</span><button class="btn" data-qpage="1" ${(S.q.page + 1) * 30 < S.q.total ? '' : 'disabled'}>अगले ›</button></div>` : ''}
  ${S.sel.size ? `<div class="bulk"><b>${S.sel.size} चुने</b><button class="btn sm" data-bulk="approve">✓ Approve</button><button class="btn sm pri" data-bulk="publish">🚀 Publish</button><button class="btn sm" data-bulk="hide">🙈 Hide</button><button class="btn sm" data-bulk="unhide">👁 Unhide</button><button class="btn sm" data-bulk="draft">↩ Draft</button><button class="btn sm" data-bulk="clear">✕</button></div>` : ''}`;
}
function loginLock(why) { return `<div class="lock"><span style="font-size:22px">🔑</span><span style="flex:1"><b>Admin login चाहिए</b><small>${esc(why)}</small></span><button class="btn pri" data-act="login">Login</button></div>`; }
async function openQuestion(id) {
  let q = S.q.rows.find(x => x.id === id) || S.pub.rows.find(x => x.id === id);
  try { q = (await api('/rest/v1/questions?select=*&id=eq.' + encodeURIComponent(id)))[0] || q; } catch (_) {}
  if (!q) return toast('सवाल नहीं मिला');
  let hist = []; try { hist = await api(`/rest/v1/ops_audit?select=*&table_name=eq.questions&row_id=eq.${encodeURIComponent(id)}&order=id.desc&limit=20`); } catch (_) {}
  const v = validate(q);
  sheet('सवाल · ' + q.id, `<div class="row" style="margin-bottom:8px">${v.ok ? '<span class="pill ok">✓ सारी जाँच पास</span>' : v.probs.map(p => `<span class="pill bad">⚠ ${esc(p)}</span>`).join('')}${v.warns.map(p => `<span class="pill warn">${esc(p)}</span>`).join('')}</div>
    <p style="font-weight:700;margin:0">${esc(q.question_en || '')}</p>${q.question_hi ? `<p class="muted" style="margin:6px 0 0">${esc(q.question_hi)}</p>` : ''}
    <ul class="opts">${(q.options || []).map(o => `<li class="${o.letter === q.answer ? 'ans' : ''}"><b>${esc(o.letter)}</b><span>${esc(o.en || '')}${o.hi && o.hi !== o.en ? `<br><span class="muted">${esc(o.hi)}</span>` : ''}</span></li>`).join('')}</ul>
    ${q.explanation_en || q.explanation_hi ? `<h3>Explanation</h3><p>${esc(q.explanation_en || q.explanation_hi)}</p>` : ''}
    <p class="note">${esc(pretty(q.subject))} · ${esc(q.chapter || '')} › ${esc(q.topic || '')} · ${esc(q.source_type || '')} · ${esc(q.source_ref || '')} · ${esc(q.status)}${q.is_active ? '' : ' (छिपा)'}</p>
    <div class="row" style="margin:10px 0"><button class="btn sm" data-one="approve">✓ Approve</button><button class="btn sm pri" data-one="publish" ${v.ok ? '' : 'disabled'}>🚀 Publish</button><button class="btn sm" data-one="${q.is_active ? 'hide' : 'unhide'}">${q.is_active ? '🙈 Hide' : '👁 Unhide'}</button><button class="btn sm" data-one="reject">⛔ Reject</button><button class="btn sm soft" data-one="edit">✏️ Edit</button></div>
    <h3>इतिहास (audit)</h3>${hist.length ? hist.map(a => auditRow(a, true)).join('') : '<div class="empty">कोई बदलाव दर्ज नहीं</div>'}`,
  (el, close) => {
    el.querySelectorAll('[data-one]').forEach(b => b.onclick = async () => {
      const a = b.dataset.one; if (a === 'edit') { close(); return editQuestion(q); }
      close(); await bulkAction(a, [q.id]);
    });
    el.querySelectorAll('[data-undo]').forEach(b => b.onclick = () => { close(); undo(Number(b.dataset.undo)); });
  });
}
function editQuestion(q) {
  const o = q.options || [];
  sheet('✏️ Edit · ' + q.id, `<p class="note" style="margin-top:0">सिर्फ़ official text की गलती ठीक करें (OCR/टाइपिंग)। Publisher का solution copy न करें। बदलाव audit में जाएगा और Undo हो सकेगा।</p>
    <div class="field"><label>सवाल (English)</label><textarea class="input" data-f="question_en">${esc(q.question_en || '')}</textarea></div>
    <div class="field"><label>सवाल (हिंदी)</label><textarea class="input" data-f="question_hi">${esc(q.question_hi || '')}</textarea></div>
    ${['A', 'B', 'C', 'D'].map((L, i) => `<div class="field"><label>Option ${L} (EN / हिंदी)</label><input class="input" data-o="${i}" data-k="en" value="${esc(o[i]?.en || '')}"><input class="input" style="margin-top:6px" data-o="${i}" data-k="hi" value="${esc(o[i]?.hi || '')}"></div>`).join('')}
    <div class="field"><label>Answer</label><select class="input" data-f="answer">${['A', 'B', 'C', 'D'].map(L => `<option ${q.answer === L ? 'selected' : ''}>${L}</option>`).join('')}</select></div>
    <div class="field"><label>Explanation (हमारा अपना)</label><textarea class="input" data-f="explanation_en">${esc(q.explanation_en || '')}</textarea></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-x>रद्द</button><button class="btn pri" data-save>💾 सेव</button></div>`,
  (el, close) => {
    el.querySelector('[data-save]').onclick = async () => {
      const body = {}; el.querySelectorAll('[data-f]').forEach(i => { body[i.dataset.f] = i.value.trim() || null; });
      body.options = ['A', 'B', 'C', 'D'].map((L, i) => ({ ...(o[i] || {}), letter: L, en: el.querySelector(`[data-o="${i}"][data-k=en]`).value.trim(), hi: el.querySelector(`[data-o="${i}"][data-k=hi]`).value.trim() }));
      body.content_hash = 'ed-' + Math.random().toString(36).slice(2, 14);
      const v = validate({ ...q, ...body }); if (!v.ok && !(await ask('जाँच में दिक्कत', 'ये दिक्कतें हैं: ' + v.probs.join(', ') + '. फिर भी सेव करें?'))) return;
      try { await api('/rest/v1/questions?id=eq.' + encodeURIComponent(q.id), { method: 'PATCH', body, prefer: 'return=minimal' }); close(); toast('सेव हो गया — audit में दर्ज'); loadQuestions(); }
      catch (e) { toast(e.message); }
    };
  });
}
async function bulkAction(action, ids) {
  if (needAdmin()) return;
  ids = ids || [...S.sel]; if (!ids.length) return;
  const label = { approve: 'Approve', publish: 'Publish (live)', hide: 'Hide', reject: 'Reject (hide)', unhide: 'Unhide', draft: 'Draft में वापस' }[action];
  const r = await ask(label, `${ids.length} सवाल: <b>${label}</b>. ${action === 'publish' ? 'सिर्फ़ जाँच पास करने वाले live होंगे (answer A–D, 4 भरे options, पूरा text).' : ''}`, { reason: true, danger: ['hide', 'reject'].includes(action) });
  if (!r) return;
  let done = 0;
  try { for (let i = 0; i < ids.length; i += 500) done += await rpc('ops_question_action', { p_ids: ids.slice(i, i + 500), p_action: action, p_reason: r.reason || label }); toast(`${done} सवाल: ${label} ✓`); }
  catch (e) { toast(e.message); }
  S.sel.clear(); if (S.route === 'publish') loadPublishQueue(); else loadQuestions();
}

/* ---------- quality ---------- */
function vQuality() {
  const st = S.status; const qs = st.supabase?.questions || {}; const kc = st.keycheck || {}; const db = st.supabase?.db || S.live.db || {};
  const qbs = qs.quality_by_subject || {};
  const cell = (v, live, hot = .2) => { const r = live ? (v || 0) / live : 0; return `<td class="num ${v ? (r > hot ? 'hot' : 'warm') : ''}">${n(v || 0)}</td>`; };
  const KC = { A1: 'अधूरा (answer/options)', A2: 'दो options एक जैसे', A3: 'text कटा/छोटा', B: 'दूसरे paper में अलग answer', C: 'Paper में key खिसकी?', D: 'Gemini असहमत' };
  return `<div class="ph"><div><h1>🔬 Quality & Verification Center</h1><p>Bilingual, answer key, explanation, duplicate और structure — हर subject का हाल। लाल = ज़्यादा दिक्कत।</p></div>
    <div class="acts"><button class="btn pri" data-act="run" data-wf="key-check-robot.yml">🔑 Key-check चलाओ</button><button class="btn" data-act="run" data-wf="hindi-robot.yml">🌐 Hindi Robot</button><button class="btn" data-act="run" data-wf="tag-robot.yml">🏷️ Tag Robot</button></div></div>
  <div class="kpis" style="margin-bottom:12px">${kpi('🧩', qs.broken_live, 'टूटे (live)', 'k4', qs.broken_live ? 'bad' : '')}${kpi('👯', qs.dup_options_live, 'Options एक जैसे', 'k3', qs.dup_options_live ? 'warn' : '')}${kpi('🔁', db.integrity?.duplicate_live, 'Duplicate सवाल', 'k6')}${kpi('🌐', qs.no_hindi_live, 'बिना Hindi', 'k5')}${kpi('🏷️', qs.untagged_live, 'बिना chapter', 'k1')}${kpi('📝', qs.no_expl_live, 'बिना explanation', 'k2')}</div>
  <div class="grid"><section class="card s8"><h2>🧮 Subject-wise quality matrix</h2><div class="tbl-wrap"><table class="matrix"><thead><tr><th>Subject</th><th class="num">Live</th><th class="num">बाकी</th><th class="num">टूटे</th><th class="num">बिना Hindi</th><th class="num">बिना chapter</th><th class="num">बिना expl.</th><th class="num">छिपे</th></tr></thead><tbody>
    ${Object.entries(qbs).map(([s, v]) => `<tr><td>${esc(pretty(s))}</td><td class="num">${n(v.live || 0)}</td><td class="num">${n(v.pending || 0)}</td>${cell(v.broken, v.live, 0)}${cell(v.no_hindi, v.live)}${cell(v.untagged, v.live)}${cell(v.no_expl, v.live, .9)}<td class="num">${n(v.hidden || 0)}</td></tr>`).join('') || '<tr><td colspan="8">Health Robot की अगली जाँच के बाद</td></tr>'}</tbody></table></div>
    <p class="note">Hindi = IndicTrans2 machine translation (source_ref में लिखा)। Official key ही सच है; robot सिर्फ़ flag करते हैं, इंसान तय करता है।</p></section>
  <section class="card s4"><h2>🔑 Answer-key जाँच <small>${kc.at ? ago(kc.at) : ''}</small></h2>${kc.by_code ? bars(Object.entries(kc.by_code).map(([k, v]) => [KC[k] || k, v]), 'var(--c4)') : `<div class="empty">${esc(kc.note || kc.error || 'रिपोर्ट नहीं')}</div>`}
    ${kc.sample?.length ? `<h3>Review के लिए (confidence कम)</h3><div class="list">${kc.sample.slice(0, 8).map(f => `<button class="item warn" style="text-align:left;cursor:pointer" data-open="${esc(f.id)}"><span class="ic">⚠</span><span><span class="area">${esc(f.code)} · ${esc(KC[f.code] || '')}</span><div class="msg mono" style="font-size:11.5px">${esc(f.id)}</div></span><span>›</span></button>`).join('')}</div>` : ''}
    ${kc.url ? `<p class="note"><a href="${esc(kc.url)}" target="_blank" rel="noopener">पूरी रिपोर्ट GitHub पर ›</a></p>` : ''}</section></div>`;
}

/* ---------- publish ---------- */
async function loadPublishQueue() {
  if (!S.admin) return; S.pub.loading = true; render();
  try { S.pub.rows = await api('/rest/v1/questions?select=id,subject,chapter,topic,topic_id,status,is_active,source_type,question_en,question_hi,options,answer,source_ref,updated_at&status=in.(draft,reviewed)&is_active=is.true&order=updated_at.desc&limit=1000'); }
  catch (e) { S.pub.rows = []; toast(e.message); }
  try { S.pub.history = await api('/rest/v1/ops_audit?select=id,at,row_id,actor,reason,changed&table_name=eq.questions&changed->status->>1=eq.published&order=id.desc&limit=30'); } catch (_) { S.pub.history = []; }
  S.pub.loading = false; render();
}
function vPublish() {
  if (!S.admin) return `<div class="ph"><div><h1>🚀 Publish Queue</h1><p>Draft → जाँच → Approve → Publish</p></div></div>${loginLock('Publish queue देखने के लिए admin login चाहिए।')}`;
  const rows = S.pub.rows || []; const val = rows.map(q => ({ q, v: validate(q) })); const pass = val.filter(x => x.v.ok), fail = val.filter(x => !x.v.ok);
  const bySrc = {}; rows.forEach(q => { const k = (q.source_ref || 'Unknown').split(' · ')[0]; bySrc[k] = (bySrc[k] || 0) + 1; });
  return `<div class="ph"><div><h1>🚀 Publish Queue</h1><p>सिर्फ़ जाँच पास करने वाले सवाल live होते हैं। हर publish audit में; Undo संभव।</p></div>
    <div class="acts"><button class="btn" data-act="pub-reload">🔄</button><button class="btn pri" data-act="pub-all" ${pass.length ? '' : 'disabled'}>🚀 ${pass.length} पास वाले Publish करो</button></div></div>
  <div class="kpis" style="margin-bottom:12px">${kpi('📥', rows.length, 'इंतज़ार में', 'k3')}${kpi('✅', pass.length, 'जाँच पास', 'k2')}${kpi('⚠️', fail.length, 'जाँच fail', 'k4', fail.length ? 'bad' : '')}${kpi('🔁', rows.filter(q => q.status === 'reviewed').length, 'Approved', 'k1')}</div>
  ${S.pub.loading ? '<div class="card"><div class="skel"></div></div>' : `<div class="grid"><section class="card s8"><h2>📋 Queue <small>${rows.length}</small></h2>
    <div class="qlist">${val.slice(0, 60).map(({ q }) => qCard(q)).join('') || '<div class="empty">Queue खाली 🎉</div>'}</div>
    ${rows.length > 60 ? `<p class="note">पहले 60 दिखाए; बाकी "Question Bank → Draft" में।</p>` : ''}</section>
  <section class="card s4"><h2>📦 Batch (paper)</h2>${bars(Object.entries(bySrc).sort((a, b) => b[1] - a[1]).slice(0, 10), 'var(--c3)')}
    <h3>Publishing history</h3>${(S.pub.history || []).length ? `<div class="list">${S.pub.history.slice(0, 12).map(a => `<div class="item ok"><span class="ic">🚀</span><span><div class="msg mono" style="font-size:11.5px">${esc(a.row_id)}</div><span class="faint">${when(a.at)} · ${esc(a.actor || '')}</span></span><span></span></div>`).join('')}</div>` : '<div class="empty">अभी कोई नहीं</div>'}</section></div>`}
  ${S.sel.size ? `<div class="bulk"><b>${S.sel.size} चुने</b><button class="btn sm" data-bulk="approve">✓ Approve</button><button class="btn sm pri" data-bulk="publish">🚀 Publish</button><button class="btn sm" data-bulk="reject">⛔ Reject</button><button class="btn sm" data-bulk="clear">✕</button></div>` : ''}`;
}

/* ---------- deploy ---------- */
function vDeploy() {
  const g = S.status.github || {}, site = S.status.site || {};
  return `<div class="ph"><div><h1>🐙 GitHub & Deployment</h1><p>Live version, commits, releases, Pages, workflows — और पिछले verified version पर Rollback।</p></div>
    <div class="acts"><a class="btn" href="${GH}" target="_blank" rel="noopener">Repository ›</a><a class="btn" href="${GH}/actions" target="_blank" rel="noopener">Actions ›</a></div></div>
  <div class="kpis" style="margin-bottom:12px">${kpi('🌐', site.version, 'Live version', 'k1')}${kpi('🧾', site.source_version, 'Code version', 'k6', site.version !== site.source_version ? 'warn' : '')}${kpi('⚡', site.ms != null ? site.ms + ' ms' : '—', 'Load time', 'k2')}${kpi('📦', site.size_kb != null ? site.size_kb + ' KB' : '—', 'App size', 'k5')}${kpi('🗂️', (g.branches || []).length, 'Branches', 'k3')}${kpi('🚦', g.pages?.status || '—', 'Pages', 'k4')}</div>
  <div class="grid"><section class="card s8"><h2>🏷️ Releases <small>Rollback सिर्फ़ tests-पास version पर</small></h2>
    <div class="tbl-wrap"><table><thead><tr><th>Version</th><th>Commit</th><th>Tests</th><th>कब</th><th></th></tr></thead><tbody>${(g.releases || []).map((r, i) => `<tr><td><b>${esc(r.version || '—')}</b><br><span class="faint">${esc(r.msg)}</span></td><td class="mono"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.sha)}</a></td><td>${pill(r.tests)}</td><td>${ago(r.at)}</td><td>${i === 0 ? '<span class="pill info">Live</span>' : r.tests === 'success' ? `<button class="btn sm" data-act="rollback" data-sha="${esc(r.full)}" data-ver="${esc(r.version || r.sha)}">⏪ Rollback</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5">—</td></tr>'}</tbody></table></div>
    <p class="note">Rollback सिर्फ़ live files (index.html, admin) बदलता है, source नहीं; फिर Claude source ठीक करता है। Phones पर नया cache नाम से पुराना version पहुँचता है।</p></section>
  <section class="card s4"><h2>📌 Latest commit</h2>${g.latest_commit?.sha ? `<p><a class="mono" href="${esc(g.latest_commit.url)}" target="_blank" rel="noopener">${esc(g.latest_commit.sha)}</a> · ${ago(g.latest_commit.at)}</p><p class="muted">${esc(g.latest_commit.msg)}</p>` : '—'}
    <h3>Branches</h3><div class="row">${(g.branches || []).map(b => `<a class="pill none" href="${GH}/tree/${esc(b)}" target="_blank" rel="noopener">${esc(b)}</a>`).join('')}</div>
    <h3>Links</h3><div class="row"><a class="pill ok" href="../">App ${site.ok ? '✓' : '✕'}</a><a class="pill ${site.admin_ok === false ? 'bad' : 'ok'}" href="../admin/">Admin ${site.admin_ok === false ? '✕' : '✓'}</a><span class="pill none mono">${esc(site.sw_cache || '')}</span></div></section>
  <section class="card s12"><h2>⚙️ Workflow runs (live)</h2><div class="tbl-wrap"><table><thead><tr><th>Workflow</th><th>हाल</th><th>Event</th><th>Branch</th><th>कब</th></tr></thead><tbody>${(S.runs || []).slice(0, 25).map(r => `<tr><td><a href="${esc(r.html_url)}" target="_blank" rel="noopener">${esc(r.name)}</a></td><td>${pill(r.status === 'completed' ? r.conclusion : r.status)}</td><td>${esc(r.event)}</td><td class="mono">${esc(r.head_branch)}</td><td>${ago(r.updated_at)}</td></tr>`).join('') || '<tr><td colspan="5">GitHub से जानकारी नहीं मिली</td></tr>'}</tbody></table></div></section></div>`;
}

/* ---------- tests ---------- */
function vTests() {
  const t = S.status.tests || {}; const wf = wfList().find(w => w.file === 'tests.yml') || {};
  const suites = t.suites || [];
  const DESC = { test_u1_reg: 'Core regression', test_u2_v4: 'Data engine', test_u3: 'Navigation', test_u4a: 'Practice', test_u4b: 'CBT test room', test_u4c: 'Result', test_u5: 'Subjects + Question bank', test_a: 'Accessibility', test_c1: 'Server upload', test_c2: 'Cloud sync + login', test_f1: 'Import', test_clean: 'Cleanup', test_pwa: 'Offline / PWA', test_defaults: 'Defaults', test_sql_v2: 'Database rules (RLS)', test_studio: 'Admin Studio', test_robot: 'PYQ Robot', test_hindi: 'Hindi Robot', test_tagger: 'Tag Robot', test_profile: 'Exam/branch profile', test_v3: 'V3 design + CBT tools', test_keycheck: 'Key-check Robot', test_health: 'Health + Control Room', test_ops: 'Ops/Backup/Audit' };
  return `<div class="ph"><div><h1>✅ Tests & Quality Assurance</h1><p>हर push पर सारे suites चलते हैं; fail हो तो release नहीं।</p></div><div class="acts"><button class="btn pri" data-act="run" data-wf="tests.yml">▶ अभी सारे tests</button>${t.run_url ? `<a class="btn" href="${esc(t.run_url)}" target="_blank" rel="noopener">पूरा log ›</a>` : ''}</div></div>
  <div class="kpis" style="margin-bottom:12px">${kpi('🧪', suites.length || '—', 'Suites', 'k1')}${kpi('✔️', t.passed, 'Checks पास', 'k2')}${kpi('❌', (t.failed_suites || []).length, 'Fail suites', 'k4', (t.failed_suites || []).length ? 'bad' : '')}${kpi('📊', wf.success_rate != null ? wf.success_rate + '%' : '—', 'सफलता (30 दिन)', 'k5')}${kpi('⏱️', wf.avg_min != null ? wf.avg_min + 'm' : '—', 'औसत समय', 'k3')}${kpi('🕒', ago(t.run_at), 'आख़िरी run', 'k6')}</div>
  <section class="card"><h2>🧪 Suites <small>${t.sha ? 'commit ' + esc(t.sha) : ''}</small></h2>${suites.length ? `<div class="tbl-wrap"><table><thead><tr><th>Suite</th><th>क्या जाँचता है</th><th class="num">Pass</th><th class="num">Fail</th><th>हाल</th></tr></thead><tbody>${suites.map(s => `<tr><td class="mono">${esc(s.suite)}</td><td>${esc(DESC[s.suite] || '')}${s.fails?.length ? `<div class="diag" style="margin-top:6px">${s.fails.map(f => `<span>✕ ${esc(f)}</span>`).join('')}${(s.errors || []).map(f => `<span class="mono">${esc(f)}</span>`).join('')}</div>` : ''}</td><td class="num">${n(s.passed)}</td><td class="num">${n(s.failed)}</td><td>${s.ok ? '<span class="pill ok">✓</span>' : '<span class="pill bad">✕</span>'}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${esc(t.note || t.error || 'अगले Tests run के बाद suite-wise रिपोर्ट दिखेगी')}</div>`}</section>
  <section class="card" style="margin-top:12px"><h2>🕘 History</h2><div class="dots">${(wf.history || []).map(h => `<a class="${esc(h.c)}" href="${esc(h.url)}" target="_blank" rel="noopener" title="${esc(h.c)} · ${when(h.at)}"></a>`).join('')}</div></section>`;
}

/* ---------- database ---------- */
function vDatabase() {
  const sb = S.status.supabase || {}; const db = (S.live.db && !S.live.db.error) ? S.live.db : (sb.db || {});
  const tables = Object.entries(db.tables || {}).sort((a, b) => (b[1].bytes || 0) - (a[1].bytes || 0)); const ex = db.exact || {}; const i = db.integrity || {}; const au = db.auth || {};
  return `<div class="ph"><div><h1>🗄️ Supabase & Database</h1><p>Connection, size, tables, integrity, auth और performance। ${S.live.db && !S.live.db.error ? '<span class="pill ok">live</span>' : '<span class="pill none">Health रिपोर्ट से</span>'}</p></div><div class="acts"><a class="btn" href="${CFG.supabaseDash}" target="_blank" rel="noopener">Supabase Dashboard ›</a></div></div>
  <div class="kpis" style="margin-bottom:12px">${kpi('🔌', sb.ok ? 'ठीक' : 'बंद', 'Connection', 'k2', sb.ok ? '' : 'bad')}${kpi('⚡', sb.ms != null ? sb.ms + ' ms' : '—', 'सवाल पढ़ने का समय', 'k5')}${kpi('💽', bytes(db.db_bytes), 'Database size', 'k1')}${kpi('🔗', db.connections, 'Connections', 'k6')}${kpi('📊', db.perf?.mean_ms != null ? db.perf.mean_ms + ' ms' : '—', 'औसत query', 'k3')}${kpi('🐢', db.perf?.slow, 'धीमी queries', 'k4')}</div>
  <div class="grid"><section class="card s6"><h2>📏 Free plan</h2>${gauge('Database', db.db_bytes || 0, 500 * 1024 ** 2, 'bytes')}<div style="height:10px"></div>${gauge('Storage (images)', db.storage_bytes || 0, 1024 ** 3, 'bytes')}<div style="height:10px"></div>${gauge('Backups (DB के अंदर)', db.backup_bytes || 0, 500 * 1024 ** 2, 'bytes')}
    <h3>Integrity</h3><div class="list">${[['orphan_questions', 'बिना topic वाले सवाल'], ['duplicate_live', 'Duplicate live सवाल'], ['orphan_attempts', 'गायब सवाल के जवाब'], ['bad_answer', 'Answer A–D नहीं'], ['no_explanation_live', 'Live बिना explanation']].map(([k, l]) => `<div class="item ${i[k] ? (k === 'no_explanation_live' ? 'ok' : 'warn') : 'ok'}"><span class="ic">${i[k] ? (k === 'no_explanation_live' ? 'ℹ️' : '⚠️') : '✅'}</span><span class="msg">${l}</span><b class="mono">${n(i[k])}</b></div>`).join('')}</div></section>
  <section class="card s6"><h2>🧱 Tables</h2><div class="tbl-wrap"><table><thead><tr><th>Table</th><th class="num">Rows</th><th class="num">Size</th></tr></thead><tbody>${tables.map(([k, v]) => `<tr><td class="mono">${esc(k)}</td><td class="num">${n(ex[k] ?? (v.rows < 0 ? '—' : v.rows))}</td><td class="num">${bytes(v.bytes)}</td></tr>`).join('') || '<tr><td colspan="3">—</td></tr>'}</tbody></table></div>
    <h3>Auth</h3><div class="row"><span class="pill none">Users ${n(au.users)}</span><span class="pill none">नए (24 घंटे) ${n(au.new_24h)}</span><span class="pill none">Login (24 घंटे) ${n(au.signins_24h)}</span><span class="pill ${au.admins > 1 ? 'warn' : 'ok'}">Admins ${n(au.admins)}</span></div>
    <h3>Migrations</h3><div class="row">${['V1 base + RLS', 'V2 status/solutions', 'V3 source_ref', 'V4 Control Room (ops)'].map(m => `<span class="pill ok">✓ ${m}</span>`).join('')}</div></section></div>`;
}

/* ---------- backup ---------- */
function vBackup() {
  const list = Array.isArray(S.live.backups) ? S.live.backups.map(b => ({ id: b.id, at: b.taken_at, kind: b.kind, note: b.note, questions: b.counts?.questions, students: b.counts?.profiles, size_kb: b.size_kb, verified: b.verify_result, verified_at: b.verified_at })) : (S.status.supabase?.backups || []);
  const keep = settingsMap()['backup.keep'] ?? 14; const last = list[0];
  return `<div class="ph"><div><h1>💾 Backup & Disaster Recovery</h1><p>हर रात 02:37 पूरा snapshot (सवाल + students की progress), checksum + restore test के साथ। आख़िरी ${esc(keep)} रखे जाते हैं।</p></div>
    <div class="acts"><button class="btn pri" data-act="backup-now">💾 अभी backup लो</button><button class="btn" data-act="run" data-wf="backup-robot.yml">🤖 Backup Robot</button></div></div>
  ${!S.admin ? loginLock('Backup लेने, जाँचने और restore के लिए admin login चाहिए।') : ''}
  <div class="kpis" style="margin-bottom:12px">${kpi('🕒', last ? ago(last.at) : 'कभी नहीं', 'आख़िरी backup', 'k2', last ? '' : 'bad')}${kpi('🧪', last?.verified === 'ok' ? 'ठीक ✓' : (last?.verified || 'बाकी'), 'आख़िरी जाँच', 'k5', last?.verified === 'FAILED' ? 'bad' : '')}${kpi('📦', list.length, 'Backups रखे', 'k1')}${kpi('📚', last?.questions, 'सवाल (आख़िरी)', 'k6')}</div>
  <section class="card"><h2>🗃️ Backup history</h2>${list.length ? `<div class="tbl-wrap"><table><thead><tr><th>#</th><th>कब</th><th>तरह</th><th class="num">सवाल</th><th class="num">Students</th><th class="num">Size</th><th>जाँच</th><th></th></tr></thead><tbody>${list.map(b => `<tr><td class="mono">${b.id}</td><td>${when(b.at)}<br><span class="faint">${esc(b.note || '')}</span></td><td>${esc(b.kind)}</td><td class="num">${n(b.questions)}</td><td class="num">${n(b.students)}</td><td class="num">${b.size_kb != null ? n(b.size_kb) + ' KB' : '—'}</td><td>${b.verified === 'ok' ? '<span class="pill ok">✓ ठीक</span>' : b.verified ? '<span class="pill bad">✕</span>' : '<span class="pill none">बाकी</span>'}</td><td class="row"><button class="btn sm" data-act="verify" data-id="${b.id}">🧪 जाँचो</button><button class="btn sm" data-act="restore" data-id="${b.id}">♻️ Restore</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">अभी कोई backup नहीं</div>'}
    <p class="note">♻️ Restore हमेशा पहले एक "pre-restore" backup लेता है। कोई सवाल delete नहीं होता — जो backup में नहीं, वह छिपा दिया जाता है। Students की progress restore Claude करता है (ज़्यादा जोखिम)।</p></section>
  <section class="card" style="margin-top:12px"><h2>🧭 Recovery plan (गड़बड़ी हो तो)</h2><ol style="margin:0;padding-left:20px;display:grid;gap:6px">
    <li><b>🛑 Emergency Stop</b> दबाओ — robots रुकेंगे, data freeze।</li><li>गलत बदलाव पता करो: <b>Audit Log</b> → उस बदलाव पर <b>Undo</b>।</li>
    <li>बहुत सारे सवाल खराब हों: यहाँ से सही <b>backup → Restore</b> (सिर्फ़ कुछ IDs या सारे सवाल)।</li><li>ऐप खराब हो: <b>GitHub & Deploy → Rollback</b> पिछले tests-पास version पर।</li>
    <li><b>🩺 Health जाँच</b> करवाओ; सब हरा हो तो <b>Controlled Resume</b>।</li></ol></section>`;
}

/* ---------- repair ---------- */
function vRepair() {
  const wf = wfList().filter(w => w.last_conclusion === 'failure' || w.diagnosis);
  const bad = (S.status.checks || []).filter(c => c.level !== 'ok');
  const prompt = c => `Control Room में यह दिक्कत है: "${c.msg}". ${c.diagnosis ? 'संभावित वजह: ' + c.diagnosis.cause + '. ' : ''}पहले backup लो, कारण पता करो, ठीक करो, सारे tests चलाओ, फिर report दो।`;
  return `<div class="ph"><div><h1>🧠 Diagnosis & Repair</h1><p>हर गड़बड़ी की संभावित वजह, असर, सुझाव और जोखिम। सुधार हमेशा: backup → बदलाव → tests → approval।</p></div></div>
  ${wf.length ? `<div class="robots" style="margin-bottom:12px">${wf.map(w => `<article class="card rb"><div class="rb-head"><span class="rb-ic">${esc(w.label.split(' ')[0])}</span><span style="flex:1"><b>${esc(w.label.replace(/^\S+\s/, ''))}</b><small>fail ${ago(w.last_failure_at)}</small></span>${pill('failure')}</div>
    ${w.diagnosis ? `<div class="diag"><b>वजह: ${esc(w.diagnosis.cause)}</b><span>सुधार: ${esc(w.diagnosis.fix)}</span><span>जोखिम: ${esc(w.diagnosis.risk)}</span></div>` : ''}${w.error_log ? `<pre class="log">${esc(w.error_log)}</pre>` : ''}
    <div class="row"><button class="btn sm" data-act="retry" data-wf="${esc(w.file)}" data-run="${w.last_id}">↻ Retry</button><button class="btn sm soft" data-copy="${esc(w.diagnosis?.ask_claude || prompt({ msg: w.label + ' fail' }))}">📋 Claude के लिए copy</button><a class="btn sm" href="${esc(w.last_url)}" target="_blank" rel="noopener">Log ›</a></div></article>`).join('')}</div>` : ''}
  <section class="card"><h2>📋 खुली दिक्कतें <small>${bad.length}</small></h2>${bad.length ? `<div class="list">${bad.map(c => `<div class="item ${c.level}"><span class="ic">${ICON[c.level]}</span><span><span class="area">${esc(c.area)}</span><div class="msg">${esc(c.msg)}</div></span><button class="btn sm soft go" data-copy="${esc(prompt(c))}">📋 Copy</button>${c.todo ? `<span class="todo">👉 ${esc(c.todo)}</span>` : ''}</div>`).join('')}</div>` : '<div class="empty">कुछ ठीक करने को नहीं 🎉</div>'}
    <p class="note">📋 Copy → Claude chat में paste करें। Claude हमेशा backup लेकर, tests चलाकर और आपको बताकर ही बदलाव करता है।</p></section>`;
}

/* ---------- students ---------- */
function vStudents() {
  const s = S.status.supabase?.students || {}; const tr = s.trend || []; const sa = Object.entries(s.subject_accuracy_7d || {});
  return `<div class="ph"><div><h1>👥 Student Analytics</h1><p>सिर्फ़ गिनती और औसत — किसी student का नाम, email या जवाब यहाँ नहीं।</p></div></div>
  ${s.error ? `<div class="empty">${esc(s.error)}</div>` : `<div class="kpis" style="margin-bottom:12px">${kpi('👥', s.total, 'कुल students', 'k1')}${kpi('🆕', s.new_7d, '7 दिन में नए', 'k6')}${kpi('🔥', s.active_1d, 'आज active', 'k3')}${kpi('📅', s.active_7d, '7 दिन active', 'k2')}${kpi('✍️', s.answers_7d, '7 दिन जवाब', 'k5')}${kpi('🎯', s.accuracy_7d != null ? s.accuracy_7d + '%' : '—', 'सटीकता (7 दिन)', 'k4')}</div>
  <div class="grid"><section class="card s8"><h2>📈 14 दिन का trend</h2>${lineChart([{ name: 'Active students', color: 'var(--c2)', values: tr.map(d => d.active) }, { name: 'जवाब ÷ 10', color: 'var(--c1)', values: tr.map(d => Math.round(d.answers / 10)) }, { name: 'टेस्ट', color: 'var(--c4)', values: tr.map(d => d.tests) }], tr.map(d => d.day.slice(5)), 180)}</section>
  <section class="card s4"><h2>🎯 Subject-wise सटीकता <small>7 दिन</small></h2>${sa.length ? bars(sa.map(([k, v]) => [pretty(k), v.accuracy, '%']), 'var(--c2)') : '<div class="empty">अभी जवाब नहीं</div>'}
    <h3>जवाब</h3>${sa.length ? bars(sa.map(([k, v]) => [pretty(k), v.answers]), 'var(--c5)') : ''}</section>
  <section class="card s12"><h2>🧾 Tests</h2><div class="row"><span class="pill none">7 दिन में टेस्ट: ${n(s.tests_7d)}</span><span class="pill none">आज जवाब: ${n(s.answers_1d)}</span><span class="pill none">Admins: ${n(s.admins)}</span></div>
    <p class="note">Submission failures: students के phone की errors "Alerts → App errors" में दिखती हैं।</p></section></div>`}`;
}

/* ---------- security ---------- */
function vSecurity() {
  const sec = S.status.security || {}; const anon = Object.entries(sec.anon || {}); const au = (S.live.db?.auth || S.status.supabase?.db?.auth || {});
  return `<div class="ph"><div><h1>🔐 Security & Permissions</h1><p>Secret keys सिर्फ़ GitHub/Supabase के server में। इस page और ऐप में सिर्फ़ publishable key।</p></div></div>
  <div class="kpis" style="margin-bottom:12px">${kpi('🛡️', anon.filter(a => a[1] === 'बंद').length + '/' + anon.length, 'Private tables बंद', 'k2', anon.some(a => a[1] === 'खुला!') ? 'bad' : '')}${kpi('🔑', sec.secrets?.length ? sec.secrets.length + ' मिले' : '0', 'Repo में secrets', 'k4', sec.secrets?.length ? 'bad' : '')}${kpi('👑', au.admins, 'Admins', 'k6', au.admins > 1 ? 'warn' : '')}${kpi('🔓', au.signins_24h, 'Logins (24 घंटे)', 'k5')}</div>
  <div class="grid"><section class="card s6"><h2>🧪 बिना login के जाँच (anon probe)</h2><div class="tbl-wrap"><table><thead><tr><th>Table</th><th>हाल</th></tr></thead><tbody>${anon.map(([t, v]) => `<tr><td class="mono">${esc(t)}</td><td>${v === 'बंद' ? '<span class="pill ok">🔒 बंद</span>' : `<span class="pill bad">${esc(v)}</span>`}</td></tr>`).join('') || '<tr><td colspan="2">—</td></tr>'}</tbody></table></div></section>
  <section class="card s6"><h2>🛡️ Rules</h2><ul class="list">
    <li class="item ${sec.secrets?.length ? 'bad' : 'ok'}"><span class="ic">${sec.secrets?.length ? '🔴' : '✅'}</span><span class="msg">Secret scan: ${sec.secrets?.length ? sec.secrets.map(s => esc(s.file + ' (' + s.kind + ')')).join(', ') : 'repo में कोई secret नहीं'}</span><span></span></li>
    <li class="item ok"><span class="ic">✅</span><span class="msg">हर admin काम server पर दोबारा जाँचा जाता है (RLS + ops_* functions)</span><span></span></li>
    <li class="item ok"><span class="ic">✅</span><span class="msg">Robots सिर्फ़ GitHub secret से; हर बदलाव पर robot का नाम audit में</span><span></span></li>
    <li class="item ok"><span class="ic">✅</span><span class="msg">Public रिपोर्ट में सिर्फ़ गिनती; emails छिपे</span><span></span></li>
    <li class="item warn"><span class="ic">🟡</span><span><div class="msg">Supabase: "Leaked password protection" बंद</div></span><span></span><span class="todo">👉 Supabase → Authentication → Settings में चालू करें (Pro plan वाली सुविधा हो सकती है) <a href="${CFG.supabaseDash}/auth/providers" target="_blank" rel="noopener">खोलो ›</a></span></li>
    <li class="item ok"><span class="ic">ℹ️</span><span class="msg">Failed login की गिनती Supabase Auth logs में (Dashboard → Logs)</span><span></span></li></ul></section></div>`;
}

/* ---------- audit ---------- */
function auditRow(a, compact) {
  const ch = a.changed || {}; const keys = Object.keys(ch).filter(k => k !== 'old');
  const canUndo = S.admin && a.table_name === 'questions' && ['UPDATE', 'INSERT', 'DELETE', 'REVERT'].includes(a.action);
  const diff = a.action === 'UPDATE' || a.action === 'REVERT' ? `<div class="diff" style="margin-top:6px">${keys.slice(0, 6).map(k => `<div class="mono">${esc(k)}</div><div class="old">${esc(JSON.stringify(ch[k]?.[0] ?? null).slice(0, 160))}</div><div class="new">${esc(JSON.stringify(ch[k]?.[1] ?? null).slice(0, 160))}</div>`).join('')}</div>` : '';
  return `<div class="item ${a.action === 'DELETE' ? 'bad' : a.action === 'REVERT' ? 'warn' : 'ok'}" style="margin-bottom:6px"><span class="ic">${{ INSERT: '➕', UPDATE: '✏️', DELETE: '🗑', REVERT: '↩️', NOTE: '📝' }[a.action] || '•'}</span>
    <span><span class="area">${esc(a.table_name || a.table)} · ${esc(a.action)} · #${a.id}</span><div class="msg ${compact ? '' : 'mono'}" style="font-size:12px">${esc(a.row_id || a.row)}</div><span class="faint">${when(a.at)} · ${esc(a.actor || '')}${a.reason ? ' · ' + esc(a.reason) : ''}</span>${diff}${!diff && keys.length && a.action !== 'DELETE' ? `<div class="faint">${esc(keys.join(', '))}</div>` : ''}</span>
    ${canUndo ? `<button class="btn sm go" data-undo="${a.id}">↩ Undo</button>` : '<span></span>'}</div>`;
}
async function loadAudit() {
  if (!S.admin) return;
  const f = S.auditFilter; const p = ['select=*', 'order=id.desc', 'limit=60'];
  if (f === 'robot') p.push('actor=like.*robot*'); else if (f === 'human') p.push('actor=like.*@*');
  else if (['INSERT', 'UPDATE', 'DELETE', 'REVERT'].includes(f)) p.push('action=eq.' + f); else if (f === 'settings') p.push('table_name=eq.ops_settings');
  try { S.live.audit = await api('/rest/v1/ops_audit?' + p.join('&')); } catch (e) { S.live.audit = { error: e.message }; }
  render();
}
function vAudit() {
  const list = Array.isArray(S.live.audit) ? S.live.audit : (S.status.supabase?.audit || []).map(a => ({ ...a, table_name: a.table, row_id: a.row, changed: Object.fromEntries((a.fields || []).map(k => [k, []])) }));
  const F = [['', 'सब'], ['human', '👤 इंसान'], ['robot', '🤖 Robots'], ['UPDATE', '✏️ बदलाव'], ['INSERT', '➕ नए'], ['DELETE', '🗑 Delete'], ['REVERT', '↩️ Undo'], ['settings', '⚙️ Settings']];
  return `<div class="ph"><div><h1>📜 Audit Log & Change History</h1><p>कौन, कब, क्या बदला — पहले/बाद के साथ। सवालों के बदलाव Undo हो सकते हैं।</p></div></div>
  ${!S.admin ? loginLock('पूरा audit (पहले/बाद) और Undo के लिए admin login चाहिए। नीचे सिर्फ़ ताज़ा सार है।') : ''}
  <div class="filters" style="margin-bottom:10px">${F.map(([k, l]) => `<button class="chip ${S.auditFilter === k ? 'on' : ''}" data-af="${k}" ${S.admin ? '' : 'disabled'}>${l}</button>`).join('')}</div>
  <section class="card">${list.error ? `<div class="empty">${esc(list.error)}</div>` : list.length ? list.map(a => auditRow(a)).join('') : '<div class="empty">अभी कुछ दर्ज नहीं</div>'}</section>
  <section class="card" style="margin-top:12px"><h2>📮 Admin requests</h2>${reqTable(Array.isArray(S.live.requests) ? S.live.requests : (S.status.supabase?.requests || []))}</section>`;
}
async function undo(id) {
  if (needAdmin()) return;
  const r = await ask('↩ Undo #' + id, 'यह बदलाव वापस होगा (नया audit entry बनेगा)।', { reason: true });
  if (!r) return;
  try { const m = await rpc('ops_revert', { p_audit_id: id, p_reason: r.reason || null }); toast('✓ ' + m); loadAudit(); } catch (e) { toast(e.message); }
}

/* ---------- usage ---------- */
function vUsage() {
  const u = S.status.usage || {}; const byWf = Object.entries(u.actions_by_workflow || {}).sort((a, b) => b[1] - a[1]);
  return `<div class="ph"><div><h1>📈 Resource Usage & Cost</h1><p>Free plans की सीमा के साथ। 80% पार होते ही alert।</p></div></div>
  <div class="kpis" style="margin-bottom:12px">${kpi('💽', u.db_pct != null ? u.db_pct + '%' : '—', 'DB (500 MB में)', 'k1', u.db_pct > 80 ? 'warn' : '')}${kpi('🖼️', u.storage_pct != null ? u.storage_pct + '%' : '—', 'Storage (1 GB में)', 'k5')}${kpi('⚙️', u.actions_minutes_30d, 'Actions मिनट (30 दिन)', 'k6')}${kpi('🏃', u.actions_runs_30d, 'Runs (30 दिन)', 'k3')}${kpi('🌐', u.api ? u.api.remaining + '/' + u.api.limit : '—', 'GitHub API बाकी', 'k2')}${kpi('₹', '0', 'अनुमानित खर्च/महीना', 'k4')}</div>
  <div class="grid"><section class="card s6"><h2>📏 सीमाएँ</h2>${gauge('Supabase DB', u.db_bytes || 0, 500 * 1024 ** 2, 'bytes')}<div style="height:10px"></div>${gauge('Supabase Storage', u.storage_bytes || 0, 1024 ** 3, 'bytes')}<div style="height:10px"></div>${gauge('Backups', u.backup_bytes || 0, 500 * 1024 ** 2, 'bytes')}
    <p class="note">${esc(u.cost_note || '')}</p></section>
  <section class="card s6"><h2>⚙️ Actions मिनट (workflow-wise)</h2>${byWf.length ? bars(byWf.map(([k, v]) => [k, v, 'm']), 'var(--c6)') : '<div class="empty">—</div>'}
    <h3>DB size (समय के साथ)</h3>${lineChart([{ name: 'DB MB', color: 'var(--c1)', values: S.hist.slice(-40).map(h => h.db_mb) }], S.hist.slice(-40).map(h => when(h.at).split(',')[0]), 120)}</section></div>`;
}

/* ---------- settings ---------- */
const SETTING_UI = [
  ['Robots', [['robot.pyq.enabled', 'bool'], ['robot.hindi.enabled', 'bool'], ['robot.tag.enabled', 'bool'], ['robot.keycheck.enabled', 'bool'], ['robot.backup.enabled', 'bool'], ['robot.health.enabled', 'bool']]],
  ['Approval & Safety', [['robots.paused', 'bool'], ['data.frozen', 'bool'], ['publish.auto', 'lock']]],
  ['Quality thresholds', [['tag.min_prob', 'num', .5, .95, .01], ['tag.min_cv', 'num', .6, .99, .01], ['quality.min_text', 'num', 3, 40, 1], ['keycheck.gemini_limit', 'num', 10, 1000, 10]]],
  ['Backup & Alerts', [['backup.keep', 'num', 3, 60, 1], ['alerts.issue', 'bool']]],
];
function vSettings() {
  const sm = settingsMap();
  return `<div class="ph"><div><h1>⚙️ Policies & Settings</h1><p>Robots इन्हीं नियमों से चलते हैं। हर बदलाव audit में (किसने, कब)।</p></div></div>
  ${!S.admin ? loginLock('Settings बदलने के लिए admin login चाहिए।') : ''}
  <div class="grid">${SETTING_UI.map(([g, items]) => `<section class="card s6"><h2>${esc(g)}</h2><div class="list">${items.map(([k, type, lo, hi, step]) => { const r = settingRow(k); const v = sm[k];
    const meta = `<small>${esc(r.note || '')}${r.updated_at ? ` · ${ago(r.updated_at)}` : ''}${r.updated_by ? ' · ' + esc(r.updated_by) : ''}</small>`;
    if (type === 'bool') return `<div class="sw"><span class="t"><b>${esc(r.label || k)}</b>${meta}</span><button class="toggle" role="switch" aria-checked="${v !== false && v != null ? (v === true) : false}" data-act="flag" data-key="${k}" aria-label="${esc(r.label || k)}" ${S.admin ? '' : 'disabled'}></button></div>`;
    if (type === 'lock') return `<div class="sw"><span class="t"><b>${esc(r.label || k)}</b><small>हमेशा बंद — publish इंसान करता है</small></span><button class="toggle" role="switch" aria-checked="false" disabled aria-label="${esc(k)}"></button></div>`;
    return `<div class="sw"><span class="t"><b>${esc(r.label || k)}</b>${meta}</span><input class="input mono" style="width:96px" type="number" min="${lo}" max="${hi}" step="${step}" value="${esc(v ?? '')}" data-num="${k}" aria-label="${esc(r.label || k)}" ${S.admin ? '' : 'disabled'}></div>`; }).join('')}</div></section>`).join('')}</div>`;
}

/* ---------------------------------------------------------------- shell */
function shell() {
  const groups = [...new Set(SECTIONS.map(s => s.group))]; const bc = badCount();
  const side = groups.map(g => `<div class="nav-group">${esc(g)}</div>` + SECTIONS.filter(s => s.group === g).map(s => `<button class="nav ${S.route === s.id ? 'on' : ''}" data-go="${s.id}" ${S.route === s.id ? 'aria-current="page"' : ''}><span class="ico">${s.ico}</span>${esc(s.label)}${s.id === 'alerts' && bc ? `<span class="cnt">${bc}</span>` : ''}</button>`).join('')).join('');
  const dock = DOCK.map(id => { const s = SECTIONS.find(x => x.id === id) || { id: 'more', ico: '☰', label: 'और' }; const on = id === 'more' ? !DOCK.includes(S.route) : S.route === id;
    return `<button class="${on ? 'on' : ''}" data-go="${id}" aria-label="${esc(s.label)}"><span>${s.ico}</span>${esc(id === 'more' ? 'और' : s.label.split(' ')[0])}${id === 'overview' && bc ? '<i class="dot"></i>' : ''}</button>`; }).join('');
  return { side, dock };
}
function render() {
  const root = document.getElementById('app'); if (!root) return;
  const who = document.getElementById('who'); if (who) { who.className = 'who' + (S.admin ? ' admin' : ''); who.innerHTML = `<i></i>${S.admin ? 'Admin' : (S.email ? 'Admin नहीं' : 'Login')}`; }
  const sub = document.getElementById('sub'); if (sub && S.status) sub.textContent = `${ICON[S.status.overall]} ${ago(S.status.at)} · ${S.status.site?.version || ''}`;
  const { side, dock } = shell();
  document.getElementById('side').innerHTML = side; document.getElementById('dock').innerHTML = dock;
  if (!S.status) { root.innerHTML = S.err ? `<div class="card"><div class="lock" style="background:var(--bad-bg)"><span>⚠️</span><span><b>रिपोर्ट नहीं मिली</b><small>${esc(S.err)} — Health Robot एक बार चलना चाहिए या internet नहीं है।</small></span></div><a class="btn pri" href="${GH}/actions/workflows/health-robot.yml" target="_blank" rel="noopener">🩺 Health Robot चलाओ</a></div>` : '<div class="card"><div class="skel" style="width:60%"></div><div style="height:10px"></div><div class="skel"></div></div>'; return; }
  const V = VIEWS[S.route] || vOverview;
  const age = (Date.now() - new Date(S.status.at)) / 60000;
  const stale = age > 180 ? `<div class="lock" style="background:var(--warn-bg)"><span>⏳</span><span><b>यह रिपोर्ट ${ago(S.status.at)} की है</b><small>पुरानी जानकारी को अभी की हालत न समझें। 🩺 अभी जाँच करवाएँ।</small></span><button class="btn sm" data-act="health-now">🩺 जाँचो</button></div>` : '';
  try { root.innerHTML = stale + V(); } catch (e) { root.innerHTML = `<div class="card"><b>यह हिस्सा नहीं खुला</b><pre class="log">${esc(e.stack || e.message)}</pre></div>`; console.error(e); }
}
const VIEWS = { overview: vOverview, robots: vRobots, emergency: vEmergency, alerts: vAlerts, questions: vQuestions, quality: vQuality, publish: vPublish, deploy: vDeploy, tests: vTests, database: vDatabase, backup: vBackup, repair: vRepair, students: vStudents, security: vSecurity, audit: vAudit, usage: vUsage, settings: vSettings };
const ON_GO = {};
function go(id) {
  if (id === 'more') return openMore();
  S.route = id; S.sel.clear(); try { history.replaceState(null, '', '#' + id); } catch (_) {}
  render(); window.scrollTo({ top: 0 });
  if (id === 'questions' && S.admin && !S.q.rows.length) loadQuestions();
  if (id === 'publish' && S.admin) loadPublishQueue();
  if (id === 'audit' && S.admin) loadAudit();
  if (ON_GO[id]) ON_GO[id]();
}
function openMore() {
  sheet('सारे हिस्से', `<div class="kpis">${SECTIONS.map(s => `<button class="kpi" style="text-align:left;cursor:pointer" data-gox="${s.id}"><span class="ki">${s.ico}</span><small style="margin-top:8px;font-size:12.5px;color:var(--text);font-weight:700">${esc(s.label)}</small></button>`).join('')}</div>`,
    (el, close) => el.querySelectorAll('[data-gox]').forEach(b => b.onclick = () => { close(); go(b.dataset.gox); }));
}
function openLogin() {
  if (S.admin) {
    return sheet('👤 Account', `<p>Login: <b>${esc(S.email)}</b> · <span class="pill ok">Admin</span></p><div class="row"><button class="btn" data-out>Logout</button></div><p class="note">यही login ऐप और Admin Studio में भी चलता है।</p>`,
      (el, close) => { el.querySelector('[data-out]').onclick = () => { Auth.logout(); S.admin = false; S.email = ''; S.live = {}; close(); render(); toast('Logout हो गया'); }; });
  }
  sheet('🔑 Admin login', `<p class="muted" style="margin-top:0">${S.email ? `अभी <b>${esc(S.email)}</b> से login है, पर यह admin नहीं।` : 'Control Room के बटन सिर्फ़ admin के लिए हैं।'}</p>
    <a class="btn pri" style="width:100%;margin-bottom:10px" href="../admin/">G · Admin Studio में Google से login करो, फिर यहाँ लौटो</a>
    <div class="field"><label for="le">या Email</label><input id="le" class="input" type="email" autocomplete="username"></div><div class="field"><label for="lp">Password</label><input id="lp" class="input" type="password" autocomplete="current-password"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn pri" data-in>Login</button></div><p class="note">Password कभी chat में न लिखें। यह सीधे Supabase से बात करता है।</p>`,
  (el, close) => {
    el.querySelector('[data-in]').onclick = async () => {
      try { await Auth.login(el.querySelector('#le').value.trim(), el.querySelector('#lp').value); await checkAdmin(); close(); toast(S.admin ? 'Admin login ✓' : 'Login हुआ पर admin नहीं'); if (S.admin) { await loadLive(); } render(); }
      catch (e) { toast(e.message); }
    };
  });
}

/* ---------------------------------------------------------------- actions */
const EXTRA_ACT = {};
async function act(btn) {
  const a = btn.dataset.act; const wf = btn.dataset.wf;
  if (EXTRA_ACT[a]) { try { return await EXTRA_ACT[a](btn); } catch (e) { return toast(e.message, 4000); } }
  if (a === 'login') return openLogin();
  if (a === 'pub-reload') return loadPublishQueue();
  if (needAdmin()) return;
  try {
    if (a === 'health-now') return request('run', 'health-robot.yml', {}, '🩺 जाँच कतार में — कुछ मिनट में नई रिपोर्ट');
    if (a === 'run') {
      if (wf === 'pyq-robot.yml') return sheet('🤖 PYQ Robot', `<div class="field"><label for="links">SSC JE response-sheet PDF links (एक या कई)</label><textarea id="links" class="input" placeholder="https://..."></textarea></div><label class="row"><input type="checkbox" id="dry"> सिर्फ़ जाँच (server पर कुछ न भेजें)</label><div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn pri" data-go-run>▶ चलाओ</button></div>`,
        (el, close) => el.querySelector('[data-go-run]').onclick = async () => { const l = el.querySelector('#links').value.trim(); if (!/^https:\/\//m.test(l)) return toast('https:// वाला link डालें'); close(); await request('run', wf, { links: l, dry_run: el.querySelector('#dry').checked }); });
      if (wf === 'key-check-robot.yml') return sheet('🔑 Key-check', `<div class="field"><label for="scope">कौन से सवाल</label><select id="scope" class="input"><option value="draft">Draft (नए)</option><option value="published">Published (live)</option><option value="all">सब</option></select></div><label class="row"><input type="checkbox" id="gem"> Gemini से दूसरी राय (free key चाहिए)</label><div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn pri" data-go-run>▶ चलाओ</button></div>`,
        (el, close) => el.querySelector('[data-go-run]').onclick = async () => { close(); await request('run', wf, { scope: el.querySelector('#scope').value, gemini: el.querySelector('#gem').checked }); });
      if (!(await ask('▶ Run', `<b>${esc(wf)}</b> चलाएँ?`))) return;
      return request('run', wf, {});
    }
    if (a === 'retry') { if (!(await ask('↻ Retry', 'पिछली run के fail हिस्से दोबारा चलें?'))) return; return request('run', wf, { retry_run_id: Number(btn.dataset.run) }); }
    if (a === 'cancel') { if (!(await ask('⏹ रोको', `${esc(wf)} की चल रही run रद्द करें?`, { danger: true }))) return; return request('cancel', wf, {}); }
    if (a === 'toggle-robot') { const k = `robot.${btn.dataset.id}.enabled`; const v = settingsMap()[k] !== false; if (btn.dataset.id === 'ops' && v && !(await ask('Ops Robot बंद?', 'बंद करने पर Control Room के Run/Backup बटन काम नहीं करेंगे।', { danger: true }))) return; return setSetting(k, !v, `${btn.dataset.id} robot ${v ? 'बंद' : 'चालू'}`); }
    if (a === 'flag') { const k = btn.dataset.key; const v = settingsMap()[k] === true || (k === 'alerts.issue' && settingsMap()[k] !== false);
      if (!v && ['robots.paused', 'data.frozen'].includes(k) && !(await ask('पक्का?', 'Robots रुक जाएँगे / data नहीं बदलेगा।', { danger: true }))) return; return setSetting(k, !v); }
    if (a === 'pause-all') { const v = settingsMap()['robots.paused'] === true; return setSetting('robots.paused', !v, v ? '▶ Robots फिर चालू' : '⏸ सारे robots रुके'); }
    if (a === 'estop') {
      if (!(await ask('🛑 Emergency Stop', 'सारे robots रुकेंगे, data freeze होगा, और चल रहे robot runs रद्द होंगे। ऐप students के लिए चलता रहेगा।', { word: 'STOP', danger: true, ok: '🛑 रोको' }))) return;
      await setSetting('robots.paused', true); await setSetting('data.frozen', true); await request('cancel', 'all', {}, '🛑 Emergency Stop — runs रद्द करने की request भेजी'); return;
    }
    if (a === 'resume') {
      if (!(await ask('✅ Controlled Resume', 'पहले Health जाँच होगी; फिर robots और data बदलना चालू।'))) return;
      await request('run', 'health-robot.yml', {}, '🩺 Health जाँच शुरू'); await setSetting('data.frozen', false); await setSetting('robots.paused', false, '✅ सब फिर चालू'); return;
    }
    if (a === 'maint' || a === 'maint-save') { const msg = (document.getElementById('mmsg')?.value || '').trim().slice(0, 160); const on = a === 'maint' ? btn.dataset.on === '1' : true; return setSetting('maintenance', { on, message: msg }, on ? '🛠 Maintenance चालू' : 'Maintenance बंद'); }
    if (a === 'pub-all') { const ids = (S.pub.rows || []).filter(q => validate(q).ok).map(q => q.id); return bulkAction('publish', ids); }
    if (a === 'backup-now') {
      const r = await ask('💾 अभी backup', 'पूरा snapshot (सवाल + progress) बनेगा और तुरंत जाँचा जाएगा।'); if (!r) return; toast('⏳ Backup बन रहा है…');
      const b = await rpc('ops_backup_now', { p_kind: 'manual', p_note: 'Control Room से' }); const v = await rpc('ops_backup_verify', { p_id: b.id });
      toast(`💾 Backup #${b.id} · जाँच: ${v}`); S.live.backups = await rpc('ops_backup_list').catch(() => S.live.backups); render(); return;
    }
    if (a === 'verify') { toast('🧪 जाँच…'); const v = await rpc('ops_backup_verify', { p_id: Number(btn.dataset.id) }); toast(`Backup #${btn.dataset.id}: ${v === 'ok' ? '✓ ठीक' : v}`); S.live.backups = await rpc('ops_backup_list').catch(() => S.live.backups); render(); return; }
    if (a === 'restore') {
      const id = Number(btn.dataset.id);
      return sheet('♻️ Restore · backup #' + id, `<p>सिर्फ़ <b>सवाल</b> restore होंगे। पहले अपने-आप एक safety backup बनेगा। कोई सवाल delete नहीं होगा।</p>
        <div class="field"><label for="rids">सिर्फ़ ये IDs (खाली = सारे सवाल)</label><textarea id="rids" class="input" placeholder="Q-..., Q-..."></textarea></div>
        <div class="field"><label for="rw">पक्का करने के लिए लिखें <b class="mono">RESTORE-${id}</b></label><input id="rw" class="input mono" autocomplete="off"></div>
        <div class="row" style="justify-content:flex-end"><button class="btn danger" data-rs disabled>♻️ Restore</button></div>`,
      (el, close) => { const w = el.querySelector('#rw'), b = el.querySelector('[data-rs]'); w.oninput = () => { b.disabled = w.value.trim() !== 'RESTORE-' + id; };
        b.onclick = async () => { const ids = el.querySelector('#rids').value.split(/[\s,]+/).map(x => x.trim()).filter(Boolean); close(); toast('⏳ Restore…');
          try { const r = await rpc('ops_restore_questions', { p_id: id, p_confirm: 'RESTORE-' + id, p_only_ids: ids.length ? ids : null }); toast(`♻️ ${r.restored} सवाल restore · ${r.hidden} छिपे · safety backup #${r.safety_snapshot}`, 5000); S.live.backups = await rpc('ops_backup_list').catch(() => S.live.backups); render(); }
          catch (e) { toast(e.message, 5000); } }; });
    }
    if (a === 'rollback') {
      const ok = await ask('⏪ Rollback', `Live ऐप <b>${esc(btn.dataset.ver)}</b> पर वापस जाएगा (सिर्फ़ tests-पास version)। Students को कुछ मिनट में पुराना version मिलेगा।`, { word: 'ROLLBACK', danger: true, reason: true });
      if (!ok) return; return request('rollback', '', { sha: btn.dataset.sha, reason: ok.reason || 'Control Room' }, '⏪ Rollback कतार में — Ops Robot 10 मिनट में शुरू करेगा');
    }
  } catch (e) { toast(e.message, 4000); }
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-go],[data-act],[data-qf],[data-qpage],[data-bulk],[data-open],[data-pick],[data-undo],[data-af],[data-copy]'); if (!t) return;
  if (t.dataset.go) return go(t.dataset.go);
  if (t.dataset.act) return act(t);
  if (t.dataset.qf) { S.q.filter = t.dataset.qf; S.q.page = 0; S.sel.clear(); return S.admin ? loadQuestions() : openLogin(); }
  if (t.dataset.qpage) { S.q.page = Math.max(0, S.q.page + Number(t.dataset.qpage)); return loadQuestions(); }
  if (t.dataset.bulk) { if (t.dataset.bulk === 'clear') { S.sel.clear(); return render(); } return bulkAction(t.dataset.bulk); }
  if (t.dataset.open) return S.admin ? openQuestion(t.dataset.open) : openLogin();
  if (t.dataset.pick) { const id = t.dataset.pick; S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id); return render(); }
  if (t.dataset.undo) return undo(Number(t.dataset.undo));
  if (t.dataset.af !== undefined) { S.auditFilter = t.dataset.af; return loadAudit(); }
  if (t.dataset.copy) { try { navigator.clipboard.writeText(t.dataset.copy); toast('📋 Copy हो गया — Claude chat में paste करें'); } catch (_) { toast(t.dataset.copy, 6000); } }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'qsubj') { S.q.subject = t.value; S.q.page = 0; loadQuestions(); }
  if (t.id === 'qsrc') { S.q.source = t.value; S.q.page = 0; loadQuestions(); }
  if (t.id === 'qsort') { S.q.sort = t.value; S.q.page = 0; loadQuestions(); }
  if (t.dataset.num) { const v = Number(t.value); if (!isFinite(v) || v < Number(t.min) || v > Number(t.max)) { toast(`${t.min}–${t.max} के बीच`); return render(); } if (S.admin) setSetting(t.dataset.num, v); }
});
let qTimer = null;
document.addEventListener('input', e => { if (e.target.id === 'qsearch') { S.q.text = e.target.value; clearTimeout(qTimer); qTimer = setTimeout(() => { S.q.page = 0; loadQuestions(); }, 400); } });

async function boot() {
  const h = (location.hash || '').slice(1); if (SECTIONS.some(s => s.id === h)) S.route = h;
  document.getElementById('who').onclick = openLogin;
  document.getElementById('refresh').onclick = async () => { toast('🔄 ताज़ा…', 1200); await refresh(true); };
  document.getElementById('theme').onclick = () => { const r = document.documentElement; const dark = matchMedia('(prefers-color-scheme: dark)').matches; const cur = r.dataset.theme || (dark ? 'dark' : 'light'); r.dataset.theme = cur === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('mtb_cr_theme', r.dataset.theme); } catch (_) {} };
  try { const t = localStorage.getItem('mtb_cr_theme'); if (t) document.documentElement.dataset.theme = t; } catch (_) {}
  render();
  await refresh(false);
  setInterval(() => refresh(false), 3 * 60 * 1000);
}
async function refresh(force) {
  try { await loadPublic(force); S.err = ''; } catch (e) { S.err = e.message; }
  await checkAdmin(); if (S.admin) await loadLive();
  render();
  if (S.route === 'questions' && S.admin && !S.q.rows.length) loadQuestions();
  if (S.route === 'publish' && S.admin && !S.pub.rows.length) loadPublishQueue();
  if (S.route === 'audit' && S.admin && !Array.isArray(S.live.audit)) loadAudit();
  if (ON_GO[S.route]) ON_GO[S.route](true);
}
window.CR = { S, render, go, validate, api, rpc, Auth, CFG, toast, sheet, ask, request, setSetting, settingsMap, needAdmin, esc, n, ago, when, bytes, pretty, pill, kpi, bars, gauge, lineChart, loginLock, wfList, SECTIONS, VIEWS, ON_GO, DOCK, CFG, GH, ICON, itemHtml, reqTable, EXTRA_ACT, boot, openLogin, refresh: () => refresh(true), validate };
if (!window.__CR_DEFER_BOOT) setTimeout(boot, 0);
