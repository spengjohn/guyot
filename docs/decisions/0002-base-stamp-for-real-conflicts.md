# 0002. A `base` on each stamp, so only real conflicts are logged

Status: Accepted (2026-10-03)

## Context

Integrity rule 1 says a losing value goes to the conflict log "if the same field changed on two devices". Comparing two stamps tells you which is newer, but not whether the newer edit was made with knowledge of the older one.

Scenario: the laptop sets keywords. The phone syncs, sees them, and edits them. When the laptop next merges, its old value loses. Nothing was lost: the phone saw it before editing. Without more information, this normal catch-up looks identical to a real conflict, and every ordinary sync would fill the conflict log with noise until the log is useless.

## Decision

Each stamp records `base`: the last stamp from **another** device that this edit replaced. Repeated edits on the same device carry the same `base` forward.

A losing value goes to the conflict log only if all of these hold:

- it differs from the winning value,
- it isn't a default (stamp 0, see [0004](0004-zero-stamped-defaults.md)),
- the winner came from a different device,
- the winner's `base` is not the loser's stamp (the winner wasn't built on top of it).

## Alternatives considered

- **Log every losing value from another device.** Correct but floods the log with false conflicts on every normal sync.
- **Version vectors per field** (a counter per device). Exact, but larger records and more complex code for a small gain.
- **Order by `base` time** (a loser older than the winner's base is an ancestor). Rejected: it can hide a real concurrent edit and lose data silently. We use exact equality only.

## Consequences

- With three or more devices, a false positive is possible (A's value overwritten by B, then by C, merged back on A). False positives are safe: the value is kept for review. False negatives would lose data, so the rule errs toward logging.
- `base` deliberately ignores same-device edits, so it can't answer "has this field changed since?" Undo needs that, so it uses a separate mechanism ([0008](0008-stamp-based-undo.md)).

## In the code

`stampEdit` in [stamp.ts](../../src/data/stamp.ts), `isRealConflict` in [merge.ts](../../src/data/merge.ts); tests "an edit made on top of the other device's value is not a conflict" and "several edits in a row on one device" in [merge.test.ts](../../src/data/merge.test.ts).
