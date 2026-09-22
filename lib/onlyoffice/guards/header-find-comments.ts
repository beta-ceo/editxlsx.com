/**
 * Guard 19: park Find in the header; drop Comments / About from the left rail.
 *
 * The left rail owns the working Find (`#left-btn-searchbar`, opens
 * `#left-panel-search`). The header already has `#slot-btn-search`, but that
 * control does not open the side search panel in this build -- so the rail
 * Find is moved beside it and the empty header slot is hidden. Comments and
 * About are chrome this single-user build does not surface (trademark /
 * source notices stay on the site and in NOTICE; `customization.about` stays
 * on so the vendor pane still exists in the DOM).
 *
 * Collapse `#left-menu` to zero width while no side panel is open so the
 * spreadsheet reclaims the strip; pin a 300px width while a panel is open
 * (without the icon column the vendor width can balloon).
 */
const STYLE_ID = 'oo-header-find-comments-css';
const FIND_SLOT_ID = 'oo-header-find';
const SIDE_OPEN_CLASS = 'oo-side-open';
/** Vendor opens the rail at ~300px; without the icon column it can balloon. */
const SIDE_PANEL_WIDTH_PX = 300;

const HIDE_LEFT_IDS = [
  'left-btn-comments',
  'left-btn-about',
  'left-btn-chat',
  'left-btn-spellcheck',
  'left-btn-support',
] as const;

function injectCss(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = [
    HIDE_LEFT_IDS.map((id) => `#${id}`).join(', ') + ' { display: none !important; }',
    // Duplicate header Find -- the relocated left-rail Find replaces it.
    '#slot-btn-search { display: none !important; }',
    // Empty icon column -- panels still expand inside #left-menu.
    '#left-menu .tool-menu-btns { display: none !important; width: 0 !important; }',
    '#left-menu .tool-menu-btns .btn-side-more { display: none !important; }',
    // Reclaim the 40px rail while the Find panel is closed.
    `#left-menu:not(.${SIDE_OPEN_CLASS}) {`,
    '  width: 0 !important;',
    '  min-width: 0 !important;',
    '  border: none !important;',
    '  overflow: hidden !important;',
    '}',
    `#left-menu.${SIDE_OPEN_CLASS} {`,
    `  width: ${SIDE_PANEL_WIDTH_PX}px !important;`,
    '  min-width: 0 !important;',
    '}',
    `#${FIND_SLOT_ID} {`,
    '  display: inline-block !important;',
    '  vertical-align: middle !important;',
    '}',
    `#${FIND_SLOT_ID} > .btn {`,
    '  display: inline-block !important;',
    '}',
  ].join('\n');
  (doc.head || doc.documentElement).appendChild(style);
}

function adaptRailBtnForHeader(btn: HTMLElement): void {
  btn.classList.remove('btn-category');
  if (!btn.classList.contains('btn-header')) btn.classList.add('btn-header');
  btn.querySelectorAll('.toolbar__icon').forEach((node) => {
    node.classList.add('icon--inverse');
  });
  // Header hints open downward; the rail used "right".
  if (btn.getAttribute('data-hint-direction') === 'right') {
    btn.setAttribute('data-hint-direction', 'bottom');
  }
}

function isSidePanelOpen(doc: Document): boolean {
  const el = doc.getElementById('left-panel-search');
  return Boolean(el && doc.defaultView?.getComputedStyle(el).display !== 'none');
}

function syncSidePanelOpen(doc: Document): void {
  const left = doc.getElementById('left-menu');
  if (!left) return;
  left.classList.toggle(SIDE_OPEN_CLASS, isSidePanelOpen(doc));
}

function ensureSideSync(doc: Document): void {
  const root = doc.documentElement as HTMLElement & { __ooSideSync?: boolean };
  if (root.__ooSideSync) return;
  root.__ooSideSync = true;

  const sync = () => syncSidePanelOpen(doc);
  // Vendor flips panel display on click (sometimes after our handler). Observe
  // the panel and also re-check on the next frames after any click.
  const el = doc.getElementById('left-panel-search');
  if (el && doc.defaultView?.MutationObserver) {
    new doc.defaultView.MutationObserver(sync).observe(el, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
  }
  doc.addEventListener(
    'click',
    () => {
      sync();
      doc.defaultView?.requestAnimationFrame(() => {
        sync();
        doc.defaultView?.requestAnimationFrame(sync);
      });
    },
    true,
  );
}

/**
 * Relocate Find into the header hedset, hide Comments / About, and collapse
 * the left icon rail. Exported for unit tests. Returns true once the header
 * Find slot is in place.
 */
export function relocateHeaderFindComments(doc: Document): boolean {
  injectCss(doc);

  const searchSlot = doc.getElementById('slot-btn-search');
  const findBtn = doc.getElementById('left-btn-searchbar');
  if (!searchSlot || !findBtn) return false;

  const hedset = searchSlot.parentElement;
  if (!hedset) return false;

  let findSlot = doc.getElementById(FIND_SLOT_ID);
  if (!findSlot) {
    findSlot = doc.createElement('div');
    findSlot.id = FIND_SLOT_ID;
    findSlot.className = 'btn-slot';
  }

  if (findBtn.parentElement !== findSlot) findSlot.appendChild(findBtn);

  // Drop a leftover Comments header slot from earlier applies of this guard.
  doc.getElementById('oo-header-comments')?.remove();

  if (findSlot.parentElement !== hedset || searchSlot.nextElementSibling !== findSlot) {
    hedset.insertBefore(findSlot, searchSlot.nextSibling);
  }

  adaptRailBtnForHeader(findBtn);
  ensureSideSync(doc);
  syncSidePanelOpen(doc);
  return true;
}

export function installHeaderFindComments(doc: Document): boolean {
  return relocateHeaderFindComments(doc);
}
