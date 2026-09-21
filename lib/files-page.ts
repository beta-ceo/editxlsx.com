/**
 * /files -- cloud workbook shell: sidebar library and the editor beside it.
 *
 * Requires a signed-in session; anonymous visitors are sent to /login.
 * The editor runs in a same-origin iframe (`?shell=1`) so Save still writes
 * to the account. See `isAppShellFrame`.
 */
import 'ranui/button';
import 'ranui/input';
import 'ranui/message';
import { Div, View } from 'ranui/builder';
import { saveFileToDisk } from 'ranuts/utils';
import '../styles/files.css';
import { applyDocumentLanguage, getLanguage, t, withLocale } from '@ranuts/shared/i18n';
import { getCurrentUser, signOut, type AuthUser } from './appwrite/auth';
import {
  createBlankWorkbook,
  createWorkbookFromFile,
  deleteWorkbook,
  downloadWorkbookFile,
  listWorkbooks,
  type Workbook,
} from './appwrite/workbooks';
import { confirmDialog } from './confirm-dialog';
import { formatRelativeTime } from './history/recovery';
import { isShellBridgeMessage, SHELL_FAILED, SHELL_READY } from './shell-bridge';

const SEARCH_DEBOUNCE_MS = 200;
/** Visual scale for the sidebar meter. The client has no account quota. */
const STORAGE_SCALE_BYTES = 1024 * 1024 * 1024;

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
let rows: Workbook[] = [];
let loading = true;
let selectedId = '';
let openWorkbook: Workbook | null = null;
let shellReady = false;
/** Editor pane while a framed workbook is opening. */
let stageStatus: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
let stageError = '';
let bridgeListening = false;

function root(): HTMLElement {
  return document.getElementById('files-root') as HTMLElement;
}

function loginUrl(): string {
  const locale = new URLSearchParams(window.location.search).get('locale');
  return locale ? `/login?locale=${encodeURIComponent(locale)}` : '/login';
}

function editorFrameUrl(workbookId: string): string {
  return withLocale(`/editor?workbook=${encodeURIComponent(workbookId)}&shell=1`, getLanguage());
}

function appPath(path: string): string {
  return withLocale(path, getLanguage());
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

function selectedWorkbook(): Workbook | undefined {
  const found = rows.find((row) => row.id === selectedId);
  if (found) openWorkbook = found;
  if (!selectedId) openWorkbook = null;
  return openWorkbook?.id === selectedId ? openWorkbook : undefined;
}

function syncUrl(): void {
  const url = new URL(window.location.href);
  if (query) url.searchParams.set('q', query);
  else url.searchParams.delete('q');
  if (selectedId) url.searchParams.set('workbook', selectedId);
  else url.searchParams.delete('workbook');
  window.history.replaceState(null, '', url);
}

function readUrl(): void {
  const params = new URLSearchParams(window.location.search);
  query = params.get('q') ?? '';
  selectedId = params.get('workbook') ?? '';
}

function rememberLocale(locale: string): void {
  try {
    document.cookie = `locale=${encodeURIComponent(locale)};path=/;max-age=31536000;samesite=lax`;
  } catch {
    /* The URL still carries the language. */
  }
}

function svgIcon(path: string): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'vault-icon');
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

function iconSlot(path: string, className?: string): HTMLElement {
  const slot = document.createElement('span');
  const icon = svgIcon(path);
  if (className) icon.classList.add(className);
  slot.append(icon);
  return slot;
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
  paint();
  try {
    rows = await listWorkbooks({ search: query });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notifyError(message);
    rows = [];
  } finally {
    loading = false;
    if (selectedId && !rows.some((row) => row.id === selectedId) && !query) {
      selectedId = '';
      openWorkbook = null;
      stageStatus = 'idle';
      stageError = '';
    }
    if (!selectedId && !query && rows[0]) {
      selectedId = rows[0].id;
      stageStatus = 'loading';
      stageError = '';
    }
    syncUrl();
    paint();
  }
}

function selectWorkbook(id: string): void {
  if (selectedId !== id) {
    stageStatus = 'loading';
    stageError = '';
  }
  selectedId = id;
  syncUrl();
  paint();
}

async function onNew(): Promise<void> {
  try {
    const workbook = await createBlankWorkbook();
    rows = [workbook, ...rows.filter((row) => row.id !== workbook.id)];
    stageStatus = 'loading';
    stageError = '';
    selectedId = workbook.id;
    syncUrl();
    paint();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notifyError(message);
  }
}

function onUpload(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  input.style.display = 'none';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    void (async () => {
      try {
        const workbook = await createWorkbookFromFile(file);
        rows = [workbook, ...rows.filter((row) => row.id !== workbook.id)];
        stageStatus = 'loading';
        stageError = '';
        selectedId = workbook.id;
        syncUrl();
        paint();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        notifyError(message);
      }
    })();
  });
  document.body.appendChild(input);
  input.click();
}

async function onDelete(): Promise<void> {
  const workbook = selectedWorkbook();
  if (!workbook) return;
  const ok = await confirmDialog({
    title: t('cloudDeleteTitle'),
    body: t('cloudDeleteConfirm', { title: workbook.title }),
    confirmLabel: t('cloudDelete'),
    cancelLabel: t('cloudCancel'),
    danger: true,
  });
  if (!ok) return;
  try {
    await deleteWorkbook(workbook.id);
    if (selectedId === workbook.id) {
      selectedId = '';
      openWorkbook = null;
      stageStatus = 'idle';
      stageError = '';
    }
    await refresh();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notifyError(message);
  }
}

async function onExport(): Promise<void> {
  const workbook = selectedWorkbook();
  if (!workbook) return;
  try {
    const file = await downloadWorkbookFile(workbook.fileId, workbook.title);
    await saveFileToDisk(file, file.name);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notifyError(message);
  }
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
  const account = user;
  const lang = getLanguage();

  const search = View('r-input')
    .attr('placeholder', t('cloudSearchPlaceholder'))
    .attr('value', query)
    .class('files-search')
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
    const href = new URL('/files', window.location.origin);
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
    .class('lang-menu')
    .attr('placement', 'bottom')
    .attr('trigger', 'click')
    .attr('role', 'button')
    .attr('aria-label', 'Language')
    .children(
      View('span')
        .class('lang-trigger')
        .children(
          iconSlot(
            'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3.5 12h17M12 3c2.2 2.4 3.3 5.2 3.3 9s-1.1 6.6-3.3 9c-2.2-2.4-3.3-5.2-3.3-9s1.1-6.6 3.3-9z',
          ),
          View('span')
            .class('lang-current')
            .text(LOCALES.find((item) => item.code === lang)?.label ?? 'English')
            .build(),
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
  menu.append(button(t('cloudSignOut'), () => void onSignOut(), { type: 'text', id: 'files-sign-out' }));
  userMenu.append(summary, menu);

  const top = Div()
    .class('vault-top')
    .children(
      View('a')
        .class('vault-brand')
        .attr('href', appPath('/'))
        .children(
          iconSlot('M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5', 'vault-mark'),
          View('span').text('EditXLSX').build(),
        )
        .build(),
      View('div')
        .class('vault-workspace')
        .children(View('span').text(displayName(account)).build())
        .build(),
      Div()
        .class('vault-search-wrap')
        .children(
          Div().class('vault-search').children(search, View('span').class('vault-kbd').text('⌘K').build()).build(),
        )
        .build(),
      Div()
        .class('vault-tools')
        .children(
          View('a')
            .class('vault-icon-btn')
            .attr('href', appPath('/history'))
            .attr('aria-label', t('cloudColEdited'))
            .children(iconSlot('M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z'))
            .build(),
          View('a')
            .class('vault-icon-btn')
            .attr('href', appPath('/help'))
            .attr('aria-label', t('cloudHelp'))
            .children(
              iconSlot(
                'M9.5 9a2.5 2.5 0 1 1 3.2 2.4c-.8.3-1.2.8-1.2 1.6V14M12 17h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
              ),
            )
            .build(),
          langMenu,
          View('r-theme-switch').class('theme-switch').attr('label', 'Theme').build(),
          userMenu,
        )
        .build(),
    )
    .build();

  const side = Div()
    .class('vault-side')
    .children(
      Div()
        .class('vault-actions')
        .children(
          button(t('cloudOpenEditor'), () => void onNew(), { type: 'primary', id: 'files-new' }),
          button(t('cloudUploadWorkbook'), () => onUpload(), { id: 'files-upload' }),
        )
        .build(),
      View('div').class('vault-section-label').text(t('cloudNavWorkspace')).build(),
      (() => {
        const all = document.createElement('button');
        all.type = 'button';
        all.className = 'vault-nav-btn';
        all.id = 'files-all';
        all.append(svgIcon('M4 6h16M4 12h16M4 18h16'), document.createTextNode(t('cloudAllDocuments')));
        all.addEventListener('click', () => {
          query = '';
          const field = root().querySelector('r-input.files-search') as HTMLElement & { value?: string };
          if (field) field.value = '';
          syncUrl();
          void refresh();
        });
        return all;
      })(),
      View('div').class('vault-section-label').text(t('cloudNavDocuments')).build(),
      Div().class('vault-docs').id('files-docs').build(),
      Div()
        .class('vault-storage')
        .children(
          View('div').class('vault-storage-label').text(t('cloudStorage')).build(),
          Div()
            .class('vault-storage-track')
            .children(Div().class('vault-storage-fill').id('files-storage-fill').build())
            .build(),
          View('p').class('vault-storage-used').id('files-storage-used').text('').build(),
        )
        .build(),
    )
    .build();

  const stage = Div()
    .class('vault-stage')
    .children(
      Div().class('vault-docbar').id('files-docbar').build(),
      Div()
        .class('vault-stage-empty')
        .id('files-stage-empty')
        .children(
          Div()
            .children(View('h2').text(t('cloudEmptyTitle')).build(), View('p').text(t('cloudSelectWorkbook')).build())
            .build(),
        )
        .build(),
      Div()
        .class('vault-frame-wrap')
        .id('files-frame-wrap')
        .children(
          (() => {
            const frame = document.createElement('iframe');
            frame.id = 'files-editor-frame';
            frame.title = t('cloudOpenEditor');
            frame.hidden = true;
            return frame;
          })(),
          (() => {
            const overlay = Div()
              .class('vault-stage-overlay')
              .id('files-stage-overlay')
              .children(
                View('p').class('vault-stage-overlay-title').id('files-stage-overlay-title').text('').build(),
                View('p').class('vault-stage-overlay-body').id('files-stage-overlay-body').text('').build(),
              )
              .build();
            overlay.hidden = true;
            return overlay;
          })(),
        )
        .build(),
    )
    .build();

  root().append(Div().class('vault').children(top, Div().class('vault-body').children(side, stage).build()).build());

  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      root().querySelector<HTMLElement>('r-input.files-search')?.focus();
    }
  });

  if (!bridgeListening) {
    bridgeListening = true;
    window.addEventListener('message', (event) => {
      if (event.origin !== window.location.origin) return;
      if (!isShellBridgeMessage(event.data)) return;
      if (event.data.workbookId !== selectedId) return;
      if (event.data.type === SHELL_READY) {
        stageStatus = 'ready';
        stageError = '';
      } else if (event.data.type === SHELL_FAILED) {
        stageStatus = 'error';
        stageError = event.data.message;
        notifyError(`${t('cloudOpenFailed')}${event.data.message}`);
      }
      paintOverlay();
    });
  }
}

function paintDocs(): void {
  const host = document.getElementById('files-docs');
  const all = document.getElementById('files-all');
  if (!host || !all) return;
  all.classList.toggle('is-current', !query && !selectedId);
  host.replaceChildren();
  if (loading) {
    const pending = document.createElement('p');
    pending.className = 'vault-empty';
    pending.textContent = '…';
    host.append(pending);
    return;
  }
  if (rows.length === 0) {
    const title = document.createElement('p');
    title.className = 'vault-empty';
    title.textContent = query ? t('cloudEmptySearchTitle') : t('cloudEmptyTitle');
    const body = document.createElement('p');
    body.className = 'vault-empty';
    body.textContent = query ? t('cloudEmptySearch') : t('cloudEmpty');
    host.append(title, body);
    return;
  }
  for (const workbook of rows) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = workbook.id === selectedId ? 'vault-doc is-current' : 'vault-doc';
    if (workbook.id === selectedId) item.setAttribute('aria-current', 'true');
    const main = document.createElement('span');
    main.className = 'vault-doc-main';
    const title = document.createElement('span');
    title.className = 'vault-doc-title';
    title.textContent = workbook.title;
    const meta = document.createElement('span');
    meta.className = 'vault-doc-meta';
    meta.textContent = formatBytes(workbook.sizeBytes);
    main.append(title, meta);
    item.append(svgIcon('M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z'), main);
    item.addEventListener('click', () => selectWorkbook(workbook.id));
    host.append(item);
  }
}

function paintStorage(): void {
  const used = document.getElementById('files-storage-used');
  const fill = document.getElementById('files-storage-fill');
  if (!used || !fill) return;
  const bytes = rows.reduce((sum, row) => sum + row.sizeBytes, 0);
  used.textContent = t('cloudStorageUsed', { size: formatBytes(bytes) });
  const ratio = Math.max(0, Math.min(1, bytes / STORAGE_SCALE_BYTES));
  fill.style.width = `${Math.round(ratio * 1000) / 10}%`;
}

function paintOverlay(): void {
  const overlay = document.getElementById('files-stage-overlay');
  const title = document.getElementById('files-stage-overlay-title');
  const body = document.getElementById('files-stage-overlay-body');
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
  const bar = document.getElementById('files-docbar');
  const empty = document.getElementById('files-stage-empty');
  const wrap = document.getElementById('files-frame-wrap');
  const frame = document.getElementById('files-editor-frame') as HTMLIFrameElement | null;
  if (!bar || !empty || !wrap || !frame) return;
  const workbook = selectedWorkbook();
  if (!workbook && loading && frame.dataset.workbook) return;
  bar.replaceChildren();
  if (!workbook) {
    empty.hidden = false;
    wrap.hidden = true;
    frame.hidden = true;
    stageStatus = 'idle';
    stageError = '';
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

  const icon = svgIcon('M4 4h16v16H4zM4 9h16M9 9v11');
  icon.classList.add('vault-sheet-icon');
  const main = document.createElement('div');
  main.className = 'vault-docbar-main';
  const title = document.createElement('h1');
  title.className = 'vault-filename';
  title.textContent = workbook.title;
  const status = document.createElement('p');
  status.className = 'vault-doc-status';
  status.textContent = `${t('cloudSavedWhen', { when: formatRelativeTime(Date.parse(workbook.updatedAt)) })} · ${formatBytes(workbook.sizeBytes)}`;
  main.append(title, status);
  const actions = document.createElement('div');
  actions.className = 'vault-docbar-actions';
  actions.append(
    button(t('cloudDelete'), () => void onDelete(), { type: 'text' }),
    button(t('cloudExport'), () => void onExport(), { type: 'primary', id: 'files-export' }),
  );
  bar.append(icon, main, actions);

  if (frame.dataset.workbook === workbook.id) {
    paintOverlay();
    return;
  }
  stageStatus = 'loading';
  stageError = '';
  frame.dataset.workbook = workbook.id;
  frame.title = workbook.title;
  frame.src = editorFrameUrl(workbook.id);
  paintOverlay();
}

function paint(): void {
  if (!user) return;
  mountShell();
  paintDocs();
  paintStorage();
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
