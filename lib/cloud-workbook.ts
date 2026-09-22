/**
 * Cloud workbook binding for the editor tab.
 *
 * When `?workbook=<id>` is open, Save / Ctrl+S (file-stream → diskWriter) and
 * a dedicated autosave metronome write to Appwrite. The hot path is local-first:
 * bytes land in IndexedDB immediately (sync chip → "Saved on this device ·
 * syncing…"), then a background flush rotates the Storage object. Open prefers
 * a newer pending copy so a reload mid-upload does not resurrect the pre-edit
 * cloud bytes. Closing the tab while a pending flush exists arms beforeunload
 * (account sync is not done yet); the next open of this workbook flushes again.
 */
import { t } from '@ranuts/shared/i18n';
import { isEmbedMode } from './embed-mode';
import { saveWorkbookBytes, type Workbook } from './appwrite/workbooks';
import {
  clearCloudPending,
  getCloudPending,
  putCloudPending,
} from './cloud-pending';
import { requestSaveDocument } from './onlyoffice/save-stream';
import { getReadonlyMode } from './onlyoffice/readonly';
import { postShellSaveState } from './shell-bridge';
import {
  clearCloudSyncPending,
  getLastEditAt,
  hasUnsavedChanges,
  markCloudSyncPending,
  markDocumentSaved,
} from './unsaved-guard';
import {
  EXPORT_DUTY_CYCLE,
  IDLE_GRACE_MS,
  MAX_CONSECUTIVE_FAILURES,
  MAX_SNAPSHOT_INTERVAL_MS,
  MIN_SNAPSHOT_INTERVAL_MS,
  SNAPSHOT_INTERVAL_MS,
  TICK_MS,
  snapshotInterval,
} from './history/autosave';

export interface CloudWorkbookBinding {
  id: string;
  title: string;
  fileId: string;
  userId: string;
}

let binding: CloudWorkbookBinding | null = null;
/** Guards the export → local-IDB step (user-facing Save). */
let saving = false;
/** Guards the background Appwrite flush loop. */
let syncing = false;
let autosaveTimer = 0;
let lastCloudSaveAt = 0;
let lastExportMs: number | null = null;
let failures = 0;
let onVisibility: (() => void) | null = null;

export function getCloudWorkbook(): CloudWorkbookBinding | null {
  return binding;
}

export function isCloudWorkbookBound(): boolean {
  return binding !== null;
}

export function bindCloudWorkbook(workbook: Pick<Workbook, 'id' | 'title' | 'fileId' | 'userId'>): void {
  binding = {
    id: workbook.id,
    title: workbook.title,
    fileId: workbook.fileId,
    userId: workbook.userId,
  };
  stampWorkbookInUrl(workbook.id);
}

export function unbindCloudWorkbook(): void {
  stopCloudAutosave();
  binding = null;
  clearCloudSyncPending();
}

/** Keep `?workbook=<id>` in the address bar; drop one-shot open params. */
export function stampWorkbookInUrl(workbookId: string): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (url.searchParams.get('workbook') === workbookId) return;
  url.searchParams.set('workbook', workbookId);
  url.searchParams.delete('open');
  url.searchParams.delete('saved');
  url.searchParams.delete('new');
  window.history.replaceState(null, '', url);
}

function notify(kind: 'success' | 'error' | 'warning', message: string): void {
  const api = (window as unknown as { message?: Record<string, ((msg: string) => void) | undefined> }).message;
  api?.[kind]?.(message);
}

function hotSaveOptions(active: CloudWorkbookBinding): {
  title: string;
  hot: { userId: string; fileId: string; title: string };
} {
  return {
    title: active.title,
    hot: { userId: active.userId, fileId: active.fileId, title: active.title },
  };
}

/**
 * Push pending IndexedDB bytes to Appwrite. Loops while a newer pending
 * arrived during the previous upload (coalesce rapid Saves).
 */
export async function flushCloudPending(): Promise<void> {
  if (syncing) return;
  const active = binding;
  if (!active) return;
  syncing = true;
  try {
    while (binding && binding.id === active.id) {
      const pending = await getCloudPending(binding.id);
      if (!pending) {
        clearCloudSyncPending();
        break;
      }
      const generation = pending.savedAt;
      postShellSaveState(binding.id, 'local');
      try {
        const file = new File([pending.bytes], pending.title, {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          lastModified: pending.savedAt,
        });
        const updated = await saveWorkbookBytes(binding.id, file, {
          title: pending.title,
          hot: {
            userId: pending.userId,
            // Live binding, not the stale fileId frozen into the pending row --
            // a Save that landed during the previous upload must rotate from
            // whatever the row currently points at.
            fileId: binding.fileId,
            title: pending.title,
          },
        });
        if (!binding || binding.id !== updated.id) break;
        binding = {
          id: updated.id,
          title: updated.title,
          fileId: updated.fileId,
          userId: updated.userId,
        };
        lastCloudSaveAt = Date.now();
        failures = 0;
        const still = await getCloudPending(updated.id);
        if (still && still.savedAt === generation) {
          await clearCloudPending(updated.id);
        }
        const nextAfterClear = await getCloudPending(updated.id);
        if (!nextAfterClear) {
          clearCloudSyncPending();
          postShellSaveState(updated.id, 'saved');
        } else {
          // A newer Save landed during the upload; keep the unload arm and the
          // "syncing" chip until that generation flushes too.
          postShellSaveState(updated.id, 'local');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures += 1;
        // Pending bytes are still local -- keep the unload prompt armed.
        markCloudSyncPending();
        postShellSaveState(active.id, 'error', message);
        notify('error', `${t('cloudSaveFailed')}${message}`);
        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          console.warn('[cloud] sync stopped after repeated failures:', message);
          stopCloudAutosave();
          notify('warning', t('cloudAutosaveStopped'));
        }
        break;
      }
      const next = await getCloudPending(active.id);
      if (!next || next.savedAt === generation) break;
    }
  } finally {
    syncing = false;
  }
}

/**
 * Stage the exported File locally, then flush to Appwrite in the background.
 * Returns true when the local write succeeded (diskWriter should not download).
 */
export async function writeCloudWorkbook(file: File): Promise<boolean> {
  const active = binding;
  if (!active) return false;
  if (saving) return false;
  saving = true;
  postShellSaveState(active.id, 'saving');
  try {
    const named = new File([file], active.title, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const staged = await putCloudPending(active.id, named, {
      userId: active.userId,
      fileId: active.fileId,
      title: active.title,
    });
    if (!staged) {
      // No IndexedDB (private mode / quota): fall back to a blocking cloud write
      // so Save still reaches the account.
      const updated = await saveWorkbookBytes(active.id, named, hotSaveOptions(active));
      binding = {
        id: updated.id,
        title: updated.title,
        fileId: updated.fileId,
        userId: updated.userId,
      };
      markDocumentSaved();
      clearCloudSyncPending();
      lastCloudSaveAt = Date.now();
      failures = 0;
      postShellSaveState(updated.id, 'saved');
      return true;
    }
    markCloudSyncPending();
    markDocumentSaved();
    postShellSaveState(active.id, 'local');
    void flushCloudPending();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postShellSaveState(active.id, 'error', message);
    notify('error', `${t('cloudSaveFailed')}${message}`);
    return false;
  } finally {
    saving = false;
  }
}

export function isCloudSaveInFlight(): boolean {
  return saving || syncing;
}

async function takeCloudSnapshot(): Promise<void> {
  const active = binding;
  if (!active || saving || getReadonlyMode() || isEmbedMode()) return;
  if (!hasUnsavedChanges()) return;

  saving = true;
  postShellSaveState(active.id, 'saving');
  const startedAt = Date.now();
  try {
    const file = await requestSaveDocument('XLSX');
    const named = new File([file], active.title, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const staged = await putCloudPending(active.id, named, {
      userId: active.userId,
      fileId: active.fileId,
      title: active.title,
    });
    if (!staged) {
      const updated = await saveWorkbookBytes(active.id, named, hotSaveOptions(active));
      binding = {
        id: updated.id,
        title: updated.title,
        fileId: updated.fileId,
        userId: updated.userId,
      };
      markDocumentSaved();
      clearCloudSyncPending();
      lastCloudSaveAt = Date.now();
      lastExportMs = lastCloudSaveAt - startedAt;
      failures = 0;
      postShellSaveState(updated.id, 'saved');
      return;
    }
    markCloudSyncPending();
    markDocumentSaved();
    lastExportMs = Date.now() - startedAt;
    postShellSaveState(active.id, 'local');
    void flushCloudPending();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('already in progress')) {
      failures += 1;
      postShellSaveState(active.id, 'error', message);
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        console.warn('[cloud] autosave stopped after repeated failures:', message);
        stopCloudAutosave();
        notify('warning', t('cloudAutosaveStopped'));
      }
    }
  } finally {
    saving = false;
  }
}

function cloudTick(): void {
  if (!binding || saving) return;
  if (!hasUnsavedChanges() || getReadonlyMode()) return;
  const interval = snapshotInterval(lastExportMs);
  const sinceSave = Date.now() - lastCloudSaveAt;
  const idle = Date.now() - getLastEditAt();
  if (sinceSave < interval) return;
  if (idle < IDLE_GRACE_MS) return;
  void takeCloudSnapshot();
}

export function beginCloudAutosave(): void {
  stopCloudAutosave();
  if (typeof window === 'undefined' || isEmbedMode() || !binding) return;

  lastCloudSaveAt = Date.now();
  lastExportMs = null;
  failures = 0;

  onVisibility = (): void => {
    if (document.visibilityState !== 'hidden') return;
    if (!binding || saving) return;
    if (hasUnsavedChanges() && !getReadonlyMode()) {
      void takeCloudSnapshot();
      return;
    }
    void flushCloudPending();
  };

  document.addEventListener('visibilitychange', onVisibility);
  autosaveTimer = window.setInterval(cloudTick, TICK_MS);
  // A prior tab may have staged bytes and closed before the flush finished.
  // Arm unload until that row is gone so a second close still warns.
  void (async () => {
    if (!binding) return;
    const leftover = await getCloudPending(binding.id);
    if (leftover) markCloudSyncPending();
    await flushCloudPending();
  })();
}

export function stopCloudAutosave(): void {
  if (autosaveTimer) {
    window.clearInterval(autosaveTimer);
    autosaveTimer = 0;
  }
  if (onVisibility) {
    document.removeEventListener('visibilitychange', onVisibility);
    onVisibility = null;
  }
}

/** Re-export interval helpers so tests can assert the same duty cycle. */
export { MIN_SNAPSHOT_INTERVAL_MS, MAX_SNAPSHOT_INTERVAL_MS, SNAPSHOT_INTERVAL_MS, EXPORT_DUTY_CYCLE };
