# 🌐 Hindi Robot

Adds Hindi to server questions that have only English. Runs on GitHub Actions (free, no Claude usage).

- Automatic: after every **PYQ Robot** run. By hand: Actions → **Hindi Robot** → Run workflow.
- Model: IndicTrans2 1B (rotary copy by an IndicTrans2 author, MIT), revision pinned in `mt.py`.
- Protected (kept as is): codes in quotes, CAPITAL codes/acronyms, person letters (A, B, P…), arithmetic lines, numbers with units, `(?)`.
- Engineering options stay English (technical terms); their questions get Hindi.
- Never overwrites existing Hindi; `source_ref` gets "· Hindi = machine translation (IndicTrans2)".
- Local: `pip install torch transformers==4.46.3 sentencepiece einops IndicTransToolkit`, then `hindi.py --shard 0 --of 1 --limit 5 --dry-run` (needs SUPABASE_SECRET_KEY).
