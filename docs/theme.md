# Theme

Guyot's look is the vineyard theme: warm earth, one leaf green, honey for AI, and Atkinson Hyperlegible Next. Why: [decision 0017](decisions/0017-vineyard-theme.md).

All design values are CSS custom properties (tokens) in [src/styles/tokens.css](../src/styles/tokens.css). Component CSS in [src/index.css](../src/index.css) uses them by name.

## Rules

1. **Never use a literal color in component CSS.** Use a token. If none fits, ask before adding one: the palette is deliberately small. A new token goes in `tokens.css` in light and both dark blocks, and its pairs go in `RULES` in `tokens.test.ts`.
2. **Three color families only.** Earth (backgrounds, text, borders), leaf (actions, links, the current page), fruit (AI). Brick red is for errors and destructive actions only. No new hues, including for focus, status or charts, without the owner's say.
3. **Never use color alone to carry meaning.** Pair it with text, a shape, an icon or an underline (the current page is bold and underlined; errors have a message).
4. **Sizes in `rem`**, so the reader's browser font size applies. Borders and the focus ring may use `px`.
5. **Every interactive element keeps a visible focus ring.** It comes from the global `:focus-visible` rule; don't remove it with `outline: none`.

## Colors

| Token              | Use                                                     | Light     | Dark      |
| ------------------ | ------------------------------------------------------- | --------- | --------- |
| `--bg`             | Page background                                         | `#f8f4ec` | `#1a1712` |
| `--surface`        | Header, tables, dialogs, panels, inputs, buttons        | `#fffdf8` | `#2d2820` |
| `--surface-alt`    | Striped table rows                                      | `#f3eee3` | `#24201a` |
| `--text`           | Body text                                               | `#241f17` | `#f0eadf` |
| `--muted`          | Hints, captions, column headers                         | `#554c3d` | `#c6bca9` |
| `--border`         | Dividers only, never the only edge of a control         | `#e0d7c4` | `#3f392f` |
| `--control-border` | Edges of inputs and buttons                             | `#7d7360` | `#8a8270` |
| `--accent`         | Leaf: primary buttons, current page underline, notices  | `#437514` | `#b0ce91` |
| `--accent-text`    | Text on `--accent`                                      | `#fefde4` | `#171613` |
| `--link`           | Links (a darker leaf in light mode, to reach 7:1)       | `#284606` | `#b0ce91` |
| `--ai`             | Fruit: anything AI suggested or applied (text, borders) | `#5f4300` | `#e2c77e` |
| `--ai-bg`          | Fruit wash: background of AI badges and AI-filled areas | `#f5e6bd` | `#45350c` |
| `--danger`         | Brick: errors, conflicts, destructive buttons           | `#8a2a0b` | `#edaf98` |
| `--focus`          | Focus ring (same as text: no extra hue)                 | `#241f17` | `#f0eadf` |
| `--notice-bg`      | Notices (Undo, saved elsewhere, import result)          | `#eaf0dc` | `#2f311e` |
| `--overlay`        | Dialog backdrop                                         | 55% text  | 65% black |

Contrast targets, checked in both modes by `src/styles/tokens.test.ts`:

| What                                          | Minimum | WCAG                                |
| --------------------------------------------- | ------- | ----------------------------------- |
| Any text on any surface it appears on         | 7:1     | 1.4.6 (AAA)                         |
| Text on the accent or on a danger button      | 4.5:1   | 1.4.3 (AA)                          |
| Control borders, focus ring, current-page bar | 3:1     | 1.4.11 (AA); 2.4.13 for focus (AAA) |

## Recipes

Use these patterns instead of inventing new ones.

| Thing                     | How                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| Primary button            | `<button className="primary">`: `--accent` fill, `--accent-text` label                    |
| Other buttons             | Plain `<button>`: `--surface` fill, 2px `--control-border` edge                           |
| Destructive button        | `<button className="danger">`: `--danger` fill, `--surface` label. Always confirm first   |
| Notice                    | `.notice`: `--notice-bg` with a 4px `--accent` left bar                                   |
| Error on a field          | `aria-invalid="true"` (brick border) plus a `.field-error` message                        |
| Error summary, conflicts  | `.error-summary` or `.conflicts`: brick edge, text stays `--text`                         |
| AI suggested or applied   | `--ai-bg` background, `--ai` text or 2px border, and a text label ("AI suggested")        |
| Hint or caption           | `.hint` or `<caption>`: `--muted`                                                         |
| Panel, dialog, table wrap | `--surface`, 1px `--border`, `--radius-lg`                                                |
| Card inside a panel       | `.card`: `--bg` fill so it stands off the panel, 1px `--border`, `--radius-lg`            |
| Collapsible field         | `details.collapsible`: `--surface`, 1px `--border`; the preview text is `--muted`         |
| Small tag                 | `.tag`: `--text-sm`, a pill with a 1px border in its text color (`--danger` or `--muted`) |

## Type

| Token                                      | Value                                        |
| ------------------------------------------ | -------------------------------------------- |
| `--font-body`                              | Atkinson Hyperlegible Next, then system font |
| `--text-sm` / `base` / `lg` / `xl` / `2xl` | 0.875 / 1 / 1.125 / 1.375 / 1.75 rem         |
| `--leading` / `--leading-tight`            | 1.5 body, 1.2 headings                       |
| `--weight-regular` / `semibold` / `bold`   | 400 / 600 / 700                              |

Body text is 16px at the browser's default size. Tables use tabular figures, so dates and Role IDs line up. The font draws zero with a slash, so 0 and O never look alike.

## Space and shape

- Spacing scale `--space-1` to `--space-6`: 0.25, 0.5, 0.75, 1, 1.5, 2 rem. Table rows use `--row-padding` (0.5rem, "comfortable").
- Corners are crisp: `--radius` 3px for controls, `--radius-lg` 6px for panels and dialogs.
- `--control-border-width` 2px, `--control-min-height` 2.5rem (40px).
- `--focus-width` 3px, `--focus-offset` 2px.

## Icon

[public/favicon.svg](../public/favicon.svg) is a Guyot-trained vine: a trellis wire, a trunk with two arms along it, two leaves at the top, a bunch of grapes under each arm, and a mound of ground. It is drawn on a 32 × 32 grid in the filled style of Material's "Sprout" icon.

- Its colors are the theme's: wire `--control-border`, vine and ground `--accent`, grapes `--ai`. It switches to the dark values with `prefers-color-scheme`, so it reads on light and dark browser tabs.
- The SVG has its own `<style>` with hex values, because a favicon can't read the page's CSS. If the palette changes, update it by hand.
- Use the same file for the header brand mark if one is added (with `alt=""` next to the word Guyot, since the name is already there).

## Modes and reader settings

- **Light and dark** follow the device. Setting `data-theme="light"` or `"dark"` on `<html>` overrides it. The **Dark mode** toggle in the header (`src/app/ThemeToggle.tsx`, `aria-pressed`) sets it and remembers the choice on this device (`localStorage`, read before the first render so the page never flashes the wrong mode). Once toggled, the page no longer follows the device; a "use device setting" option is still to come.
- **Forced colors** (Windows High Contrast): the system chooses colors; the CSS keeps the current-page underline, button edges and disabled-button cues.
- **Reduced motion**: animations and transitions are turned off.

## Not yet defined

- Status markers for the Applications table (a distinct shape per status, so status isn't shown by color alone).
- Chart colors for the dashboard (step 2c). Draw from the three families (earth, leaf, fruit) in different lightness steps and use shape or pattern too; check each against `--surface` at 3:1 in both modes. Ask before adding a hue.
- The "AI suggested" and "Auto" badges (step 5) will use `--ai` and `--ai-bg`.
- A "use device setting" option next to the Dark mode toggle.
