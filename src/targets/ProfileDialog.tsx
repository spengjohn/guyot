import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAnnounce } from '../app/announce'
import { useRepoWrite } from '../app/repoContext'
import type { LiveRecord } from '../data/types/record'
import type { SearchProfileData, SharedTargetsData } from '../data/types/tables'
import type { FieldSpec } from '../fields/columns'
import { FieldControl } from '../fields/FieldControl'
import { newRecordData, saveRequest } from '../forms/editModel'
import { ChangesNotice, ConflictList, ErrorSummary } from '../forms/FormParts'
import { useEditForm } from '../forms/useEditForm'
import { OverrideControl } from './OverrideControl'
import {
  describeProfile,
  PROFILE_REQUIRED_MESSAGES,
  sharedFieldOf,
  type SavedProfile,
} from './targetsForm'

type Profile = LiveRecord<SearchProfileData>

interface Props {
  /** The profile as it was when the form opened, or null to add one (or a duplicate). */
  opened: Profile | null
  /** The profile as saved now; null once deleted elsewhere. */
  latest: Profile | null
  /** What a new profile starts as: empty, or a copy of the one being duplicated. */
  defaults: SavedProfile
  /** The profile's own fields. */
  fields: readonly FieldSpec[]
  /** One override field per shared field. */
  overrides: readonly FieldSpec[]
  /** The shared fields, and the shared targets as saved now. */
  sharedFields: readonly FieldSpec[]
  shared: SharedTargetsData
  onClose: () => void
}

/** Add, duplicate or edit one search profile, with its overrides of the shared targets. */
export function ProfileDialog(props: Props) {
  const { opened, latest, defaults, fields, overrides, sharedFields, shared, onClose } = props
  const write = useRepoWrite()
  const announce = useAnnounce()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [opener] = useState(() => document.activeElement)
  const allFields = [...fields, ...overrides]
  const form = useEditForm<SavedProfile>({
    table: 'searchProfiles',
    recordName: 'profile',
    fields: allFields,
    opened,
    latest,
    defaults,
    requiredMessages: PROFILE_REQUIRED_MESSAGES,
  })
  // The overrides section starts open when the profile already overrides something.
  const [showOverrides, setShowOverrides] = useState(() => {
    const start = opened ?? defaults
    return Object.keys(start.overrides).length + Object.keys(start.customOverrides).length > 0
  })

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  const overridesNeedAttention = overrides.some(form.needsAttention)
  const overridesOpen = showOverrides || overridesNeedAttention

  const save = async (event: FormEvent) => {
    event.preventDefault()
    let saved: SearchProfileData | undefined
    const ok = await form.submit(async () => {
      saved = await write(async (repo) => {
        if (!opened) {
          const data = newRecordData(allFields, form.edits, defaults)
          return repo.create('searchProfiles', data as unknown as SearchProfileData)
        }
        const stored = await repo.get('searchProfiles', opened.id)
        if (!stored || stored.purged || stored.deleted) {
          throw new Error('This profile was deleted elsewhere, so it can’t be saved.')
        }
        const { changes, expected } = saveRequest(allFields, form.edits, stored)
        if (Object.keys(changes).length === 0) return stored
        return repo.update('searchProfiles', opened.id, changes as Partial<SearchProfileData>, {
          expected,
        })
      })
    })
    if (ok && saved) {
      announce(`Saved profile ${describeProfile(saved)}.`)
      dialogRef.current?.close()
    }
  }

  const handleClose = () => {
    onClose()
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
  }

  const toggleOverrides = () => {
    if (overridesOpen && overridesNeedAttention) {
      form.say('Overrides stay open while one of them needs attention.')
      return
    }
    setShowOverrides(!overridesOpen)
  }

  const titleId = `${form.id}-title`
  const title = opened
    ? `Edit profile ${describeProfile(opened)}`
    : defaults.name
      ? 'Duplicate profile'
      : 'Add profile'

  return (
    <dialog ref={dialogRef} aria-labelledby={titleId} onClose={handleClose} className="dialog">
      <form onSubmit={save} noValidate>
        <h2 id={titleId}>{title}</h2>
        <p className="hint">Fields marked (required) must be filled in.</p>

        <ChangesNotice
          form={form}
          deletedText="This profile was deleted in another tab or on another device. To keep these changes, restore it from Recently deleted profiles; otherwise, cancel."
        />
        <ConflictList form={form} />
        <ErrorSummary form={form} />

        {fields.map((field) => (
          <FieldControl key={form.keyOf(field)} {...form.fieldProps(field)} />
        ))}

        <button
          type="button"
          className="disclosure"
          aria-expanded={overridesOpen}
          aria-controls={`${form.id}-overrides`}
          onClick={toggleOverrides}
        >
          Override shared targets for this profile
        </button>
        <div id={`${form.id}-overrides`}>
          {overridesOpen && (
            <>
              <p className="hint">
                Each shared target applies to this profile unless you override it here.
              </p>
              {overrides.map((field) => {
                const { error, hint, onChange } = form.fieldProps(field)
                return (
                  <OverrideControl
                    key={form.keyOf(field)}
                    field={field}
                    sharedField={sharedFieldOf(field, sharedFields)}
                    shared={shared}
                    value={form.stateOf(field).value}
                    onChange={onChange}
                    error={error}
                    hint={hint}
                  />
                )
              })}
            </>
          )}
        </div>

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
