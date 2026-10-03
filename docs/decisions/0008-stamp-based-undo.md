# 0008. Undo compares stamps, never clock times

Status: Accepted (2026-10-03). Replaces a first version that ordered change log entries by time.

## Context

Undo puts back a change's old values. It must not overwrite work done since: if you changed a field again after the change being undone, that field should be left alone.

The first version decided "since" by comparing change log timestamps. That breaks when clocks misbehave:

- Scenario: you edit notes at 3:00 PM (change A). The clock is corrected back to 2:50, and you edit notes again (change B, logged at 2:50). Undo A: B looks older than A, so undo overwrites your newer edit.
- Across devices, a phone with a fast clock makes its changes look later than they were, or a laptop's look earlier.
- Two changes in the same millisecond can't be ordered at all.

## Decision

Each change log entry records `stamps`: the exact stamp it wrote on each field. To undo it, a field is restored only if its current stamp is still exactly that stamp. Anything that touched the field since, on any device, gave it a different stamp, so it is skipped and reported in `skipped`. No clock is compared.

Other undo rules:

- The undo is a new edit, logged as `undo`, so it can itself be undone.
- Undoing the same change twice does nothing the second time (the first undo changed the stamps).
- Undoing a creation soft-deletes the record. A purge can't be undone ([0003](0003-tombstones-for-purge.md)).

## Alternatives considered

- **Order by change log time.** The first version; fails as above.
- **Use `base`.** `base` ignores same-device edits by design ([0002](0002-base-stamp-for-real-conflicts.md)), so it can't tell that you edited the field again on the same device.
- **One shared stamp per write, compared with the log entry's own stamp.** Avoids a new field, but the clock-skew guard can give fields in one write different timestamps, and import entries are stamped at import time while their fields carry the other device's stamps.

## Consequences

- Change log entries are slightly larger.
- The UI must show skipped fields ("Notes changed since; not undone").

## In the code

`undo` in [repo.ts](../../src/data/repo.ts), `stamps` in `ChangeLogData` ([types/tables.ts](../../src/data/types/tables.ts)); tests in [undo.test.ts](../../src/data/undo.test.ts), including "even when the clock went backwards" and "two changes made in the same millisecond".
