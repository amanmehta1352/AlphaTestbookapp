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
- `dev/tools/key-check-robot/keycheck.py` + `.github/workflows/key-check-robot.yml`: 🔑 Key-check Robot. READ-ONLY (never edits a question). Flags: A structure (answer/4 options/duplicate options), B same question in two papers with different answer text, C one paper where a letter is the key for >45 % of ≥20 Q, D optional Gemini second opinion (free key `GEMINI_API_KEY`, only question+options sent, ~4.5 s between calls, `--limit/--offset` for the free quota). Official key stays the truth; D is only "जाँचो". Runs after PYQ Robot (draft) or by hand (draft/published/all). `--strict` exits 2 on hard flags (A/B) for a later auto-publish gate. Test: `dev/tests/test_keycheck.py`.
- Lanes: data robots/tools work on branch `data-robots`, UI/design on `design-v3`; never mix both in one PR. Merge to main only after all suites pass.
- Server changes: Claude applies them via the Supabase connector. Take a backup into schema `backup` first; avoid DROP (needs extra confirmation) — use ALTER / IF NOT EXISTS.

## V3 design (16 Oct 2026)
- `src/css/18-v3-design.css` (loaded last) = design tokens (blueprint colours, Inter/Plus Jakarta/Noto Devanagari/JetBrains Mono), solid compact cards, glass only on header + floating dock, CBT/result styles. Fonts load non-blocking.
- `src/js/17b-student-profile.js` = exam + branch profile; filter happens in `cloudPullContent` (other branches never reach the phone) + `profileVisible()` on Home/Subjects (hides demo/other-exam local topics). Data-write paths untouched.
- `src/js/22b-cbt-confidence.js` = "How sure?" tags in CBT + result soft landing / what-if.
- `src/js/22c-cbt-tools.js` = timer hide, 5-min alert, rough pad (palette 5 states in 22-study-engines). `src/js/22d-v3-hub-me.js` = subject hub accordions (overrides renderSubjectPage), result "Speed check" (`rs-pace*`; `rs-time` is taken), Me screen (route `me`).
- Tests: `test_profile.py`, `test_v3.py` (overflow 360/412, tap ≥ 48/44 px, contrast ≥ 4.5 light+dark). CI: `.github/workflows/tests.yml` runs run_all.sh on every push.

## Release rules
1. Change source in `dev/app/src`, bump version (head-01.html meta + build arg).
2. Bump `CACHE` name in `sw.js` (mtb-shell-vN) on every release.
3. Run `dev/tests/run_all.sh` (all suites); push only when all pass.
4. Questions change only through `DataCore.commit/mutate` — never assign AppModules directly.

## Never
- Never put Supabase secret/service_role keys, DB password or OAuth client secret in the repo. Only the publishable key is allowed.
- Never strip publisher names/watermarks or copy publisher solutions. Only official PYQ text/options/answers + our own solutions.
- User works from an Android phone only (no laptop); explain steps in simple Hindi.
