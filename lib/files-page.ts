/**
 * /files -- the cloud workbook library (Appwrite Storage + Databases).
 *
 * Requires a signed-in session; anonymous visitors are sent to /login.
 * Layout follows /history: list + rail, ranui chrome, reading column for names.
 */
import 'ranui/button';
import 'ranui/input';
import 'ranui/icon';
import 'ranui/message';
import { Div, View } from 'ranui/builder';
import '../styles/files.css';
import { applyDocumentLanguage, getLanguage, t, withLocale } from '@ranuts/shared/i18n';
import { getCurrentUser, signOut, type AuthUser } from './appwrite/auth';
import {
  createBlankWorkbook,
  createWorkbookFromFile,
  deleteWorkbook,
  listWorkbooks,
  type Workbook,
} from './appwrite/workbooks';
import { confirmDialog } from './confirm-dialog';
import { formatRelativeTime } from './history/recovery';

const SEARCH_DEBOUNCE_MS = 200;

let query = '';
let searchTimer = 0;
let user: AuthUser | null = null;
let rows: Workbook[] = [];
let loading = true;

function root(): HTMLElement {
  return document.getElementById('files-root') as HTMLElement;
}

function loginUrl(): string {
  const locale = new URLSearchParams(window.location.search).get('locale');
  return locale ? `/login?locale=${encodeURIComponent(locale)}` : '/login';
}

function editorUrl(workbookId: string): string {
  return withLocale(`/editor?workbook=${encodeURIComponent(workbookId)}`, getLanguage());
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

function button(
  label: string,
  onClick: () => void,
  options: { type?: string; id?: string; class?: string } = {},
): HTMLElement {
  const builder = View('r-button').text(label).on('click', onClick);
  if (options.id) builder.id(options.id);
  if (options.class) builder.class(options.class);
  if (options.type) builder.attr('type', options.type);
  return builder.build();
}

function syncUrl(): void {
  const url = new URL(window.location.href);
  if (query) url.searchParams.set('q', query);
  else url.searchParams.delete('q');
  window.history.replaceState(null, '', url);
}

function readUrl(): void {
  query = new URLSearchParams(window.location.search).get('q') ?? '';
}

async function refresh(): Promise<void> {
  loading = true;
  render();
  try {
    rows = await listWorkbooks({ search: query });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notifyError(message);
    rows = [];
  } finally {
    loading = false;
    render();
  }
}

async function onNew(): Promise<void> {
  try {
    const workbook = await createBlankWorkbook();
    window.location.href = editorUrl(workbook.id);
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
        window.location.href = editorUrl(workbook.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        notifyError(message);
      }
    })();
  });
  document.body.appendChild(input);
  input.click();
}

async function onDelete(workbook: Workbook): Promise<void> {
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
    await refresh();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notifyError(message);
  }
}

async function onSignOut(): Promise<void> {
  await signOut();
  window.location.replace(loginUrl());
}

function row(workbook: Workbook): HTMLElement {
  return Div()
    .class('files-row')
    .children(
      Div()
        .class('files-row-main')
        .children(
          View('span').class('files-title').text(workbook.title).build(),
          View('span')
            .class('files-meta')
            .text(`${formatRelativeTime(Date.parse(workbook.updatedAt))} · ${formatBytes(workbook.sizeBytes)}`)
            .build(),
        )
        .build(),
      Div()
        .class('files-row-actions')
        .children(
          button(
            t('cloudOpen'),
            () => {
              window.location.href = editorUrl(workbook.id);
            },
            { type: 'primary' },
          ),
          button(t('cloudDelete'), () => void onDelete(workbook), { type: 'text', class: 'files-delete' }),
        )
        .build(),
    )
    .build();
}

function render(): void {
  const host = root();
  host.replaceChildren();

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

  const toolbar = Div()
    .class('files-toolbar')
    .children(
      button(t('cloudNewWorkbook'), () => void onNew(), { type: 'primary', id: 'files-new' }),
      button(t('cloudUploadWorkbook'), () => onUpload(), { id: 'files-upload' }),
      search,
    )
    .build();

  const listChildren: HTMLElement[] = [];
  if (loading) {
    listChildren.push(View('p').class('files-empty').text('…').build());
  } else if (rows.length === 0) {
    listChildren.push(
      View('h2')
        .class('files-empty-title')
        .text(query ? t('cloudEmptySearchTitle') : t('cloudEmptyTitle'))
        .build(),
      View('p')
        .class('files-empty')
        .text(query ? t('cloudEmptySearch') : t('cloudEmpty'))
        .build(),
    );
  } else {
    listChildren.push(
      Div()
        .class('files-head')
        .children(
          View('span').text(t('cloudColDocument')).build(),
          View('span').text(t('cloudColEdited')).build(),
          View('span').text(t('cloudColSize')).build(),
        )
        .build(),
    );
    for (const workbook of rows) listChildren.push(row(workbook));
  }

  const rail = Div()
    .class('files-rail')
    .children(
      View('p')
        .class('files-signed-in')
        .text(t('cloudSignedInAs', { email: user?.email || '' }))
        .build(),
      button(t('cloudSignOut'), () => void onSignOut(), { type: 'text', id: 'files-sign-out' }),
      View('p').class('files-intro').text(t('cloudFilesIntro')).build(),
    )
    .build();

  const page = Div()
    .class('files-page')
    .children(
      View('h1').class('files-title-page').text(t('cloudFilesTitle')).build(),
      toolbar,
      Div()
        .class('files-list')
        .children(...listChildren)
        .build(),
    )
    .build();

  host.appendChild(Div().class('files-shell').children(page, rail).build());
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
