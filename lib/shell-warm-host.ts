/**
 * Warm /workspace editor host: one `/editor?shell=1` iframe stays alive and
 * accepts `shell:open-payload` pushes for each workbook switch instead of
 * remounting the whole editor document.
 */
import { mimeForFormat, type VaultFormat } from './appwrite/ids';
import type { Workbook } from './appwrite/workbooks';
import { loadEditorApi } from './converter';
import { openLocalFile } from './document';
import { OpenTiming, publishOpenTiming } from './open-timing';
import {
  isShellParentMessage,
  postShellExportDone,
  postShellFailed,
  postShellFrameReady,
  postShellReady,
  SHELL_EXPORT,
  SHELL_OPEN_PAYLOAD_FAILED,
  type ShellExportMessage,
  type ShellOpenPayloadMessage,
} from './shell-bridge';

let started = false;
let openGeneration = 0;
/** Workbook id last successfully opened (for export gating). */
let activeWorkbookId = '';
let exportInFlight = false;

function workbookFromPayload(payload: ShellOpenPayloadMessage): Workbook {
  const format = payload.workbook.format as VaultFormat;
  return {
    ...payload.workbook,
    kind: 'file',
    format,
  };
}

async function openFromPayload(payload: ShellOpenPayloadMessage): Promise<void> {
  const generation = ++openGeneration;
  const timing = new OpenTiming(payload.workbookId);
  timing.mark('imports');
  timing.mark('payload');
  timing.mark('synced');

  try {
    const { bindCloudWorkbook, beginCloudAutosave, unbindCloudWorkbook } = await import('./cloud-workbook');
    if (generation !== openGeneration) return;

    // Drop the previous cloud binding / metronome before the next DocEditor
    // takes over — otherwise Save could land on the wrong workbook id.
    unbindCloudWorkbook();
    activeWorkbookId = '';

    const workbook = workbookFromPayload(payload);
    const file = new File([payload.buffer], workbook.title, {
      type: mimeForFormat(workbook.format),
    });
    bindCloudWorkbook(workbook);
    await loadEditorApi();
    if (generation !== openGeneration) return;
    timing.mark('api');
    await openLocalFile(file, { skipHistory: true });
    if (generation !== openGeneration) return;
    timing.mark('mounted');
    beginCloudAutosave();
    timing.mark('ready');
    activeWorkbookId = workbook.id;
    const report = timing.buildReport();
    publishOpenTiming(report);
    postShellReady(workbook.id, report);
  } catch (error) {
    if (generation !== openGeneration) return;
    console.error('Failed to open shell workbook payload:', error);
    const detail = error instanceof Error ? error.message : String(error);
    const { t } = await import('@ranuts/shared/i18n');
    (window as unknown as { message?: { error?: (msg: string) => void } }).message?.error?.(
      `${t('cloudOpenFailed')}${detail}`,
    );
    postShellFailed(payload.workbookId, detail);
  }
}

async function handleExport(message: ShellExportMessage): Promise<void> {
  if (exportInFlight) {
    postShellExportDone({
      workbookId: message.workbookId,
      requestId: message.requestId,
      ok: false,
      message: 'An export is already in progress',
    });
    return;
  }
  if (!activeWorkbookId || activeWorkbookId !== message.workbookId) {
    postShellExportDone({
      workbookId: message.workbookId,
      requestId: message.requestId,
      ok: false,
      message: 'Workbook is not open in the editor',
    });
    return;
  }

  exportInFlight = true;
  try {
    const { requestSaveDocument } = await import('./onlyoffice/save-stream');
    const file = await requestSaveDocument(message.targetExt);
    const buffer = await file.arrayBuffer();
    postShellExportDone({
      workbookId: message.workbookId,
      requestId: message.requestId,
      ok: true,
      fileName: file.name,
      buffer,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    postShellExportDone({
      workbookId: message.workbookId,
      requestId: message.requestId,
      ok: false,
      message: detail,
    });
  } finally {
    exportInFlight = false;
  }
}

/**
 * Boot the framed editor as a long-lived host. DocsAPI is prefetched so the
 * first open skips the loader fetch; later opens only rebuild DocEditor.
 */
export async function startShellWarmHost(): Promise<void> {
  if (started) return;
  started = true;

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;
    if (event.source !== window.parent) return;
    if (!isShellParentMessage(event.data)) return;
    if (event.data.type === SHELL_OPEN_PAYLOAD_FAILED) {
      postShellFailed(event.data.workbookId, event.data.message);
      return;
    }
    if (event.data.type === SHELL_EXPORT) {
      void handleExport(event.data);
      return;
    }
    void openFromPayload(event.data);
  });

  document.body.classList.add('opening-document');
  // Announce immediately so the shell can push bytes while DocsAPI still loads.
  postShellFrameReady();
  void loadEditorApi().catch((error) => {
    console.warn('[shell-warm] DocsAPI prefetch failed:', error);
  });
}

/** Test seam. */
export function resetShellWarmHostForTests(): void {
  started = false;
  openGeneration = 0;
  activeWorkbookId = '';
  exportInFlight = false;
}
