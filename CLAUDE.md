# Master TestBook (AlphaTestbookapp)

Student test-prep PWA (SSC/RRB). Served by GitHub Pages from the repo root.

## Layout
- Root (`index.html`, `sw.js`, `manifest.webmanifest`, icons): the LIVE release. Never hand-edit `index.html`.
- `dev/app/`: source tree. Build: `cd dev/app && python3 build.py ../../index.html V2.x.y`.
- `dev/tests/`: Playwright suites; `fake_supabase.py` runs the real schema/RLS on local Postgres 16.
- `dev/server/SUPABASE_SCHEMA_V1.sql`: schema already applied on the live Supabase project.

## Release rules
1. Change source in `dev/app/src`, bump version (head-01.html meta + build arg).
2. Bump `CACHE` name in `sw.js` (mtb-shell-vN) on every release.
3. Run `dev/tests/run_all.sh` (all suites); push only when all pass.
4. Questions change only through `DataCore.commit/mutate` — never assign AppModules directly.

## Never
- Never put Supabase secret/service_role keys, DB password or OAuth client secret in the repo. Only the publishable key is allowed.
- Never strip publisher names/watermarks or copy publisher solutions. Only official PYQ text/options/answers + our own solutions.
- User works from an Android phone only (no laptop); explain steps in simple Hindi.
