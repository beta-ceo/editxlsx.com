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
 * `.panel.static`, laid out like every other small Home group (two `.elset`
 * rows of `.btn-slot`s, `display: table-cell`, vendor padding / margins),
 * strip `icon--inverse` (those glyphs are painted for the dark title bar and
 * vanish on the light Home strip), and hide the unused static duplicates plus
 * quick-print.
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
    // Match neighboring `.group.small` table-cells: same padding, no extra gap.
    `#${GRID_ID} {`,
    '  display: table-cell !important;',
    '  vertical-align: middle !important;',
    '  margin: 0 !important;',
    '  float: none !important;',
    '}',
    `#${GRID_ID} > .elset {`,
    '  display: flex !important;',
    '  align-items: center !important;',
    '}',
    `#${GRID_ID} .btn-slot {`,
    '  display: inline-block !important;',
    '  float: none !important;',
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

function ensureElsetRows(doc: Document, grid: HTMLElement): [HTMLElement, HTMLElement] {
  let row1 = grid.querySelector(':scope > .elset:nth-child(1)') as HTMLElement | null;
  let row2 = grid.querySelector(':scope > .elset:nth-child(2)') as HTMLElement | null;
  if (!row1) {
    row1 = doc.createElement('div');
    row1.className = 'elset';
    grid.appendChild(row1);
  }
  if (!row2) {
    row2 = doc.createElement('div');
    row2.className = 'elset';
    grid.appendChild(row2);
  }
  return [row1, row2];
}

/**
 * Relocate the four title-bar slots into a 2x2 Home group. Exported for unit tests.
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
    MOVE_SLOT_IDS.every((id) => (existing.querySelector(`#${id}`)?.childElementCount ?? 0) > 0) &&
    existing.querySelectorAll(':scope > .elset').length === 2
  ) {
    adaptIconsForHomeToolbar(existing);
    return true;
  }

  const grid = existing ?? doc.createElement('div');
  grid.id = GRID_ID;
  // Same classes as neighboring clipboard / filter groups so padding and
  // separators line up without custom gap rules.
  grid.className = 'oo-home-quick group no-mask small';
  grid.setAttribute('role', 'toolbar');
  grid.setAttribute('aria-label', 'Save, Print, Undo, Redo');

  const [row1, row2] = ensureElsetRows(doc, grid);
  // Mirror filter-group slots: first of each row gets `.split` for the
  // vendor's horizontal slot width / margin between neighbors.
  save.classList.add('split');
  undo.classList.add('split');
  print.classList.remove('split');
  redo.classList.remove('split');

  // Row-major 2x2: Save | Print / Undo | Redo.
  row1.append(save, print);
  row2.append(undo, redo);

  if (!existing || existing.parentElement !== panel) {
    panel.insertBefore(grid, panel.firstChild);
  }

  adaptIconsForHomeToolbar(grid);
  return true;
}

export function installHomeQuickActions(doc: Document): boolean {
  return relocateHomeQuickActions(doc);
}
