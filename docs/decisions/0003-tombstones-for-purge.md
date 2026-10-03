# 0003. Permanent removal leaves a tombstone

Status: Accepted (2026-10-03)

## Context

Deletes are soft (`deleted: true`), with undo and a "recently deleted" view. Users also need a deliberate permanent removal (purge), for privacy.

Scenario: you purge a record on the laptop. The phone still has it. On the next sync, the laptop sees a record it doesn't have and adds it back. The purge silently undoes itself.

## Decision

Purge replaces the record with a **tombstone**: the `id` and sync fields stay, with `deleted: true, purged: true`, and every data field is removed. Purge always wins on merge, whatever the timestamps. Purge also clears the record's old values from the change log and removes its conflict log entries, and log entries about a purged record are scrubbed when they arrive from another device.

Purge requires the record to be deleted first. It cannot be undone.

## Alternatives considered

- **Hard delete.** Brings the record back on the next sync, as above.
- **Purge as a normal stamped field.** A later edit on another device would beat it and resurrect the data.

## Consequences

- Tombstones stay forever (they are small). A later "compact" option could drop very old ones once all devices have seen them.
- TypeScript models a stored record as `LiveRecord | Tombstone`, so code must check `purged` before reading data fields.
- Old data can also live in the change log, so purge must scrub it there too, or the data isn't really gone.
- A future bulk purge (for example, everything except resumes) reuses this path.

## In the code

`purge`, `scrubLogs` and `scrubbed` in [repo.ts](../../src/data/repo.ts), `mergeTombstone` in [merge.ts](../../src/data/merge.ts); tests in [repo.test.ts](../../src/data/repo.test.ts) and "purged data stays gone" in [exportImport.test.ts](../../src/data/exportImport.test.ts).
