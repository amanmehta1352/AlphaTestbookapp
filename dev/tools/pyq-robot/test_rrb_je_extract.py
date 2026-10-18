import unittest

from rrb_je_extract import parse_text


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
        self.assertEqual(out["ready_for_import_count"], 2)

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
