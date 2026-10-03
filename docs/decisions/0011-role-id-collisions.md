# 0011. Role ID collisions are renumbered deterministically

Status: Accepted (2026-10-03)

## Context

Role IDs (R001, R002...) are short labels linking one posting's rows across stages. They are display labels, never identity (`id` is). Each device counts up on its own, so two devices offline can both create R005 for different postings.

## Decision

After every merge, `renumberCollisions` finds Role IDs shared by more than one owner. The owner is the posting, or the row itself if it isn't linked to a posting. The owner with the smaller `id` keeps the number; each other owner moves, with all its linked rows (stage rows, applications, job description snapshots, resume copies), to the next free number: above every Role ID in use and above this device's counter. Each move is logged as a `renumber` change. The local counter is raised past any imported Role ID.

Because the rule depends only on the data, two devices with the same data choose the same keeper.

## Alternatives considered

- **Device-prefixed Role IDs** (L-R005, P-R005). No collisions, but longer, uglier labels for a rare problem.
- **Keep duplicates and show a warning.** Leaves the user to fix it by hand.

## Consequences

- A Role ID can change after a sync. Anything shown to the user (or copied elsewhere) may go stale; the change log records it.
- Two devices may pick different "next free" numbers if their data differs at the time. The later sync settles it like any other field edit.
- Resume versions carry `postingId` so per-posting copies move with their posting.

## In the code

`renumberCollisions` in [repo.ts](../../src/data/repo.ts); test "Role ID collisions" in [exportImport.test.ts](../../src/data/exportImport.test.ts).
