/**
 * Guard 17: Save / Print / Undo / Redo as a 2x2 block on the Home toolbar.
 *
 * The document-title quick-access bar is where the vendor actually mounts the
 * working Save / Print / Undo / Redo buttons (`#slot-btn-dt-*`). The always-on
 * static strip also has `#slot-btn-save` / `#slot-btn-print` / `#slot-btn-undo`
 * / `#slot-btn-redo`, but Undo / Redo there stay empty in this build -- the
 * Header controller owns those actions. Hiding the title-bar slots therefore
 * made Undo / Redo disappear entirely.
 *
 * Fix: move the four title-bar slots into `#oo-home-quick` at the left of
 * `.panel.static`, strip `icon--inverse` (those glyphs are painted for the
 * dark title bar and vanish on the light Home strip), and hide the unused
 * static duplicates plus quick-print.
 *
 * Idempotent. Returns false until the Header has rendered buttons into the
 * dt-slots so prepareEditorIframe can keep polling.
 */
const STYLE_ID = 'oo-home-quick-css';
const GRID_ID = 'oo-home-quick';

/** Title-bar slots that carry the live buttons. */
const MOVE_SLOT_IDS = [
  'slot-btn-dt-save',
  'slot-btn-dt-print',
  'slot-btn-dt-undo',
  'slot-btn-dt-redo',
] as const;

/** Static-strip duplicates + quick-print: hide, do not move. */
const HIDE_SLOT_IDS = [
  'slot-btn-save',
  'slot-btn-print',
  'slot-btn-undo',
  'slot-btn-redo',
  'slot-btn-dt-print-quick',
] as const;

function injectCss(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = [
    HIDE_SLOT_IDS.map((id) => `#${id}`).join(', ') + ' { display: none !important; }',
    `#${GRID_ID} {`,
    '  display: grid !important;',
    '  grid-template-columns: repeat(2, min-content);',
    '  grid-template-rows: repeat(2, min-content);',
    '  grid-auto-flow: row;',
    '  align-items: center;',
    '  justify-items: center;',
    '  gap: 2px 4px;',
    '  flex: none;',
    '  margin-right: 6px;',
    '}',
    `#${GRID_ID} > .btn-slot {`,
    '  display: inline-block !important;',
    '  margin: 0 !important;',
    '  float: none !important;',
    '  width: auto !important;',
    '  min-width: var(--x-small-btn-size, 20px);',
    '  min-height: var(--x-small-btn-size, 20px);',
    '}',
  ].join('\n');
  (doc.head || doc.documentElement).appendChild(style);
}

/** Header buttons are drawn for a dark title bar; Home is light. */
function adaptIconsForHomeToolbar(root: HTMLElement): void {
  root.querySelectorAll('.icon--inverse').forEach((node) => {
    node.classList.remove('icon--inverse');
  });
  // Header uses btn-header; the Home strip expects toolbar sizing.
  root.querySelectorAll('button.btn-header').forEach((node) => {
    node.classList.remove('btn-header');
    node.classList.add('btn-toolbar');
  });
}

/**
 * Relocate the four title-bar slots into a 2x2 grid. Exported for unit tests.
 * Returns true when the grid holds live buttons.
 */
export function relocateHomeQuickActions(doc: Document): boolean {
  injectCss(doc);

  const panel = doc.querySelector('.toolbar .panel.static') as HTMLElement | null;
  if (!panel) return false;

  const slots = MOVE_SLOT_IDS.map((id) => doc.getElementById(id));
  if (slots.some((el) => !el)) return false;
  // Wait until Header has mounted a real control into each slot. Empty slots
  // mean we ran before createButtons; moving them early freezes Undo/Redo as
  // blank cells.
  if (slots.some((el) => (el as HTMLElement).childElementCount === 0)) return false;

  const [save, print, undo, redo] = slots as HTMLElement[];

  const existing = doc.getElementById(GRID_ID);
  if (
    existing &&
    MOVE_SLOT_IDS.every((id) => existing.querySelector(`#${id}`)) &&
    MOVE_SLOT_IDS.every((id) => (existing.querySelector(`#${id}`)?.childElementCount ?? 0) > 0)
  ) {
    adaptIconsForHomeToolbar(existing);
    return true;
  }

  const grid = existing ?? doc.createElement('div');
  grid.id = GRID_ID;
  grid.className = 'oo-home-quick group no-mask small';
  grid.setAttribute('role', 'toolbar');
  grid.setAttribute('aria-label', 'Save, Print, Undo, Redo');

  // Row-major 2x2: Save | Print / Undo | Redo.
  for (const el of [save, print, undo, redo]) {
    grid.appendChild(el);
  }

  if (!existing || existing.parentElement !== panel) {
    panel.insertBefore(grid, panel.firstChild);
  }

  adaptIconsForHomeToolbar(grid);
  return true;
}

export function installHomeQuickActions(doc: Document): boolean {
  return relocateHomeQuickActions(doc);
}
