/**
 * Durable local staging for cloud workbook saves.
 *
 * Save writes the exported .xlsx here first (same-tab, survives reload), then
 * uploads to Appwrite in the background. Open prefers a pending copy when it
 * is newer than the cloud row's updatedAt -- otherwise a reload mid-upload
 * would reopen the pre-edit bytes from Storage.
 *
 * Separate from document-history: those rows are AutoRecover for local files;
 * this store is keyed by the Appwrite workbook id and only holds the latest
 * unsynced (or just-synced) revision.
 */
const DB_NAME = 'editxlsx-cloud-pending';
const DB_VERSION = 1;
const STORE = 'pending';

export type CloudPendingRecord = {
  workbookId: string;
  title: string;
  userId: string;
  /** Last known Storage file id when the pending was written (hot-save context). */
  fileId: string;
  bytes: Uint8Array;
  /** Epoch ms when the local write landed. */
  savedAt: number;
};

let dbPromise: Promise<IDBDatabase | null> | null = null;

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
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
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'workbookId' });
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
  });
  return dbPromise;
}

function idbReq<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function toBytes(view: Uint8Array | ArrayBuffer): Uint8Array {
  if (ArrayBuffer.isView(view)) {
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }
  return new Uint8Array(view);
}

function revive(raw: unknown): CloudPendingRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.workbookId !== 'string' || typeof row.title !== 'string') return null;
  if (typeof row.userId !== 'string' || typeof row.fileId !== 'string') return null;
  if (typeof row.savedAt !== 'number') return null;
  if (!(ArrayBuffer.isView(row.bytes) || row.bytes instanceof ArrayBuffer)) return null;
  return {
    workbookId: row.workbookId,
    title: row.title,
    userId: row.userId,
    fileId: row.fileId,
    bytes: toBytes(row.bytes as Uint8Array | ArrayBuffer),
    savedAt: row.savedAt,
  };
}

/** Write (or replace) the pending revision for a workbook. Returns false if IDB is unavailable. */
export async function putCloudPending(
  workbookId: string,
  file: File,
  meta: { userId: string; fileId: string; title: string },
): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const record: CloudPendingRecord = {
    workbookId,
    title: meta.title,
    userId: meta.userId,
    fileId: meta.fileId,
    bytes,
    savedAt: Date.now(),
  };
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    });
    return true;
  } catch {
    return false;
  }
}

export async function getCloudPending(workbookId: string): Promise<CloudPendingRecord | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const tx = db.transaction(STORE, 'readonly');
    const raw = await idbReq(tx.objectStore(STORE).get(workbookId));
    return revive(raw);
  } catch {
    return null;
  }
}

export async function clearCloudPending(workbookId: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(workbookId);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    });
  } catch {
    /* Best-effort. */
  }
}

/**
 * Prefer the pending local copy when it is strictly newer than the cloud row.
 * `cloudUpdatedAt` is the Appwrite document `$updatedAt` ISO string.
 */
export async function takeCloudPendingIfNewer(
  workbookId: string,
  cloudUpdatedAt: string,
): Promise<File | null> {
  const pending = await getCloudPending(workbookId);
  if (!pending) return null;
  const cloudMs = Date.parse(cloudUpdatedAt);
  if (Number.isFinite(cloudMs) && pending.savedAt <= cloudMs) {
    await clearCloudPending(workbookId);
    return null;
  }
  return new File([pending.bytes], pending.title, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    lastModified: pending.savedAt,
  });
}

/** Test seam: drop the open promise so the next call reopens. */
export function resetCloudPendingDbForTests(): void {
  dbPromise = null;
}
