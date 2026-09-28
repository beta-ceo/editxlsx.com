/**
 * Local vault workbook binding for the editor tab.
 *
 * When `?local=<id>` is open, Save / Ctrl+S and a dedicated autosave metronome
 * write the latest Office bytes into IndexedDB `editxlsx-local-vault`. No
 * network. Cloud binding and AutoRecover stay separate.
 */
import { t } from '@ranuts/shared/i18n';
import { isEmbedMode } from './embed-mode';
import { formatFromTitle, mimeForFormat, type VaultFormat } from './appwrite/ids';
import { saveLocalVaultBytes, type LocalWorkbook } from './local-vault';
import { requestSaveDocument } from './onlyoffice/save-stream';
import { getReadonlyMode } from './onlyoffice/readonly';
import { postShellSaveState } from './shell-bridge';
import { getLastEditAt, hasUnsavedChanges, markDocumentSaved } from './unsaved-guard';
import {
  IDLE_GRACE_MS,
  MAX_CONSECUTIVE_FAILURES,
  TICK_MS,
  snapshotInterval,
} from './history/autosave';

export interface LocalWorkbookBinding {
  id: string;
  title: string;
  format: VaultFormat;
}

let binding: LocalWorkbookBinding | null = null;
let saving = false;
let autosaveTimer = 0;
let lastLocalSaveAt = 0;
let lastExportMs: number | null = null;
let failures = 0;
let onVisibility: (() => void) | null = null;

function bindingFormat(active: LocalWorkbookBinding): VaultFormat {
  return active.format || formatFromTitle(active.title) || 'xlsx';
}

function bindingMime(active: LocalWorkbookBinding): string {
  return mimeForFormat(bindingFormat(active));
}

export function getLocalWorkbookBinding(): LocalWorkbookBinding | null {
  return binding;
}

export function isLocalWorkbookBound(): boolean {
  return binding !== null;
}

export function bindLocalWorkbook(
  workbook: Pick<LocalWorkbook, 'id' | 'title'> & { format?: VaultFormat },
): void {
  binding = {
    id: workbook.id,
    title: workbook.title,
    format: workbook.format || formatFromTitle(workbook.title) || 'xlsx',
  };
  stampLocalInUrl(workbook.id);
}

export function unbindLocalWorkbook(): void {
  stopLocalAutosave();
  binding = null;
}

/** Keep `?local=<id>` in the address bar; drop one-shot open params. */
export function stampLocalInUrl(localId: string): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (url.searchParams.get('local') === localId) return;
  url.searchParams.set('local', localId);
  url.searchParams.delete('workbook');
  url.searchParams.delete('open');
  url.searchParams.delete('saved');
  url.searchParams.delete('new');
  window.history.replaceState(null, '', url);
}

function notify(kind: 'success' | 'error' | 'warning', message: string): void {
  const api = (window as unknown as { message?: Record<string, ((msg: string) => void) | undefined> }).message;
  api?.[kind]?.(message);
}

function setChip(state: 'saving' | 'saved' | 'error', message?: string): void {
  const active = binding;
  if (!active) return;
  postShellSaveState(active.id, state === 'saved' ? 'saved' : state, message);
}

/**
 * Persist the current document into the local vault. Returns false when there
 * is no binding (caller should fall through to disk / download).
 */
export async function writeLocalWorkbook(file?: File): Promise<boolean> {
  const active = binding;
  if (!active) return false;
  if (isEmbedMode() || getReadonlyMode()) return false;
  if (saving) return true;

  saving = true;
  setChip('saving');
  const exportStarted = performance.now();
  try {
    const exported = file || (await requestSaveDocument(bindingFormat(active).toUpperCase()));
    lastExportMs = performance.now() - exportStarted;
    const named =
      exported.name === active.title
        ? exported
        : new File([exported], active.title, { type: bindingMime(active) });
    await saveLocalVaultBytes(active.id, named, active.title);
    markDocumentSaved();
    lastLocalSaveAt = Date.now();
    failures = 0;
    setChip('saved', t('localSaveStatusSaved'));
    return true;
  } catch (error) {
    failures += 1;
    const detail = error instanceof Error ? error.message : String(error);
    setChip('error', detail);
    notify('error', `${t('localSaveFailed')}${detail}`);
    return false;
  } finally {
    saving = false;
  }
}

export function beginLocalAutosave(): void {
  stopLocalAutosave();
  if (!binding || isEmbedMode() || getReadonlyMode()) return;

  const tick = (): void => {
    if (!binding || saving) return;
    if (!hasUnsavedChanges()) return;
    if (failures >= MAX_CONSECUTIVE_FAILURES) return;

    const dirtyAt = getLastEditAt();
    if (!dirtyAt) return;
    const idleMs = Date.now() - dirtyAt;
    if (idleMs < IDLE_GRACE_MS) return;

    const interval = snapshotInterval(lastExportMs);
    if (Date.now() - lastLocalSaveAt < interval) return;

    void writeLocalWorkbook();
  };

  autosaveTimer = window.setInterval(tick, TICK_MS);
  onVisibility = () => {
    if (document.visibilityState === 'hidden') tick();
  };
  document.addEventListener('visibilitychange', onVisibility);
}

export function stopLocalAutosave(): void {
  if (autosaveTimer) {
    window.clearInterval(autosaveTimer);
    autosaveTimer = 0;
  }
  if (onVisibility) {
    document.removeEventListener('visibilitychange', onVisibility);
    onVisibility = null;
  }
}

/** Test seam. */
export function resetLocalWorkbookForTests(): void {
  stopLocalAutosave();
  binding = null;
  saving = false;
  lastLocalSaveAt = 0;
  lastExportMs = null;
  failures = 0;
}
