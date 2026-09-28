/**
 * Wiring for the local history feature. Kept in one place so the editor entry
 * has a single call, and so the pieces that must not import each other -- the
 * save channel and the autosave scheduler -- stay uncoupled.
 */
import { isCloudWorkbookBound, writeCloudWorkbook } from '../cloud-workbook';
import { isLocalWorkbookBound, writeLocalWorkbook } from '../local-workbook';
import { setDiskWriter, setSavedToDiskListener } from '../onlyoffice/save-stream';
import { saveToDiskFile } from '../save-target';
import { getAutosaveDocId } from './autosave';
import { markSavedToDisk, pruneExpired } from './store';

export function initDocumentHistory(): void {
  // Expiry has to happen on its own, not when someone thinks to visit the
  // history page: "this browser forgets after seven days" is only a promise if
  // nothing has to be done to collect on it.
  void pruneExpired();

  // Saving writes back to the file the document came from, once the user has
  // pointed at one. The document id is what links the two, which is why this
  // is wired here rather than inside the save channel.
  //
  // Priority: cloud binding → local vault binding → disk FSA / download.
  setDiskWriter(async (file) => {
    if (isCloudWorkbookBound()) {
      return writeCloudWorkbook(file);
    }
    if (isLocalWorkbookBound()) {
      return writeLocalWorkbook(file);
    }
    const docId = getAutosaveDocId();
    if (!docId) return false;
    const outcome = await saveToDiskFile(docId, file, 'Document');
    // 'cancelled' means the user closed the picker: they decided not to save,
    // so downloading a copy anyway would be answering a question they declined.
    if (outcome === 'cancelled') return true;
    return outcome === 'written';
  });

  setSavedToDiskListener(() => {
    // The document now exists on disk, so its history row has nothing left to
    // offer back. Without this the recovery bar would keep flagging a document
    // the user already saved.
    const id = getAutosaveDocId();
    if (id) void markSavedToDisk(id);
  });
}

export { beginAutosaveSession, isAutosaveEnabled, setAutosaveEnabled, stopAutosaveSession } from './autosave';
export { clearAllHistory, deleteDoc, getLatestSnapshot, listDocs } from './store';
export type { HistoryDoc } from './types';
