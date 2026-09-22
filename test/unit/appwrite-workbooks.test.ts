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

  it('saves by minting a new storage id then pointing the row at it', async () => {
    getDocument.mockResolvedValue({
      $id: 'w1',
      $createdAt: '2026-01-01',
      $updatedAt: '2026-01-01',
      userId: 'user-1',
      title: 'Report.xlsx',
      fileId: 'w1',
      sizeBytes: 4,
    });
    createFile.mockResolvedValue({ $id: 'generated-id' });
    updateDocument.mockResolvedValue({
      $id: 'w1',
      $createdAt: '2026-01-01',
      $updatedAt: '2026-01-02',
      userId: 'user-1',
      title: 'Report.xlsx',
      fileId: 'generated-id',
      sizeBytes: 8,
    });
    deleteFile.mockResolvedValue({});

    const { saveWorkbookBytes } = await import('../../lib/appwrite/workbooks');
    const file = new File([new Uint8Array(8)], 'Report.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const updated = await saveWorkbookBytes('w1', file);

    expect(createFile).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'generated-id' }));
    expect(updateDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'w1',
        data: expect.objectContaining({ sizeBytes: 8, fileId: 'generated-id' }),
      }),
    );
    expect(updated.fileId).toBe('generated-id');
    // Previous object is deleted after the row points at the new one (fire-and-forget).
    await vi.waitFor(() => {
      expect(deleteFile).toHaveBeenCalledWith({ bucketId: 'workbooks', fileId: 'w1' });
    });
    expect(createFile.mock.invocationCallOrder[0]).toBeLessThan(updateDocument.mock.invocationCallOrder[0]!);
  });

  it('hot save skips Account.get and Databases.getDocument', async () => {
    createFile.mockResolvedValue({ $id: 'generated-id' });
    updateDocument.mockResolvedValue({
      $id: 'w1',
      $createdAt: '2026-01-01',
      $updatedAt: '2026-01-02',
      userId: 'user-1',
      title: 'Report.xlsx',
      fileId: 'generated-id',
      sizeBytes: 8,
    });
    deleteFile.mockResolvedValue({});

    const { saveWorkbookBytes } = await import('../../lib/appwrite/workbooks');
    const file = new File([new Uint8Array(8)], 'Report.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await saveWorkbookBytes('w1', file, {
      hot: { userId: 'user-1', fileId: 'old-file', title: 'Report.xlsx' },
    });

    expect(get.mock.calls.length).toBe(0);
    expect(getDocument).not.toHaveBeenCalled();
    expect(createFile).toHaveBeenCalled();
    expect(updateDocument).toHaveBeenCalled();
  });

  it('downloads with cache: no-store and a bust query so Save-then-reopen is not stale', async () => {
    getFileDownload.mockReturnValue(
      new URL('https://sfo.cloud.appwrite.io/v1/storage/buckets/workbooks/files/w1/download'),
    );
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => bytes.buffer,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { downloadWorkbookFile } = await import('../../lib/appwrite/workbooks');
    const file = await downloadWorkbookFile('w1', 'Report.xlsx', { cacheBust: '2026-01-02T00:00:00.000Z' });

    expect(file.name).toBe('Report.xlsx');
    expect(file.size).toBe(4);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sfo.cloud.appwrite.io/v1/storage/buckets/workbooks/files/w1/download?v=2026-01-02T00%3A00%3A00.000Z',
      expect.objectContaining({
        cache: 'no-store',
        credentials: 'include',
        headers: expect.objectContaining({ 'X-Appwrite-Project': expect.any(String) }),
      }),
    );
    vi.unstubAllGlobals();
  });

  it('rejects non-office uploads', async () => {
    const { createWorkbookFromFile } = await import('../../lib/appwrite/workbooks');
    const file = new File([new Uint8Array([1])], 'notes.csv', { type: 'text/csv' });
    await expect(createWorkbookFromFile(file)).rejects.toThrow(/xlsx|docx|pptx/i);
    expect(createFile).not.toHaveBeenCalled();
  });

  it('creates a folder as metadata with no storage object', async () => {
    createDocument.mockResolvedValue({
      $id: 'generated-id',
      $createdAt: '2026-01-01',
      $updatedAt: '2026-01-01',
      userId: 'user-1',
      title: 'Projects',
      fileId: '',
      sizeBytes: 0,
      kind: 'folder',
      format: 'none',
      parentId: '',
    });

    const { createFolder } = await import('../../lib/appwrite/workbooks');
    const folder = await createFolder('Projects');

    expect(createFile).not.toHaveBeenCalled();
    expect(createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'folder',
          format: 'none',
          fileId: '',
          parentId: '',
        }),
      }),
    );
    expect(folder.kind).toBe('folder');
    expect(folder.format).toBe('');
  });

  it('refuses to delete a non-empty folder', async () => {
    getDocument.mockResolvedValue({
      $id: 'folder-1',
      $createdAt: '2026-01-01',
      $updatedAt: '2026-01-01',
      userId: 'user-1',
      title: 'Projects',
      fileId: '',
      sizeBytes: 0,
      kind: 'folder',
      format: 'none',
      parentId: '',
    });
    listDocuments.mockResolvedValue({
      documents: [
        {
          $id: 'child-1',
          $createdAt: '2026-01-01',
          $updatedAt: '2026-01-01',
          userId: 'user-1',
          title: 'A.xlsx',
          fileId: 'child-1',
          sizeBytes: 1,
          kind: 'file',
          format: 'xlsx',
          parentId: 'folder-1',
        },
      ],
    });

    const { deleteVaultItem } = await import('../../lib/appwrite/workbooks');
    await expect(deleteVaultItem('folder-1')).rejects.toThrow(/not empty/i);
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it('creates a blank docx with parentId', async () => {
    createFile.mockResolvedValue({ $id: 'generated-id' });
    createDocument.mockResolvedValue({
      $id: 'generated-id',
      $createdAt: '2026-01-01',
      $updatedAt: '2026-01-01',
      userId: 'user-1',
      title: 'Untitled.docx',
      fileId: 'generated-id',
      sizeBytes: 200,
      kind: 'file',
      format: 'docx',
      parentId: 'folder-1',
    });

    const { createBlankFile } = await import('../../lib/appwrite/workbooks');
    const doc = await createBlankFile('docx', { parentId: 'folder-1' });

    expect(createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'file',
          format: 'docx',
          parentId: 'folder-1',
        }),
      }),
    );
    expect(doc.format).toBe('docx');
  });
});

describe('empty office packages', () => {
  it('builds a zip that starts with a local-file header', async () => {
    const { buildEmptyXlsxBytes } = await import('../../lib/appwrite/empty-xlsx');
    const bytes = buildEmptyXlsxBytes();
    expect(bytes[0]).toBe(0x50); // P
    expect(bytes[1]).toBe(0x4b); // K
    expect(bytes.byteLength).toBeGreaterThan(100);
  });

  it('builds blank docx packages', async () => {
    const { buildEmptyDocxBytes } = await import('../../lib/appwrite/empty-office');
    const bytes = buildEmptyDocxBytes();
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes.byteLength).toBeGreaterThan(80);
  });

  it('loads blank pptx from the vendor 01_blank template', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const template = readFileSync(resolve('public/sdkjs/slide/themes/src/01_blank.pptx'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(String(url)).toContain('01_blank.pptx');
        return new Response(template, { status: 200 });
      }),
    );
    try {
      const { buildEmptyPptxBytes, BLANK_PPTX_URL } = await import('../../lib/appwrite/empty-office');
      expect(BLANK_PPTX_URL).toContain('01_blank.pptx');
      const bytes = await buildEmptyPptxBytes();
      expect(bytes[0]).toBe(0x50);
      expect(bytes[1]).toBe(0x4b);
      expect(bytes.byteLength).toBe(template.byteLength);
      expect(bytes.byteLength).toBeGreaterThan(10_000);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
