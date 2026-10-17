/* =========================================================================
   V3.3 Control Room link (student app side)
   - Maintenance banner: reads the public setting `maintenance` (ops_settings, anon-readable) and shows a
     calm banner on top of every screen. The app keeps working.
   - App error reports: JavaScript errors of a logged-in user go to ops_client_errors (max 5 per session,
     same message once; the server also limits 30/hour/user). Never blocks or breaks the app.
   ========================================================================= */
const OPS_MAINT_KEY = 'mtb_ops_maintenance_v1';
var OpsClient = { maint: null, sent: new Set(), count: 0 };
try { OpsClient.maint = JSON.parse(localStorage.getItem(OPS_MAINT_KEY) || 'null'); } catch (_) {}
function opsApplyMaintenance(v) {
  OpsClient.maint = v && v.on ? { on: true, message: String(v.message || '').slice(0, 160) } : null;
  try { if (OpsClient.maint) localStorage.setItem(OPS_MAINT_KEY, JSON.stringify(OpsClient.maint)); else localStorage.removeItem(OPS_MAINT_KEY); } catch (_) {}
  opsMaintenanceBanner();
}
function opsMaintenanceBanner() {
  const v = document.getElementById('mainView'); if (!v) return;
  let b = document.getElementById('opsMaintBanner');
  if (!OpsClient.maint || Route?.page === 'test') { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('div'); b.id = 'opsMaintBanner'; b.className = 'ops-maint'; b.setAttribute('role', 'status'); }
  b.innerHTML = `<span aria-hidden="true">🛠️</span><span><b>${tx('Maintenance', 'सुधार का काम चल रहा है')}</b><small>${escapeHtml(OpsClient.maint.message || tx('The app works; new questions may appear a little later.', 'ऐप चलता रहेगा; नए सवाल थोड़ी देर में आएँगे।'))}</small></span>`;
  if (v.firstChild !== b) v.prepend(b);
}
async function opsFetchMaintenance() {
  if (!cloudOnline()) return;
  try {
    const r = await fetch(ServerConfig.url + '/rest/v1/ops_settings?select=value&key=eq.maintenance', { headers: { apikey: ServerConfig.key } });
    if (!r.ok) return; const d = await r.json(); opsApplyMaintenance(d && d[0] ? d[0].value : null);
  } catch (_) {}
}
async function opsReportError(message, stack) {
  try {
    const msg = String(message || '').slice(0, 500); if (!msg || OpsClient.sent.has(msg) || OpsClient.count >= 5) return false;
    if (!cloudOnline() || !ServerState?.session) return false;
    OpsClient.sent.add(msg); OpsClient.count++;
    await Server.ensureFresh();
    await Server.req('/rest/v1/ops_client_errors', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: [{ message: msg, stack: String(stack || '').slice(0, 2000), page: String(Route?.page || '').slice(0, 80), app_version: (document.querySelector('meta[name="app-version"]')?.content || '').slice(0, 40) }] });
    return true;
  } catch (_) { return false; }
}
window.addEventListener('error', e => { opsReportError(e.message || 'error', e.error && e.error.stack); });
window.addEventListener('unhandledrejection', e => { const r = e.reason; opsReportError('Unhandled: ' + (r && r.message || String(r)), r && r.stack); });
const _opsRenderView = renderView;
renderView = function () { _opsRenderView(); try { opsMaintenanceBanner(); } catch (_) {} };
const _opsCloudSync = cloudSync;
cloudSync = async function (...args) { const r = await _opsCloudSync(...args); opsFetchMaintenance(); return r; };
setTimeout(opsFetchMaintenance, 1500);

