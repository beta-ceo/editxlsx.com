import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearCloudPending,
  getCloudPending,
  putCloudPending,
  resetCloudPendingDbForTests,
  takeCloudPendingIfNewer,
} from '../../lib/cloud-pending';

const DB_NAME = 'editxlsx-cloud-pending';

describe('cloud-pending store', () => {
  beforeEach(async () => {
    resetCloudPendingDbForTests();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => resolve();
    });
    resetCloudPendingDbForTests();
  });

  afterEach(async () => {
    resetCloudPendingDbForTests();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });

  it('round-trips bytes and prefers pending when newer than the cloud row', async () => {
    const file = new File([new Uint8Array([9, 8, 7])], 'Sheet.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const ok = await putCloudPending('w1', file, { userId: 'u', fileId: 'f1', title: 'Sheet.xlsx' });
    expect(ok).toBe(true);

    const pending = await getCloudPending('w1');
    expect(pending?.bytes).toEqual(new Uint8Array([9, 8, 7]));
    expect(pending?.title).toBe('Sheet.xlsx');

    const olderCloud = new Date(pending!.savedAt - 60_000).toISOString();
    const newer = await takeCloudPendingIfNewer('w1', olderCloud);
    expect(newer).toBeInstanceOf(File);
    expect(await newer!.arrayBuffer()).toEqual((await file.arrayBuffer()).slice(0));

    await putCloudPending('w1', file, { userId: 'u', fileId: 'f1', title: 'Sheet.xlsx' });
    const again = await getCloudPending('w1');
    const newerCloud = new Date(again!.savedAt + 60_000).toISOString();
    const stale = await takeCloudPendingIfNewer('w1', newerCloud);
    expect(stale).toBeNull();
    expect(await getCloudPending('w1')).toBeNull();
  });
});
