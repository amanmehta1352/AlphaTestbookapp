/* CBT tools: hide timer, 5-minute alert, rough pad (V3.1) */
var CbtToolsState = { hide: false, warned: false, padOpen: false };
function cbtToggleTimer() {
  CbtToolsState.hide = !CbtToolsState.hide;
  cbtApplyTimerHide();
}
function cbtApplyTimerHide() {
  const t = document.getElementById('testTimerDisplay'); if (!t) return;
  t.parentElement.classList.toggle('timer-hidden', CbtToolsState.hide);
}
function cbtBanner(msg) {
  const v = document.getElementById('cbtViewport'); if (!v) return;
  let b = document.getElementById('cbtBanner');
  if (!b) { b = document.createElement('div'); b.id = 'cbtBanner'; b.className = 'cbt-banner'; b.setAttribute('role', 'alert'); v.appendChild(b); }
  b.textContent = msg; b.hidden = false;
  clearTimeout(cbtBanner._t); cbtBanner._t = setTimeout(() => { b.hidden = true; }, 6000);
}
setInterval(() => {
  const s = (typeof ActiveTestSession !== 'undefined') ? ActiveTestSession : null;
  if (!s || s.sessionStatus !== 'ACTIVE') { CbtToolsState.warned = false; return; }
  cbtApplyTimerHide();
  if (!CbtToolsState.warned && s.durationSeconds > 600 && s.timeRemaining <= 300 && s.timeRemaining > 0) {
    CbtToolsState.warned = true;
    CbtToolsState.hide = false; cbtApplyTimerHide();
    cbtBanner('⏰ सिर्फ़ 5 मिनट बचे हैं · Only 5 minutes left');
  }
}, 1000);
/* rough pad: finger / mouse drawing, cleared on close */
function cbtOpenPad() {
  if (document.getElementById('cbtPad')) return;
  const w = document.createElement('div'); w.id = 'cbtPad'; w.className = 'cbt-pad'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-label', 'Rough pad');
  w.innerHTML = '<div class="cbt-pad-bar"><strong>✏️ Rough pad</strong><span><button type="button" onclick="cbtPadClear()">Clear</button><button type="button" onclick="cbtClosePad()" aria-label="Close rough pad">✕</button></span></div><canvas id="cbtPadCanvas"></canvas>';
  document.body.appendChild(w);
  const c = document.getElementById('cbtPadCanvas'); const r = c.getBoundingClientRect(); c.width = Math.round(r.width); c.height = Math.round(r.height);
  const x = c.getContext('2d'); x.lineWidth = 2.5; x.lineCap = 'round'; x.strokeStyle = getComputedStyle(document.body).color || '#111';
  let down = false;
  const pos = e => { const b = c.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  c.addEventListener('pointerdown', e => { down = true; c.setPointerCapture(e.pointerId); const [px, py] = pos(e); x.beginPath(); x.moveTo(px, py); x.lineTo(px + .1, py); x.stroke(); });
  c.addEventListener('pointermove', e => { if (!down) return; const [px, py] = pos(e); x.lineTo(px, py); x.stroke(); });
  ['pointerup', 'pointercancel'].forEach(n => c.addEventListener(n, () => { down = false; }));
}
function cbtPadClear() { const c = document.getElementById('cbtPadCanvas'); if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height); }
function cbtClosePad() { const w = document.getElementById('cbtPad'); if (w) w.remove(); }
