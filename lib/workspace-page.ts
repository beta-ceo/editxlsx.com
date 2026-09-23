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
import { createBlankFile, createFolder, createWorkbookFromFile, deleteVaultItem, ensureFormatName, getWorkbook, isUnderFolder, listVaultItems, placeVaultItem, renameVaultItem, reorderVaultSiblings, compareVaultOrder, nextSortOrder, type VaultItem, type Workbook } from './appwrite/workbooks';
import type { VaultFormat } from './appwrite/ids';
import { formatFromTitle, MAX_WORKBOOK_BYTES } from './appwrite/ids';
import { confirmDialog } from './confirm-dialog';
import { applySiteThemeToEditor } from './editor-theme';
import { DEFAULT_UI_THEME } from './onlyoffice/ui-theme';
import {
  isShellBridgeMessage,
  SHELL_FAILED,
  SHELL_FRAME_READY,
  SHELL_NEED_PAYLOAD,
  SHELL_READY,
  SHELL_SAVE_STATE,
} from './shell-bridge';
import type { ShellSaveState } from './shell-bridge';
import {
  beginShellOpenHandoff,
  clearShellOpenHandoff,
  isShellFrameReady,
  onShellFrameReady,
  onShellNeedPayload,
  resetShellFrameReady,
} from './shell-open-handoff';
import { mergeShellOverlayTiming, publishOpenTiming, type OpenTimingReport } from './open-timing';

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
/** Shell-side clocks for the in-flight framed open (performance.now()). */
let shellOpenStartedAt = 0;
let shellIframeLoadAt = 0;
let shellBundleBootAt = 0;

function root(): HTMLElement {
  return document.getElementById('workspace-root') as HTMLElement;
}

function loginUrl(): string {
  const locale = new URLSearchParams(window.location.search).get('locale');
  return locale ? `/login?locale=${encodeURIComponent(locale)}` : '/login';
}

function editorFrameUrl(bootToken?: number): string {
  // Warm host: no workbook in the iframe URL — switches push open-payload.
  const base = withLocale(`/editor?shell=1`, getLanguage());
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
    return (
      body.classList.contains('opening-document') ||
      body.classList.contains('embed-mode') ||
      body.classList.contains('shell-warm')
    );
  } catch {
    return false;
  }
}

function handoffMeta(): {
  onMeta: (fresh: Workbook) => void;
} {
  return {
    onMeta: (fresh) => {
      rows = rows.map((row) => (row.id === fresh.id ? fresh : row));
    },
  };
}

function failOpen(workbookId: string, message: string): void {
  if (selectedId !== workbookId || stageStatus !== 'loading') return;
  clearOpenWatchers();
  stageStatus = 'error';
  stageError = message;
  notifyError(`${t('cloudOpenFailed')}${message}`);
  paintOverlay();
}

/** Mount (or remount) the long-lived `?shell=1` editor frame. */
function mountWarmEditorFrame(frame: HTMLIFrameElement, options: { bootToken?: number; watchBoot?: boolean } = {}): void {
  resetShellFrameReady();
  frame.dataset.warm = '1';
  const watchBoot = options.watchBoot !== false;
  if (watchBoot && selectedId) {
    watchEditorOpen(frame, selectedId, { watchBoot: true, preserveRetries: options.bootToken !== undefined });
  }
  frame.src = editorFrameUrl(options.bootToken);
}

function remountEditorFrame(frame: HTMLIFrameElement, workbookId: string): void {
  stageStatus = 'loading';
  stageError = '';
  frame.dataset.workbook = workbookId;
  frame.title = rows.find((row) => row.id === workbookId)?.title || workbookId;
  const workbook = rows.find((row): row is Workbook => row.id === workbookId && row.kind === 'file');
  if (workbook) beginShellOpenHandoff(workbook, handoffMeta());
  // Bust the URL so the browser remounts even when shell=1 is unchanged.
  mountWarmEditorFrame(frame, { bootToken: Date.now(), watchBoot: true });
  paintOverlay();
}

function watchEditorOpen(
  frame: HTMLIFrameElement,
  workbookId: string,
  options: { preserveRetries?: boolean; watchBoot?: boolean } = {},
): void {
  clearOpenWatchers();
  const generation = ++openGeneration;
  if (!options.preserveRetries) bootRetries = 0;
  shellOpenStartedAt = performance.now();
  shellIframeLoadAt = 0;
  shellBundleBootAt = 0;

  openTimer = window.setTimeout(() => {
    if (generation !== openGeneration) return;
    failOpen(workbookId, t('cloudOpenTimedOut'));
  }, OPEN_TIMEOUT_MS);

  if (options.watchBoot === false) {
    // Warm swap: iframe already booted; only the open timeout applies.
    return;
  }

  frameLoadHandler = () => {
    if (generation !== openGeneration) return;
    if (!shellIframeLoadAt) shellIframeLoadAt = performance.now();
    if (bootTimer) window.clearTimeout(bootTimer);
    const startedAt = Date.now();
    const pollBoot = (): void => {
      if (generation !== openGeneration) return;
      if (selectedId !== workbookId || stageStatus !== 'loading') return;
      // Module graph evaluated: still waiting for shell:workbook-ready (download /
      // OnlyOffice). Do not treat that as a boot failure.
      if (editorBundleBooted(frame)) {
        if (!shellBundleBootAt) shellBundleBootAt = performance.now();
        return;
      }
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
    // Record boot immediately when the module graph beat iframe `load`
    // (common on warm SW / cached bundles); otherwise the 500 ms poll delay
    // races shell:workbook-ready and we never stamp bundleBootMs.
    if (editorBundleBooted(frame)) {
      if (!shellBundleBootAt) shellBundleBootAt = performance.now();
      return;
    }
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

/** Soft cloud upload plate for the empty-stage hero (reference-style). */
function buildEmptyDropArt(): HTMLElement {
  const art = document.createElement('div');
  art.className = 'vault-stage-drop-art';
  art.setAttribute('aria-hidden', 'true');

  const plate = document.createElement('div');
  plate.className = 'vault-stage-drop-art-plate';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'vault-icon vault-stage-drop-art-cloud');

  const cloud = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  cloud.setAttribute('d', 'M7 18h9.5a3.5 3.5 0 0 0 .5-6.97 5 5 0 0 0-9.7-1.53A3.5 3.5 0 0 0 7 18z');
  cloud.setAttribute('fill', 'currentColor');
  cloud.setAttribute('stroke', 'none');

  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arrow.setAttribute('d', 'M12 16V10M9.5 12.5 12 10l2.5 2.5');
  arrow.setAttribute('fill', 'none');
  arrow.setAttribute('stroke', '#fff');
  arrow.setAttribute('stroke-width', '1.8');
  arrow.setAttribute('stroke-linecap', 'round');
  arrow.setAttribute('stroke-linejoin', 'round');

  svg.append(cloud, arrow);
  plate.append(svg);
  art.append(plate);
  return art;
}

function buildDropFormatsLine(): HTMLElement {
  const line = document.createElement('p');
  line.className = 'vault-stage-drop-formats';
  line.id = 'workspace-stage-drop-formats';
  const size = `${Math.floor(MAX_WORKBOOK_BYTES / 1_000_000)} MB`;
  const raw = t('cloudDropFormats', { size });
  // Bold the Office extensions in the sentence.
  const parts = raw.split(/(\.xlsx|\.docx|\.pptx)/gi);
  for (const part of parts) {
    if (/^\.(xlsx|docx|pptx)$/i.test(part)) {
      const strong = document.createElement('strong');
      strong.textContent = part.toUpperCase();
      line.append(strong);
    } else {
      line.append(document.createTextNode(part));
    }
  }
  return line;
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
  if (same && (stageStatus === 'loading' || stageStatus === 'error')) {
    stageStatus = 'loading';
    stageError = '';
    clearOpenWatchers();
    const frame = document.getElementById('workspace-editor-frame') as HTMLIFrameElement | null;
    const workbook = rows.find((row): row is Workbook => row.id === id && row.kind === 'file');
    if (frame && workbook) {
      frame.dataset.workbook = id;
      frame.title = workbook.title;
      remountEditorFrame(frame, id);
      syncUrl();
      paintDocs();
      paintStorage();
      paintSaveStatus();
      return;
    }
  }
  if (!same) {
    stageStatus = 'loading';
    stageError = '';
    setSaveStatus('idle');
  }
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
/** Per-file upload queue shown in the stage panel (`[]` = hidden). */
type UploadQueueState = 'queued' | 'uploading' | 'done' | 'error';
type UploadQueueItem = {
  key: string;
  file: File;
  relativeDir: string;
  format: VaultFormat;
  folderLabel: string;
  state: UploadQueueState;
  progress: number;
  sizeUploaded: number;
  workbookId?: string;
  error?: string;
};
let uploadQueue: UploadQueueItem[] = [];
let uploadQueueKey = 0;
/** Auto-hide the queue panel after the batch finishes. */
let uploadQueueHideTimer = 0;

function setUploadButtonsDisabled(disabled: boolean): void {
  const uploadBtn = document.getElementById('workspace-stage-upload') as HTMLButtonElement | null;
  if (uploadBtn) uploadBtn.disabled = disabled;
}

function cancelUploadQueueHide(): void {
  if (!uploadQueueHideTimer) return;
  window.clearTimeout(uploadQueueHideTimer);
  uploadQueueHideTimer = 0;
}

/** Hide the panel once every row is finished (done/error) and nothing is uploading. */
function scheduleUploadQueueHideIfIdle(): void {
  cancelUploadQueueHide();
  if (uploadBusy || uploadQueue.length === 0) return;
  const allFinished = uploadQueue.every((row) => row.state === 'done' || row.state === 'error');
  if (!allFinished) return;
  // Let the fill ease to 100% and the "ready" chip read before dismissing.
  uploadQueueHideTimer = window.setTimeout(() => {
    uploadQueueHideTimer = 0;
    if (uploadBusy) return;
    if (!uploadQueue.every((row) => row.state === 'done' || row.state === 'error')) return;
    uploadQueue = [];
    paintUploadProgress();
  }, 1_400);
}

function folderLabelFor(parentId: string, relativeDir: string): string {
  const leaf = relativeDir.split('/').filter(Boolean).at(-1);
  if (leaf) return leaf;
  if (!parentId) return t('cloudAllDocuments');
  return rows.find((row) => row.id === parentId)?.title || t('cloudFilesTitle');
}

function formatIcon(format: VaultFormat): SVGElement {
  if (format === 'docx') {
    return svgIcon(
      'M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M9 13h6M9 17h4',
      'vault-icon vault-upload-queue-file-icon',
    );
  }
  if (format === 'pptx') {
    return svgIcon('M3 5h18v12H3zM8 21h8M12 17v4', 'vault-icon vault-upload-queue-file-icon');
  }
  return svgIcon('M4 4h16v16H4zM4 10h16M10 4v16', 'vault-icon vault-upload-queue-file-icon');
}

function dismissUploadItem(key: string): void {
  const item = uploadQueue.find((row) => row.key === key);
  if (!item || item.state === 'uploading') return;
  uploadQueue = uploadQueue.filter((row) => row.key !== key);
  paintUploadProgress();
}

function clearCompletedUploads(): void {
  uploadQueue = uploadQueue.filter((row) => row.state !== 'done' && row.state !== 'error');
  paintUploadProgress();
}

function paintUploadProgress(): void {
  const panel = document.getElementById('workspace-upload-progress');
  const badge = document.getElementById('workspace-upload-queue-badge');
  const list = document.getElementById('workspace-upload-queue-list');
  const clearBtn = document.getElementById('workspace-upload-queue-clear') as HTMLButtonElement | null;
  if (!panel || !badge || !list) return;

  if (uploadQueue.length === 0) {
    panel.hidden = true;
    list.replaceChildren();
    badge.textContent = '';
    if (clearBtn) {
      clearBtn.hidden = true;
      clearBtn.textContent = '';
    }
    return;
  }

  panel.hidden = false;
  badge.textContent = t('cloudUploadQueueItems', { count: String(uploadQueue.length) });

  const completed = uploadQueue.filter((row) => row.state === 'done' || row.state === 'error').length;
  if (clearBtn) {
    clearBtn.hidden = completed === 0;
    clearBtn.textContent = t('cloudUploadClearCompleted', { count: String(completed) });
  }

  const existing = new Map<string, HTMLElement>();
  for (const child of [...list.children]) {
    if (!(child instanceof HTMLElement)) continue;
    const key = child.dataset.key;
    if (key) existing.set(key, child);
  }

  const nextCards: HTMLElement[] = [];
  for (const item of uploadQueue) {
    let card = existing.get(item.key);
    if (card) {
      existing.delete(item.key);
      syncUploadQueueCard(card, item);
    } else {
      card = buildUploadQueueCard(item);
    }
    nextCards.push(card);
  }
  for (const orphan of existing.values()) orphan.remove();
  // Keep order without wiping nodes (preserves fill width for CSS transitions).
  for (let i = 0; i < nextCards.length; i += 1) {
    const card = nextCards[i]!;
    if (list.children[i] !== card) list.insertBefore(card, list.children[i] || null);
  }
}

function animateFillWidth(fill: HTMLElement, pct: number): void {
  const next = `${Math.max(0, Math.min(100, Math.round(pct)))}%`;
  if (fill.style.width === next) return;
  // Ensure the browser commits the current width before transitioning.
  void fill.offsetWidth;
  fill.style.width = next;
}

function ensureQueueTrack(body: HTMLElement): { track: HTMLElement; fill: HTMLElement } {
  let track = body.querySelector('.vault-upload-queue-track') as HTMLElement | null;
  let fill = track?.querySelector('.vault-upload-queue-fill') as HTMLElement | null;
  if (!track || !fill) {
    track = document.createElement('div');
    track.className = 'vault-upload-queue-track';
    fill = document.createElement('div');
    fill.className = 'vault-upload-queue-fill';
    fill.style.width = '0%';
    track.append(fill);
    // Insert before detail if present, else append.
    const detail = body.querySelector('.vault-upload-queue-detail');
    if (detail) body.insertBefore(track, detail);
    else body.append(track);
  }
  return { track, fill };
}

function syncUploadQueueCard(card: HTMLElement, item: UploadQueueItem): void {
  card.className = `vault-upload-queue-card is-${item.state}`;
  card.dataset.format = item.format;
  card.dataset.key = item.key;
  card.dataset.state = item.state;

  const body = card.querySelector('.vault-upload-queue-body') as HTMLElement | null;
  if (!body) return;

  const titleRow = body.querySelector('.vault-upload-queue-title-row');
  if (titleRow) {
    let check = titleRow.querySelector('.vault-upload-queue-check');
    if (item.state === 'done') {
      if (!check) {
        titleRow.append(svgIcon('M20 6 9 17l-5-5', 'vault-icon vault-upload-queue-check'));
      }
    } else if (check) {
      check.remove();
    }
  }

  const meta = body.querySelector('.vault-upload-queue-meta');
  if (meta) {
    const sizeLabel = formatBytes(item.file.size);
    meta.replaceChildren();
    if (item.state === 'uploading') {
      meta.append(document.createTextNode(`${sizeLabel} · `));
      const dest = document.createElement('span');
      dest.className = 'vault-upload-queue-dest';
      dest.textContent = item.folderLabel;
      meta.append(dest);
    } else if (item.state === 'done') {
      meta.append(document.createTextNode(`${sizeLabel} · `));
      const ready = document.createElement('span');
      ready.className = 'vault-upload-queue-ready';
      ready.textContent = t('cloudUploadReady');
      meta.append(ready);
    } else if (item.state === 'error') {
      meta.textContent = `${sizeLabel} · ${item.error || t('cloudUploadFailed')}`;
    } else {
      meta.append(document.createTextNode(`${sizeLabel} · `));
      const queued = document.createElement('span');
      queued.className = 'vault-upload-queue-queued';
      queued.textContent = t('cloudUploadQueued');
      meta.append(queued);
    }
  }

  const detail = body.querySelector('.vault-upload-queue-detail') as HTMLElement | null;
  if (item.state === 'uploading') {
    const { track, fill } = ensureQueueTrack(body);
    track.classList.remove('is-done');
    animateFillWidth(fill, item.progress);
    const pct = Math.max(0, Math.min(100, Math.round(item.progress)));
    if (detail) {
      detail.hidden = false;
      detail.textContent = t('cloudUploadProgressDetail', {
        percent: String(pct),
        loaded: formatBytes(item.sizeUploaded),
        total: formatBytes(item.file.size),
      });
    } else {
      const nextDetail = document.createElement('div');
      nextDetail.className = 'vault-upload-queue-detail';
      nextDetail.textContent = t('cloudUploadProgressDetail', {
        percent: String(pct),
        loaded: formatBytes(item.sizeUploaded),
        total: formatBytes(item.file.size),
      });
      body.append(nextDetail);
    }
  } else if (item.state === 'done') {
    const { track, fill } = ensureQueueTrack(body);
    animateFillWidth(fill, 100);
    track.classList.add('is-done');
    if (detail) detail.remove();
  } else {
    body.querySelector('.vault-upload-queue-track')?.remove();
    detail?.remove();
  }

  const actions = card.querySelector('.vault-upload-queue-actions');
  if (actions) {
    const dismiss = actions.querySelector('.vault-upload-queue-dismiss') as HTMLButtonElement | null;
    if (item.state === 'uploading') {
      dismiss?.remove();
    } else if (!dismiss) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vault-upload-queue-dismiss';
      btn.setAttribute('aria-label', t('cloudCancel'));
      btn.append(svgIcon('M6 6l12 12M18 6 6 18'));
      btn.addEventListener('click', () => dismissUploadItem(item.key));
      actions.append(btn);
    }
  }
}

function buildUploadQueueCard(item: UploadQueueItem): HTMLElement {
  const card = document.createElement('div');
  card.className = `vault-upload-queue-card is-${item.state}`;
  card.dataset.format = item.format;
  card.dataset.key = item.key;
  card.dataset.state = item.state;

  const iconWrap = document.createElement('div');
  iconWrap.className = 'vault-upload-queue-icon';
  iconWrap.append(formatIcon(item.format));

  const body = document.createElement('div');
  body.className = 'vault-upload-queue-body';

  const titleRow = document.createElement('div');
  titleRow.className = 'vault-upload-queue-title-row';
  const name = document.createElement('span');
  name.className = 'vault-upload-queue-name';
  name.textContent = item.file.name;
  name.title = item.file.name;
  titleRow.append(name);

  const meta = document.createElement('p');
  meta.className = 'vault-upload-queue-meta';

  body.append(titleRow, meta);

  const actions = document.createElement('div');
  actions.className = 'vault-upload-queue-actions';

  card.append(iconWrap, body, actions);
  // Populate dynamic bits (fill starts at 0%, then sync animates to target).
  syncUploadQueueCard(card, item);
  if (item.state === 'done' || item.state === 'uploading') {
    const fill = card.querySelector('.vault-upload-queue-fill') as HTMLElement | null;
    if (fill) {
      const target = item.state === 'done' ? 100 : item.progress;
      fill.style.width = '0%';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => animateFillWidth(fill, target));
      });
    }
  }
  return card;
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
  const accepted = items.filter((item) => formatFromTitle(item.file.name));
  const skipped = items.length - accepted.length;
  if (accepted.length === 0) {
    if (skipped > 0) notifyError(t('cloudUploadTypeError'));
    return;
  }

  uploadBusy = true;
  setUploadButtonsDisabled(true);
  cancelUploadQueueHide();
  uploadQueue = accepted.map((item) => {
    uploadQueueKey += 1;
    const format = formatFromTitle(item.file.name)!;
    return {
      key: `up-${uploadQueueKey}`,
      file: item.file,
      relativeDir: item.relativeDir,
      format,
      folderLabel: folderLabelFor(baseParentId, item.relativeDir),
      state: 'queued' as const,
      progress: 0,
      sizeUploaded: 0,
    };
  });
  paintUploadProgress();

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

    const keys = uploadQueue.map((row) => row.key);
    for (const key of keys) {
      const item = uploadQueue.find((row) => row.key === key);
      if (!item || item.state !== 'queued') continue;
      item.state = 'uploading';
      item.progress = 0;
      item.sizeUploaded = 0;
      item.folderLabel = folderLabelFor(baseParentId, item.relativeDir);
      paintUploadProgress();
      try {
        const segments = item.relativeDir.split('/').filter(Boolean);
        const parentId = await ensureFolderPath(baseParentId, segments);
        item.folderLabel = folderLabelFor(parentId, '');
        const sortOrder = nextSortOrder(childrenOf(parentId));
        const workbook = await createWorkbookFromFile(
          item.file,
          item.file.name,
          parentId,
          sortOrder,
          (progress) => {
            item.progress = progress.progress;
            item.sizeUploaded = progress.sizeUploaded;
            paintUploadProgress();
          },
        );
        rows = [workbook, ...rows.filter((row) => row.id !== workbook.id)];
        item.state = 'done';
        item.progress = 100;
        item.sizeUploaded = item.file.size;
        item.workbookId = workbook.id;
        paintDocs();
        paintStorage();
        if (!selectedWorkbook()) paintStage();
        paintUploadProgress();
      } catch (error) {
        item.state = 'error';
        item.error = error instanceof Error ? error.message : String(error);
        paintUploadProgress();
        notifyError(item.error);
      }
    }

    revealTreeSelection();
    syncUrl();
    paint();
    paintUploadProgress();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notifyError(message);
    paint();
    paintUploadProgress();
  } finally {
    uploadBusy = false;
    setUploadButtonsDisabled(false);
    paintUploadProgress();
    scheduleUploadQueueHideIfIdle();
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
      // Same-tab: storage events do not fire in the writer. Push the shell
      // theme into the embedded OnlyOffice frames (force past an in-editor pick).
      applySiteThemeToEditor(DEFAULT_UI_THEME, window, { force: true });
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
    applySiteThemeToEditor(DEFAULT_UI_THEME, window, { force: true });
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
          (() => {
            const head = document.createElement('div');
            head.className = 'vault-stage-empty-head';
            head.id = 'workspace-stage-empty-head';
            head.hidden = true;
            const title = document.createElement('h2');
            title.className = 'vault-stage-browser-title';
            title.id = 'workspace-stage-empty-title';
            head.append(title);
            return head;
          })(),
          (() => {
            const copy = document.createElement('div');
            copy.className = 'vault-stage-empty-copy';
            copy.id = 'workspace-stage-empty-copy';

            const headline = document.createElement('h2');
            headline.className = 'vault-stage-drop-headline';
            headline.id = 'workspace-stage-drop-headline';
            headline.textContent = t('cloudDropHeadline');

            const actions = document.createElement('div');
            actions.className = 'vault-stage-empty-actions';
            actions.id = 'workspace-stage-empty-actions';

            const uploadBtn = document.createElement('button');
            uploadBtn.type = 'button';
            uploadBtn.className = 'vault-stage-action vault-stage-action-primary';
            uploadBtn.id = 'workspace-stage-upload';
            uploadBtn.append(
              svgIcon('M12 3v12M8 7l4-4 4 4M5 15v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3'),
              document.createTextNode(t('cloudBrowseLocal')),
            );
            uploadBtn.addEventListener('click', () => pickUploadFiles());

            const newBtn = document.createElement('button');
            newBtn.type = 'button';
            newBtn.className = 'vault-stage-action vault-stage-action-secondary';
            newBtn.id = 'workspace-stage-new';
            newBtn.setAttribute('aria-haspopup', 'menu');
            newBtn.setAttribute('aria-expanded', 'false');
            newBtn.setAttribute('aria-controls', 'workspace-new-menu');
            newBtn.append(svgIcon('M12 5v14M5 12h14'), document.createTextNode(t('cloudNew')));
            newBtn.addEventListener('click', () => {
              openNewMenuAt(newBtn, { key: 'workspace-stage-new' });
            });

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

            actions.append(uploadBtn, newBtn, fileInput);

            const searchEmpty = document.createElement('p');
            searchEmpty.id = 'workspace-stage-search-empty';
            searchEmpty.hidden = true;

            copy.append(buildEmptyDropArt(), headline, buildDropFormatsLine(), actions, searchEmpty);
            return copy;
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
            const overlay = document.createElement('div');
            overlay.className = 'vault-stage-overlay';
            overlay.id = 'workspace-stage-overlay';
            overlay.hidden = true;
            overlay.setAttribute('role', 'status');
            overlay.setAttribute('aria-live', 'polite');
            overlay.setAttribute('aria-busy', 'false');

            const panel = document.createElement('div');
            panel.className = 'vault-stage-overlay-panel';

            const mark = document.createElement('div');
            mark.className = 'vault-stage-overlay-mark';
            mark.id = 'workspace-stage-overlay-mark';
            mark.setAttribute('aria-hidden', 'true');
            const spinner = document.createElement('span');
            spinner.className = 'vault-stage-overlay-spinner';
            mark.append(spinner);

            const title = document.createElement('p');
            title.className = 'vault-stage-overlay-title';
            title.id = 'workspace-stage-overlay-title';

            const body = document.createElement('p');
            body.className = 'vault-stage-overlay-body';
            body.id = 'workspace-stage-overlay-body';

            panel.append(mark, title, body);
            overlay.append(panel);
            return overlay;
          })(),
        )
        .build(),
      (() => {
        const panel = document.createElement('div');
        panel.className = 'vault-upload-progress';
        panel.id = 'workspace-upload-progress';
        panel.hidden = true;
        panel.setAttribute('role', 'status');
        panel.setAttribute('aria-live', 'polite');

        const head = document.createElement('div');
        head.className = 'vault-upload-queue-head';
        const title = document.createElement('h3');
        title.className = 'vault-upload-queue-title';
        title.textContent = t('cloudUploadQueue');
        const badge = document.createElement('span');
        badge.className = 'vault-upload-queue-badge';
        badge.id = 'workspace-upload-queue-badge';
        head.append(title, badge);

        const list = document.createElement('div');
        list.className = 'vault-upload-queue-list';
        list.id = 'workspace-upload-queue-list';

        const foot = document.createElement('div');
        foot.className = 'vault-upload-queue-foot';
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'vault-upload-queue-clear';
        clearBtn.id = 'workspace-upload-queue-clear';
        clearBtn.hidden = true;
        clearBtn.addEventListener('click', () => clearCompletedUploads());
        foot.append(clearBtn);

        panel.append(head, list, foot);
        return panel;
      })(),
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
      if (event.data.type === SHELL_FRAME_READY) {
        const frame = document.getElementById('workspace-editor-frame') as HTMLIFrameElement | null;
        onShellFrameReady(frame || undefined);
        return;
      }
      if (event.data.workbookId !== selectedId) return;
      if (event.data.type === SHELL_NEED_PAYLOAD) {
        const frame = document.getElementById('workspace-editor-frame') as HTMLIFrameElement | null;
        if (frame) onShellNeedPayload(event.data.workbookId, frame);
        return;
      }
      if (event.data.type === SHELL_READY) {
        clearOpenWatchers();
        stageStatus = 'ready';
        stageError = '';
        paintOverlay();
        const overlayMs = shellOpenStartedAt ? Math.round(performance.now() - shellOpenStartedAt) : undefined;
        const iframeLoadMs =
          shellOpenStartedAt && shellIframeLoadAt ? Math.round(shellIframeLoadAt - shellOpenStartedAt) : undefined;
        const bundleBootMs =
          shellIframeLoadAt && shellBundleBootAt ? Math.round(shellBundleBootAt - shellIframeLoadAt) : undefined;
        const frameTiming = event.data.timing;
        if (frameTiming && typeof overlayMs === 'number') {
          const merged = mergeShellOverlayTiming(frameTiming, {
            overlayMs,
            iframeLoadMs,
            bundleBootMs,
          });
          publishOpenTiming(merged);
        } else if (typeof overlayMs === 'number') {
          const shellOnly: OpenTimingReport = {
            workbookId: event.data.workbookId,
            t0: shellOpenStartedAt,
            marks: {},
            segments: [
              ...(typeof iframeLoadMs === 'number' ? [{ name: 'shell: iframe load', ms: iframeLoadMs }] : []),
              ...(typeof bundleBootMs === 'number'
                ? [{ name: 'shell: bundle boot (after load)', ms: bundleBootMs }]
                : []),
              { name: 'shell: overlay total', ms: overlayMs },
            ],
            totalMs: overlayMs,
            overlayMs,
            iframeLoadMs,
            bundleBootMs,
          };
          publishOpenTiming(shellOnly);
        }
        // Themes API is only ready after the frame boots — sync shell appearance.
        applySiteThemeToEditor(DEFAULT_UI_THEME, window, { force: true });
      } else if (event.data.type === SHELL_FAILED) {
        clearOpenWatchers();
        stageStatus = 'error';
        stageError = event.data.message;
        notifyError(`${t('cloudOpenFailed')}${event.data.message}`);
        paintOverlay();
      } else if (event.data.type === SHELL_SAVE_STATE) {
        setSaveStatus(event.data.state, event.data.message);
        // Keep sidebar fileId in sync with Save rotations so the open cache
        // (keyed by fileId) still hits after a round-trip.
        if (event.data.state === 'saved') {
          const id = event.data.workbookId;
          void getWorkbook(id)
            .then((fresh) => {
              rows = rows.map((row) => (row.id === fresh.id ? fresh : row));
              if (openWorkbook?.id === fresh.id) openWorkbook = fresh;
            })
            .catch(() => {
              /* list refresh is best-effort */
            });
        }
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

/** Cancels an in-flight overlay leave so a new open can enter cleanly. */
let overlayLeaveGen = 0;
let overlayLeaveTimer = 0;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function cancelOverlayLeave(overlay: HTMLElement): void {
  overlayLeaveGen += 1;
  if (overlayLeaveTimer) {
    window.clearTimeout(overlayLeaveTimer);
    overlayLeaveTimer = 0;
  }
  overlay.classList.remove('is-leaving');
}

/** Show the overlay with an enter animation when coming from hidden/leaving. */
function revealOverlay(overlay: HTMLElement): void {
  const wasAway = overlay.hidden || overlay.classList.contains('is-leaving');
  cancelOverlayLeave(overlay);
  overlay.hidden = false;
  if (wasAway) {
    overlay.classList.remove('is-open');
    // Force a style flush so the enter animation restarts.
    void overlay.offsetWidth;
  }
  overlay.classList.add('is-open');
}

/**
 * Play the leave animation, then hide. Content clear runs after hide so the
 * exit still shows the last title/progress.
 */
function dismissOverlay(
  overlay: HTMLElement,
  afterHide: () => void,
  options: { complete?: boolean } = {},
): void {
  if (overlay.hidden && !overlay.classList.contains('is-leaving')) {
    afterHide();
    return;
  }
  if (overlay.classList.contains('is-leaving')) return;

  if (options.complete) {
    const mark = document.getElementById('workspace-stage-overlay-mark');
    if (mark && mark.dataset.kind !== 'done') {
      mark.dataset.kind = 'done';
      mark.replaceChildren(svgIcon('M5 12l5 5L20 7', 'vault-icon vault-stage-overlay-check'));
    }
  }

  const token = ++overlayLeaveGen;
  const finish = (): void => {
    if (token !== overlayLeaveGen) return;
    if (overlayLeaveTimer) {
      window.clearTimeout(overlayLeaveTimer);
      overlayLeaveTimer = 0;
    }
    overlay.hidden = true;
    overlay.classList.remove('is-leaving', 'is-open');
    afterHide();
  };

  if (prefersReducedMotion()) {
    finish();
    return;
  }

  const startLeave = (): void => {
    if (token !== overlayLeaveGen) return;
    // Keep `is-open` until finish so removing it does not snap opacity to 0
    // before the leave animation can take over.
    overlay.classList.add('is-leaving');
    overlay.setAttribute('aria-busy', 'false');

    const onEnd = (event: AnimationEvent): void => {
      if (event.target !== overlay) return;
      overlay.removeEventListener('animationend', onEnd);
      finish();
    };
    overlay.addEventListener('animationend', onEnd);
    overlayLeaveTimer = window.setTimeout(finish, 320);
  };

  // Brief beat so the checkmark reads before fade-out.
  if (options.complete) {
    overlayLeaveTimer = window.setTimeout(startLeave, 120);
  } else {
    startLeave();
  }
}

function paintOverlay(): void {
  const overlay = document.getElementById('workspace-stage-overlay');
  const title = document.getElementById('workspace-stage-overlay-title');
  const body = document.getElementById('workspace-stage-overlay-body');
  const mark = document.getElementById('workspace-stage-overlay-mark');
  if (!overlay || !title || !body) return;

  const workbookTitle =
    openWorkbook?.title ||
    rows.find((row) => row.id === selectedId && row.kind === 'file')?.title ||
    '';

  const clearOverlayCopy = (): void => {
    overlay.dataset.state = stageStatus;
    overlay.setAttribute('aria-busy', 'false');
    overlay.removeAttribute('aria-label');
    title.textContent = '';
    body.textContent = '';
  };

  if (stageStatus === 'loading') {
    revealOverlay(overlay);
    overlay.dataset.state = 'loading';
    overlay.setAttribute('aria-busy', 'true');
    overlay.setAttribute(
      'aria-label',
      workbookTitle ? `${t('cloudOpeningWorkbook')} ${workbookTitle}` : t('cloudOpeningWorkbook'),
    );
    title.textContent = workbookTitle || t('cloudOpeningWorkbook');
    body.textContent = t('cloudOpeningWorkbook');
    if (mark && mark.dataset.kind !== 'loading') {
      mark.dataset.kind = 'loading';
      mark.replaceChildren();
      const spinner = document.createElement('span');
      spinner.className = 'vault-stage-overlay-spinner';
      mark.append(spinner);
    }
    return;
  }

  if (stageStatus === 'error') {
    revealOverlay(overlay);
    overlay.dataset.state = 'error';
    overlay.setAttribute('aria-busy', 'false');
    overlay.setAttribute('aria-label', t('cloudOpenFailedTitle'));
    title.textContent = t('cloudOpenFailedTitle');
    body.textContent = stageError || t('cloudOpenFailed');
    if (mark) {
      mark.dataset.kind = 'error';
      mark.replaceChildren(
        svgIcon(
          'M12 9v4M12 17h.01M10.3 4.3 2.6 18a1.5 1.5 0 0 0 1.3 2.25h16.2a1.5 1.5 0 0 0 1.3-2.25L13.7 4.3a1.5 1.5 0 0 0-2.6 0z',
        ),
      );
    }
    return;
  }

  // ready / idle — animate out, then clear.
  dismissOverlay(overlay, clearOverlayCopy, { complete: stageStatus === 'ready' });
}

function paintFolderTitle(title: HTMLElement): void {
  title.replaceChildren();
  title.classList.toggle('is-root', !currentFolderId);
  const folderIcon = currentFolderId
    ? svgIcon(
        'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z',
        'vault-icon vault-stage-browser-folder-icon',
      )
    : svgIcon('M4 4h16v16H4zM4 10h16', 'vault-icon vault-stage-browser-folder-icon');
  const label = document.createElement('span');
  label.className = 'vault-stage-browser-title-text';
  label.textContent = currentFolderTitle();
  title.append(folderIcon, label);
}

function paintStageBrowser(items: VaultItem[]): void {
  const browser = document.getElementById('workspace-stage-browser');
  const title = document.getElementById('workspace-stage-browser-title');
  const list = document.getElementById('workspace-stage-browser-list');
  const tools = document.getElementById('workspace-stage-browser-tools');
  const actions = document.getElementById('workspace-stage-empty-actions');
  if (!browser || !title || !list) return;

  paintFolderTitle(title);
  if (tools && actions && actions.parentElement !== tools) {
    tools.replaceChildren(actions);
  }
  // Compact header actions: New first, then Upload label.
  const newBtn = document.getElementById('workspace-stage-new');
  const uploadBtn = document.getElementById('workspace-stage-upload');
  if (newBtn && uploadBtn && actions) {
    newBtn.classList.remove('vault-stage-action-secondary');
    newBtn.classList.add('vault-stage-action-primary');
    uploadBtn.classList.remove('vault-stage-action-primary');
    const uploadLabel = uploadBtn.childNodes[uploadBtn.childNodes.length - 1];
    if (uploadLabel?.nodeType === Node.TEXT_NODE) uploadLabel.textContent = t('cloudUpload');
    actions.prepend(newBtn);
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

function restoreEmptyHeroActions(): void {
  const copy = document.getElementById('workspace-stage-empty-copy');
  const actions = document.getElementById('workspace-stage-empty-actions');
  const searchEmpty = document.getElementById('workspace-stage-search-empty');
  const newBtn = document.getElementById('workspace-stage-new');
  const uploadBtn = document.getElementById('workspace-stage-upload');
  const fileInput = document.getElementById('workspace-upload-input');
  if (!copy || !actions) return;
  if (uploadBtn && newBtn) {
    uploadBtn.classList.add('vault-stage-action-primary');
    newBtn.classList.remove('vault-stage-action-primary');
    newBtn.classList.add('vault-stage-action-secondary');
    const uploadLabel = uploadBtn.childNodes[uploadBtn.childNodes.length - 1];
    if (uploadLabel?.nodeType === Node.TEXT_NODE) uploadLabel.textContent = t('cloudBrowseLocal');
    actions.replaceChildren(uploadBtn, newBtn);
    if (fileInput) actions.append(fileInput);
  }
  if (actions.parentElement !== copy) {
    if (searchEmpty) copy.insertBefore(actions, searchEmpty);
    else copy.append(actions);
  }
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
    clearShellOpenHandoff();
    // Keep a previously warmed editor alive (src stays) so the next open can
    // push open-payload without remounting. Do not prefetch a cold frame here:
    // that would consume the first navigation (and confuse boot remount tests).
    frame.dataset.workbook = '';
    const copy = document.getElementById('workspace-stage-empty-copy');
    const emptyHead = document.getElementById('workspace-stage-empty-head');
    const emptyTitle = document.getElementById('workspace-stage-empty-title');
    const browser = document.getElementById('workspace-stage-browser');
    const skeleton = document.getElementById('workspace-stage-skeleton');
    const searchEmpty = document.getElementById('workspace-stage-search-empty');
    const dropArt = copy?.querySelector('.vault-stage-drop-art') as HTMLElement | null;
    const headline = document.getElementById('workspace-stage-drop-headline');
    const formats = document.getElementById('workspace-stage-drop-formats');
    const actions = document.getElementById('workspace-stage-empty-actions');
    const searching = Boolean(query.trim());
    const children = searching ? [] : childrenOf(currentFolderId);
    const folderEmpty = !searching && children.length === 0;

    if (browser) browser.hidden = true;
    if (loading) {
      empty.classList.remove('is-browser', 'is-empty');
      empty.classList.add('is-skeleton');
      if (copy) copy.hidden = true;
      if (emptyHead) emptyHead.hidden = true;
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
      if (emptyHead) emptyHead.hidden = true;
      paintStageBrowser(children);
    } else {
      if (copy) copy.hidden = false;
      if (emptyHead) emptyHead.hidden = searching;
      if (emptyTitle && !searching) paintFolderTitle(emptyTitle);
      restoreEmptyHeroActions();
      if (dropArt) dropArt.hidden = searching;
      if (headline) headline.hidden = searching;
      if (formats) formats.hidden = searching;
      if (actions) actions.hidden = searching;
      if (searchEmpty) {
        searchEmpty.hidden = !searching;
        searchEmpty.textContent = searching ? t('cloudEmptySearch') : '';
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

  if (frame.dataset.workbook === workbook.id && stageStatus === 'ready') {
    paintOverlay();
    return;
  }
  stageStatus = 'loading';
  stageError = '';
  frame.dataset.workbook = workbook.id;
  frame.title = workbook.title;
  // Start Storage / pending fetch immediately; the warm host receives bytes via
  // open-payload once frame-ready (or immediately when already warm).
  beginShellOpenHandoff(workbook, handoffMeta());
  const warmMounted = frame.dataset.warm === '1' && Boolean(frame.getAttribute('src'));
  if (warmMounted && isShellFrameReady()) {
    watchEditorOpen(frame, workbook.id, { watchBoot: false });
    onShellFrameReady(frame);
  } else {
    // Cold mount, or replace a stalled/blank warm frame (load already fired
    // without frame-ready — remount so the boot watchdog can run).
    mountWarmEditorFrame(frame, {
      bootToken: warmMounted ? Date.now() : undefined,
      watchBoot: true,
    });
  }
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
