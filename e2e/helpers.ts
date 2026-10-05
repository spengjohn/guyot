import AxeBuilder from '@axe-core/playwright'
import axe from 'axe-core'
import { expect, type Page, type TestInfo } from '@playwright/test'

// The theme requires 7:1 for all text. WCAG's AAA rule allows 4.5:1 for large text (24px, or
// 18.7px bold), so raise the large-text threshold to 7:1 as well. The rule carries its own copy
// of these options, so it is pointed at the check's options instead.
const allText7to1 = {
  ignoreUnicode: true,
  ignoreLength: false,
  ignorePseudo: false,
  boldValue: 700,
  boldTextPt: 14,
  largeTextPt: 18,
  contrastRatio: {
    normal: { expected: 7, minThreshold: 4.5 },
    large: { expected: 7, minThreshold: 3 },
  },
  pseudoSizeThreshold: 0.25,
  shadowOutlineEmMax: 0.1,
  textStrokeEmMin: 0.03,
}
const axeSource = `${axe.source}
axe.configure({
  checks: [{ id: 'color-contrast-enhanced', options: ${JSON.stringify(allText7to1)} }],
  rules: [{ id: 'color-contrast-enhanced', any: ['color-contrast-enhanced'] }],
})`

export type Screen = { name: string; hash: string }

/** Screens with no link in the main navigation, checked alongside the ones that have one. */
export const EXTRA_SCREENS: Screen[] = [{ name: 'Recently deleted', hash: '#/tracker/deleted' }]

/**
 * Finds the app's screens from the main navigation, so a new screen is checked as soon as it
 * gets a nav link. Only hash links (#/...) count.
 */
export async function findScreens(page: Page): Promise<Screen[]> {
  await page.goto('./')
  const nav = page.getByRole('navigation').first()
  await expect(nav).toBeVisible()
  const screens: Screen[] = []
  for (const link of await nav.getByRole('link').all()) {
    const hash = (await link.getAttribute('href')) ?? ''
    const name = (await link.innerText()).trim()
    if (hash.startsWith('#/') && !screens.some((s) => s.hash === hash)) {
      screens.push({ name, hash })
    }
  }
  // Guard against a silent pass if the nav markup changes and nothing is found.
  expect(screens.length, 'screens found in the main navigation').toBeGreaterThan(1)
  return screens
}

/** The nav screens plus EXTRA_SCREENS. */
export async function allScreens(page: Page): Promise<Screen[]> {
  return [...(await findScreens(page)), ...EXTRA_SCREENS]
}

export async function openScreen(page: Page, screen: Screen) {
  await page.goto(`./${screen.hash}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

/** A file-safe name such as "your-data". */
export function slug(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Text on the accent (primary buttons) or on a danger button only needs 4.5:1, by the theme's
 * own rules (docs/theme.md, "Contrast"); the 7:1 check skips them, and WCAG AA's 4.5:1 check
 * still covers them.
 */
const ACCENT_TEXT = ['button.primary', 'button.danger']

/**
 * Runs axe-core on the current page: WCAG 2.2 A and AA, axe's best practices, and the theme's
 * 7:1 rule for text. Fails softly so one run lists every problem on every screen; the full
 * results are attached to the HTML report.
 */
export async function expectNoA11yViolations(page: Page, testInfo: TestInfo, label: string) {
  const main = await new AxeBuilder({ page, axeSource })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze()
  let contrast = new AxeBuilder({ page, axeSource }).withRules(['color-contrast-enhanced'])
  for (const selector of ACCENT_TEXT) contrast = contrast.exclude(selector)
  const strict = await contrast.analyze()
  const violations = [...main.violations, ...strict.violations]

  await testInfo.attach(`axe ${label}`, {
    body: JSON.stringify(violations, null, 2),
    contentType: 'application/json',
  })
  const summary = violations.map(
    (v) =>
      `[${v.impact}] ${v.id}: ${v.help}\n    ${v.nodes.map((n) => n.target.join(' ')).join('\n    ')}\n    ${v.helpUrl}`,
  )
  expect.soft(summary, `accessibility problems on ${label}`).toEqual([])
}
