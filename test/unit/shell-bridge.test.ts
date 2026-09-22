import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isShellBridgeMessage,
  postShellFailed,
  postShellReady,
  postShellSaveState,
  SHELL_FAILED,
  SHELL_READY,
  SHELL_SAVE_STATE,
} from '../../lib/shell-bridge';

describe('shell bridge', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts ready, failed, and save-state shapes only', () => {
    expect(isShellBridgeMessage({ type: SHELL_READY, workbookId: 'w1' })).toBe(true);
    expect(isShellBridgeMessage({ type: SHELL_FAILED, workbookId: 'w1', message: 'no' })).toBe(true);
    expect(isShellBridgeMessage({ type: SHELL_SAVE_STATE, workbookId: 'w1', state: 'saving' })).toBe(true);
    expect(isShellBridgeMessage({ type: SHELL_SAVE_STATE, workbookId: 'w1', state: 'local' })).toBe(true);
    expect(isShellBridgeMessage({ type: SHELL_SAVE_STATE, workbookId: 'w1', state: 'saved' })).toBe(true);
    expect(isShellBridgeMessage({ type: SHELL_SAVE_STATE, workbookId: 'w1', state: 'error' })).toBe(true);
    expect(isShellBridgeMessage({ type: SHELL_READY })).toBe(false);
    expect(isShellBridgeMessage({ type: SHELL_SAVE_STATE, workbookId: 'w1', state: 'nope' })).toBe(false);
    expect(isShellBridgeMessage({ type: 'document:ready' })).toBe(false);
  });

  it('posts ready, failed, and save-state to the same-origin parent', () => {
    const postMessage = vi.fn();
    vi.spyOn(window, 'parent', 'get').mockReturnValue({ postMessage } as unknown as Window);
    postShellReady('w1');
    postShellFailed('w1', 'boom');
    postShellSaveState('w1', 'saving');
    postShellSaveState('w1', 'error', 'nope');
    expect(postMessage).toHaveBeenCalledWith({ type: SHELL_READY, workbookId: 'w1' }, window.location.origin);
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
  });

  it('stays quiet at the top level', () => {
    const postMessage = vi.fn();
    vi.spyOn(window, 'parent', 'get').mockReturnValue(window);
    vi.spyOn(window, 'postMessage').mockImplementation(postMessage);
    postShellReady('w1');
    postShellFailed('w1', 'boom');
    postShellSaveState('w1', 'saved');
    expect(postMessage).not.toHaveBeenCalled();
  });
});
