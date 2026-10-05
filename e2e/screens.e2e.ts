import { expect, test } from '@playwright/test'
import { allScreens, findScreens, openScreen } from './helpers'

// Behaviour checks don't depend on the color mode, so they run in the light project only
// (see projects in playwright.config.ts).

test('every screen loads without errors, marks the current page and has its own title', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  const titles = new Set<string>()
  for (const screen of await findScreens(page)) {
    await test.step(screen.name, async () => {
      await openScreen(page, screen)
      const nav = page.getByRole('navigation').first()
      await expect
        .soft(nav.getByRole('link', { name: screen.name, exact: true }))
        .toHaveAttribute('aria-current', 'page')
      // WCAG 2.4.2: the browser tab names the screen, so tabs and history are told apart.
      const heading = await page.getByRole('heading', { level: 1 }).innerText()
      await expect.soft(page).toHaveTitle(new RegExp(heading))
      titles.add(await page.title())
    })
  }
  expect.soft(titles.size, 'each screen has a different tab title').toBeGreaterThan(1)
  expect(errors, 'console or page errors').toEqual([])
})

test('reloading a screen keeps it open (hash routing on static hosting)', async ({ page }) => {
  for (const screen of await allScreens(page)) {
    await test.step(screen.name, async () => {
      await openScreen(page, screen)
      const heading = await page.getByRole('heading', { level: 1 }).innerText()
      await page.reload()
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading)
    })
  }
})

test('the skip link moves focus to the main content', async ({ page }) => {
  await page.goto('./#/tracker')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible() // the app has rendered
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to main content' })
  await expect(skip).toBeFocused()
  await expect(skip).toBeVisible() // hidden until focused, then shown
  await page.keyboard.press('Enter')
  await expect(page.getByRole('main')).toBeFocused()
})

// WCAG 1.4.10 Reflow: content fits a 320px-wide window without scrolling sideways. A wide table
// may scroll inside its own box; the page itself must not. 1px is allowed for rounding.
test('every screen fits a 320px-wide window', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  for (const screen of await allScreens(page)) {
    await test.step(screen.name, async () => {
      await openScreen(page, screen)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect
        .soft(overflow, `${screen.name} scrolls sideways by this many pixels`)
        .toBeLessThanOrEqual(1)
    })
  }
})

// Sizes are in rem so the reader's browser font size applies. 200% text must not break the
// layout at a normal desktop width.
test('every screen survives 200% text size', async ({ page }) => {
  for (const screen of await allScreens(page)) {
    await test.step(screen.name, async () => {
      await openScreen(page, screen)
      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' })
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect.soft(overflow, `${screen.name} scrolls sideways at 200% text`).toBeLessThanOrEqual(1)
    })
  }
})
