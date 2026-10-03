# 0010. Validation is hand-written, not a schema library

Status: Accepted (2026-10-03)

## Context

Every write, import and synced file must be checked: types, sizes, dates, links, and that every field has a stamp. Imported files and synced files from other devices are untrusted input. Schema libraries (Zod, Valibot and similar) are the usual tool.

## Decision

Validation is built from small hand-written checks in [validate.ts](../../src/data/validate.ts) (`text`, `num`, `shape`, `arrayOf`, `nullable` and so on), one schema per table.

Reasons:

- The project is dependency-light by principle.
- The rules are specific to our record format: per-field stamps, map entries with their own stamps, tombstones, and stamps allowed for removed map entries. A library would need custom code for most of it anyway.
- It rejects things a general library allows by default: unknown fields, `__proto__`-style keys (prototype pollution), `javascript:` links, impossible dates like 2026-02-30, oversized text.

`Record<Union, true>` checklists (`TABLE_SET`, `CUSTOM_FIELD_TYPES`) make TypeScript fail the build if a new table, field type or action is added without a matching check.

## Alternatives considered

- **Zod or Valibot.** Well tested and familiar to contributors, but an added runtime dependency, and our record rules would still be custom code.

## Consequences

- We maintain the checks ourselves; tests in [validate.test.ts](../../src/data/validate.test.ts) cover them.
- Types and checks are written separately and could drift. The checklists catch missing tables and types, but not a field added to a type and forgotten in its schema. Tests that build full records catch that case.
