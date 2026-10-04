import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useAnnounce } from '../app/announce'
import { useRepoWrite } from '../app/repoContext'
import { jsonEqual } from '../data/merge'
import { StaleEditError, ValidationError } from '../data/repo'
import type { FieldValue as Value } from '../data/types/fields'
import type { LiveRecord } from '../data/types/record'
import type { ApplicationData } from '../data/types/tables'
import type { FieldSpec } from '../fields/columns'
import { FieldControl } from '../fields/FieldControl'
import { FieldValue } from '../fields/FieldValue'
import { todayLocal } from '../ui/dates'
import {
  controlKey,
  fieldState,
  formErrors,
  keepMine,
  missingRequired,
  newApplication,
  newDraft,
  savedValue,
  saveRequest,
  takeSaved,
  withEdit,
  type Edits,
  type FieldState,
  type FormErrors,
  type SavedApplication,
} from './applicationForm'
import { describeApplication } from './describe'

type Application = LiveRecord<ApplicationData>

interface Props {
  /** The application as it was when the form opened, or null to add a new one. */
  opened: Application | null
  /**
   * The application as saved now. It updates while the form is open when another tab
   * (or an import) saves it; null once it's deleted elsewhere.
   */
  latest: Application | null
  /** The fields the form shows: editable built-ins, then custom fields. */
  fields: readonly FieldSpec[]
  onClose: () => void
}

const NO_ERRORS: FormErrors = { byField: {}, general: [] }

/** Shown once the user keeps their own version of a field that was saved elsewhere. */
const OVERWRITE_WARNING =
  'Changes occurred while you were editing. Caution when saving as your edits were kept and placed over the fresh data.'

const isEmptyValue = (value: Value) =>
  value === null || (typeof value === 'string' && value.trim() === '')

/** A copy of `map` without `key`. */
function without(map: Record<string, string>, key: string): Record<string, string> {
  const copy = { ...map }
  delete copy[key]
  return copy
}

/**
 * Add or edit one application, in a modal dialog. The browser's showModal() keeps
 * focus inside, makes the page behind it inert, and closes it on Esc.
 *
 * While it's open, saves made elsewhere show up: untouched fields take the new value,
 * and a field the user also edited becomes a conflict to compare and resolve before
 * saving. The save itself is refused if anything changed since (docs/decisions/0014).
 */
export function ApplicationDialog({ opened, latest, fields, onClose }: Props) {
  const write = useRepoWrite()
  const announce = useAnnounce()
  const titleId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const summaryRef = useRef<HTMLDivElement>(null)
  const conflictsRef = useRef<HTMLElement>(null)
  // The element that opened the dialog, to return focus to it afterwards.
  const [opener] = useState(() => document.activeElement)
  const [defaults] = useState(() => newDraft(todayLocal()))
  const [edits, setEdits] = useState<Edits>({})
  const [problems, setProblems] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState(NO_ERRORS)
  const [lastUpdateEdited, setLastUpdateEdited] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState({ text: '', count: 0 })
  // Fields where the user chose "Keep mine": saving will put their edit over a newer save.
  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set())
  // Optional fields start shown when editing a record that already has values in them.
  const [showOptional, setShowOptional] = useState(
    () =>
      opened !== null &&
      fields.some((f) => !f.required && !f.readOnly && !isEmptyValue(savedValue(opened, f))),
  )
  const showErrors = useRef(false) // set when new errors should take focus
  const pendingFocus = useRef<string | null>(null) // an element id, or 'conflicts'

  const isNew = opened === null
  const openedRecord: SavedApplication = opened ?? defaults
  const current: SavedApplication | null = isNew ? null : latest
  const deletedElsewhere = !isNew && latest === null
  const source = current ?? openedRecord

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

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

  const saveButtonId = `${titleId}-save`
  const keepButtonId = (field: FieldSpec) => `${titleId}-keep-${field.key}`
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
  const customLabels = new Map(fields.filter((f) => f.custom).map((f) => [f.key, f.label]))
  const lastUpdate = fields.find((f) => f.key === 'lastUpdate')
  const requiredFields = fields.filter((f) => f.required)
  const optionalFields = fields.filter((f) => !f.required)
  // A hidden field that needs attention keeps the optional section open.
  const optionalNeedsAttention = optionalFields.some(
    (f) => errors.byField[f.key] || stateOf(f).conflict || overwrites.includes(f),
  )
  const optionalOpen = showOptional || optionalNeedsAttention

  const clearFieldErrors = (field: FieldSpec) => {
    setProblems((p) => without(p, field.key))
    setErrors((e) => ({ ...e, byField: without(e.byField, field.key) }))
  }

  const setValue = (field: FieldSpec, value: Value, problem?: string) => {
    clearFieldErrors(field)
    if (problem) setProblems((p) => ({ ...p, [field.key]: problem }))
    if (field.key === 'lastUpdate') setLastUpdateEdited(true)
    setEdits((e) => {
      let next = withEdit(e, field, value, source)
      // Changing Status usually means something happened today, so Last Update follows,
      // unless the user set Last Update themselves in this form.
      if (field.key === 'status' && lastUpdate && !lastUpdateEdited) {
        next = withEdit(next, lastUpdate, todayLocal(), source)
      }
      return next
    })
    if (field.key === 'status' && lastUpdate && !lastUpdateEdited && !optionalOpen) {
      say('Last Update was set to today, under More details.')
    }
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

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return // already saving; a second click must not save twice
    if (conflicts.length > 0) {
      say('Choose which version to keep for each field that changed elsewhere, then save.')
      conflictsRef.current?.focus()
      return
    }
    if (deletedElsewhere) {
      fail({
        byField: {},
        general: ['This application was deleted elsewhere, so it can’t be saved.'],
      })
      return
    }
    const label = (key: string) => fields.find((f) => f.key === key)?.label ?? key
    const byField: Record<string, string> = {
      ...missingRequired(fields, (f) => stateOf(f).value),
      ...Object.fromEntries(
        Object.entries(problems).map(([key, text]) => [key, `${label(key)}: ${text}`]),
      ),
    }
    if (Object.keys(byField).length > 0) {
      fail({ byField, general: [] })
      return
    }
    setSaving(true)
    try {
      const saved = await write(async (repo) => {
        if (!opened) {
          const data = newApplication(fields, edits, defaults)
          return repo.create('applications', data, { assignRoleId: true }) // assigns the Role ID
        }
        const stored = await repo.get('applications', opened.id)
        if (!stored || stored.purged || stored.deleted) {
          throw new Error('This application was deleted elsewhere, so it can’t be saved.')
        }
        const { changes, expected } = saveRequest(fields, edits, stored)
        if (Object.keys(changes).length === 0) return stored
        return repo.update('applications', opened.id, changes, { expected })
      })
      announce(`Saved ${describeApplication(saved)}.`)
      dialogRef.current?.close()
    } catch (error) {
      if (error instanceof StaleEditError) {
        // The write's reload brings in the newer save; its conflicts then take focus.
        pendingFocus.current = 'conflicts'
        say('Not saved: this application was just changed elsewhere. Review the changes below.')
      } else if (error instanceof ValidationError) {
        fail(formErrors(error.errors, customLabels))
      } else {
        fail({ byField: {}, general: [error instanceof Error ? error.message : String(error)] })
      }
    } finally {
      setSaving(false)
    }
  }

  // Fires for Save, Cancel and Esc alike.
  const handleClose = () => {
    onClose()
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
  }

  const toggleOptional = () => {
    if (optionalOpen && optionalNeedsAttention) {
      say('More details stays open while a field there needs attention.')
      return
    }
    setShowOptional(!optionalOpen)
  }

  const renderField = (field: FieldSpec) => (
    <FieldControl
      key={controlKey(field, edits, source)}
      field={field}
      value={stateOf(field).value}
      onChange={(value, problem) => setValue(field, value, problem)}
      error={
        errors.byField[field.key] ??
        (stateOf(field).conflict
          ? `${field.label}: changed elsewhere while you were editing. Choose a version above.`
          : undefined)
      }
      hint={overwrites.includes(field) ? 'Saving replaces the version saved elsewhere.' : undefined}
    />
  )

  const allErrors = [...errors.general, ...Object.values(errors.byField)]
  const title = opened ? `Edit ${describeApplication(opened)}` : 'Add application'
  const names = (list: FieldSpec[]) => list.map((f) => f.label).join(', ')

  return (
    <dialog ref={dialogRef} aria-labelledby={titleId} onClose={handleClose} className="dialog">
      <form onSubmit={save} noValidate>
        <h2 id={titleId}>{title}</h2>
        {opened && <p className="hint">Role ID {opened.roleId}</p>}
        <p className="hint">Fields marked (required) must be filled in.</p>

        {/* Live regions inside the dialog: while it's open, the rest of the page (and
            the app's own live region) is inert, so screen readers would ignore it. */}
        <div
          role="status"
          className={
            deletedElsewhere || changedElsewhere.length || overwrites.length ? 'notice' : ''
          }
        >
          {overwrites.length > 0 && (
            <p>
              <strong>
                {OVERWRITE_WARNING} Fields: {names(overwrites)}.
              </strong>
            </p>
          )}
          {deletedElsewhere ? (
            <p>
              This application was deleted in another tab or on another device. To keep these
              changes, restore it from Recently deleted; otherwise, cancel.
            </p>
          ) : changedElsewhere.length > 0 ? (
            <p>
              Saved elsewhere since you opened this form: {names(changedElsewhere)}.{' '}
              {conflicts.length > 0
                ? `${conflicts.length === 1 ? 'One conflicts' : `${conflicts.length} conflict`} with your edits: compare and choose below.`
                : 'The form shows the new values; your own edits are kept.'}
            </p>
          ) : null}
        </div>
        <div role="status" className="visually-hidden">
          <span key={message.count}>{message.text}</span>
        </div>

        {conflicts.length > 0 && (
          <section
            ref={conflictsRef}
            tabIndex={-1}
            className="conflicts"
            aria-labelledby={`${titleId}-conflicts`}
          >
            <h3 id={`${titleId}-conflicts`}>Changed elsewhere while you were editing</h3>
            <p>
              Compare each version, then choose which one to keep. Keep yours, and saving replaces
              the version saved elsewhere; use the saved one, and your edit is dropped. Nothing is
              saved until you press Save.
            </p>
            {conflicts.map((field) => {
              const conflict = stateOf(field).conflict!
              const headingId = `${titleId}-conflict-${field.key}`
              return (
                <div key={field.key} role="group" aria-labelledby={headingId} className="conflict">
                  <h4 id={headingId}>{field.label}: two versions</h4>
                  <dl className="compare">
                    <div>
                      <dt>Your edit</dt>
                      <dd>
                        <CompareValue field={field} value={conflict.yours} />
                      </dd>
                    </div>
                    <div>
                      <dt>Saved elsewhere</dt>
                      <dd>
                        <CompareValue field={field} value={conflict.saved} />
                      </dd>
                    </div>
                  </dl>
                  <div className="actions">
                    <button
                      type="button"
                      id={keepButtonId(field)}
                      onClick={() => resolve(field, 'mine')}
                    >
                      Keep my {field.label}
                    </button>
                    <button type="button" onClick={() => resolve(field, 'saved')}>
                      Use saved {field.label}
                    </button>
                  </div>
                </div>
              )
            })}
          </section>
        )}

        {allErrors.length > 0 && (
          <div
            ref={summaryRef}
            role="group"
            tabIndex={-1}
            className="error-summary"
            aria-labelledby={`${titleId}-errors`}
          >
            <h3 id={`${titleId}-errors`}>
              Fix {allErrors.length === 1 ? 'this' : 'these'} to save
            </h3>
            <ul>
              {allErrors.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </div>
        )}

        {requiredFields.map(renderField)}

        {optionalFields.length > 0 && (
          <>
            <button
              type="button"
              className="disclosure"
              aria-expanded={optionalOpen}
              aria-controls={`${titleId}-optional`}
              onClick={toggleOptional}
            >
              More details (optional)
            </button>
            <div id={`${titleId}-optional`} className="optional-fields">
              {optionalOpen && optionalFields.map(renderField)}
            </div>
          </>
        )}

        <div className="actions">
          <button type="submit" id={saveButtonId} className="primary">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => dialogRef.current?.close()}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  )
}

/** A value in the comparison: in full, with empty shown as such. */
function CompareValue({ field, value }: { field: FieldSpec; value: Value }) {
  const empty = value === null || value === ''
  return empty ? <em>(empty)</em> : <FieldValue field={field} value={value} full />
}
