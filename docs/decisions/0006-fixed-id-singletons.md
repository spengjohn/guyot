# 0006. Shared targets use a fixed ID

Status: Accepted (2026-10-03)

## Context

Most tables hold many records, each with a random UUID. Shared targets is meant to be exactly one record. Merge matches records by `id`.

Scenario: the laptop creates shared targets with a random ID; before syncing, the phone creates its own with a different random ID. After sync there are two "shared targets" records, with no rule for which applies, and your keywords and dealbreakers sit in separate records.

## Decision

The shared-targets record uses one ID hard-coded in the app (`SHARED_TARGETS_ID`). Every device creates the same record, so merge combines them field by field. The ID only needs to be unique within one person's data, so every user having the same one is fine.

Rules that come with it:

- Its starting values are default-stamped ([0004](0004-zero-stamped-defaults.md)), because several devices create it independently.
- It can't be created through `create`, deleted or purged. A soft-deleted singleton would be a trap. "Reset" clears its fields as real edits.
- Imports and validation reject a shared-targets record with any other ID, or one marked deleted.
- Only synced records there is exactly one of get fixed IDs. Local stores (`meta`, with the device ID) never do: every device needs its own device ID.

## Alternatives considered

- **Random ID, merge "all shared-targets records" by table.** Special-case merge logic for one table, and still leaves two records on disk.

## Consequences

- If targets are ever shared as templates, importing one must deliberately replace your values after review, stamped as new edits, not merge someone else's stamps into yours.

## In the code

`SHARED_TARGETS_ID` in [constants.ts](../../src/data/constants.ts), `getSharedTargets` and `resetSharedTargets` in [repo.ts](../../src/data/repo.ts); tests "shared targets" in [repo.test.ts](../../src/data/repo.test.ts).
