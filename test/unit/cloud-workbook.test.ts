import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const saveWorkbookBytes = vi.fn();
const requestSaveDocument = vi.fn();
const putCloudPending = vi.fn();
const getCloudPending = vi.fn();
const clearCloudPending = vi.fn();
const postShellSaveState = vi.fn();

vi.mock('../../lib/appwrite/workbooks', () => ({
  saveWorkbookBytes: (...args: unknown[]) => saveWorkbookBytes(...args),
}));

vi.mock('../../lib/onlyoffice/save-stream', () => ({
  requestSaveDocument: (...args: unknown[]) => requestSaveDocument(...args),
}));

vi.mock('../../lib/onlyoffice/readonly', () => ({
  getReadonlyMode: () => false,
}));

vi.mock('../../lib/embed-mode', () => ({
  isEmbedMode: () => false,
}));

vi.mock('../../lib/cloud-pending', () => ({
  putCloudPending: (...args: unknown[]) => putCloudPending(...args),
  getCloudPending: (...args: unknown[]) => getCloudPending(...args),
  clearCloudPending: (...args: unknown[]) => clearCloudPending(...args),
}));

vi.mock('../../lib/shell-bridge', () => ({
  postShellSaveState: (...args: unknown[]) => postShellSaveState(...args),
}));

describe('cloud-workbook binding', () => {
  beforeEach(async () => {
    vi.resetModules();
    saveWorkbookBytes.mockReset();
    requestSaveDocument.mockReset();
    putCloudPending.mockReset();
    getCloudPending.mockReset();
    clearCloudPending.mockReset();
    postShellSaveState.mockReset();
    const { unbindCloudWorkbook } = await import('../../lib/cloud-workbook');
    unbindCloudWorkbook();
  });

  afterEach(async () => {
    const { unbindCloudWorkbook } = await import('../../lib/cloud-workbook');
    unbindCloudWorkbook();
  });

  it('writeCloudWorkbook is a no-op when nothing is bound', async () => {
    const { writeCloudWorkbook, isCloudWorkbookBound } = await import('../../lib/cloud-workbook');
    expect(isCloudWorkbookBound()).toBe(false);
    const ok = await writeCloudWorkbook(new File([new Uint8Array([1])], 'a.xlsx'));
    expect(ok).toBe(false);
    expect(putCloudPending).not.toHaveBeenCalled();
    expect(saveWorkbookBytes).not.toHaveBeenCalled();
  });

  it('stages locally then flushes to Appwrite in the background', async () => {
    const { bindCloudWorkbook, writeCloudWorkbook, isCloudWorkbookBound } = await import('../../lib/cloud-workbook');
    const {
      markDocumentDirty,
      hasUnsavedChanges,
      hasPendingCloudSync,
      resetUnsavedGuardForTests,
    } = await import('../../lib/unsaved-guard');

    resetUnsavedGuardForTests();
    bindCloudWorkbook({ id: 'w1', title: 'Sheet.xlsx', fileId: 'f1', userId: 'u' });
    expect(isCloudWorkbookBound()).toBe(true);
    markDocumentDirty();
    expect(hasUnsavedChanges()).toBe(true);

    putCloudPending.mockResolvedValue(true);
    getCloudPending
      .mockResolvedValueOnce({
        workbookId: 'w1',
        title: 'Sheet.xlsx',
        userId: 'u',
        fileId: 'f1',
        bytes: new Uint8Array([1, 2, 3]),
        savedAt: 1000,
      })
      .mockResolvedValueOnce({
        workbookId: 'w1',
        title: 'Sheet.xlsx',
        userId: 'u',
        fileId: 'f1',
        bytes: new Uint8Array([1, 2, 3]),
        savedAt: 1000,
      })
      .mockResolvedValue(null);
    clearCloudPending.mockResolvedValue(undefined);
    saveWorkbookBytes.mockResolvedValue({
      id: 'w1',
      title: 'Sheet.xlsx',
      fileId: 'f2',
      userId: 'u',
      sizeBytes: 3,
      kind: 'file',
      format: 'xlsx',
      parentId: '',
      createdAt: '',
      updatedAt: '',
    });

    const file = new File([new Uint8Array([1, 2, 3])], 'Sheet.xlsx');
    const ok = await writeCloudWorkbook(file);

    expect(ok).toBe(true);
    expect(putCloudPending).toHaveBeenCalledWith(
      'w1',
      expect.any(File),
      expect.objectContaining({ userId: 'u', fileId: 'f1', title: 'Sheet.xlsx' }),
    );
    expect(hasUnsavedChanges()).toBe(false);
    expect(hasPendingCloudSync()).toBe(true);
    expect(postShellSaveState).toHaveBeenCalledWith('w1', 'local');

    await vi.waitFor(() => {
      expect(saveWorkbookBytes).toHaveBeenCalled();
      expect(clearCloudPending).toHaveBeenCalledWith('w1');
      expect(hasPendingCloudSync()).toBe(false);
    });
    expect(postShellSaveState).toHaveBeenCalledWith('w1', 'saved');
  });

  it('falls back to a blocking cloud write when IndexedDB is unavailable', async () => {
    const { bindCloudWorkbook, writeCloudWorkbook } = await import('../../lib/cloud-workbook');
    bindCloudWorkbook({ id: 'w1', title: 'Sheet.xlsx', fileId: 'f1', userId: 'u' });
    putCloudPending.mockResolvedValue(false);
    saveWorkbookBytes.mockResolvedValue({
      id: 'w1',
      title: 'Sheet.xlsx',
      fileId: 'f2',
      userId: 'u',
      sizeBytes: 1,
      kind: 'file',
      format: 'xlsx',
      parentId: '',
      createdAt: '',
      updatedAt: '',
    });

    const ok = await writeCloudWorkbook(new File([new Uint8Array([1])], 'Sheet.xlsx'));
    expect(ok).toBe(true);
    expect(saveWorkbookBytes).toHaveBeenCalledWith(
      'w1',
      expect.any(File),
      expect.objectContaining({ hot: expect.objectContaining({ fileId: 'f1' }) }),
    );
    expect(postShellSaveState).toHaveBeenCalledWith('w1', 'saved');
  });

  it('passes the bound format on the blocking fallback save', async () => {
    const { bindCloudWorkbook, writeCloudWorkbook } = await import('../../lib/cloud-workbook');
    bindCloudWorkbook({ id: 'w1', title: 'Notes.docx', fileId: 'f1', userId: 'u', format: 'docx' });
    putCloudPending.mockResolvedValue(false);
    saveWorkbookBytes.mockResolvedValue({
      id: 'w1',
      title: 'Notes.docx',
      fileId: 'f2',
      userId: 'u',
      sizeBytes: 1,
      kind: 'file',
      format: 'docx',
      parentId: '',
      createdAt: '',
      updatedAt: '',
    });

    const ok = await writeCloudWorkbook(new File([new Uint8Array([1])], 'Notes.docx'));
    expect(ok).toBe(true);
    expect(saveWorkbookBytes).toHaveBeenCalledWith(
      'w1',
      expect.any(File),
      expect.objectContaining({ hot: expect.objectContaining({ format: 'docx' }) }),
    );
  });
});
