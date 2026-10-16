# PYQ from an SSC response-sheet PDF

Used for SSC JE 2024 Civil Paper I, 05 Jun 2024 Shift 1 (184 text questions, batch `CLAUDE-SSCJE-2024-0506-S1`).

Official answer = the green tick image (16x16) next to an option; red cross (31x21) = wrong.
Each question has exactly 4 marks, so marks are taken in groups of 4 in page/top order.

1. `pdftotext -layout paper.pdf paper.txt`
2. `parse.py`  – positions of question labels, tick/cross marks, figures (pdfplumber)
3. `parse2.py` – question text, options, Question/Option IDs from the text layout
4. `parse3.py` – official answer from ticks; figures assigned to questions
5. `build_txt.py` – topic per question (hand-made map), text clean-up (m², C₃S, °, Hindi spacing), one app-format TXT per topic
6. `analyze.py` – runs the app's own ImportEngine + srvQuestionRow on each TXT → server rows (same IDs/hash as a Studio import)
7. Insert as `status='draft'` with `source_ref`, verify with a checksum, then publish from Admin Studio.

Questions with pictures (figures / picture options) are held back until the app can show images.
Never put PDFs or question data in this repo.
