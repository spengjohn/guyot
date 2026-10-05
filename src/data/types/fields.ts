import type { CalendarDay, ChoiceId, Uuid, ZonedMoment } from './core'

export type CustomFieldType =
  'text' | 'longText' | 'number' | 'date' | 'dateTime' | 'yesNo' | 'link' | 'choice'

/** Shapes only built-in fields use; users can't create these. */
export type BuiltinOnlyFieldType = 'choiceList' | 'textList' | 'money' | 'deadline' | 'reference'

export type FieldType = CustomFieldType | BuiltinOnlyFieldType

export type PayPeriod = 'hour' | 'day' | 'week' | 'month' | 'year'
export interface Money {
  amount: number
  period: PayPeriod
  currency: string // ISO 4217 code, e.g. 'USD'
}

/**
 * A deadline is either a plain day or a time in the posting's zone. Used by postings
 * found in Discover; Applications have no deadline.
 */
export type Deadline = { kind: 'day'; day: CalendarDay } | { kind: 'time'; at: ZonedMoment }

/** The stored value for each field type. */
export interface FieldValueByType {
  text: string
  longText: string
  number: number
  date: CalendarDay
  dateTime: ZonedMoment
  yesNo: boolean
  link: string
  choice: ChoiceId
  choiceList: ChoiceId[]
  textList: string[]
  money: Money
  deadline: Deadline
  reference: Uuid // id of another record
}

/** null means empty. */
export type FieldValue = FieldValueByType[FieldType] | null

export interface ChoiceOption {
  label: string
  order: number
  hidden: boolean // retired options stay, so old values still display
}

/** Which table (and, for stage rows, which stage) a field belongs to. */
export type FieldScope =
  | { table: 'applications' }
  | { table: 'stageRows'; stageId: Uuid }
  | { table: 'searchProfiles' }
  | { table: 'sharedTargets' }

/** A user-made field. Synced. "Deleting" sets deleted: true, so it's hidden and undoable. */
export type FieldDefinitionData = { scope: FieldScope; label: string } & (
  | { type: 'choice'; choices: Record<ChoiceId, ChoiceOption> }
  | { type: Exclude<CustomFieldType, 'choice'> }
)

/** A built-in field. Defined in code, not stored. Can be hidden and reordered, not deleted. */
export interface BuiltinField {
  key: string
  label: string
  type: FieldType
  required: boolean // must be filled in when entering data in a form; not enforced on stored records
  readOnly?: boolean // set by the app (Role ID) or by a later step's screen
  hint?: string // shown under the input, e.g. that a field is personal
  maxLength?: number
  choices?: Readonly<Record<string, ChoiceOption>> // fixed IDs, e.g. status 'applied'
}

/** Per-device column layout. Stored in local settings, never synced. */
export interface ColumnLayout {
  scope: FieldScope
  order: string[] // built-in keys and custom field ids
  hidden: string[]
}
