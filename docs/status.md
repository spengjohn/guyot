# Status

Last updated: 2026-10-04, at the end of build step 2b.

The build order is in [CLAUDE.md](../CLAUDE.md#build-order). This page tracks where each step stands.

## Step 1: Data layer — done

Everything lives in [src/data/](../src/data/). See [data-layer.md](data-layer.md) for a tour.

Built:

- Sync-ready records: every field carries a stamp (`updatedAt`, `deviceId`, `base`) for field-level merge.
- Field-level merge with real-conflict detection and a conflict log.
- Hand-written validation of every write, every import and every synced file.
- IndexedDB storage: create, update, soft delete, restore, purge (with tombstones).
- Change log with undo, and conflict restore or dismiss.
- Shared targets as a fixed-ID singleton with default-stamped starting values.
- Role IDs (R001, R002...) with collision renumbering.
- JSON export and import (all-or-nothing, upgrades older files).
- Automatic local backup before data migrations; migration framework.

## Step 2: Tracker and dashboard — in progress

### 2a: App shell, built-in fields, Applications table, column picker — done

Data layer catch-up:

- **Profile overrides** ([ADR 0012](decisions/0012-profile-overrides.md)): list overrides store `{ mode: 'add' | 'replace', items }` as one value with one stamp; custom shared fields are overridden in `customOverrides`, keyed by field ID. `effectiveTargets()` computes a profile's targets.
- **Goals table**, with validation (whole-number target of at least 1, end day not before start day).
- **Database version 2** (adds the goals store) and **record format 2** (the override change). The first real migration: a version 1 database is backed up, then upgraded, keeping every record, stamp, the device ID and settings. Old list overrides become Replace, which is what they meant. Version 1 export files still import.
- **Built-in fields** for Applications in [builtinFields.ts](../src/data/builtinFields.ts), with fixed Status options. Status is now checked against them; anything else is an error ([ADR 0013](decisions/0013-fixed-builtin-choices.md)).
- Repo: `update` can take the stamps it expects and refuses stale edits (`StaleEditError`); `delete` and `restore` return the change log ID (for undo); `create` can assign the Role ID in the same transaction, so a failed save doesn't use up a number; validated local settings (`getLocalSettings`, `saveLocalSettings`).

User interface:

- App shell: hash routing (`#/tracker`, `#/tracker/deleted`, `#/targets`, `#/dashboard`) without a router library; skip link; main navigation with `aria-current`; focus moves to the page heading on every page change; page titles. The Vite starter page and assets are gone.
- Applications table: a semantic table with caption, column headers and row headers; Add and Edit in a modal dialog; inputs follow each field's type (date inputs for calendar days, stored as `YYYY-MM-DD` with no time zone); required fields (Date Applied, Company, Role, Status) marked and checked on save, with the optional ones under "More details"; errors beside each field and in a focused summary; only changed fields are saved. Required fields are a form rule: stored and imported records without them stay valid.
- Delete with Undo (the notice stays until dismissed; focus moves to Undo, then back to the restored row), and a Recently deleted page with Restore.
- Column picker: a checklist with Move up and Move down buttons, saved per device.
- Open tabs stay in step: after any write, the other tabs reload from IndexedDB (via `BroadcastChannel`; the message carries no data). Every save, delete, undo, restore and column change is announced through one live region.
- Editing while the same application is saved elsewhere ([ADR 0014](decisions/0014-stale-edit-check.md)): fields you haven't touched take the new value, and a notice in the form says what changed. If you edited a field that was saved again elsewhere, the form shows both versions and asks you to keep yours or use the saved one; Save waits until you choose. Repo refuses any save based on an older version of a field, so nothing is overwritten unseen.
- 167 tests, including component tests that find everything by role and label (jsdom, Testing Library; dev only).

Deferred, with reasons:

| Item                                                     | Why it waits                                                           | Planned for     |
| -------------------------------------------------------- | ---------------------------------------------------------------------- | --------------- |
| Dashboard, goal progress and pace                        | Step 2c                                                                | 2c              |
| Job description snapshots; Resume and JD columns editing | Snapshots come with the dashboard work; resumes with the Tailor stage  | 2c, step 7      |
| Permanent removal ("Delete forever") in the UI           | Needs its own confirm step; soft delete covers everyday use            | Later in step 2 |
| Undo for edits (not only deletes)                        | The change log supports it; the UI for skipped fields needs design     | Later in step 2 |
| Creating custom fields                                   | Belongs to the pipeline editor; existing custom fields already display | Step 6          |
| Sorting and filtering the table, saved views             | Not needed to start tracking; sorted newest Date Applied first         | Later in step 2 |
| "Copy layout from another device"                        | Needs sync                                                             | Step 3          |
| Synced settings                                          | Settings are local only for now                                        | Step 3 or later |
| Encryption                                               | Only needed once data leaves the browser                               | Step 3 (sync)   |

Known limits:

- Undo is skipped for any field touched since the change (by design, see [ADR 0008](decisions/0008-stamp-based-undo.md)); the tracker says so in a short message.
- Closing the dialog (Cancel or Esc) discards unsaved changes without asking.
- The component tests use a stand-in for the browser's modal dialog (jsdom lacks it), so focus trapping and Esc are not tested automatically. Check them by hand in a real browser, along with a screen reader pass.
- Damaged local settings fall back to the default column layout.
- Conflict log entries for values removed from map fields (e.g. a cleared custom value) record the losing value as `null`.

### 2b: Targets screen, restore from backup, Your data page — done

Data layer:

- **Search profile choices** with fixed IDs (Employment types, Work modes, Priority), checked like Status (ADR 0013). Built-in profile and shared-target fields in [builtinFields.ts](../src/data/builtinFields.ts). No format change: the stored shape is the same.
- **Restore as edits** ([ADR 0015](decisions/0015-restore-as-edits.md)): `previewRestore` counts what a restore would do; `restoreBackup` saves a backup of the current data, then changes everything to match the backup as ordinary, logged edits (records made since go to Recently deleted; purged records stay gone). `createBackup` makes one on request.
- **Import with a check first**: `checkImport` validates a file and returns a preview without writing; `mergeImport` merges it.

Shared form plumbing ([src/forms/](../src/forms/)):

- The edit tracking from 2a (edits over the latest saved record, conflicts, the stale check) is now generic: `editModel.ts` (pure), the `useEditForm` hook, and `FormParts.tsx` (notice, conflict comparison, error summary). Applications, profiles and shared targets all use it; the Applications tests passed unchanged.
- New inputs: lists typed one per line, checkbox groups, minimum pay (amount, period, currency), and a single checkbox for a required yes/no.

User interface:

- **Targets** (`#/targets`): shared targets edited in place (with the same conflict handling), Eligibility notes marked personal, Last updated from the record. Search profiles in a table with Edit, Duplicate (saved only on Save) and Delete with Undo, plus Recently deleted profiles with Restore.
- **Profile dialog**: the profile's fields, then "Override shared targets for this profile": each list field is Use shared, Add to shared or Replace, with a live "This profile will use: …" line; text and custom fields have an Override checkbox. Mode and items are saved together.
- **Your data** (`#/data`, in the main navigation): download a copy (an export file), import a file (shown and checked before merging; a bad file is refused whole), and the automatic backups with Back up now, Download and Restore…; the restore dialog shows what will change, starts on Cancel, and announces the outcome.
- 196 tests.

Known limits added in 2b:

- Lists are typed one per line, so an item can't contain a line break.
- Minimum pay defaults to USD; the device's own currency isn't detected.

### After 2b: encrypted downloads and a backup fix

- **Exports and downloaded backups are encrypted by default** ([ADR 0016](decisions/0016-encrypted-exports.md)): a passphrase typed twice; PBKDF2-SHA-256 (600,000 iterations) and AES-GCM from the browser's Web Crypto; a wrong passphrase or changed file fails cleanly. Unencrypted downloads sit behind a warning and an "I understand" box. Encrypted files ask for their passphrase on import; older plain files still import. Backups inside the browser stay unencrypted, like the live data (a "lock this device" feature could change that later).
- **Restoring never prunes the backup being restored**: the oldest other backup goes instead.
- 208 tests.

### Next: 2c

The dashboard: KPI tiles, the goal tracker with pace, charts, a "needs attention" list, and job description snapshots. A plan will be shown before work starts.

## Steps 3–9

Not started.
