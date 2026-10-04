# 0014. Saves are refused if a field changed since the user started editing it

Status: Accepted (2026-10-04)

## Context

An Edit form can stay open while the same application is saved somewhere else: another tab (which now reloads the page, but not the form's own edits), or another device's data merged by import, and later by sync.

Scenario: tabs A and B both open Edit on R001, whose Notes say "x". B starts typing "Tab B". A changes Notes to "Tab A" and saves. B saves. B's form compares "Tab B" with the "x" it started from, sees a change, and writes it over "Tab A". Both tabs are the same device, so merge never sees two versions and the conflict log stays empty ([0002](0002-base-stamp-for-real-conflicts.md)). Tab A's note survives only as an old value in the change log, with no way to find it.

## Decision

- **The form keeps only the user's edits**, each with the stamp of the saved value it was made on (its base). Fields the user hasn't touched always show the latest saved value, so a save elsewhere updates them in the open form.
- **A conflict** is an edited field whose saved stamp is no longer its base, with a value different from the user's. The form shows each conflict with both versions ("Your edit", "Saved elsewhere") and two choices: **Keep my X** (the edit is re-based on the newer stamp, so saving it is a deliberate overwrite) or **Use saved X** (the edit is dropped). Save is blocked until every conflict is resolved. A notice inside the dialog lists what was saved elsewhere since the form opened, or says the record was deleted.
- **Repo enforces it**: `update(..., { expected })` lists, for each field the save may change, the stamp it must still have (or null for "no stamp yet"). The check runs inside the write transaction, so no other save can slip in between the check and the write. If any field differs, nothing is saved and `StaleEditError` names the fields. The form then reloads and shows the conflicts.
- Like undo ([0008](0008-stamp-based-undo.md)), the check compares stamps, never clock times.

## Alternatives considered

- **Last save wins.** Loses the first save silently, as in the scenario.
- **A version check on the whole record.** Would refuse a save whenever anything changed, even an unrelated field, though field-level merge already keeps both such edits.
- **Comparing `updatedAt` with the time the form opened.** Breaks with clock skew between devices, for the reasons in 0008.
- **Updating the form's fields only when the user asks ("Reload").** Keeps stale values on screen that the user may think are current.

## Consequences

- A save can be refused and needs a choice before it goes through.
- An untouched input is rebuilt when a newer save replaces its value; if it had focus, focus is lost. Typing in a field makes it an edit, so this never interrupts typing.
- Other forms (Targets, goals) should use the same pattern: `Edits` with base stamps, `saveRequest`, and `expected` on update.

## In the code

`StaleEditError` and the `expected` option in [repo.ts](../../src/data/repo.ts); `fieldState`, `withEdit`, `keepMine`, `takeSaved`, `saveRequest` in [applicationForm.ts](../../src/tracker/applicationForm.ts); [ApplicationDialog.tsx](../../src/tracker/ApplicationDialog.tsx). Tests: "refuses a stale edit…" in [repo.test.ts](../../src/data/repo.test.ts), [applicationForm.test.ts](../../src/tracker/applicationForm.test.ts), "editing the same application in two tabs" in [App.test.tsx](../../src/app/App.test.tsx).
