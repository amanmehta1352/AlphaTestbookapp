# Data Architecture Audit and Improvement Plan

**Status:** Review document only. This audit does not change runtime behavior, question data, database schema, or deployment configuration.

## Scope reviewed

- `dev/app/src/js/02-taxonomy-core.js`: exam registry and taxonomy derivation.
- `dev/app/src/js/05-storage.js`: IndexedDB/localStorage persistence and import migration.
- `dev/app/src/js/06-sync-index.js`: metadata normalization and in-memory index rebuild.
- `dev/app/src/js/06b-data-core.js`: validated mutation/commit boundary.
- `dev/app/src/js/17-cloud-account.js`: cloud question ingestion and account state.
- `dev/app/src/js/17b-student-profile.js`: exam/branch profile and filtering.
- `dev/tests/test_profile.py` and `dev/tests/run_all.sh`: profile integration coverage and CI gate.

## Current architecture (observed)

1. The source manifest assembles a single HTML application from ordered JS/CSS/HTML fragments.
2. App state is held in in-memory singletons; IndexedDB is the primary persistence store, with localStorage fallback/migration.
3. `DataCore` is intended to be the single validated mutation boundary for question content.
4. `synchronizeTaxonomyEngine()` derives metadata and rebuilds the index from modules/questions.
5. Cloud rows are mapped into app question objects; student profile filtering currently expects one `examId` plus one optional branch.
6. The test runner first checks generated release parity, then runs browser/integration suites against a disposable source build.

## Findings and required improvements

### P0 — Canonical identifiers and taxonomy contracts

- Define and document one canonical ID format for exam, qualification, branch, subject, topic, question, and source records.
- Keep display labels separate from IDs; do not infer canonical IDs from changing display names in multiple places.
- Centralize normalization and validation, including aliases such as exam-name variants.
- Add fixtures for missing IDs, unknown IDs, duplicate IDs, legacy aliases, and bilingual labels.
- Make invalid or ambiguous metadata visible in an audit report rather than silently assigning a generic exam.

### P0 — Multi-exam student profile model

- Current profile/filter implementation is single-exam (`examId`). If product requirements allow multiple exams, introduce a versioned profile contract such as `qualificationId`, `branchId`, and `selectedExamIds[]`.
- Validate selected IDs against the server-provided exam index; reject empty, duplicate, unknown, or branch-incompatible selections.
- Update cloud query/filtering, labels, profile edit/clear, local persistence, and reload/hydration together.
- Define whether content is the union of selected exams, and deduplicate shared questions by canonical question ID.
- Add migration from the old `examId` field and preserve a safe rollback path.

### P0 — Question identity, provenance, and deduplication

- Require a stable canonical question ID independent of question wording, import file name, or list position.
- Preserve provenance fields: source file/reference, exam, year, shift, language status, import batch, and verification status.
- Use a deterministic content hash only as a duplicate-detection signal, not as the sole identity.
- Add explicit collision handling and tests for repeated imports, edited questions, and the same question legitimately appearing in multiple exams.

### P1 — Storage schema versioning and migration

- `AppStorage` currently uses one IndexedDB object store (`appData`) and a fixed DB version. Define explicit schema versions and migration functions before adding new persisted structures.
- Make migrations idempotent, observable, and recoverable; preserve legacy localStorage data until the migrated record is verified.
- Add quota/write-failure, blocked-upgrade, corrupted JSON, interrupted migration, and multi-tab tests.
- Avoid silently treating storage read/write failures as successful saves; surface durable-save status to the user.

### P1 — Atomic mutation and index consistency

- Keep all question writes behind `DataCore.commit/mutate`; prohibit direct content mutation or direct save calls from feature modules.
- Validate the candidate snapshot before exposing it as live state; ensure any validation, persistence, or index rebuild failure restores both data and indexes.
- Add tests that inject failures at validation, persistence, and index rebuild boundaries.
- Ensure indexes can be rebuilt deterministically from canonical source data and compared against stored counts.

### P1 — Cloud sync and data boundaries

- Define explicit DTOs and validation at the cloud-to-app boundary rather than allowing database row shape to spread through UI features.
- Paginated reads should detect repeated pages, unexpected row counts, and partial failures; never mark a partial sync as complete.
- Make sync operations idempotent and expose last-success, error, and partial-sync state.
- Keep server-side authorization/RLS as the security boundary; client filtering is for relevance, not access control.
- Add tests for expired sessions, pagination, missing fields, duplicate rows, and server/client schema drift.

### P1 — Data integrity observability

- Extend the integrity report to include unknown exam/branch/subject IDs, orphan topics/questions, invalid source metadata, duplicate canonical IDs, language completeness, and taxonomy mismatches.
- Separate blocking errors from warnings and include actionable record IDs.
- Export a machine-readable summary suitable for CI/Control Room without exposing student-sensitive data.

### P2 — Performance and maintainability

- Avoid repeated linear searches through all modules when building indexes; build a single owner map during synchronization.
- Define measurable performance budgets for startup, taxonomy rebuild, search, and large question-bank imports.
- Keep UI labels and exam catalog data separate from the engine code so exam lists can be maintained without changing core algorithms.
- Document data ownership and dependencies for each module in the manifest.

## Recommended implementation sequence

1. Add schema/identifier contract and integrity fixtures (no runtime behavior change).
2. Add a versioned profile DTO and backward-compatible migration for selected exams.
3. Add cloud boundary validation and robust pagination status.
4. Strengthen DataCore rollback/index consistency tests.
5. Add storage migration/failure tests and Control Room diagnostics.
6. Only after tests pass, plan any database migration separately with explicit rollback and approval.

## Verification gates for future implementation PRs

Run from repository root:

```bash
python3 dev/app/build.py index.html
python3 dev/app/build.py admin/index.html --studio
python3 dev/app/build.py --check
sudo -E bash dev/tests/run_all.sh
```

A documentation-only PR does not prove runtime fixes. Runtime changes must include targeted tests and a passing full CI run. Do not merge or deploy without human review.
