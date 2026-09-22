/**
 * Cloud SaaS surfaces: /login and /workspace.
 *
 * These pages talk to Appwrite when a session exists. Default CI has no
 * credentials, so the suite mocks Appwrite for the signed-in /workspace shell and
 * only hits the live project for the anonymous redirect. Full round-trips to
 * a real account stay manual / env-gated.
 */
import { expect, test } from './lib/l0';
import { buildEmptyXlsxBytes } from '../../lib/appwrite/empty-xlsx';

const USER = {
  $id: 'user1',
  $createdAt: '2026-09-01T00:00:00.000+00:00',
  $updatedAt: '2026-09-21T12:00:00.000+00:00',
  name: 'Sarah Jenkins',
  registration: '2026-09-01T00:00:00.000+00:00',
  status: true,
  labels: [] as string[],
  passwordUpdate: '2026-09-01T00:00:00.000+00:00',
  email: 'sarah@example.com',
  phone: '',
  emailVerification: true,
  phoneVerification: false,
  prefs: {},
  accessedAt: '2026-09-21T12:00:00.000+00:00',
};

const WORKBOOK = {
  $id: 'wb1',
  $createdAt: '2026-09-20T00:00:00.000+00:00',
  $updatedAt: '2026-09-21T12:00:00.000+00:00',
  $permissions: [] as string[],
  $databaseId: 'editxlsx',
  $collectionId: 'workbooks',
  userId: 'user1',
  title: 'sample_data_3000x20.xlsx',
  fileId: 'wb1',
  sizeBytes: 482344,
  kind: 'file',
  format: 'xlsx',
  parentId: '',
};

const FOLDER = {
  $id: 'folder1',
  $createdAt: '2026-09-20T00:00:00.000+00:00',
  $updatedAt: '2026-09-21T11:00:00.000+00:00',
  $permissions: [] as string[],
  $databaseId: 'editxlsx',
  $collectionId: 'workbooks',
  userId: 'user1',
  title: 'Projects',
  fileId: '',
  sizeBytes: 0,
  kind: 'folder',
  format: 'none',
  parentId: '',
};

async function mockAppwrite(
  page: import('@playwright/test').Page,
  options: { download?: 'xlsx' | 'fail'; documents?: unknown[] } = {},
): Promise<void> {
  const download = options.download ?? 'xlsx';
  const documents = options.documents ?? [WORKBOOK];
  const xlsx = Buffer.from(buildEmptyXlsxBytes());
  let created: unknown[] = [];

  await page.route(/cloud\.appwrite\.io/, async (route) => {
    const request = route.request();
    const origin = new URL(page.url() || 'http://127.0.0.1').origin;
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const url = request.url();
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    if (url.includes('/account') && !url.includes('/sessions')) {
      await json(USER);
      return;
    }
    if (request.method() === 'POST' && url.includes('/documents') && !url.includes('/documents/')) {
      const body = request.postDataJSON() as { documentId?: string; data?: Record<string, unknown> };
      const doc = {
        $id: body.documentId || `created-${created.length + 1}`,
        $createdAt: '2026-09-22T00:00:00.000+00:00',
        $updatedAt: '2026-09-22T00:00:00.000+00:00',
        $permissions: [] as string[],
        $databaseId: 'editxlsx',
        $collectionId: 'workbooks',
        ...(body.data || {}),
      };
      created = [doc, ...created];
      await json(doc);
      return;
    }
    if (request.method() === 'POST' && url.includes('/storage/') && url.includes('/files')) {
      await json({ $id: 'uploaded-file' });
      return;
    }
    if (url.includes('/documents/') && !url.includes('queries')) {
      const id = url.split('/documents/')[1]?.split('?')[0];
      const all = [...created, ...documents] as Array<{ $id: string }>;
      const hit = all.find((doc) => doc.$id === id) || WORKBOOK;
      await json(hit);
      return;
    }
    if (url.includes('/documents')) {
      await json({ total: documents.length + created.length, documents: [...created, ...documents] });
      return;
    }
    if (url.includes('/storage/') && url.includes('/download')) {
      if (download === 'fail') {
        await json({ message: 'missing' }, 404);
        return;
      }
      await route.fulfill({
        status: 200,
        headers: {
          ...cors,
          'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        body: xlsx,
      });
      return;
    }
    await json({ message: 'mocked' }, 404);
  });
}

test.describe('cloud auth pages', () => {
  // The workbook-open case boots a full OnlyOffice frame. Running it beside
  // the lightweight login/homepage checks on a 4-core runner left #auth-root
  // empty (module never painted) while the editor still came up.
  test.describe.configure({ mode: 'serial' });

  test('login page renders the email/password form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('.auth-title')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('r-input[name="email"]')).toBeVisible();
    await expect(page.locator('r-input[name="password"]')).toBeVisible();
    await expect(page.locator('.auth-submit')).toBeVisible();
  });

  test('anonymous /workspace redirects to /login', async ({ page }) => {
    await page.goto('/workspace');
    await page.waitForURL(/\/login/);
    expect(page.url()).toMatch(/\/login/);
  });

  test('homepage primary CTA points at sign-in', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#hero-sign-in')).toBeVisible();
    await expect(page.locator('#hero-workspace')).toBeVisible();
  });

  test('signed-in /workspace is a sidebar + editor shell', async ({ page, l0 }) => {
    // The framed editor will complain when the download fails; that is the
    // branch under test. Asc errors and console noise from the failed open
    // are expected and must not fail the case.
    l0.allowAscError(() => true);
    l0.allowConsole(/Failed to open cloud workbook|Could not open|cloudOpenFailed|Failed to download/i);
    l0.allowFrameError(/Failed to download|Could not open/i);

    await page.goto('/login');
    await mockAppwrite(page, { download: 'fail' });
    await page.goto('/workspace');

    await expect(page.locator('.vault')).toBeVisible();
    await expect(page.locator('.vault-side')).toBeVisible();
    await expect(page.locator('#workspace-new')).toBeVisible();
    await expect(page.locator('#workspace-home')).toBeVisible();
    await expect(page.locator('.vault-tree-title').first()).toHaveText('sample_data_3000x20.xlsx');
    await expect(page.locator('#workspace-editor-frame')).toHaveAttribute('src', /\/editor\?workbook=wb1.*shell=1/);
    await expect(page.locator('#workspace-stage-overlay')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#workspace-stage-overlay')).toHaveAttribute('data-state', 'error');
    await expect(page.locator('#workspace-stage-overlay-title')).not.toHaveText('');
  });

  test('New menu lists workbook, document, presentation, and folder', async ({ page, l0 }) => {
    l0.allowAscError(() => true);
    l0.allowConsole(/Failed to open cloud workbook|Could not open|cloudOpenFailed|Failed to download/i);
    l0.allowFrameError(/Failed to download|Could not open/i);

    await page.goto('/login');
    await mockAppwrite(page, { download: 'fail' });
    await page.goto('/workspace');

    await expect(page.locator('#workspace-new')).toBeVisible();
    await page.locator('#workspace-new').click();
    const options = page.locator('.vault-new-option');
    await expect(options).toHaveCount(4);
    await expect(options.nth(0)).toContainText(/workbook|工作簿|Arbeitsmappe|libro|folha|ワークブック|통합/i);
    await expect(options.nth(1)).toContainText(/document|文档|Dokument|documento|ドキュメント|문서/i);
    await expect(options.nth(2)).toContainText(/presentation|演示|Präsentation|presentación|apresentação|プレゼン|프레젠/i);
    await expect(options.nth(3)).toContainText(/folder|文件夹|Ordner|carpeta|pasta|フォルダ|폴더/i);
  });

  test('creating a folder opens it in the sidebar', async ({ page, l0 }) => {
    l0.allowAscError(() => true);
    l0.allowConsole(/Failed to open cloud workbook|Could not open|cloudOpenFailed|Failed to download/i);
    l0.allowFrameError(/Failed to download|Could not open/i);

    await page.goto('/login');
    await mockAppwrite(page, { download: 'fail', documents: [WORKBOOK, FOLDER] });
    await page.goto('/workspace');

    await expect(page.locator('.vault-tree-item[data-kind="folder"]')).toBeVisible();
    await page.locator('.vault-tree-item[data-kind="folder"]').click();
    await expect(page).toHaveURL(/folder=folder1/);
    await expect(page.locator('#workspace-folder-crumb')).toBeVisible();
    await expect(page.locator('#workspace-folder-crumb')).toContainText('Projects');
    await expect(page.locator('#workspace-up')).toBeVisible();
  });

  test('signed-in /workspace opens a workbook in the editor pane', async ({ page, l0 }) => {
    test.setTimeout(120_000);
    l0.allowConsole(/Failed to load resource|net::ERR_/i);

    await page.goto('/login');
    await mockAppwrite(page, { download: 'xlsx' });
    await page.goto('/workspace');

    await expect(page.locator('.vault-tree-title').first()).toHaveText('sample_data_3000x20.xlsx');
    await expect(page.locator('#workspace-editor-frame')).toHaveAttribute('src', /shell=1/);
    // shell:workbook-ready clears the overlay; that is the contract. The
    // OnlyOffice ribbon lives in a nested iframe, so we do not probe Asc here.
    await expect(page.locator('#workspace-stage-overlay')).toBeHidden({ timeout: 90_000 });
    await expect(page.locator('#workspace-stage-overlay')).not.toHaveAttribute('data-state', 'error');
  });

  test('blank editor boot auto-retries then opens', async ({ page, l0 }) => {
    // Reverse: without the boot watchdog remount, the first blank framed document
    // leaves #workspace-stage-overlay on data-state=loading forever.
    test.setTimeout(120_000);
    l0.allowConsole(/Failed to load resource|net::ERR_/i);

    let blankServed = 0;
    await page.route('**/editor**', async (route) => {
      const request = route.request();
      const isFramedNav = request.isNavigationRequest() && request.frame() !== page.mainFrame();
      if (isFramedNav && blankServed === 0) {
        blankServed += 1;
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><html><head><title>Document Editor</title></head><body><div id="app"></div></body></html>',
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/login');
    await mockAppwrite(page, { download: 'xlsx' });
    await page.goto('/workspace');

    await expect(page.locator('.vault-tree-title').first()).toHaveText('sample_data_3000x20.xlsx');
    await expect(page.locator('#workspace-stage-overlay')).toBeHidden({ timeout: 120_000 });
    expect(blankServed).toBeGreaterThanOrEqual(1);
  });
});
