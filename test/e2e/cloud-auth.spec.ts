/**
 * Cloud SaaS surfaces: /login and /files.
 *
 * These pages talk to Appwrite when a session exists. Default CI has no
 * credentials, so the suite mocks Appwrite for the signed-in /files shell and
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
};

async function mockAppwrite(
  page: import('@playwright/test').Page,
  options: { download?: 'xlsx' | 'fail' } = {},
): Promise<void> {
  const download = options.download ?? 'xlsx';
  const xlsx = Buffer.from(buildEmptyXlsxBytes());

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
    if (url.includes('/documents/') && !url.includes('queries')) {
      await json(WORKBOOK);
      return;
    }
    if (url.includes('/documents')) {
      await json({ total: 1, documents: [WORKBOOK] });
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

  test('anonymous /files redirects to /login', async ({ page }) => {
    await page.goto('/files');
    await page.waitForURL(/\/login/);
    expect(page.url()).toMatch(/\/login/);
  });

  test('homepage primary CTA points at sign-in', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#hero-sign-in')).toBeVisible();
    await expect(page.locator('#hero-files')).toBeVisible();
  });

  test('signed-in /files is a sidebar + editor shell', async ({ page, l0 }) => {
    // The framed editor will complain when the download fails; that is the
    // branch under test. Asc errors and console noise from the failed open
    // are expected and must not fail the case.
    l0.allowAscError(() => true);
    l0.allowConsole(/Failed to open cloud workbook|Could not open|cloudOpenFailed|Failed to download/i);
    l0.allowFrameError(/Failed to download|Could not open/i);

    await page.goto('/login');
    await mockAppwrite(page, { download: 'fail' });
    await page.goto('/files');

    await expect(page.locator('.vault')).toBeVisible();
    await expect(page.locator('.vault-side')).toBeVisible();
    await expect(page.locator('#files-new')).toBeVisible();
    await expect(page.locator('#files-home')).toBeVisible();
    await expect(page.locator('.vault-tree-title').first()).toHaveText('sample_data_3000x20.xlsx');
    await expect(page.locator('#files-editor-frame')).toHaveAttribute('src', /\/editor\?workbook=wb1.*shell=1/);
    await expect(page.locator('#files-stage-overlay')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#files-stage-overlay')).toHaveAttribute('data-state', 'error');
    await expect(page.locator('#files-stage-overlay-title')).not.toHaveText('');
  });

  test('signed-in /files opens a workbook in the editor pane', async ({ page, l0 }) => {
    test.setTimeout(120_000);
    l0.allowConsole(/Failed to load resource|net::ERR_/i);

    await page.goto('/login');
    await mockAppwrite(page, { download: 'xlsx' });
    await page.goto('/files');

    await expect(page.locator('.vault-tree-title').first()).toHaveText('sample_data_3000x20.xlsx');
    await expect(page.locator('#files-editor-frame')).toHaveAttribute('src', /shell=1/);
    // shell:workbook-ready clears the overlay; that is the contract. The
    // OnlyOffice ribbon lives in a nested iframe, so we do not probe Asc here.
    await expect(page.locator('#files-stage-overlay')).toBeHidden({ timeout: 90_000 });
    await expect(page.locator('#files-stage-overlay')).not.toHaveAttribute('data-state', 'error');
  });
});
