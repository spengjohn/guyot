import { LIMITS } from './constants'
import type { ChoiceId } from './types/core'
import type { BuiltinField, ChoiceOption } from './types/fields'
import type { ApplicationData, SearchProfileData, SharedTargetsFields } from './types/tables'

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

// ---------- Targets ----------

/** Fixed option IDs, like Status: labels may change, IDs never do (docs/decisions/0013). */
export const EMPLOYMENT_TYPES = {
  fullTime: { label: 'Full time', order: 1, hidden: false },
  partTime: { label: 'Part time', order: 2, hidden: false },
  contract: { label: 'Contract', order: 3, hidden: false },
  temporary: { label: 'Temporary', order: 4, hidden: false },
  internship: { label: 'Internship', order: 5, hidden: false },
  freelance: { label: 'Freelance', order: 6, hidden: false },
} as const satisfies Record<string, ChoiceOption>

export const WORK_MODES = {
  onSite: { label: 'On-site', order: 1, hidden: false },
  hybrid: { label: 'Hybrid', order: 2, hidden: false },
  remote: { label: 'Remote', order: 3, hidden: false },
} as const satisfies Record<string, ChoiceOption>

export const PRIORITIES = {
  high: { label: 'High', order: 1, hidden: false },
  medium: { label: 'Medium', order: 2, hidden: false },
  low: { label: 'Low', order: 3, hidden: false },
} as const satisfies Record<string, ChoiceOption>

type ProfileFieldKey = Exclude<keyof SearchProfileData, 'custom' | 'overrides' | 'customOverrides'>

/** The built-in search profile fields, in form and column order. */
export const SEARCH_PROFILE_FIELDS: readonly (BuiltinField & { key: ProfileFieldKey })[] = [
  { key: 'name', label: 'Name', type: 'text', required: true, maxLength: LIMITS.shortText },
  { key: 'term', label: 'Term', type: 'text', required: false, maxLength: LIMITS.shortText },
  {
    key: 'employmentTypes',
    label: 'Employment types',
    type: 'choiceList',
    required: false,
    choices: EMPLOYMENT_TYPES,
  },
  { key: 'locations', label: 'Locations', type: 'textList', required: false },
  {
    key: 'workModes',
    label: 'Work modes',
    type: 'choiceList',
    required: false,
    choices: WORK_MODES,
  },
  { key: 'minimumPay', label: 'Minimum pay', type: 'money', required: false },
  { key: 'priority', label: 'Priority', type: 'choice', required: false, choices: PRIORITIES },
  { key: 'active', label: 'Active', type: 'yesNo', required: true },
  { key: 'notes', label: 'Notes', type: 'longText', required: false, maxLength: LIMITS.longText },
]

/** The built-in shared-target fields, in form order. Every profile can override each one. */
export const SHARED_TARGET_FIELDS: readonly (BuiltinField & { key: keyof SharedTargetsFields })[] =
  [
    { key: 'roleTypes', label: 'Role types', type: 'textList', required: false },
    { key: 'industries', label: 'Industries', type: 'textList', required: false },
    {
      key: 'prioritizeCompanies',
      label: 'Companies to prioritize',
      type: 'textList',
      required: false,
    },
    { key: 'excludeCompanies', label: 'Companies to exclude', type: 'textList', required: false },
    {
      key: 'excludeRule',
      label: 'Exclusion rule',
      type: 'longText',
      required: false,
      hint: 'In your own words, which companies to skip (for example, "staffing agencies").',
    },
    { key: 'mustHaveKeywords', label: 'Must-have keywords', type: 'textList', required: false },
    {
      key: 'niceToHaveKeywords',
      label: 'Nice-to-have keywords',
      type: 'textList',
      required: false,
    },
    { key: 'dealbreakers', label: 'Dealbreakers', type: 'textList', required: false },
    {
      key: 'eligibilityNotes',
      label: 'Eligibility notes',
      type: 'longText',
      required: false,
      hint: 'Personal. Sent to an AI only from stages that need it.',
    },
    { key: 'preferredSources', label: 'Preferred sources', type: 'textList', required: false },
  ]

/** Built-in columns hidden until the user shows them. */
export const APPLICATION_HIDDEN_BY_DEFAULT: readonly ApplicationFieldKey[] = [
  'contact',
  'notes',
  'resumeVersionId',
  'jdSnapshotId',
]
