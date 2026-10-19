# Home Dashboard 60/30/10 — Live Implementation Audit

## Purpose
Translate PR #37's static design preview into the actual student Home page without copying illustrative numbers, mock test scores, fake vacancies, or non-working AI controls.

## Source integration
- The existing student dashboard renderer remains the source of all Home content and click handlers.
- The new JavaScript adapter groups existing hero, primary action, quick actions and search into a main column; existing follow-ups and study widgets become the secondary column.
- The new CSS provides a responsive 60/30/10-inspired layout. Existing app header and bottom navigation are retained; no duplicate sidebar or bottom dock is added.
- Progress, subject, revision and history sections remain full width to preserve readability.
- The manifest and generated student/Admin HTML bundles are changed on this feature branch only. Main remains untouched until a separate merge.

## Data and behavior safety
- Every displayed metric continues to come from existing dashboard helpers and saved attempt/result/revision state.
- All buttons continue to use existing routes and callbacks. No fake AI assistant, fake vacancy list, fake test result or new storage model is introduced.
- No question rows, RLS policy, Supabase schema, robot workflow, Control Room source or publishing path is modified.

## Verification status
Static JavaScript syntax and manifest references are checked in the PR workflow. Responsive tests should cover the two-column desktop layout, mobile single-column layout, existing Home controls and horizontal overflow. Actual GitHub Actions results must be reviewed before merge; merge/live deployment is not automatic.
