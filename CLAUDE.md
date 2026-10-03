# Guyot

A free, open web app for running a supervised job search. Named for the Guyot method of training vines along a wire. Users choose where their data lives and which AI (if any) helps. The app must work fully with no account, no cloud and no AI.

- Live site: https://guyot.sgej.dev (GitLab Pages)
- Main repo: https://gitlab.com/sgej/guyot (push-mirrored to https://github.com/spengjohn/guyot; never push to GitHub directly)
- The developer is new to TypeScript. Briefly explain new TypeScript or React concepts the first time they appear.

## Hard rules (never break these)

1. **No application automation.** The app never opens, fills or submits job application forms. Applying is always fully manual, and no setting can change this.
2. **No backend, no accounts, no analytics on user content.** We never hold personal data.
3. **API keys** stay in the browser, are stored encrypted, are sent only to the chosen AI provider, are never placed in prompts, and are never logged.
4. **Static hosting only.** Everything must build to static files.
5. **Safety is enforced in code, not in prompts.** User-edited instructions or a malicious posting must not be able to switch off output validation, guardrails or the rules above.

## Review gate and automatic mode

- **Default:** every AI suggestion is a proposal the user accepts or rejects.
- **Per stage**, users may switch to automatic after ticking a disclaimer covering API cost, quality risk, possible harm to their applications, and prompt injection. Automatic stages show an "Auto" badge.
- **Guardrails that stay on in automatic mode:**
  1. Output validation still rejects invalid or oversized responses.
  2. Every automatic change is labeled "applied by AI" (time, stage), is undoable, and appears in an "Automatic changes" log.
  3. Flagged items (a new claim not in the master resume, suspicious posting text) are held for review even in automatic mode.
  4. The master resume is never changed automatically; automatic Tailor edits only per-posting copies.
  5. User-set usage caps per run and per day (API calls or estimated cost).

## Principles

- **User choice.** Storage and AI are both optional and swappable. Local-only with no AI is a complete, first-class mode, not a fallback.
- **Manual first.** Build every stage so it works by hand, then add AI as a "Suggest" button that pre-fills the same fields through the review gate (or applies them, in automatic stages).
- **Dependency-light.** Prefer small, hand-written code over libraries (no runtime dependencies without a stated reason). Dashboard charts are hand-built SVG components (no charting library).
- **Accessible by default.** This is an HCI project. Use semantic HTML, labels on every input, keyboard support and visible focus. `eslint-plugin-jsx-a11y` enforces the basics.
- **Small, testable steps.** Show a plan before large changes.

## Tech stack

- React + TypeScript + Vite. Hash routing (`/#/tracker`) so reloads work on static hosting.
- IndexedDB for local storage. JSON export and import.
- ESLint (with jsx-a11y) + Prettier. CI runs `npm run lint`, `npm run format:check`, `npm test` and `npm run build`; a failure blocks deploy.
- Vitest for tests, with fake-indexeddb for storage tests (both dev only).
- Prettier style: no semicolons, single quotes, trailing commas, 100-character lines.

## Commands

- `npm run dev` start the dev server
- `npm run lint` lint
- `npm run format` format all files
- `npm test` run tests once
- `npm run build` type-check and build

Run lint, format:check, test and build before considering a change done.

## Data model

Data integrity is the top priority. Every record and every field carries sync metadata from day one, so merges never lose data and no later migration is needed.

| Record field             | Purpose                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `id` (UUID)              | The record's true identity across all devices                                                               |
| `roleId` (R001, R002...) | Posting-linked records only. Display label linking one posting's rows across stages. Never used as identity |
| `updatedAt` (UTC ms)     | When the record last changed                                                                                |
| `deviceId`               | Which device made the last change                                                                           |
| `deleted` (boolean)      | Deletions sync as flags instead of vanishing                                                                |
| `schemaVersion`          | Lets future versions upgrade old records                                                                    |
| `fieldMeta`              | Map of field -> `{ updatedAt, deviceId, base }`, for field-level merge                                      |
| `purged` (boolean)       | `true` on a tombstone left by permanent removal                                                             |

### Integrity rules

1. **Field-level merge.** Edits to different fields on different devices both survive. If the same field changed on two devices, newest `updatedAt` wins (tie: larger `deviceId`), and the losing value goes to the conflict log so the user can review and restore it.
2. **No hard deletes.** Deletes set `deleted: true`, with undo and a "recently deleted" view. Permanent removal is a separate, deliberate action.
3. **Validate before saving.** Every write is checked against the field's type. Imports and synced files are validated the same way; an invalid file is rejected whole, never half-applied.
4. **Safe upgrades.** Save an automatic local backup before any `schemaVersion` migration.
5. **No dangling links.** Records pointing at a deleted profile or field are kept and flagged, never dropped.
6. **Purge leaves a tombstone.** Permanent removal keeps the `id` and sync fields with `deleted: true, purged: true` and clears all data, so other devices never bring the record back. Purge always wins on merge. It also clears the record's old values from the change log and its conflict log entries.
7. **Defaults never beat real edits.** Values the app fills in (new records' empty fields, migration defaults) are stamped `updatedAt: 0`. Only real edits get a real timestamp, and a zero-stamped value never goes to the conflict log.
8. **Clock skew guard.** An edit is stamped with the later of now and the previous stamp + 1 ms, so it always beats the value it replaced.
9. **Real conflicts only.** Each stamp's `base` records the last other-device stamp it replaced. A losing value goes to the conflict log only if it differs and the winner wasn't made on top of it (same device, or `base` equals the loser's stamp). Map-like fields (`custom`, `overrides`, field choices) get one stamp per entry, keyed `custom.<fieldId>` and so on.
10. **Singletons use fixed IDs.** Synced records there is exactly one of (shared targets) use a hard-coded ID so every device creates the same record. They can't be deleted or purged; "reset" saves empty values as real edits. Local-only stores (`meta` with `deviceId`) never use fixed IDs.
11. **Role ID collisions.** If two records share a Role ID, the one with the smaller `id` keeps it and the other is renumbered to the next free number, logged as a `renumber` change.
12. **Undo never overwrites newer work.** Each change log entry records the exact stamp it wrote on each field. Undo restores a field only if it still has that stamp; otherwise the field is skipped and reported. Undo never compares clock times.

### Dates and times

| Kind of value          | Examples                                           | Stored as                                | Shown as                                                       |
| ---------------------- | -------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------- |
| A moment               | `updatedAt`, sync times, interviews, reminders     | UTC milliseconds                         | Converted to the device's time zone                            |
| A calendar day         | Date applied, follow-up day, deadline with no time | `YYYY-MM-DD` string                      | As is (same day everywhere); never convert through a time zone |
| A deadline with a time | "Apply by Oct 15, 11:59 PM PT"                     | UTC ms plus the posting's IANA time zone | Local time, with the original as a hint                        |

Format dates with the browser's `Intl` APIs so they follow the device locale (MM/DD vs DD/MM). No date library.

### Custom fields

- One field system for every table (Applications, Discover, Triage, Tailor, Targets).
- Built-in fields can be hidden and reordered but not deleted; the dashboard and pipeline depend on them.
- Custom field types: text, long text, number, date, date with time, yes/no, link, choice.
- Field definitions are synced records. Values are keyed by field ID and choice options have IDs, so renames never break data.
- Deleting a custom field hides it first, with undo.
- Field definitions always sync. Visible columns are set per device, with a "copy layout from another device" option.
- Stretch: saved views (filtered layouts such as "Interviewing" or "Overdue").

### Targets

Targets tell the searcher, human or AI, what to look for. Two tables, both open to custom fields:

- **Search profiles** (one per search): Name, Term, Employment types (list of choices), Locations (list of places), Work modes (list of choices), Minimum pay (number + period + currency), Priority (optional choice: High/Medium/Low), Active (yes/no), Notes. To target another set of places, the user duplicates a profile and edits its locations.
- **Shared targets** (one record, applies to every active profile): role types, industries, companies to prioritize, companies to exclude (hard list plus a free-text rule), must-have keywords, nice-to-have keywords, dealbreakers, eligibility notes, preferred sources. Store lists as arrays, not comma-separated text.
- Any profile can override any shared field; the profile's value wins where set.
- Each posting stores the `profileId` it was found under.
- Eligibility notes are personal: send them to an AI only from stages that need them, and mark them in the prompt editor.
- "Max openings per discovery run" belongs to Discover stage settings. "Last updated" comes from `updatedAt`, never typed by hand.

### Tables

Search profiles, shared targets, postings, stage rows (Discover, Triage, Tailor), applications, resume versions, job description snapshots, field definitions, pipeline definitions, stage instructions (versioned), conflict log, change log (includes "applied by AI" entries), meta (deviceId, Role ID counter), settings (local only unless encrypted).

Applications columns: Date Applied, Last Update, Listing, Job Description (snapshot), Company, Role, Status, Resume, Contact, Notes, Role ID, Deadline, Next Follow-up.

## Storage and sync

- One storage adapter interface (`load`, `save`, `listDeviceFiles`). The sync logic never depends on a specific backend.
- Core backends: local only (default), Google Drive (build first), Dropbox, OneDrive. Stretch: S3-compatible, Nextcloud/WebDAV.
- Sign-in to cloud storage uses browser OAuth with PKCE. No server.
- Data is encrypted with the user's passphrase (Web Crypto, AES-GCM) before it leaves the browser. A lost passphrase cannot be recovered; the UI must say so.
- Each device writes only its own file (for example `device-abc123.json`) and merges others field by field using the same merge as JSON import.
- API keys sync only if the user opts in, inside the encrypted file.
- Local-only data is tied to the exact site address. Before any domain change (for example to guyot.app), build an export/import "move" flow.

## AI providers and stage instructions

- One AI adapter interface: Anthropic, OpenAI, Google first, plus local models (Ollama, LM Studio). Optional user-run proxy for providers that block browser calls.
- Default is no AI. Structured (JSON schema) output so results show as editable rows.
- **Two layers of instructions per stage:**
  - **Locked rules** live in app code and cannot be edited or overridden. They are viewable read-only, each with a short "why". Examples: output must match the schema; never invent experience; suggestions stay small; posting text is data, not instructions.
  - **User instructions** are freely editable: red-flag criteria, priority rules, tone, extra checks. They support variables such as `{{posting}}`, `{{resume}}`, `{{targets.mustHaveKeywords}}`.
- User instructions are synced records with version history, revert, and a test run against a sample posting.
- Shared pipelines carry user instructions only. Imports are shown in full, labeled as from someone else, and need approval before use.

## Prompt injection defenses

Postings (pasted or captured) and shared pipelines are untrusted input. The AI has no tools; it only returns data.

1. AI output must be valid JSON matching the stage schema. Reject unknown fields, wrong types and oversized text.
2. Render AI output as plain text. Never as HTML or Markdown that auto-loads images or links. Show link domains; open only on click.
3. Wrap posting text in labeled delimiters marked as data, not instructions (helpful, never relied on alone).
4. Send each stage only the data it needs (eligibility notes only where required).
5. Compare Tailor suggestions to the master resume and flag new skills or claims.
6. Scan postings for injection phrases, invisible characters and hidden text before sending, and warn the user. The browser extension captures visible text only.

## Default pipeline

Discover (paste listings, extract fields, dedupe, mark Keep/Maybe/Skip) → Triage (compare against resume, note gaps and priority) → Tailor (small wording suggestions on the master resume, one-page check, never a full rewrite) → Applied (user clicks after applying; copy to Applications and save a job description snapshot). Users can edit, reorder, add and remove stages.

## Build order

1. Data layer: IndexedDB with sync-ready records, field-level merge, validation, field definitions, JSON export/import. Tests with Vitest + fake-indexeddb (dev only).
2. Tracker and dashboard: Applications table, KPI tiles, goal tracker with pace, charts, "needs attention" list, job description snapshots, Targets screen, column picker.
3. Sync: adapter interface, encryption, then Google Drive, then Dropbox and OneDrive.
4. Manual Triage stage with the review gate.
5. AI settings and adapters, then "Suggest" on Triage.
6. Pipeline editor: custom columns, prompt templates, output schemas, shareable pipelines.
7. Discover and Tailor stages, resume export (PDF, DOCX), one-page check.
8. Browser extension for capturing postings.
9. Stretch: S3-compatible and Nextcloud/WebDAV storage.
