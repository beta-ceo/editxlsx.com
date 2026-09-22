/**
 * Cloud vault items: Appwrite Databases row + optional Storage file.
 *
 * Files (`kind: file`) store .xlsx / .docx / .pptx. Document `$id` starts equal
 * to the first Storage `fileId`. Each Save mints a new Storage object and
 * points the row at it. Folders (`kind: folder`) are metadata-only
 * (`fileId` empty, `format` none) and nest via `parentId` ('' = root).
 */
import { ID, Permission, Query, Role, type Models } from 'appwrite';
import { requireUser } from './auth';
import { getClient, getDatabases, getStorage } from './client';
import { buildEmptyOfficeFile } from './empty-office';
import {
  BUCKET_WORKBOOKS,
  COLLECTION_WORKBOOKS,
  DATABASE_ID,
  MAX_WORKBOOK_BYTES,
  VAULT_FORMATS,
  formatFromTitle,
  isVaultFormat,
  mimeForFormat,
  type VaultFormat,
  type VaultKind,
} from './ids';

export type { VaultFormat, VaultKind };

export interface VaultItem {
  id: string;
  userId: string;
  title: string;
  kind: VaultKind;
  /** Empty string for folders (Appwrite stores `none`). */
  format: VaultFormat | '';
  parentId: string;
  fileId: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

/** File-shaped vault item (editor / cloud save binding). */
export type Workbook = VaultItem & { kind: 'file'; format: VaultFormat };

type VaultDoc = Models.Document & {
  userId: string;
  title: string;
  fileId: string;
  sizeBytes: number;
  kind?: string;
  format?: string;
  parentId?: string;
};

function ownerPermissions(userId: string): string[] {
  return [
    Permission.read(Role.user(userId)),
    Permission.update(Role.user(userId)),
    Permission.delete(Role.user(userId)),
  ];
}

function fromAppwriteFormat(raw: string | undefined): VaultFormat | '' {
  if (!raw || raw === 'none') return '';
  return isVaultFormat(raw) ? raw : 'xlsx';
}

function fromDocument(doc: VaultDoc): VaultItem {
  const kind: VaultKind = doc.kind === 'folder' ? 'folder' : 'file';
  const format = kind === 'folder' ? '' : fromAppwriteFormat(doc.format) || formatFromTitle(doc.title) || 'xlsx';
  return {
    id: doc.$id,
    userId: doc.userId,
    title: doc.title,
    kind,
    format,
    parentId: typeof doc.parentId === 'string' ? doc.parentId : '',
    fileId: doc.fileId || '',
    sizeBytes: doc.sizeBytes || 0,
    createdAt: doc.$createdAt,
    updatedAt: doc.$updatedAt,
  };
}

function asWorkbook(item: VaultItem): Workbook {
  if (item.kind !== 'file' || !item.format) {
    throw new Error('Not a cloud file');
  }
  return item as Workbook;
}

export function ensureFormatName(title: string, format: VaultFormat): string {
  const fallback = `Untitled.${format}`;
  const trimmed = title.trim() || fallback;
  return trimmed.toLowerCase().endsWith(`.${format}`) ? trimmed : `${trimmed}.${format}`;
}

function assertCloudOfficeFile(file: File, format?: VaultFormat): VaultFormat {
  const detected = formatFromTitle(file.name);
  if (!detected || (format && detected !== format)) {
    throw new Error(`Only ${VAULT_FORMATS.map((ext) => `.${ext}`).join(', ')} files can be stored in the cloud`);
  }
  if (file.size > MAX_WORKBOOK_BYTES) {
    throw new Error(`File exceeds the ${Math.floor(MAX_WORKBOOK_BYTES / 1_000_000)} MB limit`);
  }
  return detected;
}

export async function listVaultItems(options: { search?: string; limit?: number } = {}): Promise<VaultItem[]> {
  const user = await requireUser();
  const limit = options.limit ?? 100;
  const queries = [Query.equal('userId', user.$id), Query.orderDesc('$updatedAt'), Query.limit(limit)];
  const result = await getDatabases().listDocuments<VaultDoc>({
    databaseId: DATABASE_ID,
    collectionId: COLLECTION_WORKBOOKS,
    queries,
  });
  let docs = result.documents.map(fromDocument);
  const needle = options.search?.trim().toLowerCase();
  if (needle) {
    docs = docs.filter((doc) => doc.title.toLowerCase().includes(needle));
  }
  return docs;
}

/** @deprecated Prefer listVaultItems — kept for call sites that only list files. */
export async function listWorkbooks(options: { search?: string; limit?: number } = {}): Promise<Workbook[]> {
  const items = await listVaultItems(options);
  return items.filter((item): item is Workbook => item.kind === 'file' && !!item.format);
}

export async function getVaultItem(id: string): Promise<VaultItem> {
  await requireUser();
  const doc = await getDatabases().getDocument<VaultDoc>({
    databaseId: DATABASE_ID,
    collectionId: COLLECTION_WORKBOOKS,
    documentId: id,
  });
  return fromDocument(doc);
}

export async function getWorkbook(id: string): Promise<Workbook> {
  return asWorkbook(await getVaultItem(id));
}

async function uploadFile(fileId: string, file: File, userId: string, format: VaultFormat): Promise<void> {
  assertCloudOfficeFile(file, format);
  const named = new File([file], ensureFormatName(file.name, format), { type: mimeForFormat(format) });
  await getStorage().createFile({
    bucketId: BUCKET_WORKBOOKS,
    fileId,
    file: named,
    permissions: ownerPermissions(userId),
  });
}

/**
 * Known session state from an already-open file. When present, Save skips
 * Account.get + Databases.getDocument and goes straight to Storage create +
 * document PATCH -- the only two round-trips that move bytes and publish them.
 */
export type SaveWorkbookHot = {
  userId: string;
  fileId: string;
  title?: string;
  format?: VaultFormat;
};

async function publishWorkbookBytes(
  workbookId: string,
  file: File,
  ctx: SaveWorkbookHot,
): Promise<Workbook> {
  const format = ctx.format || assertCloudOfficeFile(file);
  assertCloudOfficeFile(file, format);
  const title = ensureFormatName(ctx.title || file.name || `Untitled.${format}`, format);
  const named = new File([file], title, { type: mimeForFormat(format) });
  const nextFileId = ID.unique();
  const previousFileId = ctx.fileId;

  await uploadFile(nextFileId, named, ctx.userId, format);
  const doc = await getDatabases().updateDocument<VaultDoc>({
    databaseId: DATABASE_ID,
    collectionId: COLLECTION_WORKBOOKS,
    documentId: workbookId,
    data: {
      title,
      sizeBytes: file.size,
      fileId: nextFileId,
      kind: 'file',
      format,
    },
  });

  if (previousFileId && previousFileId !== nextFileId) {
    void getStorage()
      .deleteFile({ bucketId: BUCKET_WORKBOOKS, fileId: previousFileId })
      .catch(() => {
        // Orphan cleanup is best-effort: the row already points at nextFileId.
      });
  }

  return asWorkbook(fromDocument(doc));
}

/**
 * Download file bytes. The download URL is on the Appwrite host; the
 * session cookie is sent with credentials: 'include', and the project header
 * is required for the request to resolve.
 *
 * Appwrite answers with `Cache-Control: private, max-age=3888000` (45 days).
 * Saves now rotate the Storage file id, but a re-open of the same revision
 * (same URL) still needs `cache: 'no-store'` plus a bust query so a tab that
 * downloaded before Save cannot keep the old body.
 */
export async function downloadWorkbookFile(
  fileId: string,
  title: string,
  options: { cacheBust?: string | number; format?: VaultFormat } = {},
): Promise<File> {
  await requireUser();
  const format = options.format || formatFromTitle(title) || 'xlsx';
  const url = new URL(getStorage().getFileDownload({ bucketId: BUCKET_WORKBOOKS, fileId }).toString());
  // Bust intermediaries that ignore Request.cache; prefer the row's updatedAt
  // so two tabs opening the same revision still share one network response.
  url.searchParams.set('v', String(options.cacheBust ?? Date.now()));
  const response = await fetch(url.toString(), {
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'X-Appwrite-Project': getClient().config.project,
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to download workbook (${response.status})`);
  }
  const buffer = await response.arrayBuffer();
  return new File([buffer], ensureFormatName(title, format), { type: mimeForFormat(format) });
}

export async function createWorkbookFromFile(
  file: File,
  title?: string,
  parentId = '',
): Promise<Workbook> {
  const user = await requireUser();
  const format = assertCloudOfficeFile(file);
  const id = ID.unique();
  const finalTitle = ensureFormatName(title || file.name || `Untitled.${format}`, format);
  await uploadFile(id, new File([file], finalTitle, { type: mimeForFormat(format) }), user.$id, format);
  const doc = await getDatabases().createDocument<VaultDoc>({
    databaseId: DATABASE_ID,
    collectionId: COLLECTION_WORKBOOKS,
    documentId: id,
    data: {
      userId: user.$id,
      title: finalTitle,
      fileId: id,
      sizeBytes: file.size,
      kind: 'file',
      format,
      parentId,
    },
    permissions: ownerPermissions(user.$id),
  });
  return asWorkbook(fromDocument(doc));
}

export async function createBlankFile(
  format: VaultFormat,
  options: { title?: string; parentId?: string } = {},
): Promise<Workbook> {
  const title = options.title || `Untitled.${format}`;
  return createWorkbookFromFile(await buildEmptyOfficeFile(format, title), title, options.parentId || '');
}

export async function createBlankWorkbook(
  title = 'Untitled.xlsx',
  parentId = '',
): Promise<Workbook> {
  return createBlankFile('xlsx', { title, parentId });
}

export async function createFolder(title = 'Untitled folder', parentId = ''): Promise<VaultItem> {
  const user = await requireUser();
  const id = ID.unique();
  const finalTitle = title.trim() || 'Untitled folder';
  const doc = await getDatabases().createDocument<VaultDoc>({
    databaseId: DATABASE_ID,
    collectionId: COLLECTION_WORKBOOKS,
    documentId: id,
    data: {
      userId: user.$id,
      title: finalTitle,
      fileId: '',
      sizeBytes: 0,
      kind: 'folder',
      format: 'none',
      parentId,
    },
    permissions: ownerPermissions(user.$id),
  });
  return fromDocument(doc);
}

/**
 * Upload exported bytes for a cloud file.
 *
 * Pass `hot` (from the editor binding) on the interactive Save path: no
 * Account.get, no Databases.getDocument -- only createFile + updateDocument.
 * Without `hot`, ownership is checked the slow way (tests / recovery).
 */
export async function saveWorkbookBytes(
  workbookId: string,
  file: File,
  options: { title?: string; hot?: SaveWorkbookHot } = {},
): Promise<Workbook> {
  if (options.hot) {
    return publishWorkbookBytes(workbookId, file, {
      userId: options.hot.userId,
      fileId: options.hot.fileId,
      title: options.title || options.hot.title,
      format: options.hot.format || formatFromTitle(options.title || options.hot.title || file.name) || undefined,
    });
  }

  const user = await requireUser();
  const existing = await getWorkbook(workbookId);
  if (existing.userId !== user.$id) {
    throw new Error('Not allowed to save this workbook');
  }
  return publishWorkbookBytes(workbookId, file, {
    userId: existing.userId,
    fileId: existing.fileId,
    title: options.title || existing.title,
    format: existing.format,
  });
}

export async function renameVaultItem(itemId: string, title: string): Promise<VaultItem> {
  await requireUser();
  const existing = await getVaultItem(itemId);
  const nextTitle =
    existing.kind === 'folder'
      ? title.trim() || existing.title
      : ensureFormatName(title, existing.format || 'xlsx');
  const doc = await getDatabases().updateDocument<VaultDoc>({
    databaseId: DATABASE_ID,
    collectionId: COLLECTION_WORKBOOKS,
    documentId: itemId,
    data: { title: nextTitle },
  });
  return fromDocument(doc);
}

export async function renameWorkbook(workbookId: string, title: string): Promise<Workbook> {
  return asWorkbook(await renameVaultItem(workbookId, title));
}

export async function deleteVaultItem(itemId: string): Promise<void> {
  await requireUser();
  const existing = await getVaultItem(itemId);
  if (existing.kind === 'folder') {
    const children = (await listVaultItems({ limit: 100 })).filter((row) => row.parentId === itemId);
    if (children.length > 0) {
      throw new Error('Folder is not empty');
    }
  } else if (existing.fileId) {
    try {
      await getStorage().deleteFile({ bucketId: BUCKET_WORKBOOKS, fileId: existing.fileId });
    } catch {
      // Row may outlive a missing file; still delete the metadata.
    }
  }
  await getDatabases().deleteDocument({
    databaseId: DATABASE_ID,
    collectionId: COLLECTION_WORKBOOKS,
    documentId: itemId,
  });
}

export async function deleteWorkbook(workbookId: string): Promise<void> {
  return deleteVaultItem(workbookId);
}
