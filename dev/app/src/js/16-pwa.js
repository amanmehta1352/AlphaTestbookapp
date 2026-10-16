/* =========================================================================
   V2.6.1 — installable app (PWA): offline shell + "Install app" button
   ========================================================================= */
var InstallPrompt = null;
function pwaPaintInstall() {
  const btn = document.getElementById('drwInstall');
  const installed = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  if (btn) btn.hidden = !InstallPrompt || installed;
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); InstallPrompt = e; pwaPaintInstall(); });
window.addEventListener('appinstalled', () => { InstallPrompt = null; pwaPaintInstall(); try { openCustomToast('✅ ऐप install हो गया — home screen पर TestBook icon देखें।'); } catch (_) {} });
async function pwaInstall() {
  closeDrawer();
  if (!InstallPrompt) { openCustomToast('Chrome menu (⋮) में "Install app" / "Add to Home screen" दबाएँ।'); return; }
  InstallPrompt.prompt();
  try { await InstallPrompt.userChoice; } catch (_) {}
  InstallPrompt = null; pwaPaintInstall();
}
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(e => console.warn('[PWA] service worker not registered', e)); });
}