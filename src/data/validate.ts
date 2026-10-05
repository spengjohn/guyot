import { LIMITS, SCHEMA_VERSION, SHARED_TARGETS_ID, TABLE_NAMES, TABLE_SET } from './constants'
import { EMPLOYMENT_TYPES, PRIORITIES, STATUS_CHOICES, WORK_MODES } from './builtinFields'
import { isCalendarDay, isTimeZone } from './time'
import type {
  ChoiceOption,
  CustomFieldType,
  FieldDefinitionData,
  FieldType,
  PayPeriod,
} from './types/fields'
import type {
  ChangeAction,
  ExportFile,
  GoalMeasure,
  GoalPeriod,
  ListMode,
  SharedTargetsFields,
  TableName,
  Weekday,
} from './types/tables'

/** What validation found. Errors block saving; warnings are kept and shown as flags. */
export interface Report {
  errors: string[]
  warnings: string[]
}

/** Custom field definitions by field ID, used to check custom values. */
export interface ValidationContext {
  customFields: ReadonlyMap<string, FieldDefinitionData>
}

/**
 * A check returns a list of problems; an empty list means the value is fine.
 * Checks are hand-written rather than from a schema library: see docs/decisions/0010.
 */
type Check = (value: unknown, path: string) => string[]
type Obj = Record<string, unknown>

// ---------- Small building blocks ----------

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const ROLE_ID = /^R\d{3,}$/
const CHOICE_ID = /^[A-Za-z0-9_-]{1,64}$/
const CURRENCY = /^[A-Z]{3}$/

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(max: number): Check {
  return (v, path) => {
    if (typeof v !== 'string') return [`${path}: expected text`]
    if (v.length > max) return [`${path}: longer than ${max} characters`]
    return []
  }
}

function pattern(regex: RegExp, label: string): Check {
  return (v, path) =>
    typeof v === 'string' && regex.test(v) && !FORBIDDEN_KEYS.has(v)
      ? []
      : [`${path}: expected ${label}`]
}

function num(opts: { integer?: boolean; min?: number } = {}): Check {
  return (v, path) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return [`${path}: expected a number`]
    if (opts.integer && !Number.isInteger(v)) return [`${path}: expected a whole number`]
    if (opts.min !== undefined && v < opts.min) return [`${path}: below ${opts.min}`]
    return []
  }
}

const bool: Check = (v, path) => (typeof v === 'boolean' ? [] : [`${path}: expected yes/no`])

/** Accepts only the keys of `allowed`. */
function oneOf(allowed: Record<string, true>): Check {
  return (v, path) =>
    typeof v === 'string' && Object.hasOwn(allowed, v)
      ? []
      : [`${path}: expected one of ${Object.keys(allowed).join(', ')}`]
}

function nullable(check: Check): Check {
  return (v, path) => (v === null ? [] : check(v, path))
}

function arrayOf(check: Check, maxItems: number = LIMITS.listItems): Check {
  return (v, path) => {
    if (!Array.isArray(v)) return [`${path}: expected a list`]
    if (v.length > maxItems) return [`${path}: more than ${maxItems} items`]
    return v.flatMap((item, i) => check(item, `${path}[${i}]`))
  }
}

/** An object with exactly these keys. Unknown keys are rejected. */
function shape(fields: Record<string, Check>): Check {
  return (v, path) => {
    if (!isObj(v)) return [`${path}: expected an object`]
    const issues = Object.keys(v)
      .filter((key) => !Object.hasOwn(fields, key))
      .map((key) => `${path}.${key}: unknown field`)
    for (const [key, check] of Object.entries(fields)) {
      if (!Object.hasOwn(v, key)) issues.push(`${path}.${key}: missing`)
      else issues.push(...check(v[key], `${path}.${key}`))
    }
    return issues
  }
}

const uuid = pattern(UUID, 'an ID')
const roleId = pattern(ROLE_ID, 'a Role ID like R001')
const choiceId = pattern(CHOICE_ID, 'a choice ID')
const moment = num({ integer: true, min: 0 })
const shortText = text(LIMITS.shortText)
const longText = text(LIMITS.longText)
const postingText = text(LIMITS.postingText)
const textList = arrayOf(shortText)
const choiceList = arrayOf(choiceId)

/**
 * One of a built-in field's fixed options. Hidden (retired) options stay valid, so old
 * values still pass. Anything else is an error, not a warning: see docs/decisions/0013.
 */
function builtinChoice(label: string, choices: Readonly<Record<string, ChoiceOption>>): Check {
  return (v, path) =>
    typeof v === 'string' && Object.hasOwn(choices, v) ? [] : [`${path}: not a valid ${label}`]
}

const calendarDay: Check = (v, path) =>
  typeof v === 'string' && isCalendarDay(v) ? [] : [`${path}: expected a date (YYYY-MM-DD)`]

const timeZone: Check = (v, path) =>
  typeof v === 'string' && isTimeZone(v) ? [] : [`${path}: expected a time zone`]

/** Empty, or an http(s) address. */
const link: Check = (v, path) => {
  const issues = text(LIMITS.link)(v, path)
  if (issues.length > 0 || v === '') return issues
  try {
    const { protocol } = new URL(v as string)
    return protocol === 'https:' || protocol === 'http:' ? [] : [`${path}: expected a web link`]
  } catch {
    return [`${path}: expected a web link`]
  }
}

/** Any JSON value, with size and depth limits. Used for logged values. */
function json(depth = 0): Check {
  return (v, path) => {
    if (depth > LIMITS.jsonDepth) return [`${path}: nested too deeply`]
    if (v === null || typeof v === 'boolean') return []
    if (typeof v === 'number') return Number.isFinite(v) ? [] : [`${path}: expected a number`]
    if (typeof v === 'string') return text(LIMITS.postingText)(v, path)
    if (Array.isArray(v)) return arrayOf(json(depth + 1), LIMITS.listItems)(v, path)
    if (isObj(v)) {
      return Object.entries(v).flatMap(([key, item]) =>
        FORBIDDEN_KEYS.has(key)
          ? [`${path}: forbidden key`]
          : json(depth + 1)(item, `${path}.${key}`),
      )
    }
    return [`${path}: not a JSON value`]
  }
}

// ---------- Field values ----------

// Record<Union, true> makes TypeScript require every member of the union, so
// adding a new field type or pay period without updating these is a compile error.
const PAY_PERIODS: Record<PayPeriod, true> = {
  hour: true,
  day: true,
  week: true,
  month: true,
  year: true,
}
const CUSTOM_FIELD_TYPES: Record<CustomFieldType, true> = {
  text: true,
  longText: true,
  number: true,
  date: true,
  dateTime: true,
  yesNo: true,
  link: true,
  choice: true,
}

const zonedMoment = shape({ at: moment, timeZone })
const money = shape({
  amount: num({ min: 0 }),
  period: oneOf(PAY_PERIODS),
  currency: pattern(CURRENCY, 'a currency code like USD'),
})
const deadline: Check = (v, path) => {
  if (isObj(v) && v.kind === 'day')
    return shape({ kind: oneOf({ day: true }), day: calendarDay })(v, path)
  if (isObj(v) && v.kind === 'time')
    return shape({ kind: oneOf({ time: true }), at: zonedMoment })(v, path)
  return [`${path}: expected a deadline`]
}

const VALUE_CHECKS: Record<FieldType, Check> = {
  text: shortText,
  longText,
  number: num(),
  date: calendarDay,
  dateTime: zonedMoment,
  yesNo: bool,
  link,
  choice: choiceId,
  choiceList,
  textList,
  money,
  deadline,
  reference: uuid,
}

/** Checks a field value of the given type. null (empty) is always allowed. */
export function checkFieldValue(type: FieldType, value: unknown, path: string): string[] {
  return value === null ? [] : VALUE_CHECKS[type](value, path)
}

// ---------- Tables ----------

/** A map-like field: one stamp per entry, keyed '<field>.<entry key>'. */
interface MapSpec {
  optional: boolean
  key: Check
  entry: (key: string, value: unknown, path: string, ctx: ValidationContext, out: Report) => void
}

interface TableSchema {
  fields: Record<string, Check>
  maps: Record<string, MapSpec>
  refine?: (data: Obj, path: string) => string[]
}

const SHARED_TARGET_CHECKS: Record<keyof SharedTargetsFields, Check> = {
  roleTypes: textList,
  industries: textList,
  prioritizeCompanies: textList,
  excludeCompanies: textList,
  excludeRule: longText,
  mustHaveKeywords: textList,
  niceToHaveKeywords: textList,
  dealbreakers: textList,
  eligibilityNotes: longText,
  preferredSources: textList,
}

const LIST_MODES: Record<ListMode, true> = { add: true, replace: true }
const listOverride = shape({ mode: oneOf(LIST_MODES), items: textList })

/** What a profile may store to override each shared field. Lists carry a mode (docs/decisions/0012). */
const OVERRIDE_CHECKS: Record<keyof SharedTargetsFields, Check> = {
  roleTypes: listOverride,
  industries: listOverride,
  prioritizeCompanies: listOverride,
  excludeCompanies: listOverride,
  excludeRule: longText,
  mustHaveKeywords: listOverride,
  niceToHaveKeywords: listOverride,
  dealbreakers: listOverride,
  eligibilityNotes: longText,
  preferredSources: listOverride,
}

/**
 * Checks one value for a custom field. A value for an unknown field is kept and
 * flagged, never dropped (integrity rule 5). Returns the field's definition if known.
 */
function checkCustomValue(
  key: string,
  value: unknown,
  path: string,
  ctx: ValidationContext,
  out: Report,
): FieldDefinitionData | undefined {
  const def = ctx.customFields.get(key)
  if (!def) {
    out.warnings.push(`${path}: value for an unknown custom field (kept)`)
    out.errors.push(...json()(value, path))
    return undefined
  }
  out.errors.push(...checkFieldValue(def.type, value, path))
  if (def.type === 'choice' && typeof value === 'string' && !Object.hasOwn(def.choices, value)) {
    out.warnings.push(`${path}: unknown choice option (kept)`)
  }
  return def
}

const customMap: MapSpec = {
  optional: false,
  key: uuid,
  entry: (key, value, path, ctx, out) => {
    checkCustomValue(key, value, path, ctx, out)
  },
}

const overridesMap: MapSpec = {
  optional: false,
  key: (v, path) =>
    typeof v === 'string' && Object.hasOwn(OVERRIDE_CHECKS, v)
      ? []
      : [`${path}: not a shared target field`],
  entry: (key, value, path, _ctx, out) => {
    out.errors.push(...OVERRIDE_CHECKS[key as keyof SharedTargetsFields](value, path))
  },
}

/** Overrides of custom shared-target fields, keyed by field ID. */
const customOverridesMap: MapSpec = {
  optional: false,
  key: uuid,
  entry: (key, value, path, ctx, out) => {
    const def = checkCustomValue(key, value, path, ctx, out)
    if (def && def.scope.table !== 'sharedTargets') {
      out.warnings.push(`${path}: overrides a field that is not a shared target (kept)`)
    }
  },
}

const GOAL_MEASURES: Record<GoalMeasure, true> = { applicationsSent: true }
const GOAL_PERIODS: Record<GoalPeriod, true> = { week: true, month: true }
const WEEKDAYS: Record<Weekday, true> = {
  monday: true,
  tuesday: true,
  wednesday: true,
  thursday: true,
  friday: true,
  saturday: true,
  sunday: true,
}

const choiceOption: Check = shape({ label: shortText, order: num({ integer: true }), hidden: bool })
const choicesMap: MapSpec = {
  optional: true,
  key: choiceId,
  entry: (_key, value, path, _ctx, out) => {
    out.errors.push(...choiceOption(value, path))
  },
}

const fieldScope: Check = (v, path) => {
  if (!isObj(v)) return [`${path}: expected a field scope`]
  if (v.table === 'stageRows')
    return shape({ table: oneOf({ stageRows: true }), stageId: uuid })(v, path)
  return shape({ table: oneOf({ applications: true, searchProfiles: true, sharedTargets: true }) })(
    v,
    path,
  )
}

const stampRef = shape({ updatedAt: moment, deviceId: uuid })
const fieldStamp = shape({ updatedAt: moment, deviceId: uuid, base: nullable(stampRef) })

const CHANGE_ACTIONS: Record<ChangeAction, true> = {
  create: true,
  update: true,
  delete: true,
  restore: true,
  purge: true,
  import: true,
  renumber: true,
  undo: true,
}

// The mapped type `{ [T in TableName]: ... }` requires a schema for every table.
const SCHEMAS: { [T in TableName]: TableSchema } = {
  searchProfiles: {
    fields: {
      name: shortText,
      term: shortText,
      employmentTypes: arrayOf(builtinChoice('Employment type', EMPLOYMENT_TYPES)),
      locations: textList,
      workModes: arrayOf(builtinChoice('Work mode', WORK_MODES)),
      minimumPay: nullable(money),
      priority: nullable(builtinChoice('Priority', PRIORITIES)),
      active: bool,
      notes: longText,
    },
    maps: { custom: customMap, overrides: overridesMap, customOverrides: customOverridesMap },
  },
  sharedTargets: { fields: SHARED_TARGET_CHECKS, maps: { custom: customMap } },
  goals: {
    fields: {
      name: shortText,
      measure: oneOf(GOAL_MEASURES),
      target: num({ integer: true, min: 1 }),
      period: oneOf(GOAL_PERIODS),
      weekStartsOn: oneOf(WEEKDAYS),
      startDay: calendarDay,
      endDay: nullable(calendarDay),
      active: bool,
      notes: longText,
    },
    maps: {},
    // 'YYYY-MM-DD' strings sort the same way as the days they name.
    refine: (data, path) =>
      typeof data.endDay === 'string' &&
      typeof data.startDay === 'string' &&
      data.endDay < data.startDay
        ? [`${path}.endDay: before the start day`]
        : [],
  },
  postings: {
    fields: {
      roleId,
      profileId: nullable(uuid),
      url: link,
      company: shortText,
      role: shortText,
      location: shortText,
      text: postingText,
    },
    maps: { custom: customMap },
  },
  stageRows: {
    fields: { roleId, postingId: uuid, stageId: uuid },
    maps: { custom: customMap },
  },
  applications: {
    fields: {
      roleId,
      postingId: nullable(uuid),
      dateApplied: nullable(calendarDay),
      lastUpdate: nullable(calendarDay),
      listing: link,
      jdSnapshotId: nullable(uuid),
      company: shortText,
      role: shortText,
      status: builtinChoice('Status', STATUS_CHOICES),
      resumeVersionId: nullable(uuid),
      contact: shortText,
      notes: longText,
      nextFollowUp: nullable(calendarDay),
    },
    maps: { custom: customMap },
  },
  resumeVersions: {
    fields: {
      name: shortText,
      isMaster: bool,
      roleId: nullable(roleId),
      postingId: nullable(uuid),
    },
    maps: {},
  },
  jdSnapshots: {
    fields: {
      roleId,
      postingId: nullable(uuid),
      url: link,
      capturedAt: moment,
      text: postingText,
    },
    maps: {},
  },
  fieldDefinitions: {
    fields: { scope: fieldScope, label: shortText, type: oneOf(CUSTOM_FIELD_TYPES) },
    maps: { choices: choicesMap },
    refine: (data, path) => {
      const hasChoices = Object.hasOwn(data, 'choices')
      if (data.type === 'choice' && !hasChoices) return [`${path}.choices: missing`]
      if (data.type !== 'choice' && hasChoices)
        return [`${path}.choices: only choice fields have choices`]
      return []
    },
  },
  pipelineDefinitions: { fields: { name: shortText }, maps: {} },
  stageInstructions: {
    fields: { stageId: uuid, version: num({ integer: true, min: 1 }), text: longText },
    maps: {},
  },
  conflictLog: {
    fields: {
      table: oneOf(TABLE_SET),
      recordId: uuid,
      fieldKey: shortText,
      losingValue: json(),
      losingStamp: fieldStamp,
      winningStamp: fieldStamp,
      resolved: bool,
    },
    maps: {},
  },
  changeLog: {
    fields: {
      table: oneOf(TABLE_SET),
      recordId: uuid,
      action: oneOf(CHANGE_ACTIONS),
      fieldKeys: arrayOf(shortText, 10_000),
      stamps: (v, path) => {
        if (!isObj(v)) return [`${path}: expected an object`]
        return Object.entries(v).flatMap(([key, stamp]) =>
          FORBIDDEN_KEYS.has(key)
            ? [`${path}: forbidden key`]
            : fieldStamp(stamp, `${path}.${key}`),
        )
      },
      before: (v, path) => (isObj(v) ? json()(v, path) : [`${path}: expected an object`]),
      appliedBy: oneOf({ user: true, ai: true, import: true }),
      stageId: nullable(uuid),
    },
    maps: {},
  },
}

const SYNC_CHECKS: Record<string, Check> = {
  id: uuid,
  updatedAt: moment,
  deviceId: uuid,
  deleted: bool,
  schemaVersion: (v, path) =>
    v === SCHEMA_VERSION ? [] : [`${path}: expected schema version ${SCHEMA_VERSION}`],
  purged: bool,
}

/** Record keys that belong to the app, never edited as data. */
export const SYNC_KEYS: ReadonlySet<string> = new Set([...Object.keys(SYNC_CHECKS), 'fieldMeta'])

/** The map-like fields of a table (one stamp per entry), such as 'custom'. */
export function mapFieldsOf(table: TableName): string[] {
  return Object.keys(SCHEMAS[table].maps)
}

// ---------- Records ----------

/** Validates one stored record (live or tombstone) for a table. */
export function validateRecord(
  table: TableName,
  value: unknown,
  ctx: ValidationContext,
  path: string = table,
): Report {
  const out: Report = { errors: [], warnings: [] }
  if (!isObj(value)) {
    out.errors.push(`${path}: expected a record`)
    return out
  }
  const schema = SCHEMAS[table]

  for (const [key, check] of Object.entries(SYNC_CHECKS)) {
    if (!Object.hasOwn(value, key)) out.errors.push(`${path}.${key}: missing`)
    else out.errors.push(...check(value[key], `${path}.${key}`))
  }
  if (!isObj(value.fieldMeta)) {
    out.errors.push(`${path}.fieldMeta: expected an object`)
    return out
  }
  const fieldMeta = value.fieldMeta
  for (const [key, stamp] of Object.entries(fieldMeta)) {
    out.errors.push(...fieldStamp(stamp, `${path}.fieldMeta.${key}`))
  }

  const allowed = new Set([...Object.keys(SYNC_CHECKS), 'fieldMeta'])
  const expectedStamps = new Set(['deleted'])

  if (value.purged === true) {
    if (value.deleted !== true) out.errors.push(`${path}.deleted: a purged record must be deleted`)
  } else {
    for (const [key, check] of Object.entries(schema.fields)) {
      allowed.add(key)
      expectedStamps.add(key)
      if (!Object.hasOwn(value, key)) out.errors.push(`${path}.${key}: missing`)
      else out.errors.push(...check(value[key], `${path}.${key}`))
    }
    for (const [name, spec] of Object.entries(schema.maps)) {
      allowed.add(name)
      if (!Object.hasOwn(value, name)) {
        if (!spec.optional) out.errors.push(`${path}.${name}: missing`)
        continue
      }
      const map = value[name]
      if (!isObj(map)) {
        out.errors.push(`${path}.${name}: expected an object`)
        continue
      }
      for (const [key, entry] of Object.entries(map)) {
        const entryPath = `${path}.${name}.${key}`
        const keyIssues = spec.key(key, entryPath)
        out.errors.push(...keyIssues)
        if (keyIssues.length === 0) spec.entry(key, entry, entryPath, ctx, out)
        expectedStamps.add(`${name}.${key}`)
      }
    }
    if (schema.refine) out.errors.push(...schema.refine(value, path))
  }

  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) out.errors.push(`${path}.${key}: unknown field`)
  }

  // Every field needs a stamp. Extra stamps are allowed only for removed map entries.
  for (const key of expectedStamps) {
    if (!Object.hasOwn(fieldMeta, key)) out.errors.push(`${path}.fieldMeta.${key}: missing stamp`)
  }
  for (const key of Object.keys(fieldMeta)) {
    if (expectedStamps.has(key)) continue
    const dot = key.indexOf('.')
    const spec = dot === -1 || value.purged === true ? undefined : schema.maps[key.slice(0, dot)]
    if (!spec || spec.key(key.slice(dot + 1), key).length > 0) {
      out.errors.push(`${path}.fieldMeta.${key}: stamp for an unknown field`)
    }
  }

  if (out.errors.length === 0) {
    const newest = Math.max(
      ...Object.values(fieldMeta).map((s) => (s as { updatedAt: number }).updatedAt),
    )
    if (value.updatedAt !== newest)
      out.errors.push(`${path}.updatedAt: must match the newest field stamp`)
  }
  return out
}

// ---------- Local settings ----------

const columnKeys = arrayOf(shortText, 1_000) // built-in keys and custom field IDs
const localSettings = shape({
  columnLayouts: arrayOf(shape({ scope: fieldScope, order: columnKeys, hidden: columnKeys }), 100),
})

/** Checks this device's settings (local only, never synced). Returns the problems found. */
export function validateLocalSettings(value: unknown): string[] {
  return localSettings(value, 'settings')
}

// ---------- Export files ----------

export type FileResult =
  { ok: true; file: ExportFile; warnings: string[] } | { ok: false; errors: string[] }

/**
 * Validates a whole export (or sync) file. Any error rejects the entire file, so it is
 * never half-applied. `localFields` are this device's custom field definitions.
 */
export function validateExportFile(
  input: unknown,
  localFields: ReadonlyMap<string, FieldDefinitionData> = new Map(),
): FileResult {
  const fail = (errors: string[]): FileResult => ({
    ok: false,
    errors: errors.slice(0, LIMITS.reportedIssues),
  })
  if (!isObj(input)) return fail(['File: not a Guyot export'])

  const header = shape({
    app: oneOf({ guyot: true }),
    formatVersion: (v, path) => (v === 1 ? [] : [`${path}: unsupported format version`]),
    exportedAt: moment,
    deviceId: uuid,
    schemaVersion: num({ integer: true, min: 0 }), // too old or too new is explained below
    tables: (v, path) => (isObj(v) ? [] : [`${path}: expected an object`]),
  })
  const headerIssues = header(input, 'file')
  if (headerIssues.length > 0) return fail(headerIssues)
  if ((input.schemaVersion as number) > SCHEMA_VERSION) {
    return fail(['file.schemaVersion: made by a newer version of Guyot; update the app first'])
  }
  if (input.schemaVersion !== SCHEMA_VERSION) {
    return fail([
      'file.schemaVersion: made by an older version of Guyot that this version cannot upgrade',
    ])
  }

  const tables = input.tables as Obj
  const errors = shape(
    Object.fromEntries(
      TABLE_NAMES.map((name) => [
        name,
        (v: unknown, path: string) => (Array.isArray(v) ? [] : [`${path}: expected a list`]),
      ]),
    ),
  )(tables, 'file.tables')
  if (errors.length > 0) return fail(errors)

  // Custom fields defined in the file count as known, alongside this device's.
  const customFields = new Map(localFields)
  for (const def of tables.fieldDefinitions as unknown[]) {
    if (isObj(def) && typeof def.id === 'string' && def.purged === false) {
      if (validateRecord('fieldDefinitions', def, { customFields }).errors.length === 0) {
        customFields.set(def.id, def as unknown as FieldDefinitionData)
      }
    }
  }

  const warnings: string[] = []
  for (const name of TABLE_NAMES) {
    const seen = new Set<unknown>()
    const records = tables[name] as unknown[]
    for (const [i, record] of records.entries()) {
      const path = `${name}[${i}]`
      const report = validateRecord(name, record, { customFields }, path)
      errors.push(...report.errors)
      warnings.push(...report.warnings)
      if (!isObj(record)) continue
      if (seen.has(record.id)) errors.push(`${path}.id: duplicate ID`)
      seen.add(record.id)
      if (name === 'sharedTargets' && record.id !== SHARED_TARGETS_ID) {
        errors.push(`${path}.id: shared targets must use the fixed shared-targets ID`)
      }
    }
    if (errors.length >= LIMITS.reportedIssues) break
  }
  if (errors.length > 0) return fail(errors)
  // Every part has been checked above, so it's now safe to treat the input as an ExportFile.
  return { ok: true, file: input as unknown as ExportFile, warnings }
}
