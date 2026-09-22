/**
 * Same-origin bridge between `/workspace` and the editor iframe it hosts
 * (`?shell=1`). The frame posts when a cloud workbook finished opening or
 * failed; the shell paints loading / error chrome over an otherwise blank pane.
 */
export const SHELL_READY = 'shell:workbook-ready';
export const SHELL_FAILED = 'shell:workbook-failed';

export type ShellReadyMessage = {
  type: typeof SHELL_READY;
  workbookId: string;
};

export type ShellFailedMessage = {
  type: typeof SHELL_FAILED;
  workbookId: string;
  message: string;
};

export type ShellBridgeMessage = ShellReadyMessage | ShellFailedMessage;

export function isShellBridgeMessage(data: unknown): data is ShellBridgeMessage {
  if (!data || typeof data !== 'object') return false;
  const msg = data as Record<string, unknown>;
  if (msg.type === SHELL_READY) {
    return typeof msg.workbookId === 'string' && msg.workbookId.length > 0;
  }
  if (msg.type === SHELL_FAILED) {
    return typeof msg.workbookId === 'string' && msg.workbookId.length > 0 && typeof msg.message === 'string';
  }
  return false;
}

export function postShellReady(workbookId: string): void {
  if (typeof window === 'undefined' || window.parent === window) return;
  const message: ShellReadyMessage = { type: SHELL_READY, workbookId };
  window.parent.postMessage(message, window.location.origin);
}

export function postShellFailed(workbookId: string, message: string): void {
  if (typeof window === 'undefined' || window.parent === window) return;
  const payload: ShellFailedMessage = { type: SHELL_FAILED, workbookId, message };
  window.parent.postMessage(payload, window.location.origin);
}
