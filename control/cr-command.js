/* =========================================================================
   Control Room V3.4 — CEO Command Center
   🧠 Command Console (Hindi/English, ASK · PLAN · EXECUTE, follow-ups, evidence)
   📋 Task Manager · 📦 PYQ Imports · 🎨 Design history + Selective Restore · 💰 Finance planner
   + Student feature-usage analytics, roles & permissions, robot calendar.
   Free by design: rules engine in the browser (no paid AI), robots on GitHub Actions, data in Supabase free plan.
   ========================================================================= */
'use strict';
(() => {
const C = window.CR; const S = C.S;
const { esc, n, ago, when, pretty, pill, kpi, bars, lineChart, loginLock, toast, sheet, ask, api, rpc } = C;
const HIST_KEY = 'mtb_cr_console_v1';

/* ---------------------------------------------------------------- helpers */
const st = () => S.status || {};
const sb = () => st().supabase || {};
const q = () => sb().questions || {};
const reportAt = () => st().at;
const fact = (k, v, src, at, verified = true) => ({ k, v, src, at: at || reportAt(), verified });
const SRC = { report: 'Health Robot रिपोर्ट', live: 'Live database', gh: 'GitHub API', calc: 'हिसाब (इस page में)' };
function cronNext(expr, from, count = 1) {
  const f = String(expr || '').trim().split(/\s+/); if (f.length !== 5) return [];
  const m = (field, v, lo, hi) => field.split(',').some(part => { let step = 1, a, b; if (part.includes('/')) { [part, step] = part.split('/'); step = +step; }
    if (part === '*') { a = lo; b = hi; } else if (part.includes('-')) { [a, b] = part.split('-').map(Number); } else { a = b = +part; } return v >= a && v <= b && (v - a) % step === 0; });
  const out = []; let t = new Date(from || Date.now()); t.setUTCSeconds(0, 0); t = new Date(t.getTime() + 60000);
  for (let i = 0; i < 60 * 24 * 8 && out.length < count; i++, t = new Date(t.getTime() + 60000))
    if (m(f[0], t.getUTCMinutes(), 0, 59) && m(f[1], t.getUTCHours(), 0, 23) && m(f[2], t.getUTCDate(), 1, 31) && m(f[3], t.getUTCMonth() + 1, 1, 12) && m(f[4], t.getUTCDay(), 0, 6)) out.push(t.toISOString());
  return out;
}
async function createTask(t) {
  if (C.needAdmin()) return null;
  const id = await rpc('ops_task_create', { p_title: t.title, p_command: t.command || t.title, p_intent: t.intent || 'custom', p_mode: t.mode || 'execute', p_module: t.module || 'ops',
    p_steps: t.steps || [], p_risk: t.risk || 'low', p_priority: t.priority || 3, p_dedupe: t.dedupe || null, p_parent: t.parent || null });
  if (id < 0) { toast(`यही काम पहले से चल रहा है — Task #${-id}`); S.lastTask = -id; return -id; }
  S.lastTask = id; toast(t.mode === 'plan' ? `📝 योजना Task #${id} में सेव (कुछ नहीं बदला)` : t.risk === 'high' ? `✋ Task #${id} आपकी मंज़ूरी का इंतज़ार कर रहा` : `▶ Task #${id} कतार में — Ops Robot करेगा`);
  loadTasks(); return id;
}
async function loadTasks() {
  if (!S.admin) return;
  try { S.live.tasks = await api('/rest/v1/ops_tasks?select=*&order=id.desc&limit=60'); } catch (e) { S.live.tasks = { error: e.message }; }
  if (S.route === 'tasks' || S.route === 'command') C.render();
}

/* ---------------------------------------------------------------- finance math (estimates only) */
const FIN_DEFAULT = { price: 99, conversion: 3, fee_pct: 2, gst_pct: 18, refund_pct: 1, fixed_monthly: 0, ai_per_user: 0, infra_per_user: 0 };
function finAssume() { const s = C.settingsMap()['finance.assumptions']; let local = null; try { local = JSON.parse(localStorage.getItem('mtb_cr_fin') || 'null'); } catch (_) {} return { ...FIN_DEFAULT, ...(s || {}), ...(local || {}) }; }
function finCalc(a, users) {
  const netPer = a.price / (1 + a.gst_pct / 100) * (1 - a.fee_pct / 100) * (1 - a.refund_pct / 100) - a.ai_per_user - a.infra_per_user;
  const paid = Math.round(users * a.conversion / 100);
  const revenue = paid * a.price, net = paid * netPer - a.fixed_monthly - users * 0;
  return { netPer: Math.round(netPer * 100) / 100, paid, revenue, net: Math.round(net), breakEven: netPer > 0 ? Math.ceil(a.fixed_monthly / netPer) : null };
}

/* ---------------------------------------------------------------- intent engine */
const LINK_RE = /https:\/\/[^\s"'<>]+/g;
const WF_ALIASES = [
  [/hindi|हिंदी|हिन्दी|translate|अनुवाद/i, 'hindi-robot.yml', '🌐 Hindi Robot'], [/tag|chapter|टैग|अध्याय/i, 'tag-robot.yml', '🏷️ Tag Robot'],
  [/key.?check|answer key|उत्तर कुंजी|उत्तर जाँच/i, 'key-check-robot.yml', '🔑 Key-check'], [/design audit|डिज़ाइन जाँच|design जाँच|ui audit/i, 'design-audit.yml', '🎨 Design Audit'],
  [/smoke/i, 'smoke.yml', '🔥 Smoke Test'], [/\btests?\b|टेस्ट सूट|परीक्षण/i, 'tests.yml', '✅ Tests'], [/health|सेहत|हेल्थ/i, 'health-robot.yml', '🩺 Health'],
  [/backup robot/i, 'backup-robot.yml', '💾 Backup Robot']];
const has = (t, ...res) => res.some(r => r.test(t));
const INTENTS = [
  { id: 'help', re: [/^(help|मदद|क्या कर सकते|commands?)\b/i, /क्या.*(कर सकते|पूछ सकता)/i], run: () => ({ title: '🧠 मैं क्या कर सकता हूँ', text: 'नीचे लिखे जैसे सवाल/काम हिंदी या English में लिखें। ASK = जानकारी, PLAN = योजना (कुछ नहीं बदलता), EXECUTE = robot से काम (मंज़ूरी के बाद)।', sugg: EXAMPLES.map(e => e[1]) }) },
  { id: 'proof', re: [/प्रमाण|सबूत|proof|evidence/i], run: proofOfLast },
  { id: 'resume', re: [/जहाँ.*रुका|resume|फिर से शुरू|वहीं से/i], run: resumeLast },
  { id: 'retest', re: [/दोबारा.*(टेस्ट|test)|re.?test|फिर से test/i], run: () => planOf('retest', '🔁 दोबारा जाँच: सारे tests + live smoke', [wfStep('tests.yml', '✅ सारे tests'), wfStep('smoke.yml', '🔥 Live smoke test'), wfStep('health-robot.yml', '🩺 Health रिपोर्ट')], 'low', 'testing') },
  { id: 'fix', re: [/^(इसे |ये |यह )?(ठीक|fix|repair|सुधार)/i, /ठीक करो|fix it/i], run: fixLast },
  { id: 'compare', re: [/तुलना|compare|पहले से.*अंतर|difference/i], run: compareRun },
  { id: 'import', re: [LINK_RE], test: t => (t.match(LINK_RE) || []).length > 0, run: importPlan },
  { id: 'estop', re: [/emergency|आपात|सब (रोको|बंद)|stop all|pause all|सारे robot.*(रोको|बंद)/i], run: () => planOf('estop', '🛑 Emergency Stop: robots रोको, data freeze, चल रहे runs रद्द', [setStep('robots.paused', true), setStep('data.frozen', true), { type: 'cancel_runs', target: 'all', label: 'चल रहे robot runs रद्द' }], 'low', 'emergency', 1) },
  { id: 'resume_all', re: [/(controlled )?resume|फिर (से )?चालू|unpause|unfreeze/i], run: () => planOf('resume_all', '✅ Controlled Resume: पहले Health, फिर robots चालू', [wfStep('health-robot.yml', '🩺 Health जाँच'), setStep('data.frozen', false), setStep('robots.paused', false)], 'medium', 'emergency') },
  { id: 'maint', re: [/maintenance|रखरखाव|मेंटेनेंस/i], run: maintPlan },
  { id: 'rollback', re: [/rollback|रोलबैक|पुराने version पर|वापस (ले|जाओ)/i], test: t => !/section|सेक्शन|हिस्सा|design|डिज़ाइन|file/i.test(t), run: rollbackPlan },
  { id: 'restore_design', re: [/(section|सेक्शन|हिस्से?|design|डिज़ाइन|file).*(restore|रिस्टोर|वापस)/i, /(restore|रिस्टोर|वापस).*(section|सेक्शन|हिस्से?|design|डिज़ाइन)/i], run: restoreDesignPlan },
  { id: 'design_audit', re: [/design.*(audit|जाँच|check)|डिज़ाइन.*जाँच|ui.*(audit|check)|overflow|layout.*जाँच/i], run: designAsk },
  { id: 'backup_verify', re: [/backup.*(integrity|जाँच|verify|check|सही)|बैकअप.*जाँच/i], run: backupVerify },
  { id: 'backup_now', re: [/backup (लो|बनाओ|now|ले)|अभी backup|बैकअप (लो|बनाओ)/i], run: () => planOf('backup_now', '💾 अभी पूरा backup + जाँच', [{ type: 'backup', label: 'Backup + checksum + restore test' }], 'low', 'backup', 2) },
  { id: 'publish', re: [/publish|प्रकाशित|पब्लिश|live कर/i], run: publishAsk },
  { id: 'finance', re: [/₹|rs\.?\s?\d|price|pricing|subscription|plan.*(₹|रुपये)|break.?even|revenue|कमाई|मुनाफ़ा|profit|वित्त|finance|खर्च निकल/i], run: financeAsk },
  { id: 'report', re: [/report|रिपोर्ट|operations|आज का (पूरा )?हाल/i], run: opsReport },
  { id: 'failed', re: [/fail|फेल|असफल|error|गड़बड़|खराब/i], test: t => !/ठीक करो|fix/i.test(t), run: failedAsk },
  { id: 'pyq_status', re: [/pyq|import|पेपर|paper/i], run: pyqAsk },
  { id: 'deploy', re: [/deploy|release|version|डिप्लॉय|रिलीज़|क्या बदला|changed/i], run: deployAsk },
  { id: 'quality', re: [/quality|गुणवत्ता|duplicate|डुप्लिकेट|hindi नहीं|बिना hindi|untagged|mixed|बिना chapter|टूटे|broken/i], run: qualityAsk },
  { id: 'run_robot', re: [/(चलाओ|run|start|शुरू करो)/i], test: t => WF_ALIASES.some(([r]) => r.test(t)), run: runRobotPlan },
  { id: 'students', re: [/student|छात्र|विद्यार्थी|user|यूज़र|active|feature|फ़ीचर|usage|इस्तेमाल/i], run: studentsAsk },
  { id: 'security', re: [/security|सुरक्षा|secret|permission|role|अनुमति/i], run: securityAsk },
  { id: 'cost', re: [/cost|लागत|usage|limit|सीमा|storage|database size/i], run: costAsk },
  { id: 'tasks', re: [/task|काम कहाँ|कतार|queue/i], run: tasksAsk },
  { id: 'status', re: [/audit|status|हाल|स्थिति|health|सेहत|सब ठीक|overview|समस्या|problem|issue|गंभीर/i], run: statusAsk },
];
const EXAMPLES = [['🩺', 'पूरे सिस्टम का audit करो'], ['🔥', 'आज की सबसे गंभीर समस्याएँ बताओ'], ['🤖', 'कौन-से Robots फेल हुए हैं?'], ['📦', 'PYQ Import का काम कहाँ तक पहुँचा?'],
  ['🚀', 'पिछले Deployment में क्या बदला?'], ['🔬', 'सवालों की quality बताओ'], ['💾', 'Backup की integrity जाँचो'], ['💰', '₹99 Subscription Plan का संभावित वित्तीय परिणाम निकालो'],
  ['📋', 'आज का पूरा Operations Report तैयार करो'], ['🎨', 'Design audit करो'], ['🌐', 'Hindi robot चलाओ'], ['👥', 'कौन-सा feature कम इस्तेमाल हो रहा है?']];

function classify(text) {
  const t = String(text || '').trim();
  for (const it of INTENTS) { if (it.re.some(r => { r.lastIndex = 0; return r.test(t); }) && (!it.test || it.test(t))) return it; }
  return null;
}
function splitCommands(text) {
  // "X और Y", "X; Y", "X, फिर Y" → several commands, run in order
  const parts = String(text).split(/\s*(?:;|\n|\bफिर\b|\bऔर फिर\b|\bthen\b|\band then\b)\s*/i).map(s => s.trim()).filter(s => s.length > 2);
  return parts.length > 1 && parts.every(p => classify(p)) ? parts : [String(text).trim()];
}

/* ---------- step builders ---------- */
const wfStep = (file, label, inputs) => ({ type: 'workflow', file, label, inputs: inputs || {} });
const setStep = (key, value) => ({ type: 'setting', key, value, label: `${key} = ${JSON.stringify(value)}` });
function planOf(intent, title, steps, risk, module, priority) {
  return { title, plan: { title, intent, steps, risk, module, priority: priority || 3 },
    text: `${steps.length} कदम · जोखिम: ${{ low: 'कम', medium: 'मध्यम', high: 'ज़्यादा (मालिक की मंज़ूरी ज़रूरी)' }[risk]} · पहले योजना, फिर आपकी हाँ पर काम।`,
    facts: [], sugg: ['PLAN = सिर्फ़ योजना सेव (कुछ नहीं बदलेगा)', 'EXECUTE = robots करेंगे; हर कदम का log + प्रमाण Tasks में'] };
}

/* ---------- ASK handlers (facts from real data, with source + time) ---------- */
function statusAsk() {
  const s = st(); const checks = s.checks || []; const bad = checks.filter(c => c.level === 'bad'), warn = checks.filter(c => c.level === 'warn');
  return { title: { ok: '🟢 सब ठीक चल रहा है', warn: '🟡 चल रहा है — कुछ काम बाकी', bad: '🔴 ध्यान दो — कुछ खराब है' }[s.overall] || 'हाल',
    facts: [fact('ऐप', `${s.site?.ok ? 'चालू' : 'बंद'} · ${s.site?.version || '?'} · ${s.site?.ms ?? '—'} ms`, 'live site (HTTP)'),
      fact('Server', `${sb().ok ? 'चालू' : 'बंद'} · ${n(q().live)} सवाल live`, 'Supabase'),
      fact('Robots/Tests', `${(s.github?.workflows || []).filter(w => w.last_conclusion === 'failure').length} fail · ${s.tests?.suites?.length || '—'} suites (${n(s.tests?.passed)} checks)`, SRC.gh),
      fact('Backup', s.supabase?.db?.backups?.last_at ? `${ago(s.supabase.db.backups.last_at)} · ${s.supabase.db.backups.count} रखे` : 'नहीं', 'backup.snapshots'),
      fact('Students', `${n(sb().students?.total)} कुल · ${n(sb().students?.active_7d)} active (7 दिन)`, 'Supabase')],
    items: [...bad, ...warn].slice(0, 8), sugg: bad.length ? ['"इसे ठीक करो" लिखें — मैं सुधार की योजना बनाऊँगा'] : [] };
}
function failedAsk() {
  const wf = (st().github?.workflows || []).filter(w => w.last_conclusion === 'failure');
  const tk = (Array.isArray(S.live.tasks) ? S.live.tasks : (sb().tasks?.recent || [])).filter(t => t.status === 'failed');
  const tests = st().tests?.failed_suites || [];
  S.ctx = { kind: 'failed', wf, tk };
  return { title: wf.length + tk.length + tests.length ? `❌ ${wf.length} robot · ${tk.length} task · ${tests.length} test suite fail` : '✅ अभी कुछ fail नहीं',
    facts: [...wf.map(w => fact(w.label, `fail ${ago(w.last_failure_at || w.last_at)} — ${w.diagnosis?.cause || 'वजह log में'}`, SRC.gh, w.last_at)),
      ...tk.slice(0, 5).map(t => fact(`Task #${t.id}`, `${t.title} — fail`, 'ops_tasks', t.updated_at)), ...tests.map(x => fact('Test suite', x + ' fail', 'test-summary', st().tests?.run_at))],
    items: wf.filter(w => w.diagnosis).map(w => ({ level: 'bad', area: w.label, msg: w.diagnosis.cause, todo: w.diagnosis.fix + ' · जोखिम: ' + w.diagnosis.risk, link: w.last_url })),
    sugg: wf.length || tk.length ? ['"इसे ठीक करो" = fail robots दोबारा चलाने की योजना', 'Tests fail हों तो Repair → "Claude के लिए copy"'] : [] };
}
function pyqAsk() {
  const im = sb().imports || []; const pyqWf = (st().github?.workflows || []).find(w => w.file === 'pyq-robot.yml') || {};
  const pend = (q().draft || 0) + (q().reviewed || 0);
  return { title: '📦 PYQ Import की हालत',
    facts: [fact('आख़िरी PYQ Robot', `${pyqWf.last_conclusion || '—'} · ${ago(pyqWf.last_at)}`, SRC.gh, pyqWf.last_at),
      fact('Import batches (हाल के)', `${im.length}`, 'import_batches'), fact('Publish के इंतज़ार में', `${n(pend)} सवाल`, 'Supabase'),
      fact('Live PYQ', n(q().pyq_live), 'Supabase'), fact('बिना chapter (Mixed)', n(q().untagged_live), 'Supabase'), fact('बिना Hindi', n(q().no_hindi_live), 'Supabase'),
      ...im.slice(0, 4).map(b => fact(b.title || b.id, `${b.report ? `निकाले ${b.report.extracted} · जोड़े ${b.report.added} · छोड़े ${Object.values(b.report.skipped || {}).reduce((a, x) => a + x, 0)}` : `जोड़े ${n(b.added)}`} · अब live ${n(b.now?.live)} / बाकी ${n(b.now?.pending)}`, 'import_batches', b.at))],
    sugg: ['नए paper के लिए: PDF links paste करें — मैं links जाँचकर import की योजना बनाऊँगा', 'Source खोजना (FIND SOURCES) अभी मुफ़्त तरीके से संभव नहीं — links आप दें'], go: 'imports' };
}
function importPlan(text) {
  const links = [...new Set((text.match(LINK_RE) || []).map(u => u.replace(/[),.]+$/, '')))].slice(0, 20);
  const dry = /dry|जाँच भर|सिर्फ़ जाँच|test run/i.test(text);
  const steps = [{ type: 'verify_links', urls: links, label: `${links.length} links जाँचो (PDF? पहले import हुआ?)` },
    { ...wfStep('pyq-robot.yml', dry ? 'Dry run (server पर कुछ नहीं)' : 'सही links import (Draft)', { dry_run: dry }), use_verified: true },
    ...(dry ? [] : [wfStep('hindi-robot.yml', '🌐 Hindi'), wfStep('tag-robot.yml', '🏷️ Chapter tagging'), wfStep('key-check-robot.yml', '🔑 Answer जाँच', { scope: 'draft', gemini: false }), wfStep('health-robot.yml', '🩺 रिपोर्ट')])];
  return planOf('import', `📦 PYQ import: ${links.length} links${dry ? ' (dry run)' : ''}`, steps, 'medium', 'pyq');
}
function deployAsk() {
  const r = st().github?.releases || []; const h = st().design?.history || []; const site = st().site || {}; const sm = st().design?.smoke || {};
  return { title: '🚀 Deployment',
    facts: [fact('Live version', site.version, 'live site'), fact('Code version', site.source_version, 'repo'),
      fact('पिछली release', r[0] ? `${r[0].version || r[0].sha} · ${ago(r[0].at)} · tests ${r[0].tests}` : '—', SRC.gh, r[0]?.at),
      fact('क्या बदला (files)', h[0] ? `${h[0].sections.join(', ')} — ${h[0].files.length} files` : '—', SRC.gh, h[0]?.at),
      fact('Deploy के बाद smoke', sm.ok == null ? (sm.note || 'अभी नहीं चला') : sm.ok ? 'पास' : 'fail', 'smoke artifact', sm.at)],
    sugg: ['"rollback V3.3.0" = उस version पर वापस (मंज़ूरी के साथ)', '"subject hub section restore" = सिर्फ़ एक हिस्सा वापस'], go: 'deploy' };
}
function qualityAsk() {
  const Q = q(); const kc = st().keycheck || {}; const db = sb().db || {};
  S.ctx = { kind: 'quality' };
  return { title: '🔬 सवालों की quality',
    facts: [fact('Live', n(Q.live), 'Supabase'), fact('टूटे (live)', n(Q.broken_live), 'Supabase'), fact('दो options एक जैसे', n(Q.dup_options_live), 'Supabase'),
      fact('Duplicate सवाल', n(db.integrity?.duplicate_live), 'ops_db_stats()'), fact('बिना Hindi', n(Q.no_hindi_live), 'Supabase'), fact('बिना chapter', n(Q.untagged_live), 'Supabase'),
      fact('बिना explanation', n(Q.no_expl_live), 'Supabase'), fact('Answer-key flags', kc.total != null ? `${kc.total} (${Object.entries(kc.by_code || {}).map(([k, v]) => k + ':' + v).join(', ')})` : '—', 'key-check artifact', kc.at)],
    est: ['Hindi = machine translation (IndicTrans2) — human review बाकी', 'Official answer key ही सच है; Gemini/robot सिर्फ़ flag करते हैं'],
    sugg: ['"इसे ठीक करो" = Tag + Hindi + Key-check robots की योजना', 'Question Bank → filter से एक-एक देखें'], go: 'quality' };
}
function publishAsk() {
  const pend = (q().draft || 0) + (q().reviewed || 0);
  return { ...planOf('publish', `🚀 Publish: जाँच पास करने वाले ${n(pend)} में से सवाल live करो`, [{ type: 'publish_passing', label: 'Quality gate पास वाले publish (बाकी रुके रहेंगे)' }, wfStep('health-robot.yml', '🩺 रिपोर्ट')], 'high', 'publish', 2),
    facts: [fact('इंतज़ार में', n(pend), 'Supabase')], est: ['Public publishing = ज़्यादा जोखिम → आपकी मंज़ूरी (Tasks → Approve) के बाद ही'], go: 'publish' };
}
function financeAsk(text) {
  const a = finAssume(); const m = String(text).match(/₹\s?(\d{2,5})|(\d{2,5})\s?(?:रुपये|rs|inr)/i); if (m) a.price = Number(m[1] || m[2]);
  const users = Math.max(sb().students?.total || 0, 1); const cur = finCalc(a, users);
  const sc = [100, 1000, 10000].map(u => [u, finCalc(a, u), finCalc({ ...a, conversion: a.conversion / 2 }, u), finCalc({ ...a, conversion: a.conversion * 2 }, u)]);
  return { title: `💰 ₹${a.price}/महीना plan — अनुमान`, facts: [fact('Students अभी', n(sb().students?.total), 'Supabase'), fact('Paid users अभी', '0 (payments अभी शुरू नहीं)', 'कोई payment data नहीं'), fact('खर्च अभी', '₹0/महीना (free plans)', 'Usage section')],
    est: [`मान्यता: conversion ${a.conversion}% · payment fee ${a.fee_pct}% · GST ${a.gst_pct}% (price में शामिल) · refund ${a.refund_pct}% · fixed खर्च ₹${a.fixed_monthly}/माह`,
      `हर paid student से शुद्ध ≈ ₹${cur.netPer}/माह`, ...sc.map(([u, base, worst, best]) => `${u.toLocaleString('en-IN')} students: base ₹${base.net.toLocaleString('en-IN')} (paid ${base.paid}) · worst ₹${worst.net.toLocaleString('en-IN')} · best ₹${best.net.toLocaleString('en-IN')}/माह`),
      cur.breakEven != null ? `Break-even: ${cur.breakEven} paid students (fixed खर्च ₹${a.fixed_monthly})` : 'Break-even: शुद्ध कमाई ≤ 0'],
    sugg: ['असली conversion data के बिना यह गारंटी नहीं — सिर्फ़ तुलना के लिए', 'Finance section में मान्यताएँ बदलकर ₹49/₹99/₹199/annual तुलना करें'], go: 'finance' };
}
function studentsAsk() {
  const s = sb().students || {}; const u = (S.live.usage && !S.live.usage.error) ? S.live.usage : (sb().usage_stats || {});
  const ev = u.events || {}; const f = u.funnel_test || {};
  const rec = recommendations(u);
  return { title: '👥 Students और features',
    facts: [fact('कुल', n(s.total), 'Supabase'), fact('7 दिन active', n(s.active_7d), 'attempts'), fact('7 दिन जवाब', n(s.answers_7d), 'attempts'), fact('सटीकता (7 दिन)', s.accuracy_7d != null ? s.accuracy_7d + '%' : '—', 'attempts'),
      fact('Test शुरू → जमा', `${n(f.started)} → ${n(f.submitted)}`, 'ops_events'), fact('Inactive (14 दिन)', n(u.inactive_users), 'ops_events + attempts'),
      ...Object.entries(u.pages || {}).sort((a, b) => b[1].views - a[1].views).slice(0, 5).map(([p, v]) => fact('Screen: ' + p, `${v.views} views · ${v.users} students · औसत ${Math.round((v.avg_ms || 0) / 1000)}s`, 'ops_events'))],
    est: Object.keys(ev).length ? [] : ['Feature-usage data V3.4 से इकट्ठा होना शुरू हुआ — कुछ दिन बाद सटीक'], items: rec, go: 'students' };
}
function recommendations(u) {
  const out = []; const f = u.funnel_test || {}; const pages = u.pages || {};
  if (f.started >= 5 && f.submitted / f.started < .6) out.push({ level: 'warn', area: 'Test', msg: `सिर्फ़ ${Math.round(100 * f.submitted / f.started)}% tests जमा हुए`, todo: 'प्रमाण: ops_events test:start/submit · कारण हो सकता है: लंबे tests · माप: submit % बढ़े' });
  const views = Object.values(pages).reduce((a, p) => a + p.views, 0);
  ['revision_hub', 'mistakes', 'me', 'native_builder'].forEach(p => { if (views > 100 && (pages[p]?.views || 0) / views < .01) out.push({ level: 'ok', area: 'Discoverability', msg: `"${p}" बहुत कम खुलता है`, todo: 'हटाने का कारण नहीं — Home पर रास्ता आसान करें, फिर views देखें' }); });
  if ((u.inactive_users || 0) > 0 && (sb().students?.total || 0) > 5 && u.inactive_users / sb().students.total > .5) out.push({ level: 'warn', area: 'Retention', msg: `${u.inactive_users} students 14 दिन से inactive`, todo: 'Daily mini test / याद दिलाना · माप: 7-दिन active बढ़े' });
  return out;
}
function securityAsk() {
  const sec = st().security || {}; const anon = Object.values(sec.anon || {});
  return { title: '🔐 सुरक्षा', facts: [fact('Private tables (बिना login)', `${anon.filter(v => v === 'बंद').length}/${anon.length} बंद`, 'anon probe'), fact('Repo में secrets', sec.secrets?.length ? sec.secrets.map(s => s.file).join(', ') : 'कोई नहीं', 'repo scan'),
    fact('Admins/roles', Object.entries(sb().roles || {}).map(([r, c]) => `${r}: ${c}`).join(' · ') || '—', 'ops_admin_list()')], go: 'security' };
}
function costAsk() {
  const u = st().usage || {};
  return { title: '📈 Usage और खर्च', facts: [fact('Database', `${u.db_pct ?? '—'}% (500 MB free में)`, 'ops_db_stats()'), fact('Storage', `${u.storage_pct ?? '—'}% (1 GB free में)`, 'ops_db_stats()'),
    fact('GitHub Actions (30 दिन)', `${n(u.actions_minutes_30d)} मिनट · public repo = मुफ़्त`, SRC.gh), fact('खर्च', '₹0/महीना', 'free plans')],
    est: ['Bandwidth/API requests का डेटा free plan API नहीं देता — Unknown'], go: 'usage' };
}
function tasksAsk() {
  const ts = Array.isArray(S.live.tasks) ? S.live.tasks : (sb().tasks?.recent || []);
  const c = {}; ts.forEach(t => { c[t.status] = (c[t.status] || 0) + 1; });
  return { title: '📋 Tasks', facts: Object.entries(c).map(([k, v]) => fact(k, v, 'ops_tasks')), items: ts.slice(0, 6).map(t => ({ level: t.status === 'failed' ? 'bad' : t.status === 'waiting_approval' ? 'warn' : 'ok', area: '#' + t.id + ' · ' + t.status, msg: t.title, todo: ago(t.updated_at) })), go: 'tasks' };
}
function designAsk() {
  const a = st().design?.audit || {};
  return { ...planOf('design_audit', '🎨 Design audit (live site, phone/tablet/desktop, light+dark)', [wfStep('design-audit.yml', '🎨 हर screen की जाँच', { target: 'live' }), wfStep('health-robot.yml', '🩺 रिपोर्ट')], 'low', 'design'),
    facts: a.screens ? [fact('पिछला audit', `${a.screens} screens · overflow ${a.overflow?.length || 0} · छोटे बटन ${a.small_taps} · कम contrast ${a.low_contrast} · Hindi font ${a.hindi_font}`, 'design-audit artifact', a.at)] : [fact('पिछला audit', a.note || 'अभी नहीं चला', 'design-audit artifact')], go: 'design' };
}
function backupVerify() {
  const b = sb().db?.backups || {}; const list = sb().backups || [];
  return { ...planOf('backup_verify', '🧪 आख़िरी backup की integrity + restore test', [{ type: 'verify_backup', label: 'Checksum + rebuild test' }], 'low', 'backup', 2),
    facts: [fact('आख़िरी backup', b.last_at ? `${ago(b.last_at)} · #${list[0]?.id ?? '?'} · ${n(list[0]?.questions)} सवाल` : 'नहीं', 'backup.snapshots'), fact('आख़िरी सफल जाँच', b.last_verified ? ago(b.last_verified) : 'नहीं', 'backup.snapshots')],
    est: ['Restore test = JSON से हर table दोबारा बन सकती है (असली database नहीं बदलता)'] };
}
function runRobotPlan(text) {
  const hit = WF_ALIASES.filter(([r]) => r.test(text)); const steps = hit.map(([, f, l]) => wfStep(f, l, f === 'key-check-robot.yml' ? { scope: /live|published/i.test(text) ? 'published' : 'draft', gemini: /gemini/i.test(text) } : f === 'design-audit.yml' ? { target: 'live' } : {}));
  return planOf('run_robot', '▶ ' + hit.map(h => h[2]).join(' + ') + ' चलाओ', steps, 'low', 'robots');
}
function maintPlan(text) {
  const off = /बंद|off|हटाओ|खत्म/i.test(text); const msg = (text.match(/["“](.+?)["”]/) || [])[1] || '';
  return planOf('maint', off ? '🛠 Maintenance बंद' : '🛠 Maintenance चालू' + (msg ? `: "${msg}"` : ''), [setStep('maintenance', { on: !off, message: msg.slice(0, 160) })], 'low', 'emergency');
}
function rollbackPlan(text) {
  const rel = st().github?.releases || []; const v = (text.match(/V\d+\.\d+\.\d+/i) || [])[0];
  const r = v ? rel.find(x => (x.version || '').toUpperCase() === v.toUpperCase()) : rel.find((x, i) => i > 0 && x.tests === 'success');
  if (!r) return { title: '⏪ Rollback', text: v ? `${v} की tests-पास release नहीं मिली` : 'पिछली tests-पास release नहीं मिली', go: 'deploy' };
  return planOf('rollback', `⏪ Live ऐप ${r.version || r.sha} पर वापस`, [{ type: 'backup', label: 'पहले backup' }, wfStep('rollback.yml', `Rollback ${r.sha}`, { sha: r.full }), wfStep('smoke.yml', '🔥 Live smoke test'), wfStep('health-robot.yml', '🩺 रिपोर्ट')], 'high', 'deploy', 1);
}
function restoreDesignPlan(text) {
  const files = st().design?.files || []; const hist = st().design?.history || [];
  const t = text.toLowerCase();
  const pick = files.filter(f => t.includes(f.section.toLowerCase().split(' ')[0]) || t.includes(f.path.split('/').pop().toLowerCase().replace(/\.(js|css)$/, '')));
  const v = (text.match(/V\d+\.\d+\.\d+/i) || [])[0]; const rel = st().github?.releases || [];
  const fromRel = v && rel.find(x => (x.version || '').toUpperCase() === v.toUpperCase());
  const paths = [...new Set(pick.map(f => f.path))].slice(0, 6);
  const older = fromRel || (paths.length ? hist.find((h, i) => i > 0 && !h.files.some(f => paths.includes(f))) || hist[1] : null);
  if (!paths.length || !older) return { title: '🧩 Selective restore', text: 'कौन-सा हिस्सा? Design section में history देखकर "♻️ यह हिस्सा वापस" दबाएँ, या लिखें: "CBT section V3.2.0 पर restore करो"', go: 'design',
    sugg: [...new Set(files.map(f => f.section))].slice(0, 10).map(s => `${s} restore करो`) };
  const branch = 'restore/t' + Date.now().toString(36);
  return planOf('restore_design', `🧩 सिर्फ़ "${[...new Set(pick.map(f => f.section))].join(', ')}" को ${older.version || older.sha} पर वापस`, [wfStep('selective-restore.yml', `Branch ${branch}: files वापस + सारे tests`, { sha: older.full, paths: paths.join(' '), branch, reason: text.slice(0, 150) }),
    { type: 'note', label: `तैयार होने पर Tasks में "Merge को मंज़ूरी" (owner) — तब तक live नहीं बदलेगा`, branch }], 'medium', 'design');
}
function compareRun() {
  const h = S.hist || []; if (h.length < 2) return { title: 'तुलना', text: 'अभी इतिहास कम है' };
  const now = h[h.length - 1], dayAgo = [...h].reverse().find(x => Date.now() - new Date(x.at) > 20 * 3600e3) || h[0];
  const row = (k, l) => fact(l, `${n(dayAgo[k])} → ${n(now[k])} (${(now[k] ?? 0) - (dayAgo[k] ?? 0) >= 0 ? '+' : ''}${(now[k] ?? 0) - (dayAgo[k] ?? 0)})`, 'history.json', now.at);
  return { title: `📊 तुलना: ${when(dayAgo.at)} → ${when(now.at)}`, facts: [row('live', 'Live सवाल'), row('pending', 'Publish बाकी'), row('untagged', 'बिना chapter'), row('students', 'Students'), row('active_7d', '7-दिन active'), row('answers_1d', '1-दिन जवाब'), row('db_mb', 'DB MB'), row('bad', 'लाल checks')] };
}
function opsReport() {
  const s = st(); const lines = [`📋 Operations Report — ${new Date().toLocaleString('hi-IN')}`, `रिपोर्ट का समय: ${when(s.at)} (${ago(s.at)})`, `हाल: ${s.overall}`, ''];
  (s.checks || []).forEach(c => lines.push(`${ICON(c.level)} [${c.area}] ${c.msg}${c.todo ? ' → ' + c.todo : ''}  (स्रोत: ${c.source || '—'})`));
  lines.push('', `सवाल: live ${q().live} · बाकी ${(q().draft || 0) + (q().reviewed || 0)} · छिपे ${q().hidden} · बिना Hindi ${q().no_hindi_live} · बिना chapter ${q().untagged_live}`,
    `Students: ${sb().students?.total} · 7-दिन active ${sb().students?.active_7d} · जवाब ${sb().students?.answers_7d}`,
    `Tests: ${s.tests?.suites?.length || '—'} suites, ${s.tests?.passed || '—'} checks, fail: ${(s.tests?.failed_suites || []).join(', ') || 'कोई नहीं'}`,
    `Backup: ${s.supabase?.db?.backups?.last_at ? ago(s.supabase.db.backups.last_at) : '—'} · Live version ${s.site?.version}`, `खर्च: ₹0 (free plans)`);
  const text = lines.join('\n'); S.lastReport = text;
  return { title: '📋 आज का Operations Report', pre: text, sugg: ['📋 Copy दबाकर कहीं भी भेजें'], copy: text };
}
const ICON = l => ({ ok: '🟢', warn: '🟡', bad: '🔴' }[l] || '•');

/* ---------- follow-ups ---------- */
function proofOfLast() {
  const ts = Array.isArray(S.live.tasks) ? S.live.tasks : []; const t = ts.find(x => x.id === S.lastTask) || ts[0];
  if (!t) return { title: 'प्रमाण', text: 'अभी कोई task नहीं। ऊपर के जवाबों में हर तथ्य के साथ स्रोत और समय लिखा है।' };
  return { title: `🔎 Task #${t.id} का प्रमाण`, facts: (t.steps || []).map((s, i) => fact(`${i + 1}. ${s.label || s.type}`, `${s.status || 'बाकी'}${s.error ? ' — ' + s.error : ''}`, s.url ? 'GitHub run' : 'ops_tasks', s.finished_at || t.updated_at, s.status === 'done')),
    pre: t.report || (t.logs || []).map(l => `${when(l.at)} · ${l.msg}`).join('\n'), links: (t.steps || []).filter(s => s.url).map(s => s.url), task: t.id };
}
function resumeLast() {
  const ts = Array.isArray(S.live.tasks) ? S.live.tasks : []; const t = ts.find(x => x.id === S.lastTask && ['failed', 'paused', 'cancelled'].includes(x.status)) || ts.find(x => ['paused', 'failed'].includes(x.status));
  if (!t) return { title: 'Resume', text: 'कोई रुका/fail task नहीं मिला' };
  return { title: `↻ Task #${t.id} वहीं से`, text: `${t.title} — ${t.status}. जो कदम हो चुके, वो दोबारा नहीं चलेंगे।`, taskAction: { id: t.id, action: t.status === 'paused' ? 'resume' : 'retry' } };
}
function fixLast() {
  const ctx = S.ctx || {}; const s = st();
  if (ctx.kind === 'failed' && ctx.wf?.length) return planOf('fix', '🔧 Fail robots दोबारा चलाओ (वजह अस्थायी हो तो)', ctx.wf.map(w => wfStep(w.file, `↻ ${w.label}`, w.file === 'key-check-robot.yml' ? { scope: 'draft', gemini: false } : {})).concat([wfStep('health-robot.yml', '🩺 जाँच')]), 'low', 'robots');
  const bad = (s.checks || []).filter(c => c.level !== 'ok'); const steps = []; const manual = [];
  bad.forEach(c => {
    if (/Mixed|chapter/.test(c.msg)) steps.push(wfStep('tag-robot.yml', '🏷️ Tag Robot'));
    else if (/Hindi/.test(c.msg)) steps.push(wfStep('hindi-robot.yml', '🌐 Hindi Robot'));
    else if (/backup/i.test(c.msg)) steps.push({ type: 'backup', label: '💾 Backup' });
    else if (/fail/.test(c.msg) && c.id?.startsWith('wf-')) steps.push(wfStep(c.id.slice(3), '↻ ' + c.msg.split(' ')[0]));
    else if (/publish/.test(c.msg)) manual.push('Publish = आपकी मंज़ूरी: "publish करो" लिखें');
    else manual.push(c.msg);
  });
  const uniq = [...new Map(steps.map(x => [x.file || x.type, x])).values()];
  if (!uniq.length) return { title: '🔧 सुधार', text: 'इनका सुधार robot से अपने-आप नहीं होता:', sugg: manual.slice(0, 6), copy: 'Control Room में ये दिक्कतें हैं: ' + manual.join('; ') + '. Backup लेकर, tests चलाकर ठीक करो।' };
  return { ...planOf('fix', '🔧 अपने-आप ठीक होने वाली चीज़ें', [...uniq, wfStep('health-robot.yml', '🩺 जाँच')], 'low', 'repair'), sugg: manual.length ? ['बाकी (हाथ से/Claude): ' + manual.slice(0, 4).join(' · ')] : [] };
}

/* ---------------------------------------------------------------- console UI */
function loadHist() { try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch (_) { return []; } }
function saveHist(h) { try { localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(-30))); } catch (_) {} }
function answerHtml(r, idx) {
  const factRow = f => `<li class="item ok"><span class="ic">📌</span><span><span class="area">${esc(f.k)}</span><div class="msg">${esc(f.v)}</div><span class="faint">स्रोत: ${esc(f.src)} · ${f.at ? ago(f.at) : 'अभी'}${f.verified === false ? ' · <b>जाँचा नहीं</b>' : ' · ✓'}</span></span><span></span></li>`;
  return `<div class="card cmd-ans" style="margin-top:10px"><h2>${esc(r.title || '')}${r.mode ? `<small><span class="pill ${r.mode === 'ASK' ? 'info' : r.mode === 'PLAN' ? 'warn' : 'ok'}">${r.mode}</span></small>` : ''}</h2>
    ${r.text ? `<p class="muted" style="margin-top:0">${esc(r.text)}</p>` : ''}
    ${r.facts?.length ? `<h3>📌 तथ्य (असली data)</h3><ul class="list">${r.facts.map(factRow).join('')}</ul>` : ''}
    ${r.items?.length ? `<h3>🔎 दिक्कतें</h3><ul class="list">${r.items.map(C.itemHtml).join('')}</ul>` : ''}
    ${r.est?.length ? `<h3>≈ अनुमान / सीमाएँ</h3><ul class="list">${r.est.map(e => `<li class="item warn"><span class="ic">≈</span><span class="msg">${esc(e)}</span><span></span></li>`).join('')}</ul>` : ''}
    ${r.plan ? `<h3>🗺️ योजना</h3><ol class="steps">${r.plan.steps.map(s => `<li>${esc(s.label || s.type)}</li>`).join('')}</ol>
      <div class="row" style="margin-top:10px"><button class="btn" data-act="cmd-plan" data-i="${idx}">📝 PLAN सेव</button><button class="btn ${r.plan.risk === 'high' ? 'danger' : 'pri'}" data-act="cmd-exec" data-i="${idx}">${r.plan.risk === 'high' ? '✋ मंज़ूरी के लिए भेजो' : '▶ EXECUTE'}</button></div>` : ''}
    ${r.pre ? `<pre class="log" style="background:var(--surface2);color:var(--text)">${esc(r.pre)}</pre>` : ''}
    ${r.links?.length ? `<div class="row">${r.links.map(l => `<a class="pill info" href="${esc(l)}" target="_blank" rel="noopener">run ›</a>`).join('')}</div>` : ''}
    ${r.taskAction ? `<div class="row"><button class="btn pri" data-act="task-ctl" data-id="${r.taskAction.id}" data-a="${r.taskAction.action}">↻ ${r.taskAction.action === 'resume' ? 'Resume' : 'Retry'} Task #${r.taskAction.id}</button></div>` : ''}
    ${r.sugg?.length ? `<h3>💡 आगे</h3><div class="row">${r.sugg.map(x => `<button class="chip" data-cmd="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : ''}
    <div class="row" style="margin-top:10px">${r.go ? `<button class="btn sm soft" data-go="${r.go}">पूरा section ›</button>` : ''}${r.copy ? `<button class="btn sm" data-copy="${esc(r.copy)}">📋 Copy</button>` : ''}
      <button class="btn sm" data-copy="${esc('Control Room सवाल: ' + (r.q || '') + '\nजवाब: ' + (r.title || '') + '\n' + (r.facts || []).map(f => f.k + ': ' + f.v).join('\n'))}">📋 Claude के लिए</button></div></div>`;
}
function vCommand() {
  const h = loadHist();
  return `<div class="ph"><div><h1>🧠 Command Console</h1><p>हिंदी या English में पूछो या काम बताओ। ASK = जानकारी · PLAN = योजना (कुछ नहीं बदलता) · EXECUTE = robots करेंगे (ज़रूरी हो तो मंज़ूरी)। हर जवाब असली data + स्रोत + समय के साथ।</p></div></div>
  <section class="card cmd-box"><div class="field" style="margin:0"><label for="cmdIn" class="sr">Command</label>
    <textarea id="cmdIn" class="input" rows="2" placeholder="जैसे: कौन-से Robots फेल हुए हैं?  ·  hindi robot चलाओ  ·  ₹99 plan का हिसाब  ·  PDF links paste करो">${esc(S.cmdDraft || '')}</textarea></div>
    <div class="row" style="margin-top:8px"><button class="btn pri" data-act="cmd-go">➤ भेजो</button><span class="faint" style="font-size:12px">Enter = भेजो · Shift+Enter = नई line · ₹0: सब इसी page और free robots से</span></div>
    <div class="filters" style="margin-top:10px">${EXAMPLES.map(([i, e]) => `<button class="chip" data-cmd="${esc(e)}">${i} ${esc(e)}</button>`).join('')}</div></section>
  <div id="cmdOut">${h.slice().reverse().map((x, i) => `<div class="cmd-q"><span>🧑 ${esc(x.q)}</span><small class="faint">${when(x.at)}</small></div>${answerHtml(x.r, h.length - 1 - i)}`).join('')}</div>
  ${h.length ? `<div class="row" style="justify-content:center;margin-top:12px"><button class="btn sm" data-act="cmd-clear">🧹 इतिहास साफ़</button></div>` : ''}`;
}
function runCommand(text) {
  text = String(text || '').trim(); if (!text) return;
  const parts = splitCommands(text); const h = loadHist();
  parts.forEach(p => {
    const it = classify(p);
    let r;
    try { r = it ? it.run(p) : fallback(p); } catch (e) { r = { title: 'यह नहीं हो पाया', text: e.message }; }
    r.q = p; r.intent = it?.id || 'unknown'; r.mode = r.plan ? 'PLAN' : 'ASK';
    h.push({ q: p, at: new Date().toISOString(), r });
  });
  saveHist(h); C.render(); setTimeout(() => document.querySelector('.cmd-q')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}
function fallback(text) {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const secs = C.SECTIONS.filter(s => words.some(w => s.label.toLowerCase().includes(w) || s.id.includes(w)));
  return { title: '🤔 पक्का समझ नहीं आया', text: 'मैं बिना पैसे वाले नियमों से समझता हूँ, इसलिए आसान शब्दों में लिखें। ये मिलते-जुलते हैं:',
    sugg: EXAMPLES.slice(0, 6).map(e => e[1]), items: secs.map(s => ({ level: 'ok', area: 'Section', msg: s.ico + ' ' + s.label, todo: '', link: '#' + s.id })),
    copy: `Control Room में यह command समझ नहीं आया: "${text}". Control Room देखकर करो।` };
}

/* ---------------------------------------------------------------- tasks view */
const TS = { planned: ['none', '📝 योजना'], queued: ['run', '⏳ कतार'], running: ['run', '▶ चल रहा'], waiting_approval: ['warn', '✋ मंज़ूरी'], paused: ['none', '⏸ रुका'], failed: ['bad', '✕ fail'], completed: ['ok', '✓ पूरा'], cancelled: ['none', 'रद्द'] };
const tpill = s => `<span class="pill ${(TS[s] || ['none'])[0]}">${esc((TS[s] || [0, s])[1])}</span>`;
function vTasks() {
  if (!S.admin) return `<div class="ph"><div><h1>📋 Task Manager</h1><p>हर बड़ा काम: ID, कदम, checkpoint, logs, मंज़ूरी, प्रमाण।</p></div></div>${loginLock('Tasks देखने/चलाने के लिए admin login चाहिए।')}${taskSummaryPublic()}`;
  const ts = Array.isArray(S.live.tasks) ? S.live.tasks : []; const f = S.taskFilter || 'all';
  const shown = f === 'all' ? ts : f === 'active' ? ts.filter(t => ['queued', 'running', 'waiting_approval', 'paused'].includes(t.status)) : ts.filter(t => t.status === f);
  const cnt = s => ts.filter(t => t.status === s).length;
  return `<div class="ph"><div><h1>📋 Task Manager</h1><p>हर बड़ा काम यहाँ दर्ज: ID, कदम, checkpoint, logs, मंज़ूरी, प्रमाण। Ops Robot कदम-दर-कदम चलाता है — बीच में रुके तो वहीं से।</p></div><div class="acts"><button class="btn" data-act="tasks-reload">🔄</button><button class="btn soft" data-go="command">🧠 नया command</button></div></div>
  ${ts.error ? `<div class="empty">${esc(ts.error)}</div>` : ''}
  <div class="kpis" style="margin-bottom:12px">${C.kpi('▶', cnt('running') + cnt('queued'), 'चल रहे / कतार', 'k1')}${C.kpi('✋', cnt('waiting_approval'), 'मंज़ूरी बाकी', 'k3', cnt('waiting_approval') ? 'warn' : '')}${C.kpi('✓', cnt('completed'), 'पूरे', 'k2')}${C.kpi('✕', cnt('failed'), 'Fail', 'k4', cnt('failed') ? 'bad' : '')}${C.kpi('📝', cnt('planned'), 'सिर्फ़ योजना', 'k6')}${C.kpi('⏸', cnt('paused'), 'रुके', 'k5')}</div>
  <div class="filters" style="margin-bottom:10px">${[['all', 'सब'], ['active', 'Active'], ['waiting_approval', '✋ मंज़ूरी'], ['failed', '✕ Fail'], ['completed', '✓ पूरे'], ['planned', '📝 योजना']].map(([k, l]) => `<button class="chip ${f === k ? 'on' : ''}" data-tf="${k}">${l}</button>`).join('')}</div>
  <div class="list">${shown.map(t => { const done = (t.steps || []).filter(s => ['done', 'skipped'].includes(s.status)).length;
    return `<button class="item ${t.status === 'failed' ? 'bad' : t.status === 'waiting_approval' ? 'warn' : 'ok'}" style="text-align:left;cursor:pointer;width:100%" data-task="${t.id}"><span class="ic">#${t.id}</span>
      <span><span class="area">${esc(t.module || '')} · जोखिम ${esc(t.risk)} · ${ago(t.updated_at)}</span><div class="msg">${esc(t.title)}</div>
      <span class="track" style="display:block;height:6px;border-radius:9px;background:var(--border);margin-top:6px;overflow:hidden"><i style="display:block;height:100%;width:${(t.steps || []).length ? Math.round(100 * done / t.steps.length) : 0}%;background:var(--ok)"></i></span>
      <span class="faint">${done}/${(t.steps || []).length} कदम${t.retry_count ? ` · retry ${t.retry_count}` : ''}</span></span>${tpill(t.status)}</button>`; }).join('') || '<div class="empty">कोई task नहीं — Command Console से शुरू करें</div>'}</div>`;
}
function taskSummaryPublic() {
  const t = sb().tasks || {}; const bs = t.by_status || {};
  return `<div class="kpis">${Object.entries(bs).map(([k, v]) => C.kpi('•', v, k, 'k1')).join('') || '<div class="empty">अभी कोई task नहीं</div>'}</div>`;
}
function openTask(id) {
  const t = (Array.isArray(S.live.tasks) ? S.live.tasks : []).find(x => x.id === id); if (!t) return;
  S.lastTask = id;
  const can = { approve: ['waiting_approval', 'planned'], reject: ['waiting_approval', 'planned'], pause: ['queued', 'running'], resume: ['paused'], cancel: ['queued', 'running', 'waiting_approval', 'paused', 'planned'], retry: ['failed', 'cancelled'] };
  const L = { approve: '✅ मंज़ूरी दो', reject: '✕ नामंज़ूर', pause: '⏸ Pause', resume: '▶ Resume', cancel: '⏹ Cancel', retry: '↻ Retry' };
  const restoreDone = t.intent === 'restore_design' && t.status === 'completed';
  const branch = (t.steps || []).find(s => s.inputs?.branch || s.branch); const br = branch?.inputs?.branch || branch?.branch;
  sheet(`Task #${t.id}`, `<div class="row" style="margin-bottom:8px">${tpill(t.status)}<span class="pill none">जोखिम ${esc(t.risk)}</span><span class="pill none">${esc(t.mode)}</span><span class="pill none">${esc(t.module || '')}</span></div>
    <p style="font-weight:800;margin:0">${esc(t.title)}</p><p class="faint" style="margin:4px 0 10px">Command: ${esc(t.command || '')} · बनाया ${when(t.created_at)} (${esc(t.created_by || '')})</p>
    <h3>कदम</h3><ol class="steps">${(t.steps || []).map((s, i) => `<li class="${esc(s.status || '')}"><b>${esc(s.label || s.type)}</b> — ${esc(s.status || 'बाकी')}${s.error ? ` <span class="pill bad">${esc(s.error)}</span>` : ''}${s.url ? ` <a href="${esc(s.url)}" target="_blank" rel="noopener">run ›</a>` : ''}${s.result ? `<br><span class="faint mono" style="font-size:11px">${esc(JSON.stringify(s.result).slice(0, 220))}</span>` : ''}</li>`).join('')}</ol>
    ${t.approval ? `<p class="note">✅ मंज़ूरी: ${esc(t.approval.by)} · ${when(t.approval.at)}</p>` : ''}
    ${t.verification ? `<p class="note">🔎 जाँच: सारे कदम ${t.verification.all_steps_done ? 'पूरे ✓' : 'पूरे नहीं ✕'} · प्रमाण ${(t.verification.evidence || []).length} runs</p>` : ''}
    ${t.report ? `<h3>Final report</h3><pre class="log" style="background:var(--surface2);color:var(--text)">${esc(t.report)}</pre>` : ''}
    <h3>Log</h3><div class="faint" style="font-size:12px;display:grid;gap:3px">${(t.logs || []).slice(-15).reverse().map(l => `<span>${when(l.at)} · ${esc(l.msg)} <i>(${esc(l.by || '')})</i></span>`).join('')}</div>
    <div class="row" style="margin-top:12px">${Object.keys(can).filter(a => can[a].includes(t.status)).map(a => `<button class="btn sm ${a === 'approve' ? 'pri' : a === 'cancel' || a === 'reject' ? '' : 'soft'}" data-tc="${a}">${L[a]}</button>`).join('')}
      ${restoreDone && br ? `<button class="btn sm danger" data-merge="${esc(br)}">🧩 Merge को मंज़ूरी (live बदलेगा)</button>` : ''}
      <button class="btn sm" data-copy="${esc(t.report || t.title)}">📋 Copy</button></div>`,
  (el, close) => {
    el.querySelectorAll('[data-tc]').forEach(b => b.onclick = async () => { const a = b.dataset.tc;
      const ok = await ask(L[a], `Task #${t.id}: ${esc(t.title)}`, { reason: true, danger: ['cancel', 'reject'].includes(a) || (a === 'approve' && t.risk === 'high') }); if (!ok) return;
      try { const ns = await rpc('ops_task_control', { p_id: t.id, p_action: a, p_note: ok.reason || null }); toast(`Task #${t.id}: ${ns}`); close(); loadTasks(); } catch (e) { toast(e.message, 4000); } });
    const m = el.querySelector('[data-merge]'); if (m) m.onclick = async () => { close();
      await createTask({ title: `🧩 Merge ${br} → live`, command: 'merge selective restore', intent: 'merge_restore', module: 'design', risk: 'high', priority: 1, parent: t.id,
        steps: [{ type: 'backup', label: 'पहले backup' }, { type: 'merge_branch', branch: br, label: `Merge ${br}` }, wfStep('smoke.yml', '🔥 Live smoke test'), wfStep('design-audit.yml', '🎨 Design audit', { target: 'live' }), wfStep('health-robot.yml', '🩺 रिपोर्ट')] }); };
  });
}

/* ---------------------------------------------------------------- imports view */
function vImports() {
  const im = sb().imports || []; const src = sb().sources || []; const pyq = (st().github?.workflows || []).find(w => w.file === 'pyq-robot.yml') || {};
  return `<div class="ph"><div><h1>📦 PYQ Import Control</h1><p>Links दो → जाँच → Import (Draft) → Hindi → Chapter → Answer जाँच → रिपोर्ट। हर batch का पूरा हिसाब।</p></div></div>
  <section class="card"><h2>📤 PDF फ़ाइल upload <small>अगर link काम न करे (साइट 403 दे)</small></h2>
    <p class="note" style="margin:0 0 8px">फ़ोन पर PDF डाउनलोड करो → यहाँ चुनो → Robot उसे इंपोर्ट करेगा। फ़ाइल सिर्फ़ admin देख/भेज सकता है, 20 MB तक।</p>
    <input id="impFile" type="file" accept="application/pdf" class="input" style="padding:10px">
    <div class="row" style="margin-top:8px"><button class="btn" data-act="imp-upload" data-dry="1">🧪 Upload + Dry run</button><button class="btn pri" data-act="imp-upload" data-dry="0">▶ Upload + Import</button></div></section>
  <section class="card"><h2>➕ नए papers <small>SSC JE response-sheet PDF links</small></h2>
    <textarea id="impLinks" class="input" rows="3" placeholder="https://… (एक line में एक link)">${esc(S.impDraft || '')}</textarea>
    <div class="row" style="margin-top:8px"><button class="btn" data-act="imp-plan" data-dry="1">🧪 Dry run (कुछ नहीं बदलेगा)</button><button class="btn pri" data-act="imp-plan" data-dry="0">▶ जाँचकर Import करो</button></div>
    <p class="note">FIND SOURCES: मुफ़्त search API नहीं है, इसलिए links आप दें। OCR (scan वाले papers): अभी नहीं — ऐसे papers "fail" में साफ़ दिखेंगे। Import हमेशा Draft में; publish आपकी मंज़ूरी से।</p></section>
  <div class="kpis" style="margin:12px 0">${C.kpi('🤖', pyq.last_conclusion || '—', 'आख़िरी PYQ run', 'k1', pyq.last_conclusion === 'failure' ? 'bad' : '')}${C.kpi('📦', im.length, 'हाल के batches', 'k6')}${C.kpi('🚀', (q().draft || 0) + (q().reviewed || 0), 'Publish बाकी', 'k3')}${C.kpi('📚', q().pyq_live, 'Live PYQ', 'k2')}</div>
  <section class="card"><h2>🧾 Batch reconciliation</h2>${im.length ? `<div class="tbl-wrap"><table><thead><tr><th>Paper</th><th class="num">निकाले</th><th class="num">पहले से</th><th class="num">जोड़े</th><th class="num">छोड़े</th><th class="num">Live</th><th class="num">बाकी</th><th class="num">छिपे</th><th class="num">बिना Hindi</th><th class="num">Mixed</th><th class="num">टूटे</th></tr></thead><tbody>
    ${im.map(b => { const r = b.report || {}; const sk = Object.entries(r.skipped || {}); const w = b.now || {};
      return `<tr><td>${esc(b.title || b.id)}<br><span class="faint">${when(b.at)}${b.url ? ` · <a href="${esc(b.url)}" target="_blank" rel="noopener">PDF</a>` : ''}</span></td><td class="num">${n(r.extracted)}</td><td class="num">${n(r.already_on_server)}</td><td class="num">${n(b.added)}</td><td class="num" title="${esc(sk.map(([k, v]) => k + ': ' + v).join(', '))}">${n(sk.reduce((a, [, v]) => a + v, 0) || (r.extracted != null ? 0 : null))}</td><td class="num">${n(w.live || 0)}</td><td class="num">${n(w.pending || 0)}</td><td class="num">${n(w.hidden || 0)}</td><td class="num">${n(w.no_hindi || 0)}</td><td class="num">${n(w.untagged || 0)}</td><td class="num">${n(w.broken || 0)}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">अभी कोई batch नहीं</div>'}
    <p class="note">"छोड़े" = figure/चित्र वाले या टूटे text वाले सवाल (हिसाब में दिखते हैं, चुपचाप नहीं छूटते)। पुराने batches (V3.4 से पहले) में "निकाले/छोड़े" दर्ज नहीं।</p></section>
  <section class="card" style="margin-top:12px"><h2>📚 Source-wise</h2><div class="tbl-wrap"><table><thead><tr><th>Source</th><th class="num">कुल</th><th class="num">Live</th><th class="num">बाकी</th><th class="num">छिपे</th><th class="num">बिना Hindi</th></tr></thead><tbody>${src.slice(0, 40).map(x => `<tr><td>${esc(x.source)}</td><td class="num">${n(x.total)}</td><td class="num">${n(x.live || 0)}</td><td class="num">${n(x.pending || 0)}</td><td class="num">${n(x.hidden || 0)}</td><td class="num">${n(x.no_hindi || 0)}</td></tr>`).join('') || '<tr><td colspan="6">—</td></tr>'}</tbody></table></div></section>`;
}

/* ---------------------------------------------------------------- design view */
function vDesign() {
  const d = st().design || {}; const a = d.audit || {}; const sm = d.smoke || {}; const hist = d.history || []; const files = d.files || [];
  const bySec = {}; files.forEach(f => { (bySec[f.section] = bySec[f.section] || []).push(f.path); });
  return `<div class="ph"><div><h1>🎨 Design History & Selective Restore</h1><p>हर design बदलाव का इतिहास; खराब हुआ हिस्सा ही वापस — बाकी नए बदलाव सुरक्षित। पहले branch पर सारे tests, फिर आपकी मंज़ूरी से live।</p></div>
    <div class="acts"><button class="btn pri" data-act="run" data-wf="design-audit.yml">🎨 Design audit</button><button class="btn" data-act="run" data-wf="smoke.yml">🔥 Smoke test</button></div></div>
  <div class="kpis" style="margin-bottom:12px">${C.kpi('🖥️', a.screens ?? '—', 'Screens जाँचे', 'k1')}${C.kpi('↔️', a.overflow ? a.overflow.length : '—', 'Sideways scroll', 'k4', a.overflow?.length ? 'bad' : '')}${C.kpi('👆', a.small_taps ?? '—', 'छोटे बटन (<40px)', 'k3', a.small_taps ? 'warn' : '')}${C.kpi('🌗', a.low_contrast ?? '—', 'कम contrast', 'k6', a.low_contrast ? 'warn' : '')}${C.kpi('अ', (a.hindi_font || []).join(',') || '—', 'Hindi font', 'k2')}${C.kpi('🔥', sm.ok == null ? '—' : sm.ok ? 'पास' : 'fail', 'Smoke (live)', 'k5', sm.ok === false ? 'bad' : '')}</div>
  <div class="grid"><section class="card s6"><h2>🔍 सबसे कमज़ोर screens <small>${a.at ? ago(a.at) : (a.note || '')}</small></h2>${(a.worst || []).length ? `<div class="tbl-wrap"><table><thead><tr><th>Screen</th><th>Size</th><th class="num">छोटे</th><th class="num">contrast</th><th>नमूना</th></tr></thead><tbody>${a.worst.map(w => `<tr><td>${esc(w.route)}${w.overflow ? ' <span class="pill bad">↔</span>' : ''}</td><td>${esc(w.size)}/${esc(w.theme)}</td><td class="num">${w.small}</td><td class="num">${w.lowc}</td><td class="faint" style="font-size:11px">${esc((w.samples || []).join(' · ').slice(0, 90))}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${esc(a.note || a.error || 'अभी audit नहीं')}</div>`}
    ${a.url ? `<p class="note"><a href="${esc(a.url)}" target="_blank" rel="noopener">Screenshots + पूरी रिपोर्ट ›</a> · Robot सिर्फ़ रिपोर्ट करता है, design नहीं बदलता।</p>` : ''}</section>
  <section class="card s6"><h2>🔥 Deploy के बाद smoke</h2>${sm.checks ? `<ul class="list">${sm.checks.map(c => `<li class="item ${c.ok ? 'ok' : 'bad'}"><span class="ic">${c.ok ? '✅' : '❌'}</span><span><div class="msg">${esc(c.name)}</div><span class="faint">${esc(c.detail)}</span></span><span></span></li>`).join('')}</ul>` : `<div class="empty">${esc(sm.note || 'अभी नहीं चला')}</div>`}</section>
  <section class="card s12"><h2>🕘 Design version history <small>हर बदलाव में कौन-से हिस्से बदले</small></h2>${hist.length ? `<div class="list">${hist.map((h, i) => `<div class="item ok"><span class="ic mono" style="font-size:11px">${esc(h.sha)}</span><span><span class="area">${when(h.at)}</span><div class="msg">${esc(h.msg)}</div>
      <div class="row" style="margin-top:6px">${h.sections.map(s => `<span class="pill info">${esc(s)}</span>`).join('')}</div><span class="faint" style="font-size:11px">${esc(h.files.join(', ').slice(0, 220))}</span></span>
      ${i > 0 ? `<button class="btn sm go" data-act="sel-restore" data-sha="${esc(h.full)}" data-ver="${esc(h.sha)}">♻️ हिस्सा वापस</button>` : '<span class="pill ok">अभी</span>'}</div>`).join('')}</div>` : '<div class="empty">इतिहास अगली Health रिपोर्ट में</div>'}</section>
  <section class="card s12"><h2>🧩 Sections और उनकी files</h2><div class="list">${Object.entries(bySec).map(([sec, fs]) => `<div class="item ok"><span class="ic">🧩</span><span><div class="msg">${esc(sec)}</div><span class="faint mono" style="font-size:11px">${esc(fs.join(', '))}</span></span><span></span></div>`).join('')}</div></section></div>`;
}
function selRestoreDialog(sha, ver) {
  const files = st().design?.files || []; const bySec = {}; files.forEach(f => { (bySec[f.section] = bySec[f.section] || []).push(f.path); });
  sheet('♻️ Selective restore · ' + ver, `<p class="muted" style="margin-top:0">सिर्फ़ चुने हुए हिस्से <b>${esc(ver)}</b> वाले version पर जाएँगे; बाकी सब नया रहेगा। पहले अलग branch पर सारे tests चलेंगे — live तभी बदलेगा जब आप Tasks में "Merge" को मंज़ूरी देंगे।</p>
    <div class="list">${Object.entries(bySec).map(([sec, fs]) => `<label class="sw" style="cursor:pointer"><input type="checkbox" data-sec="${esc(fs.join(' '))}" style="width:22px;height:22px"><span class="t"><b>${esc(sec)}</b><small class="mono">${esc(fs.join(', '))}</small></span></label>`).join('')}</div>
    <div class="field" style="margin-top:10px"><label for="rsWhy">क्यों (audit में)</label><input id="rsWhy" class="input" placeholder="जैसे: नया CBT header टूट गया"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn pri" data-go-rs>🗺️ योजना बनाओ</button></div>`,
  (el, close) => el.querySelector('[data-go-rs]').onclick = async () => {
    const paths = [...el.querySelectorAll('[data-sec]:checked')].flatMap(x => x.dataset.sec.split(' ')).filter(Boolean);
    if (!paths.length) return toast('कम से कम एक हिस्सा चुनें'); close();
    const branch = 'restore/t' + Date.now().toString(36);
    await createTask({ title: `🧩 ${paths.length} files ${ver} पर वापस (branch + tests)`, command: `selective restore ${ver}: ${paths.join(' ')}`, intent: 'restore_design', module: 'design', risk: 'medium',
      steps: [wfStep('selective-restore.yml', `Branch ${branch}: files वापस + सारे tests`, { sha, paths: paths.join(' '), branch, reason: el.querySelector('#rsWhy').value.slice(0, 150) }), { type: 'note', branch, label: 'तैयार — Merge के लिए owner की मंज़ूरी चाहिए' }] });
    C.go('tasks');
  });
}

/* ---------------------------------------------------------------- finance view */
function vFinance() {
  const a = finAssume(); const s = sb().students || {}; const users = s.total || 0;
  const plans = [['₹49/माह', { ...a, price: 49 }], ['₹99/माह', { ...a, price: 99 }], ['₹199/माह', { ...a, price: 199 }], ['₹999/साल (≈₹83/माह)', { ...a, price: 999 / 12 }]];
  const base = [users || 1, 1000, 10000];
  const F = (k, l, step = 1) => `<div class="field"><label for="fa-${k}">${l}</label><input id="fa-${k}" class="input mono" type="number" step="${step}" value="${esc(a[k])}" data-fin="${k}"></div>`;
  return `<div class="ph"><div><h1>💰 Financial Intelligence</h1><p>असली आँकड़े और अनुमान अलग-अलग। बिना असली conversion data के कोई कमाई पक्की नहीं।</p></div></div>
  <div class="kpis" style="margin-bottom:12px">${C.kpi('👥', s.total, 'Registered (असली)', 'k1')}${C.kpi('🔥', s.active_7d, '7-दिन active (असली)', 'k2')}${C.kpi('🆕', s.new_7d, '7-दिन नए (असली)', 'k6')}${C.kpi('💳', '0', 'Paid users (असली)', 'k3')}${C.kpi('₹', '0', 'Revenue (असली)', 'k5')}${C.kpi('🧾', '₹0', 'खर्च/माह (असली)', 'k4')}</div>
  <div class="grid"><section class="card s4"><h2>⚙️ मान्यताएँ <small>≈ अनुमान</small></h2>${F('price', 'Price ₹/माह')}${F('conversion', 'Conversion % (free→paid)', .1)}${F('fee_pct', 'Payment fee %', .1)}${F('gst_pct', 'GST % (price में शामिल)')}${F('refund_pct', 'Refund %', .1)}${F('fixed_monthly', 'Fixed खर्च ₹/माह')}${F('ai_per_user', 'AI/API ₹ प्रति paid user', .01)}${F('infra_per_user', 'Hosting ₹ प्रति paid user', .01)}
    <div class="row"><button class="btn pri" data-act="fin-save">💾 सेव</button><button class="btn" data-act="fin-reset">↺ default</button></div>
    <p class="note">आगे के खर्च के उदाहरण (अनुमान, दाम बदल सकते हैं): Supabase Pro ≈ $25/माह · payment gateway fee ≈ 2% · GitHub Actions public repo = मुफ़्त।</p></section>
  <section class="card s8"><h2>📊 Plan तुलना <small>base / worst (½ conversion) / best (2× conversion) · ₹ प्रति माह</small></h2><div class="tbl-wrap"><table><thead><tr><th>Plan</th><th class="num">शुद्ध/paid user</th>${base.map(u => `<th class="num">${u.toLocaleString('en-IN')} users</th>`).join('')}<th class="num">Break-even</th></tr></thead><tbody>
    ${plans.map(([l, p]) => { const c1 = finCalc(p, 1); return `<tr><td><b>${esc(l)}</b></td><td class="num">₹${c1.netPer}</td>${base.map(u => { const b = finCalc(p, u), w = finCalc({ ...p, conversion: p.conversion / 2 }, u), be = finCalc({ ...p, conversion: p.conversion * 2 }, u);
      return `<td class="num">₹${b.net.toLocaleString('en-IN')}<br><span class="faint" style="font-size:11px">${w.net.toLocaleString('en-IN')} … ${be.net.toLocaleString('en-IN')} · paid ${b.paid}</span></td>`; }).join('')}<td class="num">${c1.breakEven != null ? c1.breakEven + ' paid' : '—'}</td></tr>`; }).join('')}</tbody></table></div>
    <p class="note">शुद्ध/paid user = price ÷ (1+GST) × (1−fee) × (1−refund) − AI − hosting। Break-even = fixed खर्च ÷ शुद्ध/paid user। ये सिर्फ़ तुलना के लिए हैं; payments शुरू होने पर असली आँकड़े यहीं जुड़ेंगे।</p></section>
  <section class="card s12"><h2>🧭 Decision support</h2><ul class="list">
    <li class="item ok"><span class="ic">💡</span><span class="msg">अभी खर्च ₹0 है — free tier में रहते हुए पहले users बढ़ाएँ; paid plan तब, जब 7-दिन active लगातार बढ़ें।</span><span></span></li>
    <li class="item ok"><span class="ic">💡</span><span class="msg">AI खर्च शून्य रखने के लिए: IndicTrans2 + rules + Gemini free tier; paid AI सिर्फ़ ज़रूरत पर।</span><span></span></li>
    <li class="item warn"><span class="ic">≈</span><span class="msg">Annual plan से cash-flow बेहतर दिखता है, पर refund/churn data के बिना फ़ायदा पक्का नहीं।</span><span></span></li></ul></section></div>`;
}

/* ---------------------------------------------------------------- student analytics + roles (extend existing views) */
const baseStudents = C.VIEWS.students;
C.VIEWS.students = () => {
  const u = (S.live.usage && !S.live.usage.error) ? S.live.usage : (sb().usage_stats || {}); const pages = Object.entries(u.pages || {}).sort((a, b) => b[1].views - a[1].views);
  const ev = Object.entries(u.events || {}).sort((a, b) => b[1].count - a[1].count); const f = u.funnel_test || {}; const rec = recommendations(u);
  return baseStudents() + `<div class="grid" style="margin-top:12px"><section class="card s6"><h2>🧭 Feature usage <small>${u.days || 14} दिन · aggregate</small></h2>${pages.length ? bars(pages.slice(0, 10).map(([p, v]) => [p, v.views, ` · ${v.users}👤`]), 'var(--c1)') : '<div class="empty">V3.4 से events आने शुरू होंगे</div>'}
    <h3>Events</h3>${ev.length ? bars(ev.slice(0, 8).map(([k, v]) => [k, v.count]), 'var(--c6)') : ''}</section>
  <section class="card s6"><h2>🪜 Funnel + cohorts</h2><div class="list"><div class="item ok"><span class="ic">🧪</span><span class="msg">Test शुरू ${n(f.started)} → जमा ${n(f.submitted)} → result saved ${n(f.results)}</span><b class="mono">${f.started ? Math.round(100 * f.submitted / f.started) + '%' : '—'}</b></div>
    <div class="item ok"><span class="ic">🆕</span><span class="msg">नए users ${n(u.cohorts?.new_users)} · लौटने वाले ${n(u.cohorts?.returning_users)}</span><span></span></div><div class="item ${u.inactive_users ? 'warn' : 'ok'}"><span class="ic">💤</span><span class="msg">14 दिन से inactive: ${n(u.inactive_users)}</span><span></span></div></div>
    <h3>सुझाव (प्रमाण के साथ)</h3>${rec.length ? `<ul class="list">${rec.map(C.itemHtml).join('')}</ul>` : '<div class="empty">अभी पर्याप्त data नहीं — कम इस्तेमाल को हटाने का आधार नहीं माना जाता</div>'}
    <p class="note">सिर्फ़ screen-time से पसंद/नापसंद तय नहीं करते। हर सुझाव में प्रमाण और मापने का तरीका।</p></section></div>`;
};
const baseSecurity = C.VIEWS.security;
C.VIEWS.security = () => {
  const admins = Array.isArray(S.live.admins) ? S.live.admins : null; const R = sb().roles || {};
  const M = [['read', 'देखना'], ['plan', 'योजना'], ['run', 'Robots/tasks'], ['edit', 'सवाल बदलना'], ['publish', 'Publish'], ['settings', 'Settings'], ['restore', 'Restore/Rollback'], ['roles', 'Roles']];
  const P = { owner: M.map(m => m[0]), admin: ['read', 'plan', 'run', 'edit', 'publish', 'settings'], operator: ['read', 'plan', 'run'], readonly: ['read'] };
  return baseSecurity() + `<div class="grid" style="margin-top:12px"><section class="card s6"><h2>👑 Roles <small>server पर लागू (RLS + functions)</small></h2>
    ${admins ? `<div class="list">${admins.map(a => `<div class="item ok"><span class="ic">👤</span><span><div class="msg">${esc(a.email)}</div><span class="faint">${when(a.added_at)}</span></span><span class="pill info">${esc(a.role)}</span></div>`).join('')}</div>
      <div class="row" style="margin-top:10px"><input id="roleEmail" class="input" style="flex:1;min-width:180px" placeholder="email (पहले ऐप में login हो चुका)"><select id="roleSel" class="input" style="width:auto"><option>readonly</option><option>operator</option><option>admin</option><option>owner</option></select><button class="btn pri" data-act="role-set">सेव</button></div>
      <p class="note">सिर्फ़ owner roles बदल सकता है; आख़िरी owner हटाया नहीं जा सकता। हर बदलाव audit में।</p>` : `<div class="row">${Object.entries(R).map(([k, v]) => `<span class="pill info">${esc(k)}: ${v}</span>`).join('') || '—'}</div>${!S.admin ? '<p class="note">नाम देखने के लिए admin login</p>' : ''}`}</section>
  <section class="card s6"><h2>🔑 Permission matrix</h2><div class="tbl-wrap"><table><thead><tr><th>Role</th>${M.map(m => `<th>${m[1]}</th>`).join('')}</tr></thead><tbody>${Object.entries(P).map(([r, ps]) => `<tr><td><b>${r}</b></td>${M.map(m => `<td>${ps.includes(m[0]) ? '✅' : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section></div>`;
};
// robot calendar on the robots page
const baseRobots = C.VIEWS.robots;
C.VIEWS.robots = () => {
  const wf = C.wfList(); const ev = [];
  wf.forEach(w => (w.cron || []).forEach(c => cronNext(c, Date.now(), w.file === 'ops-robot.yml' ? 3 : 8).forEach(t => ev.push({ t, w }))));
  ev.sort((a, b) => a.t.localeCompare(b.t));
  const days = {}; ev.filter(e => new Date(e.t) - Date.now() < 7 * 864e5).forEach(e => { const d = new Date(e.t).toLocaleDateString('hi-IN', { weekday: 'short', day: 'numeric', month: 'short' }); (days[d] = days[d] || []).push(e); });
  const qd = sb().queue || {};
  return `<section class="card" style="margin-bottom:12px"><h2>🗓️ Schedule calendar (7 दिन) <small>Queue: ${n(qd.queued)} · औसत इंतज़ार ${qd.avg_wait_min ?? '—'} मिनट</small></h2>
    <div class="cal">${Object.entries(days).slice(0, 7).map(([d, es]) => `<div class="cal-day"><b>${esc(d)}</b>${es.slice(0, 14).map(e => `<span title="${esc(e.w.label)}">${new Date(e.t).toLocaleTimeString('hi-IN', { hour: '2-digit', minute: '2-digit' })} ${esc(e.w.label.split(' ')[0])}</span>`).join('')}${es.length > 14 ? `<span class="faint">+${es.length - 14}</span>` : ''}</div>`).join('') || '<div class="empty">कोई schedule नहीं</div>'}</div>
    <p class="note">Ops Robot हर 10 मिनट (GitHub कभी-कभी देर करता है; Health Robot भी कतार चलाता है)। Retry policy: health/backup/key-check/tests fail होने पर 1 बार अपने-आप दोबारा (Settings में बदलें)। Duplicate commands रोके जाते हैं।</p></section>` + baseRobots();
};

/* ---------------------------------------------------------------- register sections + actions */
C.SECTIONS.unshift({ id: 'command', ico: '🧠', label: 'Command Console', group: 'मुख्य' });
C.SECTIONS.splice(2, 0, { id: 'tasks', ico: '📋', label: 'Task Manager', group: 'मुख्य' });
C.SECTIONS.splice(C.SECTIONS.findIndex(s => s.id === 'publish') + 1, 0, { id: 'imports', ico: '📦', label: 'PYQ Imports', group: 'सवाल' });
C.SECTIONS.splice(C.SECTIONS.findIndex(s => s.id === 'deploy') + 1, 0, { id: 'design', ico: '🎨', label: 'Design + Restore', group: 'सिस्टम' });
C.SECTIONS.splice(C.SECTIONS.findIndex(s => s.id === 'usage') + 1, 0, { id: 'finance', ico: '💰', label: 'Finance', group: 'Insights' });
Object.assign(C.VIEWS, { command: vCommand, tasks: vTasks, imports: vImports, design: vDesign, finance: vFinance });
C.ON_GO.tasks = () => loadTasks();
C.ON_GO.command = () => { if (S.admin && !Array.isArray(S.live.tasks)) loadTasks(); };
C.ON_GO.students = async () => { if (S.admin) { try { S.live.usage = await rpc('ops_usage_stats', { p_days: 14 }); } catch (e) { S.live.usage = { error: e.message }; } C.render(); } };
C.ON_GO.security = async () => { if (S.admin) { try { S.live.admins = await rpc('ops_admin_list'); } catch (e) { S.live.admins = null; } C.render(); } };

Object.assign(C.EXTRA_ACT, {
  'cmd-go': () => { const el = document.getElementById('cmdIn'); const v = el.value; S.cmdDraft = ''; el.value = ''; runCommand(v); },
  'cmd-clear': () => { saveHist([]); C.render(); },
  'cmd-plan': b => execPlan(Number(b.dataset.i), 'plan'),
  'cmd-exec': b => execPlan(Number(b.dataset.i), 'execute'),
  'tasks-reload': () => loadTasks(),
  'task-ctl': async b => { const ns = await rpc('ops_task_control', { p_id: Number(b.dataset.id), p_action: b.dataset.a, p_note: 'Command Console' }); toast(`Task #${b.dataset.id}: ${ns}`); loadTasks(); },
  'imp-plan': b => { const t = document.getElementById('impLinks').value; if (!(t.match(LINK_RE) || []).length) return toast('https:// वाले PDF links डालें'); S.impDraft = ''; C.go('command'); runCommand(t + (b.dataset.dry === '1' ? ' dry run' : '')); },
  'imp-upload': async b => {
    const f = document.getElementById('impFile')?.files?.[0]; if (!f) return toast('पहले PDF चुनें');
    if (!/\.pdf$/i.test(f.name) || f.type !== 'application/pdf') return toast('सिर्फ़ PDF फ़ाइल चुनें');
    if (f.size > 20 * 1024 * 1024) return toast('फ़ाइल 20 MB से बड़ी है');
    const dry = b.dataset.dry === '1';
    if (!(await ask(dry ? '🧪 Upload + Dry run' : '▶ Upload + Import', `<b>${esc(f.name)}</b> (${Math.round(f.size / 1024)} KB)<br>${dry ? 'सिर्फ़ जाँच — server पर सवाल नहीं जाएँगे।' : 'सवाल Draft में आएँगे; publish आपकी मंज़ूरी से।'}`))) return;
    const s = await C.Auth.fresh(); if (!s) return toast('पहले login करें');
    const name = Date.now() + '-' + f.name.replace(/[^\w.-]/g, '_').slice(-80);
    toast('📤 अपलोड हो रहा है…', 2500);
    const r = await fetch(C.CFG.sb.url + '/storage/v1/object/pyq-uploads/' + encodeURIComponent(name), { method: 'POST', headers: { apikey: C.CFG.sb.key, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/pdf', 'x-upsert': 'false' }, body: f });
    if (!r.ok) return toast('Upload नहीं हुआ: ' + (await r.text()).slice(0, 120), 5000);
    const id = await createTask({ title: `📦 PYQ ${dry ? 'dry run' : 'import'}: ${f.name}`, command: 'upload ' + f.name, intent: 'import', module: 'pyq', risk: 'medium',
      steps: [{ type: 'upload_link', object: name, label: 'Upload का सुरक्षित link बनाओ (1 घंटा)' }, { ...wfStep('pyq-robot.yml', dry ? 'Dry run (server पर कुछ नहीं)' : 'Import (Draft)', { dry_run: dry }), use_verified: true },
        ...(dry ? [] : [wfStep('hindi-robot.yml', '🌐 Hindi'), wfStep('tag-robot.yml', '🏷️ Chapter'), wfStep('key-check-robot.yml', '🔑 Answer जाँच', { scope: 'draft', gemini: false }), wfStep('health-robot.yml', '🩺 रिपोर्ट')])] });
    if (id) { f.value = ''; C.go('tasks'); }
  },
  'sel-restore': b => { if (C.needAdmin()) return; selRestoreDialog(b.dataset.sha, b.dataset.ver); },
  'fin-save': async () => { const a = finAssume(); document.querySelectorAll('[data-fin]').forEach(i => { const v = Number(i.value); if (isFinite(v) && v >= 0) a[i.dataset.fin] = v; });
    try { localStorage.setItem('mtb_cr_fin', JSON.stringify(a)); } catch (_) {}
    if (S.admin) { try { await C.setSetting('finance.assumptions', a, 'मान्यताएँ सेव (server)'); return; } catch (_) {} } toast('मान्यताएँ सेव (इस phone में)'); C.render(); },
  'fin-reset': () => { try { localStorage.removeItem('mtb_cr_fin'); } catch (_) {} C.render(); },
  'role-set': async () => { const e = document.getElementById('roleEmail').value.trim(), r = document.getElementById('roleSel').value; if (!e) return toast('email डालें');
    if (!(await ask('Role बदलें', `${esc(e)} → <b>${esc(r)}</b>`, { danger: r === 'owner' }))) return; const m = await rpc('ops_set_role', { p_email: e, p_role: r }); toast('✓ ' + m); S.live.admins = await rpc('ops_admin_list'); C.render(); },
});
async function execPlan(i, mode) {
  const h = loadHist(); const it = h[i]; if (!it?.r?.plan) return; const p = it.r.plan;
  if (mode === 'execute' && p.risk !== 'high' && !(await ask('▶ EXECUTE', `<b>${esc(p.title)}</b><br>${p.steps.length} कदम robots करेंगे। हर कदम Tasks में दिखेगा।`))) return;
  const id = await createTask({ title: p.title, command: it.q, intent: p.intent, mode, module: p.module, steps: p.steps, risk: p.risk, priority: p.priority, dedupe: mode === 'execute' ? p.intent + ':' + JSON.stringify(p.steps).length : null });
  if (id) { it.r.task = id; saveHist(h); }
}
document.addEventListener('click', e => {
  const c = e.target.closest('[data-cmd]'); if (c) { C.go('command'); runCommand(c.dataset.cmd); return; }
  const t = e.target.closest('[data-task]'); if (t) return openTask(Number(t.dataset.task));
  const tf = e.target.closest('[data-tf]'); if (tf) { S.taskFilter = tf.dataset.tf; C.render(); }
});
document.addEventListener('input', e => { if (e.target.id === 'cmdIn') S.cmdDraft = e.target.value; if (e.target.id === 'impLinks') S.impDraft = e.target.value; });
document.addEventListener('keydown', e => { if (e.target.id === 'cmdIn' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); C.EXTRA_ACT['cmd-go'](); } });
window.CRX = { classify, runCommand, finCalc, cronNext, INTENTS, createTask, loadTasks };
C.boot();
})();
