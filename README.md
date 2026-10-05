# Guyot

A free, open web app for running a supervised job search. Named for the Guyot method of training vines along a wire.

You choose where your data lives and which AI (if any) helps. Guyot works fully with no account, no cloud and no AI.

- Live site: https://guyot.sgej.dev
- Main repository: https://gitlab.com/sgej/guyot (mirrored to GitHub)

## Principles

- **You review everything.** AI suggestions are proposals you accept or reject. Optional automatic mode keeps guardrails on: validation, an undoable log of every change, and items held for review when flagged.
- **No application automation.** Guyot never opens, fills or submits job application forms.
- **No backend, no accounts, no analytics on your content.** Your data stays in your browser, or in your own cloud storage, encrypted with your passphrase.
- **Your choice of storage and AI.** Local-only with no AI is a complete mode, not a fallback.
- **Accessible by default.** Semantic HTML, labels on every input, keyboard support, visible focus.

## Status

Early development. The data layer (build step 1), the Applications tracker (step 2a) and the Targets and Your data screens (step 2b) are done; the dashboard is next. See [docs/status.md](docs/status.md).

## Development

Requires Node.js (LTS).

```sh
npm install
npm run dev           # start the dev server
npm test              # run tests once
npm run lint          # ESLint, including accessibility rules
npm run format        # format all files with Prettier
npm run build         # type-check and build static files
```

Before considering a change done, run `npm run lint`, `npm run format:check`, `npm test` and `npm run build`. CI runs the same checks, and a failure blocks deploy.

## Documentation

- [docs/status.md](docs/status.md): what's built, what's deferred and what's next
- [docs/data-layer.md](docs/data-layer.md): how storage, merging and validation fit together
- [docs/theme.md](docs/theme.md): colors, type and spacing tokens, and the accessibility rules they meet
- [docs/browser-checks.md](docs/browser-checks.md): automated browser checks (accessibility, flows, screenshots) and what still needs a person
- [docs/decisions/](docs/decisions/): why the design is the way it is, one record per decision
- [docs/typescript-notes.md](docs/typescript-notes.md): TypeScript and React concepts used in this codebase
- [CLAUDE.md](CLAUDE.md): the full project specification and rules
