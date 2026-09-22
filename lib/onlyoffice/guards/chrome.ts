import { COMPACT_VIEWPORT_MAX_WIDTH } from '../viewport';

/**
 * 1. Strip the OnlyOffice chrome that has no place in a single-user local editor
 * -- the current-user / co-users widgets, which describe a collaboration
 * session this build cannot have -- hide the File ribbon tab (Save / download
 * already go through Ctrl+S and the host shell; the full-screen File menu is
 * mostly Document Server chrome), blank the entire document-title strip
 * (logo / filename / leftover hedset) as empty space above the toolbar, and
 * hide the right panel on phone-sized viewports.
 *
 * The ONLYOFFICE product mark stays reachable from the About entry on the
 * left rail (`#left-btn-about`); this stylesheet may hide `#header-logo` on
 * the title strip. Do not set `customization.about: false` -- that pane is
 * where the vendor logo, version and Ascensio copyright still live.
 */
export function injectLocalChromeCss(doc: Document): void {
  if (!doc.getElementById('oo-local-chrome-css')) {
    const style = doc.createElement('style');
    style.id = 'oo-local-chrome-css';
    // The compact rule is a media query on purpose: it re-evaluates itself
    // on rotation and on every window resize, so the panel a phone cannot
    // afford stays gone no matter which orientation the document was
    // opened in. The JS side (syncCompactLayout) only handles what CSS
    // cannot: the thumbnails panel and the SDK's own canvas geometry.
    style.textContent = [
      '.btn-current-user, #tlb-box-users { display: none !important; }',
      // Hide the File ribbon tab and its slot. Prefer :has so the empty
      // ribtab wrapper does not leave a gap; keep the bare [data-tab] rule
      // for builds that put the attribute on the wrapper itself.
      '.toolbar .ribtab:has(a[data-tab="file"]), .toolbar .ribtab a[data-tab="file"], .toolbar [data-tab="file"].ribtab { display: none !important; }',
      // Blank the title strip (logo, filename, hedset) but keep #app-title's
      // layout height so the row remains as whitespace above the toolbar.
      '#app-title #box-document-title, #app-title .logo, #app-title #header-logo { visibility: hidden !important; pointer-events: none !important; }',
      `@media (max-width: ${COMPACT_VIEWPORT_MAX_WIDTH}px), (pointer: coarse) and (max-height: ${COMPACT_VIEWPORT_MAX_WIDTH}px) {`,
      '  [data-layout-name="rightMenu"] { display: none !important; }',
      '}',
    ].join('\n');
    (doc.head || doc.documentElement).appendChild(style);
  }
}
