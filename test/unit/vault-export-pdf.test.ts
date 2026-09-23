import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@ranuts/converter', () => ({
  saveFileToDisk: vi.fn().mockResolvedValue(undefined),
}));

import { saveFileToDisk } from '@ranuts/converter';
import {
  exportWorkbookAsPdf,
  pdfFileNameForTitle,
  workbookSupportsPdfExport,
} from '../../lib/vault-export-pdf';
import type { Workbook } from '../../lib/appwrite/workbooks';

const workbook: Workbook = {
  id: 'wb1',
  userId: 'u1',
  title: 'Sheet.xlsx',
  kind: 'file',
  format: 'xlsx',
  parentId: '',
  sortOrder: 0,
  fileId: 'file1',
  sizeBytes: 12,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

describe('vault-export-pdf', () => {
  beforeEach(() => {
    vi.mocked(saveFileToDisk).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('recognises office files and rejects folders', () => {
    expect(workbookSupportsPdfExport(workbook)).toBe(true);
    expect(workbookSupportsPdfExport({ kind: 'folder', format: '' })).toBe(false);
    expect(workbookSupportsPdfExport({ kind: 'file', format: 'pdf' })).toBe(false);
  });

  it('builds a .pdf name from the workbook title', () => {
    expect(pdfFileNameForTitle('Sheet.xlsx')).toBe('Sheet.pdf');
    expect(pdfFileNameForTitle('Report')).toBe('Report.pdf');
  });

  it('saves PDF bytes from the editor export path', async () => {
    const viaEditor = vi.fn().mockResolvedValue(
      new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], 'Sheet.pdf', {
        type: 'application/pdf',
      }),
    );
    await exportWorkbookAsPdf(workbook, viaEditor);
    expect(viaEditor).toHaveBeenCalledWith(workbook);
    expect(saveFileToDisk).toHaveBeenCalledWith(expect.any(Uint8Array), 'Sheet.pdf', 'application/pdf');
  });

  it('rejects non-PDF bytes from the editor', async () => {
    const viaEditor = vi.fn().mockResolvedValue(new File([new Uint8Array([1, 2, 3])], 'Sheet.bin'));
    await expect(exportWorkbookAsPdf(workbook, viaEditor)).rejects.toThrow(/did not produce a PDF/);
    expect(saveFileToDisk).not.toHaveBeenCalled();
  });
});
