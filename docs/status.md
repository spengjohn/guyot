# Status

Last updated: 2026-10-03, at the end of build step 1.

The build order is in [CLAUDE.md](../CLAUDE.md#build-order). This page tracks where each step stands.

## Step 1: Data layer — done

Everything lives in [src/data/](../src/data/). There is no user interface for it yet. See [data-layer.md](data-layer.md) for a tour.

Built:

- Sync-ready records: every field carries a stamp (`updatedAt`, `deviceId`, `base`) for field-level merge.
- Field-level merge with real-conflict detection and a conflict log.
- Hand-written validation of every write, every import and every synced file.
- IndexedDB storage: create, update, soft delete, restore, purge (with tombstones).
- Change log with undo, and conflict restore or dismiss.
- Shared targets as a fixed-ID singleton with default-stamped starting values.
- Role IDs (R001, R002...) with collision renumbering.
- JSON export and import (all-or-nothing, upgrades older files).
- Automatic local backup before data migrations; migration framework (no migrations yet).
- 87 tests (Vitest with fake-indexeddb), run in CI.

Deferred, with reasons:

| Item                                                                     | Why it waits                                                      | Planned for     |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------- | --------------- |
| Restore from a backup                                                    | Replaces all current data, so it needs a confirm screen           | Step 2 (UI)     |
| Built-in choice options (e.g. Status values) checked against their lists | Needs `builtinFields.ts`, which comes with the Applications table | Step 2          |
| Synced settings                                                          | Settings are local only for now                                   | Step 3 or later |
| Encryption                                                               | Only needed once data leaves the browser                          | Step 3 (sync)   |

Known limits:

- Undo is skipped for any field touched since the change (by design, see [ADR 0008](decisions/0008-stamp-based-undo.md)); the UI will need to explain skipped fields.
- Conflict log entries for values removed from map fields (e.g. a cleared custom value) record the losing value as `null`.

## Step 2: Tracker and dashboard — next

Applications table, KPI tiles, goal tracker with pace, charts, "needs attention" list, job description snapshots, Targets screen and column picker. A plan will be shown for review before work starts.

## Steps 3–9

Not started.
