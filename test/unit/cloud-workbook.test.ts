import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const saveWorkbookBytes = vi.fn();
const requestSaveDocument = vi.fn();

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

describe('cloud-workbook binding', () => {
  beforeEach(async () => {
    vi.resetModules();
    saveWorkbookBytes.mockReset();
    requestSaveDocument.mockReset();
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
    expect(saveWorkbookBytes).not.toHaveBeenCalled();
  });

  it('uploads to Appwrite and clears the dirty bit when bound', async () => {
    const { bindCloudWorkbook, writeCloudWorkbook, isCloudWorkbookBound } = await import('../../lib/cloud-workbook');
    const { markDocumentDirty, hasUnsavedChanges } = await import('../../lib/unsaved-guard');

    bindCloudWorkbook({ id: 'w1', title: 'Sheet.xlsx', fileId: 'w1' });
    expect(isCloudWorkbookBound()).toBe(true);
    markDocumentDirty();
    expect(hasUnsavedChanges()).toBe(true);

    saveWorkbookBytes.mockResolvedValue({
      id: 'w1',
      title: 'Sheet.xlsx',
      fileId: 'w1',
      userId: 'u',
      sizeBytes: 3,
      createdAt: '',
      updatedAt: '',
    });

    const file = new File([new Uint8Array([1, 2, 3])], 'Sheet.xlsx');
    const ok = await writeCloudWorkbook(file);

    expect(ok).toBe(true);
    expect(saveWorkbookBytes).toHaveBeenCalledWith('w1', expect.any(File), { title: 'Sheet.xlsx' });
    expect(hasUnsavedChanges()).toBe(false);
  });
});
