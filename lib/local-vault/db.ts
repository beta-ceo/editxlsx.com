/**
 * IndexedDB connection for the durable local vault (not AutoRecover).
 *
 * Schema mirrors the cloud vault enough for the workspace shell to reuse list
 * UX: `items` metadata + `blobs` latest bytes only (one revision per file).
 */
export const DB_NAME = 'editxlsx-local-vault';
export const DB_VERSION = 1;
export const ITEMS_STORE = 'items';
export const BLOBS_STORE = 'blobs';
export const ITEMS_BY_UPDATED = 'by_updatedAt';
export const ITEMS_BY_PARENT = 'by_parentId';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

export function openLocalVaultDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    if (!hasIndexedDb()) {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ITEMS_STORE)) {
        const items = db.createObjectStore(ITEMS_STORE, { keyPath: 'id' });
        items.createIndex(ITEMS_BY_UPDATED, 'updatedAt');
        items.createIndex(ITEMS_BY_PARENT, 'parentId');
      }
      if (!db.objectStoreNames.contains(BLOBS_STORE)) {
        db.createObjectStore(BLOBS_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export async function withLocalStores<T>(
  names: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T>,
): Promise<T | null> {
  const db = await openLocalVaultDb();
  if (!db) return null;

  return new Promise<T | null>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(names, mode);
    } catch (error) {
      reject(error);
      return;
    }

    let result: T;
    let failure: unknown;

    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(failure ?? tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(failure ?? tx.error ?? new DOMException('Transaction aborted', 'AbortError'));

    work(tx).then(
      (value) => {
        result = value;
      },
      (error) => {
        failure = error;
        try {
          tx.abort();
        } catch {
          /* already finished */
        }
      },
    );
  });
}

/** Test seam: drop the cached connection so the next call reopens. */
export function resetLocalVaultDbForTests(): void {
  void dbPromise?.then((db) => db?.close());
  dbPromise = null;
}
