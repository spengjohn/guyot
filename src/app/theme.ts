/**
 * Light or dark mode (docs/theme.md, "Modes and reader settings"). With no choice saved,
 * the page follows the device. A choice sets <html data-theme>, which tokens.css reads.
 *
 * The choice is a per-device display preference, kept in localStorage rather than the
 * IndexedDB settings: it can be read synchronously before the first paint, so the page
 * never flashes the wrong colors. It holds no user data.
 */
export type ThemeChoice = 'light' | 'dark'

const KEY = 'guyot-theme'

export function savedTheme(): ThemeChoice | null {
  try {
    // eslint-disable-next-line no-restricted-globals -- display preference only, see above
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null // storage can be blocked; then the device setting applies
  }
}

/** Whether the page is dark right now: the saved choice, or else the device setting. */
export function isDark(choice: ThemeChoice | null = savedTheme()): boolean {
  if (choice) return choice === 'dark'
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

export function applyTheme(choice: ThemeChoice | null): void {
  if (choice) document.documentElement.dataset.theme = choice
  else delete document.documentElement.dataset.theme
}

export function saveTheme(choice: ThemeChoice): void {
  applyTheme(choice)
  try {
    // eslint-disable-next-line no-restricted-globals -- display preference only, see above
    localStorage.setItem(KEY, choice)
  } catch {
    // not saved, but applied for this visit
  }
}
