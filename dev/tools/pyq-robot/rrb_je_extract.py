#!/usr/bin/env python3
"""Conservative text-layer extractor for RRB JE CBT PDFs.

This is an extraction/QA stage, not an importer. It never guesses an answer,
never invents a Hindi/English translation, and marks incomplete questions for
manual review. Input PDF must contain a selectable text layer (pdftotext).
Usage:
  python3 dev/tools/pyq-robot/rrb_je_extract.py paper.pdf output.json
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

QUESTION_START = re.compile(r"^\s*(?:Q(?:uestion)?\s*)?\(?\s*(\d{1,3})\s*[).:]\s*(.*)$", re.I)
OPTION_START = re.compile(r"^\s*(?:\(([A-D])\)|([A-D])[).:]|Option\s*([1-4])[).:]?)\s*(.*)$", re.I)
ANSWER_LINE = re.compile(r"^\s*(?:correct\s+answer|answer\s*(?:key)?|ans)\s*:\s*([A-D1-4])\b", re.I)
AMBIGUOUS_ANS_OPTIONS = re.compile(r"^\s*ans\s*1[).]\s+", re.I)
ANSWER_PAIR = re.compile(r"(?<!\w)(\d{1,3})\s*[-:.)]?\s*([A-D])\b", re.I)
HEADER_YEAR = re.compile(r"\b(20\d{2})\b")
BRANCHES = {
    "civil": "Civil Engineering",
    "electrical": "Electrical Engineering",
    "mechanical": "Mechanical Engineering",
}


def pdf_text(path: Path) -> str:
    p = subprocess.run(
        ["pdftotext", "-layout", str(path), "-"],
        capture_output=True, text=True, check=True,
    )
    return p.stdout.replace("\x00", "")


def parse_text(text: str, source_name: str) -> dict:
    lines = text.replace("\f", "\n").splitlines()
    header = "\n".join(lines[:100])
    lower = header.lower()
    branch = next((v for k, v in BRANCHES.items() if k in lower), None)
    year_match = HEADER_YEAR.search(header)
    year = year_match.group(1) if year_match else None

    questions = []
    current = None
    in_answer_key = False
    answer_pairs = {}

    def finish():
        nonlocal current
        if current is None:
            return
        current["question"] = "\n".join(current.pop("_stem")).strip()
        current["options"] = {k: "\n".join(v).strip() for k, v in current.pop("_options").items()}
        current["answer"] = None
        current["review_reasons"] = []
        if not current["question"]:
            current["review_reasons"].append("missing_question_text")
        if set(current["options"]) != set("ABCD"):
            current["review_reasons"].append("options_not_exactly_A_to_D")
        if len(current["options"]) != 4:
            current["review_reasons"].append("incomplete_options")
        if current.get("_ambiguous_answer_format"):
            current["review_reasons"].append("ambiguous_answer_format")
        questions.append(current)
        current = None

    for raw in lines:
        line = raw.rstrip()
        s = line.strip()
        if not s:
            if current is not None:
                target = current["_options"].get(current["_last_option"]) if current["_last_option"] else None
                if target is not None:
                    target.append("")
                elif current["_stem"]:
                    current["_stem"].append("")
            continue

        if re.search(r"\b(answer\s*key|correct\s*answers|official\s*answers)\b", s, re.I):
            finish()
            in_answer_key = True
            continue

        if in_answer_key:
            # Only capture explicit numbered answer-key pairs; never infer from option text.
            for qno, ans in ANSWER_PAIR.findall(s):
                answer_pairs[int(qno)] = str(int(ans)) if ans.isdigit() else ans.upper()
            continue

        qm = QUESTION_START.match(line)
        if qm:
            qno = int(qm.group(1))
            # Avoid mistaking answer/section numbering for question starts.
            if current is not None:
                finish()
            current = {
                "source_question_no": qno,
                "_stem": [qm.group(2).strip()] if qm.group(2).strip() else [],
                "_options": {},
                "_last_option": None,
            }
            continue

        if current is None:
            continue
        om = OPTION_START.match(line)
        if om:
            label = (om.group(1) or om.group(2) or om.group(3) or "").upper()
            if label.isdigit():
                label = "ABCD"[int(label) - 1] if label in "1234" else ""
            if label:
                current["_options"].setdefault(label, [])
                current["_options"][label].append(om.group(4).strip())
                current["_last_option"] = label
            continue

        # Some coaching PDFs use "Ans 1. ... 2. ..." to list option texts, not the correct key.
        # Never interpret that ambiguous format as answer A.
        if AMBIGUOUS_ANS_OPTIONS.match(s):
            current["_ambiguous_answer_format"] = True
            continue

        # Accept an answer only when the label explicitly separates the key (e.g. "Ans: B").
        am = ANSWER_LINE.match(s)
        if am:
            token = am.group(1).upper()
            current["_explicit_answer"] = ("ABCD"[int(token) - 1] if token in "1234" else token)
            continue

        if current["_last_option"]:
            current["_options"][current["_last_option"]].append(s)
        else:
            current["_stem"].append(s)

    finish()

    for q in questions:
        answer = q.pop("_explicit_answer", None) or answer_pairs.get(q["source_question_no"])
        q["answer"] = answer
        if answer not in set("ABCD"):
            q["review_reasons"].append("official_answer_not_found")
        if not branch:
            q["review_reasons"].append("branch_not_detected_from_header")
        if not year:
            q["review_reasons"].append("year_not_detected_from_header")
        q["status"] = "REVIEW_REQUIRED" if q["review_reasons"] else "EXTRACTED"

    return {
        "schema": "rrb-je-pdf-extract-v1",
        "source_file": source_name,
        "exam_name": "RRB JE",
        "year": year,
        "branch": branch,
        "source_text_has_hindi": bool(re.search(r"[\u0900-\u097F]", text)),
        "source_text_has_english": bool(re.search(r"[A-Za-z]{3,}", text)),
        "question_count": len(questions),
        "ready_for_import_count": sum(q["status"] == "EXTRACTED" for q in questions),
        "review_required_count": sum(q["status"] != "EXTRACTED" for q in questions),
        "notes": [
            "Extraction only; this script does not translate or assign chapter/topic.",
            "A question is not import-ready for the bilingual Master TestBook until both language versions and topic mapping are verified.",
            "Scanned/image-only PDFs need OCR and are not supported by this text-layer extractor.",
        ],
        "questions": questions,
    }


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    src, out = Path(argv[1]), Path(argv[2])
    try:
        result = parse_text(pdf_text(src), src.name)
    except (OSError, subprocess.CalledProcessError) as exc:
        print(f"PDF extraction failed: {exc}", file=sys.stderr)
        return 1
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"Extracted {result['question_count']} question(s); "
        f"{result['ready_for_import_count']} pass basic checks; "
        f"{result['review_required_count']} need review. Output: {out}"
    )
    # Deliberately return non-zero if no questions were extracted.
    return 0 if result["question_count"] else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
