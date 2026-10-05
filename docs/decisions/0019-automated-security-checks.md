# 0019. Automated security checks use existing tools, plus a review at each step

Status: Accepted (2026-10-05)

## Context

Guyot handles untrusted input (pasted postings, imported and synced files, AI replies, shared pipelines) and will hold secrets (passphrase-derived keys, API keys). There is no server, so the risks are in the browser: HTML injection, prototype pollution, data corruption, secrets leaking, and the page contacting other sites. We want these checked on every push without adding runtime dependencies. See [security.md](../security.md).

## Decision

- **Static checks with core ESLint rules** (`no-restricted-syntax`, `no-restricted-properties`, `no-restricted-globals`, `no-eval` and similar) that ban the known HTML sinks, code-from-string APIs and web storage.
- **Security tests in the existing harnesses:** Vitest tests in `src/security/` for the data layer, and `e2e/security.e2e.ts` next to the Playwright checks for the browser. A shared hostile input corpus (`src/security/hostileInputs.ts`) feeds both.
- **CI gates:** `npm audit --audit-level=high` and gitleaks over the full git history. Checks run on every push; deploy runs only after they pass.
- **An adversarial review** (Claude Code `/security-review`, then a targeted attack on the new feature) at the end of each build step. Findings become tests.

## Alternatives considered

- **eslint-plugin-security.** Built for Node servers; most of its rules (`detect-non-literal-fs-filename`, `detect-object-injection`) are noise in a browser app. Core rules cover what matters here with no new dependency.
- **OWASP ZAP or another dynamic scanner against the dev server.** Built for apps with a server. Against a static site it mainly reports HTTP headers, which GitLab Pages controls and the dev server doesn't reflect. The Playwright browser checks test the real risks instead.
- **GitLab's SAST and Secret Detection templates.** Free, but on the Free tier they only produce report files and never fail the pipeline. Running gitleaks directly does fail it.
- **DOMPurify for user text.** Only needed if we ever render HTML. We render plain text, and the lint rules keep it that way.

## Consequences

- `npm audit` can turn CI red when a new advisory is published, even with no code change. That's intended: the fix steps are in security.md.
- A harmless `localStorage` use (a theme choice) needs an `eslint-disable` comment with a reason.
- Automated checks only cover attacks someone listed. The per-step review is what finds new ones.
- The Content Security Policy is deferred until the AI and sync steps settle which hosts are needed.
