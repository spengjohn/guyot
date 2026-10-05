# The data layer

A tour of [src/data/](../src/data/): what each file does, how a write and an import flow through it, and which tests prove each rule. The rules themselves are in [CLAUDE.md](../CLAUDE.md#data-model); the reasons behind them are in [decisions/](decisions/).

## The core idea

Guyot has no server. The same data may be edited on several devices, offline, and later merged. So every record carries enough history to merge safely without asking anyone:

- Every field has its own **stamp**: when it last changed, on which device, and what it replaced (`base`).
- Merging compares stamps **field by field**. Edits to different fields both survive; for the same field, the newest wins and the other value goes to the **conflict log**.
- Nothing is ever silently lost: deletes are soft, permanent removal leaves a **tombstone**, and every change is in the **change log** with its old values, for undo.

## Files

| File                                             | What it does                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| [types/core.ts](../src/data/types/core.ts)       | IDs, time types (`Moment`, `CalendarDay`, `ZonedMoment`), `JsonValue`         |
| [types/record.ts](../src/data/types/record.ts)   | Sync fields shared by every record, field stamps, live records and tombstones |
| [types/fields.ts](../src/data/types/fields.ts)   | Field types and their values, custom field definitions, column layouts        |
| [types/tables.ts](../src/data/types/tables.ts)   | Each table's data shape, the table map, `Meta`, the export file shape         |
| [constants.ts](../src/data/constants.ts)         | Schema version, the fixed shared-targets ID, size limits, table lists         |
| [time.ts](../src/data/time.ts)                   | Current time, calendar-day and time-zone checks                               |
| [ids.ts](../src/data/ids.ts)                     | UUIDs, Role IDs, deterministic IDs                                            |
| [stamp.ts](../src/data/stamp.ts)                 | Making and comparing field stamps (with the clock-skew guard)                 |
| [merge.ts](../src/data/merge.ts)                 | Field-level merge of two copies of a record. Pure: no storage                 |
| [validate.ts](../src/data/validate.ts)           | Checks for every table and field type, records and whole export files         |
| [defaults.ts](../src/data/defaults.ts)           | Starting values (empty shared targets, empty local settings)                  |
| [builtinFields.ts](../src/data/builtinFields.ts) | Built-in Applications fields and the fixed Status options                     |
| [targets.ts](../src/data/targets.ts)             | A profile's effective targets: shared targets with its overrides. Pure        |
| [db.ts](../src/data/db.ts)                       | Opens IndexedDB, creates stores and indexes, promise helpers                  |
| [repo.ts](../src/data/repo.ts)                   | All reads and writes: stamping, validation, logging, undo, merging            |
| [exportImport.ts](../src/data/exportImport.ts)   | JSON export and import                                                        |
| [backup.ts](../src/data/backup.ts)               | Local backups (newest five kept)                                              |
| [crypto.ts](../src/data/crypto.ts)               | Passphrase encryption for downloads (PBKDF2 + AES-GCM, Web Crypto)            |
| [restore.ts](../src/data/restore.ts)             | Planning a restore: what to change, delete and skipped. Pure                  |
| [migrate.ts](../src/data/migrate.ts)             | Upgrading old data and old export files to the current format                 |
| [fixtures.ts](../src/data/fixtures.ts)           | Test helpers only                                                             |

Dependency direction: `types` ← `stamp`, `merge`, `validate`, `targets` (pure) ← `repo` (storage) ← `exportImport`, `migrate`. The pure modules never touch IndexedDB, so the same merge and validation serve imports now and sync later.

## Stores

IndexedDB holds one store per synced table (search profiles, shared targets, goals, postings, stage rows, applications, resume versions, job description snapshots, field definitions, pipeline definitions, stage instructions, conflict log, change log), plus three local-only stores:

- `meta`: this device's ID, the stored data's format version, the next Role ID number.
- `settings`: per-device preferences such as column layouts. Read and written only through `repo.getLocalSettings()` and `repo.saveLocalSettings()`, which validate them (damaged settings read as the defaults).
- `backups`: automatic backups. Never synced or exported.

## Two version numbers

- **Database version** (`DB_VERSION` in [db.ts](../src/data/db.ts)): which stores and indexes exist. IndexedDB runs `onupgradeneeded` when it goes up; ours creates any missing store and never touches existing ones. 1: every store. 2: `goals`.
- **Record format** (`SCHEMA_VERSION` in [constants.ts](../src/data/constants.ts)): the shape of the records inside. Raising it needs a step in `MIGRATIONS` ([migrate.ts](../src/data/migrate.ts)), which runs after an automatic backup, all-or-nothing, on stored data and on older import files.

They change independently: a new store with no change to existing records needs only the first. Format history:

| Format | Change                                                                                                                                                                                                                                                                 |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | First format                                                                                                                                                                                                                                                           |
| 2      | List overrides became `{ mode, items }` (old lists became Replace, stamps kept); profiles gained `customOverrides`; goals table added (older files get an empty one); applications lost `deadline` (it belongs to Discover; old values stay in the pre-upgrade backup) |

## Search profile overrides

A profile's `overrides` map holds built-in shared fields by name; `customOverrides` holds custom shared fields by field ID. A list override is one value, `{ mode: 'add' | 'replace', items }`, with one stamp, so a merge never mixes one device's mode with another's items. `effectiveTargets(shared, profile)` applies them. See [ADR 0012](decisions/0012-profile-overrides.md).

## Built-in fields

[builtinFields.ts](../src/data/builtinFields.ts) lists the Applications fields the UI shows, in default column order, and which are read-only (Role ID, and Resume and Job Description until their screens exist). Status options have fixed IDs; validation rejects any other value, and adding an option is a format change ([ADR 0013](decisions/0013-fixed-builtin-choices.md)).

## Repo calls the UI uses

- `create(table, data, { assignRoleId: true })` gives a posting-linked record the next Role ID inside the same transaction, so a create that fails validation leaves the counter alone.
- `update(table, id, changes, { expected })` saves only if every field it would change still has the stamp the form saw (or no stamp, for `null`); otherwise it saves nothing and throws `StaleEditError` naming the fields ([ADR 0014](decisions/0014-stale-edit-check.md)).
- `delete` and `restore` return the change log ID of the change (or `null` if nothing changed); pass it to `undo(changeId)`.
- `list` and `listDeleted` feed the tables and the Recently deleted lists.
- `getSharedTargets` gives the one shared-targets record (made on first use) for the Targets page.
- `listBackups`, `getBackup`, `createBackup`, `previewRestore` and `restoreBackup` serve the Your data page, with `checkImport` and `mergeImport` from [exportImport.ts](../src/data/exportImport.ts).

The UI never writes to IndexedDB directly: every write goes through `Repo`, through the `useRepoWrite` hook in [src/app/repoContext.ts](../src/app/repoContext.ts), which tells every on-screen query to reload afterwards. It also posts a "changed" message on a `BroadcastChannel` named after the database, so other open tabs reload too ([RepoProvider.tsx](../src/app/RepoProvider.tsx)). The message carries no data: each tab reads the new state from IndexedDB itself.

## How a write flows

`repo.update('applications', id, { notes: 'Called recruiter' })`:

1. Opens one read-write transaction. Everything below happens in it, so it all happens or none of it does.
2. Loads the record and the custom field definitions (for validating custom values).
3. Compares each given field with the current value. Only fields that actually change get a new stamp (`stampEdit`), which also records `base` and applies the clock-skew guard.
4. Validates the whole new record. On any error, throws `ValidationError` and the transaction is aborted.
5. Saves the record and writes a change log entry: which fields changed, their old values, and the exact stamps written.

Inside a transaction, the code waits only on IndexedDB requests. Waiting on anything else (a timer, `fetch`, `crypto.subtle`) lets IndexedDB close the transaction early. That's why conflict IDs use a synchronous hash.

## How an import flows

`importJson(repo, text)` is `checkImport` followed by `mergeImport`; the Your data page calls them separately so the user sees the file first:

1. `checkImport`: refuses very large files, parses JSON, and upgrades files from older versions (`upgradeFile`).
2. Validates the entire file. Any error rejects it whole. Nothing has been written yet; the result includes a preview (source device, export time, format, record counts).
3. `mergeImport`: merges every record in **one transaction** (`saveMergedMany`), field definitions first. For each record: merge with the local copy, log real conflicts (with IDs every device agrees on), scrub log entries about purged records, log the change.
4. Renumbers any Role ID collisions.
5. If anything fails, the whole transaction is rolled back.

Sync (build step 3) will reuse steps 2–5 for other devices' files.

## Encrypted files

Downloads (exports and backups) are encrypted by default ([ADR 0016](decisions/0016-encrypted-exports.md)): `encryptText(json, passphrase)` returns a JSON envelope with the salt, iterations and IV, bound to the ciphertext. On import, `encryptedFileIn(text)` recognises an envelope; `decryptText` opens it (throwing `DecryptError` for a wrong passphrase or a changed file), and the plain JSON then goes through `checkImport` as usual. Encryption runs outside IndexedDB transactions: `crypto.subtle` is asynchronous and would let a transaction close early.

## How a restore flows

`repo.restoreBackup(backupId)` ([ADR 0015](decisions/0015-restore-as-edits.md)):

1. Reads the backup, upgrades it to the current format, and validates it like an import file.
2. Saves a backup of the current data (its own transaction), so the restore can be reversed. Pruning to the newest five never removes the backup being restored.
3. In one transaction, `planRestore` compares every current record with the backup's, and the plan is applied as ordinary edits: changed records get the backup's values (newly stamped), records created since are soft-deleted, records purged since are skipped, shared targets missing from the backup are reset. Each change is logged. Role ID collisions are renumbered.
4. If anything fails, nothing changes.

`repo.previewRestore(backupId)` runs steps 1 and 3's planning only, and returns the counts for the confirm screen.

## Where each rule is tested

| Rule                                         | Tests                                                                                                                                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Field-level merge, ties, real conflicts only | [merge.test.ts](../src/data/merge.test.ts) "field-level merge"                                                                                                          |
| Defaults never beat real edits               | merge.test.ts "defaults never beat real edits"; [repo.test.ts](../src/data/repo.test.ts) shared targets; [migrate.test.ts](../src/data/migrate.test.ts) upgrade default |
| Validation, all-or-nothing files             | [validate.test.ts](../src/data/validate.test.ts)                                                                                                                        |
| Writes are atomic                            | repo.test.ts "rejects invalid data and saves nothing"; [exportImport.test.ts](../src/data/exportImport.test.ts) "rolls back records already merged"                     |
| Tombstones, purged data stays gone           | repo.test.ts purge; exportImport.test.ts "purged data stays gone"                                                                                                       |
| Clock-skew guard                             | merge.test.ts stampEdit; repo.test.ts "clock goes backwards"                                                                                                            |
| Undo never overwrites newer work             | [undo.test.ts](../src/data/undo.test.ts)                                                                                                                                |
| Role ID collisions                           | exportImport.test.ts "Role ID collisions"                                                                                                                               |
| Backups and migrations                       | migrate.test.ts; "upgrading a version 1 database" builds a real version 1 database and checks nothing is lost                                                           |
| Profile overrides and effective targets      | [targets.test.ts](../src/data/targets.test.ts); validate.test.ts and repo.test.ts "search profile overrides"                                                            |
| Built-in Status options                      | validate.test.ts "accepts every Status option and rejects anything else"                                                                                                |
| Local settings                               | validate.test.ts "validateLocalSettings"; repo.test.ts "local settings"                                                                                                 |
| Encrypted downloads                          | [crypto.test.ts](../src/data/crypto.test.ts); exportImport.test.ts "imports an encrypted export"; DataPage.test.tsx                                                     |
| Restore as edits                             | [restore.test.ts](../src/data/restore.test.ts)                                                                                                                          |
| Import checked before merging                | exportImport.test.ts "checkImport"                                                                                                                                      |
| Stale edits refused                          | repo.test.ts "refuses a stale edit"; App.test.tsx "editing the same application in two tabs"                                                                            |
| Goals                                        | validate.test.ts and repo.test.ts "goals"                                                                                                                               |
