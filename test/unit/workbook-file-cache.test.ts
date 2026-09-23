import { afterEach, describe, expect, it } from 'vitest';
import {
  forgetCachedWorkbookFile,
  getCachedWorkbookFile,
  putCachedWorkbookFile,
  resetWorkbookFileCacheForTests,
  workbookFileCacheStatsForTests,
} from '../../lib/workbook-file-cache';

describe('workbook file cache', () => {
  afterEach(() => {
    resetWorkbookFileCacheForTests();
  });

  it('returns a File clone for a cached fileId', async () => {
    const original = new File([new Uint8Array([1, 2, 3, 4])], 'a.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await putCachedWorkbookFile('f1', original, 'xlsx');
    const hit = getCachedWorkbookFile('f1', 'a.xlsx', 'xlsx');
    expect(hit).toBeTruthy();
    expect(hit!.name).toBe('a.xlsx');
    expect(await hit!.arrayBuffer()).toEqual(await original.arrayBuffer());
    // Mutating the returned file must not poison the cache.
    expect(getCachedWorkbookFile('f1', 'a.xlsx', 'xlsx')).toBeTruthy();
  });

  it('forgets a rotated fileId', async () => {
    await putCachedWorkbookFile('old', new File([new Uint8Array([9])], 'a.xlsx'), 'xlsx');
    forgetCachedWorkbookFile('old');
    expect(getCachedWorkbookFile('old', 'a.xlsx', 'xlsx')).toBeNull();
  });

  it('evicts oldest entries when the entry cap is hit', async () => {
    for (let i = 0; i < 10; i += 1) {
      await putCachedWorkbookFile(`f${i}`, new File([new Uint8Array([i])], `f${i}.xlsx`), 'xlsx');
    }
    const stats = workbookFileCacheStatsForTests();
    expect(stats.entries).toBeLessThanOrEqual(8);
    expect(getCachedWorkbookFile('f0', 'f0.xlsx', 'xlsx')).toBeNull();
    expect(getCachedWorkbookFile('f9', 'f9.xlsx', 'xlsx')).toBeTruthy();
  });
});
