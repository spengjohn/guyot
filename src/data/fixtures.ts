// Test helpers only. Not imported by the app.
import { SCHEMA_VERSION } from './constants'
import { compareStamps, stampEdit } from './stamp'
import type { CalendarDay, ChoiceId, DeviceId, Moment, RoleId, Uuid } from './types/core'
import type { FieldMeta, FieldStamp, LiveRecord, Tombstone } from './types/record'
import type { ApplicationData, ExportFile, SharedTargetsData, TableName } from './types/tables'

export const LAPTOP = 'aaaaaaaa-0000-4000-8000-000000000000' as DeviceId
export const PHONE = 'bbbbbbbb-0000-4000-8000-000000000000' as DeviceId

/** A moment on 2026-10-03 at the given UTC hour and minute. */
export function at(hour: number, minute = 0): Moment {
  return Date.UTC(2026, 9, 3, hour, minute) as Moment
}

const MAP_FIELDS = new Set(['custom', 'overrides', 'choices'])

/** A live record with every field (and every map entry) stamped with `stamp`. */
export function makeRecord<D extends object>(id: Uuid, data: D, stamp: FieldStamp): LiveRecord<D> {
  const fieldMeta: FieldMeta = { deleted: stamp }
  for (const [key, value] of Object.entries(data)) {
    if (MAP_FIELDS.has(key) && typeof value === 'object' && value !== null) {
      for (const entry of Object.keys(value)) fieldMeta[`${key}.${entry}`] = stamp
    } else {
      fieldMeta[key] = stamp
    }
  }
  return {
    id,
    updatedAt: stamp.updatedAt,
    deviceId: stamp.deviceId,
    deleted: false,
    schemaVersion: SCHEMA_VERSION,
    fieldMeta,
    purged: false,
    ...structuredClone(data),
  }
}

/**
 * Returns a copy with one field edited, stamped the way repo.ts will stamp real edits.
 * Keys can be dotted ('custom.<id>'); a value of undefined removes a map entry.
 */
export function editField<R extends LiveRecord<object>>(
  record: R,
  key: string,
  value: unknown,
  deviceId: DeviceId,
  time: Moment,
): R {
  const copy = structuredClone(record)
  const fields = copy as unknown as Record<string, unknown> // writable view of the same object
  const dot = key.indexOf('.')
  if (dot === -1) {
    fields[key] = value
  } else {
    const map = fields[key.slice(0, dot)] as Record<string, unknown>
    if (value === undefined) delete map[key.slice(dot + 1)]
    else map[key.slice(dot + 1)] = value
  }
  copy.fieldMeta[key] = stampEdit(record.fieldMeta[key], deviceId, time)
  const newest = Object.values(copy.fieldMeta).reduce((a, b) => (compareStamps(a, b) >= 0 ? a : b))
  copy.updatedAt = newest.updatedAt
  copy.deviceId = newest.deviceId
  return copy
}

export function tombstone(id: Uuid, stamp: FieldStamp): Tombstone {
  return {
    id,
    updatedAt: stamp.updatedAt,
    deviceId: stamp.deviceId,
    deleted: true,
    schemaVersion: SCHEMA_VERSION,
    fieldMeta: { deleted: stamp },
    purged: true,
  }
}

export function emptySharedTargets(): SharedTargetsData {
  return {
    roleTypes: [],
    industries: [],
    prioritizeCompanies: [],
    excludeCompanies: [],
    excludeRule: '',
    mustHaveKeywords: [],
    niceToHaveKeywords: [],
    dealbreakers: [],
    eligibilityNotes: '',
    preferredSources: [],
    custom: {},
  }
}

export function sampleApplication(): ApplicationData {
  return {
    roleId: 'R001' as RoleId,
    postingId: null,
    dateApplied: '2026-10-01' as CalendarDay,
    lastUpdate: null,
    listing: 'https://example.com/jobs/123',
    jdSnapshotId: null,
    company: 'Example Co',
    role: 'Frontend Developer',
    status: 'applied' as ChoiceId,
    resumeVersionId: null,
    contact: '',
    notes: '',
    deadline: { kind: 'day', day: '2026-10-15' as CalendarDay },
    nextFollowUp: null,
    custom: {},
  }
}

export function emptyExportFile(): ExportFile {
  const tables = {} as Record<TableName, never[]>
  for (const name of [
    'searchProfiles',
    'sharedTargets',
    'postings',
    'stageRows',
    'applications',
    'resumeVersions',
    'jdSnapshots',
    'fieldDefinitions',
    'pipelineDefinitions',
    'stageInstructions',
    'conflictLog',
    'changeLog',
  ] as const) {
    tables[name] = []
  }
  return {
    app: 'guyot',
    formatVersion: 1,
    exportedAt: at(12),
    deviceId: LAPTOP,
    schemaVersion: SCHEMA_VERSION,
    tables,
  }
}
