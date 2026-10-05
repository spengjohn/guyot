/// <reference types="node" />
// The line above lets this test (which runs in Node) use Node's file API; app code can't.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')

/** The `--name: #rrggbb` colors declared in the first block that follows `selector`. */
function colors(selector: string): Record<string, string> {
  const start = css.indexOf(selector)
  if (start < 0) throw new Error(`No block for ${selector}`)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]),
  )
}

/** Relative luminance, as defined by WCAG 2. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** [minimum ratio, foreground token, background tokens it appears on] */
const RULES: [number, string, string[]][] = [
  [7, 'text', ['bg', 'surface', 'surface-alt', 'notice-bg', 'ai-bg']],
  [7, 'muted', ['bg', 'surface', 'surface-alt', 'notice-bg']],
  [7, 'link', ['bg', 'surface', 'notice-bg']],
  [7, 'danger', ['bg', 'surface', 'notice-bg']],
  [7, 'ai', ['surface', 'ai-bg']],
  [4.5, 'accent-text', ['accent']],
  [4.5, 'surface', ['danger']], // text on danger buttons
  [3, 'control-border', ['bg', 'surface']],
  [3, 'focus', ['bg', 'surface', 'notice-bg']],
  [3, 'accent', ['bg', 'surface']],
]

const light = colors(':root {')
const dark = colors(":root[data-theme='dark']")

describe('theme tokens', () => {
  it.each([
    ['light', light],
    ['dark', dark],
  ])('meet the contrast rules in %s mode', (_mode, palette) => {
    const failures: string[] = []
    for (const [min, fg, backgrounds] of RULES) {
      for (const bg of backgrounds) {
        const ratio = contrast(palette[fg], palette[bg])
        if (ratio < min) failures.push(`${fg} on ${bg}: ${ratio.toFixed(2)} (needs ${min})`)
      }
    }
    expect(failures).toEqual([])
  })

  it('use the same dark colors for the device setting and the chosen dark mode', () => {
    expect(colors(":root:not([data-theme='light'])")).toEqual(dark)
  })

  it('define every light color again for dark mode', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort())
  })
})
