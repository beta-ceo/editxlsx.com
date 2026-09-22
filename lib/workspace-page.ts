/**
 * /workspace -- cloud workbook shell: sidebar library and the editor beside it.
 *
 * Requires a signed-in session; anonymous visitors are sent to /login.
 * The editor runs in a same-origin iframe (`?shell=1`) so Save still writes
 * to the account. See `isAppShellFrame`.
 */
import 'ranui/button';
import 'ranui/input';
import 'ranui/message';
import { Div, View } from 'ranui/builder';
import { getTheme, initTheme, setTheme, type RanThemeName } from 'ranui/theme';
import '../styles/workspace.css';
import { applyDocumentLanguage, getLanguage, t, withLocale } from '@ranuts/shared/i18n';
import { getCurrentUser, signOut, type AuthUser } from './appwrite/auth';
import { createBlankFile, createFolder, createWorkbookFromFile, deleteVaultItem, ensureFormatName, isUnderFolder, listVaultItems, placeVaultItem, renameVaultItem, reorderVaultSiblings, compareVaultOrder, nextSortOrder, type VaultItem, type Workbook } from './appwrite/workbooks';
import type { VaultFormat } from './appwrite/ids';
import { formatFromTitle } from './appwrite/ids';
import { confirmDialog } from './confirm-dialog';
import { isShellBridgeMessage, SHELL_FAILED, SHELL_READY, SHELL_SAVE_STATE } from './shell-bridge';
import type { ShellSaveState } from './shell-bridge';

const SEARCH_DEBOUNCE_MS = 200;
/** Visual scale for the sidebar meter. The client has no account quota. */
const STORAGE_SCALE_BYTES = 1024 * 1024 * 1024;
/** Give up waiting for shell:workbook-ready / shell:workbook-failed. */
const OPEN_TIMEOUT_MS = 90_000;
/**
 * After the iframe `load`s, poll for the editor bundle having evaluated
 * (`opening-document` / `embed-mode` on body). A Vite 504 on a stale
 * optimized dep leaves a blank document forever; one remount usually cures it.
 * Slow but healthy cold starts must beat this window, so it is deliberately
 * longer than a typical module-graph fetch.
 */
const BOOT_POLL_MS = 500;
const BOOT_GIVE_UP_MS = 15_000;
const BOOT_AUTO_RETRIES = 1;

const LOCALES: Array<{ code: string; label: string }> = [
  { code: 'de', label: 'Deutsch' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'zh-CN', label: '中文' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
];

let query = '';
let searchTimer = 0;
let user: AuthUser | null = null;
let rows: VaultItem[] = [];
let loading = true;
let selectedId = '';
/** '' = vault root. New actions land here; tree highlights this folder. */
let currentFolderId = '';
/** Folder ids whose children are visible in the sidebar tree. */
const expandedFolderIds = new Set<string>();
/** Inline rename target in the sidebar tree ('' = not renaming). */
let renamingId = '';
/** HTML5 DnD: id being dragged (tree mode only). */
let dragId = '';
type DropMode = 'before' | 'after' | 'into';
let dropHint: { targetId: string; mode: DropMode } | null = null;
let openWorkbook: Workbook | null = null;
let shellReady = false;
/** Editor pane while a framed workbook is opening. */
let stageStatus: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
let stageError = '';
let bridgeListening = false;
/** Sync chip: icon for saving / local / synced / error (label in title). */
let saveStatus: ShellSaveState | 'idle' = 'idle';
let saveStatusError = '';
let saveStatusTimer = 0;
/** Bumps on every framed open so stale timers / load handlers stay inert. */
let openGeneration = 0;
let openTimer = 0;
let bootTimer = 0;
let bootRetries = 0;
let frameLoadHandler: (() => void) | null = null;

function root(): HTMLElement {
  return document.getElementById('workspace-root') as HTMLElement;
}

function loginUrl(): string {
  const locale = new URLSearchParams(window.location.search).get('locale');
  return locale ? `/login?locale=${encodeURIComponent(locale)}` : '/login';
}

function editorFrameUrl(workbookId: string, bootToken?: number): string {
  const base = withLocale(`/editor?workbook=${encodeURIComponent(workbookId)}&shell=1`, getLanguage());
  return typeof bootToken === 'number' ? `${base}&_boot=${bootToken}` : base;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function formatEditedWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(getLanguage(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function currentFolderTitle(): string {
  if (!currentFolderId) return t('cloudAllDocuments');
  return rows.find((row) => row.id === currentFolderId)?.title || t('cloudFilesTitle');
}

function notifyError(message: string): void {
  (window as unknown as { message?: { error?: (msg: string) => void } }).message?.error?.(message);
}

function clearOpenWatchers(): void {
  if (openTimer) {
    window.clearTimeout(openTimer);
    openTimer = 0;
  }
  if (bootTimer) {
    window.clearTimeout(bootTimer);
    bootTimer = 0;
  }
  const frame = document.getElementById('workspace-editor-frame') as HTMLIFrameElement | null;
  if (frame && frameLoadHandler) {
    frame.removeEventListener('load', frameLoadHandler);
    frameLoadHandler = null;
  }
}

function editorBundleBooted(frame: HTMLIFrameElement): boolean {
  try {
    const body = frame.contentDocument?.body;
    if (!body) return false;
    // index.ts adds these synchronously once the module graph evaluates.
    return body.classList.contains('opening-document') || body.classList.contains('embed-mode');
  } catch {
    return false;
  }
}

function failOpen(workbookId: string, message: string): void {
  if (selectedId !== workbookId || stageStatus !== 'loading') return;
  clearOpenWatchers();
  stageStatus = 'error';
  stageError = message;
  notifyError(`${t('cloudOpenFailed')}${message}`);
  paintOverlay();
}

function remountEditorFrame(frame: HTMLIFrameElement, workbookId: string): void {
  stageStatus = 'loading';
  stageError = '';
  frame.dataset.workbook = workbookId;
  frame.title = rows.find((row) => row.id === workbookId)?.title || workbookId;
  // Bust the URL so the browser remounts even when workbook+shell are unchanged.
  // Attach the load watcher before assigning src so a cached document cannot
  // finish loading before we are listening.
  watchEditorOpen(frame, workbookId, { preserveRetries: true });
  frame.src = editorFrameUrl(workbookId, Date.now());
  paintOverlay();
}

function watchEditorOpen(
  frame: HTMLIFrameElement,
  workbookId: string,
  options: { preserveRetries?: boolean } = {},
): void {
  clearOpenWatchers();
  const generation = ++openGeneration;
  if (!options.preserveRetries) bootRetries = 0;

  openTimer = window.setTimeout(() => {
    if (generation !== openGeneration) return;
    failOpen(workbookId, t('cloudOpenTimedOut'));
  }, OPEN_TIMEOUT_MS);

  frameLoadHandler = () => {
    if (generation !== openGeneration) return;
    if (bootTimer) window.clearTimeout(bootTimer);
    const startedAt = Date.now();
    const pollBoot = (): void => {
      if (generation !== openGeneration) return;
      if (selectedId !== workbookId || stageStatus !== 'loading') return;
      // Module graph evaluated: still waiting for shell:workbook-ready (download /
      // OnlyOffice). Do not treat that as a boot failure.
      if (editorBundleBooted(frame)) return;
      if (Date.now() - startedAt < BOOT_GIVE_UP_MS) {
        bootTimer = window.setTimeout(pollBoot, BOOT_POLL_MS);
        return;
      }
      if (bootRetries < BOOT_AUTO_RETRIES) {
        bootRetries += 1;
        remountEditorFrame(frame, workbookId);
        return;
      }
      failOpen(workbookId, t('cloudOpenBootFailed'));
    };
    bootTimer = window.setTimeout(pollBoot, BOOT_POLL_MS);
  };
  frame.addEventListener('load', frameLoadHandler);
}

function selectedWorkbook(): Workbook | undefined {
  const found = rows.find((row) => row.id === selectedId);
  if (found?.kind === 'file' && found.format) {
    openWorkbook = found as Workbook;
  } else if (!selectedId) {
    openWorkbook = null;
  }
  return openWorkbook?.id === selectedId ? openWorkbook : undefined;
}

function syncUrl(): void {
  const url = new URL(window.location.href);
  if (query) url.searchParams.set('q', query);
  else url.searchParams.delete('q');
  if (selectedId) url.searchParams.set('workbook', selectedId);
  else url.searchParams.delete('workbook');
  if (currentFolderId) url.searchParams.set('folder', currentFolderId);
  else url.searchParams.delete('folder');
  window.history.replaceState(null, '', url);
}

function readUrl(): void {
  const params = new URLSearchParams(window.location.search);
  query = params.get('q') ?? '';
  selectedId = params.get('workbook') ?? '';
  currentFolderId = params.get('folder') ?? '';
}

function rememberLocale(locale: string): void {
  try {
    document.cookie = `locale=${encodeURIComponent(locale)};path=/;max-age=31536000;samesite=lax`;
  } catch {
    /* The URL still carries the language. */
  }
}

function svgIcon(path: string, className = 'vault-icon'): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shape.setAttribute('d', path);
  shape.setAttribute('fill', 'none');
  shape.setAttribute('stroke', 'currentColor');
  shape.setAttribute('stroke-width', '1.7');
  shape.setAttribute('stroke-linecap', 'round');
  shape.setAttribute('stroke-linejoin', 'round');
  svg.append(shape);
  return svg;
}

/** Multi-path stroke icon (sync chip). Same visual language as `svgIcon`. */
function svgIconPaths(paths: string[], className: string): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);
  for (const d of paths) {
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', d);
    shape.setAttribute('fill', 'none');
    shape.setAttribute('stroke', 'currentColor');
    shape.setAttribute('stroke-width', '1.7');
    shape.setAttribute('stroke-linecap', 'round');
    shape.setAttribute('stroke-linejoin', 'round');
    svg.append(shape);
  }
  return svg;
}

/** Sync chip glyph: icon carries the state; label is title / aria only. */
function syncStatusIcon(state: ShellSaveState): SVGElement {
  if (state === 'saving') {
    // Partial ring — CSS spins the whole glyph while exporting.
    return svgIconPaths(['M12 3a9 9 0 1 1-6.36 2.64'], 'vault-icon vault-sync-icon is-spinning');
  }
  if (state === 'local') {
    // Cloud + upload arrow: on this device, account upload still in flight.
    return svgIconPaths(
      [
        'M7 18h9.5a3.5 3.5 0 0 0 .5-6.97 5 5 0 0 0-9.7-1.53A3.5 3.5 0 0 0 7 18z',
        'M12 16V10M9.5 12.5 12 10l2.5 2.5',
      ],
      'vault-icon vault-sync-icon',
    );
  }
  if (state === 'saved') {
    // Cloud + check: Appwrite has the revision.
    return svgIconPaths(
      [
        'M7 18h9.5a3.5 3.5 0 0 0 .5-6.97 5 5 0 0 0-9.7-1.53A3.5 3.5 0 0 0 7 18z',
        'M9.5 13.5 11.5 15.5 15 12',
      ],
      'vault-icon vault-sync-icon',
    );
  }
  // Warning triangle.
  return svgIconPaths(
    [
      'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
      'M12 9v4M12 17h.01',
    ],
    'vault-icon vault-sync-icon',
  );
}

function iconSlot(path: string, className?: string): HTMLElement {
  const slot = document.createElement('span');
  const icon = svgIcon(path);
  if (className) icon.classList.add(className);
  slot.append(icon);
  return slot;
}

const THEME_OPTIONS: Array<{ id: RanThemeName; label: string; icon: string }> = [
  {
    id: 'system',
    label: 'System',
    icon: 'M4 5h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5zM8 19h8M12 16v3',
  },
  {
    id: 'light',
    label: 'Light',
    icon: 'M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4l1.4-1.4M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  },
  {
    id: 'dark',
    label: 'Dark',
    icon: 'M21 14.3A8.5 8.5 0 1 1 9.7 3a7 7 0 0 0 11.3 11.3z',
  },
];

function currentTheme(): RanThemeName {
  const stored = getTheme();
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}

function themeIconPath(theme: RanThemeName): string {
  return THEME_OPTIONS.find((item) => item.id === theme)?.icon ?? THEME_OPTIONS[0].icon;
}

function initials(account: AuthUser): string {
  const source = account.name?.trim() || account.email || '?';
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const second = parts[1]?.[0] ?? '';
  return `${first}${second}`.toUpperCase();
}

function displayName(account: AuthUser): string {
  return account.name?.trim() || account.email || t('cloudWorkspaceMine');
}

async function refresh(): Promise<void> {
  loading = true;
  renamingId = '';
  paint();
  try {
    rows = await listVaultItems({ search: query });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notifyError(message);
    rows = [];
  } finally {
    loading = false;
    if (currentFolderId && !rows.some((row) => row.id === currentFolderId && row.kind === 'folder')) {
      currentFolderId = '';
    }
    if (selectedId) {
      const selected = rows.find((row) => row.id === selectedId);
      if (!selected || selected.kind !== 'file') {
        selectedId = '';
        openWorkbook = null;
        stageStatus = 'idle';
        stageError = '';
        clearOpenWatchers();
      } else if (!query) {
        currentFolderId = selected.parentId || '';
      }
    }
    revealTreeSelection();
    syncUrl();
    paint();
  }
}

function childrenOf(parentId: string): VaultItem[] {
  return rows.filter((row) => (row.parentId || '') === parentId).sort(compareVaultOrder);
}

/** Expand ancestors so `itemId` is reachable; when `includeSelf`, also expand that folder. */
function expandAncestors(itemId: string, includeSelf = false): void {
  const item = rows.find((row) => row.id === itemId);
  if (!item) return;
  if (includeSelf && item.kind === 'folder') expandedFolderIds.add(item.id);
  let parentId = item.parentId || '';
  const seen = new Set<string>();
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    expandedFolderIds.add(parentId);
    parentId = rows.find((row) => row.id === parentId)?.parentId || '';
  }
}

function revealTreeSelection(): void {
  if (selectedId) expandAncestors(selectedId);
  if (currentFolderId) expandAncestors(currentFolderId, true);
}

function toggleFolderExpanded(id: string): void {
  if (expandedFolderIds.has(id)) expandedFolderIds.delete(id);
  else expandedFolderIds.add(id);
  paintDocs();
}

function selectWorkbook(id: string): void {
  const same = selectedId === id;
  // Same row while stuck on loading/error: force a remount. The first framed
  // navigation can leave a blank editor (Vite 504 on a stale optimized dep)
  // that never posts shell:workbook-ready; without this, clicking the current
  // item is a no-op and the overlay spins forever.
  if (!same || stageStatus === 'loading' || stageStatus === 'error') {
    stageStatus = 'loading';
    stageError = '';
    if (same) {
      const frame = document.getElementById('workspace-editor-frame') as HTMLIFrameElement | null;
      if (frame) frame.dataset.workbook = '';
      clearOpenWatchers();
    }
  }
  if (!same) setSaveStatus('idle');
  selectedId = id;
  const item = rows.find((row) => row.id === id);
  if (item?.kind === 'file') currentFolderId = item.parentId || '';
  revealTreeSelection();
  syncUrl();
  paint();
}

function openFolder(id: string): void {
  currentFolderId = id;
  selectedId = '';
  openWorkbook = null;
  stageStatus = 'idle';
  stageError = '';
  setSaveStatus('idle');
  clearOpenWatchers();
  expandedFolderIds.add(id);
  expandAncestors(id);
  syncUrl();
  paint();
}

async function onNewFile(format: VaultFormat): Promise<void> {
  try {
    const sortOrder = nextSortOrder(childrenOf(currentFolderId));
    const workbook = await createBlankFile(format, { parentId: currentFolderId, sortOrder });
    rows = [workbook, ...rows.filter((row) => row.id !== workbook.id)];
    stageStatus = 'loading';
    stageError = '';
    selectedId = workbook.id;
    if (currentFolderId) expandedFolderIds.add(currentFolderId);
    revealTreeSelection();
    syncUrl();
    paint();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notifyError(message);
  }
}

async function onNewFolder(): Promise<void> {
  try {
    if (currentFolderId) expandedFolderIds.add(currentFolderId);
    const sortOrder = nextSortOrder(childrenOf(currentFolderId));
    const folder = await createFolder(t('cloudFolderUntitled'), currentFolderId, sortOrder);
    rows = [folder, ...rows.filter((row) => row.id !== folder.id)];
    openFolder(folder.id);
    startRename(folder.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notifyError(message);
  }
}

function pickUploadFiles(): void {
  const input = document.getElementById('workspace-upload-input') as HTMLInputElement | null;
  if (!input) return;
  input.value = '';
  input.click();
}

type DroppedUpload = { file: File; relativeDir: string };

type FileSystemEntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file: (ok: (file: File) => void, err?: (error: DOMException) => void) => void;
  createReader: () => {
    readEntries: (
      ok: (entries: FileSystemEntryLike[]) => void,
      err?: (error: DOMException) => void,
    ) => void;
  };
};

function readEntryFile(entry: FileSystemEntryLike): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

function readDirectoryEntries(
  reader: ReturnType<FileSystemEntryLike['createReader']>,
): Promise<FileSystemEntryLike[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntryLike[] = [];
    const pump = (): void => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(all);
            return;
          }
          all.push(...batch);
          pump();
        },
        reject,
      );
    };
    pump();
  });
}

async function collectFromFileEntry(
  entry: FileSystemEntryLike,
  relativeDir: string,
): Promise<DroppedUpload[]> {
  if (entry.isFile) {
    const file = await readEntryFile(entry);
    return [{ file, relativeDir }];
  }
  if (!entry.isDirectory) return [];
  const childDir = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
  const kids = await readDirectoryEntries(entry.createReader());
  const out: DroppedUpload[] = [];
  for (const kid of kids) {
    // Skip dotted junk (.DS_Store, __MACOSX, …) at every level.
    if (kid.name.startsWith('.')) continue;
    out.push(...(await collectFromFileEntry(kid, childDir)));
  }
  return out;
}

/** Flatten OS file/folder drops. Entries must be snapshotted sync in the drop handler. */
async function expandDroppedEntries(entries: FileSystemEntryLike[]): Promise<DroppedUpload[]> {
  const out: DroppedUpload[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    out.push(...(await collectFromFileEntry(entry, '')));
  }
  return out;
}

function filesFromDataTransfer(dataTransfer: DataTransfer): DroppedUpload[] {
  return [...dataTransfer.files].map((file) => {
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath || '';
    const parts = relative.split('/').filter(Boolean);
    if (parts.length > 1) parts.pop();
    else parts.length = 0;
    return { file, relativeDir: parts.join('/') };
  });
}

/**
 * Capture drop payload synchronously during the `drop` event.
 * `webkitGetAsEntry()` returns null for later items if called after any await.
 */
function captureDropPayload(dataTransfer: DataTransfer): {
  entries: FileSystemEntryLike[];
  files: DroppedUpload[];
} {
  const entries: FileSystemEntryLike[] = [];
  for (const item of dataTransfer.items) {
    if (item.kind !== 'file') continue;
    const asEntry = (
      item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntryLike | null }
    ).webkitGetAsEntry;
    const entry = typeof asEntry === 'function' ? asEntry.call(item) : null;
    if (entry) entries.push(entry);
  }
  return {
    entries,
    files: filesFromDataTransfer(dataTransfer),
  };
}

async function ensureFolderPath(parentId: string, segments: string[]): Promise<string> {
  let cursor = parentId;
  for (const raw of segments) {
    const name = raw.trim();
    if (!name) continue;
    let folder = rows.find(
      (row) => row.kind === 'folder' && (row.parentId || '') === cursor && row.title === name,
    );
    if (!folder) {
      const sortOrder = nextSortOrder(childrenOf(cursor));
      folder = await createFolder(name, cursor, sortOrder);
      rows = [folder, ...rows.filter((row) => row.id !== folder!.id)];
    }
    if (cursor) expandedFolderIds.add(cursor);
    expandedFolderIds.add(folder.id);
    cursor = folder.id;
  }
  return cursor;
}

let uploadBusy = false;
/** Live upload progress for the stage progress bar (`null` = hidden). */
let uploadProgress: { current: number; total: number; name: string } | null = null;
let uploadDoneTimer = 0;

function setUploadButtonsDisabled(disabled: boolean): void {
  const uploadBtn = document.getElementById('workspace-stage-upload') as HTMLButtonElement | null;
  if (uploadBtn) uploadBtn.disabled = disabled;
}

function paintUploadProgress(): void {
  const bar = document.getElementById('workspace-upload-progress');
  const label = document.getElementById('workspace-upload-progress-label');
  const fill = document.getElementById('workspace-upload-progress-fill');
  if (!bar || !label || !fill) return;
  if (!uploadProgress) {
    bar.hidden = true;
    bar.dataset.state = '';
    label.textContent = '';
    fill.style.width = '0%';
    return;
  }
  bar.hidden = false;
  const { current, total, name } = uploadProgress;
  const done = current >= total && total > 0 && !uploadBusy;
  bar.dataset.state = done ? 'done' : 'active';
  label.textContent = done
    ? t('cloudUploadDone', { count: String(total) })
    : t('cloudUploadProgress', {
        current: String(Math.min(current, total)),
        total: String(total),
        name,
      });
  const ratio = total <= 0 ? 0 : Math.min(1, current / total);
  fill.style.width = `${Math.round(ratio * 1000) / 10}%`;
}

async function onUploadFiles(fileList: FileList | null): Promise<void> {
  if (!fileList || fileList.length === 0) return;
  await uploadOfficeItems([...fileList].map((file) => ({ file, relativeDir: '' })), currentFolderId);
}

async function onDropUpload(
  payload: { entries: FileSystemEntryLike[]; files: DroppedUpload[] } | null,
  parentId = currentFolderId,
): Promise<void> {
  if (!payload) return;
  const items =
    payload.entries.length > 0 ? await expandDroppedEntries(payload.entries) : payload.files;
  await uploadOfficeItems(items, parentId);
}

async function uploadOfficeItems(items: DroppedUpload[], baseParentId: string): Promise<void> {
  if (uploadBusy || items.length === 0) return;
  const queue = items.filter((item) => formatFromTitle(item.file.name));
  const skipped = items.length - queue.length;
  if (queue.length === 0) {
    if (skipped > 0) notifyError(t('cloudUploadTypeError'));
    return;
  }

  uploadBusy = true;
  setUploadButtonsDisabled(true);
  if (uploadDoneTimer) {
    window.clearTimeout(uploadDoneTimer);
    uploadDoneTimer = 0;
  }
  uploadProgress = { current: 0, total: queue.length, name: queue[0]?.file.name || '' };
  paintUploadProgress();

  let uploaded = 0;
  try {
    // Stay on the folder browser; never auto-open an uploaded file.
    selectedId = '';
    openWorkbook = null;
    stageStatus = 'idle';
    stageError = '';
    clearOpenWatchers();
    currentFolderId = baseParentId;
    if (baseParentId) expandedFolderIds.add(baseParentId);
    syncUrl();
    paint();
    paintUploadProgress();

    for (const { file, relativeDir } of queue) {
      uploadProgress = {
        current: uploaded,
        total: queue.length,
        name: file.name,
      };
      paintUploadProgress();
      const segments = relativeDir.split('/').filter(Boolean);
      const parentId = await ensureFolderPath(baseParentId, segments);
      const sortOrder = nextSortOrder(childrenOf(parentId));
      const workbook = await createWorkbookFromFile(file, file.name, parentId, sortOrder);
      rows = [workbook, ...rows.filter((row) => row.id !== workbook.id)];
      uploaded += 1;
      uploadProgress = { current: uploaded, total: queue.length, name: file.name };
      paintUploadProgress();
      paintDocs();
      paintStorage();
      if (!selectedWorkbook()) paintStage();
      paintUploadProgress();
    }

    revealTreeSelection();
    syncUrl();
    paint();
    uploadProgress = { current: uploaded, total: uploaded, name: '' };
    paintUploadProgress();
    uploadDoneTimer = window.setTimeout(() => {
      uploadProgress = null;
      paintUploadProgress();
      uploadDoneTimer = 0;
    }, 2_400);
  } catch (error) {
    uploadProgress = null;
    paintUploadProgress();
    const message = error instanceof Error ? error.message : String(error);
    notifyError(message);
    paint();
  } finally {
    uploadBusy = false;
    setUploadButtonsDisabled(false);
  }
}

function isExternalFileDrag(event: DragEvent): boolean {
  if (dragId || uploadBusy) return false;
  return Boolean(event.dataTransfer?.types.includes('Files'));
}

function dropTargetFolderId(event: DragEvent, fallback: string): string {
  const row = (event.target as Element | null)?.closest?.('.vault-stage-browser-row[data-kind="folder"]');
  const id = row instanceof HTMLElement ? row.dataset.id : '';
  return id || fallback;
}

function setStageFileDropActive(active: boolean, folderRow: HTMLElement | null = null): void {
  const emptyStage = document.getElementById('workspace-stage-empty');
  const overlay = document.getElementById('workspace-stage-drop-overlay');
  if (!emptyStage) return;
  emptyStage.classList.toggle('is-drop-target', active);
  if (overlay) {
    overlay.hidden = !active;
    overlay.setAttribute('aria-hidden', active ? 'false' : 'true');
  }
  emptyStage.querySelectorAll('.vault-stage-browser-row.is-file-drop').forEach((el) => {
    el.classList.remove('is-file-drop');
  });
  if (active && folderRow) folderRow.classList.add('is-file-drop');
}

function startRename(id: string): void {
  if (!rows.some((row) => row.id === id)) return;
  renamingId = id;
  closeNewMenu();
  paintDocs();
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLInputElement>(
      `.vault-tree-rename[data-id="${CSS.escape(id)}"]`,
    );
    if (!input) return;
    input.focus();
    const item = rows.find((row) => row.id === id);
    if (item?.kind === 'file' && item.format) {
      const suffix = `.${item.format}`;
      const end = item.title.toLowerCase().endsWith(suffix) ? item.title.length - suffix.length : item.title.length;
      input.setSelectionRange(0, Math.max(0, end));
    } else {
      input.select();
    }
  });
}

function cancelRename(): void {
  if (!renamingId) return;
  renamingId = '';
  paintDocs();
}

async function commitRename(id: string, raw: string): Promise<void> {
  if (renamingId !== id) return;
  renamingId = '';
  const item = rows.find((row) => row.id === id);
  if (!item) {
    paintDocs();
    return;
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed === item.title) {
    paintDocs();
    return;
  }
  const nextTitle =
    item.kind === 'folder' ? trimmed : ensureFormatName(trimmed, item.format || 'xlsx');
  if (nextTitle === item.title) {
    paintDocs();
    return;
  }

  // Optimistic: leave the input immediately; sync Appwrite in the background.
  const previous = item;
  const optimistic: VaultItem = { ...item, title: nextTitle };
  rows = rows.map((row) => (row.id === id ? optimistic : row));
  if (selectedId === id) {
    openWorkbook = optimistic.kind === 'file' && optimistic.format ? (optimistic as Workbook) : openWorkbook;
    document.title = nextTitle;
    const frame = document.getElementById('workspace-editor-frame') as HTMLIFrameElement | null;
    if (frame?.dataset.workbook === id) frame.title = nextTitle;
  }
  paintDocs();

  try {
    const updated = await renameVaultItem(id, nextTitle, {
      kind: item.kind,
      format: item.format,
      title: item.title,
    });
    rows = rows.map((row) => (row.id === id ? updated : row));
  } catch (error) {
    rows = rows.map((row) => (row.id === id ? previous : row));
    if (selectedId === id) {
      openWorkbook = previous.kind === 'file' && previous.format ? (previous as Workbook) : openWorkbook;
      document.title = previous.title;
      const frame = document.getElementById('workspace-editor-frame') as HTMLIFrameElement | null;
      if (frame?.dataset.workbook === id) frame.title = previous.title;
    }
    const message = error instanceof Error ? error.message : String(error);
    notifyError(`${t('cloudRenameFailed')}${message}`);
    paintDocs();
  }
}

async function deleteItem(id: string): Promise<void> {
  closeContextMenu();
  closeNewMenu();
  const item = rows.find((row) => row.id === id);
  if (!item) return;
  const ok = await confirmDialog({
    title: t('cloudDeleteTitle', { title: item.title }),
    body: t('cloudDeleteConfirm', { title: item.title }),
    confirmLabel: t('cloudDelete'),
    cancelLabel: t('cloudCancel'),
    danger: true,
  });
  if (!ok) return;
  try {
    await deleteVaultItem(id);
    rows = rows.filter((row) => row.id !== id);
    expandedFolderIds.delete(id);
    if (selectedId === id) {
      selectedId = '';
      openWorkbook = null;
      stageStatus = 'idle';
      stageError = '';
      setSaveStatus('idle');
      clearOpenWatchers();
    }
    if (currentFolderId === id) {
      currentFolderId = item.parentId || '';
    }
    syncUrl();
    paint();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notifyError(/not empty/i.test(message) ? t('cloudFolderNotEmpty') : message);
  }
}

function closeContextMenu(): void {
  const menu = document.getElementById('workspace-context-menu');
  if (!menu) return;
  menu.classList.remove('is-shown');
  menu.hidden = true;
  menu.style.top = '';
  menu.style.left = '';
  delete menu.dataset.itemId;
  document.removeEventListener('pointerdown', onContextMenuPointerDown, true);
  document.removeEventListener('keydown', onContextMenuKeyDown, true);
}

function onContextMenuPointerDown(event: PointerEvent): void {
  const menu = document.getElementById('workspace-context-menu');
  const target = event.target as Node | null;
  if (!menu || !target) return;
  if (menu.contains(target)) return;
  closeContextMenu();
}

function onContextMenuKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeContextMenu();
  }
}

function openContextMenu(item: VaultItem, clientX: number, clientY: number): void {
  closeNewMenu();
  closeContextMenu();
  const menu = document.getElementById('workspace-context-menu');
  if (!menu) return;
  menu.dataset.itemId = item.id;
  menu.hidden = false;
  menu.classList.remove('is-shown');

  const width = 180;
  let left = clientX;
  let top = clientY;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  menu.style.width = `${width}px`;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  document.addEventListener('pointerdown', onContextMenuPointerDown, true);
  document.addEventListener('keydown', onContextMenuKeyDown, true);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (menu.hidden) return;
      const height = menu.getBoundingClientRect().height;
      if (top + height > window.innerHeight - 8) {
        top = Math.max(8, clientY - height);
        menu.style.top = `${top}px`;
      }
      menu.classList.add('is-shown');
    });
  });
}

function buildContextMenu(): HTMLElement {
  const menu = document.createElement('div');
  menu.id = 'workspace-context-menu';
  menu.className = 'vault-context-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'vault-context-option is-danger';
  deleteBtn.setAttribute('role', 'menuitem');
  deleteBtn.append(
    svgIcon('M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12'),
    document.createTextNode(t('cloudDelete')),
  );
  deleteBtn.addEventListener('click', () => {
    const id = menu.dataset.itemId;
    if (id) void deleteItem(id);
  });
  menu.append(deleteBtn);
  return menu;
}

function newMenuOption(
  iconPath: string,
  label: string,
  onClick: () => void,
  tone: 'workbook' | 'document' | 'presentation' | 'folder',
): HTMLButtonElement {
  const option = document.createElement('button');
  option.type = 'button';
  option.className = `vault-new-option is-${tone}`;
  option.append(svgIcon(iconPath), document.createTextNode(label));
  option.addEventListener('click', onClick);
  return option;
}

function closeNewMenu(): void {
  const menu = document.getElementById('workspace-new-menu');
  if (menu) {
    menu.classList.remove('is-shown');
    menu.hidden = true;
    menu.style.top = '';
    menu.style.left = '';
    menu.style.width = '';
    delete menu.dataset.anchor;
  }
  document.getElementById('workspace-new')?.setAttribute('aria-expanded', 'false');
  document.getElementById('workspace-stage-new')?.setAttribute('aria-expanded', 'false');
  document.querySelectorAll<HTMLElement>('.vault-tree-add[aria-expanded="true"]').forEach((el) => {
    el.setAttribute('aria-expanded', 'false');
  });
  document.removeEventListener('pointerdown', onNewMenuPointerDown, true);
  document.removeEventListener('keydown', onNewMenuKeyDown, true);
}

function onNewMenuPointerDown(event: PointerEvent): void {
  const menu = document.getElementById('workspace-new-menu');
  const target = event.target as Node | null;
  if (!menu || !target) return;
  if (menu.contains(target)) return;
  if (target instanceof Element) {
    if (target.closest('#workspace-new, #workspace-stage-new, .vault-tree-add')) return;
  }
  closeNewMenu();
}

function onNewMenuKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeNewMenu();
  }
}

/** Shared New menu: anchored under the top New button or a folder + control. */
function openNewMenuAt(anchor: HTMLElement, options: { matchWidth?: boolean; key?: string } = {}): void {
  const menu = document.getElementById('workspace-new-menu');
  const trigger = document.getElementById('workspace-new');
  if (!menu) return;

  const key = options.key || anchor.id || 'anon';
  const alreadyOpen = !menu.hidden && menu.dataset.anchor === key;
  if (alreadyOpen) {
    closeNewMenu();
    return;
  }

  closeNewMenu();
  menu.dataset.anchor = key;
  menu.hidden = false;
  menu.classList.remove('is-shown');

  const rect = anchor.getBoundingClientRect();
  const width = options.matchWidth ? Math.max(rect.width, 200) : 220;
  let left = options.matchWidth ? rect.left : rect.right - width;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  let top = rect.bottom + 6;

  menu.style.width = `${width}px`;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  trigger?.setAttribute('aria-expanded', key === 'workspace-new' ? 'true' : 'false');
  const stageNew = document.getElementById('workspace-stage-new');
  stageNew?.setAttribute('aria-expanded', key === 'workspace-stage-new' ? 'true' : 'false');
  if (anchor.classList.contains('vault-tree-add')) {
    anchor.setAttribute('aria-expanded', 'true');
  }
  document.addEventListener('pointerdown', onNewMenuPointerDown, true);
  document.addEventListener('keydown', onNewMenuKeyDown, true);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (menu.hidden) return;
      const height = menu.getBoundingClientRect().height;
      if (top + height > window.innerHeight - 8) {
        top = Math.max(8, rect.top - height - 6);
        menu.style.top = `${top}px`;
      }
      menu.classList.add('is-shown');
    });
  });
}

function buildNewMenuPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.id = 'workspace-new-menu';
  panel.className = 'vault-new-menu';
  panel.setAttribute('role', 'menu');
  panel.hidden = true;
  const dismiss = (): void => closeNewMenu();
  panel.append(
    newMenuOption(
      'M4 4h16v16H4zM4 10h16M10 4v16',
      t('cloudNewWorkbook'),
      () => {
        dismiss();
        void onNewFile('xlsx');
      },
      'workbook',
    ),
    newMenuOption(
      'M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M9 13h6M9 17h4',
      t('cloudNewDocument'),
      () => {
        dismiss();
        void onNewFile('docx');
      },
      'document',
    ),
    newMenuOption(
      'M3 5h18v12H3zM8 21h8M12 17v4',
      t('cloudNewPresentation'),
      () => {
        dismiss();
        void onNewFile('pptx');
      },
      'presentation',
    ),
    newMenuOption(
      'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z',
      t('cloudNewFolder'),
      () => {
        dismiss();
        void onNewFolder();
      },
      'folder',
    ),
  );
  return panel;
}

/** Point New at this folder and open the menu under the + control. */
function openNewMenuForFolder(folderId: string, anchor: HTMLElement): void {
  const menu = document.getElementById('workspace-new-menu');
  const key = `folder:${folderId}`;
  if (menu && !menu.hidden && menu.dataset.anchor === key) {
    closeNewMenu();
    return;
  }
  currentFolderId = folderId;
  expandedFolderIds.add(folderId);
  expandAncestors(folderId);
  syncUrl();
  paintDocs();
  const liveAnchor =
    document.querySelector<HTMLElement>(`.vault-tree-add[data-folder="${CSS.escape(folderId)}"]`) ||
    anchor;
  openNewMenuAt(liveAnchor, { key });
}

async function onSignOut(): Promise<void> {
  await signOut();
  window.location.replace(loginUrl());
}

function button(label: string, onClick: () => void, options: { type?: string; id?: string } = {}): HTMLElement {
  const builder = View('r-button').text(label).on('click', onClick);
  if (options.id) builder.id(options.id);
  if (options.type) builder.attr('type', options.type);
  return builder.build();
}

function bone(kind: string): HTMLElement {
  const el = document.createElement('span');
  el.className = `vault-bone vault-bone-${kind}`;
  el.setAttribute('aria-hidden', 'true');
  return el;
}

function mountDocsSkeleton(host: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.className = 'vault-docs-skeleton';
  wrap.setAttribute('aria-busy', 'true');
  for (let i = 0; i < 7; i += 1) {
    const row = document.createElement('div');
    row.className = 'vault-docs-skeleton-row';
    row.style.setProperty('--vault-depth', String(i % 3 === 0 ? 0 : 1));
    row.append(bone('twist'), bone('icon'), bone('label'));
    wrap.append(row);
  }
  host.append(wrap);
}

function mountShell(): void {
  if (shellReady || !user) return;
  shellReady = true;
  initTheme();
  const account = user;
  const lang = getLanguage();

  const search = View('r-input')
    .attr('placeholder', t('cloudSearchPlaceholder'))
    .attr('value', query)
    .class('workspace-search')
    .on('change', (event) => {
      const value = (event as CustomEvent<{ value?: string }>).detail?.value ?? '';
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        query = value;
        syncUrl();
        void refresh();
      }, SEARCH_DEBOUNCE_MS);
    })
    .build();

  const langLinks = LOCALES.map((locale) => {
    const href = new URL('/workspace', window.location.origin);
    href.searchParams.set('locale', locale.code);
    const link = View('a')
      .class(locale.code === lang ? 'lang-option is-current' : 'lang-option')
      .attr('href', `${href.pathname}${href.search}`)
      .attr('lang', locale.code)
      .attr('hreflang', locale.code)
      .text(locale.label)
      .on('click', () => rememberLocale(locale.code))
      .build();
    if (locale.code === lang) link.setAttribute('aria-current', 'page');
    return link;
  });

  const langMenu = View('r-popover')
    .class('lang-menu vault-tool')
    .attr('placement', 'bottom-end')
    .attr('trigger', 'click')
    .attr('role', 'button')
    .attr('aria-label', 'Language')
    .children(
      View('span')
        .class('lang-trigger vault-tool-btn')
        .children(
          iconSlot(
            'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3.5 12h17M12 3c2.2 2.4 3.3 5.2 3.3 9s-1.1 6.6-3.3 9c-2.2-2.4-3.3-5.2-3.3-9s1.1-6.6 3.3-9z',
          ),
        )
        .build(),
      View('r-content')
        .children(
          Div()
            .class('lang-list vault-lang')
            .children(...langLinks)
            .build(),
        )
        .build(),
    )
    .build();

  const themeMenu = document.createElement('details');
  themeMenu.className = 'vault-theme vault-tool';
  const themeSummary = document.createElement('summary');
  themeSummary.className = 'vault-tool-btn';
  themeSummary.setAttribute('aria-label', 'Theme');
  const themeIconHost = document.createElement('span');
  themeIconHost.className = 'vault-theme-icon';
  const paintThemeIcon = (): void => {
    themeIconHost.replaceChildren(svgIcon(themeIconPath(currentTheme())));
  };
  paintThemeIcon();
  themeSummary.append(themeIconHost);
  const themePanel = document.createElement('div');
  themePanel.className = 'vault-theme-menu';
  const themeButtons = THEME_OPTIONS.map((option) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'vault-theme-option';
    item.dataset.theme = option.id;
    item.append(svgIcon(option.icon), document.createTextNode(option.label));
    item.addEventListener('click', () => {
      setTheme(option.id);
      paintThemeIcon();
      for (const button of themeButtons) {
        button.classList.toggle('is-current', button.dataset.theme === option.id);
      }
      themeMenu.open = false;
    });
    return item;
  });
  for (const button of themeButtons) {
    button.classList.toggle('is-current', button.dataset.theme === currentTheme());
  }
  themePanel.append(...themeButtons);
  themeMenu.append(themeSummary, themePanel);
  window.addEventListener('storage', (event) => {
    if (event.key !== 'ran-theme') return;
    paintThemeIcon();
    for (const button of themeButtons) {
      button.classList.toggle('is-current', button.dataset.theme === currentTheme());
    }
  });

  const userMenu = document.createElement('details');
  userMenu.className = 'vault-user';
  const summary = document.createElement('summary');
  const avatar = document.createElement('span');
  avatar.className = 'vault-avatar';
  avatar.textContent = initials(account);
  const text = document.createElement('span');
  text.className = 'vault-user-text';
  const name = document.createElement('span');
  name.className = 'vault-user-name';
  name.textContent = displayName(account);
  const mail = document.createElement('span');
  mail.className = 'vault-user-mail';
  mail.textContent = account.email;
  text.append(name, mail);
  summary.append(avatar, text, svgIcon('M6 9l6 6 6-6'));
  const menu = document.createElement('div');
  menu.className = 'vault-menu';
  menu.append(button(t('cloudSignOut'), () => void onSignOut(), { type: 'text', id: 'workspace-sign-out' }));
  userMenu.append(summary, menu);

  // Sidebar is full-height (left column). Search + account tools sit only on
  // the right, above the editor stage -- not across the whole viewport.
  const top = Div()
    .class('vault-top')
    .children(
      Div()
        .class('vault-search-wrap')
        .children(
          Div().class('vault-search').children(search, View('span').class('vault-kbd').text('⌘K').build()).build(),
        )
        .build(),
      View('div')
        .class('vault-sync')
        .id('workspace-sync')
        .attr('role', 'status')
        .attr('aria-live', 'polite')
        .build(),
      Div()
        .class('vault-tools')
        .children(langMenu, themeMenu, userMenu)
        .build(),
    )
    .build();

  const newTrigger = document.createElement('button');
  newTrigger.type = 'button';
  newTrigger.className = 'vault-new';
  newTrigger.id = 'workspace-new';
  newTrigger.setAttribute('aria-haspopup', 'menu');
  newTrigger.setAttribute('aria-expanded', 'false');
  newTrigger.setAttribute('aria-controls', 'workspace-new-menu');
  const newChevron = svgIcon('M6 9l6 6 6-6');
  newChevron.classList.add('vault-new-chevron');
  newTrigger.append(
    svgIcon('M12 5v14M5 12h14'),
    document.createTextNode(t('cloudNew')),
    newChevron,
  );
  newTrigger.addEventListener('click', () => {
    openNewMenuAt(newTrigger, { matchWidth: true, key: 'workspace-new' });
  });
  const newPanel = buildNewMenuPanel();
  const contextMenu = buildContextMenu();

  const side = Div()
    .class('vault-side')
    .children(
      Div()
        .class('vault-space')
        .children(
          View('span').class('vault-space-avatar').text(initials(account)).build(),
          Div()
            .class('vault-space-text')
            .children(
              View('div').class('vault-space-name').text(t('cloudWorkspaceMine')).build(),
              View('div').class('vault-space-meta').text(`EditXLSX / ${t('cloudFilesTitle')}`).build(),
            )
            .build(),
        )
        .build(),
      newTrigger,
      Div()
        .class('vault-dir-head')
        .children(
          Div()
            .class('vault-dir-label')
            .children(
              iconSlot('M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01'),
              View('span').text(t('cloudNavDirectory')).build(),
            )
            .build(),
        )
        .build(),
      Div().class('vault-docs').id('workspace-docs').build(),
      Div()
        .class('vault-storage')
        .children(
          Div()
            .class('vault-storage-head')
            .children(
              iconSlot(
                'M6 18a4 4 0 0 1 .4-7.9A6 6 0 0 1 18 9a4.5 4.5 0 0 1 .2 9H6z',
                'vault-storage-icon',
              ),
              View('div').class('vault-storage-label').text(t('cloudStorage')).build(),
            )
            .build(),
          Div()
            .class('vault-storage-track')
            .children(Div().class('vault-storage-fill').id('workspace-storage-fill').build())
            .build(),
          View('p').class('vault-storage-used').id('workspace-storage-used').text('').build(),
        )
        .build(),
    )
    .build();

  const stage = Div()
    .class('vault-stage')
    .children(
      Div()
        .class('vault-stage-empty')
        .id('workspace-stage-empty')
        .children(
          (() => {
            const dropOverlay = document.createElement('div');
            dropOverlay.className = 'vault-stage-drop-overlay';
            dropOverlay.id = 'workspace-stage-drop-overlay';
            dropOverlay.hidden = true;
            dropOverlay.setAttribute('aria-hidden', 'true');
            const banner = document.createElement('div');
            banner.className = 'vault-stage-drop-banner';
            banner.append(
              svgIcon('M12 3v12M8 7l4-4 4 4M5 15v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3'),
              document.createTextNode(t('cloudDropOffice')),
            );
            dropOverlay.append(banner);
            return dropOverlay;
          })(),
          Div()
            .class('vault-stage-empty-copy')
            .id('workspace-stage-empty-copy')
            .children(
              View('h2').id('workspace-stage-empty-title').text(t('cloudEmptyTitle')).build(),
              View('p').id('workspace-stage-empty-body').text(t('cloudEmpty')).build(),
            )
            .build(),
          (() => {
            const actions = document.createElement('div');
            actions.className = 'vault-stage-empty-actions';
            actions.id = 'workspace-stage-empty-actions';

            const newBtn = document.createElement('button');
            newBtn.type = 'button';
            newBtn.className = 'vault-stage-action vault-stage-action-primary';
            newBtn.id = 'workspace-stage-new';
            newBtn.setAttribute('aria-haspopup', 'menu');
            newBtn.setAttribute('aria-expanded', 'false');
            newBtn.setAttribute('aria-controls', 'workspace-new-menu');
            newBtn.append(svgIcon('M12 5v14M5 12h14'), document.createTextNode(t('cloudNew')));
            newBtn.addEventListener('click', () => {
              openNewMenuAt(newBtn, { key: 'workspace-stage-new' });
            });

            const uploadBtn = document.createElement('button');
            uploadBtn.type = 'button';
            uploadBtn.className = 'vault-stage-action';
            uploadBtn.id = 'workspace-stage-upload';
            uploadBtn.append(
              svgIcon('M12 3v12M8 7l4-4 4 4M5 15v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3'),
              document.createTextNode(t('cloudUpload')),
            );
            uploadBtn.addEventListener('click', () => pickUploadFiles());

            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.id = 'workspace-upload-input';
            fileInput.className = 'vault-upload-input';
            fileInput.accept =
              '.xlsx,.docx,.pptx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation';
            fileInput.multiple = true;
            fileInput.hidden = true;
            fileInput.addEventListener('change', () => {
              void onUploadFiles(fileInput.files);
            });

            actions.append(newBtn, uploadBtn, fileInput);
            const dropHint = document.createElement('p');
            dropHint.className = 'vault-stage-drop-hint';
            dropHint.id = 'workspace-stage-drop-hint';
            dropHint.textContent = t('cloudDropOffice');
            const wrap = document.createElement('div');
            wrap.className = 'vault-stage-empty-cta';
            wrap.id = 'workspace-stage-empty-cta';
            wrap.append(actions, dropHint);
            return wrap;
          })(),
          (() => {
            const browser = document.createElement('div');
            browser.className = 'vault-stage-browser';
            browser.id = 'workspace-stage-browser';
            browser.hidden = true;
            const head = document.createElement('div');
            head.className = 'vault-stage-browser-head';
            const title = document.createElement('h2');
            title.className = 'vault-stage-browser-title';
            title.id = 'workspace-stage-browser-title';
            const tools = document.createElement('div');
            tools.className = 'vault-stage-browser-tools';
            tools.id = 'workspace-stage-browser-tools';
            head.append(title, tools);
            const list = document.createElement('div');
            list.className = 'vault-stage-browser-list';
            list.id = 'workspace-stage-browser-list';
            list.setAttribute('role', 'list');
            browser.append(head, list);
            return browser;
          })(),
          (() => {
            const progress = document.createElement('div');
            progress.className = 'vault-upload-progress';
            progress.id = 'workspace-upload-progress';
            progress.hidden = true;
            progress.setAttribute('role', 'status');
            progress.setAttribute('aria-live', 'polite');
            const label = document.createElement('p');
            label.className = 'vault-upload-progress-label';
            label.id = 'workspace-upload-progress-label';
            const track = document.createElement('div');
            track.className = 'vault-upload-progress-track';
            const fill = document.createElement('div');
            fill.className = 'vault-upload-progress-fill';
            fill.id = 'workspace-upload-progress-fill';
            track.append(fill);
            progress.append(label, track);
            return progress;
          })(),
          (() => {
            const skeleton = document.createElement('div');
            skeleton.className = 'vault-stage-skeleton';
            skeleton.id = 'workspace-stage-skeleton';
            skeleton.hidden = true;
            skeleton.setAttribute('aria-busy', 'true');
            skeleton.setAttribute('aria-label', '…');
            const head = document.createElement('div');
            head.className = 'vault-stage-skeleton-head';
            head.append(bone('title'), bone('action'), bone('action'));
            const list = document.createElement('div');
            list.className = 'vault-stage-skeleton-list';
            for (let i = 0; i < 6; i += 1) {
              const row = document.createElement('div');
              row.className = 'vault-stage-skeleton-row';
              row.append(bone('icon'), bone('name'), bone('meta'), bone('meta-sm'));
              list.append(row);
            }
            skeleton.append(head, list);
            return skeleton;
          })(),
        )
        .build(),
      Div()
        .class('vault-frame-wrap')
        .id('workspace-frame-wrap')
        .children(
          (() => {
            const frame = document.createElement('iframe');
            frame.id = 'workspace-editor-frame';
            frame.title = t('cloudOpenEditor');
            frame.hidden = true;
            return frame;
          })(),
          (() => {
            const overlay = Div()
              .class('vault-stage-overlay')
              .id('workspace-stage-overlay')
              .children(
                View('p').class('vault-stage-overlay-title').id('workspace-stage-overlay-title').text('').build(),
                View('p').class('vault-stage-overlay-body').id('workspace-stage-overlay-body').text('').build(),
              )
              .build();
            overlay.hidden = true;
            return overlay;
          })(),
        )
        .build(),
    )
    .build();

  const emptyStage = stage.querySelector('#workspace-stage-empty');
  if (emptyStage instanceof HTMLElement) {
    emptyStage.addEventListener('dragover', (event) => {
      if (!isExternalFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      const folderRow = (event.target as Element | null)?.closest?.(
        '.vault-stage-browser-row[data-kind="folder"]',
      );
      setStageFileDropActive(true, folderRow instanceof HTMLElement ? folderRow : null);
    });
    emptyStage.addEventListener('dragleave', (event) => {
      const related = event.relatedTarget as Node | null;
      if (related && emptyStage.contains(related)) return;
      setStageFileDropActive(false);
    });
    emptyStage.addEventListener('drop', (event) => {
      if (!isExternalFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setStageFileDropActive(false);
      const parentId = dropTargetFolderId(event, currentFolderId);
      // Snapshot entries before any await — required for multi-file drops.
      const payload = event.dataTransfer ? captureDropPayload(event.dataTransfer) : null;
      void onDropUpload(payload, parentId);
    });
  }

  root().append(
    Div().class('vault').children(side, Div().class('vault-body').children(top, stage).build()).build(),
    newPanel,
    contextMenu,
  );

  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      root().querySelector<HTMLElement>('r-input.workspace-search')?.focus();
    }
  });

  if (!bridgeListening) {
    bridgeListening = true;
    window.addEventListener('message', (event) => {
      if (event.origin !== window.location.origin) return;
      if (!isShellBridgeMessage(event.data)) return;
      if (event.data.workbookId !== selectedId) return;
      if (event.data.type === SHELL_READY) {
        clearOpenWatchers();
        stageStatus = 'ready';
        stageError = '';
        paintOverlay();
      } else if (event.data.type === SHELL_FAILED) {
        clearOpenWatchers();
        stageStatus = 'error';
        stageError = event.data.message;
        notifyError(`${t('cloudOpenFailed')}${event.data.message}`);
        paintOverlay();
      } else if (event.data.type === SHELL_SAVE_STATE) {
        setSaveStatus(event.data.state, event.data.message);
      }
    });
  }
}

function setSaveStatus(state: ShellSaveState | 'idle', message = ''): void {
  if (saveStatusTimer) {
    window.clearTimeout(saveStatusTimer);
    saveStatusTimer = 0;
  }
  saveStatus = state;
  saveStatusError = message;
  paintSaveStatus();
  // "Saved" is a confirmation, not a permanent label -- fade after a beat so
  // the bar stays quiet between edits (Docs-style).
  if (state === 'saved') {
    saveStatusTimer = window.setTimeout(() => {
      if (saveStatus === 'saved') {
        saveStatus = 'idle';
        saveStatusError = '';
        paintSaveStatus();
      }
    }, 3_500);
  }
}

function paintSaveStatus(): void {
  const el = document.getElementById('workspace-sync');
  if (!el) return;
  el.dataset.state = saveStatus;
  el.replaceChildren();
  el.removeAttribute('title');
  el.removeAttribute('aria-label');

  if (saveStatus === 'idle') {
    el.hidden = true;
    return;
  }

  const label =
    saveStatus === 'saving'
      ? t('cloudSaveStatusSaving')
      : saveStatus === 'local'
        ? t('cloudSaveStatusLocal')
        : saveStatus === 'saved'
          ? t('cloudSaveStatusSaved')
          : saveStatusError
            ? `${t('cloudSaveStatusError')}${saveStatusError}`
            : t('cloudSaveStatusError');

  el.append(syncStatusIcon(saveStatus));
  el.title = label;
  el.setAttribute('aria-label', label);
  // Errors keep a short text trail so the reason is visible without hovering.
  if (saveStatus === 'error' && saveStatusError) {
    const detail = document.createElement('span');
    detail.className = 'vault-sync-detail';
    detail.textContent = saveStatusError;
    el.append(detail);
  }
  el.hidden = false;
}

function itemIcon(item: VaultItem): SVGElement {
  if (item.kind === 'folder') {
    return svgIcon('M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z');
  }
  if (item.format === 'docx') {
    return svgIcon('M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M9 13h6M9 17h4');
  }
  if (item.format === 'pptx') {
    return svgIcon('M3 5h18v12H3zM8 21h8M12 17v4');
  }
  return svgIcon('M4 4h16v16H4zM4 10h16M10 4v16');
}

function clearDropHintClasses(): void {
  const host = document.getElementById('workspace-docs');
  if (!host) return;
  host.querySelectorAll('.vault-tree-row.is-drop-before, .vault-tree-row.is-drop-after, .vault-tree-row.is-drop-into').forEach((el) => {
    el.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-into');
  });
}

function setDropHint(targetId: string, mode: DropMode): void {
  dropHint = { targetId, mode };
  clearDropHintClasses();
  const host = document.getElementById('workspace-docs');
  const row = host?.querySelector(`.vault-tree-row[data-id="${CSS.escape(targetId)}"]`);
  row?.classList.add(`is-drop-${mode}`);
}

function resolveDropPlacement(
  movedId: string,
  hint: { targetId: string; mode: DropMode },
): { parentId: string; beforeId: string | null } | null {
  const moved = rows.find((row) => row.id === movedId);
  const target = rows.find((row) => row.id === hint.targetId);
  if (!moved || !target || moved.id === target.id) return null;

  if (hint.mode === 'into') {
    if (target.kind !== 'folder') return null;
    if (moved.kind === 'folder' && isUnderFolder(rows, moved.id, target.id)) return null;
    return { parentId: target.id, beforeId: null };
  }

  const parentId = target.parentId || '';
  if (moved.kind === 'folder' && (parentId === moved.id || isUnderFolder(rows, moved.id, parentId))) {
    return null;
  }

  if (hint.mode === 'before') {
    return { parentId, beforeId: target.id };
  }

  const siblings = childrenOf(parentId);
  const idx = siblings.findIndex((row) => row.id === target.id);
  let beforeId: string | null = siblings[idx + 1]?.id ?? null;
  if (beforeId === movedId) {
    beforeId = siblings[idx + 2]?.id ?? null;
  }
  return { parentId, beforeId };
}

async function commitVaultDrop(movedId: string, hint: { targetId: string; mode: DropMode }): Promise<void> {
  const placement = resolveDropPlacement(movedId, hint);
  dropHint = null;
  clearDropHintClasses();
  if (!placement) return;

  const previous = rows;
  try {
    const { items, patches } = placeVaultItem(rows, movedId, placement.parentId, placement.beforeId);
    if (patches.length === 0) return;
    rows = items;
    if (hint.mode === 'into') expandedFolderIds.add(hint.targetId);
    paintDocs();
    await reorderVaultSiblings(patches);
  } catch (error) {
    rows = previous;
    paintDocs();
    const message = error instanceof Error ? error.message : String(error);
    notifyError(message);
  }
}

function bindVaultDrag(row: HTMLElement, item: VaultItem): void {
  row.dataset.id = item.id;
  row.draggable = true;

  row.addEventListener('dragstart', (event) => {
    if (renamingId) {
      event.preventDefault();
      return;
    }
    dragId = item.id;
    dropHint = null;
    row.classList.add('is-dragging');
    event.dataTransfer?.setData('text/plain', item.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  });

  row.addEventListener('dragend', () => {
    dragId = '';
    dropHint = null;
    row.classList.remove('is-dragging');
    clearDropHintClasses();
  });

  row.addEventListener('dragover', (event) => {
    if (!dragId || dragId === item.id) return;
    const rect = row.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / Math.max(rect.height, 1);
    let mode: DropMode;
    if (item.kind === 'folder') {
      if (ratio < 0.28) mode = 'before';
      else if (ratio > 0.72) mode = 'after';
      else mode = 'into';
    } else {
      mode = ratio < 0.5 ? 'before' : 'after';
    }
    if (!resolveDropPlacement(dragId, { targetId: item.id, mode })) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    setDropHint(item.id, mode);
  });

  row.addEventListener('dragleave', (event) => {
    const related = event.relatedTarget as Node | null;
    if (related && row.contains(related)) return;
    if (dropHint?.targetId === item.id) {
      dropHint = null;
      row.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-into');
    }
  });

  row.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const moved = dragId || event.dataTransfer?.getData('text/plain') || '';
    const hint = dropHint?.targetId === item.id ? dropHint : null;
    dragId = '';
    row.classList.remove('is-dragging');
    if (!moved || !hint) {
      clearDropHintClasses();
      dropHint = null;
      return;
    }
    void commitVaultDrop(moved, hint);
  });
}

function paintDocs(): void {
  const host = document.getElementById('workspace-docs');
  if (!host) return;
  closeNewMenu();
  closeContextMenu();
  host.replaceChildren();
  if (loading) {
    mountDocsSkeleton(host);
    return;
  }
  if (query.trim()) {
    const matches = rows;
    if (matches.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'vault-empty';
      empty.textContent = t('cloudEmptySearch');
      host.append(empty);
      return;
    }
    for (const item of matches) host.append(buildTreeRow(item, 0, { searchable: true }));
    return;
  }
  if (childrenOf('').length === 0) {
    const empty = document.createElement('p');
    empty.className = 'vault-empty';
    empty.textContent = t('cloudEmpty');
    host.append(empty);
    return;
  }
  appendTreeBranch(host, '', 0);
}

function appendTreeBranch(host: HTMLElement, parentId: string, depth: number): void {
  for (const item of childrenOf(parentId)) {
    host.append(buildTreeRow(item, depth));
    if (item.kind === 'folder' && expandedFolderIds.has(item.id)) {
      appendTreeBranch(host, item.id, depth + 1);
    }
  }
}

function buildTreeRow(item: VaultItem, depth: number, options: { searchable?: boolean } = {}): HTMLElement {
  const row = document.createElement('div');
  row.className = 'vault-tree-row';
  row.dataset.depth = String(depth);
  row.dataset.id = item.id;
  row.style.setProperty('--vault-depth', String(depth));

  const kids = item.kind === 'folder' && !options.searchable ? childrenOf(item.id) : [];
  const canExpand = kids.length > 0;
  const expanded = canExpand && expandedFolderIds.has(item.id);

  const twist = document.createElement('button');
  twist.type = 'button';
  twist.className = canExpand ? 'vault-tree-twist' : 'vault-tree-twist is-leaf';
  twist.tabIndex = canExpand ? 0 : -1;
  twist.setAttribute('aria-hidden', canExpand ? 'false' : 'true');
  if (canExpand) {
    twist.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    twist.append(svgIcon('M9 18l6-6-6-6', 'vault-tree-chevron'));
    twist.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleFolderExpanded(item.id);
    });
  }

  const isCurrent =
    item.kind === 'file' ? item.id === selectedId : item.id === currentFolderId && !selectedId;
  const isRenaming = renamingId === item.id;

  if (isRenaming) {
    row.classList.add('is-renaming');
    const renameWrap = document.createElement('div');
    renameWrap.className = isCurrent ? 'vault-tree-item is-current is-renaming' : 'vault-tree-item is-renaming';
    renameWrap.dataset.kind = item.kind;
    renameWrap.dataset.id = item.id;
    if (item.format) renameWrap.dataset.format = item.format;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'vault-tree-rename';
    input.dataset.id = item.id;
    input.value = item.title;
    input.setAttribute('aria-label', t('cloudRename'));
    input.spellcheck = false;
    let finished = false;
    const finish = (commit: boolean): void => {
      if (finished) return;
      finished = true;
      if (commit) void commitRename(item.id, input.value);
      else cancelRename();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
      event.stopPropagation();
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (event) => event.stopPropagation());
    renameWrap.append(itemIcon(item), input);
    row.append(twist, renameWrap);
    return row;
  }

  const buttonEl = document.createElement('button');
  buttonEl.type = 'button';
  buttonEl.className = isCurrent ? 'vault-tree-item is-current' : 'vault-tree-item';
  buttonEl.dataset.kind = item.kind;
  buttonEl.dataset.id = item.id;
  if (item.format) buttonEl.dataset.format = item.format;
  if (isCurrent) buttonEl.setAttribute('aria-current', 'true');
  const title = document.createElement('span');
  title.className = 'vault-tree-title';
  title.textContent = item.title;
  buttonEl.append(itemIcon(item), title);
  let clickTimer = 0;
  buttonEl.addEventListener('click', () => {
    window.clearTimeout(clickTimer);
    clickTimer = window.setTimeout(() => {
      if (item.kind === 'folder') openFolder(item.id);
      else selectWorkbook(item.id);
    }, 250);
  });
  buttonEl.addEventListener('dblclick', (event) => {
    window.clearTimeout(clickTimer);
    event.preventDefault();
    event.stopPropagation();
    startRename(item.id);
  });
  buttonEl.addEventListener('keydown', (event) => {
    if (event.key === 'F2') {
      event.preventDefault();
      startRename(item.id);
    }
  });

  row.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    window.clearTimeout(clickTimer);
    openContextMenu(item, event.clientX, event.clientY);
  });

  row.append(twist, buttonEl);

  if (item.kind === 'folder' && !options.searchable) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'vault-tree-add';
    add.dataset.folder = item.id;
    add.setAttribute('aria-label', t('cloudNew'));
    add.setAttribute('aria-haspopup', 'menu');
    add.append(svgIcon('M12 5v14M5 12h14', 'vault-tree-add-icon'));
    add.addEventListener('click', (event) => {
      event.stopPropagation();
      openNewMenuForFolder(item.id, add);
    });
    row.append(add);
  }

  if (!options.searchable) {
    bindVaultDrag(row, item);
    // Buttons don't initiate parent HTML5 drag in some browsers; mirror on the row item.
    buttonEl.draggable = true;
    buttonEl.addEventListener('dragstart', (event) => {
      if (renamingId) {
        event.preventDefault();
        return;
      }
      dragId = item.id;
      dropHint = null;
      row.classList.add('is-dragging');
      event.dataTransfer?.setData('text/plain', item.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    buttonEl.addEventListener('dragend', () => {
      dragId = '';
      dropHint = null;
      row.classList.remove('is-dragging');
      clearDropHintClasses();
    });
  }

  return row;
}

function paintStorage(): void {
  const used = document.getElementById('workspace-storage-used');
  const fill = document.getElementById('workspace-storage-fill');
  if (!used || !fill) return;
  const bytes = rows.reduce((sum, row) => (row.kind === 'file' ? sum + row.sizeBytes : sum), 0);
  used.textContent = t('cloudStorageUsed', { size: formatBytes(bytes) });
  const ratio = Math.max(0, Math.min(1, bytes / STORAGE_SCALE_BYTES));
  fill.style.width = `${Math.round(ratio * 1000) / 10}%`;
}

function paintOverlay(): void {
  const overlay = document.getElementById('workspace-stage-overlay');
  const title = document.getElementById('workspace-stage-overlay-title');
  const body = document.getElementById('workspace-stage-overlay-body');
  if (!overlay || !title || !body) return;
  if (stageStatus === 'loading') {
    overlay.hidden = false;
    overlay.dataset.state = 'loading';
    title.textContent = t('cloudOpeningWorkbook');
    body.textContent = '';
    return;
  }
  if (stageStatus === 'error') {
    overlay.hidden = false;
    overlay.dataset.state = 'error';
    title.textContent = t('cloudOpenFailedTitle');
    body.textContent = stageError || t('cloudOpenFailed');
    return;
  }
  overlay.hidden = true;
  overlay.dataset.state = stageStatus;
  title.textContent = '';
  body.textContent = '';
}

function paintStageBrowser(items: VaultItem[]): void {
  const browser = document.getElementById('workspace-stage-browser');
  const title = document.getElementById('workspace-stage-browser-title');
  const list = document.getElementById('workspace-stage-browser-list');
  const tools = document.getElementById('workspace-stage-browser-tools');
  const actions = document.getElementById('workspace-stage-empty-actions');
  if (!browser || !title || !list) return;

  title.textContent = currentFolderTitle();
  if (tools && actions && actions.parentElement !== tools) {
    tools.replaceChildren(actions);
  }
  list.replaceChildren();
  for (const item of items) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'vault-stage-browser-row';
    row.dataset.kind = item.kind;
    row.dataset.id = item.id;
    if (item.format) row.dataset.format = item.format;
    row.setAttribute('role', 'listitem');

    const name = document.createElement('span');
    name.className = 'vault-stage-browser-name';
    name.append(itemIcon(item), document.createTextNode(item.title));

    const size = document.createElement('span');
    size.className = 'vault-stage-browser-size';
    size.textContent = item.kind === 'file' ? formatBytes(item.sizeBytes) : '—';

    const edited = document.createElement('span');
    edited.className = 'vault-stage-browser-edited';
    edited.textContent = formatEditedWhen(item.updatedAt);

    row.append(name, size, edited);
    row.addEventListener('click', () => {
      if (item.kind === 'folder') openFolder(item.id);
      else selectWorkbook(item.id);
    });
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      openContextMenu(item, event.clientX, event.clientY);
    });
    list.append(row);
  }
  browser.hidden = false;
}

function paintStage(): void {
  const empty = document.getElementById('workspace-stage-empty');
  const wrap = document.getElementById('workspace-frame-wrap');
  const frame = document.getElementById('workspace-editor-frame') as HTMLIFrameElement | null;
  if (!empty || !wrap || !frame) return;
  const workbook = selectedWorkbook();
  if (!workbook && loading && frame.dataset.workbook) return;
  if (!workbook) {
    empty.hidden = false;
    wrap.hidden = true;
    frame.hidden = true;
    stageStatus = 'idle';
    stageError = '';
    clearOpenWatchers();
    if (frame.dataset.workbook) {
      frame.dataset.workbook = '';
      frame.removeAttribute('src');
    }
    const copy = document.getElementById('workspace-stage-empty-copy');
    const cta = document.getElementById('workspace-stage-empty-cta');
    const browser = document.getElementById('workspace-stage-browser');
    const skeleton = document.getElementById('workspace-stage-skeleton');
    const heading = document.getElementById('workspace-stage-empty-title');
    const body = document.getElementById('workspace-stage-empty-body');
    const dropHint = document.getElementById('workspace-stage-drop-hint');
    const actions = document.getElementById('workspace-stage-empty-actions');
    const searching = Boolean(query.trim());
    const children = searching ? [] : childrenOf(currentFolderId);
    const folderEmpty = !searching && children.length === 0;

    if (browser) browser.hidden = true;
    if (loading) {
      empty.classList.remove('is-browser', 'is-empty');
      empty.classList.add('is-skeleton');
      if (copy) copy.hidden = true;
      if (cta) cta.hidden = true;
      if (dropHint) dropHint.hidden = true;
      if (skeleton) skeleton.hidden = false;
      document.title = t('cloudFilesTitle');
      paintOverlay();
      return;
    }

    empty.classList.remove('is-skeleton');
    if (skeleton) skeleton.hidden = true;
    empty.classList.toggle('is-browser', !searching && !folderEmpty);
    empty.classList.toggle('is-empty', searching || folderEmpty);

    if (!searching && !folderEmpty) {
      if (copy) copy.hidden = true;
      if (cta) cta.hidden = true;
      if (dropHint) dropHint.hidden = true;
      paintStageBrowser(children);
    } else {
      if (copy) copy.hidden = false;
      if (cta) {
        cta.hidden = searching;
        if (actions && cta !== actions.parentElement) cta.insertBefore(actions, dropHint);
      }
      if (dropHint) dropHint.hidden = searching;
      if (heading) {
        heading.textContent = searching ? t('cloudEmptySearchTitle') : t('cloudEmptyTitle');
      }
      if (body) {
        body.textContent = searching
          ? t('cloudEmptySearch')
          : currentFolderId
            ? t('cloudFolderEmptyHint')
            : t('cloudEmpty');
      }
    }
    document.title = t('cloudFilesTitle');
    paintOverlay();
    return;
  }

  empty.hidden = true;
  empty.classList.remove('is-browser', 'is-empty', 'is-skeleton');
  const skeleton = document.getElementById('workspace-stage-skeleton');
  if (skeleton) skeleton.hidden = true;
  wrap.hidden = false;
  frame.hidden = false;
  document.title = workbook.title;

  if (frame.dataset.workbook === workbook.id) {
    paintOverlay();
    return;
  }
  stageStatus = 'loading';
  stageError = '';
  frame.dataset.workbook = workbook.id;
  frame.title = workbook.title;
  watchEditorOpen(frame, workbook.id);
  frame.src = editorFrameUrl(workbook.id);
  paintOverlay();
}

function paint(): void {
  if (!user) return;
  mountShell();
  paintDocs();
  paintStorage();
  paintSaveStatus();
  paintStage();
}

applyDocumentLanguage();

void (async () => {
  user = await getCurrentUser();
  if (!user) {
    window.location.replace(loginUrl());
    return;
  }
  document.title = t('cloudFilesTitle');
  readUrl();
  await refresh();
})();
