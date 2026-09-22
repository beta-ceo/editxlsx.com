import { expect, test } from './lib/l0';
import type { Frame, Page } from '@playwright/test';

/**
 * ONLYOFFICE attribution on screen.
 *
 * Application code is MIT; the embedded editors remain AGPL with Ascensio's
 * Section 7 terms. The title strip (including `#header-logo`) may be blanked
 * as chrome. The About pane on the left rail must stay reachable and still
 * carry the vendor copyright plus this build's source offer. Site footers keep
 * the trademark notice (Section 7(e)).
 *
 * Reverse-verified: setting `about: false` fails the About cases.
 */
const editorFrame = (page: Page) => page.frames().find((f) => /documenteditor/.test(f.url()));

async function openBlankDocument(page: Page): Promise<Frame> {
  await page.goto('/editor?new=docx');
  await expect.poll(() => editorFrame(page)?.url() ?? null, { timeout: 60_000 }).not.toBeNull();
  const frame = editorFrame(page)!;
  // The header and the left rail render with the rest of the chrome, so wait
  // for the ribbon rather than for the frame's own load event.
  await expect
    .poll(() => frame.evaluate(() => document.querySelectorAll('.ribtab a').length).catch(() => 0), {
      timeout: 60_000,
    })
    .toBeGreaterThan(3);
  return frame;
}

/** Opens the About pane and returns its text, or '' if it never populates. */
async function openAbout(frame: Frame): Promise<string> {
  await frame.click('#left-btn-about');
  const text = () =>
    frame
      .evaluate(() => {
        const panel = document.querySelector('#about-menu-panel');
        return panel && panel.children.length > 0 ? (panel.textContent || '').replace(/\s+/g, ' ') : '';
      })
      .catch(() => '');
  await expect.poll(text, { timeout: 30_000 }).not.toBe('');
  return text();
}

test.describe('ONLYOFFICE branding (vendor About)', () => {
  test('the document title strip is blank (logo / filename / hedset hidden)', async ({ page }) => {
    const frame = await openBlankDocument(page);
    const blank = await frame.evaluate(() => {
      const title = document.getElementById('box-document-title') as HTMLElement | null;
      const logo = document.getElementById('header-logo') as HTMLElement | null;
      return {
        titleHidden: !title || getComputedStyle(title).visibility === 'hidden',
        logoHidden: !logo || getComputedStyle(logo).visibility === 'hidden',
        titleHeight: (document.getElementById('app-title') as HTMLElement | null)?.getBoundingClientRect().height ?? 0,
      };
    });
    expect(blank.titleHidden).toBe(true);
    expect(blank.logoHidden).toBe(true);
    // Layout item stays so the row remains as blank space above the toolbar.
    expect(blank.titleHeight).toBeGreaterThan(0);
  });

  test('the About entry is reachable and carries the vendor copyright', async ({ page }) => {
    const frame = await openBlankDocument(page);

    const inRail = await frame.evaluate(() => {
      const el = document.querySelector('#left-btn-about');
      return el ? getComputedStyle(el).display !== 'none' : false;
    });
    expect(inRail, 'the About entry must stay in the left rail -- see NOTICE').toBe(true);

    expect(await openAbout(frame)).toContain('Ascensio System SIA');
  });

  test('the File ribbon tab is hidden (save belongs to the host)', async ({ page }) => {
    const frame = await openBlankDocument(page);
    const fileTab = await frame.evaluate(() => {
      const el = document.querySelector('.toolbar a[data-tab="file"], .toolbar [data-tab="file"]') as HTMLElement | null;
      if (!el) return { present: false, visible: false };
      const style = getComputedStyle(el);
      const slot = el.closest('.ribtab') as HTMLElement | null;
      const slotStyle = slot ? getComputedStyle(slot) : null;
      const visible =
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        (!slotStyle || (slotStyle.display !== 'none' && slotStyle.visibility !== 'hidden'));
      return { present: true, visible };
    });
    // The tab may still exist in the DOM; the chrome guard must keep it off-screen.
    expect(fileTab.visible, 'File ribbon tab must stay hidden').toBe(false);
  });

  test('Save / Print / Undo / Redo sit in a 2x2 block on Home, not the title bar', async ({ page }) => {
    const frame = await openBlankDocument(page);
    await expect
      .poll(
        () =>
          frame
            .evaluate(() => {
              const grid = document.getElementById('oo-home-quick');
              if (!grid) return null;
              const ids = [...grid.children].map((el) => el.id);
              const filled = ids.every((id) => (document.getElementById(id)?.childElementCount ?? 0) > 0);
              return filled ? ids : null;
            })
            .catch(() => null),
        { timeout: 30_000 },
      )
      .toEqual(['slot-btn-dt-save', 'slot-btn-dt-print', 'slot-btn-dt-undo', 'slot-btn-dt-redo']);

    const ok = await frame.evaluate(() => {
      const grid = document.getElementById('oo-home-quick');
      if (!grid) return { grid: false };
      const undo = document.getElementById('slot-btn-dt-undo');
      const redo = document.getElementById('slot-btn-dt-redo');
      const undoBox = undo?.getBoundingClientRect();
      const redoBox = redo?.getBoundingClientRect();
      return {
        grid: true,
        inverseLeft: grid.querySelectorAll('.icon--inverse').length,
        undoVisible: !!undoBox && undoBox.width > 8 && undoBox.height > 8,
        redoVisible: !!redoBox && redoBox.width > 8 && redoBox.height > 8,
        staticUndoHidden: getComputedStyle(document.getElementById('slot-btn-undo')!).display === 'none',
      };
    });
    expect(ok.inverseLeft).toBe(0);
    expect(ok.undoVisible).toBe(true);
    expect(ok.redoVisible).toBe(true);
    expect(ok.staticUndoHidden).toBe(true);
  });

  test("the About pane also offers this build's own source (Section 13)", async ({ page }) => {
    const frame = await openBlankDocument(page);
    await openAbout(frame);

    await expect
      .poll(() => frame.evaluate(() => !!document.querySelector('#oo-source-notice')), { timeout: 30_000 })
      .toBe(true);
    const notice = await frame.evaluate(() => {
      const box = document.querySelector('#oo-source-notice') as HTMLElement;
      return {
        text: (box.textContent || '').replace(/\s+/g, ' '),
        href: box.querySelector('a')?.getAttribute('href') ?? '',
        height: box.getBoundingClientRect().height,
      };
    });

    expect(notice.height).toBeGreaterThan(0);
    expect(notice.text).toContain('not an official ONLYOFFICE product');
    expect(notice.href).toBe('https://github.com/ranuts/document');
  });
});

test.describe('trademark notice (AGPL-3.0 Section 7(e))', () => {
  const PAGES = [
    ['/', 'ONLYOFFICE is a trademark of Ascensio System SIA'],
    ['/zh-CN/', 'ONLYOFFICE 是 Ascensio System SIA 的商标'],
    ['/help', 'ONLYOFFICE is a trademark of Ascensio System SIA'],
  ] as const;

  for (const [route, expected] of PAGES) {
    test(`${route} states whose mark ONLYOFFICE is`, async ({ page }) => {
      await page.goto(route);
      await expect(page.locator('.tm').first()).toContainText(expected);
    });
  }
});
