import { expect, test } from '@playwright/test'
import { allScreens, openScreen } from './helpers'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'

type Stop = { id: string; label: string; visibleFocus: boolean }

// Tabs through each screen from the top and checks that every visible control can be reached,
// that each one shows a focus indicator, and that Tab never gets stuck (a keyboard trap).
test('every control is reachable by Tab and shows visible focus', async ({ page }) => {
  for (const screen of await allScreens(page)) {
    await test.step(screen.name, async () => {
      await openScreen(page, screen)
      // Changing screens moves focus to the new heading; reload so Tab starts at the top.
      await page.reload()
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

      // Tag each visible focusable element so the Tab order can be compared with the page.
      const expected: string[] = await page.$$eval(FOCUSABLE, (elements) =>
        elements
          // checkVisibility() also hides what a closed <details> holds, which still has a size.
          .filter((el) => el.checkVisibility({ visibilityProperty: true }))
          .map((el, i) => {
            el.setAttribute('data-kb-id', String(i))
            const name =
              (el as HTMLElement & { labels?: NodeListOf<HTMLLabelElement> }).labels?.[0]
                ?.innerText ??
              el.getAttribute('aria-label') ??
              (el as HTMLElement).innerText ??
              ''
            return `${el.tagName.toLowerCase()} "${name.trim().slice(0, 40)}"`
          }),
      )

      const stops: Stop[] = []
      const limit = expected.length + 20
      for (let i = 0; i < limit; i++) {
        await page.keyboard.press('Tab')
        const stop = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null
          if (!el || el === document.body) return null
          const style = getComputedStyle(el)
          const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2
          const ring = style.boxShadow !== 'none'
          const name =
            (el as HTMLInputElement).labels?.[0]?.innerText ??
            el.getAttribute('aria-label') ??
            el.innerText ??
            ''
          return {
            id: el.getAttribute('data-kb-id') ?? 'untagged',
            label: `${el.tagName.toLowerCase()} "${name.trim().slice(0, 40)}"`,
            visibleFocus: outline || ring,
          }
        })
        // Focus left the page (back to the browser), so the tab cycle is complete.
        if (!stop) break
        if (stops.length && stops[0].id === stop.id) break
        stops.push(stop)
      }

      expect
        .soft(stops.length, 'Tab never left the page: possible keyboard trap')
        .toBeLessThan(limit)

      const reached = new Set(stops.map((s) => s.id))
      const unreachable = expected.filter((_, i) => !reached.has(String(i)))
      expect.soft(unreachable, `controls on ${screen.name} that Tab never reaches`).toEqual([])

      const noFocusRing = stops.filter((s) => !s.visibleFocus).map((s) => s.label)
      expect.soft(noFocusRing, `controls on ${screen.name} with no visible focus`).toEqual([])
    })
  }
})
