import { LOG_TABLES, ROLE_ID_TABLES, TABLE_NAMES } from './constants'

export const DB_NAME = 'guyot'

/**
 * Version of the database layout (stores and indexes). Separate from the record
 * schemaVersion. Bump it only when adding stores or indexes, in onupgradeneeded below.
 */
const DB_VERSION = 1

/** Local-only key-value stores. Never synced. */
export const META_STORE = 'meta'
export const SETTINGS_STORE = 'settings'

export function openDatabase(name: string = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      // Version 1: every store. Later versions add steps here; existing data is kept.
      for (const table of TABLE_NAMES) {
        if (db.objectStoreNames.contains(table)) continue
        const store = db.createObjectStore(table, { keyPath: 'id' })
        if (ROLE_ID_TABLES.includes(table)) store.createIndex('roleId', 'roleId')
        if (LOG_TABLES.includes(table)) store.createIndex('recordId', 'recordId')
      }
      for (const store of [META_STORE, SETTINGS_STORE]) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store)
      }
    }
    req.onsuccess = () => {
      const db = req.result
      // Another tab is upgrading the database: step aside so it isn't blocked.
      db.onversionchange = () => db.close()
      resolve(db)
    }
    req.onerror = () => reject(req.error)
    req.onblocked = () =>
      reject(new Error('Close other Guyot tabs, then reload to finish updating.'))
  })
}

/** Turns an IndexedDB request into a promise. */
export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Resolves when a transaction commits; rejects if it aborts. */
export function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'))
    tx.onerror = () => reject(tx.error)
  })
}
