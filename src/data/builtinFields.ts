import { LIMITS } from './constants'
import type { ChoiceId } from './types/core'
import type { BuiltinField, ChoiceOption } from './types/fields'
import type { ApplicationData } from './types/tables'

/**
 * The Status options. Their IDs are fixed and stored in records, so they never change;
 * labels can. A retired option is marked hidden, never removed, so old values still
 * display. Adding an option is a format change (docs/decisions/0013).
 */
export const STATUS_CHOICES = {
  applied: { label: 'Applied', order: 1, hidden: false },
  screening: { label: 'Screening', order: 2, hidden: false },
  interviewing: { label: 'Interviewing', order: 3, hidden: false },
  offer: { label: 'Offer', order: 4, hidden: false },
  accepted: { label: 'Accepted', order: 5, hidden: false },
  rejected: { label: 'Rejected', order: 6, hidden: false },
  withdrawn: { label: 'Withdrawn', order: 7, hidden: false },
  noResponse: { label: 'No response', order: 8, hidden: false },
} as const satisfies Record<string, ChoiceOption>

export type StatusId = keyof typeof STATUS_CHOICES
export const DEFAULT_STATUS = 'applied' as ChoiceId

/** Applications fields the user can see. `postingId` is an internal link, not a column. */
type ApplicationFieldKey = Exclude<keyof ApplicationData, 'postingId' | 'custom'>

/**
 * The built-in Applications fields, in their default column order. They can be hidden
 * and reordered but not deleted. Resume and Job Description are set by later steps'
 * screens, so they're read-only for now.
 */
export const APPLICATION_FIELDS: readonly (BuiltinField & { key: ApplicationFieldKey })[] = [
  { key: 'roleId', label: 'Role ID', type: 'text', required: true, readOnly: true },
  { key: 'company', label: 'Company', type: 'text', required: true, maxLength: LIMITS.shortText },
  { key: 'role', label: 'Role', type: 'text', required: true, maxLength: LIMITS.shortText },
  { key: 'status', label: 'Status', type: 'choice', required: true, choices: STATUS_CHOICES },
  { key: 'dateApplied', label: 'Date Applied', type: 'date', required: true },
  { key: 'lastUpdate', label: 'Last Update', type: 'date', required: false },
  { key: 'nextFollowUp', label: 'Next Follow-up', type: 'date', required: false },
  { key: 'listing', label: 'Listing', type: 'link', required: false, maxLength: LIMITS.link },
  { key: 'contact', label: 'Contact', type: 'text', required: false, maxLength: LIMITS.shortText },
  { key: 'notes', label: 'Notes', type: 'longText', required: false, maxLength: LIMITS.longText },
  {
    key: 'resumeVersionId',
    label: 'Resume',
    type: 'reference',
    required: false,
    readOnly: true,
  },
  {
    key: 'jdSnapshotId',
    label: 'Job Description',
    type: 'reference',
    required: false,
    readOnly: true,
  },
]

/** Built-in columns hidden until the user shows them. */
export const APPLICATION_HIDDEN_BY_DEFAULT: readonly ApplicationFieldKey[] = [
  'contact',
  'notes',
  'resumeVersionId',
  'jdSnapshotId',
]
