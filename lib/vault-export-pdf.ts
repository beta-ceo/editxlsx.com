/**
 * Export a cloud vault workbook as PDF on the device.
 *
 * Spreadsheet / presentation PDF needs the editor's canvas render pipeline
 * (`asc_DownloadAs` → x2t with format-from 8196). Standalone x2t on an OOXML
 * zip or editor bin returns code 80 for those packages — same as Download as
 * PDF in the editor UI, which is why vault export opens the workbook in the
 * shell iframe and asks it to export.
 */
import { saveFileToDisk } from '@ranuts/converter';
import type { Workbook } from './appwrite/workbooks';

export function workbookSupportsPdfExport(item: { kind: string; format: string }): item is Workbook {
  return item.kind === 'file' && (item.format === 'xlsx' || item.format === 'docx' || item.format === 'pptx');
}

/** Strip the office extension and append `.pdf`. */
export function pdfFileNameForTitle(title: string): string {
  const trimmed = title.trim() || 'document';
  const base = trimmed.replace(/\.[^.]+$/, '') || 'document';
  return `${base}.pdf`;
}

function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]) === '%PDF-';
}

/**
 * Open (or reuse) the workbook in the shell editor, run Download as PDF, and
 * offer a download / save picker.
 */
export async function exportWorkbookAsPdf(
  workbook: Workbook,
  viaEditor: (workbook: Workbook) => Promise<File>,
): Promise<void> {
  const file = await viaEditor(workbook);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikePdf(bytes)) {
    throw new Error('Export did not produce a PDF');
  }
  const fileName = pdfFileNameForTitle(workbook.title);
  await saveFileToDisk(bytes, fileName, 'application/pdf');
}
