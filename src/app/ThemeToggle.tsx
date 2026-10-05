import { useState } from 'react'
import { isDark, saveTheme } from './theme'

/**
 * A "Dark mode" toggle button. aria-pressed tells screen readers whether it's on, so
 * the label stays the same. It starts from the saved choice, or the device setting.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState(() => isDark())
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-pressed={dark}
      onClick={() => {
        saveTheme(dark ? 'light' : 'dark')
        setDark(!dark)
      }}
    >
      Dark mode
    </button>
  )
}
