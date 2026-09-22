/**
 * Appwrite resource IDs for the editxlsx project.
 *
 * Hard-coded on purpose: these are the same IDs the Appwrite console already
 * created (database / collection / bucket), and they are not secrets. Endpoint
 * and project still come from env so forks can point elsewhere.
 */

export const DATABASE_ID = 'editxlsx';
export const COLLECTION_WORKBOOKS = 'workbooks';
export const BUCKET_WORKBOOKS = 'workbooks';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export const XLSX_EXT = 'xlsx';
export const DOCX_EXT = 'docx';
export const PPTX_EXT = 'pptx';

/** Cloud-backed Office formats (folders use Appwrite enum value `none`). */
export type VaultFormat = 'xlsx' | 'docx' | 'pptx';
export type VaultKind = 'file' | 'folder';

export const VAULT_FORMATS: readonly VaultFormat[] = [XLSX_EXT, DOCX_EXT, PPTX_EXT] as const;

export const FORMAT_MIME: Record<VaultFormat, string> = {
  xlsx: XLSX_MIME,
  docx: DOCX_MIME,
  pptx: PPTX_MIME,
};

/** Bucket maximumFileSize is 50_000_000; keep the client check in step. */
export const MAX_WORKBOOK_BYTES = 50_000_000;

export function isVaultFormat(value: string): value is VaultFormat {
  return (VAULT_FORMATS as readonly string[]).includes(value);
}

export function mimeForFormat(format: VaultFormat): string {
  return FORMAT_MIME[format];
}

export function formatFromTitle(title: string): VaultFormat | null {
  const lower = title.trim().toLowerCase();
  for (const ext of VAULT_FORMATS) {
    if (lower.endsWith(`.${ext}`)) return ext;
  }
  return null;
}
