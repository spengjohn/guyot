# 0005. An edit is always newer than the value it replaces

Status: Accepted (2026-10-03)

## Context

Merge uses timestamps, and device clocks are not reliable. A clock can be set wrong, or corrected backwards.

Scenario: your phone's clock is 10 minutes slow. You change a field on the phone after seeing the laptop's value. The phone's stamp is older than the laptop's, so your latest edit loses on merge.

## Decision

`stampEdit` stamps an edit with the later of the current time and the previous stamp + 1 ms. An edit always beats the value it replaced, whatever the clock says.

## Alternatives considered

- **Trust the clock.** Loses the user's latest edits on a device with a slow clock.
- **Hybrid logical clocks.** More robust across many fields, but more machinery than this needs; the per-field guard covers the case that loses data.

## Consequences

- Stamps are not exact wall-clock times. Don't display them as "edited at" without care.
- Fields changed in one write can get slightly different timestamps. Code that needs the exact stamps a change wrote must record them ([0008](0008-stamp-based-undo.md)).
- This protects field stamps only. Anything that orders events by clock time is still exposed to skew, which is why undo doesn't.

## In the code

`stampEdit` in [stamp.ts](../../src/data/stamp.ts); tests in [merge.test.ts](../../src/data/merge.test.ts) ("stampEdit") and [repo.test.ts](../../src/data/repo.test.ts) ("clock goes backwards").
