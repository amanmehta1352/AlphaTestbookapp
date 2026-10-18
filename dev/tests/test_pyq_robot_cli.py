import os
import sys
import unittest

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(REPO, "dev", "tools", "pyq-robot"))
import robot


class PYQRobotCLITests(unittest.TestCase):
    def test_split_links_on_spaces_commas_and_newlines(self):
        links = robot.split_pdf_links([
            "https://example.com/a.pdf,",
            "https://example.org/b.pdf\nhttps://example.net/c.pdf",
            "--dry-run",
        ])
        self.assertEqual(links, [
            "https://example.com/a.pdf",
            "https://example.org/b.pdf",
            "https://example.net/c.pdf",
        ])

    def test_partial_batch_failure_returns_failure(self):
        self.assertEqual(robot.exit_code_for_results(8, 1), 1)
        self.assertEqual(robot.exit_code_for_results(0, 0), 0)

    def test_bilingual_gate_rejects_english_only_question(self):
        block = """=== QUESTION START ===
QUESTION_EN: What is force?
A_EN: Force
B_EN: Energy
C_EN: Power
D_EN: Work
ANSWER: A
=== QUESTION END ==="""
        with self.assertRaisesRegex(RuntimeError, "bilingual gate"):
            robot.assert_bilingual_txt(block, "english-only.txt")

    def test_bilingual_gate_accepts_both_languages_and_options(self):
        fields = ["QUESTION_EN: What is force?", "QUESTION_HI: बल क्या है?", "ANSWER: A"]
        for letter in "ABCD":
            fields.extend([f"{letter}_EN: English {letter}", f"{letter}_HI: हिन्दी {letter}"])
        block = "=== QUESTION START ===\n" + "\n".join(fields) + "\n=== QUESTION END ==="
        robot.assert_bilingual_txt(block, "bilingual.txt")

    def test_detects_common_exam_names_from_titles(self):
        cases = {
            "RRB JE Question Paper 2019": "RRB JE",
            "RRB NTPC CBT 1": "RRB NTPC",
            "SSC CGL Tier 1 2024": "SSC CGL",
            "SSC-JE Mechanical Paper": "SSC JE",
            "BHEL Supervisor Previous Year Paper": "BHEL",
        }
        for title, expected in cases.items():
            with self.subTest(title=title):
                self.assertEqual(robot.detect_exam_name(title), expected)

    def test_does_not_guess_unknown_exam(self):
        self.assertIsNone(robot.detect_exam_name("random coaching PDF"))

    def test_accepts_valid_https_url(self):
        parts = robot.validate_pdf_url("https://example.com/paper.pdf?download=1")
        self.assertEqual(parts.hostname, "example.com")

    def test_rejects_non_https_url(self):
        with self.assertRaises(RuntimeError):
            robot.validate_pdf_url("http://example.com/paper.pdf")

    def test_rejects_url_without_hostname(self):
        with self.assertRaises(RuntimeError):
            robot.validate_pdf_url("https:///paper.pdf")

    def test_rejects_embedded_credentials(self):
        with self.assertRaises(RuntimeError):
            robot.validate_pdf_url("https://user:pass@example.com/paper.pdf")


if __name__ == "__main__":
    unittest.main()
