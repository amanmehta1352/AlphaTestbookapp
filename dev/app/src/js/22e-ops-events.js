/* V3.4 Control Room analytics — loaded after the engines it wraps (navigate, initTestSession, submitTestSession). */
/* ---------- feature-usage events (privacy-safe: event name, screen, time on screen — no content, no answers) ---------- */
const OPS_EV_KEY = 'mtb_ops_events_v1';
var OpsEvents = { page: null, since: Date.now(), busy: false };
function opsTrack(name, page, ms, props) {
  try {
    if (!/^[a-z0-9_.:-]{2,60}$/.test(name)) return;
    const q = JSON.parse(localStorage.getItem(OPS_EV_KEY) || '[]');
    q.push({ at: new Date().toISOString(), name, page: page ? String(page).slice(0, 60) : null, ms: ms != null ? Math.max(0, Math.min(86400000, Math.round(ms))) : null, props: props || null });
    localStorage.setItem(OPS_EV_KEY, JSON.stringify(q.slice(-200)));
  } catch (_) {}
}
async function opsFlushEvents() {
  if (OpsEvents.busy || !cloudOnline() || !ServerState?.session) return 0;
  let q; try { q = JSON.parse(localStorage.getItem(OPS_EV_KEY) || '[]'); } catch (_) { q = []; }
  if (!q.length) return 0;
  OpsEvents.busy = true;
  try {
    await Server.ensureFresh();
    const batch = q.slice(0, 100);
    await Server.req('/rest/v1/ops_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: batch });
    localStorage.setItem(OPS_EV_KEY, JSON.stringify(q.slice(batch.length)));
    return batch.length;
  } catch (_) { return 0; } finally { OpsEvents.busy = false; }
}
function opsViewChange(page) {
  if (OpsEvents.page && OpsEvents.page !== page) opsTrack('view', OpsEvents.page, Date.now() - OpsEvents.since);
  if (OpsEvents.page !== page) { OpsEvents.page = page; OpsEvents.since = Date.now(); }
}
const _opsNavigate = navigate;
navigate = function (page, params) { const r = _opsNavigate(page, params); try { opsViewChange(Route?.page || page); } catch (_) {} return r; };
const _opsInitTest = initTestSession;
initTestSession = function (...a) { const before = ActiveTestSession; const r = _opsInitTest(...a); try { if (ActiveTestSession && ActiveTestSession !== before && ActiveTestSession.sessionStatus === 'ACTIVE') opsTrack('test:start', 'test', null, { n: ActiveTestSession.questions.length }); } catch (_) {} return r; };
const _opsSubmitTest = submitTestSession;
submitTestSession = function (...a) { const s = ActiveTestSession; const r = _opsSubmitTest(...a); try { if (s && s.submissionState === 'COMMITTED') opsTrack('test:submit', 'result', s.sessionStartedAt ? Date.now() - s.sessionStartedAt : null); } catch (_) {} return r; };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { try { opsViewChange('(away)'); } catch (_) {} opsFlushEvents(); } });
setInterval(opsFlushEvents, 5 * 60 * 1000);
const _opsCloudSync2 = cloudSync;
cloudSync = async function (...args) { const r = await _opsCloudSync2(...args); opsFlushEvents(); return r; };
