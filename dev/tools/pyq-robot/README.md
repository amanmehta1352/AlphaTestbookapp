# 🤖 PYQ Robot

Official SSC JE response-sheet PDF links → server questions as **draft**. Runs on GitHub Actions, so no Claude usage.

- Phone: GitHub → repo → **Actions** → **PYQ Robot** → **Run workflow** → paste links → Run.
- Result: open the run → summary shows how many questions were sent / skipped per paper.
- Then Admin Studio → Review → Publish.
- Same link twice = nothing new (paper's `source_ref` already on server).
- Skipped: figure/diagram questions, unclear answer key, old non-response-sheet PDFs (e.g. 2016/2017 formats).
- Reasoning gets chapters by rules (`v2/rfirst.py`); GA + Engineering go to `Mixed (Untagged)`.
- Local check without server: `python3 dev/tools/pyq-robot/robot.py --dry-run <link>`.
- Secret: `SUPABASE_SECRET_KEY` in repo Settings → Secrets and variables → Actions. Never in code/chat.
