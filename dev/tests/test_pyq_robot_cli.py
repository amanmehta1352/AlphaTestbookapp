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
