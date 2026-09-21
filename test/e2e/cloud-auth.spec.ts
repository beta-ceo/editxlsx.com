/**
 * Cloud SaaS surfaces: /login and /files.
 *
 * These pages talk to Appwrite when a session exists. Default CI has no
 * credentials, so the suite only asserts the static shells and the anonymous
 * redirect from /files → /login. Live Appwrite round-trips stay manual / env-gated.
 */
import { expect, test } from './lib/l0';

test.describe('cloud auth pages', () => {
  test('login page renders the email/password form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('#auth-root')).toBeVisible();
    await expect(page.locator('.auth-title')).toBeVisible();
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
    await expect(page.locator('a[href="/login"] #hero-sign-in, a[href="/login"]')).toBeVisible();
    await expect(page.locator('#hero-files')).toBeVisible();
  });
});
