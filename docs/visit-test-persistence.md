# Visit test persistence

Manual entry and Edit Visit both render `src/components/Patients/EMRForm.tsx` through `AddVisitModal`. Each test-name keystroke writes to `formData.testsOrdered[index].testName`; catalogue selection writes the name and type. There is no separate per-test Save action. The visit Save/Update handler sends the array to `visitService`.

## Causes found in the source

- Creation posted `test_name` to `tests_ordered`, but the supplied schema, database types, readers and edit writer use the quoted database column `"testName"`. A new visit with tests therefore had an invalid child insert.
- Supabase resolves many database failures as `{ error }` responses. Both writers awaited `Promise.all` without examining those errors. The parent visit could succeed while tests failed, followed by a success alert and form closure.
- Edit deleted all tests before inserting replacements. The operations were separate transactions. A failed insert could leave no tests; a failed deletion (for example, a linked result foreign key) was also ignored. Successful replacement changed test IDs and discarded master-test links.
- Related SELECT errors were converted into empty arrays. Editing after a failed tests read could make existing tests appear absent and submit an empty list.
- Blank test names were silently filtered out on save. A partially completed row could disappear without an explanation.

These explain different behavior across create/edit and across tests with/without results. This audit used the repository and supplied schema, not production request logs.

## Implemented behavior

`buildVisitSavePayload` uses one serialization path for creation and editing. The request is now a single POST through Supabase RPC to `/rest/v1/rpc/save_visit_with_details`, containing:

```json
{
  "p_visit_id": "existing visit UUID, or null for creation",
  "p_visit": { "patient_id": "patient UUID", "chief_complaint": "..." },
  "p_details": {
    "tests_ordered": [{
      "id": "stable test UUID",
      "test_id": "catalogue UUID, or null for custom text",
      "testName": "CBC",
      "test_type": "lab",
      "instructions": "Fasting",
      "urgency": "routine",
      "status": "ordered",
      "ordered_date": "2026-11-07T10:00:00.000Z",
      "expected_date": null
    }]
  },
  "p_request_id": "request UUID reused on an identical retry",
  "p_expected_updated_at": "exact timestamp loaded for editing, or null"
}
```

New forms also send a stable `p_visit.id`. A changed retry after an ambiguous commit cannot create another visit. Identical retries use a transaction receipt and return the already-saved ID. Receipts retain a payload fingerprint, not a second copy of clinical content.

The database function runs as the authenticated caller with RLS enabled. It validates patient/doctor/appointment ownership and writes the parent and supplied details in one transaction. Any rejected child write rolls everything back. Omitted detail arrays remain unchanged; an explicit empty array requests removal. Test upserts retain IDs and master links. Tests with saved results cannot be removed by this form. Existing results remain under the lab/results workflow.

Edits lock the visit row and compare its exact `updated_at` timestamp with the form's loaded version. Stale forms receive an error. This detects other visit saves; independent writers that change child records without touching the visit timestamp are outside that version check.

The frontend validates every test row, keeps errors and entered values visible, disables form controls during a save, and closes only after the RPC and visit reload succeed. Suggestions are buttons that support pointer and keyboard selection. Selecting a catalogue test retains its ID; custom typing clears the catalogue link.

Related read failures now reject the visit load instead of presenting incomplete details as empty arrays. LIMS submission remains asynchronous and separate from OPD persistence: the existing integration logs delivery failures and skips a visit that already has an accepted/sent/completed lab order, including newly added tests on that visit. External lab delivery is not guaranteed by a successful OPD save.

## Release and verification

Apply `supabase/migrations/20261107110000_atomic_visit_save.sql` before releasing the frontend. It depends on the existing visit schema, including `visit_type` and prescription `route`. Keep the function and receipt table if rolling back the frontend; no historical clinical rows are rewritten by this migration. The new frontend intentionally reports an error if its RPC is unavailable.

Run `npm run test:visits` and `npm run build`. Tests execute the real form handlers, mock service failure responses, and exercise the SQL migration in PGlite with enums, foreign keys and clinic RLS. Coverage includes rollback, custom names, blank rows, stable test/catalogue IDs, linked results, partial updates, stale edits, lost-response retries, duplicate prevention, and denied deletions.

Historical tests rejected by the old writer were never stored in `tests_ordered`; this migration cannot reconstruct them. Recovery would require original case papers, retained browser/network evidence, PDFs or other existing source records.
