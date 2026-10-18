from pathlib import Path
import tempfile
import urllib.parse

from robot import download_pdf_or_page
from rrb_je_extract import parse_text, pdf_text

PAPERS = [
    "https://docs.aglasem.com/view/d8be4568-aab6-11e9-aac7-02f21f5619c4",  # 22 May 2019 Shift 1
    "https://docs.aglasem.com/view/d138da4c-aab6-11e9-86ae-02f21f5619c4",  # 23 May 2019 Shift 1
    "https://docs.aglasem.com/view/dcb05986-aab6-11e9-9a6b-02f21f5619c4",  # 24 May 2019 Shift 1
    "https://docs.aglasem.com/view/dd11042a-aab6-11e9-a8cd-02f21f5619c4",  # 25 May 2019 Shift 1
    "https://docs.aglasem.com/view/f5e69c58-aab6-11e9-a672-02f21f5619c4",  # 25 May 2019 Shift 3 (English first)
    "https://docs.aglasem.com/view/f48869f4-aab6-11e9-8826-02f21f5619c4",  # 26 May 2019 Shift 1
    "https://docs.aglasem.com/view/fc365634-aab6-11e9-b4fa-02f21f5619c4",  # 26 May 2019 Shift 2
    "https://docs.aglasem.com/view/054a68dc-aab7-11e9-ba0e-02f21f5619c4",  # 27 May 2019 Shift 1
    "https://docs.aglasem.com/view/fcd7ef8a-aab6-11e9-9771-02f21f5619c4",  # 28 May 2019 Shift 1
    "https://docs.aglasem.com/view/ff2518ee-aab6-11e9-99ba-02f21f5619c4",  # 28 May 2019 Shift 2
    "https://docs.aglasem.com/view/0a55cb32-aab7-11e9-b55e-02f21f5619c4",  # 29 May 2019 Shift 2
    "https://docs.aglasem.com/view/0dcb0c78-aab7-11e9-aa89-02f21f5619c4",  # 29 May 2019 Shift 3
]

HEADERS = {"User-Agent": "PYQ-Robot-Corpus-Test/1.0"}

def main():
    total_questions = 0
    total_answers = 0
    failures = []
    with tempfile.TemporaryDirectory(prefix="rrb-je-corpus-") as td:
        root = Path(td)
        for index, url in enumerate(PAPERS, 1):
            pdf = root / f"paper-{index:02d}.pdf"
            try:
                title = download_pdf_or_page(url, str(pdf), HEADERS)
                text = pdf_text(pdf)
                data = parse_text(text, urllib.parse.urlsplit(url).path.rsplit("/", 1)[-1])
                qcount = int(data.get("question_count", 0))
                answers = sum(1 for q in data.get("questions", []) if q.get("answer") in {"A", "B", "C", "D"})
                if qcount < 80 or answers < 70:
                    failures.append(f"{title or url}: questions={qcount}, answers={answers}")
                total_questions += qcount
                total_answers += answers
                print(f"[{index:02d}/{len(PAPERS)}] {title or url}: {qcount} questions, {answers} explicit answers, {data.get('review_required_count', 0)} review")
            except Exception as exc:
                failures.append(f"{url}: {type(exc).__name__}: {exc}")
                print(f"[{index:02d}/{len(PAPERS)}] FAIL: {url}: {type(exc).__name__}: {exc}")

    print(f"CORPUS TOTAL: {total_questions} questions; {total_answers} explicit answer keys; {len(PAPERS)} source PDFs")
    if failures or total_questions < 1000 or total_answers < 900:
        raise SystemExit("RRB corpus stress test failed: " + " | ".join(failures[:8]) + f" | totals questions={total_questions}, answers={total_answers}")
    print("RRB corpus stress test passed without any Supabase/database writes.")

if __name__ == "__main__":
    main()
