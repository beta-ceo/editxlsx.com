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
export const XLSX_EXT = 'xlsx';
/** Bucket maximumFileSize is 50_000_000; keep the client check in step. */
export const MAX_WORKBOOK_BYTES = 50_000_000;
