import { useId, useState } from 'react'
import { getValue } from '../data/merge'
import { effectiveTargets } from '../data/targets'
import type { FieldValue as Value } from '../data/types/fields'
import type { ListMode, ListOverride, SharedTargetsData } from '../data/types/tables'
import type { FieldSpec } from '../fields/columns'
import { FieldControl } from '../fields/FieldControl'
import { FieldValue } from '../fields/FieldValue'
import { ListEditor } from '../fields/ListEditor'
import type { EditValue } from '../forms/editModel'

interface Props {
  /** The override field ('overrides.roleTypes' or 'customOverrides.<id>'). */
  field: FieldSpec
  /** The shared field it overrides. */
  sharedField: FieldSpec
  /** The shared targets as saved now, to show what the profile inherits. */
  shared: SharedTargetsData
  /** The override: undefined means "use the shared value". */
  value: EditValue
  onChange: (value: EditValue, problem?: string) => void
  error?: string
  hint?: string
}

/**
 * How one profile treats one shared target: use it as is, or override it. Lists can be
 * added to or replaced; other fields are replaced. Mode and items are always one value
 * (docs/decisions/0012).
 */
export function OverrideControl(props: Props) {
  if (props.sharedField.type === 'textList' && !props.sharedField.custom) {
    return <ListOverrideControl {...props} />
  }
  return <ValueOverrideControl {...props} />
}

const MODES: { mode: ListMode | 'shared'; label: string }[] = [
  { mode: 'shared', label: 'Use shared' },
  { mode: 'add', label: 'Add to shared' },
  { mode: 'replace', label: 'Replace shared' },
]

function sharedValueOf(props: Props): unknown {
  const key = props.sharedField.custom ? `custom.${props.sharedField.key}` : props.sharedField.key
  return getValue(props.shared, key)
}

function describedBy(id: string, error?: string, hint?: string) {
  const ids = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ')
  return ids ? { 'aria-describedby': ids } : {}
}

function Help({ id, error, hint }: { id: string; error?: string; hint?: string }) {
  return (
    <>
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </>
  )
}

const listText = (items: readonly string[]) =>
  items.length > 0 ? items.join(', ') : '(nothing yet)'

function ListOverrideControl(props: Props) {
  const { sharedField, shared, onChange, error, hint } = props
  const id = useId()
  const override = props.value as ListOverride | undefined
  // Remembered across mode changes, so switching Add <-> Replace keeps the items.
  const [items, setItems] = useState<string[]>(() => [...(override?.items ?? [])])
  const mode: ListMode | 'shared' = override?.mode ?? 'shared'
  const sharedItems = (sharedValueOf(props) as string[] | undefined) ?? []

  const setMode = (next: ListMode | 'shared') => {
    onChange(next === 'shared' ? undefined : { mode: next, items })
  }
  const changeItems = (next: string[], problem?: string) => {
    setItems(next)
    if (override) onChange({ mode: override.mode, items: next }, problem)
  }
  const effective = effectiveTargets(shared, {
    overrides: override ? { [sharedField.key]: override } : {},
    customOverrides: {},
  })[sharedField.key as keyof SharedTargetsData] as string[]

  return (
    <fieldset className="field-group override" {...describedBy(id, error, hint)}>
      <legend>{sharedField.label}</legend>
      <p className="hint">Shared: {listText(sharedItems)}</p>
      <div className="radio-row">
        {MODES.map(({ mode: option, label }) => (
          <div key={option} className="check">
            <input
              type="radio"
              id={`${id}-${option}`}
              name={`${id}-mode`}
              checked={mode === option}
              onChange={() => setMode(option)}
            />
            <label htmlFor={`${id}-${option}`}>{label}</label>
          </div>
        ))}
      </div>
      {mode !== 'shared' && (
        <ListEditor
          label={`${sharedField.label} for this profile`}
          items={items}
          onChange={changeItems}
        />
      )}
      <p className="effective">
        This profile will use: <strong>{listText(effective)}</strong>
      </p>
      <Help id={id} error={error} hint={hint} />
    </fieldset>
  )
}

/** Text and custom fields: a checkbox to override, then the field's own input. */
function ValueOverrideControl(props: Props) {
  const { sharedField, onChange, error, hint } = props
  const id = useId()
  const overriding = props.value !== undefined
  const sharedValue = sharedValueOf(props) as Value | undefined
  const input: FieldSpec = {
    ...sharedField,
    label: `${sharedField.label} for this profile`,
    hint: undefined,
  }
  return (
    <fieldset className="field-group override" {...describedBy(id, error, hint)}>
      <legend>{sharedField.label}</legend>
      <p className="hint">
        Shared:{' '}
        {sharedValue === undefined || sharedValue === null || sharedValue === '' ? (
          '(nothing yet)'
        ) : (
          <FieldValue field={sharedField} value={sharedValue} />
        )}
      </p>
      <div className="check">
        <input
          type="checkbox"
          id={`${id}-on`}
          checked={overriding}
          onChange={(e) => onChange(e.target.checked ? emptyFor(sharedField) : undefined)}
        />
        <label htmlFor={`${id}-on`}>Override for this profile</label>
      </div>
      {overriding && (
        <FieldControl
          field={input}
          value={(props.value as Value) ?? null}
          onChange={(value, problem) => onChange(value, problem)}
        />
      )}
      <Help id={id} error={error} hint={hint} />
    </fieldset>
  )
}

/** The empty override to start from: empty text for built-in text fields, null otherwise. */
function emptyFor(field: FieldSpec): Value {
  return !field.custom && (field.type === 'text' || field.type === 'longText') ? '' : null
}
