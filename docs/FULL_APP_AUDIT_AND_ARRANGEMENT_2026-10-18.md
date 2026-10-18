# Full App Audit & Rearrangement — Baseline
**Date:** 2026-10-18  
**Repository:** `amanmehta1352/AlphaTestbookapp`  
**Baseline main SHA:** `2d002b799c2314e6c284de722cf4a8969643b646`  
**Status:** Source-level baseline completed; live browser/backend verification still required. This is not a “full audit passed” claim.

## 1. Non-negotiable safety boundary
- The root `index.html` and `admin/index.html` are generated release artifacts. Edit source only in `dev/app/src/`, then rebuild with `dev/app/build.py`.
- Keep the existing vanilla HTML/CSS/JS architecture. No framework migration.
- Do not change canonical question data, question IDs, Question Store, ImportEngine, renderer, router contracts, local/server storage, authentication, RLS, DB schema, PWA caching, or publish rules as part of visual rearrangement.
- Keep the existing five-tab student bottom navigation (Home, Subjects, PYQ, Test, Revision) unless measured evidence demonstrates a blocker; preserve every route and working action.
- Keep Control Room Command Console, Task Manager, PYQ Imports, Design Restore, Finance, Security/Roles, authentication, backup/restore, rollback and audit logs intact.
- No destructive data cleanup, schema changes, auto-publishing, fake metrics, or silent behavior changes.
- Keep UI work separate from PYQ/data robot branches.

## 2. Source inventory reviewed
- Live student release: root `index.html` (generated; do not hand-edit).
- Source build: `dev/app/manifest.json`, `dev/app/build.py`, `dev/app/src/html/`, `dev/app/src/css/`, `dev/app/src/js/`.
- Admin Studio release/source shares the same app code with studio boot mode.
- Control Room is a separate surface under `control/`.
- Tests: `dev/tests/run_all.sh` and test suites; GitHub Actions includes Tests, Smoke Test, Design Audit, health and data robots.
- Existing visual audit: `dev/tools/design-audit/audit.py`; it tests 9 student routes at 360, 412, 768 and 1280 px in light/dark for horizontal overflow, small tap targets, sampled contrast, overlap, Hindi font and page errors. It is report-only; it does not prove all task flows, backend authorization, data visibility, keyboard/screen-reader behavior or offline recovery.

## 3. Evidence-based source findings
### P1 — Navigation hierarchy is overloaded
The student header has menu, back, profile, Question Bank and display/theme shortcuts. The drawer contains study journeys plus import, cleanup, server/admin, backup/restore, data reset and control-room tools. This gives students and administrators one mixed navigation surface and increases accidental-action risk. **Fix:** reorganize labels and groups without removing routes/actions; role-gate administrative actions as currently intended; add confirmation and clear consequences to destructive actions.

### P1 — Question Bank entry is duplicated
Question Bank is reachable from the header and drawer. Duplication may be useful for quick access, but labels, active state and route behavior must be consistent. **Fix:** keep one clear primary shortcut and one drawer entry; verify both route to the same page/state and don't create separate sources of truth.

### P1 — User-visible question state must be explicit
Admin Studio source describes the lifecycle Draft → Reviewed → Published and says students see Published only. This is an important product contract, not a bug by itself. **Fix:** audit counts and visibility by status; show clear empty-state copy when no published questions exist; never expose draft rows to students as a cosmetic fix.

### P2 — CSS cascade has accumulated repair layers
The source has 18 ordered CSS files, including versioned layout repairs and the final V3 design tokens. Incremental layers can be intentional but increase override conflicts and make responsive regressions harder to reason about. **Fix:** first map selectors and duplicate overrides; consolidate only proven dead/conflicting declarations in small batches, preserving visual baselines. No mass rewrite.

### P2 — Page behavior needs broader audit than visual checks
Current visual audit is a useful baseline but doesn't cover all interactive journeys, database/RLS roles, focus/keyboard navigation, PWA stale-cache behavior, network failure, or import/review/publish end-to-end. **Fix:** add explicit journey smoke checks and state coverage for loading, empty, error, partial and success.

### P2 — Build/release parity is a critical gate
The app is assembled from a manifest. A source fix isn't live until rebuilt, tested, deployed and the live version verified; service-worker caching can make old UI appear. **Fix:** record source SHA, generated version, deployed version, smoke result and cache behavior for each release.

## 4. Target information architecture (presentation only)
### Student app
1. **Home** — daily continuation, recent activity, next best action, honest progress metrics.
2. **Subjects** — exam/workspace context → subject → topic → practice.
3. **PYQ** — exam → year → paper/shift → start; show only published/eligible papers with accurate counts.
4. **Test** — quick test, mock tests, custom builder; keep active test in focus mode with no distracting bottom nav.
5. **Revision** — mistakes, marked questions, weak topics, mastery and spaced review.

Header: menu + contextual back + profile; display/theme settings grouped together. Avoid competing primary CTAs.
Drawer groups:
- Prepare: Exam Hub, Subjects, PYQ, Mock Tests
- Learn: Test Builder, Study Library, Question Bank
- Review: Revision, Mistakes, Topic Mastery
- My Space: Progress, Profile, Settings
- Help & App: Health Check, Install, Data Control
- Admin Tools (authorized roles only): Admin Studio, Import, Cleanup, Server, Control Room, Backup/Restore

### Admin Studio
1. Auth/role status
2. Review queue with Draft/Reviewed/Published counts sourced from live query
3. Question detail: bilingual content, options, answer-key/source/provenance
4. Import analysis/preview → safe draft insert → reconciliation report
5. Empty/loading/error/retry states
6. Publish is explicit and permission-gated; no automatic publish.

### Control Room
1. **Executive status** — app/deploy/test/data/backup status with timestamp and source
2. **Command Console** — ask/plan/execute; dangerous actions require approval
3. **Task Manager** — queue, checkpoints, logs, pause/resume/retry/cancel
4. **PYQ Imports & Robots** — run history, source batches, draft reconciliation, failed/skipped reasons
5. **Design & Restore** — audit artifacts, diff, selective restore, verification and rollback
6. **Security & Recovery** — roles, permissions, backup age/restore test, audit log
7. **Finance & Usage** — assumptions clearly marked; actuals separate from estimates
Do not remove, rename or bypass existing capabilities while improving the hierarchy.

## 5. Required audit matrix before implementation
| Surface | Journeys to verify | Pass evidence |
|---|---|---|
| Student Home | first load, returning user, empty history, progress | no JS errors; real metrics; primary action works |
| Exams/Subjects | switch workspace, search/filter, open topic | route/back correct; no cross-workspace leakage |
| PYQ/Question Bank | filters, paper selection, question visibility | status/eligibility correct; counts reconcile |
| Test/Results | start, answer, timer, submit, review, resume/back | no answer loss; focus mode; score reconciles |
| Revision/Mistakes/Mastery | add/remove review item, weak topic, empty state | state persists; counts consistent |
| Profile/Settings | language, theme, text size, account | persists after reload; accessible controls |
| Admin Studio | unauthorized, authorized, draft/review/publish | RLS enforced; no accidental publish |
| Control Room | status, command, tasks, imports, restore, roles | approval gates; evidence/logs; recovery safe |
| Cross-cutting | 360/412/768/1280, light/dark, offline/cache | screenshots + console logs + route matrix |
| Release | build, tests, smoke, deployed version | all gates green; live SHA/version verified |

## 6. Execution sequence
1. Capture current live screenshots + version and run current Design Audit and full Tests/Smoke; save artifacts as baseline.
2. Verify the reported failing robot/test in Control Room against actual latest workflow results. Do not trust stale counters.
3. Complete route-by-route student audit, then Admin Studio, then Control Room. Record each finding with severity, evidence, file/route, test and rollback.
4. Fix P0/P1 functional or safety issues first. Then arrange student navigation and Home/Dashboard only in a separate, minimal UI PR; don't touch locked data/engine/router contracts.
5. Rebuild from source. Run full tests, visual audit, keyboard/focus checks, role/RLS checks, test-session regression and live smoke.
6. Compare before/after; merge only after all required checks pass. Report remaining blockers honestly.

## 7. Current limitations
This baseline is derived from source and repository documentation. The deployed UI screenshots, current live database counts, current full-suite result and all role-gated interactions have **not yet been verified in this document**. Those remain mandatory before calling the audit complete.
