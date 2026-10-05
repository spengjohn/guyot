// Browser security checks, run with the other Playwright checks.
// They hold for every screen, so they need no changes as the UI grows. See docs/security.md.
import { expect, test, type Page } from '@playwright/test'

/** Screens to visit. Add new routes here as they are built. */
const ROUTES = ['/']

const SECRET_NAME = /key|token|secret|pass|auth|cred/i

/** Records every request to another site and every pop-up dialog while a test runs. */
function watch(page: Page) {
  const offsite: string[] = []
  const dialogs: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (!local && !['data:', 'blob:'].includes(url.protocol)) offsite.push(request.url())
  })
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message())
    await dialog.dismiss()
  })
  return { offsite, dialogs }
}

for (const route of ROUTES) {
  test.describe(`security on ${route}`, () => {
    test('contacts no other site with AI and sync off', async ({ page }) => {
      // Hard rule 2: no analytics, no fonts or scripts from other sites, nothing phoning home.
      const seen = watch(page)
      await page.goto(route)
      await page.waitForLoadState('networkidle')
      expect(seen.offsite).toEqual([])
    })

    test('sets no cookies and keeps no secrets in web storage', async ({ page, context }) => {
      await page.goto(route)
      await page.waitForLoadState('networkidle')
      expect(await context.cookies()).toEqual([])
      const keys = await page.evaluate(() => [
        ...Object.keys(localStorage),
        ...Object.keys(sessionStorage),
      ])
      expect(keys.filter((key) => SECRET_NAME.test(key))).toEqual([])
    })

    test('opens no pop-up dialogs on load', async ({ page }) => {
      const seen = watch(page)
      await page.goto(route)
      await page.waitForLoadState('networkidle')
      expect(seen.dialogs).toEqual([])
    })
  })
}
