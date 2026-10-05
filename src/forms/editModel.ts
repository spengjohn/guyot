import { getValue, jsonEqual } from '../data/merge'
import type { ExpectedStamps } from '../data/repo'
import { sameStamp } from '../data/stamp'
import type { FieldValue } from '../data/types/fields'
import type { FieldMeta, StampRef } from '../data/types/record'
import type { ListOverride } from '../data/types/tables'
import type { FieldSpec } from '../fields/columns'

/**
 * How edit forms track changes (docs/decisions/0014). A form keeps only the user's
 * edits, each with the stamp of the saved value it was made on. Fields the user hasn't
 * touched always show the latest saved value, so a save in another tab updates them
 * while the form is open. An edit whose field was saved again elsewhere since is a
 * conflict, and the user chooses which to keep.
 *
 * Works for any table: fields are addressed by their fieldMeta key ('notes',
 * 'custom.<fieldId>', 'overrides.roleTypes', 'customOverrides.<fieldId>').
 */

/** A record with its field stamps. For a new one, its defaults with no stamps. */
export type SavedRecord = object & { fieldMeta: FieldMeta }

/**
 * A value in a form. `undefined` is only used for an override entry, where it means
 * "no override: use the shared value".
 */
export type EditValue = FieldValue | ListOverride | undefined

export interface Edit {
  value: EditValue
  /** Stamp of the saved value this edit was made on; null if the field had none. */
  base: StampRef | null
}
/** Keyed by fieldMeta key. */
export type Edits = Readonly<Record<string, Edit>>

/** The field's key in fieldMeta (and in Edits). */
export function metaKey(field: FieldSpec): string {
  return field.path ?? (field.custom ? `custom.${field.key}` : field.key)
}

/**
 * The field's saved value. A missing custom value reads as null (empty); a missing
 * override reads as undefined (not overridden).
 */
export function savedValue(record: object, field: FieldSpec): EditValue {
  const value = getValue(record, metaKey(field)) as EditValue
  return value === undefined && !field.path ? null : value
}

function savedStamp(record: SavedRecord, field: FieldSpec): StampRef | null {
  return record.fieldMeta[metaKey(field)] ?? null
}

function sameRef(a: StampRef | null, b: StampRef | null): boolean {
  return a === null || b === null ? a === b : sameStamp(a, b)
}

export interface FieldState {
  /** What the input shows: the user's edit, or else the latest saved value. */
  value: EditValue
  edited: boolean
  /** Set when another save changed this field after the user's edit was based on it. */
  conflict: { yours: EditValue; saved: EditValue } | null
  /** Saved again elsewhere since the form opened (whether or not the user edited it). */
  changedSinceOpened: boolean
}

/**
 * One field's state in the form. `latest` is the record as saved now, or null if it is
 * gone (deleted elsewhere) or the form is adding a new one; `opened` is the record as it
 * was when the form opened.
 */
export function fieldState(
  field: FieldSpec,
  edits: Edits,
  latest: SavedRecord | null,
  opened: SavedRecord,
): FieldState {
  const source = latest ?? opened
  const saved = savedValue(source, field)
  const stamp = savedStamp(source, field)
  const changedSinceOpened = latest !== null && !sameRef(savedStamp(opened, field), stamp)
  const edit = edits[metaKey(field)]
  if (!edit) return { value: saved, edited: false, conflict: null, changedSinceOpened }
  const conflict =
    latest !== null && !sameRef(edit.base, stamp) && !jsonEqual(edit.value, saved)
      ? { yours: edit.value, saved }
      : null
  return { value: edit.value, edited: true, conflict, changedSinceOpened }
}

/**
 * A React key for the field's input. It changes when the input must start fresh: when
 * a newer save replaces the value an untouched field shows, or after a conflict is
 * resolved. It doesn't change while the user types (a first edit keeps the same stamp).
 */
export function controlKey(field: FieldSpec, edits: Edits, source: SavedRecord): string {
  const edit = edits[metaKey(field)]
  const stamp = edit ? edit.base : savedStamp(source, field)
  return `${metaKey(field)}@${stamp ? `${stamp.updatedAt}.${stamp.deviceId}` : 'none'}`
}

/** Records an edit. The first edit of a field remembers which saved version it's based on. */
export function withEdit(
  edits: Edits,
  field: FieldSpec,
  value: EditValue,
  source: SavedRecord,
): Edits {
  const key = metaKey(field)
  const base = key in edits ? edits[key].base : savedStamp(source, field)
  return { ...edits, [key]: { value, base } }
}

/** Resolves a conflict by keeping the user's value: it is now based on the latest save. */
export function keepMine(edits: Edits, field: FieldSpec, latest: SavedRecord): Edits {
  const key = metaKey(field)
  const edit = edits[key]
  return edit ? { ...edits, [key]: { ...edit, base: savedStamp(latest, field) } } : edits
}

/** Resolves a conflict by dropping the user's edit: the field shows the saved value again. */
export function takeSaved(edits: Edits, field: FieldSpec): Edits {
  const next = { ...edits }
  delete next[metaKey(field)]
  return next
}

/** Writes one edit into a plain record by fieldMeta key; undefined removes a map entry. */
function apply(target: Record<string, unknown>, key: string, value: EditValue, base: object) {
  const dot = key.indexOf('.')
  if (dot === -1) {
    target[key] = structuredClone(value)
    return
  }
  const [top, entry] = [key.slice(0, dot), key.slice(dot + 1)]
  if (!Object.hasOwn(target, top)) {
    target[top] = { ...((base as Record<string, unknown>)[top] as object) }
  }
  const map = target[top] as Record<string, unknown>
  if (value === undefined) delete map[entry]
  else map[entry] = structuredClone(value)
}

/**
 * What to save, and the stamps each changed field must still have. Edits equal to the
 * saved value are left out. `current` is the record as just read from the database:
 * Repo replaces whole maps (custom, overrides...), so their unchanged entries come from it.
 */
export function saveRequest(
  fields: readonly FieldSpec[],
  edits: Edits,
  current: object,
): { changes: Record<string, unknown>; expected: ExpectedStamps } {
  const changes: Record<string, unknown> = {}
  const expected: ExpectedStamps = {}
  for (const field of fields) {
    const key = metaKey(field)
    const edit = edits[key]
    if (!edit || jsonEqual(edit.value, savedValue(current, field))) continue
    expected[key] = edit.base
    apply(changes, key, edit.value, current)
  }
  return { changes, expected }
}

/** The data for a new record: its defaults with the user's edits. */
export function newRecordData(
  fields: readonly FieldSpec[],
  edits: Edits,
  defaults: SavedRecord,
): Record<string, unknown> {
  const record = structuredClone(defaults) as Record<string, unknown>
  delete record.fieldMeta // set by Repo
  for (const field of fields) {
    const edit = edits[metaKey(field)]
    if (edit) apply(record, metaKey(field), edit.value, defaults)
  }
  return record
}

// ---------- Required fields and errors ----------

export function isEmptyValue(value: EditValue): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
}

/**
 * Required fields left empty, by field key, with what to do about each. A form rule:
 * stored and imported records may lack these and stay valid.
 */
export function missingRequired(
  fields: readonly FieldSpec[],
  valueOf: (field: FieldSpec) => EditValue,
  messages: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const missing: Record<string, string> = {}
  for (const field of fields) {
    if (!field.required || field.readOnly) continue
    if (isEmptyValue(valueOf(field))) {
      missing[field.key] = messages[field.key] ?? `Fill in ${field.label}`
    }
  }
  return missing
}

export interface FormErrors {
  byField: Record<string, string> // field key -> message
  general: string[]
}

/**
 * Turns Repo validation errors ('applications.listing: expected a web link') into
 * messages beside the right inputs, by field key. Anything that doesn't name one of
 * the form's fields is general.
 */
export function formErrors(
  table: string,
  errors: readonly string[],
  fields: readonly FieldSpec[],
): FormErrors {
  const byPath = new Map(fields.map((f) => [metaKey(f), f]))
  const result: FormErrors = { byField: {}, general: [] }
  for (const error of errors) {
    const colon = error.indexOf(': ')
    const path =
      error.startsWith(`${table}.`) && colon !== -1 ? error.slice(table.length + 1, colon) : ''
    // 'deadline.at.timeZone' -> 'deadline'; 'custom.<id>.x' -> 'custom.<id>'
    const parts = path.split(/[.[]/)
    const field = byPath.get(parts[0]) ?? byPath.get(parts.slice(0, 2).join('.'))
    if (!field) {
      result.general.push(error)
      continue
    }
    result.byField[field.key] ??= `${field.label}: ${error.slice(colon + 2)}`
  }
  return result
}
