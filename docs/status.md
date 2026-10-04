# Status

Last updated: 2026-10-04, at the end of build step 2a.

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
| Targets screen                                           | Step 2b                                                                | 2b              |
| Restore from a backup                                    | Replaces all current data, so it needs a confirm screen                | 2b              |
| Dashboard, goal progress and pace                        | Step 2c                                                                | 2c              |
| Job description snapshots; Resume and JD columns editing | Snapshots come with the dashboard work; resumes with the Tailor stage  | 2c, step 7      |
| Permanent removal ("Delete forever") in the UI           | Needs its own confirm step; soft delete covers everyday use            | 2b or later     |
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

### Next: 2b

Targets screen (search profiles with override modes, shared targets) and restore from backup. A plan will be shown before work starts.

## Steps 3–9

Not started.
