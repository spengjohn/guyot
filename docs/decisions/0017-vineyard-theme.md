# 0017. The vineyard theme: three color families, AAA text and a self-hosted font

Status: Accepted (2026-10-05)

## Context

Step 2a shipped a small set of colors in `index.css` before any visual direction was chosen. Before more screens are built on it, the project needs one theme that every screen draws from, and it has to carry the "accessible by default" principle. Two problems in the first set showed why: button borders used the divider color (about 1.7:1 against white, below the 3:1 that WCAG 1.4.11 asks of controls), and `:root` set the font size in pixels, which overrides the reader's browser font size setting.

Three directions were compared on the real Tracker screen. The owner liked the legibility of "Field notebook" (teal) but wanted to keep the nature theme the name Guyot implies, so the colors were tuned by hand on a style card and then narrowed, because the first palette had too many hues (a separate violet focus color in particular).

## Decision

- **Tokens.** All colors, type sizes, spacing, radii, border widths and focus ring settings are custom properties in `src/styles/tokens.css`. Component CSS uses token names only, never literal colors. See [docs/theme.md](../theme.md).
- **Three color families.** Warm earth for backgrounds, text and borders; one leaf green for actions, links and the current page; honey ("fruit") reserved for anything AI suggested or applied, so AI output is recognizable before the "Auto" and "applied by AI" labels exist. Brick red marks errors only. The focus ring uses the text color, so it adds no hue and still reaches 3:1 everywhere.
- **Contrast above the minimum.** All text, including hints, column headers, links and errors, reaches 7:1 (WCAG AAA) on every surface it appears on, in both modes. Text on the accent reaches 4.5:1; control borders, the focus ring and the current-page marker reach 3:1. A test computes every pair from the CSS file, so a token change that breaks a rule fails CI.
- **Typeface.** Atkinson Hyperlegible Next, designed by the Braille Institute so easily confused characters (I, l, 1; O, 0) look different. It is served from our own site as four variable WOFF2 files (latin and latin-ext, upright and italic; about 110 KB in all, and a browser downloads only the ones a page uses), with the system font as fallback.
- **Reader settings win.** Sizes are in `rem`, so the browser font size applies. Light, dark or system mode via `<html data-theme>`; Windows High Contrast (forced colors) keeps the current-page and disabled cues; reduced motion stops any future animation.
- **Shape.** Crisp corners (3px controls, 6px panels), 2px control borders, 40px minimum control height, striped table rows with comfortable padding.
- **Icon.** A Guyot-trained vine (wire, trunk, two arms, two leaves, two grape bunches, ground) in the filled style of Material's Sprout icon, using the theme colors with a dark-mode variant.

## Alternatives considered

- **The teal "Field notebook" palette.** Legible, but it lost the vineyard identity, and its violet focus ring added a fourth hue.
- **A separate focus color.** Common advice is a hue that differs from the accent. The text color already differs from every background by 7:1 or more, so it is more visible than any extra hue and keeps the palette calm.
- **Keep system fonts.** No download, but the text looks different on every platform, and system UI fonts make I, l and 1 nearly identical, which matters in Role IDs and dates.
- **Load the font from Google Fonts.** Simpler, but it sends every visitor's IP address to a third party, which conflicts with "no analytics on user content" in spirit, and fails offline.
- **A font package from npm (Fontsource).** Adds a dependency for four files we can commit directly.
- **AA (4.5:1) as the target.** Meets the law, but hints and captions in light gray are a common complaint among low-vision users, and AAA cost nothing in this palette.
- **An existing icon** (Lucide, Tabler, Material and Game Icons grapes and vines). None shows a trellis-trained vine, which is what "Guyot" names.

## Consequences

- Dark colors are written twice in `tokens.css` (for "follow the device" and "chosen dark"); a test checks the two copies match.
- A new color must be added in both modes and to the contrast rules in `tokens.test.ts`, and the owner prefers no new hues; status markers and chart colors must work within the three families plus shape.
- About 110 KB of fonts (at most; usually only the latin upright file, 34 KB, is downloaded). The font's license (SIL OFL) must ship with it: `src/assets/fonts/OFL.txt`.
- The favicon holds its own copy of four colors; a palette change must update it by hand.
- The theme setting (System, Light, Dark) needs a control in a settings screen; until then the app follows the device.

## In the code

- `src/styles/tokens.css`, `src/styles/fonts.css`, `src/assets/fonts/`
- `src/index.css` (uses the tokens)
- `src/styles/tokens.test.ts`
- `public/favicon.svg`
