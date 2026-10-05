# 0015. Restoring a backup applies it as new edits

Status: Accepted (2026-10-04)

## Context

The app keeps the newest few automatic backups, made before every data upgrade, before a restore, or on request. Restoring one should bring the data back to how it was. The obvious way is to put the backup's records back exactly, stamps and all.

Scenario: on Monday you back up. On Tuesday you edit an application on the laptop and sync with the phone. On Wednesday you restore Monday's backup on the laptop. Put back exactly, the laptop's records now carry Monday's stamps, which are older than Tuesday's. At the next sync, the phone's Tuesday values win every merge (newest stamp wins, [0001](0001-field-level-merge.md)), and the restore is silently undone. Records created on Tuesday aren't in the backup at all, so the phone brings them back. Even with no sync, putting records back exactly breaks other rules: records vanish without a tombstone ([0003](0003-tombstones-for-purge.md)), and the change log no longer matches the data.

## Decision

A restore is a set of ordinary edits that makes the current data match the backup:

- **Changed records:** a record that's live or deleted now gets the backup's data fields, and its `deleted` flag as in the backup. Only fields that differ get new stamps, so the restored values are the newest edits and sync to other devices like any edit.
- **Records created since** the backup are soft-deleted: they go to Recently deleted, where they can be restored.
- **Purged records:** a record permanently removed since the backup stays removed, because purge always wins. It's reported as "can't restore".
- **Shared targets** are never deleted. If the backup predates them, they're reset to empty.
- **Logs** (change log, conflict log) are history and are left as they are.
- **Safety first:** before anything changes, a backup of the current data is saved. The whole restore can be reversed by restoring that backup. Each change is also in the change log, so single changes can be undone.
- **Upgrade and validate:** the backup is upgraded to the current format and validated first, like an import. The changes run in one transaction: if anything fails, nothing changes.
- **Preview:** a preview (`previewRestore`) shows the counts before the user confirms. The planning is a pure function (`planRestore`), so the preview and the restore do exactly the same thing.

## Alternatives considered

- **Exact replacement of the stores.** Fails the scenario above once sync exists, drops records without tombstones, and leaves the change log describing edits that no longer exist.
- **Merging the backup like an import.** A merge keeps the newest value per field, and the backup's values are older, so it would change almost nothing.

## Consequences

- A restore can't bring back a record that was purged; the preview says how many.
- Only the newest five backups are kept, and the pre-restore backup counts toward them. The backup being restored is never the one pruned: the oldest _other_ backup goes instead, so you can restore the same backup again later. (Added 2026-10-04: before this, restoring the oldest backup removed it from the list.)
- On other devices, restored values arrive as new edits. Where another device also edited the same field since, a real conflict is logged as usual.

## In the code

[restore.ts](../../src/data/restore.ts) (`planRestore`, `summarize`); `previewRestore`, `restoreBackup` and `createBackup` in [repo.ts](../../src/data/repo.ts). Tests: [restore.test.ts](../../src/data/restore.test.ts).
