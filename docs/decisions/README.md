# Decision records

Each record explains one design decision: the problem, what we chose, what we rejected and why. Read the relevant record before changing the behavior it describes. Many of these exist because the obvious simpler approach loses data in a specific scenario, and the record names that scenario.

| #                                             | Decision                                                  |
| --------------------------------------------- | --------------------------------------------------------- |
| [0001](0001-field-level-merge.md)             | Merge field by field, with a stamp on every field         |
| [0002](0002-base-stamp-for-real-conflicts.md) | A `base` on each stamp, so only real conflicts are logged |
| [0003](0003-tombstones-for-purge.md)          | Permanent removal leaves a tombstone                      |
| [0004](0004-zero-stamped-defaults.md)         | App-filled values are stamped 0                           |
| [0005](0005-clock-skew-guard.md)              | An edit is always newer than the value it replaces        |
| [0006](0006-fixed-id-singletons.md)           | Shared targets use a fixed ID                             |
| [0007](0007-deterministic-conflict-ids.md)    | Conflict log IDs are derived from the conflict            |
| [0008](0008-stamp-based-undo.md)              | Undo compares stamps, never clock times                   |
| [0009](0009-all-or-nothing-import.md)         | Imports run in one transaction                            |
| [0010](0010-hand-written-validation.md)       | Validation is hand-written, not a schema library          |
| [0011](0011-role-id-collisions.md)            | Role ID collisions are renumbered deterministically       |
| [0012](0012-profile-overrides.md)             | Profile overrides: list mode and items are one value      |
| [0013](0013-fixed-builtin-choices.md)         | Built-in choice options are fixed, and checked strictly   |
| [0014](0014-stale-edit-check.md)              | Saves are refused if a field changed since editing began  |
| [0015](0015-restore-as-edits.md)              | Restoring a backup applies it as new edits                |

## Adding a record

Copy this outline into `NNNN-short-name.md` (next number) and add it to the table:

```md
# NNNN. Title

Status: Accepted (YYYY-MM-DD)

## Context

The problem, and the scenario that makes it matter.

## Decision

What we do.

## Alternatives considered

What else we looked at, and why not.

## Consequences

What this costs or commits us to.

## In the code

Files and tests.
```

If a decision is replaced, keep the old record, set its status to "Superseded by NNNN", and link both ways.
