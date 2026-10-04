import type { FieldId, Uuid } from '../data/types/core'
import type { FieldValue } from '../data/types/fields'
import type { ApplicationData } from '../data/types/tables'
import type { FieldSpec } from '../fields/columns'

/** A short name for an application in button labels and messages: "R003, Example Co, Designer". */
export function describeApplication(app: Pick<ApplicationData, 'roleId' | 'company' | 'role'>) {
  return [app.roleId, app.company, app.role].filter((part) => part.trim() !== '').join(', ')
}

/** One field's value on an application, built in or custom. */
export function cellValue(app: ApplicationData, field: FieldSpec): FieldValue | undefined {
  if (field.custom) return app.custom[field.key as FieldId]
  return (app as unknown as Record<string, FieldValue>)[field.key] // built-in keys are ApplicationData keys
}

/** The id of a row's Edit button, so focus can be moved back to it. */
export function editButtonId(app: { id: Uuid }): string {
  return `edit-${app.id}`
}
