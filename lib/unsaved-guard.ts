/**
 * "You have unsaved changes" -- the cheapest layer of loss protection, and the
 * one this app was missing entirely.
 *
 * Everything else in the history stack (autosave snapshots, the recovery bar)
 * recovers work *after* it is lost. This one stops the most common loss from
 * happening at all: the accidental Cmd+W / Ctrl+R on a document that has never
 * been exported. It costs no storage and touches no user data.
 *
 * Cloud workbooks add a second arm: bytes may already be on this device
 * (IndexedDB pending) while Appwrite has not finished the upload. That is not
 * "unsaved edits" -- `hasUnsavedChanges()` stays false so autosave / SW heal
 * do not treat it as dirty -- but unloading still prompts, because other
 * devices will not see the revision until the next open flushes.
 *
 * What it deliberately does NOT do:
 * - It is not armed in embed mode. The document belongs to the host page and
 *   the host owns its own unload UX.
 * - An autosave snapshot does not disarm the dirty flag. A snapshot lives in
 *   this browser; the user still has no file on disk, which is exactly what
 *   they are about to walk away from. Only a real export to disk (or a cloud
 *   local-stage that calls `markDocumentSaved`) clears dirty. Pending cloud
 *   sync is a separate flag cleared only when the flush lands.
 *
 * Browser limits worth knowing: the prompt's wording is the browser's, not
 * ours; the page must have been interacted with (sticky activation) for the
 * prompt to appear at all; and mobile task-switching never fires it. So this
 * layer catches slips, not crashes -- crashes are what the snapshots are for.
 */
import { isEmbedMode } from './embed-mode';

let dirty = false;
/** Local cloud pending exists; account upload has not finished (or failed). */
let cloudSyncPending = false;
let installed = false;
let lastEditAt = 0;

/** The editor reported an edit (`onDocumentStateChange` with modified = true). */
export function markDocumentDirty(): void {
  dirty = true;
  lastEditAt = Date.now();
}

/**
 * When the editor last reported an edit. The autosave scheduler waits for a
 * short lull before exporting: the export runs a full conversion in the editor
 * frame, and starting one on top of active typing is felt.
 */
export function getLastEditAt(): number {
  return lastEditAt;
}

/** The document's bytes reached the user's disk: nothing is at risk any more. */
export function markDocumentSaved(): void {
  dirty = false;
}

/**
 * Cloud Save staged bytes on this device and has not yet confirmed the
 * Appwrite upload. Arms beforeunload without re-dirtying the editor.
 */
export function markCloudSyncPending(): void {
  cloudSyncPending = true;
}

/** Flush cleared the pending row (or a blocking cloud write landed). */
export function clearCloudSyncPending(): void {
  cloudSyncPending = false;
}

export function hasPendingCloudSync(): boolean {
  return cloudSyncPending;
}

/** A different document is taking over the editor; its edit history is not ours. */
export function resetUnsavedChanges(): void {
  dirty = false;
  cloudSyncPending = false;
}

export function hasUnsavedChanges(): boolean {
  return dirty;
}

function shouldPromptUnload(): boolean {
  return dirty || cloudSyncPending;
}

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (!shouldPromptUnload()) return;
  // Both spellings on purpose: preventDefault() is what the spec asks for,
  // returnValue is what older WebKit still checks. The string is never shown --
  // every browser prints its own wording.
  event.preventDefault();
  event.returnValue = '';
}

export function installUnsavedChangesGuard(): void {
  if (installed || typeof window === 'undefined' || isEmbedMode()) return;
  installed = true;
  window.addEventListener('beforeunload', handleBeforeUnload);
}

/**
 * Test seam. In production the listener is installed once and lives as long as
 * the page does; tests need to put the window back the way they found it,
 * because a stale listener from a previous case answers for a module instance
 * the current case cannot see (the same trap documented for embed-api).
 */
export function resetUnsavedGuardForTests(): void {
  dirty = false;
  cloudSyncPending = false;
  lastEditAt = 0;
  if (installed && typeof window !== 'undefined') {
    window.removeEventListener('beforeunload', handleBeforeUnload);
  }
  installed = false;
}
