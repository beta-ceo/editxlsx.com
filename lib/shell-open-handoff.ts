/**
 * /workspace open handoff: start Storage download as soon as a workbook is
 * selected (using the sidebar row), refresh Documents meta in parallel, then
 * deliver bytes to the editor iframe when it posts `shell:need-payload`.
 * Overlaps Appwrite RTT with iframe module evaluation.
 */
import { downloadWorkbookFile, getWorkbook, type Workbook } from './appwrite/workbooks';
import { takeCloudPendingIfNewer } from './cloud-pending';
import {
  postShellOpenPayload,
  postShellOpenPayloadFailed,
  type ShellOpenWorkbookMeta,
} from './shell-bridge';

export type ShellHandoffResult = {
  workbook: Workbook;
  file: File;
  source: 'pending' | 'download';
};

type HandoffState = {
  generation: number;
  workbookId: string;
  workbook: Workbook;
  promise: Promise<ShellHandoffResult>;
  /** iframe asked for bytes; deliver as soon as promise settles. */
  frameWaiting: boolean;
  onMeta?: (workbook: Workbook) => void;
};

let generation = 0;
let current: HandoffState | null = null;

function toMeta(workbook: Workbook): ShellOpenWorkbookMeta {
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
  };
}

async function resolveHandoff(
  listRow: Workbook,
  onMeta?: (workbook: Workbook) => void,
): Promise<ShellHandoffResult> {
  // Kick Storage immediately from the sidebar row so download overlaps both
  // getWorkbook and iframe boot. If Save rotated fileId since the list was
  // painted, we discard this response and fetch the fresh id below.
  const listFilePromise = downloadWorkbookFile(listRow.fileId, listRow.title, {
    cacheBust: listRow.updatedAt,
    format: listRow.format,
  });

  let workbook = listRow;
  try {
    workbook = await getWorkbook(listRow.id);
    onMeta?.(workbook);
  } catch {
    /* Sidebar row is best-effort when Documents is unreachable. */
  }

  const pending = await takeCloudPendingIfNewer(workbook.id, workbook.updatedAt);
  if (pending) return { workbook, file: pending, source: 'pending' };

  if (workbook.fileId === listRow.fileId) {
    return { workbook, file: await listFilePromise, source: 'download' };
  }

  const file = await downloadWorkbookFile(workbook.fileId, workbook.title, {
    cacheBust: workbook.updatedAt,
    format: workbook.format,
  });
  return { workbook, file, source: 'download' };
}

/** Start (or replace) the in-flight open for this workbook. */
export function beginShellOpenHandoff(
  workbook: Workbook,
  options: { onMeta?: (workbook: Workbook) => void } = {},
): void {
  const nextGen = ++generation;
  const promise = resolveHandoff(workbook, options.onMeta);
  current = {
    generation: nextGen,
    workbookId: workbook.id,
    workbook,
    promise,
    frameWaiting: false,
    onMeta: options.onMeta,
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

/**
 * iframe posted `shell:need-payload`. Mark waiting and push bytes when ready.
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
    const buffer = await result.file.arrayBuffer();
    if (current?.generation !== handoff.generation) return;
    postShellOpenPayload(target, {
      workbookId: result.workbook.id,
      workbook: toMeta(result.workbook),
      buffer,
      source: result.source,
    });
  } catch (error) {
    if (current?.generation !== handoff.generation) return;
    const message = error instanceof Error ? error.message : String(error);
    postShellOpenPayloadFailed(target, workbookId, message);
  }
}
