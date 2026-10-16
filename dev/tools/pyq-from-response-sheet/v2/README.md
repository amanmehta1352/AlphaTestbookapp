# v2 — generic SSC response-sheet pipeline (used for all 7 SSC JE 2024 papers)

Run from a scratch folder that has `bin/` (these scripts), `dl/` (PDFs) and `x/` (output). Never commit PDFs or question data.

1. `python3 -I bin/extract.py dl/<paper>.pdf x/<paper>.json` — text, options, SSC IDs, official answer (green tick 16x16; answer only when exactly 4 marks and 1 tick), header (date/time → real shift: 9 AM = 1, 1 PM = 2, 5 PM = 3; Oliveboard file names can be wrong).
2. `python3 -I bin/gaps.py dl/<paper>.pdf x/<paper>.json` — biggest blank gap inside a question. Mechanical PDFs lose figures (no image, just empty space), so gap > 30 pt or any image ⇒ held back.
3. Topics: Reasoning by rules (`rfirst.py`), GA and engineering by hand maps (`map_ga.py`, `map_eng.py`, keyed by Oliveboard label like `M05S3`). `HOLD` = sheet key disagrees with own solution → not imported / kept inactive.
4. `python3 -I bin/build_all.py <txtdir>` — cleanup (², ³, ₂, 10⁻⁴, Hindi word joins) + one app TXT per paper×topic.
5. `analyzeM.py` (edit the glob) — app's own ImportEngine + srvQuestionRow → server rows (same IDs/hash as Studio).
6. Insert as `status='draft'` with `source_ref`, `on conflict (id) do nothing`; verify count + md5 against the server.
