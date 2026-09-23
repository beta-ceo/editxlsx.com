import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isShellBridgeMessage,
  isShellParentMessage,
  postShellFailed,
  postShellFrameReady,
  postShellNeedPayload,
  postShellOpenPayload,
  postShellReady,
  postShellSaveState,
  SHELL_FAILED,
  SHELL_FRAME_READY,
  SHELL_NEED_PAYLOAD,
  SHELL_OPEN_PAYLOAD,
  SHELL_OPEN_PAYLOAD_FAILED,
  SHELL_READY,
  SHELL_SAVE_STATE,
} from '../../lib/shell-bridge';

describe('shell bridge', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts ready, failed, save-state, need-payload, and frame-ready from the iframe', () => {
    expect(isShellBridgeMessage({ type: SHELL_READY, workbookId: 'w1' })).toBe(true);
    expect(isShellBridgeMessage({ type: SHELL_FAILED, workbookId: 'w1', message: 'no' })).toBe(true);
    expect(isShellBridgeMessage({ type: SHELL_SAVE_STATE, workbookId: 'w1', state: 'saving' })).toBe(true);
    expect(isShellBridgeMessage({ type: SHELL_NEED_PAYLOAD, workbookId: 'w1' })).toBe(true);
    expect(isShellBridgeMessage({ type: SHELL_FRAME_READY })).toBe(true);
    expect(isShellBridgeMessage({ type: SHELL_READY })).toBe(false);
    expect(isShellBridgeMessage({ type: SHELL_SAVE_STATE, workbookId: 'w1', state: 'nope' })).toBe(false);
    expect(isShellBridgeMessage({ type: 'document:ready' })).toBe(false);
  });

  it('accepts open-payload and open-payload-failed from the parent', () => {
    const workbook = {
      id: 'w1',
      userId: 'u1',
      title: 'a.xlsx',
      fileId: 'f1',
      format: 'xlsx',
      sizeBytes: 1,
      updatedAt: '2026-09-23T00:00:00.000+00:00',
      createdAt: '2026-09-23T00:00:00.000+00:00',
      parentId: '',
      sortOrder: 0,
    };
    expect(
      isShellParentMessage({
        type: SHELL_OPEN_PAYLOAD,
        workbookId: 'w1',
        workbook,
        buffer: new ArrayBuffer(8),
        source: 'download',
      }),
    ).toBe(true);
    expect(
      isShellParentMessage({ type: SHELL_OPEN_PAYLOAD_FAILED, workbookId: 'w1', message: 'no' }),
    ).toBe(true);
    expect(isShellParentMessage({ type: SHELL_OPEN_PAYLOAD, workbookId: 'w1' })).toBe(false);
  });

  it('posts ready, failed, save-state, and need-payload to the same-origin parent', () => {
    const postMessage = vi.fn();
    vi.spyOn(window, 'parent', 'get').mockReturnValue({ postMessage } as unknown as Window);
    postShellReady('w1');
    postShellReady('w2', {
      workbookId: 'w2',
      t0: 0,
      marks: {},
      segments: [],
      totalMs: 12,
    });
    postShellFailed('w1', 'boom');
    postShellSaveState('w1', 'saving');
    postShellSaveState('w1', 'error', 'nope');
    postShellNeedPayload('w1');
    postShellFrameReady();
    expect(postMessage).toHaveBeenCalledWith({ type: SHELL_READY, workbookId: 'w1' }, window.location.origin);
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: SHELL_READY,
        workbookId: 'w2',
        timing: { workbookId: 'w2', t0: 0, marks: {}, segments: [], totalMs: 12 },
      },
      window.location.origin,
    );
    expect(postMessage).toHaveBeenCalledWith(
      { type: SHELL_FAILED, workbookId: 'w1', message: 'boom' },
      window.location.origin,
    );
    expect(postMessage).toHaveBeenCalledWith(
      { type: SHELL_SAVE_STATE, workbookId: 'w1', state: 'saving' },
      window.location.origin,
    );
    expect(postMessage).toHaveBeenCalledWith(
      { type: SHELL_SAVE_STATE, workbookId: 'w1', state: 'error', message: 'nope' },
      window.location.origin,
    );
    expect(postMessage).toHaveBeenCalledWith(
      { type: SHELL_NEED_PAYLOAD, workbookId: 'w1' },
      window.location.origin,
    );
    expect(postMessage).toHaveBeenCalledWith({ type: SHELL_FRAME_READY }, window.location.origin);
  });

  it('posts open-payload to the framed editor with a transferable buffer', () => {
    const postMessage = vi.fn();
    const target = { postMessage } as unknown as Window;
    const buffer = new ArrayBuffer(4);
    postShellOpenPayload(target, {
      workbookId: 'w1',
      workbook: {
        id: 'w1',
        userId: 'u1',
        title: 'a.xlsx',
        fileId: 'f1',
        format: 'xlsx',
        sizeBytes: 4,
        updatedAt: '2026-09-23T00:00:00.000+00:00',
        createdAt: '2026-09-23T00:00:00.000+00:00',
        parentId: '',
        sortOrder: 0,
      },
      buffer,
      source: 'pending',
    });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: SHELL_OPEN_PAYLOAD, workbookId: 'w1', source: 'pending' }),
      window.location.origin,
      [buffer],
    );
  });

  it('stays quiet at the top level', () => {
    const postMessage = vi.fn();
    vi.spyOn(window, 'parent', 'get').mockReturnValue(window);
    vi.spyOn(window, 'postMessage').mockImplementation(postMessage);
    postShellReady('w1');
    postShellFailed('w1', 'boom');
    postShellSaveState('w1', 'saved');
    postShellNeedPayload('w1');
    expect(postMessage).not.toHaveBeenCalled();
  });
});
