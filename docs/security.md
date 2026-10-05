# Security

Guyot has no server and holds no one's data, so most classic web attacks don't apply. What does apply: files and postings from anywhere are untrusted, AI replies are untrusted, and the browser holds the user's data, passphrase-derived keys and (later) API keys. This page lists what can go wrong, what is checked automatically, and what still needs a person.

Why the checks look like this: [ADR 0019](decisions/0019-automated-security-checks.md).

## What we protect, and from what

| Asset                              | Threat                                                              | Main defence                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| The user's data in IndexedDB       | A malicious import, backup or synced file corrupts or pollutes it   | All-or-nothing validation ([0009](decisions/0009-all-or-nothing-import.md), [0010](decisions/0010-hand-written-validation.md)) |
| The page itself                    | Posting text, imported text or AI output rendered as HTML runs code | Render as plain text; lint rules ban the HTML sinks                                                                            |
| Encrypted exports and synced files | Wrong passphrase, tampered file, weak key derivation                | AES-GCM (tamper-evident) with a fresh IV, per the encrypted exports ADR                                                        |
| API keys (step 5)                  | Logged, put in prompts, stored readable, sent to the wrong host     | Hard rule 3; lint bans `localStorage` and `console.log`                                                                        |
| The user's choices about AI        | Prompt injection in a posting switches off guardrails               | Hard rule 5: guardrails in code; output validation                                                                             |
| The user's privacy                 | The page contacts other sites (fonts, analytics, CDNs)              | Browser check fails on any request to another site                                                                             |
| The published site                 | A compromised or vulnerable dependency; a committed secret          | `npm audit` and gitleaks in CI                                                                                                 |

## Automated checks

All of these run in CI and block the deploy when they fail.

| Check                   | Where                                                 | Catches                                                                                                                                                                                                                                                                            |
| ----------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security lint rules     | `eslint.config.js`, run by `npm run lint`             | `dangerouslySetInnerHTML`, `innerHTML`/`outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`, `javascript:` URLs, `localStorage`/`sessionStorage`, `console.log`                                                                                             |
| Data security tests     | `src/security/*.test.ts`, run by `npm test`           | Import: prototype pollution, unsafe links, oversized or deeply nested files, hostile text being altered. Restore: a tampered backup changes nothing. Encrypted exports: every header part tamper-checked, key settings never weaker than ADR 0016, decrypted files still validated |
| Hostile input corpus    | `src/security/hostileInputs.ts`                       | Shared list of attack strings; add new ones here and every test picks them up                                                                                                                                                                                                      |
| Browser security checks | `e2e/security.e2e.ts`, run with the Playwright checks | Requests to other sites, cookies, secret-looking keys in web storage, pop-up dialogs                                                                                                                                                                                               |
| Dependency audit        | `npm run audit` in CI                                 | Known vulnerabilities (high or critical) in any dependency                                                                                                                                                                                                                         |
| Secret scanning         | `secrets` job (gitleaks) in CI                        | API keys, tokens and private keys anywhere in git history                                                                                                                                                                                                                          |

Run the fast ones locally with `npm run lint` and `npm run test:security`.

### When a check fails

- **Lint rule:** render the text with plain JSX (`{text}`) or `textContent`. For a harmless UI preference in `localStorage` (for example the theme), add `// eslint-disable-next-line no-restricted-globals -- why` on that line.
- **`npm run audit`:** run `npm audit` to see the package. Try `npm audit fix`. If no fix exists and the package is dev-only and never reaches the built site, note it in `docs/status.md` and pin or override it in `package.json`.
- **gitleaks:** treat the secret as leaked. Revoke it at the provider first, then remove it from the code. Deleting the commit is not enough on a public repo.

## Checks to add as features land

| Build step                  | Add                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sync (step 3)               | Tests: a synced device file is decrypted and validated like an import; a tampered or wrong-passphrase file changes nothing                                         |
| Screens that show user text | Browser test: paste each `MARKUP_PAYLOADS` string, then check `window.__pwned` is unset and no `<script>`/`<img>` appeared                                         |
| AI adapters (step 5)        | Tests: oversized, wrong-type and extra-field replies are rejected; API key never appears in a prompt, log or error; requests go only to the chosen provider's host |
| Injection scanner           | Tests over `INJECTION_PHRASES` and `HIDDEN_TEXT`: each one is flagged and held for review, also in automatic mode                                                  |
| Shared pipelines (step 6)   | Tests: an imported pipeline cannot change locked rules, caps or the review gate                                                                                    |
| Browser extension (step 8)  | Tests: hidden text (`display:none`, zero-size, off-screen) is not captured                                                                                         |

### Content Security Policy (recommended next)

A CSP tells the browser to refuse any script the app didn't ship, which turns most HTML-injection bugs into harmless ones. GitLab Pages can't set headers, but a `<meta http-equiv="Content-Security-Policy">` added at build time works. It is not on yet because the AI and sync steps decide which hosts `connect-src` must allow (cloud storage, AI providers, a local model, a user-run proxy).

## What automation cannot replace

Automated checks only find the problems someone thought to write down. They won't notice a new feature that sends eligibility notes to the wrong stage, a guardrail that a clever prompt can talk around, or a design that trusts a synced file too much. That needs an adversarial review: someone (a person or Claude) actively trying to break the app.

Do one at the end of every build step, before it's marked done in `docs/status.md`:

1. Run `/security-review` in Claude Code on the step's changes.
2. Then ask Claude Code to attack the new feature against this page's threat table: "Act as an attacker. Using docs/security.md, try to break what this step added. Write a failing test for anything you find."
3. Every real finding becomes a test in `src/security/` or `e2e/security.e2e.ts`, so it can't come back.
4. Update the threat table above if the step added a new asset or a new way in.
