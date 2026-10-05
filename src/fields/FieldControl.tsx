import { useId, useState, type ChangeEvent } from 'react'
import { isCalendarDay, isTimeZone } from '../data/time'
import type { CalendarDay, ChoiceId, ZonedMoment } from '../data/types/core'
import type { Deadline, FieldValue, Money, PayPeriod } from '../data/types/fields'
import { deviceTimeZone, momentToZonedTime, timeZoneNames, zonedTimeToMoment } from '../ui/dates'
import type { FieldSpec } from './columns'
import { ListEditor } from './ListEditor'
import { moneyFrom, type MoneyParts } from './parse'

/**
 * Called with the new value. `problem` is set when the input holds something that
 * isn't a value yet (half a date and time, letters in a number); the form shows it
 * and won't save until it's fixed. Without it, a half-typed value would be lost.
 */
export type OnFieldChange = (value: FieldValue, problem?: string) => void

interface Props {
  field: FieldSpec
  value: FieldValue
  onChange: OnFieldChange
  error?: string
  /** Extra guidance shown under the input (not an error). */
  hint?: string
}

/** A labeled input for one field, chosen by its type, with its hint and error message. */
export function FieldControl(props: Props) {
  // The field's own hint (e.g. "Personal…") and the form's (e.g. an overwrite warning).
  const hint = [props.field.hint, props.hint].filter(Boolean).join(' ') || undefined
  const all = { ...props, hint }
  switch (props.field.type) {
    case 'deadline':
      return <DeadlineControl {...all} />
    case 'dateTime':
      return <DateTimeControl {...all} />
    case 'textList':
      return <TextListControl {...all} />
    case 'choiceList':
      return <ChoiceListControl {...all} />
    case 'money':
      return <MoneyControl {...all} />
    case 'yesNo':
      // A required yes/no can't be empty, so it's a plain checkbox.
      return props.field.required ? <CheckboxControl {...all} /> : <SimpleControl {...all} />
    default:
      return <SimpleControl {...all} />
  }
}

/**
 * aria-* props for an input: ties it to its hint and error message (by ID, so screen
 * readers read them with the label), marks it invalid, and marks it required.
 */
function ariaFor(
  baseId: string,
  { error, hint, required }: Pick<Props, 'error' | 'hint'> & { required: boolean },
) {
  const describedBy = [hint && `${baseId}-hint`, error && `${baseId}-error`]
    .filter(Boolean)
    .join(' ')
  return {
    ...(error ? { 'aria-invalid': true } : {}),
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    ...(required ? { 'aria-required': true } : {}),
  }
}

function HelpText({ baseId, error, hint }: { baseId: string } & Pick<Props, 'error' | 'hint'>) {
  return (
    <>
      {hint && (
        <p id={`${baseId}-hint`} className="hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${baseId}-error`} className="field-error">
          {error}
        </p>
      )}
    </>
  )
}

/**
 * A field's label text, with "(required)" shown for required fields. The marker is
 * hidden from screen readers, which hear "required" from aria-required on the input
 * instead, so it isn't read twice.
 */
function LabelText({ field }: { field: FieldSpec }) {
  return (
    <>
      {field.label}
      {field.required && (
        <span className="required" aria-hidden="true">
          {' '}
          (required)
        </span>
      )}
    </>
  )
}

function SimpleControl({ field, value, onChange, error, hint }: Props) {
  const id = useId() // a unique ID per component, so the label's htmlFor matches its input
  const aria = ariaFor(id, { error, hint, required: field.required })

  let input
  switch (field.type) {
    case 'text':
    case 'link':
      input = (
        <input
          id={id}
          type={field.type === 'link' ? 'url' : 'text'}
          value={(value as string | null) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          {...aria}
        />
      )
      break
    case 'longText':
      input = (
        <textarea
          id={id}
          rows={4}
          value={(value as string | null) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          {...aria}
        />
      )
      break
    case 'number':
      input = (
        <input
          id={id}
          type="number"
          step="any"
          value={value === null ? '' : String(value)}
          onChange={(e) => onChange(...numberFrom(e))}
          {...aria}
        />
      )
      break
    case 'date':
      input = (
        <input
          id={id}
          type="date"
          value={(value as string | null) ?? ''}
          onChange={(e) => onChange(...dayFrom(e))}
          {...aria}
        />
      )
      break
    case 'yesNo':
      input = (
        <select
          id={id}
          value={value === null ? '' : value ? 'yes' : 'no'}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'yes')}
          {...aria}
        >
          <option value="">Not set</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      )
      break
    case 'choice':
      input = (
        <select
          id={id}
          value={(value as string | null) ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : (e.target.value as ChoiceId))}
          {...aria}
        >
          {!field.required && <option value="">Not set</option>}
          {choiceOptions(field, value as string | null).map(([optionId, label]) => (
            <option key={optionId} value={optionId}>
              {label}
            </option>
          ))}
        </select>
      )
      break
    default:
      input = (
        <p id={id} className="hint">
          This field can't be edited here yet.
        </p>
      )
  }

  return (
    <div className="field">
      <label htmlFor={id}>
        <LabelText field={field} />
      </label>
      {input}
      <HelpText baseId={id} error={error} hint={hint} />
    </div>
  )
}

/** Options in their order. Retired (hidden) options appear only if this record uses one. */
function choiceOptions(field: FieldSpec, current: string | null): [string, string][] {
  const entries = Object.entries(field.choices ?? {})
    .filter(([optionId, option]) => !option.hidden || optionId === current)
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([optionId, option]): [string, string] => [optionId, option.label])
  if (current && !entries.some(([optionId]) => optionId === current)) {
    entries.push([current, `Unknown option (${current})`])
  }
  return entries
}

function numberFrom(e: ChangeEvent<HTMLInputElement>): [FieldValue, string?] {
  if (e.target.value !== '') return [Number(e.target.value)]
  return [null, e.target.validity.badInput ? 'Enter a number' : undefined]
}

/** A date input's value is already 'YYYY-MM-DD', so it is stored as is: no time zone involved. */
function dayFrom(e: ChangeEvent<HTMLInputElement>): [FieldValue, string?] {
  const text = e.target.value
  if (text === '') return [null, e.target.validity.badInput ? 'Enter a whole date' : undefined]
  return isCalendarDay(text) ? [text] : [null, 'Enter a date like 2026-10-15']
}

// ---------- Dates with a time ----------

interface ZonedParts {
  day: string
  time: string
  timeZone: string
}

function partsOf(at: ZonedMoment | null): ZonedParts {
  if (!at) return { day: '', time: '', timeZone: deviceTimeZone() }
  return { ...momentToZonedTime(at.at, at.timeZone), timeZone: at.timeZone }
}

/** The moment the parts describe, or what's still missing. */
function zonedFrom(parts: ZonedParts): { value: ZonedMoment | null; problem?: string } {
  if (parts.day === '' && parts.time === '') return { value: null }
  if (!isCalendarDay(parts.day)) return { value: null, problem: 'Enter the day' }
  if (!/^\d{2}:\d{2}/.test(parts.time)) return { value: null, problem: 'Enter the time' }
  if (!isTimeZone(parts.timeZone)) {
    return { value: null, problem: 'Choose a time zone from the list, such as America/New_York' }
  }
  const at = zonedTimeToMoment(parts.day as CalendarDay, parts.time.slice(0, 5), parts.timeZone)
  return { value: { at, timeZone: parts.timeZone } }
}

let zoneList: string[] | undefined

/** Every time zone, built on first use (there are a few hundred) and then reused. */
function allZones(): string[] {
  zoneList ??= timeZoneNames()
  return zoneList
}

/** Day, time and time zone inputs. The zone defaults to this device's. */
function ZonedInputs({
  parts,
  onParts,
  aria,
}: {
  parts: ZonedParts
  onParts: (parts: ZonedParts) => void
  aria: ReturnType<typeof ariaFor>
}) {
  const id = useId()
  return (
    <div className="field-row">
      <div className="field">
        <label htmlFor={`${id}-day`}>Day</label>
        <input
          id={`${id}-day`}
          type="date"
          value={parts.day}
          onChange={(e) => onParts({ ...parts, day: e.target.value })}
          {...aria}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-time`}>Time</label>
        <input
          id={`${id}-time`}
          type="time"
          value={parts.time}
          onChange={(e) => onParts({ ...parts, time: e.target.value })}
          {...aria}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-zone`}>Time zone</label>
        <input
          id={`${id}-zone`}
          list={`${id}-zones`}
          value={parts.timeZone}
          onChange={(e) => onParts({ ...parts, timeZone: e.target.value })}
          autoComplete="off"
          spellCheck={false}
          {...aria}
        />
        <datalist id={`${id}-zones`}>
          {allZones().map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
      </div>
    </div>
  )
}

/** A custom "date with time" field: empty, or a moment in a chosen zone. */
function DateTimeControl({ field, value, onChange, error, hint }: Props) {
  const id = useId()
  const [parts, setParts] = useState(() => partsOf(value as ZonedMoment | null))
  const update = (next: ZonedParts) => {
    setParts(next)
    const { value: at, problem } = zonedFrom(next)
    onChange(at, problem)
  }
  return (
    <fieldset className="field-group">
      <legend>
        <LabelText field={field} />
      </legend>
      <ZonedInputs
        parts={parts}
        onParts={update}
        aria={ariaFor(id, { error, hint, required: field.required })}
      />
      <HelpText baseId={id} error={error} hint={hint} />
    </fieldset>
  )
}

type DeadlineKind = 'none' | Deadline['kind']

/** No deadline, a day, or a day and time in the posting's time zone. */
function DeadlineControl({ field, value, onChange, error, hint }: Props) {
  const id = useId()
  const deadline = value as Deadline | null
  const [kind, setKind] = useState<DeadlineKind>(deadline?.kind ?? 'none')
  const [day, setDay] = useState(deadline?.kind === 'day' ? deadline.day : '')
  const [parts, setParts] = useState(() => partsOf(deadline?.kind === 'time' ? deadline.at : null))
  const aria = ariaFor(id, { error, hint, required: field.required })

  const report = (nextKind: DeadlineKind, nextDay: string, nextParts: ZonedParts) => {
    if (nextKind === 'none') return onChange(null)
    if (nextKind === 'day') {
      return isCalendarDay(nextDay)
        ? onChange({ kind: 'day', day: nextDay })
        : onChange(null, 'Enter the deadline day, or choose No deadline')
    }
    const { value: at, problem } = zonedFrom(nextParts)
    if (at) return onChange({ kind: 'time', at })
    onChange(null, problem ?? 'Enter the deadline day and time, or choose No deadline')
  }

  return (
    <fieldset className="field-group">
      <legend>
        <LabelText field={field} />
      </legend>
      <div className="field">
        <label htmlFor={`${id}-kind`}>Type</label>
        <select
          id={`${id}-kind`}
          value={kind}
          onChange={(e) => {
            const next = e.target.value as DeadlineKind
            setKind(next)
            report(next, day, parts)
          }}
          {...aria}
        >
          <option value="none">No deadline</option>
          <option value="day">A day</option>
          <option value="time">A day and time</option>
        </select>
      </div>
      {kind === 'day' && (
        <div className="field">
          <label htmlFor={`${id}-day`}>Day</label>
          <input
            id={`${id}-day`}
            type="date"
            value={day}
            onChange={(e) => {
              setDay(e.target.value)
              report(kind, e.target.value, parts)
            }}
            {...aria}
          />
        </div>
      )}
      {kind === 'time' && (
        <ZonedInputs
          parts={parts}
          onParts={(next) => {
            setParts(next)
            report(kind, day, next)
          }}
          aria={aria}
        />
      )}
      <HelpText baseId={id} error={error} hint={hint} />
    </fieldset>
  )
}

// ---------- Lists, checkboxes and money ----------

/** A list, as rows with Remove and an add box (see ListEditor). */
function TextListControl({ field, value, onChange, error, hint }: Props) {
  const id = useId()
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ')
  return (
    <fieldset className="field-group">
      <legend>
        <LabelText field={field} />
      </legend>
      <ListEditor
        label={field.label}
        items={(value as string[] | null) ?? []}
        onChange={(items, problem) => onChange(items, problem)}
        describedBy={describedBy || undefined}
      />
      <HelpText baseId={id} error={error} hint={hint} />
    </fieldset>
  )
}

/** Choices where several can be picked: a group of checkboxes, in option order. */
function ChoiceListControl({ field, value, onChange, error, hint }: Props) {
  const id = useId()
  const selected = (value as string[] | null) ?? []
  const options = choiceOptions(field, null)
  // Values this device doesn't know (from a newer version) are kept and shown.
  for (const unknown of selected.filter((v) => !options.some(([optionId]) => optionId === v))) {
    options.push([unknown, `Unknown option (${unknown})`])
  }
  const toggle = (optionId: string, on: boolean) => {
    const next = options
      .map(([optionId2]) => optionId2)
      .filter((o) => (o === optionId ? on : selected.includes(o)))
    onChange(next as ChoiceId[])
  }
  return (
    <fieldset className="field-group" {...ariaFor(id, { error, hint, required: false })}>
      <legend>
        <LabelText field={field} />
      </legend>
      <div className="check-list">
        {options.map(([optionId, label]) => (
          <div key={optionId} className="check">
            <input
              type="checkbox"
              id={`${id}-${optionId}`}
              checked={selected.includes(optionId)}
              onChange={(e) => toggle(optionId, e.target.checked)}
            />
            <label htmlFor={`${id}-${optionId}`}>{label}</label>
          </div>
        ))}
      </div>
      <HelpText baseId={id} error={error} hint={hint} />
    </fieldset>
  )
}

/** A required yes/no: one checkbox. Never marked required: unticked is a valid answer. */
function CheckboxControl({ field, value, onChange, error, hint }: Props) {
  const id = useId()
  return (
    <div className="field check">
      <input
        type="checkbox"
        id={id}
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
        {...ariaFor(id, { error, hint, required: false })}
      />
      <label htmlFor={id}>{field.label}</label>
      <HelpText baseId={id} error={error} hint={hint} />
    </div>
  )
}

const PERIOD_LABELS: Record<PayPeriod, string> = {
  hour: 'per hour',
  day: 'per day',
  week: 'per week',
  month: 'per month',
  year: 'per year',
}

let currencyList: string[] | undefined

/** Every currency code the browser knows, built on first use and then reused. */
function allCurrencies(): string[] {
  currencyList ??= Intl.supportedValuesOf('currency')
  return currencyList
}

/** An amount, a period and a currency. Leave the amount empty for no minimum. */
function MoneyControl({ field, value, onChange, error, hint }: Props) {
  const id = useId()
  const money = value as Money | null
  const [parts, setParts] = useState<MoneyParts>(() => ({
    amount: money ? String(money.amount) : '',
    period: money?.period ?? 'year',
    currency: money?.currency ?? 'USD',
  }))
  const aria = ariaFor(id, { error, hint, required: field.required })
  const update = (next: MoneyParts) => {
    setParts(next)
    const { value: result, problem } = moneyFrom(next)
    onChange(result, problem)
  }
  return (
    <fieldset className="field-group">
      <legend>
        <LabelText field={field} />
      </legend>
      <div className="field-row">
        <div className="field">
          <label htmlFor={`${id}-amount`}>Amount</label>
          <input
            id={`${id}-amount`}
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={parts.amount}
            onChange={(e) => update({ ...parts, amount: e.target.value })}
            {...aria}
          />
        </div>
        <div className="field">
          <label htmlFor={`${id}-period`}>Period</label>
          <select
            id={`${id}-period`}
            value={parts.period}
            onChange={(e) => update({ ...parts, period: e.target.value as PayPeriod })}
            {...aria}
          >
            {Object.entries(PERIOD_LABELS).map(([period, label]) => (
              <option key={period} value={period}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-currency`}>Currency</label>
          <input
            id={`${id}-currency`}
            list={`${id}-currencies`}
            value={parts.currency}
            onChange={(e) => update({ ...parts, currency: e.target.value })}
            autoComplete="off"
            spellCheck={false}
            size={5}
            {...aria}
          />
          <datalist id={`${id}-currencies`}>
            {allCurrencies().map((code) => (
              <option key={code} value={code} />
            ))}
          </datalist>
        </div>
      </div>
      <HelpText baseId={id} error={error} hint={hint ?? 'Leave the amount empty for no minimum.'} />
    </fieldset>
  )
}
