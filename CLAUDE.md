# Guyot

A free, open web app for running a supervised job search. Named for the Guyot method of training vines along a wire. Users choose where their data lives and which AI (if any) helps. The app must work fully with no account, no cloud and no AI.

- Live site: https://guyot.sgej.dev (GitLab Pages)
- Main repo: https://gitlab.com/sgej/guyot (push-mirrored to https://github.com/spengjohn/guyot; never push to GitHub directly)
- The developer is new to TypeScript. Briefly explain new TypeScript or React concepts the first time they appear.

## Hard rules (never break these)

1. **Human review gate.** Every AI suggestion is a proposal the user accepts or rejects. Nothing AI-generated is committed without approval. This cannot be switched off.
2. **No application automation.** The app never opens, fills or submits job application forms.
3. **No backend, no accounts, no analytics on user content.** We never hold personal data.
4. **API keys** stay in the browser, are stored encrypted, are sent only to the chosen AI provider, and are never logged.
5. **Static hosting only.** Everything must build to static files.

## Principles

- **User choice.** Storage and AI are both optional and swappable. Local-only with no AI is a complete, first-class mode, not a fallback.
- **Manual first.** Build every stage so it works by hand, then add AI as a "Suggest" button that pre-fills the same fields through the review gate.
- **Dependency-light.** Prefer small, hand-written code over libraries. Dashboard charts are hand-built SVG components (no charting library).
- **Accessible by default.** This is an HCI project. Use semantic HTML, labels on every input, keyboard support and visible focus. `eslint-plugin-jsx-a11y` enforces the basics.
- **Small, testable steps.** Show a plan before large changes.

## Tech stack

- React + TypeScript + Vite. Hash routing (`/#/tracker`) so reloads work on static hosting.
- IndexedDB for local storage. JSON export and import.
- ESLint (with jsx-a11y) + Prettier. CI runs `npm run lint`, `npm run format:check` and `npm run build`; a failure blocks deploy.
- Prettier style: no semicolons, single quotes, trailing commas, 100-character lines.

## Commands

- `npm run dev` start the dev server
- `npm run lint` lint
- `npm run format` format all files
- `npm run build` type-check and build

Run lint, format:check and build before considering a change done.

## Data model

Every record carries sync fields from day one, so sync never needs a data migration:

| Field                    | Purpose                                      |
| ------------------------ | -------------------------------------------- |
| `id` (UUID)              | Unique across all devices                    |
| `roleId` (R001, R002...) | Links one posting's rows across stages       |
| `updatedAt` (timestamp)  | Newest version wins on merge                 |
| `deviceId`               | Which device made the last change            |
| `deleted` (boolean)      | Deletions sync as flags instead of vanishing |
| `schemaVersion`          | Lets future versions upgrade old records     |

Main tables: postings, stage rows (Discover, Triage, Tailor), applications, resume versions, job description snapshots, pipeline definitions, settings.

Applications columns: Date Applied, Last Update, Listing, Job Description (snapshot), Company, Role, Status, Resume, Contact, Notes, Role ID, Deadline, Next Follow-up. Deadlines display as MM/DD.

## Storage and sync

- One storage adapter interface (`load`, `save`, `listDeviceFiles`). The sync logic never depends on a specific backend.
- Core backends: local only (default), Google Drive (build first), Dropbox, OneDrive. Stretch: S3-compatible, Nextcloud/WebDAV.
- Sign-in to cloud storage uses browser OAuth with PKCE. No server.
- Data is encrypted with the user's passphrase (Web Crypto, AES-GCM) before it leaves the browser. A lost passphrase cannot be recovered; the UI must say so.
- Each device writes only its own file (for example `device-abc123.json`) and merges others record by record (newest `updatedAt` wins).
- API keys sync only if the user opts in, inside the encrypted file.
- Local-only data is tied to the exact site address. Before any domain change (for example to guyot.app), build an export/import "move" flow.

## AI providers

- One AI adapter interface: Anthropic, OpenAI, Google first, plus local models (Ollama, LM Studio). Optional user-run proxy for providers that block browser calls.
- Default is no AI. Structured (JSON schema) output so results show as editable rows.

## Default pipeline

Discover (paste listings, extract fields, dedupe, mark Keep/Maybe/Skip) → Triage (compare against resume, note gaps and priority) → Tailor (small wording suggestions on the master resume, one-page check, never a full rewrite) → Applied (user clicks after applying; copy to Applications and save a job description snapshot). Users can edit, reorder, add and remove stages.

## Build order

1. Data layer: IndexedDB with sync-ready records, encryption, JSON export/import.
2. Tracker and dashboard: Applications table, KPI tiles, goal tracker with pace, charts, "needs attention" list, job description snapshots.
3. Sync: adapter interface, then Google Drive, then Dropbox and OneDrive.
4. Manual Triage stage with the review gate.
5. AI settings and adapters, then "Suggest" on Triage.
6. Pipeline editor: custom columns, prompt templates, output schemas, shareable pipelines.
7. Discover and Tailor stages, resume export (PDF, DOCX), one-page check.
8. Browser extension for capturing postings.
9. Stretch: S3-compatible and Nextcloud/WebDAV storage.
