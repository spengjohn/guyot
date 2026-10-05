import { expect, test, type Page } from '@playwright/test'
import { expectNoA11yViolations } from './helpers'

// The main Tracker flow in a real browser: real IndexedDB, a real modal dialog and real focus.
// App.test.tsx covers the same screens in jsdom; these add what jsdom can't show (data that
// survives a reload, the browser's own dialog, and where focus actually lands).
//
// Controls are found by role and visible name, never by CSS class: if a test can't find a
// control by its name, a screen reader user can't either. Each test starts with an empty
// browser, so IndexedDB starts empty.

async function addApplication(page: Page, company: string, role: string) {
  await page.getByRole('button', { name: 'Add application' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add application' })
  await dialog.getByRole('textbox', { name: 'Company' }).fill(company)
  await dialog.getByRole('textbox', { name: 'Role' }).fill(role)
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
}

test.beforeEach(async ({ page }) => {
  await page.goto('./#/tracker')
  await expect(page.getByRole('button', { name: 'Add application' })).toBeVisible()
})

test('add an application, and it is still there after a reload', async ({ page }) => {
  await addApplication(page, 'Vine & Wire Co', 'UX Researcher')
  const row = page.getByRole('row', { name: /Vine & Wire Co/ })
  await expect(row).toBeVisible()
  // Focus goes back to the button that opened the dialog.
  await expect(page.getByRole('button', { name: 'Add application' })).toBeFocused()

  await page.reload()
  await expect(row).toBeVisible()
})

test('the add dialog keeps focus inside and closes on Esc', async ({ page }) => {
  await page.getByRole('button', { name: 'Add application' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add application' })
  await expect(dialog).toBeVisible()

  // Tab all the way round: focus must never land on the page behind the dialog. After the last
  // control the browser may take focus to its own toolbar (the page sees <body>), then back.
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab')
    const where = await dialog.evaluate((el) =>
      el.contains(document.activeElement)
        ? 'dialog'
        : document.activeElement === document.body
          ? 'browser'
          : (document.activeElement?.outerHTML.slice(0, 80) ?? 'nothing'),
    )
    expect(['dialog', 'browser'], `Tab ${i + 1} landed behind the dialog`).toContain(where)
  }

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'Add application' })).toBeFocused()
})

test('saving an empty form explains what to fill in', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: 'Add application' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add application' })
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Enter the company').first()).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Company' })).toHaveAttribute(
    'aria-invalid',
    'true',
  )
  await expectNoA11yViolations(page, testInfo, 'Add application with errors')
})

test('delete an application, then undo brings it back', async ({ page }) => {
  await addApplication(page, 'Trellis Labs', 'Designer')
  const row = page.getByRole('row', { name: /Trellis Labs/ })

  await row.getByRole('button', { name: /^Delete / }).click()
  await expect(row).toBeHidden()
  // Focus moves to Undo, so a keyboard user can take it back at once.
  const undo = page.getByRole('button', { name: /^Undo delete of .*Trellis Labs/ })
  await expect(undo).toBeFocused()

  await undo.click()
  await expect(row).toBeVisible()
  await expect(row.getByRole('button', { name: /^Edit / })).toBeFocused()
})

test('a deleted application can be restored from Recently deleted', async ({ page }) => {
  await addApplication(page, 'Cordon Systems', 'Analyst')
  await page
    .getByRole('row', { name: /Cordon Systems/ })
    .getByRole('button', { name: /^Delete / })
    .click()

  await page.getByRole('link', { name: /^Recently deleted/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Recently deleted' })).toBeVisible()
  await page.getByRole('button', { name: /^Restore .*Cordon Systems/ }).click()
  await expect(page.getByText('Nothing has been deleted.')).toBeVisible()

  await page.getByRole('link', { name: 'Back to applications' }).click()
  await expect(page.getByRole('row', { name: /Cordon Systems/ })).toBeVisible()
})

test('screens stay accessible with data and the dialog open', async ({ page }, testInfo) => {
  await addApplication(page, 'Espalier Inc', 'Engineer')
  await addApplication(page, 'Pergola Partners', 'Researcher')
  await expectNoA11yViolations(page, testInfo, 'Tracker with two applications')

  await page
    .getByRole('row', { name: /Espalier Inc/ })
    .getByRole('button', { name: /^Edit / })
    .click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'More details (optional)' }).click()
  await expectNoA11yViolations(page, testInfo, 'Edit application dialog, all fields')
  await page.keyboard.press('Escape')

  await page
    .getByRole('row', { name: /Pergola Partners/ })
    .getByRole('button', { name: /^Delete / })
    .click()
  await page.goto('./#/tracker/deleted')
  await expect(page.getByRole('table')).toBeVisible()
  await expectNoA11yViolations(page, testInfo, 'Recently deleted with one application')
})
