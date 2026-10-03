import type {
  CalendarDay,
  ChoiceId,
  DeviceId,
  FieldId,
  JsonValue,
  Moment,
  RoleId,
  Uuid,
} from './core'
import type { ColumnLayout, Deadline, FieldDefinitionData, FieldValue, Money } from './fields'
import type { FieldStamp, StoredRecord } from './record'

interface HasCustom {
  custom: Record<FieldId, FieldValue> // values keyed by field ID, so renames never break data
}

export interface SharedTargetsFields {
  roleTypes: string[]
  industries: string[]
  prioritizeCompanies: string[]
  excludeCompanies: string[]
  excludeRule: string
  mustHaveKeywords: string[]
  niceToHaveKeywords: string[]
  dealbreakers: string[]
  eligibilityNotes: string // personal: sent only to stages that need it
  preferredSources: string[]
}
export interface SharedTargetsData extends SharedTargetsFields, HasCustom {}

export interface SearchProfileData extends HasCustom {
  name: string
  term: string
  employmentTypes: ChoiceId[]
  locations: string[]
  workModes: ChoiceId[]
  minimumPay: Money | null
  priority: ChoiceId | null // 'high' | 'medium' | 'low'
  active: boolean
  notes: string
  overrides: Partial<SharedTargetsFields> // the profile's value wins where set
}

export interface PostingData extends HasCustom {
  roleId: RoleId
  profileId: Uuid | null
  url: string
  company: string
  role: string
  location: string
  text: string // untrusted posting text
}

export interface ApplicationData extends HasCustom {
  roleId: RoleId
  postingId: Uuid | null
  dateApplied: CalendarDay | null
  lastUpdate: CalendarDay | null
  listing: string
  jdSnapshotId: Uuid | null
  company: string
  role: string
  status: ChoiceId
  resumeVersionId: Uuid | null
  contact: string
  notes: string
  deadline: Deadline | null
  nextFollowUp: CalendarDay | null
}

export interface JdSnapshotData {
  roleId: RoleId
  postingId: Uuid | null
  url: string
  capturedAt: Moment
  text: string
}

export interface ConflictLogData {
  table: TableName
  recordId: Uuid
  fieldKey: string
  losingValue: JsonValue
  losingStamp: FieldStamp
  winningStamp: FieldStamp
  resolved: boolean // user restored or dismissed it
}

export type ChangeAction =
  'create' | 'update' | 'delete' | 'restore' | 'purge' | 'import' | 'renumber'

/** Purging a record also clears its `before` values here and its conflict log entries. */
export interface ChangeLogData {
  table: TableName
  recordId: Uuid
  action: ChangeAction
  before: Record<string, JsonValue> // old value of each changed field, for undo
  appliedBy: 'user' | 'ai' | 'import'
  stageId: Uuid | null // set when appliedBy is 'ai'
}

// Minimal shapes now; filled in during their own build steps. Their stores are created now.
export interface StageRowData extends HasCustom {
  roleId: RoleId
  postingId: Uuid
  stageId: Uuid
}
export interface ResumeVersionData {
  name: string
  isMaster: boolean
  roleId: RoleId | null // set on per-posting copies
}
export interface PipelineDefinitionData {
  name: string
}
export interface StageInstructionData {
  stageId: Uuid
  version: number
  text: string
}

/** The table map: one entry per IndexedDB object store of synced records. */
export interface Tables {
  searchProfiles: SearchProfileData
  sharedTargets: SharedTargetsData
  postings: PostingData
  stageRows: StageRowData
  applications: ApplicationData
  resumeVersions: ResumeVersionData
  jdSnapshots: JdSnapshotData
  fieldDefinitions: FieldDefinitionData
  pipelineDefinitions: PipelineDefinitionData
  stageInstructions: StageInstructionData
  conflictLog: ConflictLogData
  changeLog: ChangeLogData
}
export type TableName = keyof Tables
export type RecordOf<T extends TableName> = StoredRecord<Tables[T]>

/** Local-only, never synced. */
export interface Meta {
  deviceId: DeviceId
  nextRoleNumber: number
  lastBackupAt: Moment | null
}
export interface LocalSettings {
  columnLayouts: ColumnLayout[]
}

/** JSON export file. The step 3 device sync file will reuse this shape. */
export interface ExportFile {
  app: 'guyot'
  formatVersion: 1
  exportedAt: Moment
  deviceId: DeviceId
  schemaVersion: number
  tables: { [T in TableName]: RecordOf<T>[] }
}
