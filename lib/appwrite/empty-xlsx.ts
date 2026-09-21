/**
 * A minimal blank .xlsx that OnlyOffice will open.
 *
 * Built with ranuts `createZip` (ecosystem first) so /files can mint a new
 * workbook without booting the editor first. One empty sheet named Sheet1.
 */
import { createZip } from 'ranuts/utils';
import { XLSX_MIME } from './ids';

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

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
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
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
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
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
  const name = title.toLowerCase().endsWith('.xlsx') ? title : `${title}.xlsx`;
  const bytes = buildEmptyXlsxBytes();
  // Copy into a fresh ArrayBuffer so File's BlobPart typing accepts it under
  // TypeScript's stricter ArrayBufferLike checks.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], name, { type: XLSX_MIME });
}
