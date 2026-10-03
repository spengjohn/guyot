# 0001. Merge field by field, with a stamp on every field

Status: Accepted (2026-10-03)

## Context

There is no server to decide whose version is right. The same record can be edited on a laptop and a phone while offline, and the two copies must later be merged by each device on its own. Data integrity is the top priority.

Scenario: on the laptop you add a note to an application; on the phone you change its status. With record-level "newest wins", the newer copy replaces the whole record and one of your edits disappears.

## Decision

Every field carries its own stamp in `fieldMeta`: `{ updatedAt, deviceId, base }`. Merging compares stamps field by field. For each field, the newer stamp wins; ties go to the larger `deviceId`, so every device reaches the same answer. A losing value that someone actually changed goes to the conflict log ([0002](0002-base-stamp-for-real-conflicts.md)).

Map-like fields (`custom`, profile `overrides`, field `choices`) get one stamp per entry (`custom.<fieldId>`), so adding one custom value on each device keeps both.

`deleted` is a field like any other, so a delete on one device and an edit on another both survive.

The record-level `updatedAt` and `deviceId` are derived: they are the newest field stamp.

## Alternatives considered

- **Record-level newest wins.** Simple, but loses concurrent edits to different fields, which is the common case.
- **CRDTs or operation logs.** Merge anything automatically, but are complex, need a library or a lot of code, and make stored data hard to read and export. Field-level stamps give nearly all the benefit for job-search data, which is mostly short independent fields.

## Consequences

- Every write must stamp exactly the fields it changes, and nothing else. Stamping an unchanged field would let a stale value win a merge. `applyChanges` in repo.ts compares values first.
- Lists (keywords, locations) are one field each: if two devices edit the same list, one whole list wins and the other goes to the conflict log.
- Merge is a pure function, so imports and sync share it and it can be tested without storage.

## In the code

[merge.ts](../../src/data/merge.ts), [stamp.ts](../../src/data/stamp.ts); tests in [merge.test.ts](../../src/data/merge.test.ts).
