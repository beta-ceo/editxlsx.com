// Consume a file handed off by a static landing page (public/open-local.js):
// the page stashes the picked File in IndexedDB and navigates to the app with
// `?open=local`; the app takes the file out (one-shot) and opens it. The DB /
// store / key names here must stay in sync with public/open-local.js.
const DB_NAME = 'document-handoff';
const STORE = 'files';
const KEY = 'pending';

/** Read and delete the pending handoff file. Resolves null when there is none
 *  (stale `?open=local` URL, reload after consumption) or IndexedDB is unusable. */
export const takePendingFile = (): Promise<File | null> => {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      // A fresh DB created by onupgradeneeded above has an empty store — the
      // normal "nothing pending" path resolves null through the get() below.
      try {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const get = store.get(KEY);
        get.onsuccess = () => {
          const value = get.result;
          store.delete(KEY);
          tx.oncomplete = () => {
            db.close();
            resolve(value instanceof File ? value : null);
          };
        };
        get.onerror = () => {
          db.close();
          resolve(null);
        };
        tx.onerror = () => {
          db.close();
          resolve(null);
        };
      } catch {
        db.close();
        resolve(null);
      }
    };
  });
};
