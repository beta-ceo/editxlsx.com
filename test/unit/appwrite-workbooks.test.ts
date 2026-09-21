import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
const createEmailPasswordSession = vi.fn();
const get = vi.fn();
const deleteSession = vi.fn();
const listDocuments = vi.fn();
const getDocument = vi.fn();
const createDocument = vi.fn();
const updateDocument = vi.fn();
const deleteDocument = vi.fn();
const createFile = vi.fn();
const deleteFile = vi.fn();
const getFileDownload = vi.fn();

vi.mock('appwrite', () => {
  class Client {
    config = { endpoint: '', project: '' };
    setEndpoint(endpoint: string) {
      this.config.endpoint = endpoint;
      return this;
    }
    setProject(project: string) {
      this.config.project = project;
      return this;
    }
  }
  return {
    Client,
    Account: class {
      create = create;
      createEmailPasswordSession = createEmailPasswordSession;
      get = get;
      deleteSession = deleteSession;
    },
    Databases: class {
      listDocuments = listDocuments;
      getDocument = getDocument;
      createDocument = createDocument;
      updateDocument = updateDocument;
      deleteDocument = deleteDocument;
    },
    Storage: class {
      createFile = createFile;
      deleteFile = deleteFile;
      getFileDownload = getFileDownload;
    },
    ID: { unique: () => 'generated-id' },
    Permission: {
      read: (role: string) => `read("${role}")`,
      update: (role: string) => `update("${role}")`,
      delete: (role: string) => `delete("${role}")`,
    },
    Role: { user: (id: string) => `user:${id}` },
    Query: {
      equal: (attr: string, value: string) => `equal("${attr}",[${JSON.stringify(value)}])`,
      orderDesc: (attr: string) => `orderDesc("${attr}")`,
      limit: (n: number) => `limit(${n})`,
    },
  };
});

describe('appwrite auth', () => {
  beforeEach(async () => {
    vi.resetModules();
    create.mockReset();
    createEmailPasswordSession.mockReset();
    get.mockReset();
    deleteSession.mockReset();
    const { resetAppwriteClientForTests } = await import('../../lib/appwrite/client');
    resetAppwriteClientForTests();
  });

  it('signs up then opens a session and returns the user', async () => {
    const user = { $id: 'u1', email: 'a@b.co', name: 'A' };
    create.mockResolvedValue(user);
    createEmailPasswordSession.mockResolvedValue({ $id: 's1' });
    get.mockResolvedValue(user);

    const { signUp } = await import('../../lib/appwrite/auth');
    const result = await signUp('a@b.co', 'password1', 'A');

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ email: 'a@b.co', password: 'password1', name: 'A' }));
    expect(createEmailPasswordSession).toHaveBeenCalledWith({ email: 'a@b.co', password: 'password1' });
    expect(result).toEqual(user);
  });

  it('returns null from getCurrentUser when there is no session', async () => {
    get.mockRejectedValue(new Error('401'));
    const { getCurrentUser } = await import('../../lib/appwrite/auth');
    expect(await getCurrentUser()).toBeNull();
  });
});

describe('appwrite workbooks', () => {
  const user = { $id: 'user-1', email: 'a@b.co' };

  beforeEach(async () => {
    vi.resetModules();
    listDocuments.mockReset();
    getDocument.mockReset();
    createDocument.mockReset();
    updateDocument.mockReset();
    deleteDocument.mockReset();
    createFile.mockReset();
    deleteFile.mockReset();
    getFileDownload.mockReset();
    get.mockReset();
    get.mockResolvedValue(user);
    const { resetAppwriteClientForTests } = await import('../../lib/appwrite/client');
    resetAppwriteClientForTests();
  });

  it('lists workbooks for the signed-in user and filters by title substring', async () => {
    listDocuments.mockResolvedValue({
      documents: [
        {
          $id: 'w1',
          $createdAt: '2026-01-01',
          $updatedAt: '2026-01-02',
          userId: 'user-1',
          title: 'Budget.xlsx',
          fileId: 'w1',
          sizeBytes: 10,
        },
        {
          $id: 'w2',
          $createdAt: '2026-01-01',
          $updatedAt: '2026-01-03',
          userId: 'user-1',
          title: 'Notes.xlsx',
          fileId: 'w2',
          sizeBytes: 20,
        },
      ],
    });

    const { listWorkbooks } = await import('../../lib/appwrite/workbooks');
    const rows = await listWorkbooks({ search: 'note' });

    expect(listDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseId: 'editxlsx',
        collectionId: 'workbooks',
        queries: expect.arrayContaining([expect.stringContaining('user-1')]),
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('Notes.xlsx');
  });

  it('creates a workbook by uploading the file before the metadata row', async () => {
    createFile.mockResolvedValue({ $id: 'generated-id' });
    createDocument.mockResolvedValue({
      $id: 'generated-id',
      $createdAt: '2026-01-01',
      $updatedAt: '2026-01-01',
      userId: 'user-1',
      title: 'Report.xlsx',
      fileId: 'generated-id',
      sizeBytes: 4,
    });

    const { createWorkbookFromFile } = await import('../../lib/appwrite/workbooks');
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'Report.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const workbook = await createWorkbookFromFile(file);

    expect(createFile.mock.invocationCallOrder[0]).toBeLessThan(createDocument.mock.invocationCallOrder[0]!);
    expect(createFile).toHaveBeenCalledWith(
      expect.objectContaining({
        bucketId: 'workbooks',
        fileId: 'generated-id',
      }),
    );
    expect(workbook.id).toBe('generated-id');
    expect(workbook.fileId).toBe('generated-id');
  });

  it('saves by deleting the old storage object then recreating it under the same id', async () => {
    getDocument.mockResolvedValue({
      $id: 'w1',
      $createdAt: '2026-01-01',
      $updatedAt: '2026-01-01',
      userId: 'user-1',
      title: 'Report.xlsx',
      fileId: 'w1',
      sizeBytes: 4,
    });
    deleteFile.mockResolvedValue({});
    createFile.mockResolvedValue({ $id: 'w1' });
    updateDocument.mockResolvedValue({
      $id: 'w1',
      $createdAt: '2026-01-01',
      $updatedAt: '2026-01-02',
      userId: 'user-1',
      title: 'Report.xlsx',
      fileId: 'w1',
      sizeBytes: 8,
    });

    const { saveWorkbookBytes } = await import('../../lib/appwrite/workbooks');
    const file = new File([new Uint8Array(8)], 'Report.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await saveWorkbookBytes('w1', file);

    expect(deleteFile).toHaveBeenCalledWith({ bucketId: 'workbooks', fileId: 'w1' });
    expect(createFile).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'w1' }));
    expect(deleteFile.mock.invocationCallOrder[0]).toBeLessThan(createFile.mock.invocationCallOrder[0]!);
    expect(updateDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'w1',
        data: expect.objectContaining({ sizeBytes: 8 }),
      }),
    );
  });

  it('rejects non-xlsx uploads', async () => {
    const { createWorkbookFromFile } = await import('../../lib/appwrite/workbooks');
    const file = new File([new Uint8Array([1])], 'notes.csv', { type: 'text/csv' });
    await expect(createWorkbookFromFile(file)).rejects.toThrow(/xlsx/i);
    expect(createFile).not.toHaveBeenCalled();
  });
});

describe('empty xlsx', () => {
  it('builds a zip that starts with a local-file header', async () => {
    const { buildEmptyXlsxBytes } = await import('../../lib/appwrite/empty-xlsx');
    const bytes = buildEmptyXlsxBytes();
    expect(bytes[0]).toBe(0x50); // P
    expect(bytes[1]).toBe(0x4b); // K
    expect(bytes.byteLength).toBeGreaterThan(100);
  });
});
