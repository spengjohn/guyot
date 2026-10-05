import { useId } from 'react'
import type { FieldValue as Value } from '../data/types/fields'
import type { LiveRecord } from '../data/types/record'
import type { SearchProfileData } from '../data/types/tables'
import type { FieldSpec } from '../fields/columns'
import { FieldValue } from '../fields/FieldValue'
import { isEmptyValue, savedValue } from '../forms/editModel'
import { formatMoment } from '../ui/dates'
import { describeProfile } from './targetsForm'

type Profile = LiveRecord<SearchProfileData>

interface Props {
  profile: Profile
  /** The profile's fields; Name is the card's heading and Active is a tag, not rows. */
  fields: readonly FieldSpec[]
  editButtonId: string
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}

/** Nothing worth a row: empty, or an empty list. */
const isBlank = (value: Value | undefined) =>
  value === undefined || isEmptyValue(value) || (Array.isArray(value) && value.length === 0)

/**
 * One search profile as a card. Only fields with a value are shown, so a card stays
 * short and fits a narrow screen; the full record is in the Edit dialog.
 */
export function ProfileCard({
  profile,
  fields,
  editButtonId,
  onEdit,
  onDuplicate,
  onDelete,
}: Props) {
  const headingId = useId()
  const name = describeProfile(profile)
  const rows = fields
    .filter((f) => f.key !== 'name' && f.key !== 'active')
    .map((field) => ({ field, value: savedValue(profile, field) as Value | undefined })) // profile fields hold field values
    .filter(({ value }) => !isBlank(value))
  const overrides =
    Object.keys(profile.overrides).length + Object.keys(profile.customOverrides).length

  return (
    <article className="card" aria-labelledby={headingId}>
      <header className="card-header">
        <h3 id={headingId}>{name}</h3>
        {!profile.active && <span className="tag muted-tag">Inactive</span>}
      </header>
      {rows.length > 0 && (
        <dl className="card-fields">
          {rows.map(({ field, value }) => (
            <div key={field.key}>
              <dt>{field.label}</dt>
              <dd>
                <FieldValue field={field} value={value} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {overrides > 0 && (
        <p className="hint">
          Overrides {overrides} shared {overrides === 1 ? 'target' : 'targets'}.
        </p>
      )}
      <p className="hint">Last updated {formatMoment(profile.updatedAt)}</p>
      <div className="card-actions">
        <button type="button" id={editButtonId} aria-label={`Edit ${name}`} onClick={onEdit}>
          Edit
        </button>
        <button type="button" aria-label={`Duplicate ${name}`} onClick={onDuplicate}>
          Duplicate
        </button>
        <button type="button" aria-label={`Delete ${name}`} onClick={onDelete}>
          Delete
        </button>
      </div>
    </article>
  )
}
