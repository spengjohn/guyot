# Browser checks

Automated checks that open the built app in a real browser (Chromium, through Playwright) and do what we used to do by hand on the locally hosted site. The reasons and the alternatives are in [ADR 0018](decisions/0018-browser-checks.md).

## Running them

| Command                   | What it does                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `npm run test:e2e`        | Builds the app, serves it on port 4173 and runs every check in light and dark       |
| `npm run test:e2e:ui`     | The same, in Playwright's window: pick a test, watch it run, step through it        |
| `npm run test:e2e:report` | Opens the last report (failures, axe details, screenshots, a trace of each failure) |

The first time on a machine, run `npx playwright install chromium` once to download the browser.

If `npm run dev` or `npm run preview` is already running on port 4173, the checks reuse it instead of building.

## What is checked automatically

Screens are found from the main navigation, so a new screen with a nav link is checked without editing any test. Screens with no nav link (Recently deleted) are listed in `EXTRA_SCREENS` in `e2e/helpers.ts`.

| File                        | Checks                                                                                                                                                                                                                        | Modes       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `accessibility.e2e.ts`      | axe-core on every screen: WCAG 2.2 A and AA, axe best practices, and the theme's contrast rules: 7:1 for all text, large text included, except text on primary and danger buttons, which needs 4.5:1 (`docs/theme.md`)        | light, dark |
| `keyboard.e2e.ts`           | Tab reaches every visible control, each shows a focus indicator (outline 2px or more, or a ring), and Tab never gets stuck                                                                                                    | light, dark |
| `screens.e2e.ts`            | No console or page errors, the current nav link has `aria-current="page"`, each screen has its own tab title, reload keeps the screen, the skip link works, no sideways scroll at 320px width or at 200% text                 | light       |
| `applications.e2e.ts`       | Add an application and it survives a reload (real IndexedDB); the dialog keeps focus inside, closes on Esc and returns focus; empty Save explains what's missing; delete, undo and restore; axe with data and the dialog open | light       |
| `review-screenshots.e2e.ts` | Saves pictures for review (below); fails only if a screen won't open                                                                                                                                                          | light, dark |

Checks whose result depends on color run in both modes; everything else runs once, in light. A new test file runs once unless it is added to the dark project's `testMatch` in `playwright.config.ts`.

`npm run lint` (jsx-a11y), `src/styles/tokens.test.ts` (every token pair's contrast) and `App.test.tsx` (flows in jsdom) still run in Vitest; these checks add what only a real browser shows.

## Review screenshots

Each run saves full-page pictures to `test-results/review/`:

- `light/` and `dark/`: every screen at desktop (1280px) and phone (390px) width
- `forced-colors/`: every screen as Windows High Contrast shows it

These are for looking at, not for automatic comparison. To have Claude review them, ask:

> Look at the screenshots in test-results/review against docs/theme.md. For each screen, tell me anything that looks wrong or hard to use: alignment, spacing, crowding, text that wraps badly, things that look clickable but aren't (or the reverse), colors outside the three families, AI items not marked in the fruit color, and anything that disappears or loses its edge in forced colors.

## What automation can't judge

Automated tools catch roughly a third to a half of accessibility problems. A person (or Claude looking at screenshots) still needs to check:

- **Screen reader experience.** Whether names, headings and announcements make sense when heard in order. Try NVDA (Windows, free) on the main flow at each build step: add an application, edit it, delete and undo, change columns.
- **Meaningful wording.** axe confirms a button has a name, not that "Go" or "Edit" says enough. Labels, error messages and empty states need a read.
- **Focus order that makes sense.** The test confirms every control is reachable, not that the order matches the layout, or that focus moves somewhere sensible after a dialog closes or a row is deleted.
- **Focus indicator quality.** The test confirms an indicator exists; whether it is easy to see against each background is a look at the screenshots (or a Tab-through).
- **Visual design and layout.** Whether things are aligned, balanced and calm, and whether the theme rules in `docs/theme.md` are followed in spirit.
- **Usability.** Whether a first-time user understands what to do, whether a flow takes too many steps, whether the review gate and "applied by AI" labels are clear. That needs a real person trying a task.
- **Cognitive load and plain language.** Reading level, jargon, too many choices on one screen.
- **Text spacing and zoom beyond the basics.** WCAG 1.4.12 (user text spacing) and browser zoom at 400% are worth a hand check on tables and forms.
- **Motion and timing.** Whether anything moves without the user asking, or times out.
- **Other browsers.** The checks run in Chromium only. Firefox and Safari (and their screen readers) can differ.

## Adding checks

- Find controls by role and visible name (`getByRole('button', { name: 'Add application' })`), never by CSS class. If a test can't find a control by its name, a screen reader user can't either.
- After a flow opens something new (a dialog, the column picker, the Targets form), call `expectNoA11yViolations(page, testInfo, 'label')` from `e2e/helpers.ts`.
- Test files end in `.e2e.ts` so Vitest ignores them.
- Each test starts with an empty browser, so IndexedDB starts empty; create the data a test needs inside it.
