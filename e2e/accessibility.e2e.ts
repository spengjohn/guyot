import { test } from '@playwright/test'
import { expectNoA11yViolations, allScreens, openScreen } from './helpers'

// Runs in both the light and dark projects, so contrast is checked in each mode. Forced colors
// (Windows High Contrast) is left to the review screenshots: axe reads the author's colors, not
// the forced ones, so running it there would only repeat this check.
test('every screen passes the automated accessibility rules', async ({ page }, testInfo) => {
  for (const screen of await allScreens(page)) {
    await test.step(screen.name, async () => {
      await openScreen(page, screen)
      await expectNoA11yViolations(page, testInfo, screen.name)
    })
  }
})
