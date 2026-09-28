/**
 * Durable local vault on /workspace (This device).
 */
import { expect, test } from './lib/l0';

test.describe('local vault workspace', () => {
  test('anonymous workspace can create a blank local workbook', async ({ page, l0 }) => {
    l0.allowAscError(() => true);
    l0.allowConsole(/Failed to open|Could not open|cloudOpenFailed/i);
    l0.allowFrameError(/Failed to|Could not open/i);

    await page.goto('/workspace');
    await expect(page.locator('#workspace-source-local')).toHaveClass(/is-active/, { timeout: 15_000 });
    await page.locator('#workspace-new').click();
    await expect(page.locator('#workspace-new-menu')).toBeVisible();
    await page.locator('#workspace-new-menu button').first().click();

    await expect(page.locator('.vault-tree-title').first()).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/[?&]local=/);
    await expect(page.locator('#workspace-editor-frame')).toHaveAttribute('src', /shell=1/);
  });

  test('pricing page renders free and two cloud plan cards', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.locator('.pricing-card')).toHaveCount(3, { timeout: 15_000 });
    await expect(page.locator('[data-plan="local"]')).toContainText('$0');
    await expect(page.locator('[data-plan="gb1"]')).toContainText('1 GB');
    await expect(page.locator('[data-plan="gb10"]')).toContainText('10 GB');
  });
});
