/**
 * Durable local vault CRUD. Metadata shape matches cloud VaultItem enough for
 * the workspace shell; blobs keep only the latest revision per file.
 */
import {
  formatFromTitle,
  isVaultFormat,
  mimeForFormat,
  type VaultFormat,
  type VaultKind,
} from '../appwrite/ids';
import {
  BLOBS_STORE,
  ITEMS_STORE,
  requestToPromise,
  withLocalStores,
} from './db';

export type LocalVaultItem = {
  id: string;
  /** Always empty for local items (no Appwrite owner). */
  userId: '';
  title: string;
  kind: VaultKind;
  format: VaultFormat | '';
  parentId: string;
  sortOrder: number;
  /** Local files use their own id as the blob key; folders leave this empty. */
  fileId: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
};

export type LocalWorkbook = LocalVaultItem & { kind: 'file'; format: VaultFormat };

type BlobRow = {
  id: string;
  bytes: Uint8Array;
  byteLength: number;
};

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toBytes(view: Uint8Array | ArrayBuffer): Uint8Array {
  if (ArrayBuffer.isView(view)) {
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }
  return new Uint8Array(view);
}

function reviveItem(raw: unknown): LocalVaultItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.title !== 'string') return null;
  const kind: VaultKind = row.kind === 'folder' ? 'folder' : 'file';
  const formatRaw = typeof row.format === 'string' ? row.format : '';
  const format = kind === 'folder' ? '' : isVaultFormat(formatRaw) ? formatRaw : formatFromTitle(row.title) || 'xlsx';
  return {
    id: row.id,
    userId: '',
    title: row.title,
    kind,
    format,
    parentId: typeof row.parentId === 'string' ? row.parentId : '',
    sortOrder: typeof row.sortOrder === 'number' && Number.isFinite(row.sortOrder) ? row.sortOrder : 0,
    fileId: typeof row.fileId === 'string' ? row.fileId : kind === 'file' ? row.id : '',
    sizeBytes: typeof row.sizeBytes === 'number' ? row.sizeBytes : 0,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : nowIso(),
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : nowIso(),
    lastOpenedAt: typeof row.lastOpenedAt === 'string' ? row.lastOpenedAt : nowIso(),
  };
}

function ensureTitle(title: string, format: VaultFormat): string {
  const trimmed = title.trim() || `Untitled.${format}`;
  return trimmed.toLowerCase().endsWith(`.${format}`) ? trimmed : `${trimmed}.${format}`;
}

export async function listLocalVaultItems(): Promise<LocalVaultItem[]> {
  const rows = await withLocalStores([ITEMS_STORE], 'readonly', async (tx) => {
    const store = tx.objectStore(ITEMS_STORE);
    const all = await requestToPromise(store.getAll());
    return (all as unknown[]).map(reviveItem).filter((row): row is LocalVaultItem => row !== null);
  });
  return rows ?? [];
}

export async function getLocalVaultItem(id: string): Promise<LocalVaultItem | null> {
  const row = await withLocalStores([ITEMS_STORE], 'readonly', async (tx) => {
    return reviveItem(await requestToPromise(tx.objectStore(ITEMS_STORE).get(id)));
  });
  return row ?? null;
}

export async function getLocalWorkbook(id: string): Promise<LocalWorkbook | null> {
  const item = await getLocalVaultItem(id);
  if (!item || item.kind !== 'file' || !item.format) return null;
  return item as LocalWorkbook;
}

export async function readLocalVaultBytes(id: string): Promise<Uint8Array | null> {
  const bytes = await withLocalStores([BLOBS_STORE], 'readonly', async (tx) => {
    const row = (await requestToPromise(tx.objectStore(BLOBS_STORE).get(id))) as BlobRow | undefined;
    if (!row || !(ArrayBuffer.isView(row.bytes) || (row.bytes as unknown) instanceof ArrayBuffer)) return null;
    return toBytes(row.bytes as Uint8Array | ArrayBuffer);
  });
  return bytes ?? null;
}

export async function downloadLocalVaultFile(id: string, title?: string): Promise<File | null> {
  const item = await getLocalWorkbook(id);
  if (!item) return null;
  const bytes = await readLocalVaultBytes(id);
  if (!bytes) return null;
  const name = title || item.title;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], name, { type: mimeForFormat(item.format) });
}

async function putItemAndBlob(item: LocalVaultItem, bytes: Uint8Array | null): Promise<LocalVaultItem> {
  const result = await withLocalStores([ITEMS_STORE, BLOBS_STORE], 'readwrite', async (tx) => {
    const items = tx.objectStore(ITEMS_STORE);
    const blobs = tx.objectStore(BLOBS_STORE);
    await requestToPromise(items.put(item));
    if (item.kind === 'file' && bytes) {
      const row: BlobRow = { id: item.id, bytes, byteLength: bytes.byteLength };
      await requestToPromise(blobs.put(row));
    }
    return item;
  });
  if (!result) throw new Error('Local vault is unavailable in this browser');
  return result;
}

export async function createLocalVaultFile(
  file: File,
  title?: string,
  parentId = '',
  sortOrder = 0,
): Promise<LocalWorkbook> {
  const format = formatFromTitle(title || file.name) || formatFromTitle(file.name) || 'xlsx';
  const id = newId();
  const stamp = nowIso();
  const bytes = toBytes(new Uint8Array(await file.arrayBuffer()));
  const item: LocalWorkbook = {
    id,
    userId: '',
    title: ensureTitle(title || file.name, format),
    kind: 'file',
    format,
    parentId,
    sortOrder,
    fileId: id,
    sizeBytes: bytes.byteLength,
    createdAt: stamp,
    updatedAt: stamp,
    lastOpenedAt: stamp,
  };
  return (await putItemAndBlob(item, bytes)) as LocalWorkbook;
}

export async function createLocalBlankFile(
  format: VaultFormat,
  options: { title?: string; parentId?: string; sortOrder?: number; bytes: Uint8Array },
): Promise<LocalWorkbook> {
  const id = newId();
  const stamp = nowIso();
  const bytes = toBytes(options.bytes);
  const fallback = format === 'xlsx' ? 'Workbook' : format === 'docx' ? 'Document' : 'Presentation';
  const item: LocalWorkbook = {
    id,
    userId: '',
    title: ensureTitle(options.title || fallback, format),
    kind: 'file',
    format,
    parentId: options.parentId || '',
    sortOrder: options.sortOrder ?? 0,
    fileId: id,
    sizeBytes: bytes.byteLength,
    createdAt: stamp,
    updatedAt: stamp,
    lastOpenedAt: stamp,
  };
  return (await putItemAndBlob(item, bytes)) as LocalWorkbook;
}

export async function createLocalFolder(
  title: string,
  parentId = '',
  sortOrder = 0,
): Promise<LocalVaultItem> {
  const id = newId();
  const stamp = nowIso();
  const item: LocalVaultItem = {
    id,
    userId: '',
    title: title.trim() || 'Folder',
    kind: 'folder',
    format: '',
    parentId,
    sortOrder,
    fileId: '',
    sizeBytes: 0,
    createdAt: stamp,
    updatedAt: stamp,
    lastOpenedAt: stamp,
  };
  return putItemAndBlob(item, null);
}

export async function saveLocalVaultBytes(
  id: string,
  file: File,
  title?: string,
): Promise<LocalWorkbook> {
  const existing = await getLocalWorkbook(id);
  if (!existing) throw new Error('Local workbook not found');
  const bytes = toBytes(new Uint8Array(await file.arrayBuffer()));
  const stamp = nowIso();
  const next: LocalWorkbook = {
    ...existing,
    title: title ? ensureTitle(title, existing.format) : existing.title,
    sizeBytes: bytes.byteLength,
    updatedAt: stamp,
    lastOpenedAt: stamp,
  };
  return (await putItemAndBlob(next, bytes)) as LocalWorkbook;
}

export async function renameLocalVaultItem(id: string, title: string): Promise<LocalVaultItem> {
  const existing = await getLocalVaultItem(id);
  if (!existing) throw new Error('Local item not found');
  const nextTitle =
    existing.kind === 'file' && existing.format
      ? ensureTitle(title, existing.format)
      : title.trim() || existing.title;
  const next: LocalVaultItem = {
    ...existing,
    title: nextTitle,
    updatedAt: nowIso(),
  };
  return putItemAndBlob(next, null);
}

export async function placeLocalVaultItem(
  id: string,
  parentId: string,
  sortOrder: number,
): Promise<LocalVaultItem> {
  const existing = await getLocalVaultItem(id);
  if (!existing) throw new Error('Local item not found');
  const next: LocalVaultItem = {
    ...existing,
    parentId,
    sortOrder,
    updatedAt: nowIso(),
  };
  return putItemAndBlob(next, null);
}

export async function deleteLocalVaultItem(id: string): Promise<void> {
  const all = await listLocalVaultItems();
  const toDelete = new Set<string>();
  const walk = (target: string) => {
    toDelete.add(target);
    for (const row of all) {
      if (row.parentId === target) walk(row.id);
    }
  };
  walk(id);

  await withLocalStores([ITEMS_STORE, BLOBS_STORE], 'readwrite', async (tx) => {
    const items = tx.objectStore(ITEMS_STORE);
    const blobs = tx.objectStore(BLOBS_STORE);
    for (const key of toDelete) {
      await requestToPromise(items.delete(key));
      await requestToPromise(blobs.delete(key));
    }
  });
}

export async function touchLocalVaultOpened(id: string): Promise<void> {
  const existing = await getLocalVaultItem(id);
  if (!existing) return;
  const next = { ...existing, lastOpenedAt: nowIso() };
  await putItemAndBlob(next, null);
}

export function totalLocalFileBytes(items: LocalVaultItem[]): number {
  return items.reduce((sum, row) => (row.kind === 'file' ? sum + row.sizeBytes : sum), 0);
}

/** Adapt a local item to the cloud VaultItem / Workbook shape used by the shell. */
export function localItemAsVault(item: LocalVaultItem): import('../appwrite/workbooks').VaultItem {
  return {
    id: item.id,
    userId: item.userId,
    title: item.title,
    kind: item.kind,
    format: item.format,
    parentId: item.parentId,
    sortOrder: item.sortOrder,
    fileId: item.fileId,
    sizeBytes: item.sizeBytes,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function localWorkbookAsCloud(item: LocalWorkbook): import('../appwrite/workbooks').Workbook {
  return {
    ...localItemAsVault(item),
    kind: 'file',
    format: item.format,
  };
}
