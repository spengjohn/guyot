import type { Uuid } from './types/core'
import type { TableName } from './types/tables'

// Record<TableName, true> makes TypeScript require every table, so a new table can't be missed.
export const TABLE_SET: Record<TableName, true> = {
  searchProfiles: true,
  sharedTargets: true,
  postings: true,
  stageRows: true,
  applications: true,
  resumeVersions: true,
  jdSnapshots: true,
  fieldDefinitions: true,
  pipelineDefinitions: true,
  stageInstructions: true,
  conflictLog: true,
  changeLog: true,
}
export const TABLE_NAMES = Object.keys(TABLE_SET) as TableName[]

/** Tables whose records carry a Role ID (posting-linked records). */
export const ROLE_ID_TABLES: readonly TableName[] = [
  'postings',
  'stageRows',
  'applications',
  'jdSnapshots',
  'resumeVersions',
]

/** Tables the app writes itself. They are never edited directly or logged. */
export const LOG_TABLES: readonly TableName[] = ['changeLog', 'conflictLog']

/** Version of the record format. Bump only with a migration in migrate.ts. */
export const SCHEMA_VERSION = 1

/** Fixed ID for the one shared-targets record, so every device creates the same record. */
export const SHARED_TARGETS_ID = '5f3c2a8e-9b41-4d6a-8e27-c0b1d9f4a613' as Uuid

/** Size limits. Anything larger is rejected by validation. */
export const LIMITS = {
  shortText: 1_000,
  longText: 50_000,
  postingText: 200_000,
  link: 2_048,
  listItems: 500,
  jsonDepth: 20,
  reportedIssues: 100,
} as const
