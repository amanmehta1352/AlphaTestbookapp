# 🔑 Key-check Robot

Phone: GitHub → Actions → **Key-check Robot** → Run workflow.

- `scope`: `draft` (new, not live), `published` (live), `all`.
- `gemini`: second opinion from Gemini (free key in repo secret `GEMINI_API_KEY`). Only question + options are sent.
- `limit` / `offset`: Gemini free quota is small (~15 requests/min, ~1,500/day), so check in parts: 150, then offset 150, ...

It **never changes** a question. It writes a report (run summary + `keycheck-report.json` artifact).
Flags A1/A2/B are "hard" (answer can't be trusted as is). C and D mean "look at it".
The official SSC key stays the truth; a Gemini disagreement is not proof the key is wrong.
