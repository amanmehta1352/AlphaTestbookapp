# Foundation (v1)

## Scope (fixed until launch has traction)
All diploma-level exams, all branches. Content = official PYQ only (label `PYQ`), our own questions are labelled `Practice`.

## The tree (everything hangs on this)
exam → paper (year / shift) → branch → subject → topic → question.
Common subjects (Maths, Reasoning, General Science, GK) have `branch_id = NULL` = shared by all branches.
Adding an exam/branch/topic = data, no code change.

## Tables (db/migrations/0001_core.sql)
exams (pattern as JSON: sections, minutes, marks, negative) · branches · exam_branches · subjects · topics ·
sources (official paper/key, with url + sha256 + verified_at) · questions (kind pyq|practice, bilingual stem/options/solution JSON,
status draft|published|hidden, content_hash; a `pyq` MUST have a source) ·
profiles (exam, branch, target date, daily minutes, language) · attempts · revision_cards (spaced repetition 1-3-7-15-30 days).
RLS: reference data + published questions readable by all; profiles/attempts/revision_cards only by their owner.

## Why this survives growth
- Per-user data is keyed by user + question id, never by screen → new screens reuse it.
- Exam pattern lives in data → new exam needs no new code for timer/marking.
- Bilingual is a field (`{"en":..,"hi":..}`), not a second copy of the app.
- Roles (guardian/teacher/admin) come later as a new table; student tables don't change.
- Alerts, plans and reports are computed from `attempts` + `profiles` — no new storage needed.

## Screens (design rule: one purpose per screen)
Home asks one thing: today's mission (+ one big button). Tabs: Today · Practice · Progress; the rest under "More".
Layouts by width: phone 360–412 (bottom bar) · tablet ≥768 (question + palette side by side) · laptop ≥1100.
One web app serves all three; Android = TWA wrapper later.

## Content pipeline (robots, later)
official PDF → extract → tag topic → Hindi → key-check → human review → publish. Each step is its own script reading/writing `questions.status`.
Seed already prepared: 1399 RRB JE CBT-1 PYQ (bilingual, topic-tagged, official keys) — import after schema is applied.

## Path to Play Store
1 web app live (HTTPS) → 2 installable (manifest + service worker) → 3 TWA (.aab) built by a GitHub robot →
4 Play Console account ($25, user's ID check) → 5 closed test: ≥12 testers for 14 days → 6 production.
Needs: privacy policy, account-delete page, data-safety answers. Under-18 users only after guardian-consent design + legal check.

## How to know it is better than the big apps
Measure, don't guess: time to first solved question (<30 s), 5-second purpose test, day-7 return rate, solved questions per student per day,
side-by-side with 20–30 students for a week.

## Not built yet (on purpose)
Login, payments, guardian/teacher roles, smart alerts, OCR. Each is an additive migration + new files.
