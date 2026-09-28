import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLocalBlankFile,
  createLocalFolder,
  createLocalVaultFile,
  deleteLocalVaultItem,
  downloadLocalVaultFile,
  getLocalWorkbook,
  listLocalVaultItems,
  LOCAL_VAULT_DB_NAME,
  renameLocalVaultItem,
  resetLocalVaultDbForTests,
  saveLocalVaultBytes,
  totalLocalFileBytes,
} from '../../lib/local-vault';

describe('local-vault store', () => {
  beforeEach(async () => {
    resetLocalVaultDbForTests();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(LOCAL_VAULT_DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => resolve();
    });
    resetLocalVaultDbForTests();
  });

  afterEach(async () => {
    resetLocalVaultDbForTests();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(LOCAL_VAULT_DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });

  it('creates, lists, saves, renames, and deletes durable local files', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'Sheet.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const created = await createLocalVaultFile(file);
    expect(created.format).toBe('xlsx');
    expect(created.sizeBytes).toBe(3);

    const listed = await listLocalVaultItems();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);

    const downloaded = await downloadLocalVaultFile(created.id);
    expect(downloaded).toBeInstanceOf(File);
    expect(new Uint8Array(await downloaded!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));

    const next = new File([new Uint8Array([9, 9])], 'Sheet.xlsx', {
      type: file.type,
    });
    const saved = await saveLocalVaultBytes(created.id, next);
    expect(saved.sizeBytes).toBe(2);

    const renamed = await renameLocalVaultItem(created.id, 'Budget');
    expect(renamed.title).toBe('Budget.xlsx');

    await deleteLocalVaultItem(created.id);
    expect(await listLocalVaultItems()).toHaveLength(0);
    expect(await getLocalWorkbook(created.id)).toBeNull();
  });

  it('supports folders and blank files and totals file bytes only', async () => {
    const folder = await createLocalFolder('Reports');
    const blank = await createLocalBlankFile('xlsx', {
      title: 'Blank',
      parentId: folder.id,
      bytes: new Uint8Array([4, 5, 6, 7]),
    });
    expect(blank.parentId).toBe(folder.id);
    const items = await listLocalVaultItems();
    expect(totalLocalFileBytes(items)).toBe(4);
  });
});
