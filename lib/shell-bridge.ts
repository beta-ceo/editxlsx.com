/**
 * Same-origin bridge between `/workspace` and the editor iframe it hosts
 * (`?shell=1`). The frame posts when a cloud workbook finished opening or
 * failed, and when a Save / autosave is in flight so the shell can show a
 * Docs-style sync chip instead of waiting on a completion toast.
 * States: saving → local (on this device, account upload in flight) → saved
 * (synced to account) | error.
 */
export const SHELL_READY = 'shell:workbook-ready';
export const SHELL_FAILED = 'shell:workbook-failed';
export const SHELL_SAVE_STATE = 'shell:save-state';

export type ShellReadyMessage = {
  type: typeof SHELL_READY;
  workbookId: string;
};

export type ShellFailedMessage = {
  type: typeof SHELL_FAILED;
  workbookId: string;
  message: string;
};

export type ShellSaveState = 'saving' | 'local' | 'saved' | 'error';

export type ShellSaveStateMessage = {
  type: typeof SHELL_SAVE_STATE;
  workbookId: string;
  state: ShellSaveState;
  message?: string;
};

export type ShellBridgeMessage = ShellReadyMessage | ShellFailedMessage | ShellSaveStateMessage;

export function isShellBridgeMessage(data: unknown): data is ShellBridgeMessage {
  if (!data || typeof data !== 'object') return false;
  const msg = data as Record<string, unknown>;
  if (msg.type === SHELL_READY) {
    return typeof msg.workbookId === 'string' && msg.workbookId.length > 0;
  }
  if (msg.type === SHELL_FAILED) {
    return typeof msg.workbookId === 'string' && msg.workbookId.length > 0 && typeof msg.message === 'string';
  }
  if (msg.type === SHELL_SAVE_STATE) {
    return (
      typeof msg.workbookId === 'string' &&
      msg.workbookId.length > 0 &&
      (msg.state === 'saving' || msg.state === 'local' || msg.state === 'saved' || msg.state === 'error')
    );
  }
  return false;
}

function postToParent(message: ShellBridgeMessage): void {
  if (typeof window === 'undefined' || window.parent === window) return;
  window.parent.postMessage(message, window.location.origin);
}

export function postShellReady(workbookId: string): void {
  postToParent({ type: SHELL_READY, workbookId });
}

export function postShellFailed(workbookId: string, message: string): void {
  postToParent({ type: SHELL_FAILED, workbookId, message });
}

export function postShellSaveState(workbookId: string, state: ShellSaveState, message?: string): void {
  const payload: ShellSaveStateMessage = { type: SHELL_SAVE_STATE, workbookId, state };
  if (message) payload.message = message;
  postToParent(payload);
}
