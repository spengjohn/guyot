import { DEFAULT_STATUS } from '../data/builtinFields'
import type { CalendarDay, RoleId } from '../data/types/core'
import type { FieldMeta } from '../data/types/record'
import type { ApplicationData } from '../data/types/tables'

// What's particular to the Applications form. The edit tracking every form shares is in
// src/forms/editModel.ts and src/forms/useEditForm.ts.

/** A saved application with its field stamps. For a new one, the defaults with no stamps. */
export type SavedApplication = ApplicationData & { fieldMeta: FieldMeta }

/** What a new application starts as: Applied, today. */
export function newDraft(today: CalendarDay): SavedApplication {
  return {
    roleId: 'R000' as RoleId, // a placeholder; Repo assigns the real one on create
    postingId: null,
    dateApplied: today,
    lastUpdate: null,
    listing: '',
    jdSnapshotId: null,
    company: '',
    role: '',
    status: DEFAULT_STATUS,
    resumeVersionId: null,
    contact: '',
    notes: '',
    nextFollowUp: null,
    custom: {},
    fieldMeta: {},
  }
}

/** What to do about each required Applications field left empty. */
export const APPLICATION_REQUIRED_MESSAGES: Readonly<Record<string, string>> = {
  company: 'Enter the company',
  role: 'Enter the role',
  dateApplied: 'Enter the date you applied',
  status: 'Choose a status',
}
