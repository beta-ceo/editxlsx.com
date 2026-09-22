import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generate } from '../../bin/build-pages.mjs';

/**
 * The ONLYOFFICE attribution, pinned.
 *
 * Application code is MIT (LICENSE / package.json). The embedded ONLYOFFICE
 * editors remain AGPL-3.0 with Ascensio's Section 7 terms: 7(b) requires the
 * original product logo to be retained when distributing the program, and 7(e)
 * declines trademark rights. The title-strip header logo may be blanked as UI
 * chrome; `customization.about` must stay on so the vendor About pane remains
 * in the DOM (the left-rail About button may be hidden as chrome), and site
 * footers must keep the trademark notice. test/e2e/vendor-branding.spec.ts
 * covers the runtime half.
 */
const ROOT = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

/** The sentence that carries both terms, verbatim from the vendor's own headers. */
const SECTION_7 =
  'Pursuant to Section 7(b) of the License you must retain the original Product\n' +
  '    logo when distributing the program. Pursuant to Section 7(e) we decline to\n' +
  '    grant you any rights under trademark law for use of our trademarks.';

const READMES = ['readme.md'];

describe('ONLYOFFICE product logo (AGPL-3.0 Section 7(b))', () => {
  it('keeps the About pane in config; the title-strip logo may be blanked as chrome', () => {
    const guard = read('lib/onlyoffice/guards/chrome.ts');
    // Collaboration chrome and File / title-strip tidy-ups are intentional.
    expect(guard).toContain('.btn-current-user');
    expect(guard).toContain('#tlb-box-users');
    expect(guard).toContain('data-tab="file"');
    expect(guard).toContain('#header-logo');
    expect(guard).toContain('#box-document-title');
    // Print opens the File menu panel; its left nav is chrome we do not want.
    expect(guard).toContain('#file-menu-panel .panel-menu');
    expect(guard).toContain('padding-left: 0');
    expect(guard).toContain('left: -10000px');
    expect(guard).toContain('position: fixed');
    expect(guard).toContain('#oo-print-close');
  });

  it('is not removed with the About pane by the DocEditor config', () => {
    const editor = read('lib/onlyoffice-editor.ts');
    expect(editor, 'customization.about must stay at its default -- it is where the product logo lives').not.toMatch(
      /\babout:\s*false/,
    );
  });

  it("is joined in the About pane by this build's own source offer", () => {
    const guard = read('lib/onlyoffice/guards/about-source.ts');
    expect(guard).toContain('about-menu-panel');
    expect(guard).toContain('https://github.com/ranuts/document');
    expect(guard).toMatch(/not an official ONLYOFFICE product/);
    // Mounted, or it is a file nothing runs.
    expect(read('lib/onlyoffice/iframe-guards.ts')).toContain('installAboutSourceNotice(doc)');
  });

  it('declares the application license as MIT while NOTICE still quotes vendor AGPL terms', () => {
    expect(read('package.json')).toMatch(/"license":\s*"MIT"/);
    expect(read('LICENSE')).toContain('MIT License');
    expect(read('NOTICE')).toContain(SECTION_7);
  });
});

describe('trademark notice (AGPL-3.0 Section 7(e))', () => {
  const notice = read('NOTICE');

  it('reproduces the vendor terms verbatim, and the vendor build still carries them', () => {
    expect(notice).toContain(SECTION_7);
    // The source of that quote: an unminified vendor file that ships with the
    // build. If an upgrade drops it, the quote above needs re-checking against
    // whatever the new build carries.
    const vendor = read('public/web-apps/apps/common/main/lib/util/fix-ie-compat.js');
    expect(vendor).toContain('Pursuant to Section 7(b) of the License you must retain the original Product');
    expect(vendor).toContain('Pursuant to Section 7(e) we decline to');
  });

  it('names the mark, its owner, and that this project is neither', () => {
    expect(notice).toContain('Ascensio System SIA');
    // The notice is hard-wrapped, so the phrases can straddle a line break.
    expect(notice.replace(/\s+/g, ' ')).toMatch(/not an official ONLYOFFICE product/);
    expect(notice.replace(/\s+/g, ' ')).toMatch(/not affiliated with/);
  });

  it('lists the changes made to the vendor tree (Section 5(a))', () => {
    for (const changed of ['x2t_helper.js', 'x2t.wasm', 'locale/*.json', 'public/fonts/']) {
      expect(notice, `NOTICE does not mention ${changed}`).toContain(changed);
    }
  });

  it.each(READMES)('%s points at it and carries the disclaimer', (file) => {
    const markdown = read(file);
    expect(markdown).toContain('(NOTICE)');
    expect(markdown).toContain('Ascensio System SIA');
    expect(markdown).toContain('ONLYOFFICE');
  });
});

describe('trademark notice on the site itself', () => {
  const outputs = generate({ outDir: null }) as Array<{ route: string; kind: string; html: string }>;

  it("is on every generated page, in that page's language", () => {
    expect(outputs.length).toBeGreaterThan(50);
    for (const page of outputs) {
      expect(page.html, `${page.route} has no trademark notice`).toContain('class="tm"');
      expect(page.html, `${page.route} does not name the trademark owner`).toContain('Ascensio System SIA');
    }
  });

  it('says it in Chinese on the Chinese pages, not in English', () => {
    const zh = outputs.find((o) => o.route === '/zh-CN/')!;
    expect(zh.html).toContain('ONLYOFFICE 是 Ascensio System SIA 的商标');
    const en = outputs.find((o) => o.route === '/')!;
    expect(en.html).toContain('ONLYOFFICE is a trademark of Ascensio System SIA');
  });

  it('is styled, or it is a paragraph of legalese in body copy', () => {
    expect(read('public/landing.css')).toContain('.page-foot .tm');
    expect(read('public/home.css')).toContain('#landing-hero .foot .tm');
  });
});
