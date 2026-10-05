import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAnnounce } from '../app/announce'
import { useRepoWrite } from '../app/repoContext'
import type { LiveRecord } from '../data/types/record'
import type { ApplicationData } from '../data/types/tables'
import type { FieldSpec } from '../fields/columns'
import { FieldControl } from '../fields/FieldControl'
import { isEmptyValue, newRecordData, saveRequest, savedValue } from '../forms/editModel'
import { ChangesNotice, ConflictList, ErrorSummary } from '../forms/FormParts'
import { useEditForm } from '../forms/useEditForm'
import { todayLocal } from '../ui/dates'
import { APPLICATION_REQUIRED_MESSAGES, newDraft, type SavedApplication } from './applicationForm'
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
  const dialogRef = useRef<HTMLDialogElement>(null)
  // The element that opened the dialog, to return focus to it afterwards.
  const [opener] = useState(() => document.activeElement)
  const [defaults] = useState(() => newDraft(todayLocal()))
  const form = useEditForm<SavedApplication>({
    table: 'applications',
    recordName: 'application',
    fields,
    opened,
    latest,
    defaults,
    requiredMessages: APPLICATION_REQUIRED_MESSAGES,
  })
  const [lastUpdateEdited, setLastUpdateEdited] = useState(false)
  // Optional fields start shown when editing a record that already has values in them.
  const [showOptional, setShowOptional] = useState(
    () =>
      opened !== null &&
      fields.some((f) => !f.required && !f.readOnly && !isEmptyValue(savedValue(opened, f))),
  )

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  const lastUpdate = fields.find((f) => f.key === 'lastUpdate')
  const requiredFields = fields.filter((f) => f.required)
  const optionalFields = fields.filter((f) => !f.required)
  // A hidden field that needs attention keeps the optional section open.
  const optionalNeedsAttention = optionalFields.some(form.needsAttention)
  const optionalOpen = showOptional || optionalNeedsAttention

  /** Like form.setValue, plus: changing Status usually means something happened today. */
  const onFieldChange =
    (field: FieldSpec) => (value: Parameters<typeof form.setValue>[1], problem?: string) => {
      form.setValue(field, value, problem)
      if (field.key === 'lastUpdate') setLastUpdateEdited(true)
      if (field.key === 'status' && lastUpdate && !lastUpdateEdited) {
        form.setValue(lastUpdate, todayLocal()) // unless the user set Last Update themselves
        if (!optionalOpen) form.say('Last Update was set to today, under More details.')
      }
    }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    let saved: ApplicationData | undefined
    const ok = await form.submit(async () => {
      saved = await write(async (repo) => {
        if (!opened) {
          const data = newRecordData(fields, form.edits, defaults) as unknown as ApplicationData
          return repo.create('applications', data, { assignRoleId: true }) // assigns the Role ID
        }
        const stored = await repo.get('applications', opened.id)
        if (!stored || stored.purged || stored.deleted) {
          throw new Error('This application was deleted elsewhere, so it can’t be saved.')
        }
        const { changes, expected } = saveRequest(fields, form.edits, stored)
        if (Object.keys(changes).length === 0) return stored
        return repo.update('applications', opened.id, changes as Partial<ApplicationData>, {
          expected,
        })
      })
    })
    if (ok && saved) {
      announce(`Saved ${describeApplication(saved)}.`)
      dialogRef.current?.close()
    }
  }

  // Fires for Save, Cancel and Esc alike.
  const handleClose = () => {
    onClose()
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
  }

  const toggleOptional = () => {
    if (optionalOpen && optionalNeedsAttention) {
      form.say('More details stays open while a field there needs attention.')
      return
    }
    setShowOptional(!optionalOpen)
  }

  const renderField = (field: FieldSpec) => (
    <FieldControl
      key={form.keyOf(field)}
      {...form.fieldProps(field)}
      onChange={onFieldChange(field)}
    />
  )

  const titleId = `${form.id}-title`
  const title = opened ? `Edit ${describeApplication(opened)}` : 'Add application'

  return (
    <dialog ref={dialogRef} aria-labelledby={titleId} onClose={handleClose} className="dialog">
      <form onSubmit={save} noValidate>
        <h2 id={titleId}>{title}</h2>
        {opened && <p className="hint">Role ID {opened.roleId}</p>}
        <p className="hint">Fields marked (required) must be filled in.</p>

        <ChangesNotice
          form={form}
          deletedText="This application was deleted in another tab or on another device. To keep these changes, restore it from Recently deleted; otherwise, cancel."
        />
        <ConflictList form={form} />
        <ErrorSummary form={form} />

        {requiredFields.map(renderField)}

        {optionalFields.length > 0 && (
          <>
            <button
              type="button"
              className="disclosure"
              aria-expanded={optionalOpen}
              aria-controls={`${form.id}-optional`}
              onClick={toggleOptional}
            >
              More details (optional)
            </button>
            <div id={`${form.id}-optional`} className="optional-fields">
              {optionalOpen && optionalFields.map(renderField)}
            </div>
          </>
        )}

        <div className="actions">
          <button type="submit" id={form.saveButtonId} className="primary">
            {form.saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => dialogRef.current?.close()}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  )
}
