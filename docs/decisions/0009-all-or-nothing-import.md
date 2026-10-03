# 0009. Imports run in one transaction

Status: Accepted (2026-10-03)

## Context

Integrity rule 3: an invalid file is rejected whole, never half-applied. Validating the file first catches almost everything, but a record can still fail during the merge itself (for example, a shared-targets record marked deleted passes the record checks but is refused by the merge).

Scenario: 300 records are imported one transaction each, and record 200 fails. Records 1–199 are saved and the rest aren't: a half-applied file.

## Decision

`saveMergedMany` merges every record in a single read-write transaction over all stores. If anything throws, the transaction is aborted and nothing is saved. The whole file is validated before the transaction starts.

Field definitions are merged first, and the validation context is reloaded, so later records' custom values are checked against them.

## Alternatives considered

- **One transaction per record.** Simpler code, but half-applies on failure.
- **Stage into a temporary store, then swap.** All-or-nothing too, but more code and twice the storage.

## Consequences

- Inside the transaction, code may wait only on IndexedDB requests (see [data-layer.md](../data-layer.md#how-a-write-flows)).
- A very large import holds one long transaction. Fine for job-search data sizes; revisit if imports grow large.

## In the code

`saveMergedMany` in [repo.ts](../../src/data/repo.ts), `importJson` in [exportImport.ts](../../src/data/exportImport.ts); test "rolls back records already merged when a later one fails" in [exportImport.test.ts](../../src/data/exportImport.test.ts).
