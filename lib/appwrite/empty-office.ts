/**
 * Minimal blank Office Open XML packages that OnlyOffice will open.
 *
 * Built with ranuts `createZip` so /workspace can mint a new file without
 * booting the editor first. One empty sheet / document each.
 *
 * Presentations cannot use a hand-rolled minimal zip: OnlyOffice's slide
 * loader needs a real master/theme graph (missing → `reading 'Master'` /
 * open code -82). Blank pptx is the vendor `01_blank.pptx` template.
 */
import { createZip } from 'ranuts/utils';
import {
  DOCX_EXT,
  DOCX_MIME,
  PPTX_EXT,
  PPTX_MIME,
  XLSX_EXT,
  XLSX_MIME,
  type VaultFormat,
  mimeForFormat,
} from './ids';

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** Same blank deck the editor used when `?new=pptx` needed a real package. */
export const BLANK_PPTX_URL = '/sdkjs/slide/themes/src/01_blank.pptx';

function toFile(bytes: Uint8Array, name: string, mime: string): File {
  // Copy into a fresh ArrayBuffer so File's BlobPart typing accepts it under
  // TypeScript's stricter ArrayBufferLike checks.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], name, { type: mime });
}

function ensureExt(title: string, ext: VaultFormat, fallback: string): string {
  const trimmed = title.trim() || fallback;
  return trimmed.toLowerCase().endsWith(`.${ext}`) ? trimmed : `${trimmed}.${ext}`;
}

export function buildEmptyXlsxBytes(): Uint8Array {
  return createZip([
    {
      name: '[Content_Types].xml',
      data:
        XML_HEAD +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      data:
        XML_HEAD +
        `<Relationships xmlns="${PKG_REL}">` +
        `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/>` +
        '</Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      data:
        XML_HEAD +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data:
        XML_HEAD +
        `<Relationships xmlns="${PKG_REL}">` +
        `<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
        '</Relationships>',
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data:
        XML_HEAD +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<sheetData/>' +
        '</worksheet>',
    },
  ]);
}

export function buildEmptyXlsxFile(title = 'Untitled.xlsx'): File {
  const name = ensureExt(title, XLSX_EXT, 'Untitled.xlsx');
  return toFile(buildEmptyXlsxBytes(), name, XLSX_MIME);
}

export function buildEmptyDocxBytes(): Uint8Array {
  return createZip([
    {
      name: '[Content_Types].xml',
      data:
        XML_HEAD +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      data:
        XML_HEAD +
        `<Relationships xmlns="${PKG_REL}">` +
        `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>` +
        '</Relationships>',
    },
    {
      name: 'word/document.xml',
      data:
        XML_HEAD +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body><w:p><w:r><w:t></w:t></w:r></w:p></w:body></w:document>',
    },
  ]);
}

export function buildEmptyDocxFile(title = 'Untitled.docx'): File {
  const name = ensureExt(title, DOCX_EXT, 'Untitled.docx');
  return toFile(buildEmptyDocxBytes(), name, DOCX_MIME);
}

export async function buildEmptyPptxBytes(): Promise<Uint8Array> {
  const response = await fetch(BLANK_PPTX_URL);
  if (!response.ok) {
    throw new Error(`Could not load blank presentation template (${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function buildEmptyPptxFile(title = 'Untitled.pptx'): Promise<File> {
  const name = ensureExt(title, PPTX_EXT, 'Untitled.pptx');
  return toFile(await buildEmptyPptxBytes(), name, PPTX_MIME);
}

export async function buildEmptyOfficeFile(format: VaultFormat, title?: string): Promise<File> {
  switch (format) {
    case 'docx':
      return buildEmptyDocxFile(title || 'Untitled.docx');
    case 'pptx':
      return buildEmptyPptxFile(title || 'Untitled.pptx');
    default:
      return buildEmptyXlsxFile(title || 'Untitled.xlsx');
  }
}

export { mimeForFormat };
