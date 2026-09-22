/**
 * Cloud workbooks: Appwrite Databases row + Storage file.
 *
 * Document `$id` starts equal to the first Storage `fileId`. Each Save mints a
 * new Storage object and points the row at it (Appwrite has no content
 * overwrite); the previous object is deleted in the background. Permissions
 * are per-user on both sides (documentSecurity + fileSecurity).
 */
import { ID, Permission, Query, Role, type Models } from 'appwrite';
import { requireUser } from './auth';
import { getClient, getDatabases, getStorage } from './client';
import { buildEmptyXlsxFile } from './empty-xlsx';
import { BUCKET_WORKBOOKS, COLLECTION_WORKBOOKS, DATABASE_ID, MAX_WORKBOOK_BYTES, XLSX_EXT, XLSX_MIME } from './ids';

export interface Workbook {
  id: string;
  userId: string;
  title: string;
  fileId: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

type WorkbookDoc = Models.Document & {
  userId: string;
  title: string;
  fileId: string;
  sizeBytes: number;
};

function ownerPermissions(userId: string): string[] {
  return [
    Permission.read(Role.user(userId)),
    Permission.update(Role.user(userId)),
    Permission.delete(Role.user(userId)),
  ];
}

function fromDocument(doc: WorkbookDoc): Workbook {
  return {
    id: doc.$id,
    userId: doc.userId,
    title: doc.title,
    fileId: doc.fileId,
    sizeBytes: doc.sizeBytes,
    createdAt: doc.$createdAt,
    updatedAt: doc.$updatedAt,
  };
}

function ensureXlsxName(title: string): string {
  const trimmed = title.trim() || 'Untitled.xlsx';
  return trimmed.toLowerCase().endsWith(`.${XLSX_EXT}`) ? trimmed : `${trimmed}.${XLSX_EXT}`;
}

function assertXlsxFile(file: File): void {
  const name = file.name.toLowerCase();
  if (!name.endsWith(`.${XLSX_EXT}`)) {
    throw new Error('Only .xlsx workbooks can be stored in the cloud');
  }
  if (file.size > MAX_WORKBOOK_BYTES) {
    throw new Error(`File exceeds the ${Math.floor(MAX_WORKBOOK_BYTES / 1_000_000)} MB limit`);
  }
}

export async function listWorkbooks(options: { search?: string; limit?: number } = {}): Promise<Workbook[]> {
  const user = await requireUser();
  const limit = options.limit ?? 100;
  const queries = [Query.equal('userId', user.$id), Query.orderDesc('$updatedAt'), Query.limit(limit)];
  const result = await getDatabases().listDocuments<WorkbookDoc>({
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

export async function getWorkbook(id: string): Promise<Workbook> {
  await requireUser();
  const doc = await getDatabases().getDocument<WorkbookDoc>({
    databaseId: DATABASE_ID,
    collectionId: COLLECTION_WORKBOOKS,
    documentId: id,
  });
  return fromDocument(doc);
}

async function uploadFile(fileId: string, file: File, userId: string): Promise<void> {
  assertXlsxFile(file);
  const named = new File([file], ensureXlsxName(file.name), { type: XLSX_MIME });
  await getStorage().createFile({
    bucketId: BUCKET_WORKBOOKS,
    fileId,
    file: named,
    permissions: ownerPermissions(userId),
  });
}

/**
 * Known session state from an already-open workbook. When present, Save skips
 * Account.get + Databases.getDocument and goes straight to Storage create +
 * document PATCH -- the only two round-trips that move bytes and publish them.
 */
export type SaveWorkbookHot = {
  userId: string;
  fileId: string;
  title?: string;
};

/**
 * Publish new workbook bytes without waiting on delete.
 *
 * Appwrite Storage has no content-overwrite, so each Save mints a new file id,
 * points the row at it, then deletes the previous object in the background.
 * That drops the DELETE off the critical path (measured ~260 ms to SFO) and
 * also changes the download URL, so HTTP caches cannot serve a pre-Save copy.
 */
async function publishWorkbookBytes(
  workbookId: string,
  file: File,
  ctx: SaveWorkbookHot,
): Promise<Workbook> {
  assertXlsxFile(file);
  const title = ensureXlsxName(ctx.title || file.name || 'Untitled.xlsx');
  const named = new File([file], title, { type: XLSX_MIME });
  const nextFileId = ID.unique();
  const previousFileId = ctx.fileId;

  await uploadFile(nextFileId, named, ctx.userId);
  const doc = await getDatabases().updateDocument<WorkbookDoc>({
    databaseId: DATABASE_ID,
    collectionId: COLLECTION_WORKBOOKS,
    documentId: workbookId,
    data: {
      title,
      sizeBytes: file.size,
      fileId: nextFileId,
    },
  });

  if (previousFileId && previousFileId !== nextFileId) {
    void getStorage()
      .deleteFile({ bucketId: BUCKET_WORKBOOKS, fileId: previousFileId })
      .catch(() => {
        // Orphan cleanup is best-effort: the row already points at nextFileId.
      });
  }

  return fromDocument(doc);
}

/**
 * Download workbook bytes. The download URL is on the Appwrite host; the
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
  options: { cacheBust?: string | number } = {},
): Promise<File> {
  await requireUser();
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
  return new File([buffer], ensureXlsxName(title), { type: XLSX_MIME });
}

export async function createWorkbookFromFile(file: File, title?: string): Promise<Workbook> {
  const user = await requireUser();
  assertXlsxFile(file);
  const id = ID.unique();
  const finalTitle = ensureXlsxName(title || file.name || 'Untitled.xlsx');
  await uploadFile(id, new File([file], finalTitle, { type: XLSX_MIME }), user.$id);
  const doc = await getDatabases().createDocument<WorkbookDoc>({
    databaseId: DATABASE_ID,
    collectionId: COLLECTION_WORKBOOKS,
    documentId: id,
    data: {
      userId: user.$id,
      title: finalTitle,
      fileId: id,
      sizeBytes: file.size,
    },
    permissions: ownerPermissions(user.$id),
  });
  return fromDocument(doc);
}

export async function createBlankWorkbook(title = 'Untitled.xlsx'): Promise<Workbook> {
  return createWorkbookFromFile(buildEmptyXlsxFile(title), title);
}

/**
 * Upload exported bytes for a workbook.
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
  });
}

export async function renameWorkbook(workbookId: string, title: string): Promise<Workbook> {
  await requireUser();
  const doc = await getDatabases().updateDocument<WorkbookDoc>({
    databaseId: DATABASE_ID,
    collectionId: COLLECTION_WORKBOOKS,
    documentId: workbookId,
    data: { title: ensureXlsxName(title) },
  });
  return fromDocument(doc);
}

export async function deleteWorkbook(workbookId: string): Promise<void> {
  await requireUser();
  const existing = await getWorkbook(workbookId);
  try {
    await getStorage().deleteFile({ bucketId: BUCKET_WORKBOOKS, fileId: existing.fileId });
  } catch {
    // Row may outlive a missing file; still delete the metadata.
  }
  await getDatabases().deleteDocument({
    databaseId: DATABASE_ID,
    collectionId: COLLECTION_WORKBOOKS,
    documentId: workbookId,
  });
}
