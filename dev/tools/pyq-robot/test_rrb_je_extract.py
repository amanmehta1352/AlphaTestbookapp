import unittest

from rrb_je_extract import merge_parsed_sources, parse_text


class RRBJEExtractTests(unittest.TestCase):
    def test_extracts_numbered_question_and_explicit_answer_key(self):
        sample = """RRB JE Mechanical Engineering 2024
1. बल का SI मात्रक क्या है?
A. जूल
B. न्यूटन
C. वाट
D. पास्कल
What is the SI unit of force?
A. Joule
B. Newton
C. Watt
D. Pascal

2. दाब और आयतन में कौन सा नियम संबंध बताता है?
A) बॉयल नियम
B) ओम नियम
C) हुक नियम
D) न्यूटन नियम
Which law relates pressure and volume?
A) Boyle law
B) Ohm law
C) Hooke law
D) Newton law

Official Answer Key
1 B 2 A
"""
        out = parse_text(sample, "sample.pdf")
        self.assertEqual(out["question_count"], 2)
        self.assertEqual(out["branch"], "Mechanical Engineering")
        self.assertEqual(out["year"], "2024")
        self.assertEqual(out["questions"][0]["answer"], "B")
        self.assertEqual(out["questions"][1]["answer"], "A")
        self.assertEqual(out["ready_for_import_count"], 2, out["questions"][0])

    def test_merges_embedded_answer_key_with_clean_ocr_hindi(self):
        embedded = """RRB JE 2019
Question No. 1
ेणी को पण ू कर।
A)748 B)635
C)712 D)682
Complete the series.
A)748 B)635
C)712 D)682
Answer Key : B
"""
        ocr = """RRB JE 2019
Question No. 1
श्रेणी को पूर्ण करें।
A)748 B)635
C)712 D)682
Complete the series.
A)748 B)635
C)712 D)682
"""
        embedded_data = parse_text(embedded, "embedded.pdf")
        ocr_data = parse_text(ocr, "ocr.pdf")
        merged = merge_parsed_sources(embedded_data, ocr_data, prefer_ocr_hindi=True)
        q = merged["questions"][0]
        self.assertEqual(q["answer"], "B")
        self.assertIn("श्रेणी को पूर्ण करें", q["question_hi"])
        self.assertEqual(q["status"], "EXTRACTED")

    def test_explicit_question_no_ignores_numbered_steps_inside_question(self):
        sample = """RRB JE 2019
Question No. 1
कौन सा क्रम सही है?
1. पहला चरण
2. दूसरा चरण
Which sequence is correct?
1. First step
2. Second step
A) एक B) दो
C) तीन D) चार
A) One B) Two
C) Three D) Four
Answer Key : B
Question No. 2
बल का SI मात्रक क्या है?
What is the SI unit of force?
A) न्यूटन B) जूल
C) वाट D) पास्कल
A) Newton B) Joule
C) Watt D) Pascal
Answer Key : A
"""
        out = parse_text(sample, "RRB-JE-2019.pdf")
        self.assertEqual(out["question_count"], 2)
        self.assertEqual([q["source_question_no"] for q in out["questions"]], [1, 2])

    def test_missing_answer_is_review_required(self):
        sample = """RRB JE Civil Engineering 2024
1. Example question?
A. One
B. Two
C. Three
D. Four
"""
        out = parse_text(sample, "sample.pdf")
        self.assertEqual(out["question_count"], 1)
        self.assertIsNone(out["questions"][0]["answer"])
        self.assertIn("official_answer_not_found", out["questions"][0]["review_reasons"])
        self.assertEqual(out["review_required_count"], 1)

    def test_does_not_treat_ans_one_option_list_as_correct_answer(self):
        sample = """RRB JE Mechanical Engineering 2024
1. Example question?
A. One
B. Two
C. Three
D. Four
Ans 1. One 2. Two 3. Three 4. Four
"""
        out = parse_text(sample, "sample.pdf")
        self.assertIsNone(out["questions"][0]["answer"])
        self.assertIn("ambiguous_answer_format", out["questions"][0]["review_reasons"])
        self.assertEqual(out["ready_for_import_count"], 0)

    def test_parses_aglasem_style_question_no_and_answer_key(self):
        sample = """RRB JE Mechanical Engineering 2019
Exam Code : DEMO Exam Date : 01-06-2019
Question No. 1
बल का SI मात्रक क्या है?
A)जूल B)न्यूटन
C)वाट D)पास्कल
What is the SI unit of force?
A)Joule B)Newton
C)Watt D)Pascal
Answer Key : B Your Response : B (Correct)
Question No. 2
दाब और आयतन में कौन सा नियम संबंध बताता है?
A)बॉयल नियम B)ओम नियम
C)हुक नियम D)न्यूटन नियम
Which law relates pressure and volume?
A)Boyle law B)Ohm law
C)Hooke law D)Newton law
Answer Key : A Your Response : C (Wrong)
"""
        out = parse_text(sample, "sample.pdf")
        self.assertEqual(out["question_count"], 2)
        self.assertEqual(out["questions"][0]["answer"], "B")
        self.assertEqual(out["questions"][1]["answer"], "A")
        self.assertEqual(out["ready_for_import_count"], 2)

    def test_dropped_inline_answer_does_not_stop_later_questions(self):
        sample = """RRB JE Mechanical Engineering 2019
Question No. 1
First question?
A)one B)two
C)three D)four
Answer Key : B Your Response : B (Correct)
Question No. 2
Dropped question?
A)one B)two
C)three D)four
Answer Key : This Question is dropped and will not be considered during evaluation
Question No. 3
Third question?
A)one B)two
C)three D)four
Answer Key : A Your Response : A (Correct)
"""
        out = parse_text(sample, "sample.pdf")
        self.assertEqual(out["question_count"], 3)
        self.assertEqual(out["questions"][0]["answer"], "B")
        self.assertIn("answer_key_unavailable_or_dropped", out["questions"][1]["review_reasons"])
        self.assertEqual(out["questions"][2]["answer"], "A")

    def test_does_not_invent_missing_option(self):
        sample = """RRB JE Electrical Engineering 2024
1. Example question?
A. One
B. Two
C. Three
"""
        out = parse_text(sample, "sample.pdf")
        self.assertIn("options_not_exactly_A_to_D", out["questions"][0]["review_reasons"])
        self.assertEqual(out["ready_for_import_count"], 0)


if __name__ == "__main__":
    unittest.main()
