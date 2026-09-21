/**
 * Cloud workbook binding for the editor tab.
 *
 * When `?workbook=<id>` is open, Save / Ctrl+S (file-stream → diskWriter) and
 * a dedicated autosave metronome write to Appwrite instead of (or before) the
 * local disk. Cloud save clears the unsaved dirty bit -- unlike IndexedDB
 * AutoRecover, this is a real save to the user's account.
 */
import { t } from '@ranuts/shared/i18n';
import { isEmbedMode } from './embed-mode';
import { saveWorkbookBytes, type Workbook } from './appwrite/workbooks';
import { requestSaveDocument } from './onlyoffice/save-stream';
import { getReadonlyMode } from './onlyoffice/readonly';
import { getLastEditAt, hasUnsavedChanges, markDocumentSaved } from './unsaved-guard';
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
}

let binding: CloudWorkbookBinding | null = null;
let saving = false;
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

export function bindCloudWorkbook(workbook: Pick<Workbook, 'id' | 'title' | 'fileId'>): void {
  binding = { id: workbook.id, title: workbook.title, fileId: workbook.fileId };
  stampWorkbookInUrl(workbook.id);
}

export function unbindCloudWorkbook(): void {
  stopCloudAutosave();
  binding = null;
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

/**
 * Upload the exported File to Appwrite for the bound workbook.
 * Returns true when the cloud write succeeded (so diskWriter can skip download).
 */
export async function writeCloudWorkbook(file: File): Promise<boolean> {
  const active = binding;
  if (!active) return false;
  // Another cloud write is in flight (autosave or a previous Save): do not
  // claim success, and let the caller fall through to a download rather than
  // silently drop the bytes.
  if (saving) return false;
  saving = true;
  try {
    const named = new File([file], active.title, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const updated = await saveWorkbookBytes(active.id, named, { title: active.title });
    binding = { id: updated.id, title: updated.title, fileId: updated.fileId };
    markDocumentSaved();
    lastCloudSaveAt = Date.now();
    failures = 0;
    notify('success', t('cloudSaved'));
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notify('error', `${t('cloudSaveFailed')}${message}`);
    return false;
  } finally {
    saving = false;
  }
}

export function isCloudSaveInFlight(): boolean {
  return saving;
}

async function takeCloudSnapshot(): Promise<void> {
  const active = binding;
  if (!active || saving || getReadonlyMode() || isEmbedMode()) return;
  if (!hasUnsavedChanges()) return;

  saving = true;
  const startedAt = Date.now();
  try {
    const file = await requestSaveDocument('XLSX');
    const named = new File([file], active.title, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const updated = await saveWorkbookBytes(active.id, named, { title: active.title });
    binding = { id: updated.id, title: updated.title, fileId: updated.fileId };
    markDocumentSaved();
    lastCloudSaveAt = Date.now();
    lastExportMs = lastCloudSaveAt - startedAt;
    failures = 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('already in progress')) {
      failures += 1;
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
    if (!hasUnsavedChanges() || getReadonlyMode()) return;
    void takeCloudSnapshot();
  };

  document.addEventListener('visibilitychange', onVisibility);
  autosaveTimer = window.setInterval(cloudTick, TICK_MS);
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
