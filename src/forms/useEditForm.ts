import { useEffect, useId, useRef, useState } from 'react'
import { jsonEqual } from '../data/merge'
import { StaleEditError, ValidationError } from '../data/repo'
import type { FieldValue } from '../data/types/fields'
import type { FieldSpec } from '../fields/columns'
import {
  controlKey,
  fieldState,
  formErrors,
  keepMine,
  missingRequired,
  savedValue,
  takeSaved,
  withEdit,
  type EditValue,
  type Edits,
  type FieldState,
  type FormErrors,
  type SavedRecord,
} from './editModel'

/** Shown once the user keeps their own version of a field that was saved elsewhere. */
export const OVERWRITE_WARNING =
  'Changes occurred while you were editing. Caution when saving as your edits were kept and placed over the fresh data.'

const NO_ERRORS: FormErrors = { byField: {}, general: [] }

/** A copy of `map` without `key`. */
function without(map: Record<string, string>, key: string): Record<string, string> {
  const copy = { ...map }
  delete copy[key]
  return copy
}

export interface EditFormOptions<R extends SavedRecord> {
  /** The table, to match validation errors to fields ('applications'). */
  table: string
  /** What the record is called in messages ('application', 'profile'). */
  recordName: string
  fields: readonly FieldSpec[]
  /** The record as it was when the form opened, or null when adding a new one. */
  opened: R | null
  /** The record as saved now (updates while the form is open); null once deleted elsewhere. */
  latest: R | null
  /** What a new record starts as. Only used when `opened` is null. */
  defaults: R
  /** Messages for required fields left empty, by field key. */
  requiredMessages?: Readonly<Record<string, string>>
}

/**
 * The state and save flow every edit form shares (docs/decisions/0014): the user's
 * edits over the latest saved record, conflicts with saves made elsewhere, required
 * fields, half-typed values, and errors from Repo, with focus moved to whatever needs
 * attention. The form supplies the layout and the actual write.
 *
 * `R` is the record type: a generic parameter, so the same hook works for any table.
 */
export function useEditForm<R extends SavedRecord>(options: EditFormOptions<R>) {
  const { table, recordName, fields, opened, latest, defaults, requiredMessages } = options
  const id = useId()
  const summaryRef = useRef<HTMLDivElement>(null)
  const conflictsRef = useRef<HTMLElement>(null)
  const [edits, setEdits] = useState<Edits>({})
  const [problems, setProblems] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState(NO_ERRORS)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState({ text: '', count: 0 })
  // Fields where the user chose "Keep mine": saving will put their edit over a newer save.
  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set())
  const showErrors = useRef(false) // set when new errors should take focus
  const pendingFocus = useRef<string | null>(null) // an element id, or 'conflicts'

  const isNew = opened === null
  const openedRecord: SavedRecord = opened ?? defaults
  const current: SavedRecord | null = isNew ? null : latest
  const deletedElsewhere = !isNew && latest === null
  const source = current ?? openedRecord

  useEffect(() => {
    if (!showErrors.current) return
    showErrors.current = false
    summaryRef.current?.focus()
  }, [errors])

  // After resolving a conflict, or when conflicts appear after a refused save.
  useEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    const element = target === 'conflicts' ? conflictsRef.current : document.getElementById(target)
    if (element) {
      element.focus()
      pendingFocus.current = null
    }
  }, [edits, latest])

  const saveButtonId = `${id}-save`
  const keepButtonId = (field: FieldSpec) => `${id}-keep-${field.key}`
  const say = (text: string) => setMessage((m) => ({ text, count: m.count + 1 }))

  const states = new Map<string, FieldState>(
    fields.map((f) => [f.key, fieldState(f, edits, current, openedRecord)]),
  )
  const stateOf = (field: FieldSpec) => states.get(field.key)!
  const conflicts = fields.filter((f) => stateOf(f).conflict)
  const changedElsewhere = fields.filter((f) => stateOf(f).changedSinceOpened)
  const overwrites = fields.filter((f) => {
    const state = stateOf(f)
    return (
      kept.has(f.key) &&
      state.edited &&
      !state.conflict &&
      current !== null &&
      !jsonEqual(state.value, savedValue(current, f))
    )
  })

  /** Whether a field needs the user's attention (so a collapsed section should open). */
  const needsAttention = (field: FieldSpec) =>
    Boolean(errors.byField[field.key] || stateOf(field).conflict || overwrites.includes(field))

  const clearFieldErrors = (field: FieldSpec) => {
    setProblems((p) => without(p, field.key))
    setErrors((e) => ({ ...e, byField: without(e.byField, field.key) }))
  }

  /** Records a change from an input; `problem` marks a half-entered value. */
  const setValue = (field: FieldSpec, value: EditValue, problem?: string) => {
    clearFieldErrors(field)
    if (problem) setProblems((p) => ({ ...p, [field.key]: problem }))
    setEdits((e) => withEdit(e, field, value, source))
  }

  const resolve = (field: FieldSpec, choice: 'mine' | 'saved') => {
    if (!current) return
    clearFieldErrors(field)
    setEdits((e) => (choice === 'mine' ? keepMine(e, field, current) : takeSaved(e, field)))
    setKept((k) => {
      const next = new Set(k)
      if (choice === 'mine') next.add(field.key)
      else next.delete(field.key)
      return next
    })
    say(
      choice === 'mine'
        ? `Keeping your ${field.label}. ${OVERWRITE_WARNING} Fields: ${field.label}.`
        : `Using the saved ${field.label}.`,
    )
    const next = conflicts.find((f) => f.key !== field.key)
    pendingFocus.current = next ? keepButtonId(next) : saveButtonId
  }

  const fail = (next: FormErrors) => {
    showErrors.current = true
    setErrors(next)
  }

  /**
   * Checks the form, then runs `persist` (the actual write). Returns true if it saved.
   * Errors from the write are shown in the form; `persist` should let them throw.
   */
  const submit = async (persist: () => Promise<void>): Promise<boolean> => {
    if (saving) return false // already saving; a second click must not save twice
    if (conflicts.length > 0) {
      say('Choose which version to keep for each field that changed elsewhere, then save.')
      conflictsRef.current?.focus()
      return false
    }
    if (deletedElsewhere) {
      fail({
        byField: {},
        general: [`This ${recordName} was deleted elsewhere, so it can’t be saved.`],
      })
      return false
    }
    const label = (key: string) => fields.find((f) => f.key === key)?.label ?? key
    const byField: Record<string, string> = {
      ...missingRequired(fields, (f) => stateOf(f).value, requiredMessages),
      ...Object.fromEntries(
        Object.entries(problems).map(([key, text]) => [key, `${label(key)}: ${text}`]),
      ),
    }
    if (Object.keys(byField).length > 0) {
      fail({ byField, general: [] })
      return false
    }
    setSaving(true)
    try {
      await persist()
      setErrors(NO_ERRORS)
      return true
    } catch (error) {
      if (error instanceof StaleEditError) {
        // The write's reload brings in the newer save; its conflicts then take focus.
        pendingFocus.current = 'conflicts'
        say(`Not saved: this ${recordName} was just changed elsewhere. Review the changes below.`)
      } else if (error instanceof ValidationError) {
        fail(formErrors(table, error.errors, fields))
      } else {
        fail({ byField: {}, general: [error instanceof Error ? error.message : String(error)] })
      }
      return false
    } finally {
      setSaving(false)
    }
  }

  /** Props for one field's FieldControl (spread them, and give it `key={keyOf(field)}`). */
  const fieldProps = (field: FieldSpec) => ({
    field,
    // Ordinary fields hold field values; only override controls see ListOverride or undefined.
    value: (stateOf(field).value ?? null) as FieldValue,
    onChange: (value: EditValue, problem?: string) => setValue(field, value, problem),
    error:
      errors.byField[field.key] ??
      (stateOf(field).conflict
        ? `${field.label}: changed elsewhere while you were editing. Choose a version above.`
        : undefined),
    hint: overwrites.includes(field) ? 'Saving replaces the version saved elsewhere.' : undefined,
  })

  /** Forgets all edits, after a save that leaves the form open (inline forms). */
  const reset = () => {
    setEdits({})
    setKept(new Set())
  }

  return {
    id,
    isNew,
    current,
    source,
    deletedElsewhere,
    edits,
    errors,
    saving,
    message,
    say,
    stateOf,
    conflicts,
    changedElsewhere,
    overwrites,
    needsAttention,
    setValue,
    resolve,
    submit,
    reset,
    fieldProps,
    keyOf: (field: FieldSpec) => controlKey(field, edits, source),
    summaryRef,
    conflictsRef,
    saveButtonId,
    keepButtonId,
  }
}

/** Everything useEditForm returns, for components that render parts of a form. */
export type EditForm = ReturnType<typeof useEditForm>
