# Diploma-Level PYQ Campaign Source Manifest (2020–2026)

Updated: 2026-10-18
Repository: amanmehta1352/AlphaTestbookapp
Campaign tracker: https://github.com/amanmehta1352/AlphaTestbookapp/issues/18
Importer: https://github.com/amanmehta1352/AlphaTestbookapp/actions/workflows/pyq-robot.yml

## Import safety contract

- Destination is Supabase `questions.status='draft'` only. Never publish automatically.
- Preserve source URL, exam name, year, branch, paper/shift metadata wherever present.
- Deduplicate before insert; never modify existing/published rows.
- No invented questions, options, answer keys, translations, years, or shifts.
- For bilingual imports, require English and Hindi question text plus all A–D options and a defensible answer key.
- Unclear, diagram-dependent, incomplete, login-only, or time-expired papers remain `NEEDS-REVIEW` / `ACCESS-LIMITED`.
- The current `robot.py` is primarily an SSC JE response-sheet and bilingual RRB JE CBT PDF importer. Do not assume every archive PDF is compatible.

## Official source inventory

| Exam family | Official source | Coverage / notes | Current status |
|---|---|---|---|
| SSC JE | https://ssc.gov.in/home/answer-key | Official answer-key and response-sheet notices. Current page lists SSC JE 2025 Paper-II final answer keys with question papers/response sheets and SSC JE 2023 response-sheet notices. Candidate response-sheet availability may be time-limited. | FOUND; individual downloadable links need compatibility check |
| SSC JE legacy archive | https://ssc.nic.in/Portal/AnswerKey | Official legacy archive lists SSC JE 2020 Paper-I final answer keys with question papers and SSC JE 2020/2023 notices. | FOUND; paper-specific link extraction required |
| RRB JE / DMS / CMA | https://rrbsecunderabad.gov.in/ | Official RRB notices, including CEN 05/2025. CBT response/answer-key windows may require candidate login and may expire. | FOUND; public PDF availability varies |
| RRB Kolkata notices | https://www.rrbkolkata.gov.in/cen052025.php | Official CEN 05/2025 notice page. | FOUND; check for actual public question PDFs before importing |
| ISRO all-centre archive | https://www.isro.gov.in/OldQuestionPapers.html | Official archive links to SAC, SHAR, VSSC and PRL question-paper collections. | FOUND |
| ISRO PRL papers | https://new1.isro.gov.in/Prl_old_questionPapers.html | Official page lists 2025 Technical Assistant Civil/CS-IT/Electrical/Electronics/Mechanical and Technician-B trades, plus older papers. | FOUND; not assumed compatible with current robot |
| ISRO SHAR/SDSC papers | https://apps.shar.gov.in/sdscshar/prevQuesPapers.jsp | Official archive lists Technical Assistant Mechanical papers including 2022 and 2024, plus other technical roles. | FOUND; each linked PDF needs extraction/key QA |
| ISRO HSFC / technical papers | https://new1.isro.gov.in/HSFCRecruitment2.html | Official page lists 2022 Technical Assistant Mechanical/Electronics and Technician-B Fitter question papers and final answer keys. | FOUND; paper-specific downloads need validation |
| ISRO IPRC careers archive | https://www1.iprc.gov.in/en/careers | Official career page includes 2022 Technical Assistant Mechanical and other technical recruitment records. | FOUND; exact paper/answer-key availability varies |
| DRDO | https://drdo.gov.in/drdo/en | Official recruitment entry point. Do not mark a paper available until a public question paper/answer key is located. | SOURCE INDEX FOUND; papers require individual discovery |
| BHEL | https://careers.bhel.in/ | Official careers entry point; public previous question papers are not guaranteed. | SOURCE INDEX; papers require individual discovery |
| State JE / Technical Assistant | Respective state recruitment-board official portals | Include only diploma-eligible recruitment and verifiable public papers/keys; track each state/exam separately. | DISCOVERY REQUIRED |

## Year scope

Target: 2020–2026 inclusive. As of 2026-10-18, include only exams/papers already conducted and publicly released; do not imply future 2026 papers are available.

## Workflow compatibility warning

The current workflow accepts one or more HTTPS PDF links or public document pages that link to PDFs. It does not crawl these archive pages as a full search engine, and a page being listed here does not mean it was imported. The importer currently has strict SSC JE response-sheet and bilingual RRB JE extraction paths. Do not feed arbitrary ISRO/DRDO/PSU PDFs into a real import until a dry run proves that extraction, answer key, and bilingual checks pass.

## Status definitions

- FOUND: official archive/notice page exists.
- ACCESS-LIMITED: login or temporary candidate-specific response sheet required.
- READY-FOR-DRY-RUN: actual public PDF URL identified and format appears supported.
- IMPORTED-DRAFT: confirmed workflow summary reports new draft rows.
- NEEDS-REVIEW: missing key, bilingual content, diagram, incomplete metadata, or unsupported format.
- NOT-FOUND: no official public source found after a documented search.

No source should be marked IMPORTED-DRAFT without a successful workflow run summary.


## Direct paper links discovered (2026-10-18)

These are concrete source URLs found during the next discovery pass. They are source candidates, **not yet imported**. Each must be run through the supported parser and bilingual/answer-key checks before any Draft insert.

| Exam / year | Paper / source | Direct URL | Current disposition |
|---|---|---|---|
| SSC JE 2020 | Official SSC legacy answer-key archive entry for JE 2020 Paper-I question papers and final keys | https://ssc.nic.in/Portal/AnswerKey | Archive entry confirmed; extract the paper-specific download URL and test access/format |
| ISRO HSFC 2022 | Technical Assistant Mechanical, Booklet A (official bilingual question booklet) | https://www.isro.gov.in/media_isro/pdf/recruitmentNotice/2022_Sep/ta-01_a-mechanical.pdf | Direct official PDF found; parser compatibility and matching final answer key must be validated |
| ISRO PRL 2025 | Technical Assistant Mechanical archive entry | https://www.isro.gov.in/ISRO_HINDI/Prl_old_questionPapers.html | Official archive lists the paper; extract exact PDF URL and validate key |
| RRB JE 2024 | Official CEN 03/2024 JE notices and CBT question/response/key window | https://www.rrbcdg.gov.in/2024-03-je.php | Official notice confirmed; candidate response-sheet window may be closed, so public reusable PDF availability is not assumed |
| RRB JE / DMS / CMA 2024 | Official RRB Secunderabad notice index | https://rrbsecunderabad.gov.in/ | Official notice index confirmed; locate any still-public question-paper links; login-only response sheets are ACCESS-LIMITED |
| ISRO SHAR | Official previous-question-paper archive | https://apps.shar.gov.in/sdscshar/prevQuesPapers.jsp | Archive identified; collect paper-specific URLs and verify answer keys |

### Evidence from current discovery pass

- SSC's official legacy archive explicitly lists SSC JE 2020 Paper-I question papers with final answer keys.
- ISRO's official HSFC page publishes the 22 May 2022 Technical Assistant (Mechanical) booklet sets and final answer keys.
- ISRO's official PRL archive lists a 2025 Technical Assistant (Mechanical) paper.
- RRB official 2024 notices confirm CBT question-paper/response/key windows, but those candidate-specific windows are not equivalent to permanently public PDF files.

### Import status (do not overstate)

No new question has been inserted into Supabase by this discovery pass. The workflow is `workflow_dispatch` only and needs an actual GitHub Actions dispatch with the PDF URLs; a manifest edit or successful dry-run is not a Draft import. Keep candidate links at FOUND until the Robot validates them, and mark IMPORTED-DRAFT only after the workflow confirms inserted draft rows.
