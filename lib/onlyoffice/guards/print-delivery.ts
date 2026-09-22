/**
 * Guard 18: deliver Print-panel PDF to the user, and present Print as a
 * full-page overlay with an explicit Close control.
 *
 * The offline vendor build renders a real PDF blob for Print
 * (`_localPrintUrl` via `ToRendererPart`), then `onPrintUrl` loads it into an
 * iframe with `display: none` and calls `contentWindow.print()`. Modern
 * Chromium silently no-ops print() on a display:none frame, so the blue Print
 * button looks dead. The white Save button only writes page setup into the
 * workbook (`querySavePrintSettings("save")`) and never downloads anything --
 * also looks dead.
 *
 * Fix: when `processSavedFile` receives an `asc_onPrintUrl` blob, download the
 * PDF in that same frame (blob URLs are origin+document scoped) and try print
 * from an off-screen but non-display:none iframe. Clicks on `#print-btn-save*`
 * then trigger the same PDF path after the vendor has saved page options,
 * download-only (no print dialog). A top-right Close (×) button clicks the
 * vendor Back entry so the overlay can leave without the File left rail.
 */
import { getDocmentObj } from '@ranuts/shared/store';

const PRINT_URL_EVENT = 'asc_onPrintUrl';
const CLOSE_ID = 'oo-print-close';

/** When true, the next print-URL delivery downloads only (Save on the print panel). */
let downloadOnly = false;

function suggestedPdfName(): string {
  const name = getDocmentObj()?.fileName || 'document';
  return name.replace(/\.[^/.]+$/, '') + '.pdf';
}

/**
 * Download a blob: URL as a PDF. Optionally open the system print dialog.
 * Must run in the window that created the blob URL.
 */
export function deliverPrintPdf(
  win: Window,
  url: string,
  options: { fileName?: string; print?: boolean } = {},
): void {
  if (typeof url !== 'string' || !url.startsWith('blob:')) return;
  const doc = win.document;
  const fileName = options.fileName ?? suggestedPdfName();
  const wantPrint = options.print !== false;

  try {
    const anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    doc.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } catch (error) {
    console.warn('[OO] print PDF download failed', error);
  }

  if (!wantPrint) return;

  try {
    // display:none iframes make window.print() a silent no-op in Chromium;
    // keep the frame off-screen but laid out so print() can run.
    const frame = doc.createElement('iframe');
    frame.setAttribute('title', 'Print');
    frame.style.cssText =
      'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;border:0;';
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch (error) {
        console.warn('[OO] print dialog failed after PDF download', error);
      } finally {
        win.setTimeout(() => frame.remove(), 60_000);
      }
    };
    doc.body.appendChild(frame);
    frame.src = url;
  } catch (error) {
    console.warn('[OO] print iframe setup failed', error);
  }
}

function triggerPdfPrint(win: Window): void {
  const api = (win as unknown as { Asc?: { editor?: { asc_Print?: (opts: unknown) => void } } }).Asc?.editor;
  const DownloadOptions = (
    win as unknown as {
      Asc?: { asc_CDownloadOptions?: new (fileType: number | null, isDownloadEvent?: boolean) => unknown };
    }
  ).Asc?.asc_CDownloadOptions;
  if (!api || typeof api.asc_Print !== 'function' || !DownloadOptions) return;
  // Mirror the Print panel: second arg marks Chrome/Firefox download-event path.
  const opts = new DownloadOptions(null, true);
  api.asc_Print(opts);
}

function installSaveAsPdfClick(doc: Document, win: Window): void {
  const flagged = doc.documentElement as HTMLElement & { __ooPrintSaveHook?: boolean };
  if (flagged.__ooPrintSaveHook) return;
  flagged.__ooPrintSaveHook = true;

  doc.addEventListener(
    'click',
    (event) => {
      const target = event.target as Element | null;
      const saveBtn = target?.closest?.('[id^="print-btn-save"]');
      if (!saveBtn) return;
      // Vendor bubble handler runs first and persists page options; then we
      // render a PDF and download it (no print dialog).
      downloadOnly = true;
      win.setTimeout(() => triggerPdfPrint(win), 0);
    },
    false,
  );
}

/** Close the print overlay by activating the vendor Back control (or Escape). */
export function closePrintOverlay(doc: Document): void {
  // Prefer the anchor: `#fm-btn-return` alone matches the <li> first in tree order.
  const back =
    (doc.querySelector('#fm-btn-return a') as HTMLElement | null) ||
    (doc.querySelector('#fm-btn-return') as HTMLElement | null);
  if (back) {
    back.click();
    return;
  }
  doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
}

function ensurePrintCloseButton(doc: Document): void {
  const panel = doc.getElementById('file-menu-panel');
  if (!panel) return;
  const print = doc.getElementById('panel-print');
  const printVisible =
    getComputedStyle(panel).display !== 'none' && !!print && getComputedStyle(print).display !== 'none';

  let btn = doc.getElementById(CLOSE_ID) as HTMLButtonElement | null;
  if (!printVisible) {
    btn?.remove();
    return;
  }
  if (btn) return;

  btn = doc.createElement('button');
  btn.id = CLOSE_ID;
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Close');
  btn.title = 'Close';
  btn.textContent = '×';
  btn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    closePrintOverlay(doc);
  });
  panel.appendChild(btn);
}

function installPrintCloseButton(doc: Document, win: Window): void {
  const flagged = doc.documentElement as HTMLElement & { __ooPrintCloseHook?: boolean };
  if (flagged.__ooPrintCloseHook) return;
  flagged.__ooPrintCloseHook = true;

  ensurePrintCloseButton(doc);
  const panel = doc.getElementById('file-menu-panel');
  if (panel && win.MutationObserver) {
    new win.MutationObserver(() => ensurePrintCloseButton(doc)).observe(panel, {
      attributes: true,
      attributeFilter: ['style', 'class'],
      childList: true,
      subtree: true,
    });
  }
}

export function installPrintDelivery(win: Window): boolean {
  const printWin = win as unknown as {
    Asc?: {
      editor?: {
        processSavedFile?: (url: string, downloadType: string, extra?: unknown) => unknown;
      };
    };
    __ooPrintDeliveryPatched?: boolean;
    document?: Document;
  };

  const api = printWin.Asc?.editor;
  const doc = printWin.document;
  if (!api || typeof api.processSavedFile !== 'function' || !doc) {
    return Boolean(printWin.__ooPrintDeliveryPatched);
  }

  if (!printWin.__ooPrintDeliveryPatched) {
    const orig = api.processSavedFile.bind(api);
    api.processSavedFile = function (url: string, downloadType: string, extra?: unknown) {
      const result = orig(url, downloadType, extra);
      if (downloadType === PRINT_URL_EVENT) {
        const onlyDownload = downloadOnly;
        downloadOnly = false;
        deliverPrintPdf(win, url, { print: !onlyDownload });
      }
      return result;
    };
    printWin.__ooPrintDeliveryPatched = true;
    console.log('[OO] print delivery installed (Print URL blob → download + print dialog)');
  }

  installSaveAsPdfClick(doc, win);
  installPrintCloseButton(doc, win);
  return true;
}
