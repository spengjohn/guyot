# 0012. Profile overrides: list mode and items are one value

Status: Accepted (2026-10-04)

## Context

A search profile can override any shared-targets field. For list fields (role types, keywords, excluded companies...) the user picks a mode: **Add to shared** (the profile's items are added to the shared list) or **Replace** (the profile's list is used instead). Profiles can also override custom shared-target fields.

Stamps are per field, or per map entry ([0001](0001-field-level-merge.md)), so how the mode is stored decides what a merge can do with it.

Scenario: the profile overrides role types with Add to shared and items `['UX']`. On the phone, the user switches the mode to Replace. On the laptop, without having synced, they add `'Research'` to the items. If mode and items had separate stamps, the merge would keep the phone's mode and the laptop's items: Replace with `['UX', 'Research']`. Neither device ever had that combination, and the profile now silently drops every shared role type.

## Decision

- **A list override is one value, `{ mode, items }`, with one stamp** (`overrides.<field>`). A merge keeps one device's whole override. The other device's whole override goes to the conflict log, where it can be restored.
- **The mode is always stored.** "Add to shared" is the default the UI offers for a new override. The data never relies on a missing mode meaning "add", so a future change of default can't change what old overrides mean.
- **Custom field overrides go in their own map, `customOverrides`, keyed by field ID** (`customOverrides.<fieldId>`, one stamp each). This mirrors `sharedTargets.custom[fieldId]`. Renaming a field never breaks an override. An override for an unknown field (or one that isn't a shared-target field) is kept and flagged, never dropped. An absent entry means "use the shared value"; `null` means "empty for this profile". No custom field type is a list, so custom overrides have no mode.
- **`effectiveTargets(shared, profile)`** computes the targets a profile uses. Add to shared keeps the shared items first, then the profile's, dropping items that match ignoring case and surrounding spaces (the first spelling wins).
- **Upgrading from format 1:** version 1 stored list overrides as plain lists, meaning "the profile's list wins". The upgrade to format 2 turns each into `{ mode: 'replace', items }` and keeps its stamp. Replace is what the old value meant. It is the same edit stored differently, not a new edit or a default, and every device upgrades it identically, so merges see equal stamps with equal values and log nothing.

## Alternatives considered

- **Separate stamps for mode and items.** Fails the scenario above: a merge can pair one device's mode with another device's items.
- **Store the mode only when it's Replace.** Same problem in disguise: "no mode" and "a mode" are two values of one setting, so they still need to travel together.
- **One `overrides` map holding both field names and custom field IDs.** Works at runtime (names and UUIDs can't collide), but TypeScript can't describe a map whose known keys have specific types while its other keys are IDs. A separate map keeps both typed.
- **Treat old plain-list overrides as Add to shared on upgrade.** Changes what existing data means: the profile would suddenly also include every shared item.

## Consequences

- Editing just the mode re-stamps the whole override. Concurrent edits of mode and items on two devices produce a conflict entry instead of a merged guess. That is the intended trade.
- The Targets screen (step 2b) must write the mode and the items together.

## In the code

`ListOverride`, `SharedTargetOverrides` and `customOverrides` in [types/tables.ts](../../src/data/types/tables.ts); `OVERRIDE_CHECKS` and `customOverridesMap` in [validate.ts](../../src/data/validate.ts); [targets.ts](../../src/data/targets.ts); `profileTo2` in [migrate.ts](../../src/data/migrate.ts). Tests: [targets.test.ts](../../src/data/targets.test.ts), "search profile overrides" in [validate.test.ts](../../src/data/validate.test.ts) and [repo.test.ts](../../src/data/repo.test.ts), "upgrading a version 1 database" in [migrate.test.ts](../../src/data/migrate.test.ts).
