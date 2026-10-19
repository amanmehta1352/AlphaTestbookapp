# Qualification-First Exam Hub — Source Audit

Date: 2026-10-19
Repository scope: primary AlphaTestbookapp only. Control Room was excluded.

## Focused source findings

- The app already has a student profile using exam ID and optional branch, but profile setup was an optional prompt/modal rather than a required post-login step.
- The existing cloud question sync builds a data-driven exam/branch index from rows available to the signed-in student, applies profile filtering, then uses DataCore to commit the filtered content. The change reuses that path and adds no second question store.
- The Universal Exam Hub listed all registered exam cards. The student view now filters technical-branch cards to exams whose indexed published question rows contain the selected branch.
- Existing app UI classes are reused for the qualification page: pf-grid, pf-opt, student-hero-card, section-title, pf-actions and gx-note. No new CSS design system or full-screen redesign was added.
- The root index.html and admin/index.html are generated release outputs; both are regenerated on this feature branch to match the updated source manifest. Neither file was hand-authored, and main/live deployment was not changed. The PR does not alter Control Room source, question rows, database schema, import robots or release workflows.

## Intended flow

1. A first-time signed-in non-admin competitive student is routed to Qualification Setup.
2. The student chooses an education level and, for technical post-secondary choices, an engineering branch.
3. The existing Exam Hub shell presents exams with published-question coverage for the chosen technical branch.
4. Selecting an exam saves its exam ID together with the qualification/branch and reuses the existing server profile filter for the selected exam plus branch/common-subject rows.
5. The Home chip provides a way to change qualification later.

## Data and eligibility guardrails

- Branch availability and counts are derived from indexed rows currently visible through the student session and RLS; no question row is changed by this feature.
- Before a student chooses a qualification, login sync fetches only exam/subject metadata for the profile index; full stems/options are not pulled into the device question bank. After a qualification is saved, the existing branch filter selects the relevant published content.
- Common subjects are retained by the existing branch filter, but after an exam is selected the content is scoped to that exam and the selected branch plus common subjects.
- Matching question coverage is not proof of official recruitment eligibility. The app explicitly tells students to verify the current official notification.
- For non-technical levels, this patch stores qualification but does not invent an official qualification-to-exam eligibility table. A validated eligibility catalogue is a separate data requirement.
- If the branch index is absent, the branch-filtered Exam Hub does not claim that every exam matches; it shows the no-matching-content state.

## Test plan / sign-off status

- Updated the profile end-to-end test for Diploma → Mechanical → Exam Hub, other-branch exclusion, selected-exam scoping, persistence and unchanged shell controls.
- Updated student login integration tests to complete the new qualification step before returning to their previous home-based assertions.
- Static JavaScript parsing was checked for the new renderer module. The full source build, Playwright suite and GitHub Actions result remain pending until the pull request checks finish.

## Broader app audit status

The repository-level audit register in dev/APP_AUDIT_2026-10-18.md remains in Phase 1 evidence collection and lists separate unresolved release-provenance, content-hygiene, mobile-accessibility and workflow-reliability risks. This scoped feature audit does not certify the entire app or live production release as audit-clean.