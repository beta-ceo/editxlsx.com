/**
 * In-tab cache of cloud workbook Storage objects, keyed by fileId.
 *
 * Saves mint a new Storage id per revision, so a cached fileId is immutable
 * content. Re-opening the same revision (or switching back) skips the Appwrite
 * download RTT that dominated "Opening workbook…".
 */
import { formatFromTitle, mimeForFormat, type VaultFormat } from './appwrite/ids';
import { ensureFormatName } from './appwrite/workbooks';

const MAX_ENTRIES = 8;
/** Soft cap so a few large decks cannot pin unbounded heap. */
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

type CacheEntry = {
  fileId: string;
  bytes: ArrayBuffer;
  title: string;
  format: VaultFormat;
  byteLength: number;
  at: number;
};

const entries = new Map<string, CacheEntry>();
let totalBytes = 0;

function copyBuffer(source: ArrayBuffer): ArrayBuffer {
  const out = new ArrayBuffer(source.byteLength);
  new Uint8Array(out).set(new Uint8Array(source));
  return out;
}

function evictIfNeeded(incoming: number): void {
  while (
    (entries.size >= MAX_ENTRIES || totalBytes + incoming > MAX_TOTAL_BYTES) &&
    entries.size > 0
  ) {
    let oldestId = '';
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [id, entry] of entries) {
      if (entry.at < oldestAt) {
        oldestAt = entry.at;
        oldestId = id;
      }
    }
    if (!oldestId) break;
    const removed = entries.get(oldestId);
    entries.delete(oldestId);
    if (removed) totalBytes = Math.max(0, totalBytes - removed.byteLength);
  }
}

export function getCachedWorkbookFile(
  fileId: string,
  title: string,
  format?: VaultFormat,
): File | null {
  if (!fileId) return null;
  const hit = entries.get(fileId);
  if (!hit) return null;
  hit.at = Date.now();
  const resolvedFormat = format || hit.format || formatFromTitle(title) || 'xlsx';
  const name = ensureFormatName(title || hit.title, resolvedFormat);
  return new File([copyBuffer(hit.bytes)], name, { type: mimeForFormat(resolvedFormat) });
}

export async function putCachedWorkbookFile(
  fileId: string,
  file: File,
  format?: VaultFormat,
): Promise<void> {
  if (!fileId || file.size <= 0) return;
  const resolvedFormat = format || formatFromTitle(file.name) || 'xlsx';
  const bytes = copyBuffer(await file.arrayBuffer());
  const prev = entries.get(fileId);
  if (prev) totalBytes = Math.max(0, totalBytes - prev.byteLength);
  evictIfNeeded(bytes.byteLength);
  entries.set(fileId, {
    fileId,
    bytes,
    title: file.name,
    format: resolvedFormat,
    byteLength: bytes.byteLength,
    at: Date.now(),
  });
  totalBytes += bytes.byteLength;
}

export function forgetCachedWorkbookFile(fileId: string): void {
  const prev = entries.get(fileId);
  if (!prev) return;
  entries.delete(fileId);
  totalBytes = Math.max(0, totalBytes - prev.byteLength);
}

/** Test seam. */
export function resetWorkbookFileCacheForTests(): void {
  entries.clear();
  totalBytes = 0;
}

/** Test seam. */
export function workbookFileCacheStatsForTests(): { entries: number; totalBytes: number } {
  return { entries: entries.size, totalBytes };
}
