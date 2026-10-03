import { SCHEMA_VERSION, TABLE_NAMES } from './constants'
import { upgradeFile, type Migrations } from './migrate'
import { Repo, ValidationError, type MergeSummary } from './repo'
import { now } from './time'
import type { Moment } from './types/core'
import type { FieldDefinitionData } from './types/fields'
import type { LiveRecord } from './types/record'
import type { ExportFile, TableName } from './types/tables'
import { validateExportFile } from './validate'

/** Larger files are refused before parsing, so a huge file can't freeze the page. */
export const MAX_IMPORT_CHARS = 50_000_000

/** Everything on this device, including deleted records, tombstones and both logs. */
export async function exportData(repo: Repo): Promise<ExportFile> {
  const tables = {} as Record<TableName, unknown[]>
  for (const table of TABLE_NAMES) tables[table] = await repo.listAll(table)
  return {
    app: 'guyot',
    formatVersion: 1,
    exportedAt: now(),
    deviceId: repo.deviceId,
    schemaVersion: SCHEMA_VERSION,
    tables: tables as ExportFile['tables'],
  }
}

export function exportToJson(file: ExportFile): string {
  return JSON.stringify(file, null, 2)
}

/** 'guyot-export-2026-10-03.json', using this device's local date. */
export function exportFileName(at: Moment): string {
  const date = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `guyot-export-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`
}

export type ImportOutcome =
  { ok: true; summary: MergeSummary; warnings: string[] } | { ok: false; errors: string[] }

/**
 * Imports an export file by merging every record into this device's data.
 * Files from an older version are upgraded first. The whole file is validated, and all
 * records are saved in one transaction: an invalid file changes nothing.
 * `migrations` is for tests.
 */
export async function importJson(
  repo: Repo,
  text: string,
  options: { migrations?: Migrations } = {},
): Promise<ImportOutcome> {
  if (text.length > MAX_IMPORT_CHARS) return { ok: false, errors: ['File: too large to import'] }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, errors: ['File: not valid JSON'] }
  }
  try {
    parsed = upgradeFile(parsed, options.migrations)
  } catch {
    return {
      ok: false,
      errors: ['File: made by an older version of Guyot and could not be upgraded'],
    }
  }

  const localFields = new Map<string, FieldDefinitionData>()
  for (const def of await repo.listAll('fieldDefinitions')) {
    if (!def.purged) localFields.set(def.id, def as LiveRecord<FieldDefinitionData>)
  }
  const check = validateExportFile(parsed, localFields)
  if (!check.ok) return check

  const tables = check.file.tables as Record<TableName, unknown[]>
  const entries = TABLE_NAMES.flatMap((table) => tables[table].map((record) => ({ table, record })))
  try {
    const summary = await repo.saveMergedMany(entries)
    return { ok: true, summary, warnings: check.warnings }
  } catch (error) {
    if (error instanceof ValidationError) return { ok: false, errors: error.errors }
    throw error
  }
}
