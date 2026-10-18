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
import tempfile
from pathlib import Path

QUESTION_START = re.compile(r"^\s*(?:Question\s+No\.?\s*(?P<qno1>\d{1,3})|(?:Q(?:uestion)?\s*)?\(?\s*(?P<qno2>\d{1,3})\s*[).:])\s*(?P<text>.*)$", re.I | re.M)
INLINE_ANSWER_KEY = re.compile(r"^\s*answer\s+key\s*:\s*([A-D])\b", re.I)
OPTION_START = re.compile(r"^\s*(?:\(([A-D])\)|([A-D])[).:]|Option\s*([1-4])[).:]?)\s*(.*)$", re.I)
INLINE_OPTION_MARKER = re.compile(r"(?<!\S)(?:\(([A-D])\)|([A-D])[).:])\s*", re.I)
ANSWER_LINE = re.compile(r"^\s*(?:correct\s+answer|answer\s*(?:key)?|ans)\s*:\s*([A-D1-4])\b", re.I)
AMBIGUOUS_ANS_OPTIONS = re.compile(r"^\s*ans\s*1[).]\s+", re.I)
ANSWER_PAIR = re.compile(r"(?<!\w)(\d{1,3})\s*[-:.)]?\s*([A-D])\b", re.I)
HEADER_YEAR = re.compile(r"\b(20\d{2})\b")
BRANCHES = {
    "civil": "Civil Engineering",
    "electrical": "Electrical Engineering",
    "mechanical": "Mechanical Engineering",
}


def ocr_pdf_text(path: Path) -> str:
    """OCR image-only or badly encoded Hindi PDFs using Tesseract English+Hindi."""
    with tempfile.TemporaryDirectory(prefix="rrb-je-ocr-") as td:
        prefix = Path(td) / "page"
        subprocess.run(
            ["pdftoppm", "-png", "-r", "250", str(path), str(prefix)],
            capture_output=True, text=True, check=True, timeout=300,
        )
        pages = sorted(Path(td).glob("page-*.png"), key=lambda p: int(re.search(r"-(\d+)\.png$", p.name).group(1)))
        if not pages:
            raise RuntimeError("PDF pages could not be rendered for OCR")
        text_pages = []
        for page in pages:
            result = subprocess.run(
                ["tesseract", str(page), "stdout", "-l", "eng+hin", "--psm", "6"],
                capture_output=True, text=True, check=True, timeout=60,
            )
            text_pages.append(result.stdout)
        return "\n".join(text_pages).replace("\x00", "")


def pdf_text_sources(path: Path) -> dict:
    """Return embedded text and, when needed, OCR text so reliable answer keys can be merged."""
    p = subprocess.run(
        ["pdftotext", "-layout", str(path), "-"],
        capture_output=True, text=True, check=True,
    )
    embedded = p.stdout.replace("\x00", "")
    broken_hindi = bool(re.search(r"(?m)^\s*[\u093E-\u094D]", embedded))
    needs_ocr = not embedded.strip() or not QUESTION_START.search(embedded) or broken_hindi
    ocr = ""
    if needs_ocr:
        try:
            ocr = ocr_pdf_text(path)
        except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired, RuntimeError):
            ocr = ""
    return {
        "embedded": embedded,
        "ocr": ocr,
        "embedded_hindi_broken": broken_hindi,
        "needs_ocr": needs_ocr,
    }


def _question_count(text: str) -> int:
    if re.search(r"(?m)^\s*Question\s+No\.?\s*\d{1,3}", text, re.I):
        return len(re.findall(r"(?m)^\s*Question\s+No\.?\s*\d{1,3}", text, re.I))
    return sum(1 for line in text.splitlines() if QUESTION_START.match(line))


def _prefer_ocr(sources: dict) -> bool:
    embedded, ocr = sources.get("embedded", ""), sources.get("ocr", "")
    if not ocr.strip():
        return False
    original_count = _question_count(embedded)
    ocr_count = _question_count(ocr)
    minimum_count = max(1, int(original_count * 0.8)) if original_count else 1
    return bool(
        QUESTION_START.search(ocr)
        and ocr_count >= minimum_count
        and len(ocr.strip()) >= max(1000, len(embedded.strip()) * 0.5)
    )


def pdf_text(path: Path) -> str:
    sources = pdf_text_sources(path)
    return sources["ocr"] if _prefer_ocr(sources) else sources["embedded"]


def bilingual_body(raw_lines: list[str]) -> dict:
    """Split bilingual question/options when the source repeats A-D in Hindi then English."""
    segments = [[]]
    groups = []
    active = {}
    last_option = None
    option_labels = set("ABCD")
    noise = re.compile(r"^(?:top|page\s+\d+|image\d*)$", re.I)

    for raw in raw_lines:
        line = raw.strip()
        if not line or noise.fullmatch(line):
            continue
        markers = list(INLINE_OPTION_MARKER.finditer(line))
        if markers:
            for idx, marker in enumerate(markers):
                label = (marker.group(1) or marker.group(2)).upper()
                if label == "A" and active and set(active) == option_labels:
                    groups.append(active)
                    active = {}
                end = markers[idx + 1].start() if idx + 1 < len(markers) else len(line)
                value = line[marker.end():end].strip()
                active[label] = (active.get(label, "") + " " + value).strip()
                last_option = label
                if set(active) == option_labels:
                    groups.append(active)
                    active = {}
                    last_option = None
                    segments.append([])
            continue

        if active and last_option and set(active) != option_labels:
            active[last_option] = (active[last_option] + " " + line).strip()
        else:
            segments[-1].append(line)

    if active:
        groups.append(active)

    def split_lines(lines):
        hi, en = [], []
        for item in lines:
            has_hi = bool(re.search(r"[\u0900-\u097F]", item))
            has_en = bool(re.search(r"[A-Za-z]{2,}", item))
            if has_hi:
                hi.append(item)
            if has_en:
                en.append(item)
            if not has_hi and not has_en:
                hi.append(item)
                en.append(item)
        return "\n".join(hi).strip(), "\n".join(en).strip()

    q_hi, q_en = split_lines([line for segment in segments for line in segment])
    options_hi, options_en = {}, {}
    for gi, group in enumerate(groups):
        all_values = " ".join(group.values())
        has_hi = bool(re.search(r"[\u0900-\u097F]", all_values))
        has_en = bool(re.search(r"[A-Za-z]{2,}", all_values))
        if has_hi and not has_en:
            language = "hi"
        elif has_en and not has_hi:
            language = "en"
        elif len(groups) >= 2 and gi == 0:
            language = "hi"
        elif len(groups) >= 2 and gi == 1:
            language = "en"
        else:
            language = "mixed"

        for label, value in group.items():
            if language == "hi":
                options_hi[label] = value
            elif language == "en":
                options_en[label] = value
            else:
                v_hi, v_en = split_lines([value])
                if v_hi:
                    options_hi[label] = v_hi
                if v_en:
                    options_en[label] = v_en

    return {
        "question_hi": q_hi,
        "question_en": q_en,
        "options_hi": options_hi,
        "options_en": options_en,
        "option_group_count": len(groups),
    }


def parse_text(text: str, source_name: str) -> dict:
    lines = text.replace("\f", "\n").splitlines()
    has_explicit_question_numbers = bool(re.search(r"(?m)^\s*Question\s+No\.?\s*\d{1,3}", text, re.I))
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
        bilingual = bilingual_body(current.get("_raw_lines", []))
        current.update(bilingual)
        current.pop("_raw_lines", None)
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
        if current.get("_answer_key_note"):
            current["review_reasons"].append("answer_key_unavailable_or_dropped")
        if re.search(r"(?m)^\s*[\u093E-\u094D]", current.get("question_hi", "")):
            current["review_reasons"].append("hindi_text_encoding_suspect")
        if not current.get("question_hi") or not current.get("question_en"):
            current["review_reasons"].append("bilingual_question_missing_language")
        if not all(current.get("options_hi", {}).get(k, "").strip() for k in "ABCD") or not all(current.get("options_en", {}).get(k, "").strip() for k in "ABCD"):
            current["review_reasons"].append("bilingual_options_missing_language")
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

        inline_key_text = re.match(r"^\s*answer\s+key\s*:\s*(.*)$", s, re.I)
        if inline_key_text and current is not None:
            inline_answer = INLINE_ANSWER_KEY.match(s)
            if inline_answer:
                current["_explicit_answer"] = inline_answer.group(1).upper()
            else:
                current["_answer_key_note"] = inline_key_text.group(1).strip()
            # A dropped/invalid inline key belongs to this question; it is not a
            # document-level answer-key table and must not stop later questions.
            continue

        if re.fullmatch(r"\s*(?:official\s+)?(?:answer\s*key|correct\s*answers|official\s*answers)\s*", s, re.I):
            finish()
            in_answer_key = True
            continue
        if in_answer_key:
            # Only capture explicit numbered answer-key pairs; never infer from option text.
            for qno, ans in ANSWER_PAIR.findall(s):
                answer_pairs[int(qno)] = str(int(ans)) if ans.isdigit() else ans.upper()
            continue

        qm = QUESTION_START.match(line)
        if has_explicit_question_numbers and not re.match(r"^\s*Question\s+No\.?\s*\d{1,3}", line, re.I):
            qm = None
        if qm:
            qno = int(qm.group("qno1") or qm.group("qno2"))
            # Avoid mistaking answer/section numbering for question starts.
            if current is not None:
                finish()
            current = {
                "source_question_no": qno,
                "_stem": [qm.group("text").strip()] if qm.group("text").strip() else [],
                "_options": {},
                "_last_option": None,
                "_raw_lines": [qm.group("text").strip()] if qm.group("text").strip() else [],
            }
            continue

        if current is None:
            continue
        current["_raw_lines"].append(s)
        # Some PDFs place multiple options on one text line (e.g. "A)Joule B)Newton").
        # Split only when at least two explicit A-D markers are present.
        inline_options = list(INLINE_OPTION_MARKER.finditer(line))
        if len(inline_options) >= 2:
            for idx, marker in enumerate(inline_options):
                label = (marker.group(1) or marker.group(2)).upper()
                end = inline_options[idx + 1].start() if idx + 1 < len(inline_options) else len(line)
                value = line[marker.end():end].strip()
                current["_options"].setdefault(label, [])
                current["_options"][label].append(value)
                current["_last_option"] = label
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
        if not branch and re.search(r"\bCBT\s*2\b", header, re.I):
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


def _has_hindi(value: str) -> bool:
    return bool(re.search(r"[\u0900-\u097F]", str(value or "")))


def _has_english(value: str) -> bool:
    return bool(re.search(r"[A-Za-z]{2,}", str(value or "")))


def _starts_with_broken_hindi_mark(value: str) -> bool:
    return bool(re.search(r"(?m)^\s*[\u093E-\u094D]", str(value or "")))


def _best_english(primary: str, secondary: str) -> str:
    if _has_english(primary):
        return primary
    if _has_english(secondary):
        return secondary
    return primary or secondary or ""


def _best_hindi(primary: str, secondary: str, prefer_secondary: bool) -> str:
    p_good = bool(primary.strip()) and not _starts_with_broken_hindi_mark(primary)
    s_good = bool(secondary.strip()) and not _starts_with_broken_hindi_mark(secondary)
    if prefer_secondary and s_good and (_has_hindi(secondary) or not _has_english(secondary)):
        return secondary
    if p_good and (_has_hindi(primary) or not _has_english(primary)):
        return primary
    if s_good and (_has_hindi(secondary) or not _has_english(secondary)):
        return secondary
    return secondary or primary or ""


def merge_parsed_sources(embedded_data: dict, ocr_data: dict, prefer_ocr_hindi: bool, ocr_only: bool = False) -> dict:
    embedded_questions = embedded_data.get("questions", [])
    ocr_questions = ocr_data.get("questions", [])
    if not embedded_questions:
        result = dict(ocr_data)
        if ocr_only:
            for q in result.get("questions", []):
                q["review_reasons"] = list(dict.fromkeys((q.get("review_reasons") or []) + ["ocr_only_source_review"]))
                q["status"] = "REVIEW_REQUIRED"
            result["ready_for_import_count"] = 0
            result["review_required_count"] = len(result.get("questions", []))
        return result
    if not ocr_questions:
        result = dict(embedded_data)
        if prefer_ocr_hindi:
            for q in result.get("questions", []):
                q["review_reasons"] = list(dict.fromkeys((q.get("review_reasons") or []) + ["hindi_text_quality_review"]))
                q["status"] = "REVIEW_REQUIRED"
            result["ready_for_import_count"] = 0
            result["review_required_count"] = len(result.get("questions", []))
        return result

    ocr_by_no = {q.get("source_question_no"): q for q in ocr_questions}
    overlap = sum(1 for q in embedded_questions if q.get("source_question_no") in ocr_by_no)
    minimum_overlap = max(1, int(len(embedded_questions) * 0.8))
    if overlap < minimum_overlap:
        result = dict(embedded_data)
        if prefer_ocr_hindi:
            for q in result.get("questions", []):
                q["review_reasons"] = list(dict.fromkeys((q.get("review_reasons") or []) + ["hindi_text_quality_review"]))
                q["status"] = "REVIEW_REQUIRED"
            result["ready_for_import_count"] = 0
            result["review_required_count"] = len(result.get("questions", []))
        return result

    merged_questions = []
    for original in embedded_questions:
        scanned = ocr_by_no.get(original.get("source_question_no"), {})
        q = dict(original)
        q["question_en"] = _best_english(original.get("question_en", ""), scanned.get("question_en", ""))
        q["question_hi"] = _best_hindi(original.get("question_hi", ""), scanned.get("question_hi", ""), prefer_ocr_hindi)

        opts_en, opts_hi = {}, {}
        original_en = original.get("options_en", {})
        original_hi = original.get("options_hi", {})
        scanned_en = scanned.get("options_en", {})
        scanned_hi = scanned.get("options_hi", {})
        for label in "ABCD":
            opts_en[label] = _best_english(original_en.get(label, ""), scanned_en.get(label, ""))
            opts_hi[label] = _best_hindi(original_hi.get(label, ""), scanned_hi.get(label, ""), prefer_ocr_hindi)
        q["options_en"], q["options_hi"] = opts_en, opts_hi

        dropped = bool(original.get("_answer_key_note")) or "answer_key_unavailable_or_dropped" in (original.get("review_reasons") or [])
        embedded_answer = original.get("answer") if original.get("answer") in set("ABCD") else None
        ocr_answer = scanned.get("answer") if scanned.get("answer") in set("ABCD") else None
        answer_conflict = bool(embedded_answer and ocr_answer and embedded_answer != ocr_answer)
        q["answer"] = None if dropped else (embedded_answer or ocr_answer)

        reasons = []
        if dropped:
            reasons.append("answer_key_unavailable_or_dropped")
        elif not q["answer"]:
            reasons.append("official_answer_not_found")
        if answer_conflict:
            reasons.append("answer_key_ocr_disagreement")
        if not q.get("question", "").strip():
            reasons.append("missing_question_text")
        if not q.get("question_en", "").strip() or not q.get("question_hi", "").strip():
            reasons.append("bilingual_question_missing_language")
        if any(not opts_en.get(k, "").strip() or not opts_hi.get(k, "").strip() for k in "ABCD"):
            reasons.append("bilingual_options_missing_language")
        if _starts_with_broken_hindi_mark(q.get("question_hi", "")):
            reasons.append("hindi_text_encoding_suspect")
        if prefer_ocr_hindi and not _has_hindi(q.get("question_hi", "")) and _has_english(q.get("question_hi", "")):
            reasons.append("hindi_text_quality_review")
        if not embedded_data.get("branch") and any("branch_not_detected_from_header" in (src.get("review_reasons") or []) for src in (original, scanned)):
            reasons.append("branch_not_detected_from_header")
        if not embedded_data.get("year"):
            reasons.append("year_not_detected_from_header")

        q["review_reasons"] = list(dict.fromkeys(reasons))
        q["status"] = "REVIEW_REQUIRED" if q["review_reasons"] else "EXTRACTED"
        merged_questions.append(q)

    result = dict(embedded_data)
    result["branch"] = embedded_data.get("branch") or ocr_data.get("branch")
    result["year"] = embedded_data.get("year") or ocr_data.get("year")
    result["source_text_has_hindi"] = embedded_data.get("source_text_has_hindi", False) or ocr_data.get("source_text_has_hindi", False)
    result["source_text_has_english"] = embedded_data.get("source_text_has_english", False) or ocr_data.get("source_text_has_english", False)
    result["questions"] = merged_questions
    result["question_count"] = len(merged_questions)
    result["ready_for_import_count"] = sum(q["status"] == "EXTRACTED" for q in merged_questions)
    result["review_required_count"] = sum(q["status"] != "EXTRACTED" for q in merged_questions)
    result["notes"] = list(result.get("notes", [])) + ["Embedded text answer keys were merged with OCR-derived Hindi/English fields when question-number overlap was sufficient."]
    return result


def parse_pdf_sources(path: Path, source_name: str) -> tuple[dict, str]:
    sources = pdf_text_sources(path)
    embedded = sources.get("embedded", "")
    ocr = sources.get("ocr", "")
    selected_text = ocr if _prefer_ocr(sources) else embedded
    embedded_data = parse_text(embedded, source_name) if embedded.strip() else parse_text("", source_name)
    if not ocr.strip():
        data = merge_parsed_sources(embedded_data, {}, sources.get("embedded_hindi_broken", False))
        return data, selected_text
    ocr_data = parse_text(ocr, source_name)
    data = merge_parsed_sources(
        embedded_data,
        ocr_data,
        prefer_ocr_hindi=sources.get("embedded_hindi_broken", False),
        ocr_only=not embedded.strip(),
    )
    return data, selected_text


def parse_pdf(path: Path, source_name: str) -> dict:
    return parse_pdf_sources(path, source_name)[0]


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    src, out = Path(argv[1]), Path(argv[2])
    try:
        result = parse_pdf(src, src.name)
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
