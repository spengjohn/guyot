import { useId } from 'react'
import type { LiveRecord } from '../data/types/record'
import type { ApplicationData } from '../data/types/tables'
import type { Column } from '../fields/columns'
import { FieldValue } from '../fields/FieldValue'
import { cellValue, describeApplication, editButtonId } from './describe'

type Application = LiveRecord<ApplicationData>

interface Props {
  applications: readonly Application[]
  columns: readonly Column[]
  onEdit: (app: Application) => void
  onDelete: (app: Application) => void
}

/**
 * The applications as a real table: a caption, column headers, and the first visible
 * column as each row's header, so screen readers say which row a cell belongs to.
 * Wide tables scroll sideways inside a focusable region, reachable by keyboard.
 */
export function ApplicationsTable({ applications, columns, onEdit, onDelete }: Props) {
  const captionId = useId()
  const visible = columns.filter((c) => !c.hidden)
  const count = applications.length
  return (
    <div className="table-wrap" role="region" aria-labelledby={captionId} tabIndex={0}>
      <table>
        <caption id={captionId}>
          {count} {count === 1 ? 'application' : 'applications'}
        </caption>
        <thead>
          <tr>
            {visible.map((c) => (
              <th key={c.field.key} scope="col">
                {c.field.label}
              </th>
            ))}
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {applications.map((app) => {
            const name = describeApplication(app)
            return (
              <tr key={app.id}>
                {visible.map((c, i) => {
                  const content = <FieldValue field={c.field} value={cellValue(app, c.field)} />
                  return i === 0 ? (
                    <th key={c.field.key} scope="row">
                      {content}
                    </th>
                  ) : (
                    <td key={c.field.key}>{content}</td>
                  )
                })}
                <td className="row-actions">
                  <button
                    type="button"
                    id={editButtonId(app)}
                    aria-label={`Edit ${name}`}
                    onClick={() => onEdit(app)}
                  >
                    Edit
                  </button>
                  <button type="button" aria-label={`Delete ${name}`} onClick={() => onDelete(app)}>
                    Delete
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
