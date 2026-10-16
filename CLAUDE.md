# Master TestBook (AlphaTestbookapp)

Student test-prep PWA (SSC/RRB). Served by GitHub Pages from the repo root.

## Layout
- Root (`index.html`, `sw.js`, `manifest.webmanifest`, icons): the LIVE release. Never hand-edit `index.html`.
- `dev/app/`: source tree. Build: `cd dev/app && python3 build.py ../../index.html V2.x.y`.
- `dev/tests/`: Playwright suites; `fake_supabase.py` runs the real schema/RLS on local Postgres 16.
- `dev/server/SUPABASE_SCHEMA_V1.sql` + `V2.sql` + `V3.sql`: all applied on the live Supabase project (V2 = status/solutions, V3 = source_ref, 2026-10-16).
- `dev/tools/pyq-from-response-sheet/`: PDF → PYQ pipeline (`v2/` = generic version used for all SSC JE 2024 papers).
- `dev/tools/pyq-robot/robot.py` + `.github/workflows/pyq-robot.yml`: 🤖 PYQ Robot. User runs it from phone (Actions → PYQ Robot → paste SSC JE response-sheet links) — imports as draft with no Claude usage. Needs repo secret `SUPABASE_SECRET_KEY`. GA/Engineering land in topic "Mixed (Untagged)" (tag later); figure questions skipped. Test: `dev/tests/test_robot.py`.
- `dev/tools/hindi-robot/` + `.github/workflows/hindi-robot.yml`: 🌐 Hindi Robot. Fills empty `question_hi` (+ non-engineering option Hindi) with IndicTrans2 1B (pinned rev, MIT, `prajdabre/rotary-indictrans2-en-indic-1B`), 8 parallel shards, runs after every PYQ Robot run. Protects codes/names/maths/units; never overwrites Hindi; marks source_ref "· Hindi = machine translation (IndicTrans2)"; changes content_hash so students resync. Needs transformers 4.46.x. Test: `dev/tests/test_hindi.py`.
- `dev/tools/tag-robot/tagger.py` + `.github/workflows/tag-robot.yml`: 🏷️ Tag Robot. TF-IDF + logistic regression learns from hand-tagged questions per subject; moves Mixed questions only if subject CV accuracy ≥ 80 % and prob ≥ 0.55; changes only topic_id/chapter/topic/content_hash. Runs after PYQ Robot. Test: `dev/tests/test_tagger.py`.
- Server changes: Claude applies them via the Supabase connector. Take a backup into schema `backup` first; avoid DROP (needs extra confirmation) — use ALTER / IF NOT EXISTS.

## Release rules
1. Change source in `dev/app/src`, bump version (head-01.html meta + build arg).
2. Bump `CACHE` name in `sw.js` (mtb-shell-vN) on every release.
3. Run `dev/tests/run_all.sh` (all suites); push only when all pass.
4. Questions change only through `DataCore.commit/mutate` — never assign AppModules directly.

## Never
- Never put Supabase secret/service_role keys, DB password or OAuth client secret in the repo. Only the publishable key is allowed.
- Never strip publisher names/watermarks or copy publisher solutions. Only official PYQ text/options/answers + our own solutions.
- User works from an Android phone only (no laptop); explain steps in simple Hindi.
