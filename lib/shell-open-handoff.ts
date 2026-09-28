/**
 * /workspace open handoff: start Storage download (cloud) or IndexedDB read
 * (local vault) as soon as a workbook is selected, then push bytes into the
 * warm editor iframe once it has posted `shell:frame-ready`.
 */
import { downloadWorkbookFile, getWorkbook, type Workbook } from './appwrite/workbooks';
import { takeCloudPendingIfNewer } from './cloud-pending';
import { downloadLocalVaultFile, touchLocalVaultOpened } from './local-vault';
import {
  postShellOpenPayload,
  postShellOpenPayloadFailed,
  type ShellOpenWorkbookMeta,
} from './shell-bridge';
import { getCachedWorkbookFile, putCachedWorkbookFile } from './workbook-file-cache';

export type VaultSource = 'local' | 'cloud';

export type ShellHandoffResult = {
  workbook: Workbook;
  file: File;
  source: 'pending' | 'download' | 'cache';
  vaultSource: VaultSource;
};

export type ShellOpenPhase = 'download' | 'editor';

type HandoffState = {
  generation: number;
  workbookId: string;
  workbook: Workbook;
  promise: Promise<ShellHandoffResult>;
  /** iframe asked for bytes / frame-ready; deliver as soon as promise settles. */
  frameWaiting: boolean;
  vaultSource: VaultSource;
  quotaBytes: number;
  onMeta?: (workbook: Workbook) => void;
  onPhase?: (phase: ShellOpenPhase) => void;
};

let generation = 0;
let current: HandoffState | null = null;
/** Warm host has announced it can accept open-payload pushes. */
let frameReady = false;

function toMeta(workbook: Workbook, vaultSource: VaultSource, quotaBytes = 0): ShellOpenWorkbookMeta {
  return {
    id: workbook.id,
    userId: workbook.userId,
    title: workbook.title,
    fileId: workbook.fileId,
    format: workbook.format,
    sizeBytes: workbook.sizeBytes,
    updatedAt: workbook.updatedAt,
    createdAt: workbook.createdAt,
    parentId: workbook.parentId,
    sortOrder: workbook.sortOrder,
    vaultSource,
    quotaBytes,
  };
}

async function resolveLocalHandoff(
  listRow: Workbook,
  onMeta?: (workbook: Workbook) => void,
  onPhase?: (phase: ShellOpenPhase) => void,
): Promise<ShellHandoffResult> {
  onPhase?.('download');
  const file = await downloadLocalVaultFile(listRow.id, listRow.title);
  if (!file) throw new Error('Local workbook bytes missing');
  void touchLocalVaultOpened(listRow.id);
  onMeta?.(listRow);
  onPhase?.('editor');
  return { workbook: listRow, file, source: 'download', vaultSource: 'local' };
}

async function resolveHandoff(
  listRow: Workbook,
  onMeta?: (workbook: Workbook) => void,
  onPhase?: (phase: ShellOpenPhase) => void,
): Promise<ShellHandoffResult> {
  onPhase?.('download');

  // Local pending first — IndexedDB is cheap and must win over any cache.
  const pending = await takeCloudPendingIfNewer(listRow.id, listRow.updatedAt);
  if (pending) {
    onPhase?.('editor');
    void putCachedWorkbookFile(listRow.fileId, pending, listRow.format);
    void getWorkbook(listRow.id)
      .then((fresh) => onMeta?.(fresh))
      .catch(() => {
        /* list row is enough to open */
      });
    return { workbook: listRow, file: pending, source: 'pending', vaultSource: 'cloud' };
  }

  // Same Storage revision already in this tab: skip both download and Documents.
  const cached = getCachedWorkbookFile(listRow.fileId, listRow.title, listRow.format);
  if (cached) {
    onPhase?.('editor');
    void getWorkbook(listRow.id)
      .then((fresh) => onMeta?.(fresh))
      .catch(() => {
        /* ignore */
      });
    return { workbook: listRow, file: cached, source: 'cache', vaultSource: 'cloud' };
  }

  // Kick Storage immediately so it overlaps getWorkbook.
  const listFilePromise = downloadWorkbookFile(listRow.fileId, listRow.title, {
    cacheBust: listRow.updatedAt,
    format: listRow.format,
  }).then(async (file) => {
    void putCachedWorkbookFile(listRow.fileId, file, listRow.format);
    return file;
  });

  let workbook = listRow;
  try {
    workbook = await getWorkbook(listRow.id);
    onMeta?.(workbook);
  } catch {
    /* Sidebar row is best-effort when Documents is unreachable. */
  }

  // Re-check pending against fresh updatedAt (list row may have been stale).
  const pendingFresh = await takeCloudPendingIfNewer(workbook.id, workbook.updatedAt);
  if (pendingFresh) {
    void putCachedWorkbookFile(workbook.fileId, pendingFresh, workbook.format);
    return { workbook, file: pendingFresh, source: 'pending', vaultSource: 'cloud' };
  }

  if (workbook.fileId === listRow.fileId) {
    const file = await listFilePromise;
    return { workbook, file, source: 'download', vaultSource: 'cloud' };
  }

  const cachedFresh = getCachedWorkbookFile(workbook.fileId, workbook.title, workbook.format);
  if (cachedFresh) return { workbook, file: cachedFresh, source: 'cache', vaultSource: 'cloud' };

  const file = await downloadWorkbookFile(workbook.fileId, workbook.title, {
    cacheBust: workbook.updatedAt,
    format: workbook.format,
  });
  void putCachedWorkbookFile(workbook.fileId, file, workbook.format);
  return { workbook, file, source: 'download', vaultSource: 'cloud' };
}

/** Start (or replace) the in-flight open for this workbook. */
export function beginShellOpenHandoff(
  workbook: Workbook,
  options: {
    vaultSource?: VaultSource;
    quotaBytes?: number;
    onMeta?: (workbook: Workbook) => void;
    onPhase?: (phase: ShellOpenPhase) => void;
  } = {},
): void {
  const vaultSource = options.vaultSource ?? 'cloud';
  const quotaBytes = options.quotaBytes ?? 0;
  const nextGen = ++generation;
  const promise =
    vaultSource === 'local'
      ? resolveLocalHandoff(workbook, options.onMeta, options.onPhase)
      : resolveHandoff(workbook, options.onMeta, options.onPhase);
  current = {
    generation: nextGen,
    workbookId: workbook.id,
    workbook,
    promise,
    // Warm host already listening: deliver as soon as bytes land.
    frameWaiting: frameReady,
    vaultSource,
    quotaBytes,
    onMeta: options.onMeta,
    onPhase: options.onPhase,
  };
  void promise.then(
    () => {
      if (current?.generation === nextGen && current.frameWaiting) {
        void deliverShellOpenPayload(workbook.id);
      }
    },
    () => {
      if (current?.generation === nextGen && current.frameWaiting) {
        void deliverShellOpenPayload(workbook.id);
      }
    },
  );
}

export function clearShellOpenHandoff(): void {
  generation += 1;
  current = null;
}

/** Call when the warm iframe is about to remount (src reassigned). */
export function resetShellFrameReady(): void {
  frameReady = false;
}

export function isShellFrameReady(): boolean {
  return frameReady;
}

/**
 * Warm host posted `shell:frame-ready`. Mark ready and push the in-flight
 * handoff if one is already waiting.
 */
export function onShellFrameReady(frame?: HTMLIFrameElement): void {
  frameReady = true;
  if (!current) return;
  current.frameWaiting = true;
  void deliverShellOpenPayload(current.workbookId, frame);
}

/**
 * iframe posted `shell:need-payload` (legacy). Mark waiting and push bytes.
 */
export function onShellNeedPayload(workbookId: string, frame: HTMLIFrameElement): void {
  if (!current || current.workbookId !== workbookId) return;
  current.frameWaiting = true;
  void deliverShellOpenPayload(workbookId, frame);
}

async function deliverShellOpenPayload(workbookId: string, frameHint?: HTMLIFrameElement): Promise<void> {
  const handoff = current;
  if (!handoff || handoff.workbookId !== workbookId) return;
  const frame =
    frameHint || (document.getElementById('workspace-editor-frame') as HTMLIFrameElement | null);
  const target = frame?.contentWindow;
  if (!target) return;

  try {
    const result = await handoff.promise;
    if (current?.generation !== handoff.generation) return;
    handoff.onPhase?.('editor');
    const buffer = await result.file.arrayBuffer();
    if (current?.generation !== handoff.generation) return;
    postShellOpenPayload(target, {
      workbookId: result.workbook.id,
      workbook: toMeta(result.workbook, result.vaultSource, handoff.quotaBytes),
      buffer,
      source: result.source,
    });
  } catch (error) {
    if (current?.generation !== handoff.generation) return;
    const message = error instanceof Error ? error.message : String(error);
    postShellOpenPayloadFailed(target, workbookId, message);
  }
}
