# 0004. App-filled values are stamped 0

Status: Accepted (2026-10-03)

## Context

Some values are filled in by the app, not the user: the empty starting values of the shared-targets record, and new fields added by a data migration.

Scenario: you fill in shared targets on the laptop at 2:00 PM. At 3:00 PM you open Guyot on your phone for the first time, before it has synced. The phone creates shared targets with empty values. If those are stamped 3:00 PM, they are "newer", and the next sync wipes your real targets.

The same happens with migrations: device A upgrades and you fill in the new field; device B upgrades later and stamps its default "now", overwriting your value.

## Decision

Values the app fills in are stamped `updatedAt: 0` (`defaultStamp`). Only real edits get a real timestamp, so any real edit beats a default. A zero-stamped value never goes to the conflict log, and a default is never used as a `base`.

Migrations add fields only through `addField`, which applies this rule.

## Alternatives considered

- **Don't create the record until the first edit.** Not enough on its own: the phone's first edit (say, dealbreakers) would create the record with every other field stamped "now", and the empty keywords would still win.

## Consequences

- Validation accepts 0 as a timestamp.
- "Reset" must not use default stamps: it saves empty values as real edits, so the reset wins on other devices too.

## In the code

`defaultStamp` in [stamp.ts](../../src/data/stamp.ts), `getSharedTargets` in [repo.ts](../../src/data/repo.ts), `addField` in [migrate.ts](../../src/data/migrate.ts); tests "defaults never beat real edits" in [merge.test.ts](../../src/data/merge.test.ts) and the upgrade-default test in [migrate.test.ts](../../src/data/migrate.test.ts).
