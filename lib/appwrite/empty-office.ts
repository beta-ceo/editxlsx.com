/**
 * Minimal blank Office Open XML packages that OnlyOffice will open.
 *
 * Built with ranuts `createZip` so /workspace can mint a new file without
 * booting the editor first. One empty sheet / document / slide each.
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

export function buildEmptyPptxBytes(): Uint8Array {
  return createZip([
    {
      name: '[Content_Types].xml',
      data:
        XML_HEAD +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
        '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' +
        '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
        '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      data:
        XML_HEAD +
        `<Relationships xmlns="${PKG_REL}">` +
        `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/>` +
        '</Relationships>',
    },
    {
      name: 'ppt/presentation.xml',
      data:
        XML_HEAD +
        '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>' +
        '</p:presentation>',
    },
    {
      name: 'ppt/_rels/presentation.xml.rels',
      data:
        XML_HEAD +
        `<Relationships xmlns="${PKG_REL}">` +
        `<Relationship Id="rId1" Type="${REL}/slide" Target="slides/slide1.xml"/>` +
        `<Relationship Id="rId2" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/>` +
        '</Relationships>',
    },
    {
      name: 'ppt/slides/slide1.xml',
      data:
        XML_HEAD +
        '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<p:cSld><p:spTree>' +
        '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
        '<p:grpSpPr/>' +
        '</p:spTree></p:cSld>' +
        '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>' +
        '</p:sld>',
    },
    {
      name: 'ppt/slides/_rels/slide1.xml.rels',
      data:
        XML_HEAD +
        `<Relationships xmlns="${PKG_REL}">` +
        `<Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
        '</Relationships>',
    },
    {
      name: 'ppt/slideLayouts/slideLayout1.xml',
      data:
        XML_HEAD +
        '<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" type="blank">' +
        '<p:cSld><p:spTree>' +
        '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
        '<p:grpSpPr/>' +
        '</p:spTree></p:cSld>' +
        '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>' +
        '</p:sldLayout>',
    },
    {
      name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      data:
        XML_HEAD +
        `<Relationships xmlns="${PKG_REL}">` +
        `<Relationship Id="rId1" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>` +
        '</Relationships>',
    },
    {
      name: 'ppt/slideMasters/slideMaster1.xml',
      data:
        XML_HEAD +
        '<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
        '<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:bgPr></p:bg>' +
        '<p:spTree>' +
        '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
        '<p:grpSpPr/>' +
        '</p:spTree></p:cSld>' +
        '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
        '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></p:sldLayoutIdLst>' +
        '</p:sldMaster>',
    },
    {
      name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      data:
        XML_HEAD +
        `<Relationships xmlns="${PKG_REL}">` +
        `<Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
        '</Relationships>',
    },
  ]);
}

export function buildEmptyPptxFile(title = 'Untitled.pptx'): File {
  const name = ensureExt(title, PPTX_EXT, 'Untitled.pptx');
  return toFile(buildEmptyPptxBytes(), name, PPTX_MIME);
}

export function buildEmptyOfficeFile(format: VaultFormat, title?: string): File {
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
