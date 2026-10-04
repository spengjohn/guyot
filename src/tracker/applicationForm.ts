import { APPLICATION_FIELDS, DEFAULT_STATUS } from '../data/builtinFields'
import { jsonEqual } from '../data/merge'
import type { ExpectedStamps } from '../data/repo'
import { sameStamp } from '../data/stamp'
import type { CalendarDay, FieldId, RoleId } from '../data/types/core'
import type { FieldValue } from '../data/types/fields'
import type { FieldMeta, StampRef } from '../data/types/record'
import type { ApplicationData } from '../data/types/tables'
import type { FieldSpec } from '../fields/columns'

/**
 * How the Add/Edit form tracks changes (docs/decisions/0014). The form keeps only the
 * user's edits, each with the stamp of the saved value it was made on. Fields the user
 * hasn't touched always show the latest saved value, so a save in another tab updates
 * them while the form is open. An edit whose field was saved again elsewhere since is a
 * conflict, and the user chooses which to keep.
 */

/** A saved application with its field stamps. For a new one, the defaults with no stamps. */
export type SavedApplication = ApplicationData & { fieldMeta: FieldMeta }

export interface Edit {
  value: FieldValue
  /** Stamp of the saved value this edit was made on; null if the field had none. */
  base: StampRef | null
}
/** Keyed by fieldMeta key: 'notes', or 'custom.<fieldId>'. */
export type Edits = Readonly<Record<string, Edit>>

/** The field's key in fieldMeta (and in Edits). */
export function metaKey(field: FieldSpec): string {
  return field.custom ? `custom.${field.key}` : field.key
}

export function savedValue(record: ApplicationData, field: FieldSpec): FieldValue {
  if (field.custom) return record.custom[field.key as FieldId] ?? null
  return (record as unknown as Record<string, FieldValue>)[field.key] // built-in keys are ApplicationData keys
}

function savedStamp(record: SavedApplication, field: FieldSpec): StampRef | null {
  return record.fieldMeta[metaKey(field)] ?? null
}

function sameRef(a: StampRef | null, b: StampRef | null): boolean {
  return a === null || b === null ? a === b : sameStamp(a, b)
}

export interface FieldState {
  /** What the input shows: the user's edit, or else the latest saved value. */
  value: FieldValue
  edited: boolean
  /** Set when another save changed this field after the user's edit was based on it. */
  conflict: { yours: FieldValue; saved: FieldValue } | null
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
  latest: SavedApplication | null,
  opened: SavedApplication,
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
export function controlKey(field: FieldSpec, edits: Edits, source: SavedApplication): string {
  const edit = edits[metaKey(field)]
  const stamp = edit ? edit.base : savedStamp(source, field)
  return `${metaKey(field)}@${stamp ? `${stamp.updatedAt}.${stamp.deviceId}` : 'none'}`
}

/** Records an edit. The first edit of a field remembers which saved version it's based on. */
export function withEdit(
  edits: Edits,
  field: FieldSpec,
  value: FieldValue,
  source: SavedApplication,
): Edits {
  const key = metaKey(field)
  const base = edits[key]?.base ?? savedStamp(source, field)
  return { ...edits, [key]: { value, base } }
}

/** Resolves a conflict by keeping the user's value: it is now based on the latest save. */
export function keepMine(edits: Edits, field: FieldSpec, latest: SavedApplication): Edits {
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

/**
 * What to save, and the stamps each changed field must still have. Edits equal to the
 * saved value are left out. `current` is the record as just read from the database:
 * Repo replaces the whole custom map, so unchanged entries come from it.
 */
export function saveRequest(
  fields: readonly FieldSpec[],
  edits: Edits,
  current: ApplicationData,
): { changes: Partial<ApplicationData>; expected: ExpectedStamps } {
  const changes: Record<string, unknown> = {}
  const expected: ExpectedStamps = {}
  const custom: Record<string, FieldValue> = { ...current.custom }
  let customChanged = false
  for (const field of fields) {
    const edit = edits[metaKey(field)]
    if (!edit || jsonEqual(edit.value, savedValue(current, field))) continue
    expected[metaKey(field)] = edit.base
    if (field.custom) {
      custom[field.key] = edit.value
      customChanged = true
    } else {
      changes[field.key] = structuredClone(edit.value)
    }
  }
  if (customChanged) changes.custom = custom
  return { changes: changes as Partial<ApplicationData>, expected } // keys come from the field specs
}

// ---------- New applications ----------

export function newDraft(today: CalendarDay): SavedApplication {
  return {
    roleId: 'R000' as RoleId, // a placeholder; Repo assigns the real one on create
    postingId: null,
    dateApplied: today,
    lastUpdate: null,
    listing: '',
    jdSnapshotId: null,
    company: '',
    role: '',
    status: DEFAULT_STATUS,
    resumeVersionId: null,
    contact: '',
    notes: '',
    nextFollowUp: null,
    custom: {},
    fieldMeta: {},
  }
}

/** The data for a new application: the defaults with the user's edits. */
export function newApplication(
  fields: readonly FieldSpec[],
  edits: Edits,
  defaults: SavedApplication,
): ApplicationData {
  // A writable view of a copy: the loop below sets fields by key.
  const record = structuredClone(defaults) as unknown as Record<string, unknown> & ApplicationData
  delete record.fieldMeta // set by Repo
  for (const field of fields) {
    const edit = edits[metaKey(field)]
    if (!edit) continue
    if (field.custom) record.custom[field.key as FieldId] = edit.value
    else record[field.key] = structuredClone(edit.value)
  }
  return record
}

// ---------- Required fields ----------

const REQUIRED_MESSAGES: Readonly<Record<string, string>> = {
  company: 'Enter the company',
  role: 'Enter the role',
  dateApplied: 'Enter the date you applied',
  status: 'Choose a status',
}

/**
 * Required fields left empty, by field key, with what to do about each. A form rule:
 * stored and imported records may lack these and stay valid.
 */
export function missingRequired(
  fields: readonly FieldSpec[],
  valueOf: (field: FieldSpec) => FieldValue,
): Record<string, string> {
  const missing: Record<string, string> = {}
  for (const field of fields) {
    if (!field.required || field.readOnly) continue
    const value = valueOf(field)
    if (value === null || (typeof value === 'string' && value.trim() === '')) {
      missing[field.key] = REQUIRED_MESSAGES[field.key] ?? `Fill in ${field.label}`
    }
  }
  return missing
}

// ---------- Errors ----------

export interface FormErrors {
  byField: Record<string, string> // field key (or custom field ID) -> message
  general: string[]
}

const LABELS = new Map<string, string>(APPLICATION_FIELDS.map((f) => [f.key, f.label]))

/**
 * Turns Repo validation errors ('applications.listing: expected a web link') into
 * messages beside the right inputs. Anything that doesn't name a form field is general.
 */
export function formErrors(errors: readonly string[], customLabels: ReadonlyMap<string, string>) {
  const result: FormErrors = { byField: {}, general: [] }
  for (const error of errors) {
    const match = /^applications\.(custom\.)?([^.[:]+)[^:]*: (.*)$/.exec(error)
    const key = match?.[2]
    const label = key && (match[1] ? customLabels.get(key) : LABELS.get(key))
    if (!match || !key || !label) {
      result.general.push(error)
      continue
    }
    result.byField[key] ??= `${label}: ${match[3]}`
  }
  return result
}
