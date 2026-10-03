# 0007. Conflict log IDs are derived from the conflict

Status: Accepted (2026-10-03)

## Context

Both devices merge each other's files, and merge is deterministic, so both find the same losing value. If each device logs it under a random ID, then after the next sync the user sees the same conflict twice.

## Decision

A conflict entry's ID is a hash of what the conflict is about: table, record ID, field key, and the losing stamp. Both devices produce the same ID, so the two entries merge into one. If an entry with that ID already exists, it isn't logged again (and a resolved one stays resolved).

The hash (cyrb128) is synchronous, because the conflict is logged inside an IndexedDB transaction, and waiting on async `crypto.subtle` would let the transaction close early. It is not used for security.

## Alternatives considered

- **Random IDs, deduplicate in the UI.** Leaves duplicates in storage and in exports, and resolving one copy leaves the other open.
- **SHA-256 via `crypto.subtle`.** Async, so it can't run inside the transaction without restructuring every write.

## Consequences

- The ID is formatted as a version 8 (custom) UUID so it passes the same validation as other IDs.

## In the code

`deterministicId` in [ids.ts](../../src/data/ids.ts), `logConflict` in [repo.ts](../../src/data/repo.ts); test "logs a real conflict once, with an ID every device agrees on" in [repo.test.ts](../../src/data/repo.test.ts).
