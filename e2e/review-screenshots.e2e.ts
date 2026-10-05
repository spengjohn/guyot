import { expect, test } from '@playwright/test'
import { allScreens, openScreen, slug } from './helpers'

// Not a pass/fail check: saves a full-page picture of every screen in light and dark, at desktop
// and phone widths (plus forced colors), into test-results/review/ for a person or Claude to
// look over. Nothing here fails unless a screen won't open.

const widths = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 390, height: 844 },
]

test('save review screenshots', async ({ page }, testInfo) => {
  const mode = testInfo.project.name
  for (const size of widths) {
    await page.setViewportSize({ width: size.width, height: size.height })
    for (const screen of await allScreens(page)) {
      await openScreen(page, screen)
      // A fresh load, so the picture doesn't show the focus ring a screen change puts on h1.
      await page.reload()
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      const body = await page.screenshot({
        path: `test-results/review/${mode}/${slug(screen.name)}-${size.name}.png`,
        fullPage: true,
      })
      await testInfo.attach(`${screen.name} ${mode} ${size.name}`, {
        body,
        contentType: 'image/png',
      })
    }
  }

  if (mode === 'light') {
    await page.setViewportSize(widths[0])
    await page.emulateMedia({ forcedColors: 'active' })
    for (const screen of await allScreens(page)) {
      await openScreen(page, screen)
      await page.reload()
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await page.screenshot({
        path: `test-results/review/forced-colors/${slug(screen.name)}.png`,
        fullPage: true,
      })
    }
  }
  expect(true).toBe(true)
})
