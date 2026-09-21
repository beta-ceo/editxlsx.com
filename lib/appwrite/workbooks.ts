/**
 * Cloud workbooks: Appwrite Databases row + Storage file.
 *
 * Convention matches the existing console data: document `$id` === Storage
 * `fileId`. Permissions are per-user on both sides (documentSecurity +
 * fileSecurity). Saves replace the Storage object (delete + create same id)
 * because Appwrite has no content-overwrite for files.
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

async function replaceFile(fileId: string, file: File, userId: string): Promise<void> {
  try {
    await getStorage().deleteFile({ bucketId: BUCKET_WORKBOOKS, fileId });
  } catch {
    // First save of a row whose file was already gone, or a race -- create below.
  }
  await uploadFile(fileId, file, userId);
}

/**
 * Download workbook bytes. The download URL is on the Appwrite host; the
 * session cookie is sent with credentials: 'include', and the project header
 * is required for the request to resolve.
 */
export async function downloadWorkbookFile(fileId: string, title: string): Promise<File> {
  await requireUser();
  const url = getStorage().getFileDownload({ bucketId: BUCKET_WORKBOOKS, fileId });
  const response = await fetch(url.toString(), {
    credentials: 'include',
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

export async function saveWorkbookBytes(
  workbookId: string,
  file: File,
  options: { title?: string } = {},
): Promise<Workbook> {
  const user = await requireUser();
  assertXlsxFile(file);
  const existing = await getWorkbook(workbookId);
  if (existing.userId !== user.$id) {
    throw new Error('Not allowed to save this workbook');
  }
  const title = ensureXlsxName(options.title || existing.title);
  await replaceFile(existing.fileId, new File([file], title, { type: XLSX_MIME }), user.$id);
  const doc = await getDatabases().updateDocument<WorkbookDoc>({
    databaseId: DATABASE_ID,
    collectionId: COLLECTION_WORKBOOKS,
    documentId: workbookId,
    data: {
      title,
      sizeBytes: file.size,
      fileId: existing.fileId,
    },
  });
  return fromDocument(doc);
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
