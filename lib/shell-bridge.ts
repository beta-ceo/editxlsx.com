/**
 * Same-origin bridge between `/workspace` and the editor iframe it hosts
 * (`?shell=1`). The frame posts when a cloud workbook finished opening or
 * failed, and when a Save / autosave is in flight so the shell can show a
 * Docs-style sync chip instead of waiting on a completion toast.
 * States: saving → local (on this device, account upload in flight) → saved
 * (synced to account) | error.
 *
 * Open handoff: the shell downloads (or takes IndexedDB pending) in parallel
 * with iframe boot, then posts `shell:open-payload` after the frame asks with
 * `shell:need-payload`. That overlaps Appwrite RTT with module evaluation.
 */
import type { VaultFormat } from './appwrite/ids';
import type { OpenTimingReport } from './open-timing';

export const SHELL_READY = 'shell:workbook-ready';
export const SHELL_FAILED = 'shell:workbook-failed';
export const SHELL_SAVE_STATE = 'shell:save-state';
/** iframe → parent: ready to receive bytes for this workbook. */
export const SHELL_NEED_PAYLOAD = 'shell:need-payload';
/** parent → iframe: workbook meta + file bytes (ArrayBuffer, transferable). */
export const SHELL_OPEN_PAYLOAD = 'shell:open-payload';
/** parent → iframe: shell-side open failed before bytes were ready. */
export const SHELL_OPEN_PAYLOAD_FAILED = 'shell:open-payload-failed';

export type ShellReadyMessage = {
  type: typeof SHELL_READY;
  workbookId: string;
  /** Optional open-path segment timings (diagnostic; ignore in product logic). */
  timing?: OpenTimingReport;
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

export type ShellNeedPayloadMessage = {
  type: typeof SHELL_NEED_PAYLOAD;
  workbookId: string;
};

/** Serializable workbook fields the editor needs to bind cloud save. */
export type ShellOpenWorkbookMeta = {
  id: string;
  userId: string;
  title: string;
  fileId: string;
  format: VaultFormat;
  sizeBytes: number;
  updatedAt: string;
  createdAt: string;
  parentId: string;
  sortOrder: number;
};

export type ShellOpenPayloadMessage = {
  type: typeof SHELL_OPEN_PAYLOAD;
  workbookId: string;
  workbook: ShellOpenWorkbookMeta;
  buffer: ArrayBuffer;
  source: 'pending' | 'download';
};

export type ShellOpenPayloadFailedMessage = {
  type: typeof SHELL_OPEN_PAYLOAD_FAILED;
  workbookId: string;
  message: string;
};

/** Messages the shell parent listens for from the editor iframe. */
export type ShellBridgeMessage =
  | ShellReadyMessage
  | ShellFailedMessage
  | ShellSaveStateMessage
  | ShellNeedPayloadMessage;

/** Messages the editor iframe listens for from the workspace shell. */
export type ShellParentMessage = ShellOpenPayloadMessage | ShellOpenPayloadFailedMessage;

export function isShellBridgeMessage(data: unknown): data is ShellBridgeMessage {
  if (!data || typeof data !== 'object') return false;
  const msg = data as Record<string, unknown>;
  if (msg.type === SHELL_READY || msg.type === SHELL_NEED_PAYLOAD) {
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

export function isShellParentMessage(data: unknown): data is ShellParentMessage {
  if (!data || typeof data !== 'object') return false;
  const msg = data as Record<string, unknown>;
  if (msg.type === SHELL_OPEN_PAYLOAD_FAILED) {
    return typeof msg.workbookId === 'string' && msg.workbookId.length > 0 && typeof msg.message === 'string';
  }
  if (msg.type !== SHELL_OPEN_PAYLOAD) return false;
  if (typeof msg.workbookId !== 'string' || !msg.workbookId) return false;
  if (msg.source !== 'pending' && msg.source !== 'download') return false;
  if (!(msg.buffer instanceof ArrayBuffer)) return false;
  const wb = msg.workbook;
  if (!wb || typeof wb !== 'object') return false;
  const meta = wb as Record<string, unknown>;
  return (
    typeof meta.id === 'string' &&
    typeof meta.userId === 'string' &&
    typeof meta.title === 'string' &&
    typeof meta.fileId === 'string' &&
    typeof meta.format === 'string' &&
    typeof meta.updatedAt === 'string'
  );
}

function postToParent(message: ShellBridgeMessage): void {
  if (typeof window === 'undefined' || window.parent === window) return;
  window.parent.postMessage(message, window.location.origin);
}

export function postShellReady(workbookId: string, timing?: OpenTimingReport): void {
  const message: ShellReadyMessage = { type: SHELL_READY, workbookId };
  if (timing) message.timing = timing;
  postToParent(message);
}

export function postShellFailed(workbookId: string, message: string): void {
  postToParent({ type: SHELL_FAILED, workbookId, message });
}

export function postShellSaveState(workbookId: string, state: ShellSaveState, message?: string): void {
  const payload: ShellSaveStateMessage = { type: SHELL_SAVE_STATE, workbookId, state };
  if (message) payload.message = message;
  postToParent(payload);
}

export function postShellNeedPayload(workbookId: string): void {
  postToParent({ type: SHELL_NEED_PAYLOAD, workbookId });
}

export function postShellOpenPayload(
  target: Window,
  payload: Omit<ShellOpenPayloadMessage, 'type'>,
): void {
  const message: ShellOpenPayloadMessage = { type: SHELL_OPEN_PAYLOAD, ...payload };
  target.postMessage(message, window.location.origin, [payload.buffer]);
}

export function postShellOpenPayloadFailed(target: Window, workbookId: string, message: string): void {
  const body: ShellOpenPayloadFailedMessage = {
    type: SHELL_OPEN_PAYLOAD_FAILED,
    workbookId,
    message,
  };
  target.postMessage(body, window.location.origin);
}

/**
 * Ask the parent for open bytes and resolve when they arrive.
 * `null` means timeout — caller should fall back to self-fetch.
 */
export function waitForShellOpenPayload(
  workbookId: string,
  timeoutMs: number,
): Promise<ShellOpenPayloadMessage | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result: ShellOpenPayloadMessage | null): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(result);
    };
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== window.parent) return;
      if (!isShellParentMessage(event.data)) return;
      if (event.data.workbookId !== workbookId) return;
      if (event.data.type === SHELL_OPEN_PAYLOAD_FAILED) {
        window.clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        settled = true;
        reject(new Error(event.data.message));
        return;
      }
      finish(event.data);
    };
    window.addEventListener('message', onMessage);
    postShellNeedPayload(workbookId);
    const timer = window.setTimeout(() => finish(null), timeoutMs);
  });
}
