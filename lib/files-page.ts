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
import { getTheme, initTheme, setTheme, type RanThemeName } from 'ranui/theme';
import '../styles/files.css';
import { applyDocumentLanguage, getLanguage, t, withLocale } from '@ranuts/shared/i18n';
import { getCurrentUser, signOut, type AuthUser } from './appwrite/auth';
import { createBlankWorkbook, listWorkbooks, type Workbook } from './appwrite/workbooks';
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
/** When true, do not auto-open the newest workbook (Home is showing). */
let preferHome = false;
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
    if (!selectedId && !query && rows[0] && !preferHome) {
      selectedId = rows[0].id;
      stageStatus = 'loading';
      stageError = '';
    }
    syncUrl();
    paint();
  }
}

function selectWorkbook(id: string): void {
  preferHome = false;
  if (selectedId !== id) {
    stageStatus = 'loading';
    stageError = '';
  }
  selectedId = id;
  syncUrl();
  paint();
}

function showHome(): void {
  preferHome = true;
  selectedId = '';
  openWorkbook = null;
  stageStatus = 'idle';
  stageError = '';
  syncUrl();
  paint();
}

async function onNew(): Promise<void> {
  try {
    preferHome = false;
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
  menu.append(button(t('cloudSignOut'), () => void onSignOut(), { type: 'text', id: 'files-sign-out' }));
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
      Div()
        .class('vault-tools')
        .children(langMenu, themeMenu, userMenu)
        .build(),
    )
    .build();

  const newMenu = document.createElement('details');
  newMenu.className = 'vault-new';
  const newSummary = document.createElement('summary');
  newSummary.id = 'files-new';
  const newChevron = svgIcon('M6 9l6 6 6-6');
  newChevron.classList.add('vault-new-chevron');
  newSummary.append(
    svgIcon('M12 5v14M5 12h14'),
    document.createTextNode(t('cloudNew')),
    newChevron,
  );
  const newPanel = document.createElement('div');
  newPanel.className = 'vault-new-menu';
  const newWorkbook = document.createElement('button');
  newWorkbook.type = 'button';
  newWorkbook.className = 'vault-new-option';
  newWorkbook.append(
    svgIcon('M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5'),
    document.createTextNode(t('cloudNewWorkbook')),
  );
  newWorkbook.addEventListener('click', () => {
    newMenu.open = false;
    void onNew();
  });
  newPanel.append(newWorkbook);
  newMenu.append(newSummary, newPanel);

  const homeBtn = document.createElement('button');
  homeBtn.type = 'button';
  homeBtn.className = 'vault-tree-item';
  homeBtn.id = 'files-home';
  homeBtn.append(
    svgIcon('M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z'),
    document.createTextNode(t('cloudNavHome')),
  );
  homeBtn.addEventListener('click', () => showHome());

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
      newMenu,
      homeBtn,
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
      Div().class('vault-docs').id('files-docs').build(),
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
      Div()
        .class('vault-stage-empty')
        .id('files-stage-empty')
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

  root().append(Div().class('vault').children(side, Div().class('vault-body').children(top, stage).build()).build());

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
  const home = document.getElementById('files-home');
  if (!host) return;
  home?.classList.toggle('is-current', preferHome || !selectedId);
  host.replaceChildren();
  if (loading) {
    const pending = document.createElement('p');
    pending.className = 'vault-empty';
    pending.textContent = '…';
    host.append(pending);
    return;
  }
  if (rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'vault-empty';
    empty.textContent = query ? t('cloudEmptySearch') : t('cloudEmpty');
    host.append(empty);
    return;
  }
  for (const workbook of rows) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = workbook.id === selectedId ? 'vault-tree-item is-current' : 'vault-tree-item';
    if (workbook.id === selectedId) item.setAttribute('aria-current', 'true');
    const title = document.createElement('span');
    title.className = 'vault-tree-title';
    title.textContent = workbook.title;
    item.append(svgIcon('M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5'), title);
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
  const empty = document.getElementById('files-stage-empty');
  const wrap = document.getElementById('files-frame-wrap');
  const frame = document.getElementById('files-editor-frame') as HTMLIFrameElement | null;
  if (!empty || !wrap || !frame) return;
  const workbook = selectedWorkbook();
  if (!workbook && loading && frame.dataset.workbook) return;
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
