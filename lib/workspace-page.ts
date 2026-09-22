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
import { createBlankFile, createFolder, deleteVaultItem, listVaultItems, renameVaultItem, type VaultItem, type Workbook } from './appwrite/workbooks';
import type { VaultFormat } from './appwrite/ids';
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
    const rootFiles = childrenOf('').filter((row) => row.kind === 'file');
    if (!selectedId && !query && rootFiles[0] && !currentFolderId) {
      selectedId = rootFiles[0].id;
      stageStatus = 'loading';
      stageError = '';
    }
    revealTreeSelection();
    syncUrl();
    paint();
  }
}

function childrenOf(parentId: string): VaultItem[] {
  return rows.filter((row) => (row.parentId || '') === parentId);
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
    const workbook = await createBlankFile(format, { parentId: currentFolderId });
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
    const folder = await createFolder(t('cloudFolderUntitled'), currentFolderId);
    rows = [folder, ...rows.filter((row) => row.id !== folder.id)];
    openFolder(folder.id);
    startRename(folder.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notifyError(message);
  }
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
  const next = raw.trim();
  if (!next || next === item.title) {
    paintDocs();
    return;
  }
  try {
    const updated = await renameVaultItem(id, next);
    rows = rows.map((row) => (row.id === id ? updated : row));
    if (selectedId === id) {
      openWorkbook = updated.kind === 'file' && updated.format ? (updated as Workbook) : openWorkbook;
      document.title = updated.title;
      const frame = document.getElementById('workspace-editor-frame') as HTMLIFrameElement | null;
      if (frame?.dataset.workbook === id) frame.title = updated.title;
    }
    paint();
  } catch (error) {
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
  const trigger = document.getElementById('workspace-new');
  if (menu) {
    menu.classList.remove('is-shown');
    menu.hidden = true;
    menu.style.top = '';
    menu.style.left = '';
    menu.style.width = '';
    delete menu.dataset.anchor;
  }
  trigger?.setAttribute('aria-expanded', 'false');
  document.querySelectorAll<HTMLElement>('.vault-tree-add[aria-expanded="true"]').forEach((el) => {
    el.setAttribute('aria-expanded', 'false');
  });
  document.removeEventListener('pointerdown', onNewMenuPointerDown, true);
  document.removeEventListener('keydown', onNewMenuKeyDown, true);
}

function onNewMenuPointerDown(event: PointerEvent): void {
  const menu = document.getElementById('workspace-new-menu');
  const trigger = document.getElementById('workspace-new');
  const target = event.target as Node | null;
  if (!menu || !target) return;
  if (menu.contains(target)) return;
  if (trigger?.contains(target)) return;
  if (target instanceof Element && target.closest('.vault-tree-add')) return;
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
          Div()
            .children(
              View('h2').text(t('cloudEmptyTitle')).build(),
              View('p').text(t('cloudEmpty')).build(),
            )
            .build(),
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

function paintDocs(): void {
  const host = document.getElementById('workspace-docs');
  if (!host) return;
  closeNewMenu();
  closeContextMenu();
  host.replaceChildren();
  if (loading) {
    const pending = document.createElement('p');
    pending.className = 'vault-empty';
    pending.textContent = '…';
    host.append(pending);
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
    const heading = empty.querySelector('h2');
    const copy = empty.querySelector('p');
    if (heading) heading.textContent = query ? t('cloudEmptySearchTitle') : t('cloudEmptyTitle');
    if (copy) copy.textContent = query ? t('cloudEmptySearch') : t('cloudSelectWorkbook');
    document.title = t('cloudFilesTitle');
    paintOverlay();
    return;
  }

  empty.hidden = true;
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
