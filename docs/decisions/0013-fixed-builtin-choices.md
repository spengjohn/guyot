# 0013. Built-in choice options are fixed, and checked strictly

Status: Accepted (2026-10-04)

## Context

Some built-in fields are choices whose options the app itself depends on. Status on Applications drives the dashboard and the pipeline ("Interviewing", "Offer"...). Their option IDs are stored in records. Until now validation only checked that a status looked like a choice ID, so any string passed.

Custom choice fields are different: their options are user data, synced as field definitions, and a value for an option this device hasn't seen yet is kept and flagged with a warning.

Scenario: a bug, a hand-edited import file or a malicious synced file saves `status: 'ghosted'`. The dashboard can't count it, no Status menu can show it, and the record quietly drops out of every pipeline view.

## Decision

- Built-in options are defined in code ([builtinFields.ts](../../src/data/builtinFields.ts)) with fixed IDs: `applied`, `screening`, `interviewing`, `offer`, `accepted`, `rejected`, `withdrawn`, `noResponse`. Labels may change; IDs never do.
- A retired option is marked `hidden`, never removed, so old values stay valid and still display.
- A value outside the list is an **error**, not a warning. A local save is refused, and an import or synced file containing one is rejected whole ([0009](0009-all-or-nothing-import.md)).
- **Adding an option is a record format change**: it bumps `SCHEMA_VERSION`. A device on the old version then refuses newer data with "made by a newer version of Guyot; update the app first", instead of rejecting a file over one unexplained status.

## Alternatives considered

- **Warn and keep, as for custom choices.** That fits values whose definitions travel with the data. Built-in options don't travel; they're in the app. An unknown built-in value can only be a bug or tampering, and the app has no way to show or count it.
- **Let users edit the Status options.** That makes Status a custom field in all but name, and the dashboard could no longer rely on "Offer" meaning an offer. Users who want more stages can add a custom choice field.

## Consequences

- Adding a Status option needs a (trivial) migration and version bump, and devices must update before syncing with a device that has it.
- An upgrade that would leave an invalid status fails as a whole and leaves the data and its backup untouched ([migrate.ts](../../src/data/migrate.ts)).

## In the code

`STATUS_CHOICES` and `APPLICATION_FIELDS` in [builtinFields.ts](../../src/data/builtinFields.ts); `builtinChoice` in [validate.ts](../../src/data/validate.ts); test "accepts every Status option and rejects anything else" in [validate.test.ts](../../src/data/validate.test.ts).
