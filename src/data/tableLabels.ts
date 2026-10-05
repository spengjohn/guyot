import type { TableName } from './types/tables'

/** What each table is called on screen. */
export const TABLE_LABELS: Record<TableName, string> = {
  searchProfiles: 'Search profiles',
  sharedTargets: 'Shared targets',
  goals: 'Goals',
  postings: 'Postings',
  stageRows: 'Stage rows',
  applications: 'Applications',
  resumeVersions: 'Resume versions',
  jdSnapshots: 'Job description snapshots',
  fieldDefinitions: 'Custom fields',
  pipelineDefinitions: 'Pipelines',
  stageInstructions: 'Stage instructions',
  conflictLog: 'Conflict log',
  changeLog: 'Change log',
}
