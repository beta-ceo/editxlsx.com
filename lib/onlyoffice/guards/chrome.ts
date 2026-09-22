import { COMPACT_VIEWPORT_MAX_WIDTH } from '../viewport';

/**
 * 1. Strip the OnlyOffice chrome that has no place in a single-user local editor
 * -- the current-user / co-users widgets, which describe a collaboration
 * session this build cannot have -- hide the File ribbon tab (Save / download
 * already go through Ctrl+S and the host shell; the full-screen File menu is
 * mostly Document Server chrome), blank the entire document-title strip
 * (logo / filename / leftover hedset) as empty space above the toolbar, turn
 * Print into a full-viewport overlay (no File-menu left rail; Close / Esc to
 * leave), and hide the right panel on phone-sized viewports.
 *
 * This stylesheet may hide `#header-logo` on the title strip. Do not set
 * `customization.about: false` -- the vendor About pane (logo / version /
 * Ascensio copyright) must remain in the DOM even though Guard 19 hides the
 * left-rail About button. Site footers and NOTICE carry the trademark line.
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
      // layout height so the row remains as blank space above the toolbar.
      '#app-title #box-document-title, #app-title .logo, #app-title #header-logo { visibility: hidden !important; pointer-events: none !important; }',
      // Print opens the File menu full-view panel. Cover the whole editor
      // viewport (not just below the ribbon). Park the File left nav off-screen
      // — do not use display:none, which stops Print from activating #panel-print.
      '#file-menu-panel.toolbar-fullview-panel {',
      '  position: fixed !important;',
      '  inset: 0 !important;',
      '  top: 0 !important;',
      '  left: 0 !important;',
      '  right: 0 !important;',
      '  bottom: 0 !important;',
      '  width: 100% !important;',
      '  height: 100% !important;',
      '  z-index: 10000 !important;',
      '  background: #f3f3f3 !important;',
      '}',
      '#file-menu-panel .panel-menu {',
      '  position: absolute !important;',
      '  left: -10000px !important;',
      '  top: 0 !important;',
      '  width: 1px !important;',
      '  height: 1px !important;',
      '  overflow: hidden !important;',
      '  opacity: 0 !important;',
      '  pointer-events: none !important;',
      '  float: none !important;',
      '}',
      '#file-menu-panel .panel-context {',
      '  padding-left: 0 !important;',
      '  width: 100% !important;',
      '  height: 100% !important;',
      '}',
      '#file-menu-panel #panel-print {',
      '  width: 100% !important;',
      '  max-width: none !important;',
      '  height: 100% !important;',
      '}',
      '#file-menu-panel #panel-print > div { height: 100% !important; }',
      // Close control injected by installPrintDelivery (guard 18).
      '#oo-print-close {',
      '  position: absolute;',
      '  top: 10px;',
      '  right: 12px;',
      '  z-index: 10001;',
      '  box-sizing: border-box;',
      '  width: 36px;',
      '  height: 36px;',
      '  margin: 0;',
      '  padding: 0;',
      '  border: 1px solid rgba(0, 0, 0, 0.12);',
      '  border-radius: 6px;',
      '  background: #fff;',
      '  color: #333;',
      '  font: 22px/1 system-ui, sans-serif;',
      '  cursor: pointer;',
      '}',
      '#oo-print-close:hover { background: #f0f0f0; }',
      '#oo-print-close:focus-visible { outline: 2px solid #446995; outline-offset: 2px; }',
      `@media (max-width: ${COMPACT_VIEWPORT_MAX_WIDTH}px), (pointer: coarse) and (max-height: ${COMPACT_VIEWPORT_MAX_WIDTH}px) {`,
      '  [data-layout-name="rightMenu"] { display: none !important; }',
      '}',
    ].join('\n');
    (doc.head || doc.documentElement).appendChild(style);
  }
}
