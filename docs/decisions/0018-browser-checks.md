# 0018: Automated browser checks with Playwright and axe-core

- Status: Accepted
- Date: 2026-10-05

## Context

Before each change was considered done, we opened the locally hosted app and checked accessibility, the main flows and the look by hand, in light and dark mode. That was slow, easy to skip, and missed screens nobody thought to open. Vitest with fake-indexeddb tests the data layer, and jsx-a11y catches some markup mistakes, but neither renders a page, so neither can see contrast, focus, layout or whether a flow works end to end.

## Decision

Add two dev-only dependencies:

- **Playwright** (`@playwright/test`) drives a real Chromium against the built site (`npm run build` + `vite preview`), the same static files GitLab Pages serves. Every check runs with the device set to light and to dark.
- **axe-core** (`@axe-core/playwright`, plus `axe-core` directly to configure it) runs the WCAG 2.2 A/AA rules and best practices on every screen. Its AAA contrast rule is tightened so large text must also reach 7:1, matching our theme rule.

Screens are discovered from the main navigation. The checks also cover keyboard reach and visible focus, reflow at 320px, 200% text, hash-route reloads and the main Tracker flow, and save screenshots for human or Claude review.

Nothing ships to users: both are dev dependencies, and no app code changes.

## Alternatives considered

- **Keep checking by hand.** Rejected: the checks we care most about (contrast in both modes, every control reachable) are the ones that are tedious to repeat.
- **Vitest browser mode or jsdom with axe.** jsdom does not compute layout or real colors, so contrast and focus checks would be unreliable; browser mode would still need Playwright underneath.
- **Lighthouse or pa11y.** Good page audits, but they don't drive flows, and adding one means two tools where one covers both.
- **Pixel-diff screenshot tests (`toHaveScreenshot`).** Rejected for now: baselines differ between Windows and Linux (fonts, anti-aliasing), so they would fail in CI for no real reason. Screenshots are saved for review instead.
- **Hand-written checks without axe.** Against "dependency-light" this is the one place a library earns its keep: axe encodes years of WCAG rule detail we would get wrong.

## Consequences

- `npm run test:e2e` runs the checks locally. They are not yet in GitLab CI; adding them later needs the Playwright Docker image.
- Automated checks find only part of the problems. `docs/browser-checks.md` lists what still needs a person, including a screen reader pass.
- Flow tests use roles and visible labels, so renaming a button means updating its test. That is intended: the label is part of the interface.
