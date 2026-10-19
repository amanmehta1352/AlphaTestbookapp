# Build and release files

`src/` and `manifest.json` are the source of truth. Root `index.html` and
`admin/index.html` are generated releases; never edit them by hand.

Run these commands from the repository root (Python standard library only):

```sh
python3 dev/app/build.py index.html
python3 dev/app/build.py admin/index.html --studio
python3 dev/app/build.py --check
```

The builder resolves source paths relative to itself, so it also works from
`dev/app/`. Output paths are relative to the caller's working directory.
`--check` compares both release files byte for byte and exits nonzero on missing
or stale output without writing anything. The full test runner runs this check
before testing its disposable build so a passing suite also covers the files
that GitHub Pages will serve.

Before a release, update the `app-version` in `src/html/head-01.html`, advance the
shell `CACHE` in `../../sw.js`, rebuild both files, and run
`sudo -E bash dev/tests/run_all.sh` from the root in the CI test environment
(Playwright/Chromium and PostgreSQL 16; see `.github/workflows/tests.yml`). The
optional positional version argument is for standalone candidate exports; use
the source version for checked-in releases so `--check` stays reproducible.

Generating matching files does not approve a candidate or deploy it. Keep the
existing release-review markers until baseline/runtime approval is resolved.
