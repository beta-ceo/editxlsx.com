import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Workbook } from '../../lib/appwrite/workbooks';

const downloadWorkbookFile = vi.fn();
const getWorkbook = vi.fn();
const takeCloudPendingIfNewer = vi.fn();
const postShellOpenPayload = vi.fn();
const postShellOpenPayloadFailed = vi.fn();
const getCachedWorkbookFile = vi.fn((): File | null => null);
const putCachedWorkbookFile = vi.fn(async () => undefined);

vi.mock('../../lib/appwrite/workbooks', () => ({
  downloadWorkbookFile: (...args: unknown[]) => downloadWorkbookFile(...args),
  getWorkbook: (...args: unknown[]) => getWorkbook(...args),
}));

vi.mock('../../lib/cloud-pending', () => ({
  takeCloudPendingIfNewer: (...args: unknown[]) => takeCloudPendingIfNewer(...args),
}));

vi.mock('../../lib/workbook-file-cache', () => ({
  getCachedWorkbookFile: (...args: unknown[]) => getCachedWorkbookFile(...args),
  putCachedWorkbookFile: (...args: unknown[]) => putCachedWorkbookFile(...args),
}));

vi.mock('../../lib/shell-bridge', async () => {
  const actual = await vi.importActual<typeof import('../../lib/shell-bridge')>('../../lib/shell-bridge');
  return {
    ...actual,
    postShellOpenPayload: (...args: unknown[]) => postShellOpenPayload(...args),
    postShellOpenPayloadFailed: (...args: unknown[]) => postShellOpenPayloadFailed(...args),
  };
});

describe('shell open handoff', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getCachedWorkbookFile.mockReturnValue(null);
  });

  const listRow: Workbook = {
    id: 'wb1',
    userId: 'u1',
    title: 'a.xlsx',
    kind: 'file',
    format: 'xlsx',
    parentId: '',
    sortOrder: 0,
    fileId: 'file-old',
    sizeBytes: 10,
    createdAt: '2026-09-20T00:00:00.000+00:00',
    updatedAt: '2026-09-21T00:00:00.000+00:00',
  };

  it('starts Storage download from the list row and delivers when the frame asks', async () => {
    const fresh: Workbook = { ...listRow, updatedAt: '2026-09-22T00:00:00.000+00:00' };
    getWorkbook.mockResolvedValue(fresh);
    takeCloudPendingIfNewer.mockResolvedValue(null);
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    downloadWorkbookFile.mockResolvedValue(new File([bytes], 'a.xlsx'));

    const { beginShellOpenHandoff, onShellNeedPayload } = await import('../../lib/shell-open-handoff');
    const onMeta = vi.fn();
    beginShellOpenHandoff(listRow, { onMeta });

    const contentWindow = {} as Window;
    const frame = { contentWindow } as HTMLIFrameElement;
    onShellNeedPayload('wb1', frame);

    await vi.waitFor(() => expect(postShellOpenPayload).toHaveBeenCalled());
    expect(downloadWorkbookFile).toHaveBeenCalledWith('file-old', 'a.xlsx', {
      cacheBust: listRow.updatedAt,
      format: 'xlsx',
    });
    expect(onMeta).toHaveBeenCalledWith(fresh);
    expect(postShellOpenPayload).toHaveBeenCalledWith(
      contentWindow,
      expect.objectContaining({
        workbookId: 'wb1',
        source: 'download',
        workbook: expect.objectContaining({ fileId: 'file-old', updatedAt: fresh.updatedAt }),
      }),
    );
  });

  it('re-downloads when getWorkbook reports a rotated fileId', async () => {
    const fresh: Workbook = { ...listRow, fileId: 'file-new', updatedAt: '2026-09-22T12:00:00.000+00:00' };
    getWorkbook.mockResolvedValue(fresh);
    takeCloudPendingIfNewer.mockResolvedValue(null);
    downloadWorkbookFile
      .mockResolvedValueOnce(new File([new Uint8Array([9])], 'stale.xlsx'))
      .mockResolvedValueOnce(new File([new Uint8Array([1, 2])], 'a.xlsx'));

    const { beginShellOpenHandoff, onShellNeedPayload, resetShellFrameReady } =
      await import('../../lib/shell-open-handoff');
    resetShellFrameReady();
    beginShellOpenHandoff(listRow);
    onShellNeedPayload('wb1', { contentWindow: {} } as HTMLIFrameElement);

    await vi.waitFor(() => expect(postShellOpenPayload).toHaveBeenCalled());
    expect(downloadWorkbookFile).toHaveBeenCalledTimes(2);
    expect(downloadWorkbookFile).toHaveBeenLastCalledWith('file-new', 'a.xlsx', {
      cacheBust: fresh.updatedAt,
      format: 'xlsx',
    });
    expect(postShellOpenPayload.mock.calls[0][1].source).toBe('download');
    expect(postShellOpenPayload.mock.calls[0][1].workbook.fileId).toBe('file-new');
  });

  it('prefers a newer IndexedDB pending over Storage', async () => {
    getWorkbook.mockResolvedValue(listRow);
    const pending = new File([new Uint8Array([7, 7])], 'a.xlsx');
    takeCloudPendingIfNewer.mockResolvedValue(pending);
    downloadWorkbookFile.mockResolvedValue(new File([new Uint8Array([1])], 'a.xlsx'));

    const { beginShellOpenHandoff, onShellNeedPayload, resetShellFrameReady } =
      await import('../../lib/shell-open-handoff');
    resetShellFrameReady();
    beginShellOpenHandoff(listRow);
    onShellNeedPayload('wb1', { contentWindow: {} } as HTMLIFrameElement);

    await vi.waitFor(() => expect(postShellOpenPayload).toHaveBeenCalled());
    expect(postShellOpenPayload.mock.calls[0][1].source).toBe('pending');
  });

  it('pushes payload when the warm frame becomes ready after download', async () => {
    getWorkbook.mockResolvedValue(listRow);
    takeCloudPendingIfNewer.mockResolvedValue(null);
    downloadWorkbookFile.mockResolvedValue(new File([new Uint8Array([1, 2, 3])], 'a.xlsx'));

    const { beginShellOpenHandoff, onShellFrameReady, resetShellFrameReady } =
      await import('../../lib/shell-open-handoff');
    resetShellFrameReady();
    beginShellOpenHandoff(listRow);
    onShellFrameReady({ contentWindow: {} } as HTMLIFrameElement);

    await vi.waitFor(() => expect(postShellOpenPayload).toHaveBeenCalled());
    expect(postShellOpenPayload.mock.calls[0][1].workbookId).toBe('wb1');
  });

  it('serves a cached Storage revision without hitting download', async () => {
    // Never resolves: proves the open path does not await Documents on a hit.
    getWorkbook.mockReturnValue(new Promise(() => undefined));
    takeCloudPendingIfNewer.mockResolvedValue(null);
    getCachedWorkbookFile.mockReturnValue(new File([new Uint8Array([9, 9])], 'a.xlsx'));

    const { beginShellOpenHandoff, onShellNeedPayload, resetShellFrameReady } =
      await import('../../lib/shell-open-handoff');
    resetShellFrameReady();
    const onPhase = vi.fn();
    beginShellOpenHandoff(listRow, { onPhase });
    onShellNeedPayload('wb1', { contentWindow: {} } as HTMLIFrameElement);

    await vi.waitFor(() => expect(postShellOpenPayload).toHaveBeenCalled());
    expect(downloadWorkbookFile).not.toHaveBeenCalled();
    expect(postShellOpenPayload.mock.calls[0][1].source).toBe('cache');
    expect(onPhase).toHaveBeenCalledWith('download');
    expect(onPhase).toHaveBeenCalledWith('editor');
  });
});
