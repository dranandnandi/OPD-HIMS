Visit classifications are stored on `visits.visit_type`: `new`, `follow_up`, or
`emergency`. NULL means Unclassified, retained for historical records where the
category is unknown. This describes the encounter, independently of the patient's
first registration date, the next planned follow-up date, and fees.

Production database release: applied `20261107091500_visit_types.sql` on
7 November 2026 to the linked `Clinic_suite_india` project. Migration history,
column constraint, insert trigger, and reporting index were verified. The release
checked that visit count and existing clinical fields were preserved. Backfill
classified 79 visits as New and 5 as Follow-up; 1,022 historical visits remain
Unclassified. No other migration was applied by this release. Audit:
`output/visit-types-20261107/database-release.json`.

Apply `supabase/migrations/20261107091500_visit_types.sql` before releasing the
frontend. The migration backfills only recognized appointment categories linked
to the same patient and clinic. Walk-ins and custom/unknown appointment types stay
unclassified. Do not infer follow-up from visit order or the presence of a future
follow-up date. Historical visits can be classified through Edit Visit.

The shared working tree also contains the transactional visit-save change in
`20261107110000_atomic_visit_save.sql`. Release its matching frontend and migration
together, after the visit-type migration; the transaction also stores `visit_type`.

New manual and scanned visits have the same Visit Type selector in the EMR form.
Walk-ins start as New Visit; linked appointments prefill recognized types, including
renamed labels whose configured ID remains a standard category. Unknown types need
an explicit selection. Staff may override the suggestion. Changing an appointment
later does not change a saved visit's type. An insert trigger also prefills linked
appointments for other visit writers without replacing explicit classifications.

Patient Visits shows a type column, type filter, and counts for the current filters.
Export Visit MIS creates an Excel workbook with a summary and the matching visit
register. Unclassified is included in both to reconcile totals. Date filters use
local calendar days including the entire end date. Visit and related-data loading
is paginated to avoid silently truncated totals at the PostgREST row limit.

No appointment fee configuration, billing calculation, or pricing behavior changes
in this phase. Future pricing can consume the stored category separately.
